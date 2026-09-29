/**
 * Opt-in photothèque **produit** (par compte) — distinct de la permission iOS.
 *
 * Sur iOS 14+, `launchImageLibraryAsync` utilise PHPicker et peut s’ouvrir
 * **sans** `requestMediaLibraryPermissionsAsync`. Sans ce flag, « Plus tard »
 * sur l’écran permissions laissait quand même accéder à la galerie.
 *
 * Soft-heal : si iOS a déjà `granted` sur ce téléphone, on pose l’opt-in en
 * silence (même compte / reconnexion / flag AsyncStorage manquant) — pas d’alerte.
 *
 * Message alerte : « Plus tard » **seulement** si report explicite sur cet appareil ;
 * sinon (réinstall / nouvel appareil) → texte « réactiver l’accès ».
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
/** Report explicite « Plus tard » sur **cet** appareil (effacé à la réinstall). */
const DEFERRED_KEY_PREFIX = 'petitmo:mediaLibraryDeferred:';

function optInKeyForUser(userId: string): string {
  return `${OPT_IN_KEY_PREFIX}${userId.trim()}`;
}

function deferredKeyForUser(userId: string): string {
  return `${DEFERRED_KEY_PREFIX}${userId.trim()}`;
}

let memoryByUser: Record<string, boolean> = {};
let deferredByUser: Record<string, boolean> = {};

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

export async function getMediaLibraryDeferred(userId?: string | null): Promise<boolean> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid) return false;
  if (deferredByUser[uid] === true) return true;
  if (deferredByUser[uid] === false) return false;
  try {
    const v = (await AsyncStorage.getItem(deferredKeyForUser(uid))) === '1';
    deferredByUser[uid] = v;
    return v;
  } catch {
    return false;
  }
}

export async function setMediaLibraryDeferred(
  deferred: boolean,
  userId?: string | null,
): Promise<void> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim();
  if (!uid) return;
  deferredByUser[uid] = deferred;
  try {
    if (deferred) {
      await AsyncStorage.setItem(deferredKeyForUser(uid), '1');
    } else {
      await AsyncStorage.removeItem(deferredKeyForUser(uid));
    }
  } catch (e) {
    console.warn('[mediaLibraryOptIn] setDeferred', e);
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
      await setMediaLibraryDeferred(false, uid);
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
    delete deferredByUser[uid];
    try {
      await AsyncStorage.removeItem(optInKeyForUser(uid));
      await AsyncStorage.removeItem(deferredKeyForUser(uid));
    } catch {
      /* */
    }
  }
}

/** Permission OS déjà OK → aligne opt-in + flag onboarding (sans dialog). */
async function softHealOptInFromOsGrant(userId?: string | null): Promise<boolean> {
  if (!(await getPhotoLibraryGranted())) return false;
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim() || null;
  await setMediaLibraryOptIn(true, uid);
  try {
    const { markOnboardingPermissionsSeen } = await import('@/lib/onboardingPermissionsSeen');
    await markOnboardingPermissionsSeen(uid);
  } catch {
    /* */
  }
  return true;
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

  // Même tel, permission déjà accordée, flag produit manquant → pas d’alerte.
  if (await softHealOptInFromOsGrant(uid)) return true;

  const deferred = await getMediaLibraryDeferred(uid);
  const bodyKey = deferred
    ? 'permissions.photosNeedEnableBodyDeferred'
    : 'permissions.photosNeedEnableBody';

  // Pas d’opt-in et pas encore de grant iOS : proposer d’activer maintenant.
  return await new Promise<boolean>(resolve => {
    Alert.alert(i18n.t('permissions.photosTitle'), i18n.t(bodyKey), [
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
    ]);
  });
}
