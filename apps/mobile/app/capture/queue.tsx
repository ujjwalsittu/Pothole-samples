import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatChip, queueStateChip } from '@/components/StatChip';
import { ProgressBar } from '@/components/ProgressBar';
import { Button } from '@/components/Button';
import { uploadManager } from '@/upload/manager';
import { parseMeta, type QueueItem } from '@/upload/db';
import { colors, font, radius, spacing } from '@/theme';

export default function QueueScreen() {
  const router = useRouter();
  const [items, setItems] = useState<QueueItem[]>(() => uploadManager.getQueue());
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const unsub = uploadManager.subscribe(() => setItems(uploadManager.getQueue()));
    void uploadManager.kick();
    return unsub;
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await uploadManager.kick();
    setItems(uploadManager.getQueue());
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <Text style={styles.title}>Upload queue</Text>
        <Pressable onPress={() => router.replace('/(tabs)/dashboard')}>
          <Text style={styles.done}>Done</Text>
        </Pressable>
      </View>
      <FlatList
        data={[...items].reverse()}
        keyExtractor={(i) => i.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />
        }
        ListEmptyComponent={<Text style={styles.empty}>Nothing in the queue.</Text>}
        renderItem={({ item }) => <QueueRow item={item} />}
      />
    </SafeAreaView>
  );
}

function QueueRow({ item }: { item: QueueItem }) {
  const meta = parseMeta(item);
  const chip = queueStateChip(item.state);
  const progress = item.totalChunks > 0 ? item.uploadedChunks / item.totalChunks : 0;
  const uploadingish = ['initializing', 'uploading', 'completing'].includes(item.state);

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowTitle}>
          {meta.mediaType === 'photo' ? 'Photo' : 'Video'} · {meta.potholeCount} pothole
          {meta.potholeCount === 1 ? '' : 's'}
        </Text>
        <StatChip label={chip.label} tone={chip.tone} />
      </View>
      <Text style={styles.rowMeta}>
        {new Date(item.createdAt).toLocaleString()} · {(meta.sizeBytes / (1024 * 1024)).toFixed(1)} MB
      </Text>

      {uploadingish || item.state === 'draft' || item.state === 'failed' ? (
        <ProgressBar
          progress={progress}
          valueText={`${item.uploadedChunks} / ${item.totalChunks} chunks`}
          color={item.state === 'failed' ? colors.warning : colors.primary}
        />
      ) : null}

      {item.state === 'failed' ? (
        <>
          {item.error ? <Text style={styles.failText}>{item.error}</Text> : null}
          <Button
            title="Retry upload"
            variant="secondary"
            onPress={() => uploadManager.retry(item.id)}
            style={styles.retryBtn}
          />
        </>
      ) : null}

      {item.state === 'rejected' ? (
        <View style={styles.rejectBox}>
          <Text style={styles.rejectText}>{item.error ?? 'Sample rejected by server checks.'}</Text>
          <Text style={styles.rejectNote}>
            Rejected samples cannot be re-uploaded — capture a new sample.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  title: { color: colors.text, fontSize: font.h1, fontWeight: '700' },
  done: { color: colors.primary, fontSize: font.body, fontWeight: '700' },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  empty: { color: colors.textDim, fontSize: font.body, textAlign: 'center', marginTop: spacing.xl },
  row: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '600', flex: 1, marginRight: spacing.sm },
  rowMeta: { color: colors.textFaint, fontSize: font.tiny, marginVertical: spacing.xs },
  failText: { color: colors.warning, fontSize: font.small, marginTop: spacing.xs },
  retryBtn: { marginTop: spacing.sm },
  rejectBox: {
    marginTop: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: '#7F1D1D22',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    padding: spacing.sm,
  },
  rejectText: { color: '#FCA5A5', fontSize: font.small },
  rejectNote: { color: colors.textDim, fontSize: font.tiny, marginTop: spacing.xs, fontStyle: 'italic' },
});
