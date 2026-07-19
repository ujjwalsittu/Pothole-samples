/**
 * Installed-model metadata (models/model-meta.json). Kept in its own module so
 * both the OTA updater and the advisor dispatcher can read it without an
 * import cycle (updater → index → tflite).
 */
import * as FileSystem from 'expo-file-system';
import type { ModelKind } from '@/shared';
import { MODEL_META_PATH, TFLITE_MODEL_PATH } from './paths';

export interface InstalledModelMeta {
  version: number;
  sha256: string;
  /** Selects the app-side adapter; legacy metas without it are road-binary. */
  kind: ModelKind;
}

export async function readInstalledModelMeta(): Promise<InstalledModelMeta | null> {
  try {
    const info = await FileSystem.getInfoAsync(MODEL_META_PATH);
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(MODEL_META_PATH);
    const meta = JSON.parse(raw) as Partial<InstalledModelMeta>;
    if (typeof meta.version !== 'number' || typeof meta.sha256 !== 'string') return null;
    // Meta without the binary counts as not installed.
    const model = await FileSystem.getInfoAsync(TFLITE_MODEL_PATH);
    if (!model.exists) return null;
    return {
      version: meta.version,
      sha256: meta.sha256,
      kind: meta.kind === 'ssd-coco' ? 'ssd-coco' : 'road-binary',
    };
  } catch {
    return null;
  }
}

export async function writeInstalledModelMeta(meta: InstalledModelMeta): Promise<void> {
  await FileSystem.writeAsStringAsync(MODEL_META_PATH, JSON.stringify(meta));
}
