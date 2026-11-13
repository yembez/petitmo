/**
 * Navigation post-auth → profil enfant (plus d’écran « Active tes accès »).
 * Même flux pour e-mail, Google et Apple.
 * Règle d’or V2 : compte d’abord ; local-first (pas de sync bloquante ici).
 * Low Friction : Photos / Notifications seulement au moment du besoin
 * (Importer, Activer le rappel) — pas à l’inscription.
 */
import type { Router } from 'expo-router';
import { markOnboardingPermissionsSeen } from '@/lib/onboardingPermissionsSeen';
import { listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';

export type PostAuthOnboardingPath = '/create-child' | '/(tabs)';

/**
 * Où envoyer après auth / cold start sans enfant cloud encore hydraté.
 * Soft-marque `hasSeen` permissions (écran retiré du happy path).
 */
export async function resolvePostAuthOnboardingPath(
  userId?: string | null,
): Promise<PostAuthOnboardingPath> {
  const uid = (userId ?? peekLastRealAuthUserId() ?? '').trim() || null;
  const localCount = uid ? listLocalChildrenForUser(uid).length : 0;

  if (localCount > 0) {
    if (uid) {
      await markOnboardingPermissionsSeen(uid);
    }
    return '/(tabs)';
  }

  if (uid) {
    await markOnboardingPermissionsSeen(uid);
  }
  return '/create-child';
}

/** Compte sans enfant local → create-child ; sinon tabs. */
export async function replaceToOnboardingPermissionsOrCreateChild(
  router: Pick<Router, 'replace'>,
  _opts?: { returning?: boolean },
): Promise<void> {
  const path = await resolvePostAuthOnboardingPath();
  if (path === '/(tabs)') {
    hydrateTabScreensFromSqliteSync();
  }
  router.replace(path);
}

/**
 * Après l’ancien écran permissions (redirect) : profil enfant si besoin, sinon fil.
 *
 * Important : ne pas décider sur le seul SQLite. Après login Google / restore,
 * le local peut être vide alors que le cloud a déjà des enfants.
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
    router.replace('/create-child');
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
