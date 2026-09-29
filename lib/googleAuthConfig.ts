/**
 * Clients OAuth Google (Sign in natif + idToken Supabase).
 *
 * **Nom affiché dans l’UI Google (« Continuer vers Petitmo »)** :
 * ce n’est **pas** `CFBundleDisplayName` — c’est le **nom de l’application**
 * de l’écran de consentement OAuth dans Google Cloud Console
 * (APIs & Services → OAuth consent screen → App name → « Petit Cœur »).
 * Puis attendre la propagation (parfois quelques minutes à quelques heures).
 */
import Constants from 'expo-constants';

function readPublicEnv(name: string): string | undefined {
  const fromProcess = process.env?.[name];
  if (typeof fromProcess === 'string' && fromProcess.trim().length > 0) {
    return fromProcess.trim();
  }
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const fromExtra = extra[name];
  if (typeof fromExtra === 'string' && fromExtra.trim().length > 0) {
    return fromExtra.trim();
  }
  return undefined;
}

/** Client OAuth Web Google — requis pour l’idToken accepté par Supabase. */
export function getGoogleWebClientId(): string | undefined {
  return readPublicEnv('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID');
}

/** Client OAuth iOS Google — Sign in natif. */
export function getGoogleIosClientId(): string | undefined {
  return readPublicEnv('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
}

/**
 * URL scheme iOS = Client ID iOS inversé.
 * `123-abc.apps.googleusercontent.com` → `com.googleusercontent.apps.123-abc`
 */
export function iosUrlSchemeFromGoogleIosClientId(iosClientId: string): string | undefined {
  const m = iosClientId
    .trim()
    .match(/^([0-9]+-[a-zA-Z0-9]+)\.apps\.googleusercontent\.com$/);
  if (!m) return undefined;
  return `com.googleusercontent.apps.${m[1]}`;
}
