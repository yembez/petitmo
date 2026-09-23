import { scale } from '@/utils/responsive';
import {
  BRAND_ACTION_ACCENT,
  CAPTURE_CTA_ICON_CORAL,
} from '@/constants/captureScreenPalette';

/**
 * Essai UI Capturer :
 * - `'d1'` = outline beige + liseré gris · Mic / PencilLine / ImagePlus (corail ou dégradé)
 * - `'d2'` = disques dégradé splash/icône (#FD628D→#FD6764) · icônes blanches (mock D2)
 * - `'d3'` = fond corail pâle · icônes corail (mock D3)
 * - `'d16'` = disques corail action (#FD7764) · icônes blanches (mock D16)
 * - `'d6'` = disques gris pâle + icônes encre Lucide (mock D6)
 * - `'s6'` = carrés continuous, mêmes couleurs que D6
 * - `'outline'` = disques contour + icônes customs corail
 * - `'gradient'` = disques dégradés charte
 */
export const CAPTURE_CTA_VARIANT:
  | 'outline'
  | 'gradient'
  | 'd1'
  | 'd2'
  | 'd3'
  | 'd16'
  | 'd6'
  | 's6' = 'd2';

/** D1 — icônes Lucide corail sur disques outline. */
export const CAPTURE_CTA_D1_ICON = CAPTURE_CTA_ICON_CORAL;
export const CAPTURE_CTA_D1_ICON_STROKE = 2.4;

/** D2 — fond uni legacy (remplacé par `BRAND_SPLASH_GRADIENT` sur Capturer). */
export const CAPTURE_CTA_D2_BG = CAPTURE_CTA_ICON_CORAL;
/** D2 — icônes blanches. */
export const CAPTURE_CTA_D2_ICON = '#FFFFFF';
export const CAPTURE_CTA_D2_ICON_STROKE = 2.4;

/** D3 — fond corail soft (~16 %). */
export const CAPTURE_CTA_D3_BG = 'rgba(252, 87, 87, 0.16)';
/** D3 — icônes corail. */
export const CAPTURE_CTA_D3_ICON = CAPTURE_CTA_ICON_CORAL;
export const CAPTURE_CTA_D3_ICON_STROKE = 2.4;

/** D16 — fond corail action uni (splash / CTA app). */
export const CAPTURE_CTA_D16_BG = BRAND_ACTION_ACCENT;
/** D16 — icônes blanches. */
export const CAPTURE_CTA_D16_ICON = '#FFFFFF';
export const CAPTURE_CTA_D16_ICON_STROKE = 2.4;

/** D6 / S6 — fond gris soft. */
export const CAPTURE_CTA_D6_BG = '#E8E6E1';
/** D6 / S6 — icônes encre. */
export const CAPTURE_CTA_D6_ICON = '#1C1C1E';
export const CAPTURE_CTA_D6_ICON_STROKE = 2.4;

export const CAPTURE_CTA_SIZE = scale(72);
export const CAPTURE_CTA_SIZE_COMPACT = scale(60);
export const CAPTURE_CTA_ICON_SIZE = scale(28);
export const CAPTURE_CTA_ICON_SIZE_COMPACT = scale(24);
export const CAPTURE_CTA_MIC_ICON_SIZE = scale(32);
export const CAPTURE_CTA_MIC_ICON_SIZE_COMPACT = scale(27);
