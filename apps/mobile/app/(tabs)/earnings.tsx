import React, { useCallback, useState } from 'react';
import {
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SkeletonCard } from '@/components/Skeleton';
import { Button } from '@/components/Button';
import { StatChip, withdrawalStateChip } from '@/components/StatChip';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/auth/AuthContext';
import { ApiError } from '@/api/client';
import {
  createWithdrawal,
  getDashboardStats,
  getLedger,
  getWithdrawals,
  type LedgerResponse,
  type LedgerRow,
} from '@/api/endpoints';
import { colors, font, radius, spacing } from '@/theme';
import type { DashboardStats, WithdrawalRequest } from '@/shared';

const UPI_REGEX = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/;

const TRACK_NOTE =
  'Earnings activate only when a full track completes — e.g. 19 of 20 photos pays nothing until the 20th is accepted.';

export default function EarningsScreen() {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const [ledger, setLedger] = useState<LedgerResponse | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ledgerRes, statsRes, withdrawalsRes] = await Promise.all([
        getLedger(),
        getDashboardStats(),
        getWithdrawals(),
      ]);
      setLedger(ledgerRes);
      setStats(statsRes);
      setWithdrawals(withdrawalsRes);
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

  if (!profile?.isCollector) {
    // The tab is hidden for non-collectors; guard direct navigation anyway.
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <Text style={styles.empty}>Earnings are available to collectors only.</Text>
      </SafeAreaView>
    );
  }

  const activeInr = stats?.activeInr ?? 0;
  const upcomingInr = stats?.upcomingInr ?? 0;

  const header = (
    <View>
      <View style={styles.summaryRow}>
        <SummaryCard label="Earned" value={ledger?.earnedInr ?? 0} color={colors.success} />
        <SummaryCard label="Settled" value={ledger?.settledInr ?? 0} color={colors.info} />
      </View>
      <View style={styles.summaryRow}>
        <View style={[styles.balanceCard, styles.activeCard]}>
          <Text style={styles.balanceValue}>₹{activeInr}</Text>
          <Text style={styles.balanceLabel}>Active — withdrawable now</Text>
          <Button
            title="Request withdrawal"
            onPress={() => setModalOpen(true)}
            disabled={activeInr <= 0}
            style={styles.withdrawBtn}
          />
        </View>
        <View style={styles.balanceCard}>
          <Text style={[styles.balanceValue, styles.upcomingValue]}>₹{upcomingInr}</Text>
          <Text style={styles.balanceLabel}>Upcoming — unlocks when a track completes</Text>
        </View>
      </View>
      <Text style={styles.trackNote}>{TRACK_NOTE}</Text>

      <Text style={styles.sectionTitle}>Withdrawal requests</Text>
      {withdrawals === null ? (
        <SkeletonCard />
      ) : withdrawals.length === 0 ? (
        <Text style={styles.emptySection}>No withdrawal requests yet.</Text>
      ) : (
        withdrawals.map((w) => <WithdrawalRow key={w.id} w={w} />)
      )}

      <Text style={styles.sectionTitle}>Ledger</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Text style={styles.title}>Earnings</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

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
          ListHeaderComponent={header}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <Text style={styles.emptySection}>No ledger entries yet. Accepted samples appear here.</Text>
          }
          renderItem={({ item }) => <LedgerRowView row={item} />}
        />
      )}

      <WithdrawModal
        visible={modalOpen}
        activeInr={activeInr}
        initialUpi={profile?.upiId ?? ''}
        onClose={() => setModalOpen(false)}
        onSubmitted={(w) => {
          setModalOpen(false);
          toast.show(`Withdrawal of ₹${w.amountInr} requested.`, 'success');
          void refreshProfile(); // server records UPI on first request
          void load();
        }}
      />
    </SafeAreaView>
  );
}

