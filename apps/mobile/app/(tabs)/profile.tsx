import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { BrandFooter } from '@/components/BrandFooter';
import { useAuth } from '@/auth/AuthContext';
import { patchMe } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import { resetWalkthrough } from '@/onboarding/flags';
import { colors, font, radius, spacing } from '@/theme';
import { DEFAULT_PACKAGE } from '@/shared';

const UPI_REGEX = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/;

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, setProfile, logout } = useAuth();

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState(profile?.fullName ?? '');
  const [upiId, setUpiId] = useState(profile?.upiId ?? '');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    if (!res.canceled && res.assets[0]) {
      setPhotoUri(res.assets[0].uri);
      setPhotoBase64(res.assets[0].base64 ?? null);
    }
  };

  const save = async () => {
    setError(null);
    if (fullName.trim().length < 3) {
      setError('Name must be at least 3 characters.');
      return;
    }
    if (upiId.trim().length > 0 && !UPI_REGEX.test(upiId.trim())) {
      setError('Enter a valid UPI ID, e.g. name@bank');
      return;
    }
    setSaving(true);
    try {
      const updated = await patchMe({
        fullName: fullName.trim(),
        upiId: upiId.trim(),
        ...(photoBase64 ? { photoBase64 } : {}),
      });
      setProfile(updated);
      setEditing(false);
      setPhotoBase64(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save changes.');
    } finally {
      setSaving(false);
    }
  };

  const shownPhoto = photoUri ?? profile?.photoUrl ?? null;

  return (
    <Screen>
      <Text style={styles.title}>Profile</Text>

      <View style={styles.card}>
        <Pressable
          onPress={() => {
            if (editing) void pickPhoto();
          }}
          style={styles.photoWrap}
        >
          {shownPhoto ? (
            <Image source={{ uri: shownPhoto }} style={styles.photo} />
          ) : (
            <View style={[styles.photo, styles.photoPlaceholder]}>
              <Text style={styles.photoInitial}>{(profile?.fullName ?? '?')[0]}</Text>
            </View>
          )}
          {editing ? <Text style={styles.changePhoto}>Change photo</Text> : null}
        </Pressable>

        {editing ? (
          <>
            <Text style={styles.label}>Full name</Text>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholderTextColor={colors.textFaint}
            />
            <Text style={styles.label}>UPI ID</Text>
            <TextInput
              style={styles.input}
              value={upiId}
              onChangeText={setUpiId}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="name@bank"
              placeholderTextColor={colors.textFaint}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.editRow}>
              <Button title="Save" onPress={() => void save()} loading={saving} style={styles.editBtn} />
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => {
                  setEditing(false);
                  setFullName(profile?.fullName ?? '');
                  setUpiId(profile?.upiId ?? '');
                  setPhotoUri(null);
                  setPhotoBase64(null);
                  setError(null);
                }}
                style={styles.editBtn}
              />
            </View>
          </>
        ) : (
          <>
            <Text style={styles.name}>{profile?.fullName}</Text>
            <Text style={styles.email}>{profile?.email}</Text>
            <InfoRow label="Status" value={capitalize(profile?.collectorStatus ?? '—')} />
            <InfoRow label="Role" value={capitalize(profile?.role ?? '—')} />
            <InfoRow label="UPI ID" value={profile?.upiId ?? 'not set'} />
            <Button
              title="Edit profile"
              variant="secondary"
              onPress={() => setEditing(true)}
              style={styles.editToggle}
            />
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Package</Text>
        <Text style={styles.pkgText}>
          {DEFAULT_PACKAGE.name}: {DEFAULT_PACKAGE.videoQuota} videos OR {DEFAULT_PACKAGE.photoQuota}{' '}
          photos {'→'} ₹{DEFAULT_PACKAGE.payoutInr}
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Help</Text>
        <Button
          title="Replay walkthrough"
          variant="secondary"
          onPress={() => {
            void resetWalkthrough().finally(() => router.push('/walkthrough'));
          }}
        />
      </View>

      <Button
        title="Log out"
        variant="danger"
        onPress={() => {
          void logout().then(() => router.replace('/(auth)/login'));
        }}
        style={styles.logout}
      />
      <BrandFooter />
    </Screen>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: font.h1, fontWeight: '700', marginBottom: spacing.md },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  cardTitle: { color: colors.text, fontSize: font.h3, fontWeight: '700', marginBottom: spacing.xs },
  photoWrap: { alignItems: 'center', marginBottom: spacing.sm },
  photo: { width: 88, height: 88, borderRadius: 44 },
  photoPlaceholder: {
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoInitial: { color: colors.primary, fontSize: 34, fontWeight: '700' },
  changePhoto: { color: colors.primary, fontSize: font.small, marginTop: spacing.xs },
  name: { color: colors.text, fontSize: font.h2, fontWeight: '700', textAlign: 'center' },
  email: { color: colors.textDim, fontSize: font.small, textAlign: 'center', marginBottom: spacing.sm },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoLabel: { color: colors.textDim, fontSize: font.small },
  infoValue: { color: colors.text, fontSize: font.small, fontWeight: '600' },
  editToggle: { marginTop: spacing.sm },
  label: { color: colors.textDim, fontSize: font.small, marginTop: spacing.sm, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: font.body,
  },
  editRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  editBtn: { flex: 1 },
  error: { color: colors.danger, fontSize: font.small, marginTop: spacing.sm },
  pkgText: { color: colors.textDim, fontSize: font.small, lineHeight: 20 },
  logout: { marginTop: spacing.sm },
});
