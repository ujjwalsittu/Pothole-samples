/**
 * TFLite-backed frame advisors (OPTIONAL — see README "On-device road guidance").
 *
 * Requirements to activate:
 *  1. `npm install react-native-fast-tflite` (declared as an optional peer
 *     dependency) + `npx expo prebuild`.
 *  2. A model binary at documentDirectory/models/road-detector.tflite,
 *     delivered OTA (src/detection/model-updater.ts) or pushed manually.
 *
 * The installed model's `kind` (models/model-meta.json, recorded from
 * /models/latest) selects the adapter:
 *  - 'road-binary' → TfliteAdvisor: input [1,224,224,3]u8, output [1,2] =
 *    [roadProb, potholeProb].
 *  - 'ssd-coco'    → SsdCocoAdvisor (ssd-coco.ts): standard SSD PostProcess
 *    detector used for avoid-object guidance.
 *
 * If the native module or the model file is missing, `createTfliteAdvisor()`
 * resolves to null and the factory falls back to the HeuristicAdvisor.
 */
import * as FileSystem from 'expo-file-system';
import { HeuristicAdvisor } from './heuristic';
import { readInstalledModelMeta } from './meta';
import { TFLITE_MODEL_PATH } from './paths';
import { SsdCocoAdvisor } from './ssd-coco';
import type { AdvisorFrame, AdvisorResult, FrameAdvisor } from './types';

export { TFLITE_MODEL_PATH } from './paths';

const ROAD_THRESHOLD = 0.5;
const POTHOLE_THRESHOLD = 0.6;

export interface TfliteModelLike {
  runSync(inputs: unknown[]): ArrayLike<number>[];
}

interface TfliteModuleLike {
  loadTensorflowModel(source: { url: string }): Promise<TfliteModelLike>;
}

/**
 * Resolve the optional native module without letting Metro statically bundle
 * it: a variable specifier keeps the require dynamic, and the try/catch
 * absorbs the runtime "unknown module" error on builds without the package.
 */
function tryRequireTflite(): TfliteModuleLike | null {
  try {
    const moduleName = 'react-native-fast-tflite';
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = (require as (name: string) => unknown)(moduleName);
    if (mod && typeof (mod as TfliteModuleLike).loadTensorflowModel === 'function') {
      return mod as TfliteModuleLike;
    }
    return null;
  } catch {
    return null;
  }
}

/** Binary road/pothole classifier: [1,224,224,3]u8 → [roadProb, potholeProb]. */
export class TfliteAdvisor implements FrameAdvisor {
  readonly kind = 'tflite' as const;
  private readonly fallback = new HeuristicAdvisor();

  constructor(private model: TfliteModelLike | null) {}

  analyze(frame: AdvisorFrame): AdvisorResult {
    // Without raw frame data (no frame processor wired up) behave like the
    // heuristic advisor so guidance still works.
    if (!frame.frameData || !this.model) return this.fallback.analyze(frame);
    try {
      const [scores] = this.model.runSync([frame.frameData]);
      const roadProb = scores[0] ?? 0;
      const potholeProb = scores[1] ?? 0;
      const roadLikely = roadProb >= ROAD_THRESHOLD;
      return {
        roadLikely,
        potholeLikely: potholeProb >= POTHOLE_THRESHOLD,
        hint: roadLikely ? null : 'Point the camera at the road ahead',
      };
    } catch {
      return this.fallback.analyze(frame);
    }
  }

  dispose(): void {
    this.model = null;
  }
}

/**
 * Loads the installed model and returns the adapter matching its kind, or
 * null when the module/model is unavailable (caller falls back to heuristic).
 */
export async function createTfliteAdvisor(): Promise<FrameAdvisor | null> {
  const tflite = tryRequireTflite();
  if (!tflite) return null;
  try {
    const info = await FileSystem.getInfoAsync(TFLITE_MODEL_PATH);
    if (!info.exists) return null;
    const meta = await readInstalledModelMeta();
    const model = await tflite.loadTensorflowModel({ url: TFLITE_MODEL_PATH });
    if (meta?.kind === 'ssd-coco') return new SsdCocoAdvisor(model);
    return new TfliteAdvisor(model);
  } catch {
    return null;
  }
}
