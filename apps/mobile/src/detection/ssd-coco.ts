/**
 * SSD-COCO frame advisor ('ssd-coco' model kind).
 *
 * Model contract: standard TFLite SSD with the SSD_PostProcess op (e.g.
 * SSDLite-MobileNetV2): input [1,300,300,3]u8 RGB, outputs
 *   0: boxes   [1, N, 4]  (ymin, xmin, ymax, xmax — normalized)
 *   1: classes [1, N]     (0-based index into the 90-slot COCO label map)
 *   2: scores  [1, N]
 *   3: count   [1]
 *
 * Guidance logic: any detection with score > 0.5 whose class is in
 * AVOID_CLASSES (people/vehicles/animals/plants/signs) and whose box covers
 * more than 20% of the frame → roadLikely=false with a "move away" hint.
 *
 * NOTE: potholeLikely is ALWAYS false here — COCO has no pothole class, so an
 * ssd-coco model cannot detect potholes; it only detects what should NOT
 * dominate the frame.
 */
import { AVOID_CLASSES, COCO_LABELS } from './coco-labels';
import { HeuristicAdvisor } from './heuristic';
import type { TfliteModelLike } from './tflite';
import type { AdvisorFrame, AdvisorResult, FrameAdvisor } from './types';

const SCORE_THRESHOLD = 0.5;
const AREA_THRESHOLD = 0.2; // fraction of the frame

export class SsdCocoAdvisor implements FrameAdvisor {
  readonly kind = 'tflite' as const;
  private readonly fallback = new HeuristicAdvisor();

  constructor(private model: TfliteModelLike | null) {}

  analyze(frame: AdvisorFrame): AdvisorResult {
    // Without raw frame data (no frame processor wired up) behave like the
    // heuristic advisor so guidance still works.
    if (!frame.frameData || !this.model) return this.fallback.analyze(frame);
    try {
      const outputs = this.model.runSync([frame.frameData]);
      const [boxes, classes, scores, countOut] = outputs;
      if (!boxes || !classes || !scores) return this.fallback.analyze(frame);
      const count = Math.min(
        Math.round(countOut?.[0] ?? scores.length),
        scores.length,
      );

      for (let i = 0; i < count; i++) {
        const score = scores[i] ?? 0;
        if (score <= SCORE_THRESHOLD) continue;
        const label = COCO_LABELS[Math.round(classes[i] ?? -1)] ?? null;
        if (!label || !AVOID_CLASSES.has(label)) continue;
        const ymin = boxes[i * 4] ?? 0;
        const xmin = boxes[i * 4 + 1] ?? 0;
        const ymax = boxes[i * 4 + 2] ?? 0;
        const xmax = boxes[i * 4 + 3] ?? 0;
        const area = Math.max(0, ymax - ymin) * Math.max(0, xmax - xmin);
        if (area > AREA_THRESHOLD) {
          return {
            roadLikely: false,
            potholeLikely: false, // COCO cannot detect potholes
            hint: `Move away from ${label} — keep the road in frame`,
          };
        }
      }
      return { roadLikely: true, potholeLikely: false, hint: null };
    } catch {
      return this.fallback.analyze(frame);
    }
  }

  dispose(): void {
    this.model = null;
  }
}
