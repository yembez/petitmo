/**
 * Flag « écran permissions onboarding déjà vu » — scopé par compte (userId).
 * Un test e-mail ne doit pas sauter l’écran pour Google / Apple ensuite.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const SEEN_KEY_PREFIX = 'petitmo:onboardingPermissionsSeen:';
/** Ancienne clé globale (migration / nettoyage). */
const LEGACY_SEEN_KEY = 'petitmo:onboardingPermissionsSeen';

function seenKeyForUser(userId: string): string {
  return `${SEEN_KEY_PREFIX}${userId.trim()}`;
}

export async function hasSeenOnboardingPermissions(userId?: string | null): Promise<boolean> {
  const uid = (userId ?? '').trim();
  try {
    if (uid) {
      return (await AsyncStorage.getItem(seenKeyForUser(uid))) === '1';
    }
    // Sans userId : ne pas se fier à l’ancienne clé globale (faux positifs multi-comptes).
    return false;
  } catch {
    return false;
  }
}

export async function markOnboardingPermissionsSeen(userId?: string | null): Promise<void> {
  const uid = (userId ?? '').trim();
  if (!uid) return;
  try {
    await AsyncStorage.setItem(seenKeyForUser(uid), '1');
    await AsyncStorage.removeItem(LEGACY_SEEN_KEY);
  } catch (e) {
    console.warn('[onboardingPermissions] markSeen', e);
  }
}

export async function clearOnboardingPermissionsSeen(userId?: string | null): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEGACY_SEEN_KEY);
    const uid = (userId ?? '').trim();
    if (uid) {
      await AsyncStorage.removeItem(seenKeyForUser(uid));
    }
  } catch (e) {
    console.warn('[onboardingPermissions] clearSeen', e);
  }
}
