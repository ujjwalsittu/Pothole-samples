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
