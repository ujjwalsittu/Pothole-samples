import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { Router, type Response } from 'express';
import archiver from 'archiver';
import multer from 'multer';
import { z } from 'zod';
import {
  ROAD_QUALITY_GEO_PRECISION,
  SETTLEMENT_CONFIRM_THRESHOLD_INR,
  coordinateAtVideoTime,
  geohashDecode,
  geohashEncode,
  type DatasetManifest,
  type GpsPoint,
  type MediaType,
  type RoadQualityCell,
  type User,
} from '@pothole/shared';
import { config } from '../config';
import { query, withTransaction } from '../db/pool';
import {
  rowToAnnotation,
  rowToAuditEntry,
  rowToCampaign,
  rowToPackage,
  rowToSample,
  rowToSettlement,
  rowToUser,
  type SettlementOut,
} from '../db/mappers';
import { ApiError, asyncH, ok } from '../http';
import { requireRole } from '../middleware/auth';
import { audit } from '../services/audit';
import { insertLedgerEntry, balanceSummary } from '../services/ledger';
import { mail } from '../services/mail';
import { sendPush } from '../services/push';
import { extractAcceptedFrames } from '../services/frames';
import {
  buildBundle,
  buildRawBundle,
  buildTrainingBundle,
  type BundleFile,
} from '../services/exporter';
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
    void sendPush(user.id, 'Account approved', 'You can start collecting pothole samples now!');
    void audit(req.user!.id, 'user.approve', 'user', user.id);
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
    void audit(req.user!.id, 'user.reject', 'user', user.id, { reason: body.reason });
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
        packageCode: z.string().trim().min(1).optional(),
      })
      .parse(req.body ?? {});
    if (body.packageCode) {
      const pkg = await query('SELECT code FROM packages WHERE code = $1', [body.packageCode]);
      if (!pkg.rows[0]) throw new ApiError(404, 'PACKAGE_NOT_FOUND', 'Unknown package code');
    }
    const { rows } = await query(
      `UPDATE users SET
         collector_status = COALESCE($2, collector_status),
         role             = COALESCE($3, role),
         package_code     = COALESCE($4, package_code)
       WHERE id = $1 RETURNING *`,
      [req.params.id, body.collectorStatus ?? null, body.role ?? null, body.packageCode ?? null],
    );
    if (!rows[0]) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');
    void audit(req.user!.id, 'user.update', 'user', req.params.id, body);
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
    void audit(req.user!.id, 'annotation.create', 'annotation', ins.rows[0].id as string, {
      sampleId: sample.id,
      label: body.label,
    });
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
    void audit(req.user!.id, 'annotation.update', 'annotation', existing.id as string, {
      sampleId: existing.sample_id,
      ...body,
    });
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
    void audit(req.user!.id, 'annotation.delete', 'annotation', existing.id as string, {
      sampleId: existing.sample_id,
    });
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
      // per-sample credit (payout/quota), multiplied by the campaign boost
      // captured at init time (samples.boost_applied). Adjust here if partial
      // payouts should ever be prorated.
      let amountInr = 0;
      const boost = sample.boost_applied == null ? 1 : Number(sample.boost_applied);
      const isCredit = body.decision === 'accepted' || body.decision === 'partially_accepted';
      if (isCredit) {
        const p = await client.query(
          'SELECT name, video_quota, photo_quota, payout_inr, next_package_code FROM packages WHERE code = $1',
          [collector.packageCode],
        );
        const pkg = p.rows[0];
        if (!pkg) throw new ApiError(500, 'PACKAGE_MISSING', 'Collector has no package configured');
        const quota = sample.media_type === 'video' ? Number(pkg.video_quota) : Number(pkg.photo_quota);
        const baseCredit = Math.round((Number(pkg.payout_inr) / quota) * 100) / 100;
        amountInr = Math.round(baseCredit * boost * 100) / 100;
        const boostNote = boost !== 1 ? ` (campaign boost ×${boost})` : '';
        await insertLedgerEntry(client, {
          userId: collector.id,
          type: 'earning',
          amountInr,
          sampleId: sample.id,
          note:
            body.decision === 'accepted'
              ? `Earning for accepted ${sample.media_type} sample${boostNote}`
              : `Earning for partially accepted ${sample.media_type} sample${boostNote}`,
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

      // Auto-enroll (feature 5): when this acceptance completes either quota
      // of the collector's package, switch to next_package_code (if set).
      let packageCompleted: { packageName: string; payoutInr: number; nextPackageName: string | null } | null =
        null;
      if (isCredit) {
        const pkgRow = (
          await client.query(
            'SELECT name, video_quota, photo_quota, payout_inr, next_package_code FROM packages WHERE code = $1',
            [collector.packageCode],
          )
        ).rows[0];
        const done = (
          await client.query<{ vids: string; photos: string }>(
            `SELECT
               COUNT(*) FILTER (WHERE media_type = 'video') AS vids,
               COUNT(*) FILTER (WHERE media_type = 'photo') AS photos
             FROM samples
             WHERE user_id = $1 AND state IN ('accepted', 'partially_accepted')`,
            [collector.id],
          )
        ).rows[0];
        const vids = Number(done.vids);
        const photos = Number(done.photos);
        const vQuota = Number(pkgRow.video_quota);
        const pQuota = Number(pkgRow.photo_quota);
        const isVideo = sample.media_type === 'video';
        const completeNow = vids >= vQuota || photos >= pQuota;
        const completeBefore =
          vids - (isVideo ? 1 : 0) >= vQuota || photos - (isVideo ? 0 : 1) >= pQuota;
        if (completeNow && !completeBefore) {
          let nextPackageName: string | null = null;
          const nextCode = pkgRow.next_package_code as string | null;
          if (nextCode) {
            const next = await client.query('SELECT name FROM packages WHERE code = $1 AND active = true', [
              nextCode,
            ]);
            if (next.rows[0]) {
              await client.query('UPDATE users SET package_code = $2 WHERE id = $1', [
                collector.id,
                nextCode,
              ]);
              nextPackageName = next.rows[0].name as string;
            }
          }
          packageCompleted = {
            packageName: pkgRow.name as string,
            payoutInr: Number(pkgRow.payout_inr),
            nextPackageName,
          };
        }
      }

      return { sample: rowToSample(upd.rows[0]), collector, amountInr, packageCompleted };
    });

    if (body.decision === 'accepted') {
      void mail.sampleAccepted(
        result.collector.email,
        result.collector.fullName,
        result.sample.id,
        result.amountInr,
      );
      void sendPush(result.collector.id, 'Sample accepted', `₹${result.amountInr} credited to your balance.`);
    } else if (body.decision === 'partially_accepted') {
      void mail.samplePartiallyAccepted(
        result.collector.email,
        result.collector.fullName,
        result.sample.id,
        result.amountInr,
      );
      void sendPush(
        result.collector.id,
        'Sample accepted with adjustments',
        `₹${result.amountInr} credited to your balance.`,
      );
    } else {
      void mail.sampleRejected(
        result.collector.email,
        result.collector.fullName,
        result.sample.id,
        body.reason ?? '',
      );
      void sendPush(result.collector.id, 'Sample rejected', body.reason ?? 'Please capture a new sample.');
    }

    if (result.packageCompleted) {
      void mail.packageComplete(
        result.collector.email,
        result.collector.fullName,
        result.packageCompleted.packageName,
        result.packageCompleted.payoutInr,
        result.packageCompleted.nextPackageName,
      );
      void sendPush(
        result.collector.id,
        'Package complete!',
        `You earned ₹${result.packageCompleted.payoutInr}${result.packageCompleted.nextPackageName ? ` — ${result.packageCompleted.nextPackageName} started` : ''}.`,
      );
    }

    // Extract per-annotation video frames for accepted/partial videos
    // (fire-and-forget; requires system ffmpeg).
    if (body.decision !== 'rejected' && result.sample.mediaType === 'video') {
      void extractAcceptedFrames(result.sample.id);
    }

    void audit(admin.id, 'sample.review', 'sample', result.sample.id, {
      decision: body.decision,
      reason: body.reason ?? null,
      creditedInr: result.amountInr || null,
    });
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

type TxClient = Parameters<Parameters<typeof withTransaction>[0]>[0];

/** Unsettled balance (₹) for a user; caller must hold the user row lock. */
async function unsettledBalance(client: TxClient, userId: string): Promise<number> {
  const bal = await client.query<{ balance: string }>(
    `SELECT COALESCE(SUM(amount_inr), 0) AS balance FROM ledger_entries WHERE user_id = $1`,
    [userId],
  );
  return Math.round(Number(bal.rows[0].balance) * 100) / 100;
}

/**
 * Execute the ledger side of a settlement: negative running-balance entry +
 * mark earnings settled oldest-first up to the amount.
 */
async function settleLedger(
  client: TxClient,
  collectorId: string,
  settlementId: string,
  amountInr: number,
  utrReference: string | null,
): Promise<void> {
  await insertLedgerEntry(client, {
    userId: collectorId,
    type: 'settlement',
    amountInr: -amountInr,
    settlementId,
    note: utrReference ? `Payout (UTR ${utrReference})` : 'Payout',
  });
  const earnings = await client.query<{ id: string; amount_inr: string }>(
    `SELECT id, amount_inr FROM ledger_entries
     WHERE user_id = $1 AND type = 'earning' AND settled = false
     ORDER BY created_at ASC, id ASC
     FOR UPDATE`,
    [collectorId],
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
}

function notifySettled(collector: User, amountInr: number, utr: string | null): void {
  void mail.settlementCompleted(collector.email, collector.fullName, amountInr, utr);
  void sendPush(collector.id, 'Payout settled', `₹${amountInr} has been paid to your UPI.`);
}

/**
 * POST /admin/users/:id/settlements — manual payout, capped at the unsettled
 * balance. Amounts >= SETTLEMENT_CONFIRM_THRESHOLD_INR require a SECOND admin
 * to confirm before the ledger is touched (two-admin control); smaller
 * amounts settle immediately.
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

      const balance = await unsettledBalance(client, collector.id);
      if (balance <= 0) throw new ApiError(409, 'NO_BALANCE', 'User has no unsettled balance');
      const amountInr = Math.min(body.amountInr, balance);

      let proofPath: string | null = null;
      if (req.file) {
        proofPath = `proofs/${collector.id}-${Date.now()}.${extForMime(req.file.mimetype)}`;
        await saveBuffer(proofPath, req.file.buffer);
      }

      const needsConfirmation = amountInr >= SETTLEMENT_CONFIRM_THRESHOLD_INR;
      const st = await client.query(
        needsConfirmation
          ? `INSERT INTO settlements
               (user_id, amount_inr, state, proof_path, utr_reference, confirm_state, initiated_by)
             VALUES ($1, $2, 'initiated', $3, $4, 'awaiting_confirmation', $5) RETURNING *`
          : `INSERT INTO settlements
               (user_id, amount_inr, state, settled_by, settled_at, proof_path, utr_reference, initiated_by)
             VALUES ($1, $2, 'settled', $5, now(), $3, $4, $5) RETURNING *`,
        [collector.id, amountInr, proofPath, body.utrReference ?? null, admin.id],
      );
      const settlement = rowToSettlement(st.rows[0]);

      if (!needsConfirmation) {
        await settleLedger(client, collector.id, settlement.id, amountInr, body.utrReference ?? null);
      }
      return { settlement, collector, amountInr, needsConfirmation };
    });

    if (result.needsConfirmation) {
      void audit(admin.id, 'settlement.initiate', 'settlement', result.settlement.id, {
        userId: result.collector.id,
        amountInr: result.amountInr,
        awaitingConfirmation: true,
      });
    } else {
      notifySettled(result.collector, result.amountInr, result.settlement.utrReference);
      void audit(admin.id, 'settlement.settle', 'settlement', result.settlement.id, {
        userId: result.collector.id,
        amountInr: result.amountInr,
      });
    }
    ok(res, result.settlement, 201);
  }),
);

/**
 * POST /admin/settlements/:id/confirm — second-admin confirmation for large
 * settlements. MUST be a different admin than the initiator (SAME_ADMIN).
 */
adminRouter.post(
  '/settlements/:id/confirm',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'SETTLEMENT_NOT_FOUND', 'Settlement');
    const admin = req.user!;

    const result = await withTransaction(async (client) => {
      const st = await client.query('SELECT * FROM settlements WHERE id = $1 FOR UPDATE', [req.params.id]);
      const row = st.rows[0];
      if (!row) throw new ApiError(404, 'SETTLEMENT_NOT_FOUND', 'Settlement not found');
      if (row.confirm_state !== 'awaiting_confirmation') {
        throw new ApiError(409, 'NOT_AWAITING_CONFIRMATION', `Settlement confirm state is ${row.confirm_state ?? 'null'}`);
      }
      if (row.initiated_by === admin.id) {
        throw new ApiError(403, 'SAME_ADMIN', 'A different admin must confirm this settlement');
      }

      const u = await client.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [row.user_id]);
      const collector = rowToUser(u.rows[0]);
      const balance = await unsettledBalance(client, collector.id);
      if (balance <= 0) throw new ApiError(409, 'NO_BALANCE', 'User has no unsettled balance');
      const amountInr = Math.min(Number(row.amount_inr), balance);

      const upd = await client.query(
        `UPDATE settlements SET
           amount_inr = $2, state = 'settled', confirm_state = 'confirmed',
           confirmed_by = $3, confirmed_at = now(), settled_by = $3, settled_at = now()
         WHERE id = $1 RETURNING *`,
        [row.id, amountInr, admin.id],
      );
      await settleLedger(client, collector.id, row.id as string, amountInr, (row.utr_reference as string | null) ?? null);
      return { settlement: rowToSettlement(upd.rows[0]), collector, amountInr };
    });

    notifySettled(result.collector, result.amountInr, result.settlement.utrReference);
    void audit(admin.id, 'settlement.confirm', 'settlement', result.settlement.id, {
      userId: result.collector.id,
      amountInr: result.amountInr,
    });
    ok(res, result.settlement);
  }),
);

