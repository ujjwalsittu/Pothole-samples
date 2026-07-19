/**
 * Frame-advisor factory: prefers the TFLite implementation (adapter chosen by
 * the installed model's kind) when its optional native module + model file
 * are present, otherwise the zero-dep heuristic.
 */
import { createTfliteAdvisor } from './tflite';
import { HeuristicAdvisor } from './heuristic';
import type { FrameAdvisor } from './types';

export * from './types';
export { HeuristicAdvisor } from './heuristic';
export { TfliteAdvisor, createTfliteAdvisor, TFLITE_MODEL_PATH } from './tflite';
export { SsdCocoAdvisor } from './ssd-coco';

let cached: FrameAdvisor | null = null;

export async function createFrameAdvisor(): Promise<FrameAdvisor> {
  if (cached) return cached;
  cached = (await createTfliteAdvisor()) ?? new HeuristicAdvisor();
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
