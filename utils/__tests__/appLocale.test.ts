import { describe, expect, it } from 'vitest';

import { formatAppCountryName, formatAppCurrency, formatAppDate } from '@/utils/appLocale';

describe('appLocale', () => {
  it('formatAppCurrency fr-FR', () => {
    const s = formatAppCurrency(39, 'fr');
    expect(s).toMatch(/39/);
    expect(s).toMatch(/€/);
  });

  it('formatAppCurrency en-GB', () => {
    const s = formatAppCurrency(39, 'en');
    expect(s).toMatch(/39/);
  });

  it('formatAppDate respects language', () => {
    const d = new Date('2026-03-15T12:00:00Z');
    const fr = formatAppDate(d, { month: 'long' }, 'fr');
    const en = formatAppDate(d, { month: 'long' }, 'en');
    expect(fr.toLowerCase()).toContain('mars');
    expect(en.toLowerCase()).toMatch(/march/);
  });

  it('formatAppCountryName', () => {
    expect(formatAppCountryName('FR', 'fr')).toBe('France');
    expect(formatAppCountryName('FR', 'en')).toBe('France');
    expect(formatAppCountryName('BE', 'fr')).toMatch(/Belgique|Belgi/i);
  });
});
