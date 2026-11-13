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

/**
 * Statut OS brut — pour brancher l’UX :
 * - `undetermined` → on peut encore afficher la boîte système
 * - `denied` → uniquement Réglages (iOS ne re-propose plus)
 */
export async function getPhotoLibraryPermissionStatus(): Promise<
  'granted' | 'denied' | 'undetermined'
> {
  const kind = await getPhotoLibraryAccessKind();
  if (kind === 'full' || kind === 'limited') return 'granted';
  if (kind === 'denied') return 'denied';
  return 'undetermined';
}

export type PhotoLibraryAccessKind = 'full' | 'limited' | 'denied' | 'undetermined';

/** Détail iOS pour menus Paramètres (Aucun / Limité / Complet). */
export async function getPhotoLibraryAccessKind(): Promise<PhotoLibraryAccessKind> {
  const res = await ImagePicker.getMediaLibraryPermissionsAsync();
  const { status, granted, canAskAgain, accessPrivileges } = res;
  if (accessPrivileges === 'limited' || status === 'limited') return 'limited';
  if (granted || status === 'granted' || accessPrivileges === 'all') return 'full';
  // Jamais demandé (ou encore re-promptable) — ne pas confondre avec « Aucun » Réglages.
  // `accessPrivileges: 'none'` apparaît aussi avant la 1ʳᵉ demande → ce n’est pas un refus.
  if (status === 'undetermined' || status === 'unavailable') return 'undetermined';
  if (status === 'denied' && canAskAgain !== false) return 'undetermined';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

export async function requestPhotoLibraryAccess(): Promise<boolean> {
  const res = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (res.granted) return true;
  if (res.accessPrivileges === 'limited' || res.status === 'limited') return true;
  if (res.accessPrivileges === 'all' || res.status === 'granted') return true;
  return false;
}

type NotificationsModule = typeof import('expo-notifications');

function isIosProvisionalStatus(
  Notifications: NotificationsModule,
  iosStatus: number | undefined,
): boolean {
  return iosStatus === Notifications.IosAuthorizationStatus.PROVISIONAL;
}

/**
 * `granted` = alertes iOS classiques (bannière / son).
 * Le provisoire (« Distribuer en silence ») reste `undetermined` pour qu’un opt-in
 * puisse encore afficher la boîte Apple.
 */
export async function getNotificationsPermissionStatus(): Promise<
  'granted' | 'denied' | 'undetermined'
> {
  const Notifications = await loadNotifications();
  if (!Notifications) return 'denied';
  try {
    const settings = await Notifications.getPermissionsAsync();
    if (settings.granted) return 'granted';
    if (settings.status === 'denied' && settings.canAskAgain === false) return 'denied';
    return 'undetermined';
  } catch {
    return 'undetermined';
  }
}

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
  return (await getNotificationsPermissionStatus()) === 'granted';
}

/**
 * Auth provisoire iOS (pas de boîte « Autoriser ») — Distribuer en silence.
 * Idempotent si déjà authorized / provisional. Ne demande **pas** la permission classique.
 */
export async function ensureProvisionalNotificationsAuthorization(): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  try {
    if (await getNotificationsGranted()) return true;
    const settings = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
        allowProvisional: true,
      },
    });
    return (
      !!settings.granted ||
      isIosProvisionalStatus(Notifications, settings.ios?.status)
    );
  } catch (e) {
    console.warn('[onboardingPermissions] ensureProvisional', e);
    return false;
  }
}

/**
 * Permission classique (boîte iOS Autoriser / Refuser).
 * Succès = alertes autorisées — le provisoire seul ne compte pas.
 */
export async function requestNotificationsAccess(): Promise<boolean> {
  const Notifications = await loadNotifications();
  if (!Notifications) return false;
  try {
    const settings = await Notifications.requestPermissionsAsync({
      ios: {
        allowAlert: true,
        allowBadge: true,
        allowSound: true,
      },
    });
    return !!settings.granted;
  } catch (e) {
    console.warn('[onboardingPermissions] requestPermissionsAsync', e);
    return false;
  }
}
