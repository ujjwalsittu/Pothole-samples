import express, { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import {
  DEDUP,
  GPS_RULES,
  SPEED,
  UPLOAD,
  VIDEO_RULES,
  coordinateAtVideoTime,
  hasMockedFix,
  haversineMeters,
  pointInPolygon,
  trackSpeedsKmph,
  type Annotation,
  type GpsPoint,
  type Sample,
} from '@pothole/shared';
import { query, withTransaction } from '../db/pool';
import { rowToAnnotation, rowToSample } from '../db/mappers';
import { ApiError, asyncH, ok } from '../http';
import { requireApproved, requireUser } from '../middleware/auth';
import { makeThumbnail } from '../services/frames';
import { aHashHex, hammingHex } from '../services/phash';
import {
  absPath,
  contentHashOfFile,
  fileSize,
  finalizeSampleMedia,
  sampleRelPath,
  writeChunkAt,
} from '../services/storage';

export const samplesRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const gpsPointSchema = z.object({
  t: z.number(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  acc: z.number(),
  speedMps: z.number().nullable(),
  alt: z.number().nullable(),
  mocked: z.boolean(),
});

const initSchema = z.object({
  mediaType: z.enum(['photo', 'video']),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i, 'sha256 must be 64 hex chars'),
  phash: z
    .string()
    .regex(/^[0-9a-f]{1,32}$/i)
    .nullish(),
  capturedAt: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  gpsAccuracyM: z.number().nonnegative(),
  mockLocationDetected: z.boolean(),
  sizeBytes: z.number().int().positive(),
  mediaMime: z.string().min(1),
  durationSec: z.number().positive().optional(),
  gpsTrack: z
    .object({
      recordingStartMs: z.number(),
      points: z.array(gpsPointSchema),
    })
    .optional(),
});

async function loadSample(id: string): Promise<Record<string, unknown> | null> {
  if (!UUID_RE.test(id)) return null;
  const { rows } = await query('SELECT * FROM samples WHERE id = $1', [id]);
  return rows[0] ?? null;
}

function assertOwn(row: Record<string, unknown> | null, userId: string, allowAdmin = false, isAdmin = false): void {
  if (!row) throw new ApiError(404, 'SAMPLE_NOT_FOUND', 'Sample not found');
  if (row.user_id !== userId && !(allowAdmin && isAdmin)) {
    throw new ApiError(404, 'SAMPLE_NOT_FOUND', 'Sample not found');
  }
}

/**
 * POST /samples/init — validates everything BEFORE any media bytes travel.
 * Typed rejection codes: DUPLICATE_EXACT, DUPLICATE_NEARBY, MOCK_LOCATION,
 * GPS_INACCURATE, VIDEO_TOO_SHORT, SPEED_OUT_OF_RANGE, FILE_TOO_LARGE.
 */
samplesRouter.post(
  '/samples/init',
  requireApproved,
  asyncH(async (req, res) => {
    const user = req.user!;
    const body = initSchema.parse(req.body);
    const points: GpsPoint[] = body.gpsTrack?.points ?? [];

    // 1) DUPLICATE_EXACT — but resume our own still-uploading sample.
    const dup = await query('SELECT * FROM samples WHERE sha256 = $1', [body.sha256.toLowerCase()]);
    if (dup.rows[0]) {
      const existing = dup.rows[0];
      if (existing.user_id === user.id && existing.state === 'uploading') {
        return ok(res, {
          sampleId: existing.id as string,
          chunkBytes: UPLOAD.CHUNK_BYTES,
          receivedBytes: Number(existing.uploaded_bytes),
          resumed: true,
        });
      }
      throw new ApiError(409, 'DUPLICATE_EXACT', 'This exact file has already been uploaded');
    }

    // 2) DUPLICATE_NEARBY — perceptual-hash match within the geo radius.
    if (body.phash) {
      const latDelta = DEDUP.GEO_RADIUS_METERS / 111_320;
      const lngDelta =
        DEDUP.GEO_RADIUS_METERS / (111_320 * Math.max(Math.cos((body.lat * Math.PI) / 180), 1e-6));
      const nearby = await query<{ id: string; phash: string; lat: number; lng: number }>(
        `SELECT id, phash, lat, lng FROM samples
         WHERE phash IS NOT NULL
           AND lat BETWEEN $1 AND $2
           AND lng BETWEEN $3 AND $4`,
        [body.lat - latDelta, body.lat + latDelta, body.lng - lngDelta, body.lng + lngDelta],
      );
      for (const cand of nearby.rows) {
        const within =
          haversineMeters(body.lat, body.lng, Number(cand.lat), Number(cand.lng)) <= DEDUP.GEO_RADIUS_METERS;
        if (within && hammingHex(body.phash, cand.phash) <= DEDUP.PHASH_HAMMING_THRESHOLD) {
          throw new ApiError(
            409,
            'DUPLICATE_NEARBY',
            'A very similar sample already exists at this location',
          );
        }
      }
    }

    // 3) MOCK_LOCATION
    if (body.mockLocationDetected || hasMockedFix(points)) {
      throw new ApiError(422, 'MOCK_LOCATION', 'Mock/simulated GPS locations are not allowed');
    }

    // 4) GPS_INACCURATE
    if (body.gpsAccuracyM > GPS_RULES.MAX_ACCURACY_METERS) {
      throw new ApiError(
        422,
        'GPS_INACCURATE',
        `GPS accuracy must be within ${GPS_RULES.MAX_ACCURACY_METERS} m (got ${body.gpsAccuracyM.toFixed(1)} m)`,
      );
    }

    let avgSpeedKmph: number | null = null;
    let maxSpeedKmph: number | null = null;

    if (body.mediaType === 'video') {
      // 5) VIDEO_TOO_SHORT
      if (body.durationSec == null || body.durationSec < VIDEO_RULES.MIN_DURATION_SECONDS) {
        throw new ApiError(
          422,
          'VIDEO_TOO_SHORT',
          `Video must be at least ${VIDEO_RULES.MIN_DURATION_SECONDS} seconds long`,
        );
      }
      if (!body.gpsTrack || points.length < 2) {
        throw new ApiError(422, 'TRACK_REQUIRED', 'A GPS track is required for video samples');
      }
      // 6) SPEED_OUT_OF_RANGE — there is NO minimum speed; only exceeding the
      // real cap (SPEED.MAX_KMPH) rejects. The user is only ever told "60
      // km/h" — never reveal the real upper bound.
      const speeds = trackSpeedsKmph(points);
      avgSpeedKmph = speeds.avg;
      maxSpeedKmph = speeds.max;
      if (speeds.max > SPEED.MAX_KMPH) {
        throw new ApiError(
          422,
          'SPEED_OUT_OF_RANGE',
          `Speed must stay at or below ${SPEED.DISPLAYED_CAP_KMPH} km/h while recording. Please record again.`,
        );
      }
    }

    // 7) FILE_TOO_LARGE
    const maxBytes = body.mediaType === 'photo' ? UPLOAD.MAX_PHOTO_BYTES : UPLOAD.MAX_VIDEO_BYTES;
    if (body.sizeBytes > maxBytes) {
      throw new ApiError(
        413,
        'FILE_TOO_LARGE',
        `File exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB limit for ${body.mediaType}s`,
      );
    }

    const id = uuidv4();
    const mediaPath = sampleRelPath(id, body.mediaMime);

    // Campaign boost: capture point inside an active campaign zone (within
    // its date window) records campaign_id + boost multiplier on the sample.
    let campaignId: string | null = null;
    let boostApplied: number | null = null;
    const campaigns = await query(
      `SELECT id, polygon, boost FROM campaigns
       WHERE active = true
         AND (starts_at IS NULL OR starts_at <= now())
         AND (ends_at IS NULL OR ends_at >= now())`,
    );
    for (const c of campaigns.rows) {
      const polygon = (c.polygon ?? []) as Array<{ lat: number; lng: number }>;
      if (polygon.length >= 3 && pointInPolygon(body.lat, body.lng, polygon)) {
        campaignId = c.id as string;
        boostApplied = Number(c.boost);
        break;
      }
    }

    await withTransaction(async (client) => {
      await client.query(
        `INSERT INTO samples
           (id, user_id, media_type, state, sha256, phash, captured_at, duration_sec,
            avg_speed_kmph, max_speed_kmph, lat, lng, gps_accuracy_m, mock_location_detected,
            media_path, media_mime, size_bytes, uploaded_bytes, campaign_id, boost_applied)
         VALUES ($1,$2,$3,'uploading',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,0,$17,$18)`,
        [
          id,
          user.id,
          body.mediaType,
          body.sha256.toLowerCase(),
          body.phash?.toLowerCase() ?? null,
          body.capturedAt,
          body.durationSec ?? null,
          avgSpeedKmph,
          maxSpeedKmph,
          body.lat,
          body.lng,
          body.gpsAccuracyM,
          body.mockLocationDetected,
          mediaPath,
          body.mediaMime,
          body.sizeBytes,
          campaignId,
          boostApplied,
        ],
      );
      if (body.gpsTrack) {
        await client.query(
          `INSERT INTO gps_tracks (sample_id, recording_start_ms, points) VALUES ($1, $2, $3)`,
          [id, body.gpsTrack.recordingStartMs, JSON.stringify(points)],
        );
      }
    });

    ok(res, { sampleId: id, chunkBytes: UPLOAD.CHUNK_BYTES, receivedBytes: 0 }, 201);
  }),
);

/**
 * PUT /samples/:id/chunks/:index — raw chunk body written at
 * index * CHUNK_BYTES. Idempotent per chunk (re-writes are harmless).
 */
samplesRouter.put(
  '/samples/:id/chunks/:index',
  requireApproved,
  express.raw({ type: () => true, limit: '2mb' }),
  asyncH(async (req, res) => {
    const user = req.user!;
    const row = await loadSample(req.params.id);
    assertOwn(row, user.id);
    if (row!.state !== 'uploading') {
      throw new ApiError(409, 'UPLOAD_ALREADY_COMPLETE', `Sample is in state ${row!.state}`);
    }

    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0) {
      throw new ApiError(400, 'INVALID_CHUNK_INDEX', 'Chunk index must be a non-negative integer');
    }
    const chunk = req.body as Buffer;
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
      throw new ApiError(400, 'EMPTY_CHUNK', 'Chunk body is empty');
    }

    const offset = index * UPLOAD.CHUNK_BYTES;
    const sizeBytes = Number(row!.size_bytes);
    if (offset + chunk.length > sizeBytes) {
      throw new ApiError(400, 'CHUNK_OUT_OF_RANGE', 'Chunk extends past the declared file size');
    }

    await writeChunkAt(row!.media_path as string, offset, chunk);
    const { rows } = await query<{ uploaded_bytes: string }>(
      `UPDATE samples SET uploaded_bytes = GREATEST(uploaded_bytes, $2) WHERE id = $1 RETURNING uploaded_bytes`,
      [row!.id, offset + chunk.length],
    );

    ok(res, {
      sampleId: row!.id,
      chunkBytes: UPLOAD.CHUNK_BYTES,
      receivedBytes: Number(rows[0].uploaded_bytes),
    });
  }),
);

