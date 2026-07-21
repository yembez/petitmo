/**
 * Tarif livre imprimé V1 — façade client.
 * Canon : `lib/pricingV1.ts` · Edge / server miroirs.
 */

import {
  quotePrintOrderV1,
  quotePrintOrderV1Cents,
  PRINT_V1_PAID_DISCOUNT_PERCENT,
  type PrintDiscountPercent,
  type PrintTier,
} from '@/lib/pricingV1';

export type DiscountPercent = PrintDiscountPercent;
export { PRINT_V1_PAID_DISCOUNT_PERCENT };

export type PrintedBookQuoteInput = {
  gelatoPages: number;
  qrCount: number;
  tier: PrintTier;
};

/** Montant TTC en centimes (entier). */
export function calculateBookPriceCents(
  gelatoPages: number,
  qrCount: number,
  discountPercent: DiscountPercent,
): number {
  const tier: PrintTier = discountPercent === PRINT_V1_PAID_DISCOUNT_PERCENT ? 'paid' : 'free';
  return quotePrintOrderV1Cents({ gelatoPages, qrCount, tier }).priceCents;
}

export function calculateBookPriceEuros(
  gelatoPages: number,
  qrCount: number,
  discountPercent: DiscountPercent,
): number {
  return calculateBookPriceCents(gelatoPages, qrCount, discountPercent) / 100;
}

export function quotePrintedBookV1(input: PrintedBookQuoteInput) {
  return quotePrintOrderV1(input);
}