/** POST /admin/settlements/:id/cancel — cancel an awaiting settlement. */
adminRouter.post(
  '/settlements/:id/cancel',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'SETTLEMENT_NOT_FOUND', 'Settlement');
    const { rows } = await query(
      `UPDATE settlements SET confirm_state = 'cancelled'
       WHERE id = $1 AND confirm_state = 'awaiting_confirmation' RETURNING *`,
      [req.params.id],
    );
    if (!rows[0]) {
      throw new ApiError(409, 'NOT_AWAITING_CONFIRMATION', 'Settlement is not awaiting confirmation');
    }
    void audit(req.user!.id, 'settlement.cancel', 'settlement', req.params.id);
    ok(res, rowToSettlement(rows[0]));
  }),
);

/* ------------------------------ campaigns ------------------------------- */

const campaignBodySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().nullish(),
  polygon: z
    .array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
    .min(3, 'Campaign polygon needs at least 3 vertices'),
  boost: z.coerce.number().positive().max(100).optional(),
  active: z.boolean().optional(),
  startsAt: z.string().datetime({ offset: true }).nullish(),
  endsAt: z.string().datetime({ offset: true }).nullish(),
});

adminRouter.get(
  '/campaigns',
  asyncH(async (_req, res) => {
    const { rows } = await query('SELECT * FROM campaigns ORDER BY created_at DESC');
    ok(res, rows.map(rowToCampaign));
  }),
);

