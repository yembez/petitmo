/**
 * Spec livre imprimé V1 — aligné `lib/pricingV1.ts` / Edge `calculateBookPrice.ts`.
 */

export const PRINT_V1_BASE_EUR = 39;
export const PRINT_V1_BASE_PAGES = 30;
export const PRINT_V1_EXTRA_PAGE_EUR = 0.7;
export const PRINT_V1_INCLUDED_QR = 2;
export const PRINT_V1_EXTRA_QR_EUR = 0.7;
export const PRINT_V1_PAID_DISCOUNT_PERCENT = 10 as const;

export type DiscountPercent = 0 | typeof PRINT_V1_PAID_DISCOUNT_PERCENT;

export type PrintedBookQuote = {
  gelatoPages: number;
  billedPages: number;
  qrCount: number;
  totalEuros: number;
};

function round2(euros: number): number {
  return Math.round(euros * 100) / 100;
}

export function calculateBookPriceEuros(
  gelatoPages: number,
  qrCount: number,
  discountPercent: DiscountPercent,
): number {
  const pages = Math.max(PRINT_V1_BASE_PAGES, Math.max(0, Math.floor(gelatoPages)));
  const qr = Math.max(0, Math.floor(qrCount));
  const extraPages = Math.max(0, pages - PRINT_V1_BASE_PAGES);
  let bookPart = round2(PRINT_V1_BASE_EUR + extraPages * PRINT_V1_EXTRA_PAGE_EUR);

  const paid = discountPercent === PRINT_V1_PAID_DISCOUNT_PERCENT;
  const extraQr = paid ? 0 : Math.max(0, qr - PRINT_V1_INCLUDED_QR);
  const qrPart = round2(extraQr * PRINT_V1_EXTRA_QR_EUR);

  if (paid) {
    bookPart = round2(bookPart * (1 - PRINT_V1_PAID_DISCOUNT_PERCENT / 100));
  }

  return round2(bookPart + qrPart);
}

export function quotePrintedBook(
  gelatoPages: number,
  qrCount: number,
  tier: 'free' | 'premium' | 'paid',
): PrintedBookQuote {
  const p = Math.max(0, Math.floor(gelatoPages));
  const q = Math.max(0, Math.floor(qrCount));
  const disc: DiscountPercent =
    tier === 'premium' || tier === 'paid' ? PRINT_V1_PAID_DISCOUNT_PERCENT : 0;
  const totalEuros = calculateBookPriceEuros(p, q, disc);
  return {
    gelatoPages: p,
    billedPages: Math.max(PRINT_V1_BASE_PAGES, p),
    qrCount: q,
    totalEuros,
  };
}
