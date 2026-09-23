import type { Router } from 'expo-router';
import { safeRouterBack } from '@/utils/safeRouterBack';

type AppRouter = Pick<Router, 'canGoBack' | 'back' | 'replace' | 'canDismiss' | 'dismiss'>;

/**
 * Ferme un écran flux Capturer (Écrire / Enregistrer / Importer).
 * Les `fullScreenModal` (Écrire) doivent passer par `dismiss()` — `back()` seul
 * laisse parfois une couche native qui bloque les taps Capturer.
 */
export function leaveCaptureFlowScreen(router: AppRouter): void {
  if (typeof router.canDismiss === 'function' && router.canDismiss()) {
    router.dismiss();
    return;
  }
  safeRouterBack(router, '/(tabs)');
}
