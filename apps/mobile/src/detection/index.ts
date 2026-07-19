/**
 * Frame-advisor factory: prefers the TFLite implementation when its optional
 * native module + model file are present, otherwise the zero-dep heuristic.
 */
import { HeuristicAdvisor } from './heuristic';
import { TfliteAdvisor } from './tflite';
import type { FrameAdvisor } from './types';

export * from './types';
export { HeuristicAdvisor } from './heuristic';
export { TfliteAdvisor, TFLITE_MODEL_PATH } from './tflite';

let cached: FrameAdvisor | null = null;

export async function createFrameAdvisor(): Promise<FrameAdvisor> {
  if (cached) return cached;
  cached = (await TfliteAdvisor.create()) ?? new HeuristicAdvisor();
  return cached;
}

/**
 * Invalidates the cached advisor (e.g. after an OTA model update) so the next
 * capture-screen mount reloads it — picking up a freshly installed model.
 */
export function resetFrameAdvisor(): void {
  cached?.dispose();
  cached = null;
}
