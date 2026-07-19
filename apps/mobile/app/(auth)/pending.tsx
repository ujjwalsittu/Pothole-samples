import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Logo } from '@/components/Logo';
import { BrandFooter } from '@/components/BrandFooter';
import { useAuth } from '@/auth/AuthContext';
import { hasSeenWalkthrough } from '@/onboarding/flags';
import { colors, font, radius, spacing } from '@/theme';

export default function PendingScreen() {
  const router = useRouter();
  const { status, refreshProfile, logout } = useAuth();
  const [checking, setChecking] = useState(false);

  const rejected = status === 'rejected';
  const suspended = status === 'suspended';

  const check = async () => {
    setChecking(true);
    try {
      const s = await refreshProfile();
      if (s === 'approved') {
        const seen = await hasSeenWalkthrough();
        router.replace(seen ? '/(tabs)/dashboard' : '/walkthrough');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <Screen scroll={false} style={styles.container}>
      <View style={styles.center}>
        <Logo size={90} />
        <View style={styles.card}>
          {rejected ? (
            <>
              <Text style={styles.titleRejected}>Account not approved</Text>
              <Text style={styles.body}>
                Unfortunately your account was rejected by an admin. If you believe this is a
                mistake, contact support.
              </Text>
            </>
          ) : suspended ? (
            <>
              <Text style={styles.titleRejected}>Account suspended</Text>
              <Text style={styles.body}>
                Your account has been suspended. Contact support for details.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.title}>Awaiting approval</Text>
              <Text style={styles.body}>
                Your account is awaiting admin approval. We{'’'}ll email you once approved.
              </Text>
            </>
          )}
        </View>
        {!rejected && !suspended ? (
          <Button title="Check status" onPress={() => void check()} loading={checking} style={styles.btn} />
        ) : null}
        <Button
          title="Log out"
          variant="ghost"
          onPress={() => {
            void logout().then(() => router.replace('/(auth)/login'));
          }}
        />
      </View>
      <BrandFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { justifyContent: 'space-between' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.lg,
    marginHorizontal: spacing.md,
    alignItems: 'center',
  },
  title: { color: colors.primary, fontSize: font.h2, fontWeight: '700' },
  titleRejected: { color: colors.danger, fontSize: font.h2, fontWeight: '700' },
  body: {
    color: colors.textDim,
    fontSize: font.body,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 21,
  },
  btn: { marginTop: spacing.lg, alignSelf: 'stretch', marginHorizontal: spacing.md },
});
