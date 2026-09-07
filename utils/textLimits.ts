/**
 * Limites de texte pour les souvenirs texte — calibrées sur **une page citation A5** du livre
 * (typo Garamond, alinéas, retours à la ligne et lignes vides inclus).
 *
 * Le fil affiche un extrait scrollable ; la contrainte à l’enregistrement est en lignes livre.
 */

/** Plafond de lignes sur la page « Petits mots » (fit level 2 inclus). Lignes vides comptées. */
export const MAX_BOOK_LINES = 28;

/** Plafond captions photo dans le livre (photo-full + photo-note). */
export const MAX_BOOK_CAPTION_LINES = 12;

/**
 * Légende audio / vidéo (visuel + carte QR) — gabarit maquette : **6 lignes** de
 * ~70 caractères (typo DM Sans, colonne ~134 mm à côté de la carte QR).
 */
export const MAX_MEDIA_CAPTION_LINES = 6;

/** Largeur moyenne d’une ligne de légende média (à côté de la carte QR), DM Sans ~12 pt. */
export const MEDIA_CAPTION_CHARS_PER_LINE = 50;

/** @deprecated Préférer `MAX_MEDIA_CAPTION_LINES` */
export const MAX_MEDIA_QR_CAPTION_LINES = MAX_MEDIA_CAPTION_LINES;

/** @deprecated Préférer `MAX_MEDIA_CAPTION_LINES` */
export const MAX_AUDIO_BOOK_ANNOTATION_LINES = MAX_MEDIA_CAPTION_LINES;

/** Plafond lignes livre selon le type de souvenir (saisie modale). */
export function bookLineBudgetForMemoryType(type: string | undefined): number {
  if (type === 'text') return MAX_BOOK_LINES;
  if (type === 'voice' || type === 'video') return MAX_MEDIA_CAPTION_LINES;
  if (type === 'photo') return MAX_BOOK_CAPTION_LINES;
  return MAX_BOOK_LINES;
}

/** Largeur de ligne (caractères) selon le type de souvenir — pour l’estimation lignes livre. */
export function bookCharsPerLineForMemoryType(type: string | undefined): number {
  if (type === 'voice' || type === 'video') return MEDIA_CAPTION_CHARS_PER_LINE;
  return BOOK_CHARS_PER_LINE;
}

/** Titre optionnel sur un souvenir texte (fil). */
export const MAX_TEXT_MEMORY_TITLE_CHARS = 100;

/**
 * Largeur moyenne en caractères d’une ligne sur la page citation livre.
 * Aligné sur `quoteFitLevel.ts` / `server/src/pdf/maquetteAlign.ts` (≈ 42 car/ligne).
 */
export const BOOK_CHARS_PER_LINE = 42;

/** Filet de sécurité caractères (secondaire, ne remplace pas le plafond lignes). */
export const MAX_TEXT_CHARS_SAFETY = MAX_BOOK_LINES * BOOK_CHARS_PER_LINE;

/** @deprecated — utiliser `MAX_BOOK_LINES` */
export const MAX_VISUAL_LINES = MAX_BOOK_LINES;

/** @deprecated — utiliser `MAX_TEXT_CHARS_SAFETY` */
export const MAX_TEXT_CHARS = MAX_TEXT_CHARS_SAFETY;

/** Avant enregistrement si `clampText` raccourcit le texte (contrainte page livre A5). */
export const TEXT_TRUNCATION_ALERT_TITLE =
  'Ton texte complet ne tient pas sur une page du livre';

export const TEXT_TRUNCATION_ALERT_MESSAGE =
  'Petit Cœur limite la longueur des souvenirs texte pour qu’ils tiennent sur une page du livre (28 lignes maximum, retours à la ligne et lignes vides inclus). La fin de ton message serait coupée à l’enregistrement.\n\nTu peux revenir au texte pour le raccourcir, ou enregistrer seulement ce qui tiendra dans le livre.';

export const TEXT_TRUNCATION_MODIFY_LABEL = 'Modifier le texte';
export const TEXT_TRUNCATION_SAVE_LABEL = 'Enregistrer la version courte';

