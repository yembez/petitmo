/**
 * Dimensions livre Gelato 21×28 cm — parité `server/src/constants/pdfDigitalSpec.ts`.
 * DPI : calcul sur le **trim** (zone de coupe), pas sur la page PDF avec fond perdu.
 */
import {
  BOOK_VISUAL_MARGIN_MM,
  PHOTO_FULL_BAND_HEIGHT_RATIO,
  PHOTO_NOTE_BAND_HEIGHT_MM,
  PHOTO_FULL_FP_FOOTER_MM,
  PHOTO_FULL_FP_IMAGE_HEIGHT_MM,
} from '@/src/book/pdfPreviewTypo';
import { BOOK_COVER_PHOTO_HEIGHT_RATIO } from '@/constants/bookCoverThumbnail';
import type { PhotoFullVariant } from '@/src/book/BookEngine';

export const BOOK_PAGE_W_MM = 210;
export const BOOK_PAGE_H_MM = 280;
/** Fond perdu Gelato (4 mm chaque côté). */
export const BOOK_PRINT_BLEED_MM = 4;
export const BOOK_PRINT_PAGE_W_MM = BOOK_PAGE_W_MM + 2 * BOOK_PRINT_BLEED_MM;
export const BOOK_PRINT_PAGE_H_MM = BOOK_PAGE_H_MM + 2 * BOOK_PRINT_BLEED_MM;

export type BookPhotoPageType = 'cover' | 'photo-full' | 'photo-note' | 'audio' | 'video';

export function bookPrintFrameMmFor(
  pageType: BookPhotoPageType,
  photoFullVariant?: PhotoFullVariant
): { w: number; h: number } {
  /** Bandeau couverture = pageH × 142/216 (~183,7 mm), pas 142 mm absolus. */
  if (pageType === 'cover') {
    return { w: BOOK_PAGE_W_MM, h: BOOK_PAGE_H_MM * BOOK_COVER_PHOTO_HEIGHT_RATIO };
  }
  const m = BOOK_VISUAL_MARGIN_MM;
  if (pageType === 'photo-full' && photoFullVariant === 'FP') {
    return { w: BOOK_PAGE_W_MM, h: PHOTO_FULL_FP_IMAGE_HEIGHT_MM };
  }
  const bandHmm =
    pageType === 'photo-note' || pageType === 'audio' || pageType === 'video'
      ? PHOTO_NOTE_BAND_HEIGHT_MM
      : BOOK_PAGE_H_MM * PHOTO_FULL_BAND_HEIGHT_RATIO;
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
      return 'En attente du fichier print…';
  }
}
