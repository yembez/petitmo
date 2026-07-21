/**
 * i18n in-app (FR + EN). Clés manquantes en EN → repli FR (`fallbackLng`).
 * Init au import — voir `app/_layout.tsx`.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';

import frCommon from '@/locales/fr/common.json';
import enCommon from '@/locales/en/common.json';
import {
  DEFAULT_APP_LANGUAGE,
  parseAppLanguage,
  type AppLanguage,
} from '@/lib/i18nTypes';

export type { AppLanguage } from '@/lib/i18nTypes';
export { APP_LANGUAGES, DEFAULT_APP_LANGUAGE } from '@/lib/i18nTypes';

export const I18N_NAMESPACES = ['common'] as const;
export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

/** Langue initiale : préférences système, sinon FR. */
export function resolveInitialAppLanguage(): AppLanguage {
  for (const locale of getLocales()) {
    const candidates = [locale.languageTag, locale.languageCode].filter(Boolean) as string[];
    for (const c of candidates) {
      const base = c.split('-')[0]?.toLowerCase();
      if (base === 'en') return 'en';
      if (base === 'fr') return 'fr';
    }
  }
  return DEFAULT_APP_LANGUAGE;
}

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      fr: { common: frCommon },
      en: { common: enCommon },
    },
    lng: resolveInitialAppLanguage(),
    fallbackLng: DEFAULT_APP_LANGUAGE,
    defaultNS: 'common',
    ns: [...I18N_NAMESPACES],
    interpolation: { escapeValue: false },
    compatibilityJSON: 'v4',
  });
}

export async function setAppLanguage(lang: AppLanguage): Promise<void> {
  await i18n.changeLanguage(lang);
}

export function getAppLanguage(): AppLanguage {
  return parseAppLanguage(i18n.language);
}

export default i18n;
