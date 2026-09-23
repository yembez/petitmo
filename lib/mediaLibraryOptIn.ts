/**
 * Opt-in photothèque **produit** (par compte) — distinct de la permission iOS.
 *
 * Sur iOS 14+, `launchImageLibraryAsync` utilise PHPicker et peut s’ouvrir
 * **sans** `requestMediaLibraryPermissionsAsync`. Sans ce flag, « Plus tard »
 * sur l’écran permissions laissait quand même accéder à la galerie.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Linking } from 'react-native';
import i18n from '@/lib/i18n';
import {
  getPhotoLibraryGranted,
  requestPhotoLibraryAccess,
} from '@/lib/onboardingPermissions';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';

const OPT_IN_KEY_PREFIX = 'petitmo:mediaLibraryOptIn:';

function optInKeyForUser(userId: string): string {
  return `${OPT_IN_KEY_PREFIX}${userId.trim()}`;
}

let memoryByUser: Record<string, boolean> = {};

export async function getMediaLibraryOptIn(userId?: string | null): Promise<boolean> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid) return false;
  if (memoryByUser[uid] === true) return true;
  try {
    const v = (await AsyncStorage.getItem(optInKeyForUser(uid))) === '1';
    memoryByUser[uid] = v;
    return v;
  } catch {
    return false;
  }
}

export async function setMediaLibraryOptIn(
  enabled: boolean,
  userId?: string | null,
): Promise<void> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid) return;
  memoryByUser[uid] = enabled;
  try {
    if (enabled) {
      await AsyncStorage.setItem(optInKeyForUser(uid), '1');
    } else {
      await AsyncStorage.removeItem(optInKeyForUser(uid));
    }
  } catch (e) {
    console.warn('[mediaLibraryOptIn] set', e);
  }
}

export async function clearMediaLibraryOptIn(userId?: string | null): Promise<void> {
  const uid = (userId ?? '').trim();
  if (uid) {
    delete memoryByUser[uid];
    try {
      await AsyncStorage.removeItem(optInKeyForUser(uid));
    } catch {
      /* */
    }
  }
}

/**
 * Avant tout picker : exige l’opt-in compte + (si besoin) la demande iOS.
 * Retourne false → ne pas ouvrir la galerie.
 */
export async function ensureMediaLibraryPickerAllowed(): Promise<boolean> {
  const uid = peekLastRealAuthUserId();
  if (await getMediaLibraryOptIn(uid)) {
    if (await getPhotoLibraryGranted()) return true;
    const granted = await requestPhotoLibraryAccess();
    if (granted) return true;
    Alert.alert(
      i18n.t('permissions.deniedTitle'),
      i18n.t('permissions.photosDeniedBody'),
      [
        { text: i18n.t('cancel'), style: 'cancel' },
        {
          text: i18n.t('permissions.openSettings'),
          onPress: () => void Linking.openSettings(),
        },
      ],
    );
    return false;
  }

  // Pas d’opt-in (Plus tard / toggles OFF) : proposer d’activer maintenant.
  return await new Promise<boolean>(resolve => {
    Alert.alert(
      i18n.t('permissions.photosTitle'),
      i18n.t('permissions.photosNeedEnableBody'),
      [
        {
          text: i18n.t('cancel'),
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: i18n.t('permissions.openSettings'),
          onPress: () => {
            void Linking.openSettings();
            resolve(false);
          },
        },
        {
          text: i18n.t('permissions.enableNow'),
          onPress: () => {
            void (async () => {
              const granted = await requestPhotoLibraryAccess();
              if (granted) {
                await setMediaLibraryOptIn(true, uid);
                const { markOnboardingPermissionsSeen } = await import(
                  '@/lib/onboardingPermissionsSeen'
                );
                await markOnboardingPermissionsSeen(uid);
                resolve(true);
                return;
              }
              Alert.alert(
                i18n.t('permissions.deniedTitle'),
                i18n.t('permissions.photosDeniedBody'),
                [
                  { text: i18n.t('cancel'), style: 'cancel' },
                  {
                    text: i18n.t('permissions.openSettings'),
                    onPress: () => void Linking.openSettings(),
                  },
                ],
              );
              resolve(false);
            })();
          },
        },
      ],
    );
  });
}
