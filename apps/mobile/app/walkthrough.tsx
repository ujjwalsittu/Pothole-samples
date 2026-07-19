import React, { useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Ellipse, Line, Path, Rect } from 'react-native-svg';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/Button';
import { BrandFooter } from '@/components/BrandFooter';
import { markWalkthroughSeen } from '@/onboarding/flags';
import { colors, font, radius, spacing } from '@/theme';
import { SPEED, VIDEO_RULES } from '@/shared';

interface Slide {
  key: string;
  title: string;
  body: string;
  bullets?: string[];
  glyph: 'logo' | 'signup' | 'community' | 'photo' | 'video' | 'offline';
}

const SLIDES: Slide[] = [
  {
    key: 'welcome',
    title: 'Report potholes, make roads safer',
    body: 'Every report you submit maps real road damage for the people who can fix it. Your city, one pothole at a time.',
    glyph: 'logo',
  },
  {
    key: 'how',
    title: 'How a submission works',
    body: 'Capture a photo or a short drive-by video, outline each pothole on screen, and submit. Every report carries an exact GPS location and goes through review before it counts.',
    glyph: 'signup',
  },
  {
    key: 'photo',
    title: 'Photos: road only',
    body: 'Frame the road surface and draw a polygon around each pothole. A quick road-width reference gives instant size estimates.',
    bullets: [
      'Focus on the road — nothing else',
      'Avoid trees, buildings, vehicles, people, animals, signboards',
      'No duplicates — every report is checked against everyone’s submissions',
    ],
    glyph: 'photo',
  },
  {
    key: 'video',
    title: 'Videos: the rules',
    body: 'Record from a moving vehicle and mark each pothole on the timeline afterwards.',
    bullets: [
      `At least ${VIDEO_RULES.MIN_DURATION_SECONDS} seconds long`,
      `Mark at least ${VIDEO_RULES.MIN_POTHOLES} potholes`,
      `Drive at up to ${SPEED.DISPLAYED_CAP_KMPH} km/h`,
      'GPS on — mock locations are always rejected',
    ],
    glyph: 'video',
  },
  {
    key: 'community',
    title: 'Join the community',
    body: 'Keep a daily reporting streak alive and climb the leaderboard. See how your submissions stack up against reporters across the city.',
    glyph: 'community',
  },
  {
    key: 'offline',
    title: 'Works offline too',
    body: 'No signal? Reports queue on your phone and upload themselves later, chunk by chunk, as soon as you are back online.',
    glyph: 'offline',
  },
];

export default function WalkthroughScreen() {
  const router = useRouter();
  const { width: winW } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);
  const scrollX = useSharedValue(0);

  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / winW));
  };

  const finish = () => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void markWalkthroughSeen().finally(() => router.replace('/(tabs)/dashboard'));
  };

  const next = () => {
    if (index >= SLIDES.length - 1) {
      finish();
      return;
    }
    void Haptics.selectionAsync();
    scrollRef.current?.scrollTo({ x: (index + 1) * winW, animated: true });
  };

  const isLast = index === SLIDES.length - 1;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <View style={styles.topSpacer} />
        {!isLast ? (
          <Pressable onPress={finish} hitSlop={12}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        ) : null}
      </View>

      <Animated.ScrollView
        // @ts-expect-error Animated.ScrollView forwards the ScrollView ref.
        ref={scrollRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onMomentumEnd}
      >
        {SLIDES.map((slide, i) => (
          <SlideView key={slide.key} slide={slide} index={i} width={winW} scrollX={scrollX} />
        ))}
      </Animated.ScrollView>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <Dot key={i} index={i} width={winW} scrollX={scrollX} />
        ))}
      </View>

      <View style={styles.footer}>
        <Button title={isLast ? 'Get started' : 'Next'} onPress={next} />
        <BrandFooter />
      </View>
    </SafeAreaView>
  );
}

