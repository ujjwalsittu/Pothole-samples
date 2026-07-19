import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, spacing } from '@/theme';
import type { QueueState } from '@/upload/db';
import type { SampleState } from '@/shared';

type Tone = 'neutral' | 'info' | 'success' | 'teal' | 'danger' | 'warning';

const TONE_COLORS: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: '#1E293B', fg: colors.textDim },
  info: { bg: '#0C4A6E', fg: '#7DD3FC' },
  success: { bg: '#14532D', fg: '#86EFAC' },
  teal: { bg: '#134E4A', fg: '#5EEAD4' },
  danger: { bg: '#7F1D1D', fg: '#FCA5A5' },
  warning: { bg: '#78350F', fg: '#FCD34D' },
};

export function StatChip({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const c = TONE_COLORS[tone];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]}>{label}</Text>
    </View>
  );
}

export function sampleStateChip(state: SampleState): { label: string; tone: Tone } {
  switch (state) {
    case 'draft':
      return { label: 'Draft', tone: 'neutral' };
    case 'uploading':
      return { label: 'Uploading', tone: 'info' };
    case 'uploaded':
      return { label: 'Uploaded', tone: 'info' };
    case 'pending_review':
      return { label: 'Pending review', tone: 'warning' };
    case 'accepted':
      return { label: 'Accepted', tone: 'success' };
    case 'partially_accepted':
      return { label: 'Partially accepted', tone: 'teal' };
    case 'auto_rejected':
      return { label: 'Auto-rejected', tone: 'danger' };
    case 'rejected':
      return { label: 'Rejected', tone: 'danger' };
  }
}

export function withdrawalStateChip(
  state: 'requested' | 'approved' | 'rejected' | 'paid',
): { label: string; tone: Tone } {
  switch (state) {
    case 'requested':
      return { label: 'Requested', tone: 'info' };
    case 'approved':
      return { label: 'Approved', tone: 'teal' };
    case 'rejected':
      return { label: 'Rejected', tone: 'danger' };
    case 'paid':
      return { label: 'Paid', tone: 'success' };
  }
}

export function queueStateChip(state: QueueState): { label: string; tone: Tone } {
  switch (state) {
    case 'draft':
      return { label: 'Queued', tone: 'neutral' };
    case 'initializing':
      return { label: 'Starting', tone: 'info' };
    case 'uploading':
      return { label: 'Uploading', tone: 'info' };
    case 'completing':
      return { label: 'Finalizing', tone: 'info' };
    case 'done':
      return { label: 'Uploaded', tone: 'success' };
    case 'failed':
      return { label: 'Failed', tone: 'warning' };
    case 'rejected':
      return { label: 'Rejected', tone: 'danger' };
  }
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  text: { fontSize: font.tiny, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
});
