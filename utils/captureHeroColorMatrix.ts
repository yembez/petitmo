import {
  brightness,
  concatColorMatrices,
  contrast,
  saturate,
  temperature,
} from 'react-native-color-matrix-image-filters';

import type { Matrix } from 'react-native-color-matrix-image-filters';

/**
 * Color grading léger sur la photo hero « Capturer » (souvenir chaleureux type Memories).
 * Saturation −5 %, contraste adouci, chaleur légère (corail / rosé doux via `temperature`),
 * noirs un peu relevés.
 *
 * Ne pas utiliser `colorTone` ici : concaténé avec d’autres matrices, il produit un voile bleu.
 */
export const CAPTURE_HERO_COLOR_MATRIX: Matrix = concatColorMatrices(
  saturate(0.95),
  contrast(0.94),
  temperature(0.05),
  brightness(1.02),
);
