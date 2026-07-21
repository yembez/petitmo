export const APP_LANGUAGES = ['fr', 'en'] as const;
export type AppLanguage = (typeof APP_LANGUAGES)[number];

export const DEFAULT_APP_LANGUAGE: AppLanguage = 'fr';

export function parseAppLanguage(code: string | null | undefined): AppLanguage {
  if (!code) return DEFAULT_APP_LANGUAGE;
  const base = code.split('-')[0]?.toLowerCase();
  if (base === 'en') return 'en';
  if (base === 'fr') return 'fr';
  return DEFAULT_APP_LANGUAGE;
}
