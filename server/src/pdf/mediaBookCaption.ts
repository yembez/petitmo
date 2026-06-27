/**
 * Aligné sur `lib/mediaBookCaption.ts` — package serveur isolé.
 * Gabarit : 6 lignes de ~70 caractères (EB Garamond, colonne à côté de la carte QR).
 */
export const MAX_MEDIA_CAPTION_LINES = 6;
export const MEDIA_CAPTION_CHARS_PER_LINE = 50;

/** @deprecated Préférer `MAX_MEDIA_CAPTION_LINES` */
export const MAX_MEDIA_QR_CAPTION_LINES = MAX_MEDIA_CAPTION_LINES;

function estimateBookLines(text: string, charsPerLine: number): number {
  if (!text) return 0;
  const physicalLines = text.split('\n');
  let total = 0;
  for (const line of physicalLines) {
    if (line.length === 0) {
      total += 1;
      continue;
    }
    total += Math.max(1, Math.ceil((line.length + 1) / charsPerLine));
  }
  return total;
}

function trimToLineBudget(text: string, maxLines: number, charsPerLine: number): string {
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

export function clampMediaBookCaption(raw: string): string {
  const t = raw.trim();
  if (!t) return '';
  const maxChars = MAX_MEDIA_CAPTION_LINES * MEDIA_CAPTION_CHARS_PER_LINE;
  const sliced = t.length > maxChars ? t.slice(0, maxChars) : t;
  return trimToLineBudget(sliced, MAX_MEDIA_CAPTION_LINES, MEDIA_CAPTION_CHARS_PER_LINE);
}

/** @deprecated Préférer `clampMediaBookCaption` */
export function clampAudioBookAnnotation(raw: string): string {
  return clampMediaBookCaption(raw);
}
