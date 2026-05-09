/**
 * Proportions typographiques identiques au PDF HTML (`server/src/pdf/htmlBook.ts`) :
 * page A5 digital 148 × 210 mm, tailles en pt comme en print CSS.
 * La largeur/hauteur du `View` page en px sert d’échelle (même ratio que le PDF).
 */

export const BOOK_DIGITAL_PAGE_WIDTH_MM = 148;
export const BOOK_DIGITAL_PAGE_HEIGHT_MM = 210;

/** pt (1/72 in) → px sur une largeur de page = largeur A5 digitale en mm. */
export function pdfPtToPreviewPx(pt: number, pageWidthPx: number): number {
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return Math.round(pt);
  return (pt / 72) * 25.4 * (pageWidthPx / BOOK_DIGITAL_PAGE_WIDTH_MM);
}

/** mm le long de la largeur page (même échelle que la largeur A5). */
export function pdfMmToPreviewPxW(mm: number, pageWidthPx: number): number {
  if (!Number.isFinite(pageWidthPx) || pageWidthPx <= 0) return mm;
  return (mm / BOOK_DIGITAL_PAGE_WIDTH_MM) * pageWidthPx;
}

/** mm le long de la hauteur page (même échelle que la hauteur A5). */
export function pdfMmToPreviewPxH(mm: number, pageHeightPx: number): number {
  if (!Number.isFinite(pageHeightPx) || pageHeightPx <= 0) return mm;
  return (mm / BOOK_DIGITAL_PAGE_HEIGHT_MM) * pageHeightPx;
}

/** PDF `.label` — 7 pt (méta date/lieu, folio, pastilles). */
export function pdfLabelStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(5.5, pdfPtToPreviewPx(7, pageWidthPx)) };
}

/** PDF `.body` (citation niveau 0) — 11 pt, interligne 1.65 */
export function pdfBodyStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(6, pdfPtToPreviewPx(11, pageWidthPx));
  return { fontSize: fs, lineHeight: pdfPtToPreviewPx(11 * 1.65, pageWidthPx) };
}

/** `.pf-caption` — 12.75 pt, lh 1.45 */
export function pdfPhotoCaptionStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(6, pdfPtToPreviewPx(12.75, pageWidthPx));
  return { fontSize: fs, lineHeight: pdfPtToPreviewPx(12.75 * 1.45, pageWidthPx) };
}

export type QuotePdfFitLevel = 0 | 1 | 2;

/** `.quote-body` + variantes quote-fit-1 / quote-fit-2 (htmlBook). */
export function pdfQuoteBodyStyle(fit: QuotePdfFitLevel, pageWidthPx: number): { fontSize: number; lineHeight: number } {
  if (fit === 2) {
    return {
      fontSize: Math.max(6, pdfPtToPreviewPx(9.8, pageWidthPx)),
      lineHeight: pdfPtToPreviewPx(9.8 * 1.42, pageWidthPx),
    };
  }
  if (fit === 1) {
    return {
      fontSize: Math.max(6, pdfPtToPreviewPx(10.4, pageWidthPx)),
      lineHeight: pdfPtToPreviewPx(10.4 * 1.48, pageWidthPx),
    };
  }
  return pdfBodyStyle(pageWidthPx);
}

/** Guillemet `.quote-mark` + quote-fit (42 / 37 / 33 pt). */
export function pdfQuoteMarkStyle(fit: QuotePdfFitLevel, pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const pt = fit === 2 ? 33 : fit === 1 ? 37 : 42;
  const fs = Math.max(8, pdfPtToPreviewPx(pt, pageWidthPx));
  return { fontSize: fs, lineHeight: fs };
}

export function pdfChapterMonthStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(6, pdfPtToPreviewPx(9, pageWidthPx)) };
}

export function pdfChapterTitleStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(10, pdfPtToPreviewPx(22, pageWidthPx)) };
}

export function pdfChapterSubStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(6, pdfPtToPreviewPx(9, pageWidthPx)) };
}

export function pdfCoverTitleStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(10, pdfPtToPreviewPx(22, pageWidthPx)) };
}

export function pdfCoverPeriodStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(6, pdfPtToPreviewPx(11, pageWidthPx)) };
}

export function pdfVideoTitleStyle(pageWidthPx: number): { fontSize: number } {
  return { fontSize: Math.max(8, pdfPtToPreviewPx(13.5, pageWidthPx)) };
}

export function pdfVideoSubStyle(pageWidthPx: number): { fontSize: number; lineHeight: number } {
  const fs = Math.max(6, pdfPtToPreviewPx(10.5, pageWidthPx));
  return { fontSize: fs, lineHeight: pdfPtToPreviewPx(10.5 * 1.5, pageWidthPx) };
}

/** `.folio` — 7 pt, bas 8 mm (htmlBook). */
export function pdfFolioStyle(
  pageWidthPx: number,
  pageHeightPx: number
): { fontSize: number; bottom: number } {
  return {
    fontSize: Math.max(5.5, pdfPtToPreviewPx(7, pageWidthPx)),
    bottom: pdfMmToPreviewPxH(8, pageHeightPx),
  };
}
