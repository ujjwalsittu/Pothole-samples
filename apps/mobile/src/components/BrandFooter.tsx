import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing } from '@/theme';
import { APP_VERSION, POWERED_BY } from '@/shared';

/** "Powered by Threemates Tech Ventures" + version, used on splash/login/profile. */
export function BrandFooter() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.powered}>Powered by {POWERED_BY}</Text>
      <Text style={styles.version}>v{APP_VERSION}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: spacing.md },
  powered: { color: colors.textDim, fontSize: font.small },
  version: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing.xs },
});