/**
 * POST /samples/:id/complete — verify size + sha256, recompute the photo
 * phash server-side (authoritative), then move to uploaded/pending_review.
 */
samplesRouter.post(
  '/samples/:id/complete',
  requireApproved,
  asyncH(async (req, res) => {
    const user = req.user!;
    const row = await loadSample(req.params.id);
    assertOwn(row, user.id);

    // Idempotent for already-finished uploads.
    if (['uploaded', 'pending_review', 'accepted'].includes(row!.state as string)) {
      return ok(res, rowToSample(row!));
    }
    if (row!.state !== 'uploading') {
      throw new ApiError(409, 'SAMPLE_REJECTED', `Sample is in state ${row!.state}`);
    }

    const mediaPath = row!.media_path as string;
    const expectedSize = Number(row!.size_bytes);
    const actualSize = await fileSize(mediaPath);
    if (actualSize == null || actualSize !== expectedSize) {
      throw new ApiError(
        400,
        'UPLOAD_INCOMPLETE',
        `Expected ${expectedSize} bytes but have ${actualSize ?? 0} — upload the missing chunks first`,
      );
    }

    // Must mirror the mobile client's base64/composite scheme — see
    // contentHashOfFile. A raw-byte sha256 would never match what clients send.
    const digest = await contentHashOfFile(mediaPath);

    if (digest.toLowerCase() !== (row!.sha256 as string).toLowerCase()) {
      await query(
        `UPDATE samples SET state = 'auto_rejected', rejection_reason = $2 WHERE id = $1`,
        [row!.id, 'Uploaded file failed integrity check (sha256 mismatch)'],
      );
      throw new ApiError(422, 'CHECKSUM_MISMATCH', 'Uploaded bytes do not match the declared sha256');
    }

    // Server-side perceptual hash for photos is authoritative; replace the
    // client value when we can compute one (sharp may be unavailable). Must
    // run BEFORE the file is promoted off local staging disk.
    let phash = (row!.phash as string | null) ?? null;
    if (row!.media_type === 'photo') {
      const serverHash = await aHashHex(absPath(mediaPath));
      if (serverHash) phash = serverHash;
    }

    // Thumbnail (video poster @1s via ffmpeg / 480px photo thumb via sharp)
    // must be generated while the media is still on local staging disk.
    await makeThumbnail(row!.id as string, mediaPath, row!.media_type as 'photo' | 'video');

    // Promote assembled media to the active storage driver (multipart upload
    // to S3 + delete local staging copy when STORAGE_DRIVER=s3).
    const storedOn = await finalizeSampleMedia(mediaPath, row!.media_mime as string | null);

    const annCount = await query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM annotations WHERE sample_id = $1 AND status <> 'rejected'`,
      [row!.id],
    );
    const n = Number(annCount.rows[0].n);
    const required = row!.media_type === 'video' ? VIDEO_RULES.MIN_POTHOLES : 1;
    const nextState = n >= required ? 'pending_review' : 'uploaded';

    const { rows } = await query(
      `UPDATE samples SET state = $2, phash = $3, pothole_count = $4, storage_driver = $5
       WHERE id = $1 RETURNING *`,
      [row!.id, nextState, phash, n, storedOn],
    );
    ok(res, rowToSample(rows[0]));
  }),
);

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

const annotationsSchema = z
  .array(
    z.object({
      label: z.string().trim().min(1),
      polygon: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(3),
      videoTimeSec: z.number().nonnegative().nullish(),
      estimate: estimateSchema.nullish(),
    }),
  )
  .min(1);

/**
 * POST /samples/:id/annotations — replaces the sample's annotation set.
 * Video annotation coordinates are ALWAYS recomputed server-side from the GPS
 * track via coordinateAtVideoTime (client-sent coordinates are ignored).
 */
samplesRouter.post(
  '/samples/:id/annotations',
  requireApproved,
  asyncH(async (req, res) => {
    const user = req.user!;
    const row = await loadSample(req.params.id);
    assertOwn(row, user.id);
    if (!['uploading', 'uploaded', 'pending_review'].includes(row!.state as string)) {
      throw new ApiError(409, 'SAMPLE_LOCKED', `Sample in state ${row!.state} can no longer be annotated`);
    }

    const anns = annotationsSchema.parse(req.body);
    const isVideo = row!.media_type === 'video';

    let track: GpsPoint[] = [];
    let recordingStartMs = 0;
    if (isVideo) {
      const t = await query<{ recording_start_ms: string; points: GpsPoint[] }>(
        'SELECT recording_start_ms, points FROM gps_tracks WHERE sample_id = $1',
        [row!.id],
      );
      if (!t.rows[0]) throw new ApiError(422, 'TRACK_REQUIRED', 'This video sample has no GPS track');
      track = t.rows[0].points;
      recordingStartMs = Number(t.rows[0].recording_start_ms);
    }

    const resolved = anns.map((a) => {
      let lat = Number(row!.lat);
      let lng = Number(row!.lng);
      if (isVideo) {
        if (a.videoTimeSec == null) {
          throw new ApiError(400, 'VIDEO_TIME_REQUIRED', 'videoTimeSec is required for video annotations');
        }
        const coord = coordinateAtVideoTime(track, recordingStartMs, a.videoTimeSec);
        if (!coord) throw new ApiError(422, 'TRACK_REQUIRED', 'GPS track is empty');
        lat = coord.lat;
        lng = coord.lng;
      }
      return { ...a, lat, lng };
    });

    const result = await withTransaction(async (client) => {
      await client.query('DELETE FROM annotations WHERE sample_id = $1', [row!.id]);
      const inserted: Annotation[] = [];
      for (const a of resolved) {
        const r = await client.query(
          `INSERT INTO annotations (sample_id, label, polygon, video_time_sec, lat, lng, estimate)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [
            row!.id,
            a.label,
            JSON.stringify(a.polygon),
            isVideo ? a.videoTimeSec : null,
            a.lat,
            a.lng,
            a.estimate ? JSON.stringify(a.estimate) : null,
          ],
        );
        inserted.push(rowToAnnotation(r.rows[0]));
      }

      const n = resolved.length;
      const meetsMin = isVideo ? n >= VIDEO_RULES.MIN_POTHOLES : n >= 1;
      const fileDone = row!.state !== 'uploading';
      const nextState = fileDone ? (meetsMin ? 'pending_review' : 'uploaded') : row!.state;

      const upd = await client.query(
        `UPDATE samples SET pothole_count = $2, state = $3 WHERE id = $1 RETURNING *`,
        [row!.id, n, nextState],
      );
      return { sample: rowToSample(upd.rows[0]), annotations: inserted, meetsMin };
    });

    const payload: {
      sample: Sample;
      annotations: Annotation[];
      warning?: { code: string; message: string };
    } = { sample: result.sample, annotations: result.annotations };

    if (isVideo && !result.meetsMin) {
      payload.warning = {
        code: 'NEED_MORE_POTHOLES',
        message: `Video samples need at least ${VIDEO_RULES.MIN_POTHOLES} annotated potholes`,
      };
    }
    ok(res, payload);
  }),
);

