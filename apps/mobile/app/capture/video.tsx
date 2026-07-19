import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView } from 'expo-camera';
import * as Location from 'expo-location';
import { Speedometer } from '@/components/Speedometer';
import { setCapture } from '@/capture/session';
import { colors, font, radius, spacing } from '@/theme';
import { SPEED, VIDEO_RULES, type GpsPoint } from '@/shared';

/**
 * Record-mode video capture with a live GPS track recorder.
 * True speeds are stored in the track; the on-screen speedometer is capped —
 * the user is only ever shown "Target: 60 km/h".
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
    setStopping(true);
    cameraRef.current?.stopRecording();
  };

  const minReached = elapsedSec >= VIDEO_RULES.MIN_DURATION_SECONDS;
  const tooFast = speedKmph > SPEED.MAX_KMPH;
  const tooSlow = recording && speedKmph < SPEED.MIN_KMPH && !tooFast;

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" mode="video" />

      {/* HUD */}
      <View style={styles.hudTop}>
        <View style={[styles.timerPill, minReached ? styles.timerOk : styles.timerLow]}>
          <Text style={styles.timerText}>{formatTime(elapsedSec)}</Text>
          <Text style={styles.timerHint}>min {VIDEO_RULES.MIN_DURATION_SECONDS}s</Text>
        </View>
        <View style={styles.hintPill}>
          <Text style={styles.hintText}>capture ≥{VIDEO_RULES.MIN_POTHOLES} potholes</Text>
        </View>
      </View>

      <View style={styles.speedoWrap}>
        <Speedometer actualKmph={speedKmph} />
      </View>

      {recording && tooFast ? (
        <View style={[styles.warnBanner, styles.warnFast]}>
          <Text style={styles.warnText}>Slow down! You{'’'}re going too fast — keep it at 60.</Text>
        </View>
      ) : null}
      {tooSlow ? (
        <View style={[styles.warnBanner, styles.warnSlow]}>
          <Text style={styles.warnText}>Speed up to ~60 km/h.</Text>
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
  timerLow: { backgroundColor: 'rgba(239,68,68,0.85)' },
  timerOk: { backgroundColor: 'rgba(34,197,94,0.85)' },
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
  warnBanner: {
    position: 'absolute',
    bottom: 170,
    left: spacing.md,
    right: spacing.md,
    borderRadius: radius.md,
    padding: spacing.sm + 2,
  },
  warnFast: { backgroundColor: 'rgba(127,29,29,0.92)' },
  warnSlow: { backgroundColor: 'rgba(120,53,15,0.92)' },
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
