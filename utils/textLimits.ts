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

/** Avant enregistrement si `clampText` raccourcit le texte (contrainte page livre A5). */
export const TEXT_TRUNCATION_ALERT_TITLE =
  'Ton texte complet ne tient pas sur une page du livre';

export const TEXT_TRUNCATION_ALERT_MESSAGE =
  'Petitmo limite la longueur des souvenirs texte pour qu’ils s’affichent bien dans le livre (nombre de caractères et de lignes). La fin de ton message serait donc coupée à l’enregistrement — ce n’est pas un bug.\n\nTu peux revenir au texte pour le raccourcir toi-même, ou enregistrer seulement ce qui tiendra dans le livre.';

export const TEXT_TRUNCATION_MODIFY_LABEL = 'Modifier le texte';
export const TEXT_TRUNCATION_SAVE_LABEL = 'Enregistrer la version courte';

export const TEXT_SAVE_FAILED_ALERT_TITLE = 'Enregistrement impossible';

export const TEXT_SAVE_FAILED_ALERT_MESSAGE =
  'Ton texte n’a pas été sauvegardé. Réessaie dans un instant. Si ça bloque encore, copie ton texte dans les Notes du téléphone pour ne rien perdre.';

/**
 * Pendant la saisie (clavier / dictée système iOS) : limite uniquement le nombre de caractères.
 * Ne pas appeler `clampText` à chaque `onChangeText` : la dictée envoie des remplacements successifs du
 * champ contrôlé ; tronquer aussi sur les « lignes livre » provoque des sauts et des pertes apparentes.
 * Utiliser `clampText` au moment de valider (enregistrer / fermer le modal).
 */
export function clampTextCharBudget(text: string): string {
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

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
 * Préférer `clampTextCharBudget` pendant la frappe ; appeler ceci à l'enregistrement.
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
