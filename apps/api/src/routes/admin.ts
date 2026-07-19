import { Router, type Response } from 'express';
import archiver from 'archiver';
import multer from 'multer';
import { z } from 'zod';
import { coordinateAtVideoTime, type GpsPoint, type MediaType } from '@pothole/shared';
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
import { buildBundle, buildRawBundle, type BundleFile } from '../services/exporter';
import { driveConfigured, exportBundleToDrive } from '../services/drive';
import { extForMime, openMediaStream, saveBuffer } from '../services/storage';

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

/* --------------------------- annotation CRUD --------------------------- */

/** States in which an admin may create/edit/delete annotations. */
const ANNOTATABLE_STATES = ['pending_review', 'uploaded', 'accepted', 'partially_accepted'];

const estimateSchema = z
  .object({
    roadType: z.string(),
    roadWidthM: z.number().nullable(),
    diameterM: z.number().nullable(),
    areaM2: z.number().nullable(),
    assumedDepthM: z.number(),
    volumeM3: z.number().nullable(),
    fillMaterial: z.string(),
    materialKg: z.number().nullable(),
  })
  .strict();

const polygonSchema = z
  .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
  .min(3);

async function loadTrack(
  sampleId: string,
): Promise<{ points: GpsPoint[]; recordingStartMs: number } | null> {
  const { rows } = await query<{ recording_start_ms: string; points: GpsPoint[] }>(
    'SELECT recording_start_ms, points FROM gps_tracks WHERE sample_id = $1',
    [sampleId],
  );
  return rows[0]
    ? { points: rows[0].points, recordingStartMs: Number(rows[0].recording_start_ms) }
    : null;
}

/** Interpolate an annotation coordinate for a video sample. */
async function coordForVideo(sampleId: string, videoTimeSec: number): Promise<{ lat: number; lng: number }> {
  const track = await loadTrack(sampleId);
  if (!track) throw new ApiError(422, 'TRACK_REQUIRED', 'This video sample has no GPS track');
  const coord = coordinateAtVideoTime(track.points, track.recordingStartMs, videoTimeSec);
  if (!coord) throw new ApiError(422, 'TRACK_REQUIRED', 'GPS track is empty');
  return coord;
}

/** pothole_count = number of non-rejected annotations. */
async function refreshPotholeCount(sampleId: string): Promise<number> {
  const { rows } = await query<{ pothole_count: number }>(
    `UPDATE samples SET pothole_count =
       (SELECT COUNT(*) FROM annotations WHERE sample_id = $1 AND status <> 'rejected')
     WHERE id = $1 RETURNING pothole_count`,
    [sampleId],
  );
  return Number(rows[0]?.pothole_count ?? 0);
}

/**
 * POST /admin/samples/:id/annotations — admin-created annotation
 * (created_by 'admin', pre-accepted). Works for photo and video samples.
 */
adminRouter.post(
  '/samples/:id/annotations',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'SAMPLE_NOT_FOUND', 'Sample');
    const body = z
      .object({
        label: z.string().trim().min(1),
        polygon: polygonSchema,
        videoTimeSec: z.number().nonnegative().nullish(),
        estimate: estimateSchema.nullish(),
      })
      .parse(req.body ?? {});

    const { rows } = await query('SELECT * FROM samples WHERE id = $1', [req.params.id]);
    const sample = rows[0];
    if (!sample) throw new ApiError(404, 'SAMPLE_NOT_FOUND', 'Sample not found');
    if (!ANNOTATABLE_STATES.includes(sample.state)) {
      throw new ApiError(409, 'SAMPLE_LOCKED', `Sample in state ${sample.state} cannot be annotated`);
    }

    const isVideo = sample.media_type === 'video';
    let lat = Number(sample.lat);
    let lng = Number(sample.lng);
    if (isVideo) {
      if (body.videoTimeSec == null) {
        throw new ApiError(400, 'VIDEO_TIME_REQUIRED', 'videoTimeSec is required for video annotations');
      }
      ({ lat, lng } = await coordForVideo(sample.id, body.videoTimeSec));
    }

    const ins = await query(
      `INSERT INTO annotations (sample_id, label, polygon, video_time_sec, lat, lng, estimate, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'accepted','admin') RETURNING *`,
      [
        sample.id,
        body.label,
        JSON.stringify(body.polygon),
        isVideo ? body.videoTimeSec : null,
        lat,
        lng,
        body.estimate ? JSON.stringify(body.estimate) : null,
      ],
    );
    const potholeCount = await refreshPotholeCount(sample.id);
    ok(res, { annotation: rowToAnnotation(ins.rows[0]), potholeCount }, 201);
  }),
);

