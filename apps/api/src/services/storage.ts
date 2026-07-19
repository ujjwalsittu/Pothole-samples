import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';

/** File-system storage rooted at STORAGE_DIR. All DB paths are relative to it. */

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

export async function saveBuffer(relPath: string, buf: Buffer): Promise<string> {
  const abs = absPath(relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf);
  return relPath;
}

/** Write a chunk at a byte offset, creating/extending the file as needed. */
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

/**
 * Content hash matching the mobile client's scheme (apps/mobile/src/upload/hash.ts).
 * expo-crypto cannot stream, so the client hashes the base64 representation:
 *  - size <= 4 MB: sha256(base64(fileBytes))
 *  - larger:       sha256(concat(sha256hex(base64(chunk_i)))) over 4 MB raw chunks
 * All digests are lowercase hex. This — not a raw-byte sha256 — is the value
 * stored in samples.sha256 and used for integrity + exact-dup checks.
 */
const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

export async function contentHashOfFile(relPath: string): Promise<string> {
  const crypto = await import('node:crypto');
  const abs = absPath(relPath);
  const { size } = await fsp.stat(abs);
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
