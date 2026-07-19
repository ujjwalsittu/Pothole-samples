import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProgressBar } from '@/components/ProgressBar';
import { getDashboardStats } from '@/api/endpoints';
import { useAuth } from '@/auth/AuthContext';
import { uploadManager } from '@/upload/manager';
import { colors, font, radius, spacing } from '@/theme';
import type { DashboardStats } from '@/shared';

export default function DashboardScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);

  const load = useCallback(async () => {
    try {
      setStats(await getDashboardStats());
    } catch {
      // keep last known stats; dashboard is not critical-path
    }
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
    await load();
    setRefreshing(false);
  };

  const p = stats?.packageProgress;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />
        }
      >
        <Text style={styles.hello}>Hi {profile?.fullName?.split(' ')[0] ?? 'there'}</Text>
        <Text style={styles.sub}>Let{'’'}s map some potholes today.</Text>

        {pendingUploads > 0 ? (
          <Pressable style={styles.queueBanner} onPress={() => router.push('/capture/queue')}>
            <Text style={styles.queueText}>
              {pendingUploads} sample{pendingUploads === 1 ? '' : 's'} waiting to upload — tap to view
            </Text>
          </Pressable>
        ) : null}

        {/* stat grid */}
        <View style={styles.grid}>
          <StatCard label="Total" value={stats?.totalSamples ?? '—'} />
          <StatCard label="Accepted" value={stats?.accepted ?? '—'} color={colors.success} />
          <StatCard label="Pending" value={stats?.pending ?? '—'} color={colors.warning} />
          <StatCard label="Rejected" value={stats?.rejected ?? '—'} color={colors.danger} />
        </View>

        {/* package progress */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Package progress</Text>
          <ProgressBar
            label="Videos"
            progress={p ? p.videosDone / Math.max(1, p.videoQuota) : 0}
            valueText={p ? `${p.videosDone} / ${p.videoQuota}` : '— / —'}
          />
          <ProgressBar
            label="Photos"
            progress={p ? p.photosDone / Math.max(1, p.photoQuota) : 0}
            valueText={p ? `${p.photosDone} / ${p.photoQuota}` : '— / —'}
            color={colors.info}
          />
          <View style={styles.balanceRow}>
            <Text style={styles.balanceLabel}>Balance</Text>
            <Text style={styles.balanceValue}>₹{stats?.balanceInr ?? 0}</Text>
          </View>
        </View>

        {/* capture buttons */}
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
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value, color = colors.text }: { label: string; value: number | string; color?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md },
  hello: { color: colors.text, fontSize: font.h1, fontWeight: '700' },
  sub: { color: colors.textDim, fontSize: font.body, marginTop: 2, marginBottom: spacing.md },
  queueBanner: {
    backgroundColor: '#78350F',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  queueText: { color: '#FCD34D', fontSize: font.small, fontWeight: '600', textAlign: 'center' },
  grid: { flexDirection: 'row', gap: spacing.sm },
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
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  cardTitle: { color: colors.text, fontSize: font.h3, fontWeight: '700', marginBottom: spacing.sm },
  balanceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  balanceLabel: { color: colors.textDim, fontSize: font.body },
  balanceValue: { color: colors.primary, fontSize: font.h2, fontWeight: '800' },
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
