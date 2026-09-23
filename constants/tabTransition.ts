import { THEME } from '@/constants/theme';

/** Fond sous le fondu entre onglets — blanc cassé charte. */
export const TAB_TRANSITION_FADE_BG = THEME.bg;

/**
 * Cross-fade onglets (Bottom Tabs `animation: 'fade'`).
 * Un peu plus long qu’un cut sec — type apps premium (Photos, etc.).
 */
export const TAB_TRANSITION_DURATION_MS = 280;

/** Opacité de départ de l’écran entrant (réf. historique TabSceneTransition). */
export const TAB_TRANSITION_OPACITY_FROM = 0.0;

export const TAB_ROUTE_INDEX = {
  favoris: 0,
  livres: 1,
  index: 2,
  fil: 3,
} as const;