adminRouter.post(
  '/campaigns',
  asyncH(async (req, res) => {
    const body = campaignBodySchema.parse(req.body ?? {});
    const { rows } = await query(
      `INSERT INTO campaigns (name, description, polygon, boost, active, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        body.name,
        body.description ?? null,
        JSON.stringify(body.polygon),
        body.boost ?? 1.5,
        body.active ?? true,
        body.startsAt ?? null,
        body.endsAt ?? null,
      ],
    );
    void audit(req.user!.id, 'campaign.create', 'campaign', rows[0].id as string, { name: body.name });
    ok(res, rowToCampaign(rows[0]), 201);
  }),
);

adminRouter.patch(
  '/campaigns/:id',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'CAMPAIGN_NOT_FOUND', 'Campaign');
    const body = campaignBodySchema.partial().parse(req.body ?? {});
    const { rows } = await query(
      `UPDATE campaigns SET
         name        = COALESCE($2, name),
         description = COALESCE($3, description),
         polygon     = COALESCE($4, polygon),
         boost       = COALESCE($5, boost),
         active      = COALESCE($6, active),
         starts_at   = COALESCE($7, starts_at),
         ends_at     = COALESCE($8, ends_at)
       WHERE id = $1 RETURNING *`,
      [
        req.params.id,
        body.name ?? null,
        body.description ?? null,
        body.polygon ? JSON.stringify(body.polygon) : null,
        body.boost ?? null,
        body.active ?? null,
        body.startsAt ?? null,
        body.endsAt ?? null,
      ],
    );
    if (!rows[0]) throw new ApiError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
    void audit(req.user!.id, 'campaign.update', 'campaign', req.params.id, body as Record<string, unknown>);
    ok(res, rowToCampaign(rows[0]));
  }),
);

adminRouter.delete(
  '/campaigns/:id',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'CAMPAIGN_NOT_FOUND', 'Campaign');
    // Samples may reference the campaign; detach them, then delete.
    await query('UPDATE samples SET campaign_id = NULL WHERE campaign_id = $1', [req.params.id]);
    const { rows } = await query('DELETE FROM campaigns WHERE id = $1 RETURNING id', [req.params.id]);
    if (!rows[0]) throw new ApiError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign not found');
    void audit(req.user!.id, 'campaign.delete', 'campaign', req.params.id);
    ok(res, { deleted: true });
  }),
);

/* ------------------------------- packages ------------------------------- */

adminRouter.get(
  '/packages',
  asyncH(async (_req, res) => {
    const { rows } = await query('SELECT * FROM packages ORDER BY code');
    ok(res, rows.map(rowToPackage));
  }),
);

adminRouter.post(
  '/packages',
  asyncH(async (req, res) => {
    const body = z
      .object({
        code: z.string().trim().min(1).max(64).regex(/^[A-Z0-9_]+$/i),
        name: z.string().trim().min(1),
        videoQuota: z.coerce.number().int().positive(),
        photoQuota: z.coerce.number().int().positive(),
        payoutInr: z.coerce.number().int().positive(),
        active: z.boolean().optional(),
        nextPackageCode: z.string().trim().nullish(),
      })
      .parse(req.body ?? {});
    const exists = await query('SELECT code FROM packages WHERE code = $1', [body.code]);
    if (exists.rows[0]) throw new ApiError(409, 'PACKAGE_EXISTS', 'Package code already exists');
    const { rows } = await query(
      `INSERT INTO packages (code, name, video_quota, photo_quota, payout_inr, active, next_package_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [
        body.code,
        body.name,
        body.videoQuota,
        body.photoQuota,
        body.payoutInr,
        body.active ?? true,
        body.nextPackageCode ?? null,
      ],
    );
    void audit(req.user!.id, 'package.create', 'package', body.code);
    ok(res, rowToPackage(rows[0]), 201);
  }),
);

/** PATCH /admin/packages/:code — code immutable; edits affect FUTURE credits only. */
adminRouter.patch(
  '/packages/:code',
  asyncH(async (req, res) => {
    const body = z
      .object({
        name: z.string().trim().min(1).optional(),
        videoQuota: z.coerce.number().int().positive().optional(),
        photoQuota: z.coerce.number().int().positive().optional(),
        payoutInr: z.coerce.number().int().positive().optional(),
        active: z.boolean().optional(),
        nextPackageCode: z.string().trim().nullish(),
      })
      .parse(req.body ?? {});
    if (body.nextPackageCode) {
      const next = await query('SELECT code FROM packages WHERE code = $1', [body.nextPackageCode]);
      if (!next.rows[0]) throw new ApiError(404, 'PACKAGE_NOT_FOUND', 'nextPackageCode does not exist');
    }
    const { rows } = await query(
      `UPDATE packages SET
         name              = COALESCE($2, name),
         video_quota       = COALESCE($3, video_quota),
         photo_quota       = COALESCE($4, photo_quota),
         payout_inr        = COALESCE($5, payout_inr),
         active            = COALESCE($6, active),
         next_package_code = CASE WHEN $8 THEN $7 ELSE next_package_code END
       WHERE code = $1 RETURNING *`,
      [
        req.params.code,
        body.name ?? null,
        body.videoQuota ?? null,
        body.photoQuota ?? null,
        body.payoutInr ?? null,
        body.active ?? null,
        body.nextPackageCode ?? null,
        body.nextPackageCode !== undefined,
      ],
    );
    if (!rows[0]) throw new ApiError(404, 'PACKAGE_NOT_FOUND', 'Package not found');
    void audit(req.user!.id, 'package.update', 'package', req.params.code, body as Record<string, unknown>);
    ok(res, rowToPackage(rows[0]));
  }),
);

/* ------------------------------ audit log ------------------------------- */

adminRouter.get(
  '/audit',
  asyncH(async (req, res) => {
    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        before: z.string().datetime({ offset: true }).optional(),
        action: z.string().trim().optional(),
      })
      .parse({
        limit: req.query.limit ?? 100,
        before: req.query.before,
        action: req.query.action,
      });
    const { rows } = await query(
      `SELECT a.*, u.full_name AS actor_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       WHERE ($2::timestamptz IS NULL OR a.created_at < $2)
         AND ($3::text IS NULL OR a.action = $3)
       ORDER BY a.created_at DESC
       LIMIT $1`,
      [q.limit, q.before ?? null, q.action ?? null],
    );
    ok(res, rows.map(rowToAuditEntry));
  }),
);

