/**
 * Tarif livre imprimé V1 (init-export print_order).
 * Aligné `lib/pricingV1.ts` / `server/src/pricing/printedBookQuote.ts`.
 * Spec : docs/specs/pricing-v1-migration.md
 *
 * 39 € / 30 pages Gelato + 0,70 €/page au-delà ;
 * 2 QR A/V inclus (gratuit) puis 0,70 €/QR ;
 * −10 % sur la partie livre si discount_percent = 10 (Petitmo+).
 */

export const PRINT_V1_BASE_EUR = 39;
export const PRINT_V1_BASE_PAGES = 30;
export const PRINT_V1_EXTRA_PAGE_EUR = 0.7;
export const PRINT_V1_INCLUDED_QR = 2;
export const PRINT_V1_EXTRA_QR_EUR = 0.7;
export const PRINT_V1_PAID_DISCOUNT_PERCENT = 10 as const;

export type DiscountPercent = 0 | typeof PRINT_V1_PAID_DISCOUNT_PERCENT;

function round2(euros: number): number {
  return Math.round(euros * 100) / 100;
}

/** Montant TTC en centimes (entier). */
export function calculateBookPriceCents(
  gelatoPages: number,
  qrCount: number,
  discountPercent: DiscountPercent,
): number {
  const pages = Math.max(PRINT_V1_BASE_PAGES, Math.max(0, Math.floor(gelatoPages)));
  const qr = Math.max(0, Math.floor(qrCount));
  const extraPages = Math.max(0, pages - PRINT_V1_BASE_PAGES);
  let bookPart = PRINT_V1_BASE_EUR + extraPages * PRINT_V1_EXTRA_PAGE_EUR;
  bookPart = round2(bookPart);

  const paid = discountPercent === PRINT_V1_PAID_DISCOUNT_PERCENT;
  const extraQr = paid ? 0 : Math.max(0, qr - PRINT_V1_INCLUDED_QR);
  const qrPart = round2(extraQr * PRINT_V1_EXTRA_QR_EUR);

  if (paid) {
    bookPart = round2(bookPart * (1 - PRINT_V1_PAID_DISCOUNT_PERCENT / 100));
  }

  return Math.round((bookPart + qrPart) * 100);
}
