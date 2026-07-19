import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Ellipse, Line, Path } from 'react-native-svg';
import { colors, font } from '@/theme';
import { APP_NAME } from '@/shared';

interface Props {
  /** Glyph size in px (square). */
  size?: number;
  /** Show the "PotholeCollect" wordmark under the glyph. */
  wordmark?: boolean;
}

/** Brand glyph: perspective road with an amber-ringed pothole (inline SVG). */
export function Logo({ size = 96, wordmark = false }: Props) {
  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        {/* road trapezoid */}
        <Path
          d="M22 92 L40 10 L60 10 L78 92 Z"
          fill={colors.card}
          stroke={colors.primary}
          strokeWidth={5}
          strokeLinejoin="round"
        />
        {/* dashed center line */}
        <Line
          x1={50}
          y1={14}
          x2={50}
          y2={88}
          stroke={colors.primary}
          strokeWidth={4}
          strokeDasharray="9 8"
        />
        {/* pothole */}
        <Ellipse
          cx={55}
          cy={64}
          rx={14}
          ry={7.5}
          fill={colors.pothole}
          stroke={colors.primary}
          strokeWidth={4}
        />
      </Svg>
      {wordmark ? (
        <Text style={styles.word}>
          Pothole
          <Text style={styles.wordAccent}>Collect</Text>
        </Text>
      ) : null}
    </View>
  );
}

export { APP_NAME };

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  word: {
    marginTop: 12,
    color: colors.text,
    fontSize: font.h1,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  wordAccent: { color: colors.primary },
});
