import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { colors, font, radius, spacing } from '@/theme';

/**
 * On-camera framing guide: dashed target frame over the lower 2/3 of the
 * viewfinder plus the content rules banner.
 */
export function GuidelinesOverlay() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 100" preserveAspectRatio="none">
        {/* framing rectangle over the road area */}
        <Rect
          x={6}
          y={38}
          width={88}
          height={56}
          fill="none"
          stroke={colors.primary}
          strokeWidth={0.8}
          strokeDasharray="3 2"
          rx={2}
        />
        {/* horizon hint */}
        <Path d="M0 36 L100 36" stroke="rgba(245,158,11,0.35)" strokeWidth={0.5} />
      </Svg>
      <View style={styles.banner}>
        <Text style={styles.title}>Point at the road surface.</Text>
        <Text style={styles.subtitle}>
          Avoid trees, buildings, vehicles, people, animals, signboards.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: spacing.xl + spacing.md,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(11,18,32,0.75)',
    borderRadius: radius.md,
    padding: spacing.sm + 2,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
  },
  title: { color: colors.text, fontSize: font.small, fontWeight: '700', textAlign: 'center' },
  subtitle: {
    color: colors.textDim,
    fontSize: font.tiny,
    textAlign: 'center',
    marginTop: 2,
  },
});
