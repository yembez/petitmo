import Constants from 'expo-constants';

/**
 * URL de la politique de confidentialité (RGPD), optionnelle.
 * Définir `EXPO_PUBLIC_PRIVACY_POLICY_URL` dans `.env` / EAS / `app.config`.
 */
export function getPrivacyPolicyUrl(): string | null {
  const fromProcess = process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL?.trim();
  if (fromProcess) {
    try {
      new URL(fromProcess);
      return fromProcess;
    } catch {
      return null;
    }
  }
  const extra = (Constants.expoConfig?.extra ?? Constants.manifest?.extra) as Record<string, unknown> | undefined;
  const fromExtra = extra?.EXPO_PUBLIC_PRIVACY_POLICY_URL;
  if (typeof fromExtra === 'string' && fromExtra.trim()) {
    try {
      return new URL(fromExtra.trim()).href;
    } catch {
      return null;
    }
  }
  return null;
}
