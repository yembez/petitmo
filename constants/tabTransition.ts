import { THEME } from '@/constants/theme';

/** Fond + flash pendant le fondu entre onglets — blanc cassé charte. */
export const TAB_TRANSITION_FADE_BG = THEME.bg;

export const TAB_TRANSITION_DURATION_MS = 220;
/** Montée verticale de l’écran entrant (depuis le bas). */
export const TAB_TRANSITION_SLIDE_Y_PX = 16;

export const TAB_ROUTE_INDEX = {
  favoris: 0,
  livres: 1,
  index: 2,
  fil: 3,
} as const;
