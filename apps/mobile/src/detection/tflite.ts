/**
 * TFLite-backed frame advisor (OPTIONAL — see README "On-device road guidance").
 *
 * Requirements to activate:
 *  1. `npm install react-native-fast-tflite` (declared as an optional peer
 *     dependency) + `npx expo prebuild`.
 *  2. A model binary at documentDirectory/models/road-detector.tflite
 *     (downloaded on first run by your distribution mechanism, or pushed via
 *     adb during development). The repository intentionally does NOT ship the
 *     binary; bundling it via Metro `require()` would hard-fail builds that
 *     don't have the file.
 *
 * If the native module or the model file is missing, `TfliteAdvisor.create()`
 * resolves to null and the factory falls back to the HeuristicAdvisor.
 *
 * Expected model contract: input [1, 224, 224, 3] uint8 RGB, output
 * [1, 2] scores = [roadProb, potholeProb].
 */
import * as FileSystem from 'expo-file-system';
import { HeuristicAdvisor } from './heuristic';
import type { AdvisorFrame, AdvisorResult, FrameAdvisor } from './types';

export const TFLITE_MODEL_PATH = `${FileSystem.documentDirectory ?? ''}models/road-detector.tflite`;

const ROAD_THRESHOLD = 0.5;
const POTHOLE_THRESHOLD = 0.6;

interface TfliteModelLike {
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

export class TfliteAdvisor implements FrameAdvisor {
  readonly kind = 'tflite' as const;
  private readonly fallback = new HeuristicAdvisor();

  private constructor(private model: TfliteModelLike | null) {}

  /** Returns null when the module or model file is unavailable. */
  static async create(): Promise<TfliteAdvisor | null> {
    const tflite = tryRequireTflite();
    if (!tflite) return null;
    try {
      const info = await FileSystem.getInfoAsync(TFLITE_MODEL_PATH);
      if (!info.exists) return null;
      const model = await tflite.loadTensorflowModel({ url: TFLITE_MODEL_PATH });
      return new TfliteAdvisor(model);
    } catch {
      return null;
    }
  }

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
