import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { useAuth } from '@/auth/AuthContext';
import { signupComplete } from '@/api/endpoints';
import { ApiError } from '@/api/client';
import { colors, font, radius, spacing } from '@/theme';

const UPI_REGEX = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/;

type Status = 'student' | 'professional';

export default function SignupDetailsScreen() {
  const router = useRouter();
  const { setProfile, logout } = useAuth();

  const [fullName, setFullName] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('student');
  const [upiId, setUpiId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = useMicrophonePermissions();
  const [locPerm, requestLocPerm] = Location.useForegroundPermissions();

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

  const upiValid = UPI_REGEX.test(upiId.trim());
  const nameValid = fullName.trim().length >= 3;

  const submit = async () => {
    setError(null);
    if (!nameValid) {
      setError('Please enter your full name (at least 3 characters).');
      return;
    }
    if (!upiValid) {
      setError('Enter a valid UPI ID, e.g. name@bank');
      return;
    }
    setSubmitting(true);
    try {
      const user = await signupComplete({
        fullName: fullName.trim(),
        collectorStatus: status,
        upiId: upiId.trim(),
        photoBase64,
      });
      setProfile(user);
      router.replace('/(auth)/package');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save your details. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.title}>Complete your profile</Text>
      <Text style={styles.subtitle}>We need a few details before you can start collecting.</Text>

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

      {/* status */}
      <Text style={styles.label}>I am a</Text>
      <View style={styles.statusRow}>
        {(['student', 'professional'] as const).map((s) => (
          <Pressable
            key={s}
            onPress={() => setStatus(s)}
            style={[styles.statusChip, status === s && styles.statusChipActive]}
          >
            <Text style={[styles.statusText, status === s && styles.statusTextActive]}>
              {s === 'student' ? 'Student' : 'Professional'}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.note}>Only an admin can later change your status to Owner.</Text>

      {/* UPI */}
      <Text style={styles.label}>UPI ID (for payouts)</Text>
      <TextInput
        style={[styles.input, upiId.length > 0 && !upiValid && styles.inputError]}
        value={upiId}
        onChangeText={setUpiId}
        placeholder="name@bank"
        placeholderTextColor={colors.textFaint}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {upiId.length > 0 && !upiValid ? (
        <Text style={styles.fieldError}>That does not look like a valid UPI ID.</Text>
      ) : null}

      {/* permissions rationale */}
      <View style={styles.permCard}>
        <Text style={styles.permTitle}>App permissions</Text>
        <Text style={styles.permBody}>
          PotholeCollect needs the camera and microphone to capture samples, and precise location so
          every pothole carries an exact, genuine GPS coordinate. Samples without accurate location
          are rejected.
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
  note: { color: colors.textFaint, fontSize: font.tiny, marginTop: spacing.xs },
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
