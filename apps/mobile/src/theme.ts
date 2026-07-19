/** PotholeCollect brand theme — dark navy + amber. */

export const colors = {
  bg: '#0B1220',
  card: '#111A2E',
  cardAlt: '#0F172A',
  border: '#1E293B',
  primary: '#F59E0B',
  primaryDim: '#B45309',
  onPrimary: '#0B1220',
  text: '#E5E7EB',
  textDim: '#94A3B8',
  textFaint: '#64748B',
  success: '#22C55E',
  danger: '#EF4444',
  warning: '#FBBF24',
  info: '#38BDF8',
  pothole: '#060A14',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const font = {
  h1: 28,
  h2: 22,
  h3: 18,
  body: 15,
  small: 13,
  tiny: 11,
} as const;

/** Colors used for annotation polygons, cycled per label index. */
export const ANNOTATION_COLORS = [
  '#F59E0B',
  '#38BDF8',
  '#A78BFA',
  '#34D399',
  '#FB7185',
  '#FBBF24',
  '#22D3EE',
] as const;
