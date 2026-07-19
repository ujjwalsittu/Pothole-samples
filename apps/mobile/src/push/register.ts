/**
 * Push-notification registration. Called AFTER the account is approved (tabs
 * mount) — never during onboarding. Fully graceful: permission denial or a
 * missing EAS project id simply means no push, nothing else breaks.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { registerPushToken } from '@/api/endpoints';

let registeredThisRun = false;

/** Foreground notifications are surfaced via the in-app Toast instead of OS alerts. */
export function configureForegroundNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Requests permission, fetches the Expo push token and registers it with the API. */
export async function registerForPushNotifications(): Promise<boolean> {
  if (registeredThisRun) return true;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== 'granted') return false;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'General',
        importance: Notifications.AndroidImportance.DEFAULT,
        lightColor: '#F59E0B',
      });
    }

    const easConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
      ?.eas;
    const projectId = easConfig?.projectId ?? Constants.easConfig?.projectId ?? undefined;
    const tokenResponse = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await registerPushToken(tokenResponse.data, Platform.OS);
    registeredThisRun = true;
    return true;
  } catch {
    // Denied permission, no play services, offline, missing projectId, ...
    return false;
  }
}
