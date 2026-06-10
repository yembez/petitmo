import { scale, verticalScale } from '@/utils/responsive';

/**
 * Fil : photos / vidéos bord à bord, sans coins arrondis (style type fil social).
 * Les posts « texte » utilisent `TEXT_POST_CARD_*` pour garder des marges lisibles.
 */
export const MEDIA_CARD_INSET = 0;
export const MEDIA_CARD_RADIUS = 0;

/** Marge latérale carte texte fil — plus faible = carte plus large à l’écran. */
export const TEXT_POST_CARD_INSET = scale(10);
export const TEXT_POST_CARD_RADIUS = scale(12);

/** Posts texte fil : hauteur max du corps avant scroll interne (~13 lignes). */
export const FEED_TEXT_POST_SCROLL_MAX_H = verticalScale(360);
/** Annotations sous photo / vidéo / vocal : scroll interne (~7 lignes). */
export const FEED_CAPTION_SCROLL_MAX_H = verticalScale(168);
/** Légende sous média dans le viewer immersif (plafond ; peut être réduit selon l’écran). */
export const IMMERSIVE_CAPTION_SCROLL_MAX_H = verticalScale(220);
