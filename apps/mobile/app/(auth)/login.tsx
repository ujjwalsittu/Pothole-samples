import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Logo } from '@/components/Logo';
import { Button } from '@/components/Button';
import { BrandFooter } from '@/components/BrandFooter';
import { useAuth } from '@/auth/AuthContext';
import { hasSeenWalkthrough } from '@/onboarding/flags';
import { colors, font, spacing } from '@/theme';

export default function LoginScreen() {
  const router = useRouter();
  const { status, error, loginWithGoogle, loginWithUniversal } = useAuth();
  const [busy, setBusy] = useState<'google' | 'universal' | null>(null);

  // Once a login resolves the profile state, leave this screen.
  useEffect(() => {
    if (status === 'noProfile') router.replace('/(auth)/signup-details');
    else if (status === 'pending' || status === 'rejected' || status === 'suspended')
      router.replace('/(auth)/pending');
    else if (status === 'approved') {
      // First-time users see the walkthrough before the tabs.
      void hasSeenWalkthrough().then((seen) => {
        router.replace(seen ? '/(tabs)/dashboard' : '/walkthrough');
      });
    }
  }, [status, router]);

  const handle = async (kind: 'google' | 'universal') => {
    setBusy(kind);
    try {
      if (kind === 'google') await loginWithGoogle();
      else await loginWithUniversal();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen scroll={false} style={styles.container}>
      <View style={styles.top}>
        <Logo size={120} wordmark />
        <Text style={styles.subtitle}>
          Report potholes. Make your roads safer.
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          title="Continue with Google"
          onPress={() => void handle('google')}
          loading={busy === 'google'}
          disabled={busy !== null}
        />
        <Button
          title="Log in"
          variant="secondary"
          onPress={() => void handle('universal')}
          loading={busy === 'universal'}
          disabled={busy !== null}
          style={styles.secondBtn}
        />
        <Text style={styles.hint}>Collectors and admins log in here.</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <BrandFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { justifyContent: 'space-between' },
  top: { alignItems: 'center', marginTop: spacing.xxl },
  subtitle: { color: colors.textDim, fontSize: font.body, marginTop: spacing.sm },
  actions: { paddingHorizontal: spacing.sm },
  secondBtn: { marginTop: spacing.sm },
  hint: {
    color: colors.textFaint,
    fontSize: font.tiny,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  error: {
    color: colors.danger,
    fontSize: font.small,
    textAlign: 'center',
    marginTop: spacing.md,
  },
});
