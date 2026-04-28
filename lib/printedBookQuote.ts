/**
 * Tarif livre imprimé incrémental (aligné avec `supabase/functions/init-export/calculateBookPrice.ts`
 * et `server/src/pricing/printedBookQuote.ts`).
 */

export type DiscountPercent = 0 | 20;

/** Montant TTC en centimes (entier). */
export function calculateBookPriceCents(billablePages: number, discountPercent: DiscountPercent): number {
  const raw = Math.max(0, Math.floor(billablePages));
  const p = Math.max(20, raw);
  let euros = 32;
  if (p <= 20) {
    // forfait 20 pages
  } else if (p <= 40) {
    euros += (p - 20) * 1.2;
  } else {
    euros += 20 * 1.2 + (p - 40) * 1.0;
  }
  if (discountPercent === 20) {
    euros *= 0.8;
  }
  return Math.round(euros * 100);
}

export function calculateBookPriceEuros(billablePages: number, discountPercent: DiscountPercent): number {
  return calculateBookPriceCents(billablePages, discountPercent) / 100;
}
