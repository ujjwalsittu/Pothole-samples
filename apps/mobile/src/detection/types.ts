/**
 * Frame-advisor contract for on-device road guidance.
 *
 * The advisor consumes lightweight "frames" (whatever signal is available on
 * the current build — device orientation, GPS speed, and optionally a raw
 * camera frame tensor when a TFLite build is present) and returns non-blocking
 * guidance for the capture UI.
 */

export interface AdvisorFrame {
  /** 'photo' or 'video' capture context. */
  mode: 'photo' | 'video';
  /** Device pitch in degrees (0 = flat on table, 90 = upright), null if unknown. */
  pitchDeg: number | null;
  /** Latest GPS speed in m/s, null if unknown. */
  speedMps: number | null;
  /** True while a video recording is running. */
  recording: boolean;
  /**
   * Optional raw frame data (RGB tensor) for ML-backed advisors. expo-camera
   * cannot stream frames without extra native libs, so this stays undefined on
   * the default build — the TFLite advisor uses it when a frame processor is
   * wired up.
   */
  frameData?: Uint8Array;
}

export interface AdvisorResult {
  /** Best guess: is the camera looking at a road surface? */
  roadLikely: boolean;
  /** Best guess: does the view contain a pothole? (ML builds only.) */
  potholeLikely: boolean;
  /** User-facing, non-blocking guidance; null when framing looks fine. */
  hint: string | null;
}

export interface FrameAdvisor {
  /** Identifies which implementation is active (shown in dev/README). */
  readonly kind: 'tflite' | 'heuristic';
  analyze(frame: AdvisorFrame): AdvisorResult;
  /** Release native resources (models). */
  dispose(): void;
}
