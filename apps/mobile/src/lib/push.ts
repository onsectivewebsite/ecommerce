import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

/**
 * Ask the OS for permission, get an Expo push token, register it with our backend.
 * Returns null when the user denies or runs on a simulator (no push delivery there).
 */
export async function registerForPushAsync(): Promise<string | null> {
  if (!Device.isDevice) return null; // simulator/emulator → skip
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== 'granted') {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('orders', {
      name: 'Orders',
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync('shipping', {
      name: 'Shipping updates',
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync('payouts', {
      name: 'Payouts',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId =
    (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
    (Constants.easConfig as { projectId?: string } | undefined)?.projectId;

  const tokenResult = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  const token = tokenResult.data;
  if (!token) return null;

  try {
    await api.notifications.registerDevice({
      expoPushToken: token,
      platform: Platform.OS === 'ios' ? 'IOS' : Platform.OS === 'android' ? 'ANDROID' : 'WEB',
      deviceModel: Device.modelName ?? undefined,
      appVersion: Constants.expoConfig?.version ?? undefined,
    });
  } catch {
    // Non-fatal — user can still receive the in-app prompt later.
  }
  return token;
}
