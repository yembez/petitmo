/**
 * Navigation post-auth vers permissions puis profil enfant.
 * Même flux pour e-mail, Google et Apple.
 * Règle d’or V2 : compte d’abord ; local-first (pas de sync bloquante ici).
 *
 * L’écran permissions = **1× par compte** (flag `hasSeen`).
 * Ne jamais le réafficher si : déjà vu, enfants locaux, ou opt-in photos
 * déjà posé (ex. activation depuis l’espace parents / alerte import).
 */
import type { Router } from 'expo-router';
import {
  hasSeenOnboardingPermissions,
  markOnboardingPermissionsSeen,
} from '@/lib/onboardingPermissionsSeen';
import { listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';

export type PostAuthOnboardingPath =
  | '/onboarding-permissions'
  | '/create-child'
  | '/(tabs)';

/**
 * Où envoyer après auth / cold start sans enfant cloud encore hydraté.
 * Soft-migre `hasSeen` si l’utilisatrice a déjà géré les permissions ailleurs.
 */
export async function resolvePostAuthOnboardingPath(
  userId?: string | null,
): Promise<PostAuthOnboardingPath> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim() || null;
  const localCount = uid ? listLocalChildrenForUser(uid).length : 0;

  if (localCount > 0) {
    if (uid && !(await hasSeenOnboardingPermissions(uid))) {
      await markOnboardingPermissionsSeen(uid);
    }
    return '/(tabs)';
  }

  if (uid && (await hasSeenOnboardingPermissions(uid))) {
    return '/create-child';
  }

  // Activation hors écran onboarding (espace parents, alerte « Activer », etc.).
  if (uid) {
    const { getMediaLibraryOptIn } = await import('@/lib/mediaLibraryOptIn');
    if (await getMediaLibraryOptIn(uid)) {
      await markOnboardingPermissionsSeen(uid);
      return '/create-child';
    }
  }

  return '/onboarding-permissions';
}

/** Compte sans enfant local → permissions (1× / compte) puis create-child ; sinon tabs. */
export async function replaceToOnboardingPermissionsOrCreateChild(
  router: Pick<Router, 'replace'>,
): Promise<void> {
  const path = await resolvePostAuthOnboardingPath();
  if (path === '/(tabs)') {
    hydrateTabScreensFromSqliteSync();
  }
  router.replace(path);
}

/** Après l’écran permissions : profil enfant si besoin, sinon fil. */
export function replaceAfterOnboardingPermissions(
  router: Pick<Router, 'replace'>,
): void {
  const uid = peekLastRealAuthUserId();
  const localCount = uid ? listLocalChildrenForUser(uid).length : 0;
  if (localCount === 0) {
    router.replace('/create-child');
    return;
  }
  hydrateTabScreensFromSqliteSync();
  router.replace('/(tabs)');
}
