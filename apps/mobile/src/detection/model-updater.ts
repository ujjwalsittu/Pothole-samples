/**
 * OTA delivery of the road-detection TFLite model.
 *
 * Flow: GET /models/latest → compare against the installed meta
 * (models/model-meta.json) → download to a .tmp path with the Bearer token →
 * verify size (+ sha256, same base64/composite scheme as uploads) → atomic
 * rename over road-detector.tflite → write meta → invalidate the advisor
 * singleton so the next capture screen loads the new model.
 *
 * Everything is best-effort and silent: no published model (NO_MODEL/404),
 * network failures or a missing token simply mean "no update this time".
 * Whether the model actually RUNS still depends on the optional
 * react-native-fast-tflite native module being installed (see README);
 * without it the file sits dormant and the heuristic advisor continues.
 */
import * as FileSystem from 'expo-file-system';
import { CONFIG } from '@/config';
import { getStoredToken } from '@/api/client';
import { getLatestModel } from '@/api/endpoints';
import { sha256OfFile } from '@/upload/hash';
import { resetFrameAdvisor } from './index';
import { readInstalledModelMeta, writeInstalledModelMeta, type InstalledModelMeta } from './meta';
import { MODELS_DIR, TFLITE_MODEL_PATH, TFLITE_MODEL_TMP_PATH } from './paths';

export type { InstalledModelMeta } from './meta';

export interface ModelUpdateResult {
  version: number;
}

/** Installed-model meta for display (Profile) — null when not installed. */
export function getInstalledModelMeta(): Promise<InstalledModelMeta | null> {
  return readInstalledModelMeta();
}

let inFlight: Promise<ModelUpdateResult | null> | null = null;

/**
 * Checks for and installs a newer model. Resolves with the new version when
 * an update was installed, null otherwise. Never throws. Concurrent calls
 * share one run.
 */
export function checkForModelUpdate(): Promise<ModelUpdateResult | null> {
  if (!inFlight) {
    inFlight = doCheck().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function doCheck(): Promise<ModelUpdateResult | null> {
  try {
    const latest = await getLatestModel(); // throws on NO_MODEL / network
    const installed = await getInstalledModelMeta();
    if (installed && installed.version >= latest.version) return null;

    const token = await getStoredToken();
    if (!token) return null;

    const dir = await FileSystem.getInfoAsync(MODELS_DIR);
    if (!dir.exists) await FileSystem.makeDirectoryAsync(MODELS_DIR, { intermediates: true });
    await FileSystem.deleteAsync(TFLITE_MODEL_TMP_PATH, { idempotent: true });

    const res = await FileSystem.downloadAsync(
      `${CONFIG.apiUrl}/models/latest/file`,
      TFLITE_MODEL_TMP_PATH,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (res.status !== 200) {
      await FileSystem.deleteAsync(TFLITE_MODEL_TMP_PATH, { idempotent: true });
      return null;
    }

    // Verify size, then hash (same base64/composite scheme the API uses).
    const info = await FileSystem.getInfoAsync(TFLITE_MODEL_TMP_PATH, { size: true });
    const size = info.exists ? info.size ?? 0 : 0;
    if (size !== latest.sizeBytes) {
      await FileSystem.deleteAsync(TFLITE_MODEL_TMP_PATH, { idempotent: true });
      return null;
    }
    if (latest.sha256) {
      const digest = await sha256OfFile(TFLITE_MODEL_TMP_PATH);
      if (digest !== latest.sha256) {
        await FileSystem.deleteAsync(TFLITE_MODEL_TMP_PATH, { idempotent: true });
        return null;
      }
    }

    // Atomic swap + meta write (kind selects the app-side adapter).
    await FileSystem.deleteAsync(TFLITE_MODEL_PATH, { idempotent: true });
    await FileSystem.moveAsync({ from: TFLITE_MODEL_TMP_PATH, to: TFLITE_MODEL_PATH });
    await writeInstalledModelMeta({
      version: latest.version,
      sha256: latest.sha256,
      kind: latest.kind,
    });

    // Next capture-screen mount reloads the advisor with the new file.
    resetFrameAdvisor();
    return { version: latest.version };
  } catch {
    return null; // NO_MODEL, offline, 401, disk errors — all silent
  }
}
