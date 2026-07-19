import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Network from 'expo-network';
import * as Location from 'expo-location';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { setOfflineMode } from '@/capture/session';
import { colors, font, radius, spacing } from '@/theme';
import { GPS_RULES } from '@/shared';

type CheckStatus = 'idle' | 'running' | 'pass' | 'warn' | 'fail';

interface Check {
  key: 'internet' | 'location' | 'mock' | 'camera';
  title: string;
  status: CheckStatus;
  detail: string;
}

const INITIAL: Check[] = [
  { key: 'internet', title: 'Internet connection', status: 'idle', detail: '' },
  { key: 'location', title: 'Precise location', status: 'idle', detail: '' },
  { key: 'mock', title: 'Genuine GPS (no mock location)', status: 'idle', detail: '' },
  { key: 'camera', title: 'Camera & microphone', status: 'idle', detail: '' },
];

export default function PreflightScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const captureMode: 'photo' | 'video' = mode === 'video' ? 'video' : 'photo';

  const [checks, setChecks] = useState<Check[]>(INITIAL);
  const [running, setRunning] = useState(false);
  const [mockBlocked, setMockBlocked] = useState(false);

  const [, requestCameraPerm] = useCameraPermissions();
  const [, requestMicPerm] = useMicrophonePermissions();

  const set = (key: Check['key'], status: CheckStatus, detail = '') => {
    setChecks((prev) => prev.map((c) => (c.key === key ? { ...c, status, detail } : c)));
  };

  const runChecks = useCallback(async () => {
    setRunning(true);
    setMockBlocked(false);
    setChecks(INITIAL.map((c) => ({ ...c })));

    // 1. Internet — offline is allowed, but flagged.
    set('internet', 'running');
    let offline = false;
    try {
      const net = await Network.getNetworkStateAsync();
      if (net.isConnected && net.isInternetReachable !== false) {
        set('internet', 'pass', 'Online');
      } else {
        offline = true;
        set('internet', 'warn', 'Offline — sample will be queued and uploaded later.');
      }
    } catch {
      offline = true;
      set('internet', 'warn', 'Offline — sample will be queued and uploaded later.');
    }
    setOfflineMode(offline);

    // 2. Location services + permission + first fix accuracy.
    set('location', 'running');
    let fix: Location.LocationObject | null = null;
    try {
      const servicesOn = await Location.hasServicesEnabledAsync();
      if (!servicesOn) {
        set('location', 'fail', 'Turn on location services (GPS) and retry.');
        setRunning(false);
        return;
      }
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        set('location', 'fail', 'Location permission is required. Enable "Precise location".');
        setRunning(false);
        return;
      }
      fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation });
      const acc = fix.coords.accuracy ?? Number.POSITIVE_INFINITY;
      if (acc > GPS_RULES.MAX_ACCURACY_METERS) {
        set(
          'location',
          'fail',
          `GPS accuracy is ±${Math.round(acc)} m — need ≤ ${GPS_RULES.MAX_ACCURACY_METERS} m. Move to open sky and retry.`,
        );
        setRunning(false);
        return;
      }
      set('location', 'pass', `Fix ±${Math.round(acc)} m`);
    } catch {
      set('location', 'fail', 'Could not get a GPS fix. Move outdoors and retry.');
      setRunning(false);
      return;
    }

    // 3. Mock location — hard reject.
    set('mock', 'running');
    const mocked = fix.mocked === true;
    if (mocked) {
      set('mock', 'fail', 'Mock/simulated location detected.');
      setMockBlocked(true);
      setRunning(false);
      return;
    }
    set('mock', 'pass', 'Genuine GPS fix');

    // 4. Camera + microphone permissions.
    set('camera', 'running');
    const cam = await requestCameraPerm();
    const mic = captureMode === 'video' ? await requestMicPerm() : { granted: true };
    if (!cam.granted) {
      set('camera', 'fail', 'Camera permission is required.');
      setRunning(false);
      return;
    }
    if (!mic.granted) {
      set('camera', 'fail', 'Microphone permission is required for video.');
      setRunning(false);
      return;
    }
    set('camera', 'pass', 'Ready');
    setRunning(false);
  }, [captureMode, requestCameraPerm, requestMicPerm]);

  useEffect(() => {
    void runChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allDone = checks.every((c) => c.status === 'pass' || c.status === 'warn');
  const anyFail = checks.some((c) => c.status === 'fail');
  const isOffline = checks.find((c) => c.key === 'internet')?.status === 'warn';

  if (mockBlocked) {
    return (
      <Screen scroll={false} style={styles.centerScreen}>
        <Text style={styles.mockTitle}>Mock location detected</Text>
        <Text style={styles.mockBody}>
          PotholeCollect requires a genuine GPS location. Disable any mock-location or fake-GPS app
          and try again. Samples with simulated locations are always rejected.
        </Text>
        <Button title="Back" variant="secondary" onPress={() => router.back()} style={styles.mockBtn} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.title}>Pre-flight checks</Text>
      <Text style={styles.subtitle}>
        {captureMode === 'photo' ? 'Photo mode' : 'Video (record) mode'} — everything below must pass
        before capture.
      </Text>

      {isOffline ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            OFFLINE MODE — your sample will be queued and uploaded later.
          </Text>
        </View>
      ) : null}

      <View style={styles.list}>
        {checks.map((c) => (
          <View key={c.key} style={styles.checkRow}>
            <StatusDot status={c.status} />
            <View style={styles.checkText}>
              <Text style={styles.checkTitle}>{c.title}</Text>
              {c.detail ? (
                <Text style={[styles.checkDetail, c.status === 'fail' && styles.checkDetailFail]}>
                  {c.detail}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      {anyFail ? (
        <Button title="Retry checks" onPress={() => void runChecks()} loading={running} style={styles.btn} />
      ) : (
        <Button
          title={captureMode === 'photo' ? 'Open camera' : 'Start recording setup'}
          onPress={() => router.replace(captureMode === 'photo' ? '/capture/photo' : '/capture/video')}
          disabled={!allDone || running}
          loading={running}
          style={styles.btn}
        />
      )}
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}

function StatusDot({ status }: { status: CheckStatus }) {
  const color =
    status === 'pass'
      ? colors.success
      : status === 'fail'
        ? colors.danger
        : status === 'warn'
          ? colors.warning
          : status === 'running'
            ? colors.info
            : colors.border;
  const glyph = status === 'pass' ? '✓' : status === 'fail' ? '✕' : status === 'warn' ? '!' : '·';
  return (
    <View style={[styles.dot, { borderColor: color }]}>
      <Text style={[styles.dotGlyph, { color }]}>{glyph}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: font.h1, fontWeight: '700' },
  subtitle: { color: colors.textDim, fontSize: font.body, marginTop: spacing.xs },
  offlineBanner: {
    backgroundColor: '#78350F',
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  offlineText: { color: '#FCD34D', fontSize: font.small, fontWeight: '700', textAlign: 'center' },
  list: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.sm },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  dotGlyph: { fontSize: font.small, fontWeight: '800' },
  checkText: { flex: 1 },
  checkTitle: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  checkDetail: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
  checkDetailFail: { color: colors.danger },
  btn: { marginTop: spacing.lg, marginBottom: spacing.xs },
  centerScreen: { justifyContent: 'center' },
  mockTitle: { color: colors.danger, fontSize: font.h1, fontWeight: '800', textAlign: 'center' },
  mockBody: {
    color: colors.textDim,
    fontSize: font.body,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 22,
  },
  mockBtn: { marginTop: spacing.xl },
});