function WithdrawModal({
  visible,
  activeInr,
  initialUpi,
  onClose,
  onSubmitted,
}: {
  visible: boolean;
  activeInr: number;
  initialUpi: string;
  onClose: () => void;
  onSubmitted: (w: WithdrawalRequest) => void;
}) {
  const [amountText, setAmountText] = useState('');
  const [upi, setUpi] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  // (Re)seed the fields each time the modal opens.
  if (visible && !initialized) {
    setAmountText(String(activeInr));
    setUpi(initialUpi);
    setError(null);
    setInitialized(true);
  } else if (!visible && initialized) {
    setInitialized(false);
  }

  const amount = parseInt(amountText, 10) || 0;

  const submit = async () => {
    setError(null);
    if (amount <= 0) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (amount > activeInr) {
      setError(
        `Only ₹${activeInr} is active right now. Upcoming earnings unlock when a full track completes.`,
      );
      return;
    }
    if (!UPI_REGEX.test(upi.trim())) {
      setError('Enter a valid UPI ID, e.g. name@bank');
      return;
    }
    setSubmitting(true);
    try {
      const w = await createWithdrawal({ amountInr: amount, upiId: upi.trim() });
      onSubmitted(w);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EXCEEDS_ACTIVE_BALANCE') {
        setError(
          'That exceeds your active balance. Upcoming earnings unlock only when a full track completes — finish the track and try again.',
        );
      } else if (e instanceof ApiError && e.code === 'NOT_A_COLLECTOR') {
        setError('Withdrawals are available to collectors only.');
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not submit the request. Try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalScrim}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Request withdrawal</Text>
          <Text style={styles.modalHint}>Active balance: ₹{activeInr}</Text>

          <Text style={styles.modalLabel}>Amount (₹)</Text>
          <TextInput
            style={styles.modalInput}
            value={amountText}
            onChangeText={(v) => setAmountText(v.replace(/[^\d]/g, ''))}
            keyboardType="number-pad"
            placeholder={`up to ${activeInr}`}
            placeholderTextColor={colors.textFaint}
          />

          <Text style={styles.modalLabel}>UPI ID</Text>
          <TextInput
            style={styles.modalInput}
            value={upi}
            onChangeText={setUpi}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="name@bank"
            placeholderTextColor={colors.textFaint}
          />

          <Text style={styles.modalNote}>{TRACK_NOTE}</Text>
          {error ? <Text style={styles.modalError}>{error}</Text> : null}

          <View style={styles.modalRow}>
            <Button title="Submit" onPress={() => void submit()} loading={submitting} style={styles.modalBtn} />
            <Button title="Cancel" variant="secondary" onPress={onClose} style={styles.modalBtn} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function WithdrawalRow({ w }: { w: WithdrawalRequest }) {
  const chip = withdrawalStateChip(w.state);
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.rowType}>₹{w.amountInr} to {w.upiId}</Text>
        <Text style={styles.rowMeta}>{new Date(w.createdAt).toLocaleDateString()}</Text>
        {w.note ? <Text style={styles.rowNote}>{w.note}</Text> : null}
      </View>
      <View style={styles.rowRight}>
        <StatChip label={chip.label} tone={chip.tone} />
      </View>
    </View>
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
  summaryRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
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
  balanceCard: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    alignItems: 'center',
  },
  activeCard: { borderColor: colors.primary },
  balanceValue: { color: colors.primary, fontSize: font.h2, fontWeight: '800' },
  upcomingValue: { color: colors.info },
  balanceLabel: {
    color: colors.textDim,
    fontSize: font.tiny,
    marginTop: 2,
    textAlign: 'center',
  },
  withdrawBtn: { marginTop: spacing.sm, alignSelf: 'stretch' },
  trackNote: {
    color: colors.textFaint,
    fontSize: font.tiny,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  sectionTitle: {
    color: colors.text,
    fontSize: font.h3,
    fontWeight: '700',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  emptySection: { color: colors.textDim, fontSize: font.small, marginBottom: spacing.sm },
  empty: { color: colors.textDim, fontSize: font.body, textAlign: 'center', marginTop: spacing.xl },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
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
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(3,7,15,0.8)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: colors.cardAlt,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  modalTitle: { color: colors.text, fontSize: font.h2, fontWeight: '800' },
  modalHint: { color: colors.textDim, fontSize: font.small, marginTop: spacing.xs },
  modalLabel: { color: colors.textDim, fontSize: font.small, marginTop: spacing.md, marginBottom: spacing.xs },
  modalInput: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.body,
  },
  modalNote: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing.md, fontStyle: 'italic' },
  modalError: { color: colors.danger, fontSize: font.small, marginTop: spacing.sm },
  modalRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  modalBtn: { flex: 1 },
});
