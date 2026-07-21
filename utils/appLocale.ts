import { DEFAULT_APP_LANGUAGE, type AppLanguage } from '@/lib/i18nTypes';

/** Tag BCP 47 pour `Intl` / `toLocaleDateString` (dates, montants). */
export type AppLocaleTag = 'fr-FR' | 'en-GB';

const LOCALE_BY_LANG: Record<AppLanguage, AppLocaleTag> = {
  fr: 'fr-FR',
  en: 'en-GB',
};

export function appLocaleTag(lang: AppLanguage = DEFAULT_APP_LANGUAGE): AppLocaleTag {
  return LOCALE_BY_LANG[lang];
}

export function formatAppDate(
  date: Date,
  options: Intl.DateTimeFormatOptions,
  lang: AppLanguage = DEFAULT_APP_LANGUAGE,
): string {
  return date.toLocaleDateString(appLocaleTag(lang), options);
}

/** Tarifs Petitmo V1 en EUR ; format selon la locale active. */
export function formatAppCurrency(amountEur: number, lang: AppLanguage = DEFAULT_APP_LANGUAGE): string {
  return new Intl.NumberFormat(appLocaleTag(lang), {
    style: 'currency',
    currency: 'EUR',
  }).format(amountEur);
}

/** Affichage nom de pays (ISO 3166-1 alpha-2) — pas de liste traduite à la main. */
export function formatAppCountryName(iso2: string, lang: AppLanguage = DEFAULT_APP_LANGUAGE): string {
  const code = iso2.trim().toUpperCase();
  if (code.length !== 2) return iso2;
  try {
    const display = new Intl.DisplayNames([appLocaleTag(lang)], { type: 'region' });
    return display.of(code) ?? code;
  } catch {
    return code;
  }
}
