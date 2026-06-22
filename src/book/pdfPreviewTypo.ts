/**
 * Proportions typographiques alignées sur le PDF HTML (`server/src/pdf/htmlBook.ts`) :
 * format Gelato 21×28 cm trim (210 × 280 mm), tailles en pt comme en print CSS.
 * La largeur/hauteur du `View` page en px sert d’échelle (même ratio que le PDF).
 */

/** Format Gelato 21×28cm trim — portrait, ratio 3/4.
 *  Nom BOOK_DIGITAL_… conservé pour l'instant (rename dans un prompt séparé). */
export const BOOK_DIGITAL_PAGE_WIDTH_MM = 210;
export const BOOK_DIGITAL_PAGE_HEIGHT_MM = 280;

/** Ratio largeur/hauteur page (210/280 = 0.75). Identique au ratio 3:4 photo portrait smartphone. */
export const BOOK_PAGE_RATIO = BOOK_DIGITAL_PAGE_WIDTH_MM / BOOK_DIGITAL_PAGE_HEIGHT_MM;

/** Marge blanche autour des visuels [M] — parité `--visual-margin` dans `htmlBook.ts`. */
export const BOOK_VISUAL_MARGIN_MM = 12;

/** Hauteur bande photo pleine page (`.pf-image`) — 75 % de la page trim. */
export const PHOTO_FULL_BAND_HEIGHT_RATIO = 0.75;

/** Zone image utile photo-note / audio (carré dans la zone safe 186 mm). */
export const PHOTO_NOTE_INNER_MM = 186;

/** Hauteur bande conteneur `.pn-image` (padding 12 mm inclus → intérieur 186×186 mm). */
export const PHOTO_NOTE_BAND_HEIGHT_MM =
  PHOTO_NOTE_INNER_MM + 2 * BOOK_VISUAL_MARGIN_MM;

/** pt (1/72 in) → px sur une largeur de page = largeur trim Gelato en mm. */
export function pdfPtToPreviewPx(pt: number, pageWidthPx: number): number {
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return Math.round(pt);
  return (pt / 72) * 25.4 * (pageWidthPx / BOOK_DIGITAL_PAGE_WIDTH_MM);
}

/** mm le long de la largeur page (même échelle que la largeur trim). */
export function pdfMmToPreviewPxW(mm: number, pageWidthPx: number): number {
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return mm;
  return (mm / BOOK_DIGITAL_PAGE_WIDTH_MM) * pageWidthPx;
}

/** mm le long de la hauteur page (même échelle que la hauteur trim). */
export function pdfMmToPreviewPxH(mm: number, pageHeightPx: number): number {
  if (!Number.isFinite(pageHeightPx) || pageHeightPx <= 0) return mm;
  return (mm / BOOK_DIGITAL_PAGE_HEIGHT_MM) * pageHeightPx;
}

/**
 * Garde minimal anti sous-pixel. Volontairement très bas : la maquette doit rester
 * STRICTEMENT proportionnelle à la largeur de page, y compris en vue spread (vignettes
 * ~moitié de page). À pleine largeur (éditeur) ces tailles dépassent largement ce garde,
 * donc l'éditeur est inchangé ; seul l'aperçu réduit cesse d'être « trop gros ».
 */
const MIN_FS = 1;

/** Réduction légère globale des corps souvenirs (Roboto) — parité `htmlBook.ts` (×15/16). */
const MEMORY_TEXT_SCALE = 15 / 16;

function memorySouvenirPt(basePt: number): number {
  return Math.round(basePt * MEMORY_TEXT_SCALE * 100) / 100;
}

/** Corps souvenir Roboto — 12 pt historique → 11.25 pt. */
export const PDF_MEMORY_BODY_PT = memorySouvenirPt(12);
/** Légende sous photo pleine page — 12 pt historique → 11.25 pt. */
export const PDF_PHOTO_CAPTION_PT = memorySouvenirPt(12);
/** Texte long sous photo (photo-note) — 10 pt net (pas de scale ×15/16). */
export const PDF_PHOTO_NOTE_BODY_PT = 10;
/** Description vidéo (corps souvenir) — 10.5 pt historique → ~9.85 pt. */
export const PDF_VIDEO_SUB_PT = memorySouvenirPt(10.5);
/** Guillemet citation — fit 0 / 1 / 2. */
export const PDF_QUOTE_MARK_PT = {
  0: memorySouvenirPt(42),
  1: memorySouvenirPt(37),
  2: memorySouvenirPt(33),
} as const;
/** Corps citation — fit 0 hérite `.memory-text` ; fit 1 / 2 réduits. */
export const PDF_QUOTE_BODY_FIT_PT = {
  0: PDF_MEMORY_BODY_PT,
  1: memorySouvenirPt(10.4),
  2: memorySouvenirPt(9.8),
} as const;

