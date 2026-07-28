import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { colors } from '@/theme';

/** Streak flame — shared by the Ranks tab and the dashboard streak chip. */
export function FlameIcon({ size = 24, active = true }: { size?: number; active?: boolean }) {
  const color = active ? colors.primary : colors.textFaint;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2 C13 6 17 7.5 17 12 C17 15.9 14.9 19 12 19 C9.1 19 7 15.9 7 12 C7 10 8 8.5 9 7.5 C9 9.5 10 10.5 11 10.5 C10.4 8 10.8 4.5 12 2 Z"
        fill={color}
        opacity={0.25}
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Path
        d="M12 12 C12.8 13.5 14 14 14 15.7 C14 17.5 13.1 19 12 19 C10.9 19 10 17.5 10 15.7 C10 14 11.2 13.5 12 12 Z"
        fill={color}
      />
    </Svg>
  );
}
