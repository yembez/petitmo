import {
  brightness,
  concatColorMatrices,
  saturate,
  temperature,
} from 'react-native-color-matrix-image-filters';

import type { Matrix } from 'react-native-color-matrix-image-filters';

/**
 * Color grading léger sur la photo hero « Capturer » (souvenir chaleureux type Memories).
 * Saturation −10 %, chaleur légère (corail / rosé doux via `temperature`), noirs un peu relevés.
 * Pas d’adoucissement de contraste — la photo garde son punch natif.
 *
 * Ne pas utiliser `colorTone` ici : concaténé avec d’autres matrices, il produit un voile bleu.
 */
export const CAPTURE_HERO_COLOR_MATRIX: Matrix = concatColorMatrices(
  saturate(0.9),
  temperature(0.12),
  brightness(1.01),
);
