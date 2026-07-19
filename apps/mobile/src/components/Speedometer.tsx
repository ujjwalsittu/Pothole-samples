import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { colors, font, radius, spacing } from '@/theme';
import { SPEED } from '@/shared';

interface Props {
  /** True measured speed in km/h (stored untouched in the GPS track). */
  actualKmph: number;
  size?: number;
}

/**
 * Record-mode speed gauge. The DISPLAYED value is capped at
 * SPEED.DISPLAYED_CAP_KMPH — the UI never shows a number above 60 and the
 * target label always reads 60 km/h. True speeds still go into the track.
 */
export function Speedometer({ actualKmph, size = 120 }: Props) {
  const displayed = Math.max(0, Math.min(actualKmph, SPEED.DISPLAYED_CAP_KMPH));
  // Gauge sweep: -120deg..+120deg over 0..DISPLAYED_CAP.
  const frac = displayed / SPEED.DISPLAYED_CAP_KMPH;
  const angle = -120 + frac * 240;
  const rad = ((angle - 90) * Math.PI) / 180;
  const cx = 50;
  const cy = 54;
  const rNeedle = 34;
  const nx = cx + rNeedle * Math.cos(rad);
  const ny = cy + rNeedle * Math.sin(rad);

  const ticks = [];
  for (let i = 0; i <= 6; i++) {
    const a = -120 + (i / 6) * 240;
    const r1 = 40;
    const r2 = 45;
    const tRad = ((a - 90) * Math.PI) / 180;
    ticks.push(
      <Line
        key={i}
        x1={cx + r1 * Math.cos(tRad)}
        y1={cy + r1 * Math.sin(tRad)}
        x2={cx + r2 * Math.cos(tRad)}
        y2={cy + r2 * Math.sin(tRad)}
        stroke={colors.textDim}
        strokeWidth={1.5}
      />,
    );
  }

  const inBand = actualKmph >= SPEED.MIN_KMPH && actualKmph <= SPEED.MAX_KMPH;

  return (
    <View style={styles.wrap}>
      <Svg width={size} height={size * 0.82} viewBox="0 0 100 82">
        <Path
          d={describeArc(cx, cy, 42.5, -120, 120)}
          stroke={colors.border}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
        />
        <Path
          d={describeArc(cx, cy, 42.5, -120, -120 + frac * 240)}
          stroke={inBand ? colors.success : colors.primary}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
        />
        {ticks}
        <Line x1={cx} y1={cy} x2={nx} y2={ny} stroke={colors.text} strokeWidth={2.5} strokeLinecap="round" />
        <Circle cx={cx} cy={cy} r={4} fill={colors.primary} />
      </Svg>
      <Text style={styles.value}>
        {Math.round(displayed)}
        <Text style={styles.unit}> km/h</Text>
      </Text>
      <Text style={styles.target}>Target: {SPEED.DISPLAYED_CAP_KMPH} km/h</Text>
    </View>
  );
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, endDeg);
  const end = polar(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg <= 180 ? '0' : '1';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    backgroundColor: 'rgba(11,18,32,0.75)',
    borderRadius: radius.lg,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  value: { color: colors.text, fontSize: font.h2, fontWeight: '800', marginTop: -spacing.sm },
  unit: { color: colors.textDim, fontSize: font.small, fontWeight: '400' },
  target: { color: colors.textDim, fontSize: font.tiny, marginTop: 2 },
});
