import { Router } from 'express';
import archiver from 'archiver';
import multer from 'multer';
import { z } from 'zod';
import type { MediaType } from '@pothole/shared';
import { query, withTransaction } from '../db/pool';
import {
  rowToAnnotation,
  rowToSample,
  rowToSettlement,
  rowToUser,
} from '../db/mappers';
import { ApiError, asyncH, ok } from '../http';
import { requireRole } from '../middleware/auth';
import { insertLedgerEntry, balanceSummary } from '../services/ledger';
import { mail } from '../services/mail';
import { collectAcceptedExportItems } from '../services/exporter';
import { driveConfigured, exportAcceptedToDrive } from '../services/drive';
import { extForMime, saveBuffer } from '../services/storage';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

function assertUuid(id: string, code: string, what: string): void {
  if (!UUID_RE.test(id)) throw new ApiError(404, code, `${what} not found`);
}

/* ------------------------------- users -------------------------------- */

adminRouter.get(
  '/users',
  asyncH(async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const { rows } = await query(
      `SELECT * FROM users WHERE ($1::text IS NULL OR account_state = $1) ORDER BY created_at DESC`,
      [state],
    );
    ok(res, rows.map(rowToUser));
  }),
);

adminRouter.post(
  '/users/:id/approve',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'USER_NOT_FOUND', 'User');
    const { rows } = await query(
      `UPDATE users SET account_state = 'approved', approved_at = COALESCE(approved_at, now())
       WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!rows[0]) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    const user = rowToUser(rows[0]);
    void mail.accountApproved(user.email, user.fullName);
    ok(res, user);
  }),
);

adminRouter.post(
  '/users/:id/reject',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'USER_NOT_FOUND', 'User');
    const body = z.object({ reason: z.string().trim().min(1) }).parse(req.body ?? {});
    const { rows } = await query(
      `UPDATE users SET account_state = 'rejected' WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    if (!rows[0]) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    const user = rowToUser(rows[0]);
    void mail.accountRejected(user.email, user.fullName, body.reason);
    ok(res, user);
  }),
);

adminRouter.patch(
  '/users/:id',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'USER_NOT_FOUND', 'User');
    const body = z
      .object({
        collectorStatus: z.enum(['student', 'professional', 'owner']).optional(),
        role: z.enum(['collector', 'admin', 'owner']).optional(),
      })
      .parse(req.body ?? {});
    const { rows } = await query(
      `UPDATE users SET
         collector_status = COALESCE($2, collector_status),
         role             = COALESCE($3, role)
       WHERE id = $1 RETURNING *`,
      [req.params.id, body.collectorStatus ?? null, body.role ?? null],
    );
    if (!rows[0]) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    ok(res, rowToUser(rows[0]));
  }),
);

/* ------------------------------ samples ------------------------------- */

adminRouter.get(
  '/samples',
  asyncH(async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : 'pending_review';
    const { rows } = await query(
      `SELECT s.*, u.email AS u_email, u.full_name AS u_full_name, u.collector_status AS u_status
       FROM samples s JOIN users u ON u.id = s.user_id
       WHERE ($1::text IS NULL OR s.state = $1)
       ORDER BY s.created_at DESC`,
      [state === 'all' ? null : state],
    );
    ok(
      res,
      rows.map((r) => ({
        ...rowToSample(r),
        user: { id: r.user_id, email: r.u_email, fullName: r.u_full_name, collectorStatus: r.u_status },
      })),
    );
  }),
);

adminRouter.get(
  '/samples/:id',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'SAMPLE_NOT_FOUND', 'Sample');
    const { rows } = await query('SELECT * FROM samples WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError(404, 'SAMPLE_NOT_FOUND', 'Sample not found');
    const [userRes, anns, track] = await Promise.all([
      query('SELECT * FROM users WHERE id = $1', [rows[0].user_id]),
      query('SELECT * FROM annotations WHERE sample_id = $1 ORDER BY created_at', [req.params.id]),
      query('SELECT recording_start_ms, points FROM gps_tracks WHERE sample_id = $1', [req.params.id]),
    ]);
    ok(res, {
      sample: rowToSample(rows[0]),
      user: userRes.rows[0] ? rowToUser(userRes.rows[0]) : null,
      annotations: anns.rows.map(rowToAnnotation),
      gpsTrack: track.rows[0]
        ? { recordingStartMs: Number(track.rows[0].recording_start_ms), points: track.rows[0].points }
        : null,
    });
  }),
);

