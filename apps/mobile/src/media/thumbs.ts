/**
 * Authenticated sample thumbnails with a local file cache.
 * GET /media/:sampleId/thumb requires the Bearer token, so plain <Image
 * source={{uri}}> can't load it directly — we download once via
 * expo-file-system (with the auth header) into cacheDirectory/thumbs and
 * hand local file URIs to <Image>.
 */
import * as FileSystem from 'expo-file-system';
import { CONFIG } from '@/config';
import { getStoredToken } from '@/api/client';

const THUMBS_DIR = `${FileSystem.cacheDirectory ?? ''}thumbs/`;
const inflight = new Map<string, Promise<string | null>>();

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(THUMBS_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(THUMBS_DIR, { intermediates: true });
}

/** Local file URI for a sample's thumbnail, or null when unavailable. */
export function getThumbUri(sampleId: string): Promise<string | null> {
  const existing = inflight.get(sampleId);
  if (existing) return existing;
  const promise = fetchThumb(sampleId).finally(() => inflight.delete(sampleId));
  inflight.set(sampleId, promise);
  return promise;
}

async function fetchThumb(sampleId: string): Promise<string | null> {
  try {
    const dest = `${THUMBS_DIR}${sampleId}.jpg`;
    const cached = await FileSystem.getInfoAsync(dest);
    if (cached.exists) return dest;

    const token = await getStoredToken();
    if (!token) return null;
    await ensureDir();
    const res = await FileSystem.downloadAsync(`${CONFIG.apiUrl}/media/${sampleId}/thumb`, dest, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status !== 200) {
      await FileSystem.deleteAsync(dest, { idempotent: true });
      return null;
    }
    return dest;
  } catch {
    return null;
  }
}
