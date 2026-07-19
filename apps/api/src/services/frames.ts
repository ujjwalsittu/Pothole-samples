/**
 * Video frame extraction + thumbnails (feature 2).
 *
 * Uses the system `ffmpeg` binary via child_process — no npm dependency.
 * When ffmpeg is missing everything degrades to a logged no-op.
 *
 * Outputs (all promoted through the storage driver like other media):
 *  - thumbs/<sampleId>.jpg                poster (videos, t=1s) or 480px photo thumb
 *  - frames/<sampleId>/<annotationId>.jpg frame at each accepted annotation's
 *                                         videoTimeSec (extracted on review
 *                                         acceptance of a video sample)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { query } from '../db/pool';
import { getSharp } from './phash';
import {
  absPath,
  finalizeSampleMedia,
  openMediaStream,
  type StorageDriverName,
} from './storage';

let ffmpegAvailable: Promise<boolean> | undefined;

export function hasFfmpeg(): Promise<boolean> {
  if (!ffmpegAvailable) {
    ffmpegAvailable = new Promise((resolve) => {
      try {
        const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
        p.on('error', () => {
          console.warn('[frames] ffmpeg not found — frame extraction disabled');
          resolve(false);
        });
        p.on('exit', (code) => resolve(code === 0));
      } catch {
        resolve(false);
      }
    });
  }
  return ffmpegAvailable;
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    p.stderr.on('data', (d) => {
      stderr += String(d);
    });
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
  });
}

export const thumbRelPath = (sampleId: string): string => `thumbs/${sampleId}.jpg`;
export const frameRelPath = (sampleId: string, annotationId: string): string =>
  `frames/${sampleId}/${annotationId}.jpg`;

/**
 * Ensure a local copy of stored media exists for processing. Returns the
 * absolute path plus a cleanup fn (removes the temp copy when it was fetched
 * from S3).
 */
async function ensureLocalMedia(
  relPath: string,
  storedOn: StorageDriverName,
): Promise<{ abs: string; cleanup: () => Promise<void> } | null> {
  const abs = absPath(relPath);
  if (fs.existsSync(abs)) return { abs, cleanup: async () => undefined };
  if (storedOn !== 's3') return null;
  const media = await openMediaStream(relPath, 's3');
  if (!media?.stream) return null;
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(abs);
    media.stream!.pipe(out);
    out.on('finish', () => resolve());
    out.on('error', reject);
    media.stream!.on('error', reject);
  });
  return { abs, cleanup: () => fsp.unlink(abs).catch(() => undefined) };
}

async function extractJpegFrame(videoAbs: string, timeSec: number, outRel: string): Promise<void> {
  const outAbs = absPath(outRel);
  await fsp.mkdir(path.dirname(outAbs), { recursive: true });
  await runFfmpeg([
    '-ss',
    String(Math.max(0, timeSec)),
    '-i',
    videoAbs,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    '-y',
    outAbs,
  ]);
  await finalizeSampleMedia(outRel, 'image/jpeg');
}

/**
 * Complete-time thumbnail: video poster at t=1s (ffmpeg) or 480px photo thumb
 * (sharp). Call while the media is still on local staging disk. No-op when
 * the needed tool is unavailable.
 */
export async function makeThumbnail(
  sampleId: string,
  mediaRelPath: string,
  mediaType: 'photo' | 'video',
): Promise<void> {
  try {
    const mediaAbs = absPath(mediaRelPath);
    if (!fs.existsSync(mediaAbs)) return;
    if (mediaType === 'video') {
      if (!(await hasFfmpeg())) return;
      await extractJpegFrame(mediaAbs, 1, thumbRelPath(sampleId));
    } else {
      const sharp = await getSharp();
      if (!sharp) return;
      const outRel = thumbRelPath(sampleId);
      const outAbs = absPath(outRel);
      await fsp.mkdir(path.dirname(outAbs), { recursive: true });
      await sharp(mediaAbs).rotate().resize(480, 480, { fit: 'inside' }).jpeg({ quality: 80 }).toFile(outAbs);
      await finalizeSampleMedia(outRel, 'image/jpeg');
    }
  } catch (err) {
    console.warn(`[frames] thumbnail failed for ${sampleId}:`, (err as Error).message);
  }
}

/**
 * Review-acceptance hook for VIDEO samples: extract the frame at each
 * accepted annotation's videoTimeSec. Fire-and-forget; every failure is
 * logged, never thrown.
 */
export async function extractAcceptedFrames(sampleId: string): Promise<void> {
  try {
    if (!(await hasFfmpeg())) return;
    const s = await query(
      `SELECT media_type, media_path, storage_driver FROM samples WHERE id = $1`,
      [sampleId],
    );
    const sample = s.rows[0];
    if (!sample || sample.media_type !== 'video' || !sample.media_path) return;

    const anns = await query<{ id: string; video_time_sec: string | number | null }>(
      `SELECT id, video_time_sec FROM annotations
       WHERE sample_id = $1 AND status = 'accepted' AND video_time_sec IS NOT NULL`,
      [sampleId],
    );
    if (anns.rows.length === 0) return;

    const local = await ensureLocalMedia(
      sample.media_path as string,
      ((sample.storage_driver as string | null) ?? 'local') as StorageDriverName,
    );
    if (!local) {
      console.warn(`[frames] media unavailable for ${sampleId}`);
      return;
    }
    try {
      for (const a of anns.rows) {
        await extractJpegFrame(local.abs, Number(a.video_time_sec), frameRelPath(sampleId, a.id));
      }
      console.log(`[frames] extracted ${anns.rows.length} frame(s) for ${sampleId}`);
    } finally {
      await local.cleanup();
    }
  } catch (err) {
    console.warn(`[frames] extraction failed for ${sampleId}:`, (err as Error).message);
  }
}
