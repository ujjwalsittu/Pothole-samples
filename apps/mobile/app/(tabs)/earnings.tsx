import React, { useCallback, useState } from 'react';
import { FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SkeletonCard } from '@/components/Skeleton';
import { getLedger, type LedgerResponse, type LedgerRow } from '@/api/endpoints';
import { colors, font, radius, spacing } from '@/theme';

export default function EarningsScreen() {
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLedger(await getLedger());
      setError(null);
    } catch {
      setError('Could not load earnings. Pull to retry.');
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Text style={styles.title}>Earnings</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.summaryRow}>
        <SummaryCard label="Earned" value={ledger?.earnedInr ?? 0} color={colors.success} />
        <SummaryCard label="Settled" value={ledger?.settledInr ?? 0} color={colors.info} />
        <SummaryCard label="Balance" value={ledger?.balanceInr ?? 0} color={colors.primary} />
      </View>

      {ledger === null ? (
        <View style={styles.list}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : (
        <FlatList
          data={ledger.entries}
          keyExtractor={(e) => e.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No ledger entries yet. Accepted samples appear here.</Text>
          }
          renderItem={({ item }) => <LedgerRowView row={item} />}
        />
      )}
    </SafeAreaView>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={[styles.summaryValue, { color }]}>₹{value}</Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function LedgerRowView({ row }: { row: LedgerRow }) {
  const isEarning = row.type === 'earning';
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowType}>{isEarning ? 'Earning' : 'Settlement'}</Text>
        <Text style={styles.rowMeta}>{new Date(row.createdAt).toLocaleDateString()}</Text>
        {row.note ? <Text style={styles.rowNote}>{row.note}</Text> : null}
        {!isEarning && row.utrReference ? (
          <Text style={styles.rowUtr}>UTR: {row.utrReference}</Text>
        ) : null}
        {!isEarning && row.proofUrl ? (
          <Pressable onPress={() => void Linking.openURL(row.proofUrl as string)}>
            <Text style={styles.rowProof}>View payment proof</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.rowRight}>
        <Text style={[styles.rowAmount, { color: isEarning ? colors.success : colors.info }]}>
          {row.amountInr >= 0 ? '+' : ''}
          ₹{row.amountInr}
        </Text>
        <Text style={styles.rowBalance}>bal ₹{row.balanceInr}</Text>
      </View>
    </View>
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
  summaryRow: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  summaryValue: { fontSize: font.h3, fontWeight: '800' },
  summaryLabel: { color: colors.textDim, fontSize: font.tiny, marginTop: 2 },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  empty: { color: colors.textDim, fontSize: font.body, textAlign: 'center', marginTop: spacing.xl },
  row: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowLeft: { flex: 1 },
  rowRight: { alignItems: 'flex-end', justifyContent: 'center' },
  rowType: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  rowMeta: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
  rowNote: { color: colors.textDim, fontSize: font.small, marginTop: spacing.xs },
  rowUtr: { color: colors.textDim, fontSize: font.tiny, marginTop: spacing.xs },
  rowProof: { color: colors.info, fontSize: font.small, marginTop: spacing.xs, textDecorationLine: 'underline' },
  rowAmount: { fontSize: font.h3, fontWeight: '800' },
  rowBalance: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
});
