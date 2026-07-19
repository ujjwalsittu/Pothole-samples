/**
 * Zero-dependency road-guidance advisor.
 *
 * Without camera-frame access (expo-camera cannot stream frames), it infers
 * framing quality from device pitch (expo-sensors DeviceMotion, fed in by the
 * caller) and GPS speed:
 *  - phone pointing too high (sky) or lying flat -> "Point the camera at the
 *    road ahead"
 *  - video mode but not moving -> "Start driving to record"
 */
import type { AdvisorFrame, AdvisorResult, FrameAdvisor } from './types';

/** Pitch window (degrees) considered "aimed at the road ahead" in portrait. */
const PITCH_MIN_DEG = 25; // below: phone nearly flat, pointing at feet/floor
const PITCH_MAX_DEG = 80; // above: horizon/sky-dominant framing

/** Below this speed (m/s) in video mode we consider the vehicle stationary. */
const MOVING_MIN_MPS = 1.0;

export class HeuristicAdvisor implements FrameAdvisor {
  readonly kind = 'heuristic' as const;

  analyze(frame: AdvisorFrame): AdvisorResult {
    // Movement check first — most actionable while recording.
    if (frame.mode === 'video' && frame.recording && frame.speedMps != null) {
      if (frame.speedMps < MOVING_MIN_MPS) {
        return { roadLikely: false, potholeLikely: false, hint: 'Start driving to record' };
      }
    }

    if (frame.pitchDeg != null) {
      if (frame.pitchDeg > PITCH_MAX_DEG || frame.pitchDeg < PITCH_MIN_DEG) {
        return {
          roadLikely: false,
          potholeLikely: false,
          hint: 'Point the camera at the road ahead',
        };
      }
    }

    // No signal against the framing — assume it's fine, never block.
    return { roadLikely: true, potholeLikely: false, hint: null };
  }

  dispose(): void {
    // nothing to release
  }
}
