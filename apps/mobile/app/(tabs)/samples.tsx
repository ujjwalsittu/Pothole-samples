import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Image, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatChip, sampleStateChip } from '@/components/StatChip';
import { SkeletonCard } from '@/components/Skeleton';
import { TabIcon } from '@/components/TabIcon';
import { getMySamples } from '@/api/endpoints';
import { getThumbUri } from '@/media/thumbs';
import { colors, font, radius, spacing } from '@/theme';
import type { Sample } from '@/shared';

export default function SamplesScreen() {
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSamples(await getMySamples());
      setError(null);
    } catch {
      setError('Could not load samples. Pull to retry.');
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
      <Text style={styles.title}>My samples</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {samples === null ? (
        <View style={styles.list}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      ) : (
        <FlatList
          data={samples}
          keyExtractor={(s) => s.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>No samples yet. Capture your first pothole from the dashboard.</Text>
          }
          renderItem={({ item }) => <SampleRow sample={item} />}
        />
      )}
    </SafeAreaView>
  );
}

/** Authed thumbnail with local cache; falls back to the samples glyph. */
function SampleThumb({ sampleId }: { sampleId: string }) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    void getThumbUri(sampleId).then((u) => {
      if (mounted) setUri(u);
    });
    return () => {
      mounted = false;
    };
  }, [sampleId]);

  if (!uri) {
    return (
      <View style={[styles.thumb, styles.thumbFallback]}>
        <TabIcon name="samples" color={colors.textFaint} size={22} />
      </View>
    );
  }
  return <Image source={{ uri }} style={styles.thumb} />;
}

function SampleRow({ sample }: { sample: Sample }) {
  const chip = sampleStateChip(sample.state);
  const isRejected = sample.state === 'rejected' || sample.state === 'auto_rejected';
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <SampleThumb sampleId={sample.id} />
        <View style={styles.rowBody}>
          <View style={styles.rowHeader}>
            <Text style={styles.rowTitle}>
              {sample.mediaType === 'photo' ? 'Photo' : 'Video'}
              {sample.mediaType === 'video' && sample.durationSec != null
                ? ` · ${Math.round(sample.durationSec)}s`
                : ''}
              {` · ${sample.potholeCount} pothole${sample.potholeCount === 1 ? '' : 's'}`}
            </Text>
            <StatChip label={chip.label} tone={chip.tone} />
          </View>
          <Text style={styles.rowMeta}>
            {new Date(sample.capturedAt).toLocaleString()} · {sample.lat.toFixed(5)},{' '}
            {sample.lng.toFixed(5)}
          </Text>
        </View>
      </View>
      {sample.state === 'partially_accepted' ? (
        <View style={styles.partialBox}>
          <Text style={styles.partialText}>
            Some annotations were adjusted by the reviewer — full credit granted.
          </Text>
        </View>
      ) : null}
      {isRejected ? (
        <View style={styles.rejectBox}>
          {sample.rejectionReason ? (
            <Text style={styles.rejectReason}>Reason: {sample.rejectionReason}</Text>
          ) : null}
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
  title: {
    color: colors.text,
    fontSize: font.h1,
    fontWeight: '700',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  error: { color: colors.danger, fontSize: font.small, paddingHorizontal: spacing.md, marginTop: spacing.sm },
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
  rowTop: { flexDirection: 'row', alignItems: 'center' },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.sm,
    marginRight: spacing.sm + 2,
    backgroundColor: colors.cardAlt,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBody: { flex: 1 },
  rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowTitle: { color: colors.text, fontSize: font.body, fontWeight: '600', flex: 1, marginRight: spacing.sm },
  rowMeta: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing.xs },
  partialBox: {
    marginTop: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: '#134E4A33',
    borderWidth: 1,
    borderColor: '#134E4A',
    padding: spacing.sm,
  },
  partialText: { color: '#5EEAD4', fontSize: font.tiny },
  rejectBox: {
    marginTop: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: '#7F1D1D22',
    borderWidth: 1,
    borderColor: '#7F1D1D',
    padding: spacing.sm,
  },
  rejectReason: { color: '#FCA5A5', fontSize: font.small },
  rejectNote: { color: colors.textDim, fontSize: font.tiny, marginTop: spacing.xs, fontStyle: 'italic' },
});
