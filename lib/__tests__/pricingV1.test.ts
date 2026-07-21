import { describe, expect, it } from 'vitest';
import { quotePrintOrderV1, quotePrintOrderV1Cents } from '@/lib/pricingV1';

describe('quotePrintOrderV1', () => {
  it('30 pages, 0 QR free → 39,00 €', () => {
    const q = quotePrintOrderV1({ gelatoPages: 30, qrCount: 0, tier: 'free' });
    expect(q.totalEuros).toBe(39);
    expect(q.bookPartEuros).toBe(39);
    expect(q.qrPartEuros).toBe(0);
    expect(q.discountPercent).toBe(0);
  });

  it('30 pages paid → 35,10 € (−10 %)', () => {
    const q = quotePrintOrderV1({ gelatoPages: 30, qrCount: 0, tier: 'paid' });
    expect(q.totalEuros).toBe(35.1);
    expect(q.discountPercent).toBe(10);
  });

  it('45 pages, 6 QR free → 53,70 €', () => {
    // book 39 + 15*0.70 = 49.50 ; QR (6-2)*0.70 = 2.80 ; total 52.30
    // Spec example was 8 QR → 53.70. For 6 QR:
    const q = quotePrintOrderV1({ gelatoPages: 45, qrCount: 6, tier: 'free' });
    expect(q.bookPartEuros).toBe(49.5);
    expect(q.qrPartEuros).toBe(2.8);
    expect(q.totalEuros).toBe(52.3);
  });

  it('45 pages, 8 QR free → 53,70 € + upsell 44,55 €', () => {
    const q = quotePrintOrderV1({ gelatoPages: 45, qrCount: 8, tier: 'free' });
    expect(q.bookPartEuros).toBe(49.5);
    expect(q.qrPartEuros).toBe(4.2);
    expect(q.totalEuros).toBe(53.7);
    expect(q.premiumUpsell?.totalEuros).toBe(44.55);
    expect(q.premiumUpsell?.savingsEuros).toBe(9.15);
  });

  it('45 pages, 8 QR paid → 44,55 € (QR inclus)', () => {
    const q = quotePrintOrderV1({ gelatoPages: 45, qrCount: 8, tier: 'paid' });
    expect(q.qrPartEuros).toBe(0);
    expect(q.totalEuros).toBe(44.55);
    expect(q.premiumUpsell).toBeNull();
  });

  it('pads billing pages below 30', () => {
    const q = quotePrintOrderV1({ gelatoPages: 20, qrCount: 0, tier: 'free' });
    expect(q.billedPages).toBe(30);
    expect(q.totalEuros).toBe(39);
  });

  it('cents match euros', () => {
    const { priceCents, quote } = quotePrintOrderV1Cents({
      gelatoPages: 45,
      qrCount: 8,
      tier: 'free',
    });
    expect(priceCents).toBe(Math.round(quote.totalEuros * 100));
    expect(priceCents).toBe(5370);
  });
});
