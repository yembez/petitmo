import { useTranslation } from 'react-i18next';

import { parseAppLanguage, type AppLanguage } from '@/lib/i18nTypes';

/** Langue i18n active (FR / EN) — à passer à `formatAppDate` / `formatAppCurrency`. */
export function useAppLanguage(): AppLanguage {
  const { i18n } = useTranslation();
  return parseAppLanguage(i18n.language);
}
