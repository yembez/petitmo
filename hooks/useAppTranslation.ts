import { useTranslation } from 'react-i18next';

import type { I18nNamespace } from '@/lib/i18n';

/** Hook UI — namespaces : `common`, puis `paywall`, `book`, … au fil de la migration. */
export function useAppTranslation(ns: I18nNamespace = 'common') {
  return useTranslation(ns);
}
