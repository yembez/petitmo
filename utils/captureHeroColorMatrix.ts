import {
  brightness,
  concatColorMatrices,
  contrast,
  saturate,
  temperature,
} from 'react-native-color-matrix-image-filters';

import type { Matrix } from 'react-native-color-matrix-image-filters';

/**
 * Color grading léger sur la photo hero « Capturer » (souvenir / lumière chaude type Memories).
 * Saturation −5 %, chaleur légère, contraste un peu adouci, noirs un peu relevés.
 */
export const CAPTURE_HERO_COLOR_MATRIX: Matrix = concatColorMatrices(
  saturate(0.95),
  contrast(0.94),
  temperature(0.04),
  brightness(1.02),
);
