import React from 'react';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { colors, font, radius, spacing } from '@/theme';

interface Props {
  hint: string | null;
}

/** Non-blocking amber guidance pill used on the capture screens. */
export function GuidanceBanner({ hint }: Props) {
  if (!hint) return null;
  return (
    <Animated.View
      key={hint}
      entering={FadeInDown.springify().damping(16)}
      exiting={FadeOutUp.duration(180)}
      pointerEvents="none"
      style={styles.pill}
    >
      <Text style={styles.text}>{hint}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    backgroundColor: 'rgba(120,53,15,0.92)',
    borderColor: colors.primary,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  text: { color: colors.warning, fontSize: font.small, fontWeight: '700', textAlign: 'center' },
});
