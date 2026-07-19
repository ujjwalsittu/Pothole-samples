/**
 * Media storage with a pluggable driver (STORAGE_DRIVER=local|s3).
 *
 * Resumable chunk uploads always assemble on LOCAL staging disk (that part is
 * inherently local). After checksum verification, `finalizeSampleMedia`
 * promotes the assembled file to the active driver (multipart upload to S3 via
 * lib-storage, then the local staging copy is deleted). Small files (profile
 * photos, settlement proofs) go straight through the driver.
 *
 * Every sample records where its media lives (samples.storage_driver), so
 * reads always target the right backend even after switching drivers.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { UPLOAD } from '@pothole/shared';
import { config } from '../config';

export type StorageDriverName = 'local' | 's3';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
};

export function extForMime(mime: string | null | undefined): string {
  return (mime && EXT_BY_MIME[mime.toLowerCase()]) || 'bin';
}

export function activeDriver(): StorageDriverName {
  return config.storageDriver;
}

/* ----------------------------- local disk ------------------------------ */

export function absPath(relPath: string): string {
  const abs = path.resolve(config.storageDir, relPath);
  if (!abs.startsWith(config.storageDir)) throw new Error('Path escapes storage dir');
  return abs;
}

export async function ensureStorageDirs(): Promise<void> {
  for (const d of ['samples', 'profiles', 'proofs']) {
    await fsp.mkdir(path.join(config.storageDir, d), { recursive: true });
  }
}

export function sampleRelPath(sampleId: string, mime: string): string {
  return path.posix.join('samples', `${sampleId}.${extForMime(mime)}`);
}

/** Write a chunk at a byte offset on LOCAL staging disk (always local). */
export async function writeChunkAt(relPath: string, offset: number, chunk: Buffer): Promise<void> {
  const abs = absPath(relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const fh = await fsp.open(abs, fs.existsSync(abs) ? 'r+' : 'w');
  try {
    await fh.write(chunk, 0, chunk.length, offset);
  } finally {
    await fh.close();
  }
}

/** Size of the LOCAL staging file (null if absent). */
export async function fileSize(relPath: string): Promise<number | null> {
  try {
    const st = await fsp.stat(absPath(relPath));
    return st.size;
  } catch {
    return null;
  }
}

export function fileExists(relPath: string): boolean {
  try {
    return fs.existsSync(absPath(relPath));
  } catch {
    return false;
  }
}

export function readStream(relPath: string, opts?: { start?: number; end?: number }): fs.ReadStream {
  return fs.createReadStream(absPath(relPath), opts);
}

/* --------------------------- content hashing ---------------------------- */

/**
 * Content hash of a LOCAL staging file, mirroring the mobile client
 * (apps/mobile/src/upload/hash.ts) exactly — expo-crypto has no streaming
 * digest, so clients hash the base64 representation:
 *  - size <= 4 MB:  sha256(base64(fileBytes))
 *  - larger files:  sha256(concat(per-4MB-chunk sha256(base64(chunkBytes))
 *                   hex digests)) — "rolling composite"
 * All digests are lowercase hex. Chunking is deterministic (4 x CHUNK_BYTES),
 * so both sides always agree.
 */
const HASH_CHUNK_BYTES = 4 * UPLOAD.CHUNK_BYTES; // must mirror the mobile client

export async function contentHashOfFile(relPath: string): Promise<string> {
  const abs = absPath(relPath);
  const size = (await fsp.stat(abs)).size;
  const sha256Hex = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  const fh = await fsp.open(abs, 'r');
  try {
    if (size <= HASH_CHUNK_BYTES) {
      const buf = Buffer.alloc(size);
      await fh.read(buf, 0, size, 0);
      return sha256Hex(buf.toString('base64'));
    }
    const chunkDigests: string[] = [];
    for (let pos = 0; pos < size; pos += HASH_CHUNK_BYTES) {
      const len = Math.min(HASH_CHUNK_BYTES, size - pos);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, pos);
      chunkDigests.push(sha256Hex(buf.toString('base64')));
    }
    return sha256Hex(chunkDigests.join(''));
  } finally {
    await fh.close();
  }
}

/* -------------------------------- s3 ----------------------------------- */

type S3Module = typeof import('@aws-sdk/client-s3');

let s3ClientPromise:
  | Promise<{ mod: S3Module; client: import('@aws-sdk/client-s3').S3Client }>
  | undefined;