/* ----------------------------- road quality ----------------------------- */

/**
 * GET /admin/road-quality — RoadQualityCell[] aggregated over accepted /
 * partially_accepted annotations (map-matched coords preferred).
 *
 * severityIndex formula (documented): each annotation in a ~150 m geohash
 * cell contributes 12 points; 'pothole-cluster' annotations add a further 10
 * (they represent several potholes). Capped at 100.
 */
adminRouter.get(
  '/road-quality',
  asyncH(async (_req, res) => {
    const { rows } = await query<{
      sample_id: string;
      label: string;
      lat: string;
      lng: string;
    }>(
      `SELECT a.sample_id, a.label,
              COALESCE(a.corrected_lat, a.lat) AS lat,
              COALESCE(a.corrected_lng, a.lng) AS lng
       FROM annotations a
       JOIN samples s ON s.id = a.sample_id
       WHERE s.state IN ('accepted', 'partially_accepted') AND a.status <> 'rejected'`,
    );

    const cells = new Map<string, { samples: Set<string>; potholes: number; clusters: number }>();
    for (const r of rows) {
      const gh = geohashEncode(Number(r.lat), Number(r.lng), ROAD_QUALITY_GEO_PRECISION);
      const cell = cells.get(gh) ?? { samples: new Set<string>(), potholes: 0, clusters: 0 };
      cell.samples.add(r.sample_id);
      cell.potholes += 1;
      if (r.label === 'pothole-cluster') cell.clusters += 1;
      cells.set(gh, cell);
    }

    const result: RoadQualityCell[] = [...cells.entries()]
      .map(([geohash, c]) => {
        const { lat, lng } = geohashDecode(geohash);
        return {
          geohash,
          lat: Math.round(lat * 1e6) / 1e6,
          lng: Math.round(lng * 1e6) / 1e6,
          sampleCount: c.samples.size,
          potholeCount: c.potholes,
          severityIndex: Math.min(100, Math.round(c.potholes * 12 + c.clusters * 10)),
        };
      })
      .sort((a, b) => b.severityIndex - a.severityIndex);
    ok(res, result);
  }),
);

