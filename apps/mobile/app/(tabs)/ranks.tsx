import React, { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SkeletonCard, Skeleton } from '@/components/Skeleton';
import {
  getLeaderboard,
  getMyStreak,
  type LeaderboardPeriod,
  type StreakInfo,
} from '@/api/endpoints';
import { useCountUp } from '@/hooks/useCountUp';
import { colors, font, radius, spacing } from '@/theme';
import { GAMIFICATION, type LeaderboardEntry } from '@/shared';

const MEDAL_COLORS = ['#FBBF24', '#CBD5E1', '#D97706'] as const; // gold, silver, bronze

export default function RanksScreen() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('month');
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: LeaderboardPeriod) => {
    try {
      const [board, streakInfo] = await Promise.all([getLeaderboard(p), getMyStreak()]);
      setEntries(board);
      setStreak(streakInfo);
      setError(null);
    } catch {
      setError('Could not load the leaderboard. Pull to retry.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(period);
    }, [load, period]),
  );

  const switchPeriod = (p: LeaderboardPeriod) => {
    if (p === period) return;
    setPeriod(p);
    setEntries(null);
    void load(p);
  };

  const top = entries?.slice(0, GAMIFICATION.LEADERBOARD_LIMIT) ?? [];
  // My row, pinned to the bottom when it falls outside the visible list.
  const meOutside = entries?.find(
    (e) => e.isMe && !top.some((t) => t.isMe && t.rank === e.rank),
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Text style={styles.title}>Ranks</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <StreakCard streak={streak} />

      <View style={styles.toggleRow}>
        {(['month', 'all'] as const).map((p) => (
          <Pressable
            key={p}
            onPress={() => switchPeriod(p)}
            style={[styles.toggle, period === p && styles.toggleActive]}
          >
            <Text style={[styles.toggleText, period === p && styles.toggleTextActive]}>
              {p === 'month' ? 'This month' : 'All time'}
            </Text>
          </Pressable>
        ))}
      </View>

      {entries === null ? (
        <View style={styles.list}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : (
        <FlatList
          data={top}
          keyExtractor={(e) => `${e.rank}_${e.userId}`}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(period).finally(() => setRefreshing(false));
              }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No accepted samples yet — the board is wide open.</Text>
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 12) * 40).springify()}>
              <RankRow entry={item} />
            </Animated.View>
          )}
        />
      )}

      {meOutside ? (
        <View style={styles.pinnedWrap}>
          <RankRow entry={meOutside} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function StreakCard({ streak }: { streak: StreakInfo | null }) {
  const current = useCountUp(streak?.streakDays ?? 0);
  const best = useCountUp(streak?.bestStreakDays ?? 0);
  return (
    <View style={styles.streakCard}>
      <FlameIcon size={40} active={(streak?.streakDays ?? 0) > 0} />
      {streak === null ? (
        <View style={styles.streakSkeleton}>
          <Skeleton width={120} height={16} />
          <Skeleton width={80} height={12} style={styles.streakSkeletonLine} />
        </View>
      ) : (
        <View style={styles.streakText}>
          <Text style={styles.streakMain}>
            {current} day{current === 1 ? '' : 's'} streak
          </Text>
          <Text style={styles.streakSub}>
            Best: {best} day{best === 1 ? '' : 's'} · one accepted sample a day keeps it alive
          </Text>
        </View>
      )}
    </View>
  );
}

function RankRow({ entry }: { entry: LeaderboardEntry }) {
  const medal = entry.rank >= 1 && entry.rank <= 3 ? MEDAL_COLORS[entry.rank - 1] : null;
  return (
    <View style={[styles.row, entry.isMe && styles.rowMe]}>
      <View style={[styles.rankBadge, medal ? { backgroundColor: medal } : null]}>
        <Text style={[styles.rankText, medal ? styles.rankTextMedal : null]}>{entry.rank}</Text>
      </View>
      <View style={styles.rowInfo}>
        <Text style={[styles.rowName, entry.isMe && styles.rowNameMe]} numberOfLines={1}>
          {entry.displayName}
          {entry.isMe ? ' (you)' : ''}
        </Text>
        <Text style={styles.rowMeta}>
          {entry.acceptedSamples} accepted
          {entry.streakDays > 1 ? ` · ${entry.streakDays}d streak` : ''}
        </Text>
      </View>
      <Text style={styles.rowEarned}>₹{entry.earnedInr}</Text>
    </View>
  );
}

export function FlameIcon({ size = 24, active = true }: { size?: number; active?: boolean }) {
  const color = active ? colors.primary : colors.textFaint;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2 C13 6 17 7.5 17 12 C17 15.9 14.9 19 12 19 C9.1 19 7 15.9 7 12 C7 10 8 8.5 9 7.5 C9 9.5 10 10.5 11 10.5 C10.4 8 10.8 4.5 12 2 Z"
        fill={color}
        opacity={0.25}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path
        d="M12 12 C12.8 13.5 14 14 14 15.7 C14 17.5 13.1 19 12 19 C10.9 19 10 17.5 10 15.7 C10 14 11.2 13.5 12 12 Z"
        fill={color}
      />
    </Svg>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  title: {
    color: colors.text,
    fontSize: font.h1,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  error: { color: colors.danger, fontSize: font.small, paddingHorizontal: spacing.md, marginTop: spacing.sm },
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    margin: spacing.md,
    gap: spacing.md,
  },
  streakText: { flex: 1 },
  streakSkeleton: { flex: 1 },
  streakSkeletonLine: { marginTop: spacing.sm },
  streakMain: { color: colors.text, fontSize: font.h3, fontWeight: '800' },
  streakSub: { color: colors.textDim, fontSize: font.tiny, marginTop: 2 },
  toggleRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md },
  toggle: {
    flex: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  toggleActive: { borderColor: colors.primary, backgroundColor: '#78350F' },
  toggleText: { color: colors.textDim, fontSize: font.small, fontWeight: '600' },
  toggleTextActive: { color: colors.primary },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  empty: { color: colors.textDim, fontSize: font.body, textAlign: 'center', marginTop: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm + 4,
    marginBottom: spacing.sm,
  },
  rowMe: { borderColor: colors.primary, backgroundColor: '#1F2937' },
  rankBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  rankText: { color: colors.textDim, fontSize: font.small, fontWeight: '800' },
  rankTextMedal: { color: '#0B1220' },
  rowInfo: { flex: 1, marginRight: spacing.sm },
  rowName: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  rowNameMe: { color: colors.primary },
  rowMeta: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
  rowEarned: { color: colors.success, fontSize: font.body, fontWeight: '700' },
  pinnedWrap: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
    backgroundColor: colors.bg,
  },
});
