import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ProgressBar } from '@/components/ProgressBar';
import { CoachMark, useCoachMark } from '@/components/CoachMark';
import { Skeleton } from '@/components/Skeleton';
import { FlameIcon } from './ranks';
import {
  getDashboardStats,
  getMyStreak,
  getNearbyCampaigns,
  type StreakInfo,
} from '@/api/endpoints';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/Toast';
import { useCountUp } from '@/hooks/useCountUp';
import { checkForModelUpdate } from '@/detection/model-updater';
import { hasSeenCollectorCongrats, markCollectorCongratsSeen } from '@/onboarding/flags';
import { uploadManager } from '@/upload/manager';
import { activeWindow, formatDistance, withGeo, type CampaignWithGeo } from '@/utils/campaigns';
import { colors, font, radius, spacing } from '@/theme';
import { DEFAULT_PACKAGE, type DashboardStats } from '@/shared';

export default function DashboardScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignWithGeo[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [showCongrats, setShowCongrats] = useState(false);
  const coach = useCoachMark('coach_dashboard_v1');

  const isCollector = profile?.isCollector === true;

  // One-time congratulation the first time the collector flag appears.
  useEffect(() => {
    if (!isCollector) return;
    let mounted = true;
    void hasSeenCollectorCongrats().then((seen) => {
      if (mounted && !seen) setShowCongrats(true);
    });
    return () => {
      mounted = false;
    };
  }, [isCollector]);

  const load = useCallback(async () => {
    try {
      setStats(await getDashboardStats());
    } catch {
      // keep last known stats; dashboard is not critical-path
    }
    void getMyStreak()
      .then(setStreak)
      .catch(() => undefined);
    // Campaigns need a location; stay silent without permission or network.
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) return;
      const fix =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
      const list = await getNearbyCampaigns(fix.coords.latitude, fix.coords.longitude);
      setCampaigns(withGeo(list, fix.coords.latitude, fix.coords.longitude));
    })().catch(() => undefined);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
      setPendingUploads(uploadManager.getPendingCount());
    }, [load]),
  );

  useEffect(() => {
    return uploadManager.subscribe(() => setPendingUploads(uploadManager.getPendingCount()));
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    // Manual refresh also re-checks for an OTA detection-model update.
    void checkForModelUpdate().then((result) => {
      if (result) toast.show(`Road-detection model v${result.version} installed`, 'success');
    });
    await load();
    setRefreshing(false);
  };

  const p = stats?.packageProgress;
  const pkg = profile?.package ?? null;
  const pkgName = pkg?.name ?? DEFAULT_PACKAGE.name;
  const streakDays = streak?.streakDays ?? 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />
        }
      >
        <View style={styles.helloRow}>
          <Text style={styles.hello}>Hi {profile?.fullName?.split(' ')[0] ?? 'there'}</Text>
          {streakDays >= 2 ? (
            <Animated.View entering={FadeInDown.springify()} style={styles.streakChip}>
              <FlameIcon size={16} />
              <Text style={styles.streakChipText}>{streakDays}d</Text>
            </Animated.View>
          ) : null}
        </View>
        <Text style={styles.sub}>Let{'’'}s map some potholes today.</Text>

        {showCongrats ? (
          <Animated.View entering={FadeInDown.springify()} style={styles.congratsBanner}>
            <Text style={styles.congratsText}>
              Congratulations — you{'’'}ve been made a collector on {pkgName}!
            </Text>
            <Pressable
              onPress={() => {
                setShowCongrats(false);
                void markCollectorCongratsSeen();
              }}
            >
              <Text style={styles.congratsDismiss}>Got it</Text>
            </Pressable>
          </Animated.View>
        ) : null}

        {pendingUploads > 0 ? (
          <Pressable style={styles.queueBanner} onPress={() => router.push('/capture/queue')}>
            <Text style={styles.queueText}>
              {pendingUploads} sample{pendingUploads === 1 ? '' : 's'} waiting to upload — tap to view
            </Text>
          </Pressable>
        ) : null}

        {/* stat grid — accepted includes partially accepted (both earn credit) */}
        {stats === null ? (
          <View style={styles.grid}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={styles.statCard}>
                <Skeleton width={40} height={24} />
                <Skeleton width={52} height={10} style={styles.statSkeletonLabel} />
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.grid}>
            <StatCard index={0} label="Total" value={stats.totalSamples} />
            <StatCard
              index={1}
              label="Accepted"
              value={stats.accepted + stats.partiallyAccepted}
              color={colors.success}
            />
            <StatCard index={2} label="Pending" value={stats.pending} color={colors.warning} />
            <StatCard index={3} label="Rejected" value={stats.rejected} color={colors.danger} />
          </View>
        )}
        {stats && stats.partiallyAccepted > 0 ? (
          <Text style={styles.partialNote}>
            includes {stats.partiallyAccepted} partially accepted (full credit)
          </Text>
        ) : null}

        {isCollector ? (
          <>
            {/* plan progress — money surfaces are collector-only */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>{pkgName} progress</Text>
              <ProgressBar
                label={`Videos · ₹${p?.videoPayoutInr ?? pkg?.videoPayoutInr ?? 0} per completed track`}
                progress={p ? p.videosDone / Math.max(1, p.videoQuota) : 0}
                valueText={p ? `${p.videosDone} / ${p.videoQuota}` : '— / —'}
              />
              <ProgressBar
                label={`Photos · ₹${p?.photoPayoutInr ?? pkg?.photoPayoutInr ?? 0} per completed track`}
                progress={p ? p.photosDone / Math.max(1, p.photoQuota) : 0}
                valueText={p ? `${p.photosDone} / ${p.photoQuota}` : '— / —'}
                color={colors.info}
              />
              {pkg?.nextPackageCode ? (
                <Text style={styles.nextPkg}>Next up: {pkg.nextPackageCode}</Text>
              ) : null}
            </View>
            <View style={styles.balanceGrid}>
              <View style={styles.balanceCard}>
                <Text style={styles.balanceCardValue}>₹{stats?.activeInr ?? 0}</Text>
                <Text style={styles.balanceCardLabel}>Active</Text>
                <Text style={styles.balanceCardHint}>withdrawable now</Text>
              </View>
              <View style={styles.balanceCard}>
                <Text style={[styles.balanceCardValue, styles.upcomingValue]}>
                  ₹{stats?.upcomingInr ?? 0}
                </Text>
                <Text style={styles.balanceCardLabel}>Upcoming</Text>
                <Text style={styles.balanceCardHint}>unlocks when a track completes</Text>
              </View>
            </View>
          </>
        ) : (
          /* Non-collectors see community-impact framing — no money anywhere. */
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Community impact</Text>
            <Text style={styles.impactText}>
              {stats
                ? `${stats.accepted + stats.partiallyAccepted} of your reports have been verified — every one maps real road damage for repair.`
                : 'Your verified reports map real road damage for repair.'}
            </Text>
            {stats && stats.pending > 0 ? (
              <Text style={styles.impactSub}>
                {stats.pending} report{stats.pending === 1 ? '' : 's'} currently in review.
              </Text>
            ) : null}
          </View>
        )}

        {/* campaigns near me */}
        {campaigns.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Boost zones near you</Text>
            {campaigns.map((c, i) => (
              <Animated.View
                key={c.id}
                entering={FadeInDown.delay(i * 70).springify()}
                style={styles.zoneRow}
              >
                <View style={styles.zoneInfo}>
                  <Text style={styles.zoneName}>{c.name}</Text>
                  <Text style={styles.zoneMeta}>
                    {c.inside ? 'You are inside this zone' : `${formatDistance(c.distanceM)} ${c.direction}`}
                    {activeWindow(c) ? ` · ${activeWindow(c)}` : ''}
                  </Text>
                </View>
                <View style={styles.zoneBoost}>
                  <Text style={styles.zoneBoostText}>{c.boost}× payout</Text>
                </View>
              </Animated.View>
            ))}
          </View>
        ) : null}

        {/* capture buttons */}
        <View ref={coach.targetRef} onLayout={coach.onTargetLayout} collapsable={false}>
          <Pressable
            style={[styles.captureBtn, styles.capturePhoto]}
            onPress={() => router.push('/capture/preflight?mode=photo')}
          >
            <Text style={styles.captureTitle}>Capture Photo</Text>
            <Text style={styles.captureSub}>One pothole photo with exact GPS</Text>
          </Pressable>
          <Pressable
            style={[styles.captureBtn, styles.captureVideo]}
            onPress={() => router.push('/capture/preflight?mode=video')}
          >
            <Text style={styles.captureTitleAlt}>Record Video</Text>
            <Text style={styles.captureSubAlt}>40s+ drive-by video, 2+ potholes</Text>
          </Pressable>
        </View>
      </ScrollView>

      <CoachMark
        coach={coach}
        title="Start collecting here"
        body="Capture a photo or record a drive-by video. Every capture runs a quick check first: internet, precise GPS and camera access."
      />
    </SafeAreaView>
  );
}

