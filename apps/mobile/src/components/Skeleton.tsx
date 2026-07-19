import React, { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius, spacing } from '@/theme';

interface Props {
  width?: DimensionValue;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
}

/** Pulsing placeholder block for loading states. */
export function Skeleton({ width = '100%', height = 16, borderRadius = radius.sm, style }: Props) {
  const pulse = useSharedValue(0.4);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[{ width, height, borderRadius, backgroundColor: colors.border }, animated, style]}
    />
  );
}

/** Card-shaped skeleton for list rows (samples / earnings). */
export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Skeleton width="55%" height={16} />
        <Skeleton width={72} height={18} borderRadius={radius.pill} />
      </View>
      <Skeleton width="80%" height={11} style={styles.line} />
      <Skeleton width="40%" height={11} style={styles.line} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  line: { marginTop: spacing.sm },
});
