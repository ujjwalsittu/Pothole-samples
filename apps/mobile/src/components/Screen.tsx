import React from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '@/theme';

interface Props {
  children: React.ReactNode;
  /** Scrollable content (default true). */
  scroll?: boolean;
  style?: ViewStyle;
  /** Remove default padding (e.g. full-bleed camera screens). */
  noPadding?: boolean;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}

/** Dark-themed safe-area screen wrapper used by every non-camera screen. */
export function Screen({ children, scroll = true, style, noPadding = false, edges }: Props) {
  const padding = noPadding ? undefined : styles.padded;
  return (
    <SafeAreaView style={styles.safe} edges={edges ?? ['top', 'left', 'right']}>
      {scroll ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[padding, styles.grow, style]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, padding, style]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  padded: { padding: spacing.md },
});
