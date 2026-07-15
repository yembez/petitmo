/**
 * Pages intérieures livre photo Gelato (aligné `server/src/gelato/photobookLayout.ts`).
 * Tout sauf couverture et quatrième maquette : chapitres « Notre histoire » + pages souvenirs.
 */

/** Minimum catalogue Gelato (pages intérieures imprimables). */
export const GELATO_MIN_INNER_PAGES = 30;

export function gelatoInnerPageCount(pages: ReadonlyArray<{ type: string }>): number {
  return pages.filter(p => p.type !== 'cover' && p.type !== 'back-cover').length;
}

export function gelatoMinInnerPagesAlertMessage(innerCount: number): string {
  const missing = Math.max(0, GELATO_MIN_INNER_PAGES - innerCount);
  return (
    `Ce livre compte ${innerCount} page(s) intérieure(s) (souvenirs + pages « Notre histoire »). ` +
    `L’impression exige au minimum ${GELATO_MIN_INNER_PAGES} pages.\n\n` +
    `Ajoutez encore ${missing} page(s) de contenu pour commander l’impression.`
  );
}
