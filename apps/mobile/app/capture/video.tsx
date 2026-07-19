import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView } from 'expo-camera';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { Speedometer } from '@/components/Speedometer';
import { CoachMark, useCoachMark } from '@/components/CoachMark';
import { GuidanceBanner } from '@/components/GuidanceBanner';
import { useRoadGuidance } from '@/detection/useRoadGuidance';
import { setCapture } from '@/capture/session';
import { colors, font, radius, spacing } from '@/theme';
import { SPEED, VIDEO_RULES, type GpsPoint } from '@/shared';

/**
 * Record-mode video capture with a live GPS track recorder.
 * True speeds are stored in the track; the on-screen speedometer is capped —
 * the user is only ever told "Max: 60 km/h". There is NO minimum speed; only
 * the (hidden) over-speed limit triggers a warning.
 */
export default function VideoCaptureScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [recording, setRecording] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [speedKmph, setSpeedKmph] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const trackRef = useRef<GpsPoint[]>([]);
  const startMsRef = useRef(0);
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const coach = useCoachMark('coach_video_v1');

  const minReached = elapsedSec >= VIDEO_RULES.MIN_DURATION_SECONDS;
  const tooFast = recording && speedKmph > SPEED.MAX_KMPH;

  // Non-blocking framing/motion guidance (pitch heuristic / optional TFLite).
  // Suppressed while the coach mark or the over-speed warning is visible.
  const { hint } = useRoadGuidance({
    mode: 'video',
    speedMps: speedKmph / 3.6,
    recording,
    enabled: !coach.visible,
  });

  // Timer pill crossfades red -> green when the 40 s minimum is reached.
  const minSv = useSharedValue(0);
  useEffect(() => {
    minSv.value = withTiming(minReached ? 1 : 0, { duration: 500 });
  }, [minReached, minSv]);
  const timerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      minSv.value,
      [0, 1],
      ['rgba(239,68,68,0.85)', 'rgba(34,197,94,0.85)'],
    ),
  }));

  // Pulsing REC indicator while recording.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = recording
      ? withRepeat(withTiming(0.25, { duration: 600 }), -1, true)
      : withTiming(1);
  }, [recording, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  useEffect(() => {
    return () => {
      locationSubRef.current?.remove();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const start = async () => {
    if (recording || !cameraRef.current) return;
    setError(null);
    trackRef.current = [];
    startMsRef.current = Date.now();
    setElapsedSec(0);

    // GPS track recorder: one fix every SPEED.GPS_SAMPLE_INTERVAL_MS.
    try {
      locationSubRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: SPEED.GPS_SAMPLE_INTERVAL_MS,
          distanceInterval: 0,
        },
        (fix) => {
          const point: GpsPoint = {
            t: fix.timestamp,
            lat: fix.coords.latitude,
            lng: fix.coords.longitude,
            acc: fix.coords.accuracy ?? 999,
            speedMps: fix.coords.speed != null && fix.coords.speed >= 0 ? fix.coords.speed : null,
            alt: fix.coords.altitude,
            mocked: fix.mocked === true,
          };
          trackRef.current.push(point);
          setSpeedKmph(point.speedMps != null ? point.speedMps * 3.6 : 0);
        },
      );
    } catch {
      setError('Could not start the GPS recorder.');
      return;
    }

    timerRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startMsRef.current) / 1000));
    }, 250);

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setRecording(true);
    try {
      const video = await cameraRef.current.recordAsync();
      // Resolves when stopRecording() is called (or on error).
      finishRecording(video?.uri ?? null);
    } catch {
      finishRecording(null);
    }
  };

  const finishRecording = (uri: string | null) => {
    locationSubRef.current?.remove();
    locationSubRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    setStopping(false);
    if (!uri) {
      setError('Recording failed — try again.');
      return;
    }
    const durationSec = (Date.now() - startMsRef.current) / 1000;
    setCapture({
      kind: 'video',
      videoUri: uri,
      capturedAt: new Date(startMsRef.current).toISOString(),
      recordingStartMs: startMsRef.current,
      durationSec,
      track: trackRef.current,
    });
    router.replace('/capture/annotate-video');
  };

  const stop = () => {
    if (!recording || stopping) return;
    if (elapsedSec < VIDEO_RULES.MIN_DURATION_SECONDS) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStopping(true);
    cameraRef.current?.stopRecording();
  };

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" mode="video" />

      {/* HUD */}
      <View style={styles.hudTop}>
        <Animated.View style={[styles.timerPill, timerStyle]}>
          <View style={styles.timerRow}>
            {recording ? <Animated.View style={[styles.recDot, pulseStyle]} /> : null}
            <Text style={styles.timerText}>{formatTime(elapsedSec)}</Text>
          </View>
          <Text style={styles.timerHint}>min {VIDEO_RULES.MIN_DURATION_SECONDS}s</Text>
        </Animated.View>
        <View style={styles.hintPill}>
          <Text style={styles.hintText}>capture ≥{VIDEO_RULES.MIN_POTHOLES} potholes</Text>
        </View>
      </View>

      <View
        ref={coach.targetRef}
        onLayout={coach.onTargetLayout}
        style={styles.speedoWrap}
        collapsable={false}
      >
        <Speedometer actualKmph={speedKmph} />
      </View>

      {!tooFast ? (
        <View style={styles.guidanceWrap} pointerEvents="none">
          <GuidanceBanner hint={hint} />
        </View>
      ) : null}

      {tooFast ? (
        <View style={[styles.warnBanner, styles.warnFast]}>
          <Text style={styles.warnText}>You{'’'}re going too fast — stay at or under 60.</Text>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.warnBanner, styles.warnFast]}>
          <Text style={styles.warnText}>{error}</Text>
        </View>
      ) : null}

      {/* controls */}
      <View style={styles.controls}>
        <Pressable
          style={styles.cancel}
          onPress={() => {
            if (recording) cameraRef.current?.stopRecording();
            router.back();
          }}
        >
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>

        {recording ? (
          <Pressable
            style={[styles.recordBtn, styles.stopBtn, !minReached && styles.btnDisabled]}
            onPress={stop}
            disabled={!minReached || stopping}
          >
            <View style={styles.stopSquare} />
          </Pressable>
        ) : (
          <Pressable style={styles.recordBtn} onPress={() => void start()}>
            <View style={styles.recordDot} />
          </Pressable>
        )}
        <View style={styles.cancelSpacer} />
      </View>
      {recording && !minReached ? (
        <Text style={styles.stopNote}>
          Stop unlocks at {VIDEO_RULES.MIN_DURATION_SECONDS}s — videos shorter than that are rejected.
        </Text>
      ) : null}

      <CoachMark
        coach={coach}
        title="Your record HUD"
        body={`The timer turns green once you pass the ${VIDEO_RULES.MIN_DURATION_SECONDS} s minimum — Stop stays locked until then. The speedometer shows your speed while you drive at up to ${SPEED.DISPLAYED_CAP_KMPH} km/h; if it turns red, ease off.`}
      />
    </View>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  hudTop: {
    position: 'absolute',
    top: spacing.xl + spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timerPill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    alignItems: 'center',
  },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFF' },
  timerText: { color: '#FFF', fontSize: font.h3, fontWeight: '800', fontVariant: ['tabular-nums'] },
  timerHint: { color: '#FFFFFFCC', fontSize: font.tiny },
  hintPill: {
    backgroundColor: 'rgba(11,18,32,0.75)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
  },
  hintText: { color: colors.primary, fontSize: font.small, fontWeight: '700' },
  speedoWrap: { position: 'absolute', top: 120, right: spacing.md },
  guidanceWrap: {
    position: 'absolute',
    bottom: 170,
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
  },
  warnBanner: {
    position: 'absolute',
    bottom: 170,
    left: spacing.md,
    right: spacing.md,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
  },
  warnFast: { backgroundColor: 'rgba(127,29,29,0.92)' },
  warnText: { color: '#FFF', fontSize: font.body, fontWeight: '700', textAlign: 'center' },
  controls: {
    position: 'absolute',
    bottom: spacing.xl + spacing.md,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  recordBtn: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 4,
    borderColor: '#FFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.danger },
  stopBtn: { borderColor: colors.danger },
  stopSquare: { width: 28, height: 28, borderRadius: 6, backgroundColor: colors.danger },
  btnDisabled: { opacity: 0.4 },
  cancel: {
    backgroundColor: 'rgba(11,18,32,0.7)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: 80,
    alignItems: 'center',
  },
  cancelSpacer: { width: 80 },
  cancelText: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  stopNote: {
    position: 'absolute',
    bottom: spacing.md,
    left: spacing.md,
    right: spacing.md,
    color: '#FFFFFFAA',
    fontSize: font.tiny,
    textAlign: 'center',
  },
});
