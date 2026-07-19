import { Router } from 'express';
import { query } from '../db/pool';
import { ApiError, asyncH } from '../http';
import { requireUser } from '../middleware/auth';
import { openMediaStream, type StorageDriverName } from '../services/storage';

export const mediaRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /media/:sampleId — stream the sample's media (owner or admin) from the
 * driver it is stored on (local disk, or S3 GetObject proxy). Supports Range
 * on both backends; S3 ContentRange/206 is passed straight through.
 */
mediaRouter.get(
  '/media/:sampleId',
  requireUser,
  asyncH(async (req, res) => {
    const user = req.user!;
    const id = req.params.sampleId;
    if (!UUID_RE.test(id)) throw new ApiError(404, 'SAMPLE_NOT_FOUND', 'Sample not found');

    const { rows } = await query(
      'SELECT user_id, media_path, media_mime, storage_driver FROM samples WHERE id = $1',
      [id],
    );
    const row = rows[0];
    const isAdmin = user.role === 'admin' || user.role === 'owner';
    if (!row || (row.user_id !== user.id && !isAdmin)) {
      throw new ApiError(404, 'SAMPLE_NOT_FOUND', 'Sample not found');
    }
    const mediaPath = row.media_path as string | null;
    if (!mediaPath) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'No media stored for this sample');

    const storedOn = ((row.storage_driver as string | null) ?? 'local') as StorageDriverName;
    const media = await openMediaStream(mediaPath, storedOn, req.headers.range ?? null);
    if (!media) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Media file missing from storage');

    res.setHeader('Accept-Ranges', 'bytes');
    if (media.status === 416) {
      if (media.contentRange) res.setHeader('Content-Range', media.contentRange);
      res.status(416).end();
      return;
    }
    res.status(media.status);
    res.setHeader('Content-Type', (row.media_mime as string | null) ?? 'application/octet-stream');
    if (media.contentLength != null) res.setHeader('Content-Length', media.contentLength);
    if (media.contentRange) res.setHeader('Content-Range', media.contentRange);
    media.stream?.pipe(res);
  }),
);
