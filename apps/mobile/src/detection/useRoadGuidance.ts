/**
 * React hook driving a FrameAdvisor from what the default Expo build can
 * observe: device pitch (expo-sensors DeviceMotion) + the GPS speed supplied
 * by the capture screen. Emits a debounced, non-blocking hint string.
 */
import { useEffect, useRef, useState } from 'react';
import { DeviceMotion, type DeviceMotionMeasurement } from 'expo-sensors';
import { createFrameAdvisor } from './index';
import type { FrameAdvisor } from './types';

const SAMPLE_INTERVAL_MS = 500;
/** A hint must persist this long before being shown (avoids flicker). */
const HINT_STABLE_MS = 1500;

interface Options {
  mode: 'photo' | 'video';
  /** Latest GPS speed in m/s (video screens), null when unknown. */
  speedMps: number | null;
  recording: boolean;
  /** Master switch — e.g. disabled while an overlay/coach mark is up. */
  enabled?: boolean;
}

export function useRoadGuidance({ mode, speedMps, recording, enabled = true }: Options): {
  hint: string | null;
  advisorKind: 'tflite' | 'heuristic' | null;
} {
  const [hint, setHint] = useState<string | null>(null);
  const [advisorKind, setAdvisorKind] = useState<'tflite' | 'heuristic' | null>(null);

  const advisorRef = useRef<FrameAdvisor | null>(null);
  const pitchRef = useRef<number | null>(null);
  const inputRef = useRef({ mode, speedMps, recording });
  inputRef.current = { mode, speedMps, recording };
  const candidateRef = useRef<{ hint: string | null; since: number }>({ hint: null, since: 0 });

  useEffect(() => {
    if (!enabled) {
      setHint(null);
      return;
    }
    let cancelled = false;
    let motionSub: { remove(): void } | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;

    void (async () => {
      const advisor = await createFrameAdvisor();
      if (cancelled) return;
      advisorRef.current = advisor;
      setAdvisorKind(advisor.kind);

      try {
        const available = await DeviceMotion.isAvailableAsync();
        if (available && !cancelled) {
          DeviceMotion.setUpdateInterval(SAMPLE_INTERVAL_MS);
          motionSub = DeviceMotion.addListener((m: DeviceMotionMeasurement) => {
            const beta = m.rotation?.beta;
            pitchRef.current = beta != null ? Math.abs((beta * 180) / Math.PI) : null;
          });
        }
      } catch {
        pitchRef.current = null; // sensors unavailable — advisor copes with null
      }

      timer = setInterval(() => {
        const a = advisorRef.current;
        if (!a) return;
        const { mode: m, speedMps: s, recording: r } = inputRef.current;
        const result = a.analyze({
          mode: m,
          pitchDeg: pitchRef.current,
          speedMps: s,
          recording: r,
        });
        // Debounce: only surface a hint that has been stable for a while;
        // clear immediately once framing recovers.
        const now = Date.now();
        const cand = candidateRef.current;
        if (result.hint !== cand.hint) {
          candidateRef.current = { hint: result.hint, since: now };
          if (result.hint == null) setHint(null);
        } else if (result.hint != null && now - cand.since >= HINT_STABLE_MS) {
          setHint(result.hint);
        }
      }, SAMPLE_INTERVAL_MS);
    })();

    return () => {
      cancelled = true;
      motionSub?.remove();
      if (timer) clearInterval(timer);
      setHint(null);
    };
  }, [enabled]);

  return { hint, advisorKind };
}
