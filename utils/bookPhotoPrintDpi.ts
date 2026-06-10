/** Dimensions d’impression du cadre photo (mm) — aligné `printFrameMmFor` / serveur PDF. */
export const BOOK_PAGE_W_MM = 154;
export const BOOK_PAGE_H_MM = 216;
export const BOOK_VISUAL_MARGIN_MM = 10;

export type BookPhotoPageType = 'cover' | 'photo-full' | 'photo-note' | 'audio';

export function bookPrintFrameMmFor(pageType: BookPhotoPageType): { w: number; h: number } {
  if (pageType === 'cover') return { w: BOOK_PAGE_W_MM, h: 142 };
  const m = BOOK_VISUAL_MARGIN_MM;
  const bandHmm =
    pageType === 'photo-note' || pageType === 'audio' ? BOOK_PAGE_H_MM * 0.6 : BOOK_PAGE_H_MM * 0.82;
  return { w: BOOK_PAGE_W_MM - 2 * m, h: bandHmm - 2 * m };
}

function mmToIn(mm: number): number {
  return mm / 25.4;
}

/** DPI effectif pour l’impression selon zoom (scale) et résolution fichier. */
export function effectiveBookPhotoPrintDpi(args: {
  imgPxW: number;
  imgPxH: number;
  printMmW: number;
  printMmH: number;
  scale: number;
}): number {
  const { imgPxW, imgPxH, printMmW, printMmH } = args;
  if (!imgPxW || !imgPxH) return 0;
  const s = Math.max(1, args.scale);
  const wIn = mmToIn(Math.max(1, printMmW));
  const hIn = mmToIn(Math.max(1, printMmH));
  const dpiX = imgPxW / s / wIn;
  const dpiY = imgPxH / s / hIn;
  return Math.floor(Math.min(dpiX, dpiY));
}

export type BookPhotoDpiStatus = 'ok' | 'warn' | 'block' | 'unknown';

export function bookPhotoDpiStatus(dpi: number): BookPhotoDpiStatus {
  if (dpi <= 0) return 'unknown';
  if (dpi < 200) return 'block';
  if (dpi < 240) return 'warn';
  return 'ok';
}

export function bookPhotoDpiStatusLabel(status: BookPhotoDpiStatus): string {
  switch (status) {
    case 'ok':
      return 'OK ≥ 240';
    case 'warn':
      return 'Faible < 240';
    case 'block':
      return 'Très faible < 200';
    default:
      return '—';
  }
}
