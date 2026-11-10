import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import type { Router } from 'expo-router';
import { setFeedHydrationSnapshots } from '@/services/tabScreensCache';
import { setCaptureTabChildSnapshot } from '@/services/children';

type AppRouter = Pick<
  Router,
  'replace' | 'dismissAll' | 'canDismiss' | 'dismissTo'
>;

/**
 * Après déconnexion / suppression : racine = onboarding (carrousel bundlé, OK hors ligne).
 *
 * Ne plus utiliser `CommonActions.reset({ name: 'onboarding' })` — souvent
 * « not handled » depuis Espace parent / piles imbriquées (surtout hors ligne),
 * et le carrousel ne s’affiche pas. Préférer l’API expo-router (`dismissTo` /
 * `replace`) + retries.
 */
export function resetNavigationToOnboarding(
  router: AppRouter,
  _navigation?: NavigationProp<ParamListBase> | null,
): void {
  // Snapshots UI : ne pas peindre l’ancien fil si un onglet reste monté une frame.
  setFeedHydrationSnapshots(null, [], []);
  setCaptureTabChildSnapshot(null);

  const goOnboarding = () => {
    try {
      if (typeof router.dismissTo === 'function') {
        router.dismissTo('/onboarding');
        return;
      }
    } catch (e) {
      console.warn('[resetNavigationToOnboarding] dismissTo', e);
    }
    try {
      router.replace('/onboarding');
    } catch (e) {
      console.warn('[resetNavigationToOnboarding] replace', e);
    }
  };

  try {
    if (typeof router.canDismiss === 'function' && router.canDismiss()) {
      router.dismissAll();
    }
  } catch {
    /* POP_TO_TOP / pile vide — ignorer */
  }

  goOnboarding();
  requestAnimationFrame(goOnboarding);
  setTimeout(goOnboarding, 50);
  setTimeout(goOnboarding, 200);
  setTimeout(goOnboarding, 500);
}
