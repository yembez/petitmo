import { APP_SCREEN_BG, APP_SCREEN_BG_RGB } from '@/constants/theme';

/**
 * Dégradés bas Capturer — fondu beige sur la photo, au-dessus du bandeau CTA.
 */

/** Blanc cassé — aligné `THEME.bg`. */
export const CAPTURE_FADE_BASE_RGB = APP_SCREEN_BG_RGB;

/** Fond bandeau CTA + bas du dégradé photo. */
export const CAPTURE_FADE_BASE_HEX = APP_SCREEN_BG;

function fadeColor(a: number): string {
  const { r, g, b } = CAPTURE_FADE_BASE_RGB;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Fondu sur la photo — transparent en haut, beige opaque en bas (jointure bandeau).
 */
export const CAPTURE_TITLE_FADE_GRADIENT = [
  'rgba(0, 0, 0, 0)',
  fadeColor(0.08),
  fadeColor(0.18),
  fadeColor(0.32),
  fadeColor(0.48),
  fadeColor(0.64),
  fadeColor(0.78),
  fadeColor(0.88),
  fadeColor(0.94),
  fadeColor(0.98),
  fadeColor(1),
  fadeColor(1),
] as const;

/** Montée modérée + bas plus opaque (lisibilité titre / jointure bandeau). */
export const CAPTURE_TITLE_FADE_GRADIENT_LOCATIONS = [
  0, 0.06, 0.14, 0.24, 0.34, 0.44, 0.54, 0.64, 0.74, 0.84, 0.93, 1,
] as const;

/** @deprecated — alias */
export const CAPTURE_HERO_BOTTOM_GRADIENT = CAPTURE_TITLE_FADE_GRADIENT;
export const CAPTURE_HERO_BOTTOM_GRADIENT_LOCATIONS = CAPTURE_TITLE_FADE_GRADIENT_LOCATIONS;
export const CAPTURE_BOTTOM_OVERLAY_GRADIENT = CAPTURE_TITLE_FADE_GRADIENT;
export const CAPTURE_BOTTOM_OVERLAY_GRADIENT_LOCATIONS = CAPTURE_TITLE_FADE_GRADIENT_LOCATIONS;