function SlideView({
  slide,
  index,
  width,
  scrollX,
}: {
  slide: Slide;
  index: number;
  width: number;
  scrollX: SharedValue<number>;
}) {
  const range = [(index - 1) * width, index * width, (index + 1) * width];

  const glyphStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, range, [0.2, 1, 0.2], Extrapolation.CLAMP),
    transform: [
      { scale: interpolate(scrollX.value, range, [0.7, 1, 0.7], Extrapolation.CLAMP) },
      { translateX: interpolate(scrollX.value, range, [width * 0.25, 0, -width * 0.25], Extrapolation.CLAMP) },
    ],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollX.value, range, [0, 1, 0], Extrapolation.CLAMP),
    transform: [
      { translateY: interpolate(scrollX.value, range, [24, 0, 24], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <View style={[styles.slide, { width }]}>
      <Animated.View style={[styles.glyphWrap, glyphStyle]}>
        <SlideGlyph name={slide.glyph} />
      </Animated.View>
      <Animated.View style={textStyle}>
        <Text style={styles.title}>{slide.title}</Text>
        <Text style={styles.body}>{slide.body}</Text>
        {slide.bullets?.map((b, i) => (
          <View key={i} style={styles.bulletRow}>
            <Text style={styles.bulletDot}>{'•'}</Text>
            <Text style={styles.bulletText}>{b}</Text>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

function Dot({
  index,
  width,
  scrollX,
}: {
  index: number;
  width: number;
  scrollX: SharedValue<number>;
}) {
  const range = [(index - 1) * width, index * width, (index + 1) * width];
  const style = useAnimatedStyle(() => ({
    width: interpolate(scrollX.value, range, [8, 24, 8], Extrapolation.CLAMP),
    opacity: interpolate(scrollX.value, range, [0.35, 1, 0.35], Extrapolation.CLAMP),
  }));
  return <Animated.View style={[styles.dot, style]} />;
}

/** Simple line-art glyphs for each slide (react-native-svg, no icon fonts). */
function SlideGlyph({ name }: { name: Slide['glyph'] }) {
  const s = {
    stroke: colors.primary,
    strokeWidth: 3,
    fill: 'none' as const,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'logo':
      return <Logo size={150} wordmark />;
    case 'signup':
      return (
        <Svg width={140} height={140} viewBox="0 0 100 100">
          <Circle cx={40} cy={34} r={14} {...s} />
          <Path d="M14 82 C14 62 28 56 40 56 C52 56 66 62 66 82" {...s} />
          <Circle cx={76} cy={64} r={16} {...s} stroke={colors.success} />
          <Path d="M69 64 L74.5 69.5 L84 58.5" {...s} stroke={colors.success} />
        </Svg>
      );
    case 'community':
      return (
        <Svg width={140} height={140} viewBox="0 0 100 100">
          {/* trophy */}
          <Path d="M34 20 H66 V44 C66 56 58 64 50 64 C42 64 34 56 34 44 Z" {...s} />
          <Path d="M34 27 H20 C20 42 27 48 35 48 M66 27 H80 C80 42 73 48 65 48" {...s} />
          <Path d="M50 64 V74 M38 84 H62 M42 74 H58" {...s} />
          {/* streak flame */}
          <Path d="M50 30 C52 35 57 36 57 42 C57 47 54 50 50 50 C46 50 43 47 43 42 C43 38 45 36 46 34 C46 37 48 38 49 38 C48 35 49 32 50 30 Z" fill={colors.primary} opacity={0.7} />
        </Svg>
      );
    case 'photo':
      return (
        <Svg width={140} height={140} viewBox="0 0 100 100">
          <Rect x={12} y={28} width={76} height={52} rx={8} {...s} />
          <Path d="M36 28 L42 18 L58 18 L64 28" {...s} />
          <Circle cx={50} cy={54} r={15} {...s} />
          <Ellipse cx={50} cy={57} rx={7} ry={3.5} fill={colors.pothole} stroke={colors.primary} strokeWidth={2} />
        </Svg>
      );
    case 'video':
      return (
        <Svg width={140} height={140} viewBox="0 0 100 100">
          <Rect x={10} y={30} width={56} height={40} rx={8} {...s} />
          <Path d="M66 44 L88 32 V68 L66 56 Z" {...s} />
          <Circle cx={30} cy={50} r={9} {...s} strokeWidth={2.5} />
          <Line x1={30} y1={50} x2={35} y2={44} {...s} strokeWidth={2.5} />
        </Svg>
      );
    case 'offline':
      return (
        <Svg width={140} height={140} viewBox="0 0 100 100">
          <Path d="M30 66 C16 66 12 54 20 46 C18 32 34 24 44 32 C50 20 72 22 74 38 C88 38 90 58 78 64" {...s} />
          <Path d="M50 78 V48 M50 48 L40 58 M50 48 L60 58" {...s} stroke={colors.success} />
        </Svg>
      );
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  topSpacer: { width: 40 },
  skip: { color: colors.textDim, fontSize: font.body, fontWeight: '600' },
  slide: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  glyphWrap: { alignItems: 'center', marginBottom: spacing.lg, minHeight: 150, justifyContent: 'center' },
  title: { color: colors.text, fontSize: font.h1, fontWeight: '800', textAlign: 'center' },
  body: {
    color: colors.textDim,
    fontSize: font.body,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 22,
  },
  bulletRow: { flexDirection: 'row', marginTop: spacing.sm, paddingHorizontal: spacing.sm },
  bulletDot: { color: colors.primary, marginRight: spacing.sm, fontSize: font.body },
  bulletText: { color: colors.textDim, fontSize: font.small, flex: 1, lineHeight: 20 },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  dot: { height: 8, borderRadius: radius.pill, backgroundColor: colors.primary },
  footer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
});
