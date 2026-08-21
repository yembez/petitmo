import { THEME } from '@/constants/theme';

/** Fond sous le fondu entre onglets — blanc cassé charte. */
export const TAB_TRANSITION_FADE_BG = THEME.bg;

/** Cross-fade court type apps tab (Google Photos, etc.) — pas de slide. */
export const TAB_TRANSITION_DURATION_MS = 200;
/** Opacité de départ de l’écran entrant. */
export const TAB_TRANSITION_OPACITY_FROM = 0.0;

export const TAB_ROUTE_INDEX = {
  favoris: 0,
  livres: 1,
  index: 2,
  fil: 3,
} as const;
