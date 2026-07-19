import React, { useCallback, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  adminApproveUser,
  adminPendingSamplesCount,
  adminPendingUsers,
  adminRejectUser,
} from '@/api/endpoints';
import { useAuth } from '@/auth/AuthContext';
import { ApiError } from '@/api/client';
import { colors, font, radius, spacing } from '@/theme';
import type { User } from '@/shared';

export default function AdminScreen() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'owner';

  const [pendingUsers, setPendingUsers] = useState<User[]>([]);
  const [pendingSamples, setPendingSamples] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [users, count] = await Promise.all([adminPendingUsers(), adminPendingSamplesCount()]);
      setPendingUsers(users);
      setPendingSamples(count.pendingReview);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load admin data.');
    }
  }, [isAdmin]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const act = async (user: User, action: 'approve' | 'reject') => {
    try {
      if (action === 'approve') await adminApproveUser(user.id);
      else await adminRejectUser(user.id, 'Rejected from mobile admin');
      await load();
    } catch (e) {
      Alert.alert('Failed', e instanceof ApiError ? e.message : 'Action failed.');
    }
  };

  const confirmReject = (user: User) => {
    Alert.alert('Reject user', `Reject ${user.fullName}? They will not be able to collect.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reject', style: 'destructive', onPress: () => void act(user, 'reject') },
    ]);
  };

  if (!isAdmin) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
        <Text style={styles.empty}>Admin access required.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <Text style={styles.title}>Admin</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Samples pending review</Text>
        <Text style={styles.bigNumber}>{pendingSamples ?? '—'}</Text>
        <Text style={styles.note}>
          Full sample review (media, annotations, dedup evidence) happens on the web dashboard.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>Pending users</Text>
      <FlatList
        data={pendingUsers}
        keyExtractor={(u) => u.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={<Text style={styles.empty}>No users waiting for approval.</Text>}
        renderItem={({ item }) => (
          <View style={styles.userRow}>
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{item.fullName}</Text>
              <Text style={styles.userMeta}>
                {item.email} · {item.collectorStatus}
              </Text>
            </View>
            <Pressable style={[styles.actBtn, styles.approve]} onPress={() => void act(item, 'approve')}>
              <Text style={styles.approveText}>Approve</Text>
            </Pressable>
            <Pressable style={[styles.actBtn, styles.reject]} onPress={() => confirmReject(item)}>
              <Text style={styles.rejectText}>Reject</Text>
            </Pressable>
          </View>
        )}
      />
    </SafeAreaView>
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
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    margin: spacing.md,
    alignItems: 'center',
  },
  cardTitle: { color: colors.textDim, fontSize: font.small },
  bigNumber: { color: colors.primary, fontSize: 40, fontWeight: '800', marginVertical: spacing.xs },
  note: { color: colors.textFaint, fontSize: font.tiny, textAlign: 'center' },
  sectionTitle: {
    color: colors.text,
    fontSize: font.h3,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  empty: { color: colors.textDim, fontSize: font.body, textAlign: 'center', marginTop: spacing.lg },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  userInfo: { flex: 1, marginRight: spacing.sm },
  userName: { color: colors.text, fontSize: font.body, fontWeight: '600' },
  userMeta: { color: colors.textFaint, fontSize: font.tiny, marginTop: 2 },
  actBtn: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 8,
    marginLeft: spacing.xs,
  },
  approve: { backgroundColor: colors.success },
  reject: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.danger },
  approveText: { color: '#052E16', fontSize: font.small, fontWeight: '700' },
  rejectText: { color: colors.danger, fontSize: font.small, fontWeight: '700' },
});
