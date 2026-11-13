/**
 * Opt-in photothèque **produit** (par compte) — distinct de la permission iOS.
 *
 * Low Friction : à l’Importer, **une seule** boîte = système Apple
 * (`NSPhotoLibraryUsageDescription`). Pas d’Alert app « Activer » avant.
 * PHPicker s’ouvre même si la parent refuse (dates/lieux moins fiables).
 *
 * Soft-heal : si iOS a déjà `granted`, on pose l’opt-in en silence.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  getPhotoLibraryGranted,
  getPhotoLibraryPermissionStatus,
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

async function activateMediaLibraryNow(userId: string | null): Promise<boolean> {
  const granted = await requestPhotoLibraryAccess();
  if (!granted) return false;
  await setMediaLibraryOptIn(true, userId);
  try {
    const { markOnboardingPermissionsSeen } = await import('@/lib/onboardingPermissionsSeen');
    await markOnboardingPermissionsSeen(userId);
  } catch {
    /* */
  }
  return true;
}

/**
 * Avant picker journal (Importer, couverture audio, etc.).
 * Low Friction : boîte Apple seule si `undetermined` ; PHPicker toujours autorisé ensuite.
 */
export async function ensureMediaLibraryPickerAllowed(): Promise<boolean> {
  const uid = peekLastRealAuthUserId();

  if (await softHealOptInFromOsGrant(uid)) return true;

  const osStatus = await getPhotoLibraryPermissionStatus();
  if (osStatus === 'granted' || (await getPhotoLibraryGranted())) {
    await setMediaLibraryOptIn(true, uid);
    return true;
  }

  if (osStatus === 'undetermined') {
    await activateMediaLibraryNow(uid);
  }

  // Refus / déjà denied : on n’empêche pas le PHPicker (import OK, méta plus faible).
  return true;
}
