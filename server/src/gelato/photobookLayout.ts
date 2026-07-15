import type { BookPageServer } from '../types/contracts';

/** Pages intérieures (hors couverture / quatrième maquette). */
export function gelatoInnerPages(pages: BookPageServer[]): BookPageServer[] {
  return pages.filter(p => p.type !== 'cover' && p.type !== 'back-cover');
}

/**
 * Gelato photobook : spread couverture + garde avant + N intérieures + garde arrière.
 * Ex. 30 pages intérieures → 33 pages PDF (cf. template Gelato 8×11).
 */
export function gelatoPhotobookPdfPageCount(pages: BookPageServer[]): number {
  return gelatoInnerPages(pages).length + 3;
}

export function gelatoInnerPageCount(pages: BookPageServer[]): number {
  return gelatoInnerPages(pages).length;
}

/** Minimum catalogue Gelato (pages intérieures imprimables). */
export const GELATO_MIN_INNER_PAGES = 30;

export function validateGelatoInnerPageCount(pages: BookPageServer[]): string | null {
  const inner = gelatoInnerPageCount(pages);
  if (inner < GELATO_MIN_INNER_PAGES) {
    return `Livre Gelato : ${inner} page(s) intérieure(s), minimum ${GELATO_MIN_INNER_PAGES}`;
  }
  return null;
}