/**
 * POST /admin/samples/:id/review — accept (credit earning) or reject
 * (permanent; a new sample is required). Idempotent via ALREADY_REVIEWED.
 */
adminRouter.post(
  '/samples/:id/review',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'SAMPLE_NOT_FOUND', 'Sample');
    const admin = req.user!;
    const body = z
      .object({ decision: z.enum(['accepted', 'rejected']), reason: z.string().trim().optional() })
      .parse(req.body ?? {});
    if (body.decision === 'rejected' && !body.reason) {
      throw new ApiError(400, 'REASON_REQUIRED', 'A reason is required when rejecting a sample');
    }

    const result = await withTransaction(async (client) => {
      const s = await client.query('SELECT * FROM samples WHERE id = $1 FOR UPDATE', [req.params.id]);
      const sample = s.rows[0];
      if (!sample) throw new ApiError(404, 'SAMPLE_NOT_FOUND', 'Sample not found');
      if (sample.reviewed_at || ['accepted', 'rejected'].includes(sample.state)) {
        throw new ApiError(409, 'ALREADY_REVIEWED', 'This sample has already been reviewed');
      }
      if (sample.state !== 'pending_review') {
        throw new ApiError(409, 'NOT_REVIEWABLE', `Sample is in state ${sample.state}`);
      }

      const u = await client.query('SELECT * FROM users WHERE id = $1', [sample.user_id]);
      const collector = rowToUser(u.rows[0]);

      let amountInr = 0;
      if (body.decision === 'accepted') {
        const p = await client.query(
          'SELECT video_quota, photo_quota, payout_inr FROM packages WHERE code = $1',
          [collector.packageCode],
        );
        const pkg = p.rows[0];
        if (!pkg) throw new ApiError(500, 'PACKAGE_MISSING', 'Collector has no package configured');
        const quota = sample.media_type === 'video' ? Number(pkg.video_quota) : Number(pkg.photo_quota);
        amountInr = Math.round((Number(pkg.payout_inr) / quota) * 100) / 100;
        await insertLedgerEntry(client, {
          userId: collector.id,
          type: 'earning',
          amountInr,
          sampleId: sample.id,
          note: `Earning for accepted ${sample.media_type} sample`,
        });
      }

      const upd = await client.query(
        `UPDATE samples SET
           state = $2,
           rejection_reason = $3,
           reviewed_by = $4,
           reviewed_at = now()
         WHERE id = $1 RETURNING *`,
        [
          sample.id,
          body.decision,
          body.decision === 'rejected' ? body.reason ?? null : null,
          admin.id,
        ],
      );
      return { sample: rowToSample(upd.rows[0]), collector, amountInr };
    });

    if (body.decision === 'accepted') {
      void mail.sampleAccepted(
        result.collector.email,
        result.collector.fullName,
        result.sample.id,
        result.amountInr,
      );
    } else {
      void mail.sampleRejected(
        result.collector.email,
        result.collector.fullName,
        result.sample.id,
        body.reason ?? '',
      );
    }
    ok(res, { sample: result.sample, creditedInr: result.amountInr || null });
  }),
);

/* ---------------------------- settlements ------------------------------ */

adminRouter.get(
  '/settlements',
  asyncH(async (_req, res) => {
    const { rows } = await query(
      `SELECT st.*, u.email AS u_email, u.full_name AS u_full_name
       FROM settlements st JOIN users u ON u.id = st.user_id
       ORDER BY st.created_at DESC`,
      [],
    );
    ok(
      res,
      rows.map((r) => ({
        ...rowToSettlement(r),
        user: { id: r.user_id, email: r.u_email, fullName: r.u_full_name },
      })),
    );
  }),
);

adminRouter.get(
  '/users/:id/balance',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'USER_NOT_FOUND', 'User');
    ok(res, await balanceSummary((t, p) => query(t, p), req.params.id));
  }),
);

/**
 * POST /admin/users/:id/settlements — manual payout. Caps the amount at the
 * unsettled balance, records the settlement + negative ledger entry and marks
 * earnings (oldest first) as settled.
 */
