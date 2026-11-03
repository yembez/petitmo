/**
 * Navigation post-auth vers permissions puis profil enfant.
 * Même flux pour e-mail, Google et Apple.
 * Règle d’or V2 : compte d’abord ; local-first (pas de sync bloquante ici).
 *
 * L’écran permissions = **1× par compte** (flag `hasSeen`) — sauf wipe local
 * (réinstall) où le flag disparaît : on réaffiche avec copy « returning ».
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
  opts?: { returning?: boolean },
): Promise<void> {
  const path = await resolvePostAuthOnboardingPath();
  if (path === '/(tabs)') {
    hydrateTabScreensFromSqliteSync();
    router.replace(path);
    return;
  }
  if (path === '/onboarding-permissions' && opts?.returning) {
    router.replace({
      pathname: '/onboarding-permissions',
      params: { context: 'returning' },
    });
    return;
  }
  router.replace(path);
}

/**
 * Après l’écran permissions : profil enfant si besoin, sinon fil.
 * `push` (pas `replace`) vers create-child → Back revient bien sur les accès.
 *
 * Important : ne pas décider sur le seul SQLite. Après login Google / restore,
 * le local peut être vide alors que le cloud a déjà des enfants (timeout pull
 * auth, wipe local, « Plus tard »). Même filet que `app/index.tsx` cold start.
 */
export async function replaceAfterOnboardingPermissions(
  router: Pick<Router, 'replace' | 'push'>,
): Promise<void> {
  const uid = peekLastRealAuthUserId();
  let localCount = uid ? listLocalChildrenForUser(uid).length : 0;

  if (localCount === 0) {
    try {
      const { getChildren } = await import('@/services/children');
      const children = await Promise.race([
        getChildren(),
        new Promise<null>(resolve => setTimeout(() => resolve(null), 8_000)),
      ]);
      if (children && children.length > 0) {
        localCount = children.length;
      }
    } catch (e) {
      console.warn('[onboardingPermissionsRoute] post-permissions getChildren', e);
    }
  }

  if (localCount === 0) {
    router.push('/create-child');
    return;
  }

  hydrateTabScreensFromSqliteSync();
  try {
    const { listMemoriesVisibleForAccount } = await import(
      '@/services/accountLocalReset'
    );
    if (listMemoriesVisibleForAccount(uid).length === 0) {
      const { restoreFamilyMemoriesFromCloudWithSoftWait } = await import(
        '@/services/runCloudMemoriesRestore'
      );
      const { endCloudRestoreUi, peekCloudRestoreUi } = await import(
        '@/lib/cloudRestoreUi'
      );
      await Promise.race([
        restoreFamilyMemoriesFromCloudWithSoftWait({ softUi: true, holdUi: true }),
        new Promise<void>(resolve => setTimeout(resolve, 20_000)),
      ]);
      hydrateTabScreensFromSqliteSync();
      router.replace('/(tabs)');
      if (peekCloudRestoreUi().active) {
        setTimeout(() => endCloudRestoreUi(), 220);
      }
      return;
    }
  } catch (e) {
    console.warn('[onboardingPermissionsRoute] post-permissions restore', e);
  }
  router.replace('/(tabs)');
}
