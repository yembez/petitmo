import { CommonActions, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import type { Router } from 'expo-router';
import { setFeedHydrationSnapshots } from '@/services/tabScreensCache';
import { setCaptureTabChildSnapshot } from '@/services/children';

type AppRouter = Pick<Router, 'replace' | 'dismissAll' | 'canDismiss'>;

/**
 * Après déconnexion / suppression de compte : racine = onboarding **seul**.
 * Ceintures + bretelles : dismissAll + reset root + replace répété
 * (depuis Espace parent / hors-ligne, un seul chemin rate souvent).
 */
export function resetNavigationToOnboarding(
  router: AppRouter,
  navigation?: NavigationProp<ParamListBase> | null,
): void {
  // Snapshots UI : ne pas peindre l’ancien fil si un onglet reste monté une frame.
  setFeedHydrationSnapshots(null, [], []);
  setCaptureTabChildSnapshot(null);

  const forceReplace = () => {
    try {
      router.replace('/onboarding');
    } catch (e) {
      console.warn('[resetNavigationToOnboarding] replace', e);
    }
  };

  try {
    if (typeof router.dismissAll === 'function') {
      router.dismissAll();
    }
  } catch {
    /* */
  }

  let root = navigation ?? null;
  try {
    while (root?.getParent?.()) {
      root = root.getParent();
    }
    if (root?.dispatch) {
      root.dispatch(
        CommonActions.reset({
          index: 0,
          routes: [{ name: 'onboarding' }],
        }),
      );
    }
  } catch (e) {
    console.warn('[resetNavigationToOnboarding] reset', e);
  }

  // Toujours replace : le reset root rate parfois (nom de route / pile expo-router).
  forceReplace();
  setTimeout(forceReplace, 50);
  setTimeout(forceReplace, 200);
}
