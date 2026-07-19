import { Router } from 'express';
import { query } from '../db/pool';
import { ApiError, asyncH } from '../http';
import { requireUser } from '../middleware/auth';
import { fileSize, readStream } from '../services/storage';

export const mediaRouter = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /media/:sampleId — stream the sample's media (owner or admin). Supports Range. */
mediaRouter.get(
  '/media/:sampleId',
  requireUser,
  asyncH(async (req, res) => {
    const user = req.user!;
    const id = req.params.sampleId;
    if (!UUID_RE.test(id)) throw new ApiError(404, 'SAMPLE_NOT_FOUND', 'Sample not found');

    const { rows } = await query(
      'SELECT user_id, media_path, media_mime FROM samples WHERE id = $1',
      [id],
    );
    const row = rows[0];
    const isAdmin = user.role === 'admin' || user.role === 'owner';
    if (!row || (row.user_id !== user.id && !isAdmin)) {
      throw new ApiError(404, 'SAMPLE_NOT_FOUND', 'Sample not found');
    }
    const mediaPath = row.media_path as string | null;
    if (!mediaPath) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'No media stored for this sample');
    const size = await fileSize(mediaPath);
    if (size == null) throw new ApiError(404, 'MEDIA_NOT_FOUND', 'Media file missing on disk');

    const mime = (row.media_mime as string | null) ?? 'application/octet-stream';
    res.setHeader('Accept-Ranges', 'bytes');

    const range = req.headers.range;
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
    if (match && (match[1] || match[2])) {
      const start = match[1] ? parseInt(match[1], 10) : Math.max(0, size - parseInt(match[2], 10));
      const end = match[1] && match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
        return;
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      res.setHeader('Content-Type', mime);
      readStream(mediaPath, { start, end }).pipe(res);
      return;
    }

    res.setHeader('Content-Length', size);
    res.setHeader('Content-Type', mime);
    readStream(mediaPath).pipe(res);
  }),
);
