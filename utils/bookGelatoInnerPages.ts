/**
 * Pages intérieures livre photo Gelato (aligné `server/src/gelato/photobookLayout.ts`).
 * Tout sauf couverture et quatrième maquette : chapitres « Notre histoire » + pages souvenirs.
 *
 * Template Gelato : N intérieures (pair, ≥ 30) → PDF = N + 3
 * (spread couverture + garde avant + N + garde arrière).
 * Ex. 30 intérieures → 33 pages PDF. Le pageCount API = N, pas le total PDF.
 */

/** Minimum catalogue Gelato (pages intérieures imprimables). */
export const GELATO_MIN_INNER_PAGES = 30;

export function gelatoInnerPageCount(pages: ReadonlyArray<{ type: string }>): number {
  return pages.filter(p => p.type !== 'cover' && p.type !== 'back-cover').length;
}

/** pageCount catalogue Gelato (pair) — pad +1 si impair. */
export function gelatoCatalogPageCount(pages: ReadonlyArray<{ type: string }>): number {
  const n = gelatoInnerPageCount(pages);
  return n + (n % 2);
}

export function gelatoMinInnerPagesAlertMessage(innerCount: number): string {
  const catalog = innerCount + (innerCount % 2);
  const missing = Math.max(0, GELATO_MIN_INNER_PAGES - catalog);
  return (
    `Ce livre compte ${innerCount} page(s) intérieure(s) (souvenirs + pages « Notre histoire »). ` +
    `L’impression Gelato exige au minimum ${GELATO_MIN_INNER_PAGES} pages intérieures (nombre pair).\n\n` +
    (missing > 0
      ? `Ajoutez encore ${missing} page(s) de contenu pour commander l’impression.`
      : `Astuce : ${innerCount} pages PDF visibles ≠ pageCount Gelato (intérieures hors couvertures/gardes).`)
  );
}
