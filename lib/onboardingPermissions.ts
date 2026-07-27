/**
 * Demandes photothèque + notifications pour l’écran onboarding.
 * Notifications : ne charge expo-notifications que si le module natif est présent
 * (sinon le binary actuel — Expo Go / ancien dev client — plante).
 */
import { NativeModules } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export {
  hasSeenOnboardingPermissions,
  markOnboardingPermissionsSeen,
} from '@/lib/onboardingPermissionsSeen';

export async function getPhotoLibraryGranted(): Promise<boolean> {
  const { status } = await ImagePicker.getMediaLibraryPermissionsAsync();
  return status === 'granted' || status === 'limited';
}

export async function requestPhotoLibraryAccess(): Promise<boolean> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return status === 'granted' || status === 'limited';
}

type NotificationsModule = typeof import('expo-notifications');

function hasNotificationsNative(): boolean {
  const n = NativeModules as Record<string, unknown>;
  return !!(
    n.ExpoPushTokenManager ||
    n.ExpoNotificationPermissionsModule ||
    n.ExpoNotifications
  );
}

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (!hasNotificationsNative()) {
    return null;
  }
  try {
    return await import('expo-notifications');
  } catch (e) {
    console.warn('[onboardingPermissions] expo-notifications unavailable', e);
    return null;
  }
}

/** false si module natif absent (besoin d’un rebuild avec expo-notifications). */
export async function isNotificationsModuleAvailable(): Promise<boolean> {
  return hasNotificationsNative();
}

export async function getNotificationsGranted(): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.warn('[onboardingPermissions] getPermissionsAsync', e);
    return false;
  }
}

export async function requestNotificationsAccess(): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch (e) {
    console.warn('[onboardingPermissions] requestPermissionsAsync', e);
    return false;
  }
}
