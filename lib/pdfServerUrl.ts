import Constants from 'expo-constants';

/**
 * URL publique du service PDF / QR (Railway).
 * Présente dans `eas.json` build + EAS Environment (OTA).
 * Repli dur : évite un OTA qui oublierait la variable (comme vu en TF).
 */
const PRODUCTION_PDF_SERVER_FALLBACK = 'https://petitmo-production.up.railway.app';

function readFromExtra(): string {
  const extra = Constants.expoConfig?.extra as
    | { EXPO_PUBLIC_PDF_SERVER_URL?: string }
    | undefined;
  return (extra?.EXPO_PUBLIC_PDF_SERVER_URL ?? '').trim();
}

/** Base du serveur PDF sans slash final, ou null si vraiment introuvable. */
export function resolvePdfServerBaseUrl(): string | null {
  const fromEnv = (process.env.EXPO_PUBLIC_PDF_SERVER_URL ?? '').trim();
  const fromExtra = readFromExtra();
  const raw = fromEnv || fromExtra || PRODUCTION_PDF_SERVER_FALLBACK;
  if (!raw) return null;
  return raw.replace(/\/$/, '');
}

export function isPdfServerUrlFromFallback(): boolean {
  const fromEnv = (process.env.EXPO_PUBLIC_PDF_SERVER_URL ?? '').trim();
  const fromExtra = readFromExtra();
  return !fromEnv && !fromExtra;
}