/* ------------------------------ map-matching ---------------------------- */

interface OsrmMatchResponse {
  code: string;
  tracepoints: Array<{ location: [number, number] } | null>;
}

/**
 * POST /admin/postprocess/map-match {sampleIds?} — snap video-annotation
 * coordinates to the road network via OSRM. Originals stay untouched;
 * corrections land in corrected_lat/lng with correction_source='osrm'.
 */
adminRouter.post(
  '/postprocess/map-match',
  asyncH(async (req, res) => {
    if (!config.osrmUrl) {
      throw new ApiError(501, 'NOT_CONFIGURED', 'Set OSRM_URL to enable map-matching');
    }
    const body = z
      .object({ sampleIds: z.array(z.string().regex(UUID_RE)).min(1).optional() })
      .parse(req.body ?? {});

    const { rows: samples } = await query(
      `SELECT s.id FROM samples s
       WHERE s.media_type = 'video'
         AND s.state IN ('accepted', 'partially_accepted', 'pending_review')
         AND ($1::uuid[] IS NULL OR s.id = ANY($1))`,
      [body.sampleIds ?? null],
    );

    const results: Array<{ sampleId: string; corrected: number; error?: string }> = [];
    for (const s of samples) {
      const sampleId = s.id as string;
      try {
        const t = await query<{ recording_start_ms: string; points: GpsPoint[] }>(
          'SELECT recording_start_ms, points FROM gps_tracks WHERE sample_id = $1',
          [sampleId],
        );
        if (!t.rows[0] || t.rows[0].points.length < 2) {
          results.push({ sampleId, corrected: 0, error: 'no track' });
          continue;
        }
        const recordingStartMs = Number(t.rows[0].recording_start_ms);
        const pts = [...t.rows[0].points].sort((a, b) => a.t - b.t);
        // OSRM match supports at most ~100 coordinates.
        const stride = Math.max(1, Math.ceil(pts.length / 100));
        const sampled = pts.filter((_, i) => i % stride === 0);

        const coords = sampled.map((p) => `${p.lng},${p.lat}`).join(';');
        const timestamps = sampled.map((p) => Math.round(p.t / 1000)).join(';');
        const url = `${config.osrmUrl.replace(/\/$/, '')}/match/v1/driving/${coords}?timestamps=${timestamps}&geometries=geojson&overview=false`;
        const resp = await fetch(url);
        if (!resp.ok) {
          results.push({ sampleId, corrected: 0, error: `OSRM ${resp.status}` });
          continue;
        }
        const match = (await resp.json()) as OsrmMatchResponse;
        if (match.code !== 'Ok' || !Array.isArray(match.tracepoints)) {
          results.push({ sampleId, corrected: 0, error: `OSRM code ${match.code}` });
          continue;
        }

        // Matched track: snapped tracepoints keep their original timestamps.
        const matchedTrack: GpsPoint[] = [];
        match.tracepoints.forEach((tp, i) => {
          if (!tp || !sampled[i]) return;
          matchedTrack.push({
            t: sampled[i].t,
            lat: tp.location[1],
            lng: tp.location[0],
            acc: 0,
            speedMps: null,
            alt: null,
            mocked: false,
          });
        });
        if (matchedTrack.length < 2) {
          results.push({ sampleId, corrected: 0, error: 'too few matched points' });
          continue;
        }

        const anns = await query<{ id: string; video_time_sec: string | number | null }>(
          `SELECT id, video_time_sec FROM annotations
           WHERE sample_id = $1 AND video_time_sec IS NOT NULL`,
          [sampleId],
        );
        let corrected = 0;
        for (const a of anns.rows) {
          const coord = coordinateAtVideoTime(matchedTrack, recordingStartMs, Number(a.video_time_sec));
          if (!coord) continue;
          await query(
            `UPDATE annotations SET corrected_lat = $2, corrected_lng = $3, correction_source = 'osrm'
             WHERE id = $1`,
            [a.id, coord.lat, coord.lng],
          );
          corrected += 1;
        }
        results.push({ sampleId, corrected });
      } catch (err) {
        results.push({ sampleId, corrected: 0, error: (err as Error).message });
      }
    }

    void audit(req.user!.id, 'postprocess.map-match', 'sample', body.sampleIds?.join(',') ?? 'all', {
      samples: results.length,
      corrected: results.reduce((n, r) => n + r.corrected, 0),
    });
    ok(res, { results });
  }),
);

