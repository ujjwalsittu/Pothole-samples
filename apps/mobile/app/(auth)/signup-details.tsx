import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { useAuth0 } from 'react-native-auth0';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { useAuth } from '@/auth/AuthContext';
import { signupComplete } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import { buildDeviceFingerprint } from '@/utils/fingerprint';
import { colors, font, radius, spacing } from '@/theme';

const MOBILE_REGEX = /^\d{10,15}$/;

type Occupation = 'student' | 'professional' | 'self';

const OCCUPATIONS: Array<{ key: Occupation; label: string }> = [
  { key: 'student', label: 'Student' },
  { key: 'professional', label: 'Professional' },
  { key: 'self', label: 'Self' },
];

export default function SignupDetailsScreen() {
  const router = useRouter();
  const { setProfile, logout } = useAuth();
  const { user: authUser } = useAuth0();

  const [fullName, setFullName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [occupation, setOccupation] = useState<Occupation>('student');
  const [organization, setOrganization] = useState('');
  const [mobile, setMobile] = useState('');
  const [whatsappAvailable, setWhatsappAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [locPerm, requestLocPerm] = Location.useForegroundPermissions();

  // Prefill the name from the Auth0 profile (Google login carries it).
  useEffect(() => {
    if (fullName.length > 0 || !authUser) return;
    const fromParts = [authUser.givenName, authUser.familyName].filter(Boolean).join(' ');
    const candidate = authUser.name && !authUser.name.includes('@') ? authUser.name : fromParts;
    if (candidate) setFullName(candidate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authUser]);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!res.canceled && res.assets[0]) {
      setPhotoUri(res.assets[0].uri);
    }
  };

  const nameValid = fullName.trim().length >= 3;
  const mobileValid = MOBILE_REGEX.test(mobile.trim());
  const organizationValid = occupation !== 'student' || organization.trim().length >= 2;

  const submit = async () => {
    setError(null);
    if (!nameValid) {
      setError('Please enter your full name (at least 3 characters).');
      return;
    }
    if (occupation === 'student' && !organizationValid) {
      setError('Please enter your college or university.');
      return;
    }
    if (!mobileValid) {
      setError('Enter a valid mobile number (10-15 digits).');
      return;
    }
    setSubmitting(true);
    try {
      // Best-effort extras: one GPS fix + device fingerprint (both silent).
      let signupLocation: { lat: number; lng: number; acc: number } | null = null;
      try {
        if (locPerm?.granted) {
          const fix =
            (await Location.getLastKnownPositionAsync()) ??
            (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
          signupLocation = {
            lat: fix.coords.latitude,
            lng: fix.coords.longitude,
            acc: fix.coords.accuracy ?? 999,
          };
        }
      } catch {
        signupLocation = null;
      }
      const deviceFingerprint = await buildDeviceFingerprint().catch(() => null);

      const user = await signupComplete({
        fullName: fullName.trim(),
        photoUri,
        collectorStatus: occupation,
        organization: organization.trim().length > 0 ? organization.trim() : null,
        mobile: mobile.trim(),
        whatsappAvailable,
        signupLocation,
        deviceFingerprint,
      });
      setProfile(user);
      router.replace('/(auth)/pending');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your details. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.title}>Complete your profile</Text>
      <Text style={styles.subtitle}>A few details before you can start reporting potholes.</Text>

      {/* photo */}
      <Pressable onPress={() => void pickPhoto()} style={styles.photoWrap}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.photo} />
        ) : (
          <View style={[styles.photo, styles.photoPlaceholder]}>
            <Text style={styles.photoPlus}>+</Text>
          </View>
        )}
        <Text style={styles.photoLabel}>{photoUri ? 'Change photo' : 'Add profile photo'}</Text>
      </Pressable>

      {/* name */}
      <Text style={styles.label}>Full name</Text>
      <TextInput
        style={styles.input}
        value={fullName}
        onChangeText={setFullName}
        placeholder="Your name"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="words"
      />

      {/* occupation */}
      <Text style={styles.label}>Occupation</Text>
      <View style={styles.statusRow}>
        {OCCUPATIONS.map(({ key, label }) => (
          <Pressable
            key={key}
            onPress={() => setOccupation(key)}
            style={[styles.statusChip, occupation === key && styles.statusChipActive]}
          >
            <Text style={[styles.statusText, occupation === key && styles.statusTextActive]}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {occupation === 'student' ? (
        <>
          <Text style={styles.label}>College / University (required)</Text>
          <TextInput
            style={styles.input}
            value={organization}
            onChangeText={setOrganization}
            placeholder="Your college or university"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="words"
          />
        </>
      ) : null}
      {occupation === 'professional' ? (
        <>
          <Text style={styles.label}>Company (optional)</Text>
          <TextInput
            style={styles.input}
            value={organization}
            onChangeText={setOrganization}
            placeholder="Where do you work?"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="words"
          />
        </>
      ) : null}

      {/* mobile */}
      <Text style={styles.label}>Mobile number</Text>
      <TextInput
        style={[styles.input, mobile.length > 0 && !mobileValid && styles.inputError]}
        value={mobile}
        onChangeText={(v) => setMobile(v.replace(/[^\d]/g, ''))}
        placeholder="10-15 digits"
        placeholderTextColor={colors.textFaint}
        keyboardType="phone-pad"
        maxLength={15}
      />
      {mobile.length > 0 && !mobileValid ? (
        <Text style={styles.fieldError}>Mobile number must be 10-15 digits.</Text>
      ) : null}

      <Pressable style={styles.checkboxRow} onPress={() => setWhatsappAvailable((v) => !v)}>
        <View style={[styles.checkbox, whatsappAvailable && styles.checkboxChecked]}>
          {whatsappAvailable ? <Text style={styles.checkboxTick}>✓</Text> : null}
        </View>
        <Text style={styles.checkboxLabel}>This number is on WhatsApp</Text>
      </Pressable>

      {/* permissions rationale */}
      <View style={styles.permCard}>
        <Text style={styles.permTitle}>App permissions</Text>
        <Text style={styles.permBody}>
          PotholeCollect needs the camera and microphone to capture pothole reports, and precise
          location so every report carries an exact, genuine GPS coordinate. Reports without an
          accurate location are rejected.
        </Text>
        <PermRow
          label="Camera"
          granted={cameraPerm?.granted ?? false}
          onRequest={() => void requestCameraPerm()}
        />
        <PermRow
          label="Microphone"
          granted={micPerm?.granted ?? false}
          onRequest={() => void requestMicPerm()}
        />
        <PermRow
          label="Precise location"
          granted={locPerm?.granted ?? false}
          onRequest={() => void requestLocPerm()}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Button title="Continue" onPress={() => void submit()} loading={submitting} style={styles.submit} />
      <Button
        title="Log out"
        variant="ghost"
        onPress={() => {
          void logout().then(() => router.replace('/(auth)/login'));
        }}
      />
    </Screen>
  );
}

function PermRow({
  label,
  granted,
  onRequest,
}: {
  label: string;
  granted: boolean;
  onRequest: () => void;
}) {
  return (
    <View style={styles.permRow}>
      <Text style={styles.permLabel}>{label}</Text>
      {granted ? (
        <Text style={styles.permGranted}>Granted</Text>
      ) : (
        <Pressable onPress={onRequest} style={styles.permBtn}>
          <Text style={styles.permBtnText}>Allow</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: font.h1, fontWeight: '700' },
  subtitle: { color: colors.textDim, fontSize: font.body, marginTop: spacing.xs },
  photoWrap: { alignItems: 'center', marginVertical: spacing.lg },
  photo: { width: 96, height: 96, borderRadius: 48 },
  photoPlaceholder: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPlus: { color: colors.primary, fontSize: 36, fontWeight: '300' },
  photoLabel: { color: colors.primary, fontSize: font.small, marginTop: spacing.sm },
  label: { color: colors.textDim, fontSize: font.small, marginTop: spacing.md, marginBottom: spacing.xs },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: font.body,
  },
  inputError: { borderColor: colors.danger },
  fieldError: { color: colors.danger, fontSize: font.tiny, marginTop: spacing.xs },
  statusRow: { flexDirection: 'row', gap: spacing.sm },
  statusChip: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: 12,
    alignItems: 'center',
  },
  statusChipActive: { borderColor: colors.primary, backgroundColor: '#1F2937' },
  statusText: { color: colors.textDim, fontSize: font.body, fontWeight: '600' },
  statusTextActive: { color: colors.primary },
  checkboxRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  checkboxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkboxTick: { color: colors.onPrimary, fontSize: 14, fontWeight: '800' },
  checkboxLabel: { color: colors.text, fontSize: font.body },
  permCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  permTitle: { color: colors.text, fontSize: font.h3, fontWeight: '700' },
  permBody: { color: colors.textDim, fontSize: font.small, marginTop: spacing.xs },
  permRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  permLabel: { color: colors.text, fontSize: font.body },
  permGranted: { color: colors.success, fontSize: font.small, fontWeight: '700' },
  permBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  permBtnText: { color: colors.onPrimary, fontSize: font.small, fontWeight: '700' },
  error: { color: colors.danger, fontSize: font.small, marginTop: spacing.md, textAlign: 'center' },
  submit: { marginTop: spacing.lg, marginBottom: spacing.xs },
});
