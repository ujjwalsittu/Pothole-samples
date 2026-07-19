/**
 * One-time coach-mark overlay: semi-transparent scrim, an amber highlight
 * frame around the target rect (measured by the host screen), and a tip
 * bubble. Dismisses on any tap and persists its AsyncStorage flag.
 *
 * Usage:
 *   const coach = useCoachMark('coach_dashboard_v1');
 *   <View ref={coach.targetRef} onLayout={coach.onTargetLayout}>...</View>
 *   <CoachMark coach={coach} title="..." body="..." />
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut, ZoomIn } from 'react-native-reanimated';
import { colors, font, radius, spacing } from '@/theme';
import { hasSeenCoachMark, markCoachMarkSeen, type CoachMarkKey } from '@/onboarding/flags';

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CoachMarkController {
  visible: boolean;
  rect: TargetRect | null;
  targetRef: React.RefObject<View>;
  onTargetLayout: () => void;
  dismiss: () => void;
}

export function useCoachMark(key: CoachMarkKey): CoachMarkController {
  const [visible, setVisible] = useState(false);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const targetRef = useRef<View>(null);

  useEffect(() => {
    let mounted = true;
    void hasSeenCoachMark(key).then((seen) => {
      if (mounted && !seen) setVisible(true);
    });
    return () => {
      mounted = false;
    };
  }, [key]);

  const onTargetLayout = useCallback(() => {
    // measureInWindow gives absolute coords for the overlay (which is
    // rendered at screen level with position:absolute fill).
    targetRef.current?.measureInWindow((x, y, width, height) => {
      if (width > 0 && height > 0) setRect({ x, y, width, height });
    });
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    void markCoachMarkSeen(key);
  }, [key]);

  return { visible, rect, targetRef, onTargetLayout, dismiss };
}

interface Props {
  coach: CoachMarkController;
  title: string;
  body: string;
}

export function CoachMark({ coach, title, body }: Props) {
  const { height: winH } = useWindowDimensions();
  if (!coach.visible) return null;

  const rect = coach.rect;
  // Place the tip below the target when there is room, else above.
  const below = rect ? rect.y + rect.height + 180 < winH : true;
  const tipTop = rect
    ? below
      ? rect.y + rect.height + spacing.md
      : undefined
    : winH / 2 - 90;
  const tipBottom = rect && !below ? winH - rect.y + spacing.md : undefined;

  return (
    <Animated.View
      entering={FadeIn.duration(250)}
      exiting={FadeOut.duration(150)}
      style={StyleSheet.absoluteFill}
      pointerEvents="auto"
    >
      <Pressable style={styles.scrim} onPress={coach.dismiss}>
        {rect ? (
          <Animated.View
            entering={ZoomIn.springify().damping(16)}
            pointerEvents="none"
            style={[
              styles.highlight,
              {
                left: rect.x - 6,
                top: rect.y - 6,
                width: rect.width + 12,
                height: rect.height + 12,
              },
            ]}
          />
        ) : null}
        <Animated.View
          entering={ZoomIn.delay(120).springify().damping(16)}
          pointerEvents="none"
          style={[styles.tip, { top: tipTop, bottom: tipBottom }]}
        >
          <Text style={styles.tipTitle}>{title}</Text>
          <Text style={styles.tipBody}>{body}</Text>
          <Text style={styles.tipDismiss}>Tap anywhere to continue</Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(3,7,15,0.78)' },
  highlight: {
    position: 'absolute',
    borderRadius: radius.lg,
    borderWidth: 2.5,
    borderColor: colors.primary,
    backgroundColor: 'rgba(245,158,11,0.08)',
    shadowColor: colors.primary,
    shadowOpacity: 0.8,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  tip: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.md,
  },
  tipTitle: { color: colors.primary, fontSize: font.h3, fontWeight: '800' },
  tipBody: { color: colors.text, fontSize: font.small, marginTop: spacing.xs, lineHeight: 20 },
  tipDismiss: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing.sm },
});
