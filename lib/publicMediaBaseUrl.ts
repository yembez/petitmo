import Constants from 'expo-constants';
import { resolvePdfServerBaseUrl } from '@/lib/pdfServerUrl';

/** Base publique des QR livre (`/m/{token}`), sans slash final. */
export function publicMediaBaseUrl(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL ?? '').trim();
  const fromExtra = (
    (Constants.expoConfig?.extra as { EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL?: string } | undefined)
      ?.EXPO_PUBLIC_PUBLIC_MEDIA_BASE_URL ?? ''
  ).trim();
  const raw = fromEnv || fromExtra;
  if (raw) return raw.replace(/\/$/, '');
  const pdf = resolvePdfServerBaseUrl();
  if (pdf) return `${pdf}/m`;
  return 'https://petitcoeur.app/m';
}

export function bookQrUrlForToken(token: string): string {
  const t = token.trim();
  if (!t) return '';
  return `${publicMediaBaseUrl()}/${t}`;
}
