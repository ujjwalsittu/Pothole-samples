import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type TabIconName = 'dashboard' | 'samples' | 'earnings' | 'profile' | 'admin';

interface Props {
  name: TabIconName;
  color: string;
  size?: number;
}

/** Minimal line icons for the tab bar (no icon-font dependency). */
export function TabIcon({ name, color, size = 24 }: Props) {
  const s = { stroke: color, strokeWidth: 1.8, fill: 'none' as const, strokeLinecap: 'round' as const };
  switch (name) {
    case 'dashboard':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x={3} y={3} width={8} height={8} rx={2} {...s} />
          <Rect x={13} y={3} width={8} height={5} rx={2} {...s} />
          <Rect x={13} y={10} width={8} height={11} rx={2} {...s} />
          <Rect x={3} y={13} width={8} height={8} rx={2} {...s} />
        </Svg>
      );
    case 'samples':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect x={3} y={5} width={18} height={14} rx={2} {...s} />
          <Circle cx={9} cy={11} r={2} {...s} />
          <Path d="M3 17 L9 13 L13 16 L17 12 L21 15" {...s} strokeLinejoin="round" />
        </Svg>
      );
    case 'earnings':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          {/* rupee glyph */}
          <Path d="M7 4 H17 M7 8 H17 M7 4 C13 4 13 11 7 11 L15 20" {...s} strokeLinejoin="round" />
        </Svg>
      );
    case 'profile':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Circle cx={12} cy={8} r={4} {...s} />
          <Path d="M4 21 C4 16 8 14.5 12 14.5 C16 14.5 20 16 20 21" {...s} />
        </Svg>
      );
    case 'admin':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path d="M12 3 L20 6 V11 C20 16.5 16.5 20 12 21.5 C7.5 20 4 16.5 4 11 V6 Z" {...s} strokeLinejoin="round" />
          <Path d="M9 12 L11.2 14.2 L15.5 9.5" {...s} strokeLinejoin="round" />
        </Svg>
      );
  }
}
