import React, { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { colors, font, radius, spacing } from '@/theme';
import { SPEED } from '@/shared';
import { useCountUp } from '@/hooks/useCountUp';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedLine = Animated.createAnimatedComponent(Line);

interface Props {
  /** True measured speed in km/h (stored untouched in the GPS track). */
  actualKmph: number;
  size?: number;
}

const CX = 50;
const CY = 54;
const R_ARC = 42.5;
const R_NEEDLE = 34;
const SWEEP_DEG = 240; // -120..+120
const ARC_LEN = (R_ARC * Math.PI * SWEEP_DEG) / 180;

/**
 * Record-mode speed gauge. The DISPLAYED value is capped at
 * SPEED.DISPLAYED_CAP_KMPH — the UI never shows a number above 60 and the
 * label always reads "Max: 60 km/h". There is no minimum speed. The needle
 * and arc interpolate smoothly between GPS ticks (reanimated) instead of
 * jumping once per second.
 */
export function Speedometer({ actualKmph, size = 120 }: Props) {
  const displayedTarget = Math.max(0, Math.min(actualKmph, SPEED.DISPLAYED_CAP_KMPH));
  const targetFrac = displayedTarget / SPEED.DISPLAYED_CAP_KMPH;

  const frac = useSharedValue(0);
  useEffect(() => {
    // Ease toward the newest GPS reading over roughly one sample interval.
    frac.value = withTiming(targetFrac, {
      duration: SPEED.GPS_SAMPLE_INTERVAL_MS * 0.9,
      easing: Easing.out(Easing.quad),
    });
  }, [targetFrac, frac]);

  const arcProps = useAnimatedProps(() => ({
    strokeDashoffset: ARC_LEN * (1 - frac.value),
  }));

  const needleProps = useAnimatedProps(() => {
    const angle = -120 + frac.value * SWEEP_DEG;
    const rad = ((angle - 90) * Math.PI) / 180;
    return {
      x2: CX + R_NEEDLE * Math.cos(rad),
      y2: CY + R_NEEDLE * Math.sin(rad),
    };
  });

  // Smooth the numeric readout too (never above the cap).
  const displayedNumber = Math.min(
    useCountUp(Math.round(displayedTarget), 800),
    SPEED.DISPLAYED_CAP_KMPH,
  );

  // Over the hidden hard limit → the gauge turns red (no number above 60 is ever shown).
  const overLimit = actualKmph > SPEED.MAX_KMPH;
  const arcColor = overLimit ? colors.danger : colors.primary;

  const ticks = [];
  for (let i = 0; i <= 6; i++) {
    const a = -120 + (i / 6) * SWEEP_DEG;
    const tRad = ((a - 90) * Math.PI) / 180;
    ticks.push(
      <Line
        key={i}
        x1={CX + 40 * Math.cos(tRad)}
        y1={CY + 40 * Math.sin(tRad)}
        x2={CX + 45 * Math.cos(tRad)}
        y2={CY + 45 * Math.sin(tRad)}
        stroke={colors.textDim}
        strokeWidth={1.5}
      />,
    );
  }

  return (
    <View style={[styles.wrap, overLimit && styles.wrapOver]}>
      <Svg width={size} height={size * 0.82} viewBox="0 0 100 82">
        <Path
          d={describeArc(CX, CY, R_ARC, -120, 120)}
          stroke={colors.border}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
        />
        <AnimatedPath
          d={describeArc(CX, CY, R_ARC, -120, 120)}
          stroke={arcColor}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${ARC_LEN} ${ARC_LEN}`}
          animatedProps={arcProps}
        />
        {ticks}
        <AnimatedLine
          x1={CX}
          y1={CY}
          x2={CX}
          y2={CY - R_NEEDLE}
          stroke={colors.text}
          strokeWidth={2.5}
          strokeLinecap="round"
          animatedProps={needleProps}
        />
        <Circle cx={CX} cy={CY} r={4} fill={arcColor} />
      </Svg>
      <Text style={styles.value}>
        {displayedNumber}
        <Text style={styles.unit}> km/h</Text>
      </Text>
      <Text style={styles.target}>Max: {SPEED.DISPLAYED_CAP_KMPH} km/h</Text>
    </View>
  );
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  // Path runs start -> end so the dashoffset animation fills from the left.
  const start = polar(cx, cy, r, startDeg);
  const end = polar(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? '1' : '0';
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
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
  wrapOver: { borderColor: colors.danger },
  value: { color: colors.text, fontSize: font.h2, fontWeight: '800', marginTop: -spacing.sm },
  unit: { color: colors.textDim, fontSize: font.small, fontWeight: '400' },
  target: { color: colors.textDim, fontSize: font.tiny, marginTop: 2 },
});
