import type { BookPageServer } from '../types/contracts';

/** Pages intérieures (hors couverture / quatrième maquette). */
export function gelatoInnerPages(pages: BookPageServer[]): BookPageServer[] {
  return pages.filter(p => p.type !== 'cover' && p.type !== 'back-cover');
}

/**
 * Gelato photobook : spread couverture + garde avant + N intérieures (+ pad pair) + garde arrière.
 * Ex. 30 pages intérieures → 33 pages PDF (template Gelato photobook 21×28).
 * @see https://support.gelato.com/en/articles/8996282-how-do-i-design-a-photo-book
 */
export function gelatoPhotobookPdfPageCount(pages: BookPageServer[]): number {
  return gelatoCatalogPageCount(pages) + 3;
}

/**
 * pageCount API Gelato = pages intérieures catalogue (pair, ≥ 30).
 * Impair → +1 (page blanche de padding) : Gelato refuse les pageCount impairs.
 */
export function gelatoCatalogPageCount(pages: BookPageServer[]): number {
  const n = gelatoInnerPages(pages).length;
  return n + (n % 2);
}

export function gelatoInnerPageCount(pages: BookPageServer[]): number {
  return gelatoInnerPages(pages).length;
}

/**
 * Folio imprimé = numéro intérieur Gelato (aligné éditeur / spread app).
 * `null` pour couverture / 4e.
 */
export function gelatoInnerPageNumber(
  pages: ReadonlyArray<{ type: string }>,
  pageIndex: number,
): number | null {
  const page = pages[pageIndex];
  if (!page || page.type === 'cover' || page.type === 'back-cover') return null;
  let innerNum = 0;
  for (let i = 0; i <= pageIndex && i < pages.length; i += 1) {
    const p = pages[i];
    if (p && p.type !== 'cover' && p.type !== 'back-cover') innerNum += 1;
  }
  return innerNum > 0 ? innerNum : null;
}

/** Minimum catalogue Gelato (pages intérieures imprimables). */
export const GELATO_MIN_INNER_PAGES = 30;

export function validateGelatoInnerPageCount(pages: BookPageServer[]): string | null {
  const raw = gelatoInnerPageCount(pages);
  const catalog = gelatoCatalogPageCount(pages);
  if (catalog < GELATO_MIN_INNER_PAGES) {
    return (
      `Livre Gelato : ${raw} page(s) intérieure(s), minimum ${GELATO_MIN_INNER_PAGES}` +
      ` (catalogue pair).`
    );
  }
  return null;
}
