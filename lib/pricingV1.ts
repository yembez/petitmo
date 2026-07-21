/**
 * Tarification V1 — livre imprimé (canon client).
 * Miroirs : `supabase/functions/init-export/calculateBookPrice.ts`,
 * `server/src/pricing/printedBookQuote.ts`.
 * Spec : `docs/specs/pricing-v1-migration.md`.
 */

export const PRINT_V1_BASE_EUR = 39;
export const PRINT_V1_BASE_PAGES = 30;
export const PRINT_V1_EXTRA_PAGE_EUR = 0.7;
export const PRINT_V1_INCLUDED_QR = 2;
export const PRINT_V1_EXTRA_QR_EUR = 0.7;
/** Remise Petitmo+ sur la partie livre (pages), pas sur les QR. */
export const PRINT_V1_PAID_DISCOUNT_PERCENT = 10 as const;

export type PrintDiscountPercent = 0 | typeof PRINT_V1_PAID_DISCOUNT_PERCENT;

export type PrintTier = 'free' | 'paid';

export type PrintOrderQuoteV1 = {
  gelatoPages: number;
  /** Pages facturées pour le forfait (≥ 30). */
  billedPages: number;
  qrCount: number;
  extraPages: number;
  extraQr: number;
  bookPartEuros: number;
  qrPartEuros: number;
  /** Total TTC (après remise abo si paid). */
  totalEuros: number;
  discountPercent: PrintDiscountPercent;
  /** Upsell gratuit → ce que paierait un abonné (livre −10 %, QR inclus). */
  premiumUpsell: {
    bookPartEuros: number;
    totalEuros: number;
    savingsEuros: number;
  } | null;
};

function round2(euros: number): number {
  return Math.round(euros * 100) / 100;
}

function roundCents(euros: number): number {
  return Math.round(euros * 100);
}

/**
 * Quote impression V1.
 * - Pages = compteur catalogue Gelato (plancher tarifaire 30).
 * - QR = pages audio + vidéo ; 2 inclus en gratuit ; 0 € en paid.
 * - Remise 10 % sur `bookPart` uniquement (paid).
 */
export function quotePrintOrderV1(input: {
  gelatoPages: number;
  qrCount: number;
  tier: PrintTier;
}): PrintOrderQuoteV1 {
  const gelatoPages = Math.max(0, Math.floor(input.gelatoPages));
  const qrCount = Math.max(0, Math.floor(input.qrCount));
  const billedPages = Math.max(PRINT_V1_BASE_PAGES, gelatoPages);
  const extraPages = Math.max(0, billedPages - PRINT_V1_BASE_PAGES);
  const bookPartEuros = round2(PRINT_V1_BASE_EUR + extraPages * PRINT_V1_EXTRA_PAGE_EUR);

  const paid = input.tier === 'paid';
  const extraQr = paid ? 0 : Math.max(0, qrCount - PRINT_V1_INCLUDED_QR);
  const qrPartEuros = round2(extraQr * PRINT_V1_EXTRA_QR_EUR);
  const discountPercent: PrintDiscountPercent = paid ? PRINT_V1_PAID_DISCOUNT_PERCENT : 0;

  const bookAfterDiscount = paid
    ? round2(bookPartEuros * (1 - PRINT_V1_PAID_DISCOUNT_PERCENT / 100))
    : bookPartEuros;
  const totalEuros = round2(bookAfterDiscount + qrPartEuros);

  const premiumBook = round2(bookPartEuros * (1 - PRINT_V1_PAID_DISCOUNT_PERCENT / 100));
  const premiumUpsell =
    paid
      ? null
      : {
          bookPartEuros: premiumBook,
          totalEuros: premiumBook,
          savingsEuros: round2(totalEuros - premiumBook),
        };

  return {
    gelatoPages,
    billedPages,
    qrCount,
    extraPages,
    extraQr,
    bookPartEuros,
    qrPartEuros,
    totalEuros,
    discountPercent,
    premiumUpsell,
  };
}

export function quotePrintOrderV1Cents(input: {
  gelatoPages: number;
  qrCount: number;
  tier: PrintTier;
}): { priceCents: number; quote: PrintOrderQuoteV1 } {
  const quote = quotePrintOrderV1(input);
  return { priceCents: roundCents(quote.totalEuros), quote };
}

/** @deprecated Prefer `quotePrintOrderV1` — wrapper pour anciens appels « pages + discount ». */
export function calculateBookPriceCentsFromGelato(
  gelatoPages: number,
  qrCount: number,
  discountPercent: PrintDiscountPercent,
): number {
  const tier: PrintTier = discountPercent === PRINT_V1_PAID_DISCOUNT_PERCENT ? 'paid' : 'free';
  return quotePrintOrderV1Cents({ gelatoPages, qrCount, tier }).priceCents;
}
