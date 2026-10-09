import { scale, verticalScale } from '@/utils/responsive';

/**
 * Fil : posts photo/vidéo bord à bord, coins droits ; ratio natif (portrait / paysage).
 * Les posts « texte » utilisent `TEXT_POST_CARD_*` pour garder des marges lisibles.
 */
export const MEDIA_CARD_INSET = 0;
export const MEDIA_CARD_RADIUS = 0;

/**
 * Carte post fil photo/vidéo : coins droits, bord à bord (style journal).
 * Les posts texte gardent `TEXT_POST_CARD_RADIUS`.
 */
export const FEED_POST_CARD_RADIUS = 0;
export const FEED_POST_CARD_RADIUS_BL = 0;

/** Marge latérale carte texte fil — plus faible = carte plus large à l’écran. */
export const TEXT_POST_CARD_INSET = scale(10);
export const TEXT_POST_CARD_RADIUS = scale(12);

/** Posts texte fil : hauteur max du corps avant scroll interne (~13 lignes). */
export const FEED_TEXT_POST_SCROLL_MAX_H = verticalScale(360);
/** Annotations sous photo / vidéo / vocal : scroll interne (~7 lignes). */
export const FEED_CAPTION_SCROLL_MAX_H = verticalScale(168);
/** Légende sous média dans le viewer immersif (plafond ; peut être réduit selon l’écran). */
export const IMMERSIVE_CAPTION_SCROLL_MAX_H = verticalScale(220);