function StatCard({
  index,
  label,
  value,
  color = colors.text,
}: {
  index: number;
  label: string;
  value: number;
  color?: string;
}) {
  const displayed = useCountUp(value);
  return (
    <Animated.View entering={FadeInDown.delay(index * 80).springify()} style={styles.statCard}>
      <Text style={[styles.statValue, { color }]}>{displayed}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  helloRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hello: { color: colors.text, fontSize: font.h1, fontWeight: '700' },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#78350F',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  streakChipText: { color: colors.primary, fontSize: font.small, fontWeight: '800' },
  sub: { color: colors.textDim, fontSize: font.body, marginTop: 2, marginBottom: spacing.md },
  queueBanner: {
    backgroundColor: '#78350F',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  queueText: { color: '#FCD34D', fontSize: font.small, fontWeight: '600', textAlign: 'center' },
  grid: { flexDirection: 'row', gap: spacing.sm },
  partialNote: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing.xs },
  statCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statValue: { fontSize: font.h2, fontWeight: '800' },
  statLabel: { color: colors.textDim, fontSize: font.tiny, marginTop: 2 },
  statSkeletonLabel: { marginTop: spacing.sm },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  cardTitle: { color: colors.text, fontSize: font.h3, fontWeight: '700', marginBottom: spacing.sm },
  balanceGrid: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  balanceCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
  },
  balanceCardValue: { color: colors.primary, fontSize: font.h2, fontWeight: '800' },
  upcomingValue: { color: colors.info },
  balanceCardLabel: { color: colors.text, fontSize: font.small, fontWeight: '700', marginTop: 2 },
  balanceCardHint: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2, textAlign: 'center' },
  nextPkg: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing.sm },
  impactText: { color: colors.textDim, fontSize: font.small, lineHeight: 20 },
  impactSub: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing.sm },
  congratsBanner: {
    backgroundColor: '#14532D',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.success,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  congratsText: { color: '#86EFAC', fontSize: font.small, fontWeight: '700' },
  congratsDismiss: {
    color: colors.success,
    fontSize: font.small,
    fontWeight: '800',
    marginTop: spacing.sm,
  },
  zoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  zoneInfo: { flex: 1, marginRight: spacing.sm },
  zoneName: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  zoneMeta: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
  zoneBoost: {
    backgroundColor: '#134E4A',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  zoneBoostText: { color: '#5EEAD4', fontSize: font.tiny, fontWeight: '800' },
  captureBtn: {
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.md,
    alignItems: 'center',
  },
  capturePhoto: { backgroundColor: colors.primary },
  captureVideo: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.primary },
  captureTitle: { color: colors.onPrimary, fontSize: font.h3, fontWeight: '800' },
  captureSub: { color: '#7C4A03', fontSize: font.small, marginTop: 2 },
  captureTitleAlt: { color: colors.primary, fontSize: font.h3, fontWeight: '800' },
  captureSubAlt: { color: colors.textDim, fontSize: font.small, marginTop: 2 },
});
