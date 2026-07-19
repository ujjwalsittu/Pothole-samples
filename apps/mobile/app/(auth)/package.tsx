import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { useAuth } from '@/auth/AuthContext';
import { colors, font, radius, spacing } from '@/theme';
import { DEFAULT_PACKAGE, SPEED, VIDEO_RULES } from '@/shared';

const RULES: string[] = [
  `Videos must be at least ${VIDEO_RULES.MIN_DURATION_SECONDS} seconds long and contain at least ${VIDEO_RULES.MIN_POTHOLES} potholes.`,
  `In record mode, drive at up to ${SPEED.DISPLAYED_CAP_KMPH} km/h on a moving road — there is no minimum speed.`,
  'No duplicates and no pre-submitted samples — every sample is checked against everyone’s submissions, not just yours.',
  'Focus on the road only. Avoid trees, buildings, vehicles, people, animals and signboards in the frame.',
  'Location must be precise and genuine. Mock/simulated GPS is always rejected.',
  'Rejected samples cannot be re-uploaded — capture a new sample instead.',
];

export default function PackageScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  // The signup-complete response already carries the assigned package;
  // DEFAULT_PACKAGE is only the fallback until /me returns one.
  const pkg = profile?.package ?? DEFAULT_PACKAGE;
  return (
    <Screen>
      <Text style={styles.title}>Your package</Text>
      <View style={styles.card}>
        <Text style={styles.pkgName}>{pkg.name}</Text>
        <Text style={styles.pkgHeadline}>
          Complete {pkg.videoQuota} pothole videos on a moving road{'\n'}
          <Text style={styles.or}>OR</Text> {pkg.photoQuota} pothole photos
        </Text>
        <Text style={styles.payout}>₹{pkg.payoutInr}</Text>
        <Text style={styles.payoutNote}>paid to your UPI ID once the quota is accepted</Text>
      </View>

      <Text style={styles.rulesTitle}>The rules</Text>
      <View style={styles.rulesCard}>
        {RULES.map((r, i) => (
          <View key={i} style={styles.ruleRow}>
            <Text style={styles.bullet}>{'•'}</Text>
            <Text style={styles.ruleText}>{r}</Text>
          </View>
        ))}
      </View>

      <Button
        title="Got it"
        onPress={() => router.replace('/(auth)/pending')}
        style={styles.btn}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: font.h1, fontWeight: '700', marginBottom: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary,
    padding: spacing.lg,
    alignItems: 'center',
  },
  pkgName: {
    color: colors.primary,
    fontSize: font.small,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  pkgHeadline: {
    color: colors.text,
    fontSize: font.h3,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 26,
  },
  or: { color: colors.primary, fontWeight: '800' },
  payout: { color: colors.primary, fontSize: 40, fontWeight: '800', marginTop: spacing.md },
  payoutNote: { color: colors.textDim, fontSize: font.small, marginTop: spacing.xs },
  rulesTitle: {
    color: colors.text,
    fontSize: font.h3,
    fontWeight: '700',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  rulesCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  ruleRow: { flexDirection: 'row', marginVertical: spacing.xs },
  bullet: { color: colors.primary, marginRight: spacing.sm, fontSize: font.body },
  ruleText: { color: colors.textDim, fontSize: font.small, flex: 1, lineHeight: 19 },
  btn: { marginTop: spacing.lg },
});
