import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, spacing } from '@/theme';

interface Props {
  /** 0..1 */
  progress: number;
  label?: string;
  /** e.g. "3 / 10" shown at the right edge. */
  valueText?: string;
  color?: string;
}

export function ProgressBar({ progress, label, valueText, color = colors.primary }: Props) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.wrap}>
      {(label || valueText) && (
        <View style={styles.row}>
          {label ? <Text style={styles.label}>{label}</Text> : <View />}
          {valueText ? <Text style={styles.value}>{valueText}</Text> : null}
        </View>
      )}
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: spacing.xs },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  label: { color: colors.textDim, fontSize: font.small },
  value: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill },
});
