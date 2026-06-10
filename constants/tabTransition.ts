import { THEME } from '@/constants/theme';

/** Fond + flash pendant le fondu entre onglets — blanc cassé charte. */
export const TAB_TRANSITION_FADE_BG = THEME.bg;

export const TAB_TRANSITION_DURATION_MS = 300;
/** Montée verticale de l’écran entrant (depuis le bas). */
export const TAB_TRANSITION_SLIDE_Y_PX = 28;
/** Voile blanc initial (plus haut = fondu plus marqué). */
export const TAB_TRANSITION_FLASH_OPACITY = 0.82;

export const TAB_ROUTE_INDEX = {
  index: 0,
  fil: 1,
  favoris: 2,
  livres: 3,
} as const;
