import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { colors, font, radius, spacing } from '@/theme';

interface Props {
  /** 0..1 */
  progress: number;
  label?: string;
  /** e.g. "3 / 10" shown at the right edge. */
  valueText?: string;
  color?: string;
}

/** Progress bar whose fill springs to its value. */
export function ProgressBar({ progress, label, valueText, color = colors.primary }: Props) {
  const clamped = Math.max(0, Math.min(1, progress));
  const anim = useSharedValue(0);

  useEffect(() => {
    anim.value = withSpring(clamped, { damping: 18, stiffness: 120 });
  }, [clamped, anim]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${anim.value * 100}%`,
  }));

  return (
    <View style={styles.wrap}>
      {(label || valueText) && (
        <View style={styles.row}>
          {label ? <Text style={styles.label}>{label}</Text> : <View />}
          {valueText ? <Text style={styles.value}>{valueText}</Text> : null}
        </View>
      )}
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: color }, fillStyle]} />
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
