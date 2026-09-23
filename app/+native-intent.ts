import { getShareExtensionKey } from 'expo-share-intent';

/**
 * Expo Router strippe les fragments `#…` (OAuth / reset MDP Supabase).
 * Convertir `#` → `?` pour conserver access_token / refresh_token / type / code.
 */
function preserveAuthCallbackParams(path: string): string {
  if (!path.includes('#')) return path;
  const looksAuthCallback =
    path.includes('access_token=') ||
    path.includes('refresh_token=') ||
    path.includes('type=recovery') ||
    path.includes('type=signup') ||
    path.includes('type=magiclink') ||
    path.includes('code=') ||
    path.includes('token_hash=');
  if (!looksAuthCallback) return path;
  // Un seul `#` → query ; si déjà une query, fusionner en `&`.
  const hashIdx = path.indexOf('#');
  const before = path.slice(0, hashIdx);
  const fragment = path.slice(hashIdx + 1);
  if (!fragment) return before;
  const joiner = before.includes('?') ? '&' : '?';
  return `${before}${joiner}${fragment}`;
}

/**
 * Expo Router : redirige le deep link Share Extension vers `/shareintent`
 * avant que le routeur ne tente d’ouvrir un path opaque.
 * Préserve aussi les callbacks Auth Supabase (reset MDP / OAuth).
 */
export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}): string {
  try {
    if (path.includes(`dataUrl=${getShareExtensionKey()}`)) {
      return '/shareintent';
    }
    return preserveAuthCallbackParams(path);
  } catch {
    return '/';
  }
}
