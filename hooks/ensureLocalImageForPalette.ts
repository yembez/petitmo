import { Platform } from 'react-native';
import { cacheDirectory, downloadAsync, getInfoAsync } from 'expo-file-system/legacy';

/** Hash court stable pour nom de fichier cache */
function hashUri(uri: string): string {
  let h = 5381;
  for (let i = 0; i < uri.length; i++) {
    h = (h << 5) + h + uri.charCodeAt(i);
    h |= 0;
  }
  return (h >>> 0).toString(16);
}

/** Même fichier sous-jacent malgré un nouveau jeton d’URL signée (évite re-téléchargement à chaque focus). */
function uriKeyForPaletteCache(uri: string): string {
  try {
    const u = new URL(uri);
    if (u.hostname.includes('supabase')) {
      u.search = '';
      return u.toString();
    }
  } catch {
    /* ignore */
  }
  return uri;
}

/**
 * `react-native-image-colors` est souvent en échec sur les URLs HTTPS (Supabase, etc.).
 * On télécharge d’abord en fichier local (cache), comme pour l’édition photo.
 *
 * @param headers optionnel — ex. `Authorization: Bearer …` pour un bucket privé Supabase
 */
export async function ensureLocalImageForPalette(
  uri: string,
  headers?: Record<string, string>
): Promise<string> {
  if (Platform.OS === 'web') return uri;
  if (!/^https?:\/\//i.test(uri)) return uri;

  const base = cacheDirectory;
  if (!base) return uri;

  const cacheKey = uriKeyForPaletteCache(uri);
  const path = `${base}petitmo-palette-${hashUri(cacheKey)}.jpg`;

  try {
    const info = await getInfoAsync(path);
    if (info.exists) {
      return path;
    }
    const res = await downloadAsync(uri, path, headers && Object.keys(headers).length ? { headers } : undefined);
    if (res.status === 200) {
      return res.uri;
    }
  } catch (e) {
    console.warn('[ensureLocalImageForPalette] échec, tentative URL directe', e);
  }

  return uri;
}
