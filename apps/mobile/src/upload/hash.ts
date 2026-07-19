/**
 * File hashing with expo-crypto + expo-file-system.
 *
 * expo-crypto has no incremental/streaming digest, so hashing is done over
 * the base64 representation read via FileSystem:
 *  - files that fit in one chunk: sha256(base64(file))
 *  - larger files: sha256 of the concatenated per-chunk sha256 digests
 *    ("rolling composite"), keeping memory bounded on 500 MB videos.
 * The API server implements the same scheme for integrity verification
 * (metadata includes sizeBytes + totalChunks so it knows the chunking).
 */
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import { UPLOAD } from '@/shared';

const HASH_CHUNK_BYTES = 4 * UPLOAD.CHUNK_BYTES; // 4 MB per read

export async function fileSize(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri, { size: true });
  if (!info.exists) throw new Error(`File not found: ${uri}`);
  return info.size ?? 0;
}

/** Reads a byte range of a file as base64. */
export async function readChunkBase64(uri: string, position: number, length: number): Promise<string> {
  return FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
    position,
    length,
  });
}

export async function sha256OfFile(uri: string): Promise<string> {
  const size = await fileSize(uri);
  if (size <= HASH_CHUNK_BYTES) {
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, b64);
  }
  const chunkDigests: string[] = [];
  for (let pos = 0; pos < size; pos += HASH_CHUNK_BYTES) {
    const len = Math.min(HASH_CHUNK_BYTES, size - pos);
    const b64 = await readChunkBase64(uri, pos, len);
    chunkDigests.push(await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, b64));
  }
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, chunkDigests.join(''));
}
