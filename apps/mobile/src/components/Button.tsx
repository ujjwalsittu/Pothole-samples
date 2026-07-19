import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { colors, font, radius, spacing } from '@/theme';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  /** Light haptic tap on press (default true; heavier for danger). */
  haptics?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  haptics = true,
  style,
}: Props) {
  const isDisabled = disabled || loading;
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const handlePress = () => {
    if (haptics) {
      void Haptics.impactAsync(
        variant === 'danger' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
      );
    }
    onPress();
  };

  return (
    <Animated.View style={[animated, style]}>
      <Pressable
        onPress={handlePress}
        onPressIn={() => {
          scale.value = withSpring(0.96, { damping: 20, stiffness: 300 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 20, stiffness: 300 });
        }}
        disabled={isDisabled}
        style={({ pressed }) => [
          styles.base,
          styles[variant],
          isDisabled && styles.disabled,
          pressed && !isDisabled && styles.pressed,
        ]}
      >
        {loading ? (
          <ActivityIndicator color={variant === 'primary' ? colors.onPrimary : colors.text} />
        ) : (
          <Text
            style={[styles.label, variant === 'primary' ? styles.labelOnPrimary : styles.labelDefault]}
          >
            {title}
          </Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  danger: { backgroundColor: colors.danger },
  ghost: { backgroundColor: 'transparent' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
  label: { fontSize: font.body, fontWeight: '600' },
  labelOnPrimary: { color: colors.onPrimary },
  labelDefault: { color: colors.text },
});
