import Constants from 'expo-constants';
import { LEGAL_PRIVACY_URL } from '@/lib/legalUrls';

/**
 * URL de la politique de confidentialité (RGPD).
 * Override optionnel : `EXPO_PUBLIC_PRIVACY_POLICY_URL` dans `.env` / EAS / `app.config`.
 * Défaut : https://petitcoeur.app/#/privacy
 */
export function getPrivacyPolicyUrl(): string {
  const fromProcess = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim();
  if (fromProcess) {
    try {
      return new URL(fromProcess).href;
    } catch {
      /* fallback */
    }
  }
  const extra = (Constants.expoConfig?.extra ?? Constants.manifest?.extra) as
    | Record<string, unknown>
    | undefined;
  const fromExtra = extra?.EXPO_PUBLIC_PRIVACY_POLICY_URL;
  if (typeof fromExtra === 'string' && fromExtra.trim()) {
    try {
      return new URL(fromExtra.trim()).href;
    } catch {
      /* fallback */
    }
  }
  return LEGAL_PRIVACY_URL;
}