/** PDF `.label` — 7 pt (méta date/lieu, folio, pastilles). */
export function pdfLabelStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(7, pageWidthPx)) };
}

/** PDF `.body` (citation niveau 0) — 11 pt, interligne 1.65 */
export function pdfBodyStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(11, pageWidthPx));
  return { fontSize: fs, lineHeight: pdfPtToPreviewPx(11 * 1.65, pageWidthPx) };
}

/** Interligne légende photo pleine page — parité `.pf-caption` dans `htmlBook.ts`. */
export const PDF_PHOTO_CAPTION_LINE_HEIGHT = 1.3;
/** Interligne texte photo-note — parité `.photo-note .pn-text .memory-text`. */
export const PDF_PHOTO_NOTE_LINE_HEIGHT = 1.35;

/** `.pf-caption` */
export function pdfPhotoCaptionStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(PDF_PHOTO_CAPTION_PT, pageWidthPx));
  return {
    fontSize: fs,
    lineHeight: pdfPtToPreviewPx(PDF_PHOTO_CAPTION_PT * PDF_PHOTO_CAPTION_LINE_HEIGHT, pageWidthPx),
  };
}

/** `.photo-note .pn-text .memory-text` */
export function pdfPhotoNoteBodyStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(PDF_PHOTO_NOTE_BODY_PT, pageWidthPx));
  return {
    fontSize: fs,
    lineHeight: pdfPtToPreviewPx(PDF_PHOTO_NOTE_BODY_PT * PDF_PHOTO_NOTE_LINE_HEIGHT, pageWidthPx),
  };
}

export type QuotePdfFitLevel = 0 | 1 | 2;

/** Corps souvenir Roboto — parité `.memory-text`. */
export function pdfMemoryTextBodyStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(PDF_MEMORY_BODY_PT, pageWidthPx));
  return { fontSize: fs, lineHeight: pdfPtToPreviewPx(PDF_MEMORY_BODY_PT * 1.588, pageWidthPx) };
}

/** `.quote-body` + variantes quote-fit-1 / quote-fit-2 */
export function pdfQuoteBodyStyle(fit: QuotePdfFitLevel, pageWidthPx: number): { fontSize: number; lineHeight: number } {
  if (fit === 2) {
    const pt = PDF_QUOTE_BODY_FIT_PT[2];
    return {
      fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(pt, pageWidthPx)),
      lineHeight: pdfPtToPreviewPx(pt * 1.42, pageWidthPx),
    };
  }
  if (fit === 1) {
    const pt = PDF_QUOTE_BODY_FIT_PT[1];
    return {
      fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(pt, pageWidthPx)),
      lineHeight: pdfPtToPreviewPx(pt * 1.48, pageWidthPx),
    };
  }
  return pdfMemoryTextBodyStyle(pageWidthPx);
}

/** Guillemet `.quote-mark` + quote-fit */
export function pdfQuoteMarkStyle(fit: QuotePdfFitLevel, pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const pt = PDF_QUOTE_MARK_PT[fit];
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(pt, pageWidthPx));
  return { fontSize: fs, lineHeight: fs };
}

export function pdfChapterMonthStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(9, pageWidthPx)) };
}

export function pdfChapterTitleStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(22, pageWidthPx)) };
}

export function pdfChapterSubStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(9, pageWidthPx)) };
}

export function pdfCoverTitleStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(22, pageWidthPx)) };
}

export function pdfCoverPeriodStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(11, pageWidthPx)) };
}

export function pdfVideoTitleStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(13.5, pageWidthPx)) };
}

export function pdfVideoSubStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(MIN_FS, pdfPtToPreviewPx(PDF_VIDEO_SUB_PT, pageWidthPx));
  return { fontSize: fs, lineHeight: pdfPtToPreviewPx(PDF_VIDEO_SUB_PT * 1.5, pageWidthPx) };
}

/** `.folio` — 7 pt, bas 8 mm (htmlBook). */
export function pdfFolioStyle(
  pageWidthPx: number,
  pageHeightPx: number
): { fontSize: number; bottom: number } {
  return {
    fontSize: Math.max(MIN_FS, pdfPtToPreviewPx(7, pageWidthPx)),
    bottom: pdfMmToPreviewPxH(8, pageHeightPx),
  };
}
