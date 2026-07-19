import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Logo } from '@/components/Logo';
import { BrandFooter } from '@/components/BrandFooter';
import { useAuth } from '@/auth/AuthContext';
import { colors, font, spacing } from '@/theme';

const MIN_SPLASH_MS = 1400;

/** Animated splash; routes based on auth/profile state once both the
 * animation minimum and the auth check have completed. */
export default function SplashRoute() {
  const router = useRouter();
  const { status } = useAuth();
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.85)).current;
  const mountedAt = useRef(Date.now());

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scale, {
        toValue: 1,
        duration: 700,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  useEffect(() => {
    if (status === 'loading') return;
    const elapsed = Date.now() - mountedAt.current;
    const wait = Math.max(0, MIN_SPLASH_MS - elapsed);
    const timer = setTimeout(() => {
      switch (status) {
        case 'signedOut':
          router.replace('/(auth)/login');
          break;
        case 'noProfile':
          router.replace('/(auth)/signup-details');
          break;
        case 'pending':
        case 'rejected':
        case 'suspended':
          router.replace('/(auth)/pending');
          break;
        case 'approved':
          router.replace('/(tabs)/dashboard');
          break;
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [status, router]);

  return (
    <View style={styles.container}>
      <View style={styles.center}>
        <Animated.View style={{ opacity, transform: [{ scale }] }}>
          <Logo size={140} wordmark />
        </Animated.View>
        <Animated.Text style={[styles.tagline, { opacity }]}>
          Map the roads. Fix the potholes.
        </Animated.Text>
      </View>
      <BrandFooter />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'space-between',
    paddingBottom: spacing.lg,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tagline: { color: colors.textDim, fontSize: font.small, marginTop: spacing.md },
});
