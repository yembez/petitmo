/**
 * Spec livre imprimé — tarif incrémental (aligné avec Edge `calculateBookPrice.ts`).
 */

export type DiscountPercent = 0 | 20;

export type PrintedBookQuote = {
  memoryPageCount: number;
  billedPages: number;
  totalEuros: number;
};

function roundCents(euros: number): number {
  return Math.round(euros * 100) / 100;
}

export function calculateBookPriceEuros(billablePages: number, discountPercent: DiscountPercent): number {
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
  return roundCents(euros);
}

/** @deprecated Utiliser `calculateBookPriceEuros` ; conservé pour appels existants. */
export function quotePrintedBook(memoryPageCount: number, tier: 'free' | 'premium'): PrintedBookQuote {
  const p = Math.max(0, Math.floor(memoryPageCount));
  const disc: DiscountPercent = tier === 'premium' ? 20 : 0;
  const totalEuros = calculateBookPriceEuros(p, disc);
  const billedPages = Math.max(20, p);
  return { memoryPageCount: p, billedPages, totalEuros };
}
