import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView } from 'expo-camera';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { GuidelinesOverlay } from '@/components/GuidelinesOverlay';
import { GuidanceBanner } from '@/components/GuidanceBanner';
import { useRoadGuidance } from '@/detection/useRoadGuidance';
import { setCapture } from '@/capture/session';
import { colors, font, radius, spacing } from '@/theme';

/**
 * Full-screen photo capture. At shutter time we take the picture AND an exact
 * GPS fix (lat/lng/accuracy/mocked). Coordinates are NEVER drawn on the image
 * and EXIF is never altered — location lives only in the metadata JSON.
 */
export default function PhotoCaptureScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shutterScale = useSharedValue(1);
  const shutterStyle = useAnimatedStyle(() => ({
    transform: [{ scale: shutterScale.value }],
  }));

  // Non-blocking framing guidance (device pitch heuristic / optional TFLite).
  const { hint } = useRoadGuidance({ mode: 'photo', speedMps: null, recording: false });

  const shoot = async () => {
    if (busy || !cameraRef.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBusy(true);
    setError(null);
    try {
      const [photo, fix] = await Promise.all([
        cameraRef.current.takePictureAsync({ quality: 0.9, exif: false, skipProcessing: false }),
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation }),
      ]);
      if (!photo?.uri) {
        setError('Capture failed — try again.');
        return;
      }
      if (fix.mocked === true) {
        setError('Mock location detected at shutter time. Disable fake-GPS apps.');
        return;
      }
      setCapture({
        kind: 'photo',
        photoUri: photo.uri,
        width: photo.width,
        height: photo.height,
        capturedAt: new Date(fix.timestamp).toISOString(),
        lat: fix.coords.latitude,
        lng: fix.coords.longitude,
        accuracyM: fix.coords.accuracy ?? 999,
        mocked: false, // mocked fixes are rejected above

      });
      router.replace('/capture/annotate-photo');
    } catch {
      setError('Capture failed — try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <GuidelinesOverlay />

      <View style={styles.guidanceWrap} pointerEvents="none">
        <GuidanceBanner hint={hint} />
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.controls}>
        <Pressable style={styles.cancel} onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Animated.View style={shutterStyle}>
          <Pressable
            style={styles.shutter}
            onPress={() => void shoot()}
            onPressIn={() => {
              shutterScale.value = withSpring(0.88, { damping: 18, stiffness: 320 });
            }}
            onPressOut={() => {
              shutterScale.value = withSpring(1, { damping: 18, stiffness: 320 });
            }}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color={colors.onPrimary} /> : <View style={styles.shutterInner} />}
          </Pressable>
        </Animated.View>
        <View style={styles.cancelSpacer} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  controls: {
    position: 'absolute',
    bottom: spacing.xl,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
  },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF55',
  },
  shutterInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#FFF3' },
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
  errorBanner: {
    position: 'absolute',
    bottom: 140,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(127,29,29,0.9)',
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  errorText: { color: '#FCA5A5', fontSize: font.small, textAlign: 'center' },
  guidanceWrap: {
    position: 'absolute',
    top: 128,
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
  },
});
