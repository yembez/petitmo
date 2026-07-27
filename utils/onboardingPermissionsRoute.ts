/**
 * Navigation post-auth vers permissions puis profil enfant.
 * Même flux pour e-mail, Google et Apple.
 * Règle d’or V2 : compte d’abord ; local-first (pas de sync ici).
 */
import type { Router } from 'expo-router';
import { hasSeenOnboardingPermissions } from '@/lib/onboardingPermissionsSeen';
import { listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';

/** Compte sans enfant local → permissions (1× / compte) puis create-child. */
export async function replaceToOnboardingPermissionsOrCreateChild(
  router: Pick<Router, 'replace'>,
): Promise<void> {
  const uid = peekLastRealAuthUserId();
  if (!(await hasSeenOnboardingPermissions(uid))) {
    router.replace('/onboarding-permissions');
    return;
  }
  router.replace('/create-child');
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
  router.replace('/(tabs)');
}
