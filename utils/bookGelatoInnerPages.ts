/**
 * Pages intérieures livre photo Gelato (aligné `server/src/gelato/photobookLayout.ts`).
 *
 * **Règle produit (affichage client)** : on montre UNIQUEMENT
 * `gelatoCatalogPageCount` — le même chiffre que Gelato.
 * Jamais `pages.length` (qui inclut couverture + 4e et crée l’écart 31 vs 30).
 *
 * - Catalogue Gelato = souvenirs + « Notre histoire », hors cover/back-cover, **pair** (≥ 30).
 * - Facturation V1 = **même compteur catalogue Gelato** (+ QR A/V au checkout) — `lib/pricingV1.ts`.
 * - Folio imprimé / spread / éditeur = **numéro intérieur Gelato** (hors cover/4e), jamais `index + 1`.
 *
 * Ex. maquette interne 31 feuillets = cover + 29 intérieures + back → affichage client **30**.
 */

/** Minimum catalogue Gelato (pages intérieures imprimables, nombre pair). */
export const GELATO_MIN_INNER_PAGES = 30;

export function gelatoInnerPageCount(pages: ReadonlyArray<{ type: string }>): number {
  return pages.filter(p => p.type !== 'cover' && p.type !== 'back-cover').length;
}

/** pageCount catalogue Gelato (pair) — pad +1 si impair. C’est LE chiffre affiché au client. */
export function gelatoCatalogPageCount(pages: ReadonlyArray<{ type: string }>): number {
  const n = gelatoInnerPageCount(pages);
  return n + (n % 2);
}

/**
 * Folio / libellé « Page N » : numéro intérieur Gelato (1…catalogue).
 * `null` pour couverture / 4e (pas de folio).
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

/** Header / totaux : toujours le compteur Gelato. */
export function formatGelatoPrintPageCountLabel(pages: ReadonlyArray<{ type: string }>): string {
  const catalog = gelatoCatalogPageCount(pages);
  if (catalog < GELATO_MIN_INNER_PAGES) {
    return `${catalog} / ${GELATO_MIN_INNER_PAGES} pages`;
  }
  return `${catalog} pages`;
}

/**
 * Position dans l’éditeur : « Page 3 · 30 pages ».
 * Couverture / 4e nommées à part ; le total est toujours Gelato.
 */
export function formatBookEditorPageLabel(
  pages: ReadonlyArray<{ type: string }>,
  pageIndex: number,
): string {
  const total = Math.max(1, gelatoCatalogPageCount(pages));
  const page = pages[pageIndex];
  if (!page) return `${total} pages`;
  if (page.type === 'cover') return `Couverture · ${total} pages`;
  if (page.type === 'back-cover') return `4e de couverture · ${total} pages`;
  const innerNum = gelatoInnerPageNumber(pages, pageIndex);
  return `Page ${innerNum ?? 0} · ${total} pages`;
}

/** Fraction type « 3 / 30 » (hors cover/4e → libellé court). */
export function formatBookEditorPageFraction(
  pages: ReadonlyArray<{ type: string }>,
  pageIndex: number,
): string {
  const total = Math.max(1, gelatoCatalogPageCount(pages));
  const page = pages[pageIndex];
  if (!page || page.type === 'cover') return `Couverture`;
  if (page.type === 'back-cover') return `4e`;
  const innerNum = gelatoInnerPageNumber(pages, pageIndex);
  return `${innerNum ?? 0} / ${total}`;
}

export function gelatoMinInnerPagesAlertMessage(innerCount: number): string {
  const catalog = innerCount + (innerCount % 2);
  const missing = Math.max(0, GELATO_MIN_INNER_PAGES - catalog);
  return (
    `Ton livre compte ${catalog} pages (minimum ${GELATO_MIN_INNER_PAGES} pour l’impression).\n\n` +
    (missing > 0
      ? `Ajoute encore ${missing} page${missing > 1 ? 's' : ''} de souvenirs pour pouvoir commander.`
      : `Tu peux commander l’impression.`)
  );
}