/* ------------------------------ exports -------------------------------- */

const mediaTypeSchema = z.enum(['photo', 'video', 'all']).default('all');

/** Stream a bundle as a zip; returns the sha256 of the bytes sent. */
async function streamZipBundle(res: Response, filename: string, files: BundleFile[]): Promise<string> {
  res.status(200);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const hash = crypto.createHash('sha256');
  const tap = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      hash.update(chunk);
      cb(null, chunk);
    },
  });

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err) => {
    console.error('[export] archive error:', err);
    res.destroy(err);
  });
  const finished = new Promise<void>((resolve, reject) => {
    tap.on('finish', resolve);
    tap.on('error', reject);
  });
  archive.pipe(tap);
  tap.pipe(res);

  for (const file of files) {
    if (file.kind === 'text') {
      archive.append(file.content, { name: file.name });
    } else {
      const media = await openMediaStream(file.relPath, file.storedOn);
      if (media?.stream) archive.append(media.stream, { name: file.name });
    }
  }
  await archive.finalize();
  await finished;
  return hash.digest('hex');
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
 * NO GPS data anywhere. Split-versioned (train/ val/ test/) with COCO + YOLO
 * labels and extracted video frames. Each export is recorded in
 * dataset_exports with the streamed zip's sha256 (dataset versioning).
 */