function getS3(): Promise<{ mod: S3Module; client: import('@aws-sdk/client-s3').S3Client }> {
  if (!s3ClientPromise) {
    s3ClientPromise = (async () => {
      const mod = await import('@aws-sdk/client-s3');
      const client = new mod.S3Client({
        region: config.s3Region,
        ...(config.s3Endpoint ? { endpoint: config.s3Endpoint, forcePathStyle: true } : {}),
      });
      return { mod, client };
    })();
  }
  return s3ClientPromise;
}

function requireBucket(): string {
  if (!config.s3Bucket) throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET');
  return config.s3Bucket;
}

/* --------------------------- driver operations -------------------------- */

/** Save a small buffer via the active driver. Returns where it was stored. */
export async function saveBuffer(relPath: string, buf: Buffer): Promise<StorageDriverName> {
  if (config.storageDriver === 's3') {
    const { mod, client } = await getS3();
    await client.send(
      new mod.PutObjectCommand({ Bucket: requireBucket(), Key: relPath, Body: buf }),
    );
    return 's3';
  }
  const abs = absPath(relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf);
  return 'local';
}

/**
 * Promote an assembled sample file from local staging to the active driver.
 * For s3: multipart upload via @aws-sdk/lib-storage, then delete the local
 * staging copy. Returns the driver the media now lives on.
 */
export async function finalizeSampleMedia(
  relPath: string,
  mime: string | null,
): Promise<StorageDriverName> {
  if (config.storageDriver !== 's3') return 'local';
  const { client } = await getS3();
  const { Upload } = await import('@aws-sdk/lib-storage');
  const upload = new Upload({
    client,
    params: {
      Bucket: requireBucket(),
      Key: relPath,
      Body: fs.createReadStream(absPath(relPath)),
      ...(mime ? { ContentType: mime } : {}),
    },
    queueSize: 3,
    partSize: 8 * 1024 * 1024,
  });
  await upload.done();
  await fsp.unlink(absPath(relPath)).catch(() => undefined);
  return 's3';
}

export interface MediaStream {
  status: 200 | 206 | 416;
  stream: Readable | null;
  contentLength: number | null;
  contentRange: string | null;
}

/**
 * Open a read stream for stored media on the given driver, honoring an
 * optional HTTP Range header value (e.g. "bytes=0-99").
 */
export async function openMediaStream(
  relPath: string,
  storedOn: StorageDriverName,
  rangeHeader?: string | null,
): Promise<MediaStream | null> {
  if (storedOn === 's3') {
    const { mod, client } = await getS3();
    try {
      const res = await client.send(
        new mod.GetObjectCommand({
          Bucket: requireBucket(),
          Key: relPath,
          ...(rangeHeader ? { Range: rangeHeader } : {}),
        }),
      );
      return {
        status: res.ContentRange ? 206 : 200,
        stream: res.Body as unknown as Readable,
        contentLength: res.ContentLength ?? null,
        contentRange: res.ContentRange ?? null,
      };
    } catch (err) {
      const name = (err as Error).name;
      if (name === 'NoSuchKey' || name === 'NotFound') return null;
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 416) {
        return { status: 416, stream: null, contentLength: null, contentRange: null };
      }
      throw err;
    }
  }

  const size = await fileSize(relPath);
  if (size == null) return null;
  const match = rangeHeader ? /^bytes=(\d*)-(\d*)$/.exec(rangeHeader) : null;
  if (match && (match[1] || match[2])) {
    const start = match[1] ? parseInt(match[1], 10) : Math.max(0, size - parseInt(match[2], 10));
    const end = match[1] && match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
    if (start >= size || start > end) {
      return { status: 416, stream: null, contentLength: null, contentRange: `bytes */${size}` };
    }
    return {
      status: 206,
      stream: readStream(relPath, { start, end }),
      contentLength: end - start + 1,
      contentRange: `bytes ${start}-${end}/${size}`,
    };
  }
  return { status: 200, stream: readStream(relPath), contentLength: size, contentRange: null };
}

/** Whether media exists on the given driver (cheap head/stat). */
export async function mediaExists(relPath: string, storedOn: StorageDriverName): Promise<boolean> {
  if (storedOn === 's3') {
    const { mod, client } = await getS3();
    try {
      await client.send(new mod.HeadObjectCommand({ Bucket: requireBucket(), Key: relPath }));
      return true;
    } catch {
      return false;
    }
  }
  return fileExists(relPath);
}
