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
  getPhotoLibraryAccessKind,
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

async function markOptInAndSeen(userId: string | null): Promise<void> {
  await setMediaLibraryOptIn(true, userId);
  try {
    const { markOnboardingPermissionsSeen } = await import('@/lib/onboardingPermissionsSeen');
    await markOnboardingPermissionsSeen(userId);
  } catch {
    /* */
  }
}

/**
 * Avant picker journal (Importer, couverture audio, etc.).
 * Low Friction :
 * - `undetermined` → **une** boîte Apple classique ;
 * - `limited` / `full` → **ne pas** re-demander (évite « Sélectionner plus de photos ») ;
 * - PHPicker toujours autorisé ensuite.
 */
export async function ensureMediaLibraryPickerAllowed(): Promise<boolean> {
  const uid = peekLastRealAuthUserId();
  const kind = await getPhotoLibraryAccessKind();

  if (kind === 'full' || kind === 'limited') {
    await markOptInAndSeen(uid);
    // Aligne aussi ExpoMediaLibrary (fiche Photos → lieu GPS à l’import).
    void ensureExpoMediaLibraryPermissionAligned();
    return true;
  }

  if (kind === 'undetermined') {
    const granted = await requestPhotoLibraryAccess();
    if (granted) {
      await markOptInAndSeen(uid);
      void ensureExpoMediaLibraryPermissionAligned();
    }
  }

  // denied / refus : PHPicker OK (méta plus faible).
  return true;
}

/** Même entitlement Photos — nécessaire pour `getAssetInfoAsync` (lieu). */
async function ensureExpoMediaLibraryPermissionAligned(): Promise<void> {
  try {
    const MediaLibrary = await import('expo-media-library');
    const cur = await MediaLibrary.getPermissionsAsync();
    if (cur.granted || cur.accessPrivileges === 'limited') return;
    await MediaLibrary.requestPermissionsAsync();
  } catch {
    /* module absent / rebuild */
  }
}
