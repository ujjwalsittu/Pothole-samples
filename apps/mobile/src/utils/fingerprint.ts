/**
 * Best-effort device fingerprint sent with signup (shown to admins for
 * fraud review). Combines expo-device/expo-constants identifiers with a
 * per-install random UUID persisted in SecureStore (Expo has no stable
 * installationId anymore). Never throws — always resolves to an object.
 */
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';

const INSTALL_ID_KEY = 'pc_install_id';

export async function getInstallId(): Promise<string> {
  try {
    const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY);
    if (existing) return existing;
    const fresh = Crypto.randomUUID();
    await SecureStore.setItemAsync(INSTALL_ID_KEY, fresh);
    return fresh;
  } catch {
    return 'unknown';
  }
}

export async function buildDeviceFingerprint(): Promise<Record<string, unknown>> {
  const installId = await getInstallId();
  return {
    installId,
    platform: Platform.OS,
    deviceName: Device.deviceName ?? null,
    modelName: Device.modelName ?? null,
    brand: Device.brand ?? null,
    osName: Device.osName ?? null,
    osVersion: Device.osVersion ?? null,
    isDevice: Device.isDevice,
    appVersion: Constants.expoConfig?.version ?? null,
  };
}
