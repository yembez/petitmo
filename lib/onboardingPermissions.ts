/**
 * Demandes photothèque + notifications pour l’écran onboarding.
 * Notifications : détection via `requireOptionalNativeModule` (New Arch /
 * Expo Modules) — `NativeModules.Expo…` est souvent vide et donnait un faux
 * « module indisponible ».
 *
 * Photothèque : c’est le **seul** endroit qui demande l’accès. Le picker d’import
 * (`exif: true`, indispensable aux dates de prise) déclencherait sinon la boîte iOS
 * au premier import — accord donné ici une fois pour toutes.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as ImagePicker from 'expo-image-picker';

export {
  hasSeenOnboardingPermissions,
  markOnboardingPermissionsSeen,
} from '@/lib/onboardingPermissionsSeen';

/** `granted` couvre aussi l’accès limité (« Photos sélectionnées ») d’iOS. */
export async function getPhotoLibraryGranted(): Promise<boolean> {
  const { granted } = await ImagePicker.getMediaLibraryPermissionsAsync();
  return granted;
}

export async function requestPhotoLibraryAccess(): Promise<boolean> {
  const { granted } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  return granted;
}

type NotificationsModule = typeof import('expo-notifications');

function hasNotificationsNative(): boolean {
  return !!(
    requireOptionalNativeModule('ExpoNotificationPermissionsModule') ||
    requireOptionalNativeModule('ExpoPushTokenManager')
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
