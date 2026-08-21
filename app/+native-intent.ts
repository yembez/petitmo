import { getShareExtensionKey } from 'expo-share-intent';

/**
 * Expo Router : redirige le deep link Share Extension vers `/shareintent`
 * avant que le routeur ne tente d’ouvrir un path opaque.
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
    return path;
  } catch {
    return '/';
  }
}
