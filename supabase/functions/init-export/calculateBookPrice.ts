/**
 * Tarif livre imprimé incrémental (init-export print_order).
 * Base 32 € pour 20 pages, +1,20 €/page (21–40), +1,00 €/page (41+), −20 % si discount_percent = 20.
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