export const TEXT_SAVE_FAILED_ALERT_TITLE = 'Enregistrement impossible';

export const TEXT_SAVE_FAILED_ALERT_MESSAGE =
  'Ton texte n’a pas été sauvegardé. Réessaie dans un instant. Si ça bloque encore, copie ton texte dans les Notes du téléphone pour ne rien perdre.';

/**
 * Compte les lignes « livre » : chaque `\n` (y compris ligne vide) + wrapping des lignes longues.
 */
export function estimateBookLines(
  text: string,
  charsPerLine: number = BOOK_CHARS_PER_LINE,
): number {
  if (!text) return 0;

  const physicalLines = text.split('\n');
  let total = 0;

  for (const line of physicalLines) {
    if (line.length === 0) {
      total += 1;
      continue;
    }
    // +1 pour l’alinéa (EM_QUAD) appliqué à chaque segment dans la maquette livre.
    total += Math.max(1, Math.ceil((line.length + 1) / charsPerLine));
  }

  return total;
}

/** @deprecated — utiliser `estimateBookLines` */
export function estimateVisualLines(text: string): number {
  return estimateBookLines(text);
}

function trimToLineBudget(
  text: string,
  maxLines: number,
  charsPerLine: number = BOOK_CHARS_PER_LINE,
): string {
  let clamped = text;
  while (clamped.length > 0 && estimateBookLines(clamped, charsPerLine) > maxLines) {
    const lastNewline = clamped.lastIndexOf('\n');
    if (lastNewline >= 0) {
      clamped = clamped.slice(0, lastNewline);
    } else {
      clamped = clamped.slice(0, clamped.length - 1);
    }
  }
  return clamped;
}

function trimToBookLineBudget(text: string): string {
  return trimToLineBudget(text, MAX_BOOK_LINES);
}

/**
 * Pendant la saisie : refuse le dépassement sans raccourcir le texte existant.
 * Évite les effacements / réapparitions avec la dictée clavier près du plafond.
 */
export function enforceTextBookLineBudgetOnInput(
  prev: string,
  next: string,
  maxLines: number,
  charsPerLine: number = BOOK_CHARS_PER_LINE,
): string {
  const maxChars = maxLines * charsPerLine;
  if (next.length > maxChars) return prev;
  if (estimateBookLines(next, charsPerLine) > maxLines) return prev;
  return next;
}

/**
 * Pendant la saisie : plafond lignes livre — tronque à l’enregistrement (`clampText`).
 * @deprecated Préférer `enforceTextBookLineBudgetOnInput` en `onChangeText`.
 */
export function clampTextBookLineBudget(text: string): string {
  let t = text.length > MAX_TEXT_CHARS_SAFETY ? text.slice(0, MAX_TEXT_CHARS_SAFETY) : text;
  return trimToBookLineBudget(t);
}

/** Pendant la saisie : plafond lignes caption livre (photo / audio / vidéo). */
export function clampTextCaptionLineBudget(text: string): string {
  const maxChars = MAX_BOOK_CAPTION_LINES * BOOK_CHARS_PER_LINE;
  let t = text.length > maxChars ? text.slice(0, maxChars) : text;
  return trimToLineBudget(t, MAX_BOOK_CAPTION_LINES);
}

/** Plafond lignes livre paramétrable (saisie). */
export function clampTextToBookLineBudget(
  text: string,
  maxLines: number,
  charsPerLine: number = BOOK_CHARS_PER_LINE,
): string {
  const maxChars = maxLines * charsPerLine;
  let t = text.length > maxChars ? text.slice(0, maxChars) : text;
  return trimToLineBudget(t, maxLines, charsPerLine);
}

/** @deprecated — utiliser `clampTextBookLineBudget` */
export function clampTextCharBudget(text: string): string {
  return clampTextBookLineBudget(text);
}

/**
 * Applique la contrainte lignes livre (+ filet caractères) à l’enregistrement.
 */
export function clampText(text: string): string {
  return clampTextBookLineBudget(text);
}
