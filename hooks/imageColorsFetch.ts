import { Platform } from 'react-native';
import type { ImageSourcePropType } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ImageColorsResult } from 'react-native-image-colors/build/types';
import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { resolveUriForPalette } from './dominantImagePalette';
import { ensureLocalImageForPalette } from './ensureLocalImageForPalette';
import { supabase } from '@/lib/supabase';
import { isLikelyVideoFileUri } from '@/utils/videoMediaUri';

function guessMimeFromUrl(url: string): 'image/jpeg' | 'image/png' | 'image/webp' {
  const u = url.split('?')[0].toLowerCase();
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

async function toDataUriForPalette(localFileUri: string, originalUrlForMime: string): Promise<string> {
  const base64 = await readAsStringAsync(localFileUri, { encoding: EncodingType.Base64 });
  const mime = guessMimeFromUrl(originalUrlForMime);
  return `data:${mime};base64,${base64}`;
}

/**
 * `react-native-image-colors` charge le natif au premier import → crash dans Expo Go.
 * Sur le web, l’implémentation JS (Vibrant) est utilisée.
 */
export function isImageColorsRuntimeAvailable(): boolean {
  if (Platform.OS === 'web') return true;
  return requireOptionalNativeModule('ImageColors') != null;
}

/**
 * Échantillon proche de la luminosité perçue du fond (haut de photo / ciel / murs clairs).
 */
export function pickBrightnessSampleHex(result: ImageColorsResult): string {
  if (result.platform === 'android') {
    return result.average ?? result.dominant ?? '#808080';
  }
  if (result.platform === 'ios') {
    return result.background ?? result.primary ?? '#808080';
  }
  return result.lightMuted ?? result.muted ?? result.dominant ?? '#808080';
}

/**
 * Télécharge si besoin, puis `getColors` (même pipeline que la palette dominante).
 */
export async function fetchImageColorsResult(
  imageSource: string | ImageSourcePropType
): Promise<ImageColorsResult | null> {
  const originalUri = resolveUriForPalette(imageSource);
  if (!originalUri) return null;
  if (isLikelyVideoFileUri(originalUri)) return null;
  if (!isImageColorsRuntimeAvailable()) return null;

  const cacheKey = originalUri.slice(0, 400);

  try {
    const { getColors } = await import('react-native-image-colors');

    let downloadHeaders: Record<string, string> | undefined;
    try {
      const host = new URL(originalUri).hostname;
      if (host.includes('supabase')) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          downloadHeaders = { Authorization: `Bearer ${token}` };
        }
      }
    } catch {
      /* ignore */
    }

    const localUri = await ensureLocalImageForPalette(originalUri, downloadHeaders);

    let sourceForGetColors = localUri;
    if (!/^https?:\/\//i.test(localUri)) {
      try {
        sourceForGetColors = await toDataUriForPalette(localUri, originalUri);
      } catch (e) {
        console.warn('[imageColorsFetch] base64 intermédiaire impossible', e);
      }
    }

    return await getColors(sourceForGetColors, {
      fallback: '#5B8FC7',
      cache: true,
      key: cacheKey,
      quality: 'highest',
    });
  } catch (e) {
    console.warn('[imageColorsFetch] extraction échouée', e);
    return null;
  }
}
