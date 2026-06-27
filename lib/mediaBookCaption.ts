/**
 * Légende sous visuel + carte QR (audio / vidéo) — maquette + PDF.
 * Gabarit : 6 lignes de ~70 caractères (EB Garamond, colonne à côté de la carte QR).
 * Miroir : `server/src/pdf/mediaBookCaption.ts`.
 */
import {
  clampTextToBookLineBudget,
  MAX_MEDIA_CAPTION_LINES,
  MEDIA_CAPTION_CHARS_PER_LINE,
} from '@/utils/textLimits';

export { MAX_MEDIA_CAPTION_LINES, MEDIA_CAPTION_CHARS_PER_LINE };

/** @deprecated Préférer `MAX_MEDIA_CAPTION_LINES` */
export const MAX_MEDIA_QR_CAPTION_LINES = MAX_MEDIA_CAPTION_LINES;

/** Garde-fou affichage livre si contenu legacy dépasse le budget. */
export function clampMediaBookCaption(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  return clampTextToBookLineBudget(t, MAX_MEDIA_CAPTION_LINES, MEDIA_CAPTION_CHARS_PER_LINE);
}

/** @deprecated Préférer `clampMediaBookCaption` */
export function clampAudioBookAnnotation(raw: string): string {
  return clampMediaBookCaption(raw);
}
