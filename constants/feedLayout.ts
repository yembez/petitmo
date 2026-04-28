import { scale } from '@/utils/responsive';

/**
 * Fil : photos / vidéos bord à bord, sans coins arrondis (style type fil social).
 * Les posts « texte » utilisent `TEXT_POST_CARD_*` pour garder des marges lisibles.
 */
export const MEDIA_CARD_INSET = 0;
export const MEDIA_CARD_RADIUS = 0;

export const TEXT_POST_CARD_INSET = scale(16);
export const TEXT_POST_CARD_RADIUS = scale(12);
