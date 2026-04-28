/**
 * Limites de texte pour les souvenirs texte, calibrées pour tenir
 * sur une page de livre A5 dans la preview ET dans le PDF.
 *
 * Le preview est le facteur limitant (~17 lignes visuelles disponibles
 * avec fontSize 16, lineHeight 26 et ~40 car/ligne sur iPhone).
 */

export const MAX_TEXT_CHARS = 600;

/**
 * Nombre max de lignes visuelles estimées.
 * 16 lignes laissent 1 ligne de marge sous les 17 disponibles.
 */
export const MAX_VISUAL_LINES = 16;

/**
 * Largeur moyenne en caractères d'une ligne dans MaquetteQuote.
 * Basé sur fontSize 16, EB Garamond Italic, ~335pt de large.
 */
const CHARS_PER_LINE = 40;

/**
 * Estime le nombre de lignes visuelles qu'occupera le texte
 * après application de romanParagraphs (alinéas EM_QUAD).
 *
 * - Double saut de ligne → paragraphe séparé par une ligne vide.
 * - Simple saut de ligne → retour à la ligne avec alinéa.
 * - Chaque segment de texte est arrondi au nombre de lignes occupées par wrapping.
 */
export function estimateVisualLines(text: string): number {
  if (!text.trim()) return 0;

  const paragraphs = text.split(/\n{2,}/);
  let total = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) total += 1; // blank line between paragraphs

    const lines = paragraphs[i].split('\n');
    for (const line of lines) {
      // +1 for EM_QUAD indent character
      total += Math.max(1, Math.ceil((line.length + 1) / CHARS_PER_LINE));
    }
  }

  return total;
}

/**
 * Applique la double contrainte (caractères + lignes visuelles).
 * Retourne le texte accepté (éventuellement tronqué).
 */
export function clampText(text: string): string {
  let clamped = text.length > MAX_TEXT_CHARS
    ? text.slice(0, MAX_TEXT_CHARS)
    : text;

  if (estimateVisualLines(clamped) <= MAX_VISUAL_LINES) return clamped;

  // Trop de lignes visuelles — on retire du texte par la fin
  // jusqu'à ce que ça tienne.
  while (clamped.length > 0 && estimateVisualLines(clamped) > MAX_VISUAL_LINES) {
    const lastNewline = clamped.lastIndexOf('\n');
    if (lastNewline > 0) {
      clamped = clamped.slice(0, lastNewline);
    } else {
      clamped = clamped.slice(0, clamped.length - 1);
    }
  }

  return clamped;
}