adminRouter.post(
  '/users/:id/settlements',
  upload.single('proof'),
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'USER_NOT_FOUND', 'User');
    const admin = req.user!;
    const body = z
      .object({
        amountInr: z.coerce.number().positive(),
        utrReference: z.string().trim().optional(),
      })
      .parse(req.body ?? {});

    const result = await withTransaction(async (client) => {
      const u = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!u.rows[0]) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
      const collector = rowToUser(u.rows[0]);

      const bal = await client.query<{ balance: string }>(
        `SELECT COALESCE(SUM(amount_inr), 0) AS balance FROM ledger_entries WHERE user_id = $1`,
        [collector.id],
      );
      const balance = Math.round(Number(bal.rows[0].balance) * 100) / 100;
      if (balance <= 0) throw new ApiError(409, 'NO_BALANCE', 'User has no unsettled balance');
      const amountInr = Math.min(body.amountInr, balance);

      let proofPath: string | null = null;
      if (req.file) {
        proofPath = `proofs/${collector.id}-${Date.now()}.${extForMime(req.file.mimetype)}`;
        await saveBuffer(proofPath, req.file.buffer);
      }

      const st = await client.query(
        `INSERT INTO settlements (user_id, amount_inr, state, settled_by, settled_at, proof_path, utr_reference)
         VALUES ($1, $2, 'settled', $3, now(), $4, $5) RETURNING *`,
        [collector.id, amountInr, admin.id, proofPath, body.utrReference ?? null],
      );
      const settlement = rowToSettlement(st.rows[0]);

      await insertLedgerEntry(client, {
        userId: collector.id,
        type: 'settlement',
        amountInr: -amountInr,
        settlementId: settlement.id,
        note: body.utrReference ? `Payout (UTR ${body.utrReference})` : 'Payout',
      });

      // Mark earnings settled, oldest first, until the settled amount is covered.
      const earnings = await client.query<{ id: string; amount_inr: string }>(
        `SELECT id, amount_inr FROM ledger_entries
         WHERE user_id = $1 AND type = 'earning' AND settled = false
         ORDER BY created_at ASC, id ASC
         FOR UPDATE`,
        [collector.id],
      );
      let remaining = amountInr;
      const toSettle: string[] = [];
      for (const e of earnings.rows) {
        if (remaining <= 0) break;
        toSettle.push(e.id);
        remaining = Math.round((remaining - Number(e.amount_inr)) * 100) / 100;
      }
      if (toSettle.length > 0) {
        await client.query(
          `UPDATE ledger_entries SET settled = true, settled_at = now() WHERE id = ANY($1::uuid[])`,
          [toSettle],
        );
      }

      return { settlement, collector, amountInr };
    });

    void mail.settlementCompleted(
      result.collector.email,
      result.collector.fullName,
      result.amountInr,
      result.settlement.utrReference,
    );
    ok(res, result.settlement, 201);
  }),
);

/* ------------------------------ exports -------------------------------- */

const mediaTypeSchema = z.enum(['photo', 'video', 'all']).default('all');

adminRouter.get(
  '/export/accepted.zip',
  asyncH(async (req, res) => {
    const mediaType = mediaTypeSchema.parse(req.query.mediaType ?? 'all') as MediaType | 'all';
    const items = await collectAcceptedExportItems(mediaType);

    res.status(200);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="pothole-accepted-${new Date().toISOString().slice(0, 10)}.zip"`,
    );

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('[export] archive error:', err);
      res.destroy(err);
    });
    archive.pipe(res);

    for (const item of items) {
      if (item.mediaAbsPath) {
        // Media bytes are streamed verbatim — never re-encoded or modified.
        archive.file(item.mediaAbsPath, { name: `${item.dir}${item.mediaFileName}` });
      }
      for (const jf of item.jsonFiles) {
        archive.append(jf.content, { name: `${item.dir}${jf.name}` });
      }
    }
    await archive.finalize();
  }),
);

adminRouter.post(
  '/export/drive',
  asyncH(async (req, res) => {
    if (!driveConfigured()) {
      throw new ApiError(
        501,
        'NOT_CONFIGURED',
        'Google Drive export requires GOOGLE_SERVICE_ACCOUNT_JSON and DRIVE_FOLDER_ID',
      );
    }
    const mediaType = mediaTypeSchema.parse(
      (req.body?.mediaType as string | undefined) ?? req.query.mediaType ?? 'all',
    ) as MediaType | 'all';
    const result = await exportAcceptedToDrive(mediaType);
    ok(res, result);
  }),
);
