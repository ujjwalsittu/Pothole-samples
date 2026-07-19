/**
 * Collector-facing OTA model distribution: the app polls /models/latest and
 * downloads the active TFLite release when the sha256 changes.
 */
import { Router } from 'express';
import { query } from '../db/pool';
import { rowToModelRelease } from '../db/mappers';
import { ApiError, asyncH, ok } from '../http';
import { requireUser } from '../middleware/auth';
import { findStored } from '../services/exporter';
import { openMediaStream } from '../services/storage';

export const modelsRouter = Router();

export const modelRelPath = (version: number): string => `models/${version}.tflite`;

modelsRouter.get(
  '/models/latest',
  requireUser,
  asyncH(async (_req, res) => {
    const { rows } = await query('SELECT * FROM model_releases WHERE active = true ORDER BY version DESC LIMIT 1');
    if (!rows[0]) throw new ApiError(404, 'NO_MODEL', 'No model release has been published yet');
    const release = rowToModelRelease(rows[0]);
    ok(res, {
      version: release.version,
      kind: release.kind,
      sha256: release.sha256,
      sizeBytes: release.sizeBytes,
      notes: release.notes,
      url: '/api/v1/models/latest/file',
    });
  }),
);

modelsRouter.get(
  '/models/latest/file',
  requireUser,
  asyncH(async (_req, res) => {
    const { rows } = await query('SELECT * FROM model_releases WHERE active = true ORDER BY version DESC LIMIT 1');
    if (!rows[0]) throw new ApiError(404, 'NO_MODEL', 'No model release has been published yet');
    const release = rowToModelRelease(rows[0]);
    const rel = modelRelPath(release.version);
    const storedOn = await findStored(rel);
    const media = storedOn ? await openMediaStream(rel, storedOn) : null;
    if (!media?.stream) throw new ApiError(404, 'MODEL_FILE_MISSING', 'Model file missing from storage');
    res.status(200);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${release.filename}"`);
    if (media.contentLength != null) res.setHeader('Content-Length', media.contentLength);
    media.stream.pipe(res);
  }),
);