/**
 * PATCH /admin/annotations/:annotationId — edit label/polygon/videoTimeSec/
 * status/estimate. Changing videoTimeSec recomputes lat/lng from the track.
 */
adminRouter.patch(
  '/annotations/:annotationId',
  asyncH(async (req, res) => {
    assertUuid(req.params.annotationId, 'ANNOTATION_NOT_FOUND', 'Annotation');
    const body = z
      .object({
        label: z.string().trim().min(1).optional(),
        polygon: polygonSchema.optional(),
        videoTimeSec: z.number().nonnegative().optional(),
        status: z.enum(['pending', 'accepted', 'rejected']).optional(),
        estimate: estimateSchema.nullish(),
      })
      .parse(req.body ?? {});

    const { rows } = await query(
      `SELECT a.*, s.state AS sample_state, s.media_type AS sample_media_type
       FROM annotations a JOIN samples s ON s.id = a.sample_id
       WHERE a.id = $1`,
      [req.params.annotationId],
    );
    const existing = rows[0];
    if (!existing) throw new ApiError(404, 'ANNOTATION_NOT_FOUND', 'Annotation not found');
    if (!ANNOTATABLE_STATES.includes(existing.sample_state)) {
      throw new ApiError(409, 'SAMPLE_LOCKED', `Sample in state ${existing.sample_state} cannot be annotated`);
    }

    let lat: number | null = null;
    let lng: number | null = null;
    if (body.videoTimeSec != null) {
      if (existing.sample_media_type !== 'video') {
        throw new ApiError(400, 'NOT_A_VIDEO', 'videoTimeSec only applies to video samples');
      }
      ({ lat, lng } = await coordForVideo(existing.sample_id, body.videoTimeSec));
    }

    const upd = await query(
      `UPDATE annotations SET
         label          = COALESCE($2, label),
         polygon        = COALESCE($3, polygon),
         video_time_sec = COALESCE($4, video_time_sec),
         status         = COALESCE($5, status),
         estimate       = COALESCE($6, estimate),
         lat            = COALESCE($7, lat),
         lng            = COALESCE($8, lng)
       WHERE id = $1 RETURNING *`,
      [
        existing.id,
        body.label ?? null,
        body.polygon ? JSON.stringify(body.polygon) : null,
        body.videoTimeSec ?? null,
        body.status ?? null,
        body.estimate ? JSON.stringify(body.estimate) : null,
        lat,
        lng,
      ],
    );
    const potholeCount = await refreshPotholeCount(existing.sample_id);
    ok(res, { annotation: rowToAnnotation(upd.rows[0]), potholeCount });
  }),
);

/** DELETE /admin/annotations/:annotationId */
adminRouter.delete(
  '/annotations/:annotationId',
  asyncH(async (req, res) => {
    assertUuid(req.params.annotationId, 'ANNOTATION_NOT_FOUND', 'Annotation');
    const { rows } = await query(
      `SELECT a.id, a.sample_id, s.state AS sample_state
       FROM annotations a JOIN samples s ON s.id = a.sample_id WHERE a.id = $1`,
      [req.params.annotationId],
    );
    const existing = rows[0];
    if (!existing) throw new ApiError(404, 'ANNOTATION_NOT_FOUND', 'Annotation not found');
    if (!ANNOTATABLE_STATES.includes(existing.sample_state)) {
      throw new ApiError(409, 'SAMPLE_LOCKED', `Sample in state ${existing.sample_state} cannot be annotated`);
    }
    await query('DELETE FROM annotations WHERE id = $1', [existing.id]);
    const potholeCount = await refreshPotholeCount(existing.sample_id);
    ok(res, { deleted: true, potholeCount });
  }),
);

/**
 * POST /admin/samples/:id/review — accept / partially accept (both credit the
 * SAME full per-sample earning) or reject (permanent; a new sample is
 * required). Idempotent via ALREADY_REVIEWED.
 */