/** GET /samples — own samples, optional ?state= filter, newest first. */
samplesRouter.get(
  '/samples',
  requireUser,
  asyncH(async (req, res) => {
    const state = typeof req.query.state === 'string' ? req.query.state : null;
    const { rows } = await query(
      `SELECT * FROM samples
       WHERE user_id = $1 AND ($2::text IS NULL OR state = $2)
       ORDER BY created_at DESC`,
      [req.user!.id, state],
    );
    ok(res, rows.map(rowToSample));
  }),
);

/** GET /samples/:id — own or admin; includes annotations and GPS track. */
samplesRouter.get(
  '/samples/:id',
  requireUser,
  asyncH(async (req, res) => {
    const user = req.user!;
    const isAdmin = user.role === 'admin' || user.role === 'owner';
    const row = await loadSample(req.params.id);
    assertOwn(row, user.id, true, isAdmin);

    const [anns, track] = await Promise.all([
      query('SELECT * FROM annotations WHERE sample_id = $1 ORDER BY created_at', [row!.id]),
      query('SELECT recording_start_ms, points FROM gps_tracks WHERE sample_id = $1', [row!.id]),
    ]);
    ok(res, {
      sample: rowToSample(row!),
      annotations: anns.rows.map(rowToAnnotation),
      gpsTrack: track.rows[0]
        ? { recordingStartMs: Number(track.rows[0].recording_start_ms), points: track.rows[0].points }
        : null,
    });
  }),
);
