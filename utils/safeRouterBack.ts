import type { Router } from 'expo-router';

type AppRouter = Pick<Router, 'canGoBack' | 'back' | 'replace'>;

/**
 * Évite l’erreur Expo « GO_BACK was not handled » quand la pile est vide
 * (ex. après `replace` auth → create-child, ou viewer sans session).
 */
export function safeRouterBack(
  router: AppRouter,
  fallbackHref:
    | '/(tabs)'
    | '/onboarding'
    | '/create-child'
    | '/auth'
    | { pathname: '/auth'; params: { mode: 'signup' | 'login'; intent?: 'subscribe' | 'free' } } = '/(tabs)',
): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace(fallbackHref);
}