adminRouter.post(
  '/samples/:id/review',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'SAMPLE_NOT_FOUND', 'Sample');
    const admin = req.user!;
    const body = z
      .object({
        decision: z.enum(['accepted', 'partially_accepted', 'rejected']),
        reason: z.string().trim().optional(),
      })
      .parse(req.body ?? {});
    if (body.decision === 'rejected' && !body.reason) {
      throw new ApiError(400, 'REASON_REQUIRED', 'A reason is required when rejecting a sample');
    }

    const result = await withTransaction(async (client) => {
      const s = await client.query('SELECT * FROM samples WHERE id = $1 FOR UPDATE', [req.params.id]);
      const sample = s.rows[0];
      if (!sample) throw new ApiError(404, 'SAMPLE_NOT_FOUND', 'Sample not found');
      if (sample.reviewed_at || ['accepted', 'partially_accepted', 'rejected'].includes(sample.state)) {
        throw new ApiError(409, 'ALREADY_REVIEWED', 'This sample has already been reviewed');
      }
      if (sample.state !== 'pending_review') {
        throw new ApiError(409, 'NOT_REVIEWABLE', `Sample is in state ${sample.state}`);
      }

      const u = await client.query('SELECT * FROM users WHERE id = $1', [sample.user_id]);
      const collector = rowToUser(u.rows[0]);

      // Per-annotation statuses drive the partial-accept rules.
      const annStats = await client.query<{ status: string }>(
        'SELECT status FROM annotations WHERE sample_id = $1 FOR UPDATE',
        [sample.id],
      );
      const counts = { pending: 0, accepted: 0, rejected: 0 };
      for (const a of annStats.rows) counts[a.status as keyof typeof counts] += 1;

      if (body.decision === 'accepted') {
        await client.query(
          `UPDATE annotations SET status = 'accepted' WHERE sample_id = $1 AND status = 'pending'`,
          [sample.id],
        );
      } else if (body.decision === 'partially_accepted') {
        // Requires a real mix: at least one approved annotation, and at least
        // one that is not approved (rejected already, or pending — which gets
        // marked rejected now). Otherwise use accepted / rejected.
        if (counts.accepted < 1 || counts.pending + counts.rejected < 1) {
          throw new ApiError(
            400,
            'PARTIAL_REQUIRES_MIX',
            'Partial acceptance needs at least one accepted annotation and at least one rejected/pending annotation',
          );
        }
        await client.query(
          `UPDATE annotations SET status = 'rejected' WHERE sample_id = $1 AND status = 'pending'`,
          [sample.id],
        );
      }

      // POLICY: accepted and partially_accepted grant the SAME full
      // per-sample credit (payout/quota). Adjust here if partial payouts
      // should ever be prorated.
      let amountInr = 0;
      if (body.decision === 'accepted' || body.decision === 'partially_accepted') {
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
          note:
            body.decision === 'accepted'
              ? `Earning for accepted ${sample.media_type} sample`
              : `Earning for partially accepted ${sample.media_type} sample`,
        });
      }

      const upd = await client.query(
        `UPDATE samples SET
           state = $2,
           rejection_reason = $3,
           pothole_count = (SELECT COUNT(*) FROM annotations WHERE sample_id = $1 AND status <> 'rejected'),
           reviewed_by = $4,
           reviewed_at = now()
         WHERE id = $1 RETURNING *`,
        [
          sample.id,
          body.decision,
          body.decision === 'accepted' ? null : body.reason ?? null,
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
    } else if (body.decision === 'partially_accepted') {
      void mail.samplePartiallyAccepted(
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

/** Stream a bundle as a zip. Media bytes are streamed verbatim via the driver. */
async function streamZipBundle(res: Response, filename: string, files: BundleFile[]): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    console.error('[export] archive error:', err);
    res.destroy(err);
  });
  archive.pipe(res);

  for (const file of files) {
    if (file.kind === 'text') {
      archive.append(file.content, { name: file.name });
    } else {
      const media = await openMediaStream(file.relPath, file.storedOn);
      if (media?.stream) archive.append(media.stream, { name: file.name });
    }
  }
  await archive.finalize();
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** Legacy export (back-compat): 'accepted' samples only, raw layout. */
adminRouter.get(
  '/export/accepted.zip',
  asyncH(async (req, res) => {
    const mediaType = mediaTypeSchema.parse(req.query.mediaType ?? 'all') as MediaType | 'all';
    const files = await buildRawBundle(['accepted'], mediaType);
    await streamZipBundle(res, `pothole-accepted-${today()}.zip`, files);
  }),
);

/**
 * Training bundle: accepted + partially_accepted, ONLY approved annotations,
 * NO GPS data anywhere. images/ + labels/{coco,yolo,classes.txt} + videos/.
 */
adminRouter.get(
  '/export/training.zip',
  asyncH(async (_req, res) => {
    const files = await buildBundle('training');
    await streamZipBundle(res, `pothole-training-${today()}.zip`, files);
  }),
);

/**
 * Raw testing bundle: accepted + partially_accepted, unmodified media + full
 * GPS (meta/track) + all annotations with statuses.
 */
adminRouter.get(
  '/export/raw.zip',
  asyncH(async (_req, res) => {
    const files = await buildBundle('raw');
    await streamZipBundle(res, `pothole-raw-${today()}.zip`, files);
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
    const body = z
      .object({ bundle: z.enum(['training', 'raw']).default('raw') })
      .parse(req.body ?? {});
    const result = await exportBundleToDrive(body.bundle);
    ok(res, result);
  }),
);