adminRouter.get(
  '/export/training.zip',
  asyncH(async (req, res) => {
    const { files, manifest } = await buildTrainingBundle();
    const sha256 = await streamZipBundle(res, `pothole-training-${today()}.zip`, files);
    await query(
      `INSERT INTO dataset_exports
         (created_by, bundle_sha256, sample_count, annotation_count, label_counts, split_counts, samples)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        req.user!.id,
        sha256,
        manifest.sampleCount,
        manifest.annotationCount,
        JSON.stringify(manifest.labelCounts),
        JSON.stringify(manifest.splitCounts),
        JSON.stringify(manifest.samples),
      ],
    );
    void audit(req.user!.id, 'dataset.export', 'dataset', sha256, {
      sampleCount: manifest.sampleCount,
      splitCounts: manifest.splitCounts,
    });
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
    void audit(req.user!.id, 'dataset.export-drive', 'dataset', result.folderId, {
      bundle: body.bundle,
      files: result.files,
    });
    ok(res, result);
  }),
);

/* --------------------------- dataset registry --------------------------- */

/* eslint-disable @typescript-eslint/no-explicit-any */
const rowToManifest = (r: Record<string, any>): DatasetManifest => ({
  id: r.id,
  createdAt: new Date(r.created_at).toISOString(),
  createdBy: r.created_by ?? '',
  bundleSha256: r.bundle_sha256 ?? '',
  sampleCount: Number(r.sample_count),
  annotationCount: Number(r.annotation_count),
  labelCounts: r.label_counts ?? {},
  splitCounts: r.split_counts ?? { train: 0, val: 0, test: 0 },
  samples: r.samples ?? [],
});

/** GET /admin/datasets — training-export history with manifests. */
adminRouter.get(
  '/datasets',
  asyncH(async (_req, res) => {
    const { rows } = await query('SELECT * FROM dataset_exports ORDER BY created_at DESC');
    ok(res, rows.map(rowToManifest));
  }),
);

/** GET /admin/datasets/:id/manifest.json — one export's manifest as a file. */
adminRouter.get(
  '/datasets/:id/manifest.json',
  asyncH(async (req, res) => {
    assertUuid(req.params.id, 'DATASET_NOT_FOUND', 'Dataset export');
    const { rows } = await query('SELECT * FROM dataset_exports WHERE id = $1', [req.params.id]);
    if (!rows[0]) throw new ApiError(404, 'DATASET_NOT_FOUND', 'Dataset export not found');
    const manifest = rowToManifest(rows[0]);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="manifest-${manifest.id}.json"`);
    res.status(200).send(JSON.stringify(manifest, null, 2));
  }),
);
