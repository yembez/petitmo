import { useEffect, useState } from 'react';
import * as ImageManipulator from 'expo-image-manipulator';
import { luminanceFromHex, resolveUriForPalette } from '@/hooks/dominantImagePalette';
import { ensureLocalImageForPalette } from '@/hooks/ensureLocalImageForPalette';
import {
  fetchImageColorsResult,
  isImageColorsRuntimeAvailable,
  pickBrightnessSampleHex,
  resolvePaletteDownloadHeaders,
} from '@/hooks/imageColorsFetch';
import { getImagePixelSize } from '@/hooks/useImagePixelSize';
import { isLikelyVideoFileUri } from '@/utils/videoMediaUri';

/** Part du haut de la photo où sont posées les pillules prénom / âge. */
const HERO_PILLS_ZONE_HEIGHT_RATIO = 0.2;

export type CaptureHeroPillBackdropMode = 'light' | 'dark';

/** Luminance perçue au-dessus de laquelle on assombrit les pillules verre. */
export const HERO_PILLS_LIGHT_ZONE_LUMINANCE = 0.62;

/**
 * Échantillon couleur dans la bande haute de la photo hero (zone pillules).
 * Recadre ~20 % du haut puis extrait une couleur type background/average.
 */
export async function fetchHeroPillsZoneSampleHex(
  imageSource: string,
): Promise<string | null> {
  const originalUri = resolveUriForPalette(imageSource);
  if (!originalUri) return null;
  if (isLikelyVideoFileUri(originalUri)) return null;
  if (!isImageColorsRuntimeAvailable()) return null;

  try {
    const downloadHeaders = await resolvePaletteDownloadHeaders(originalUri);
    const localUri = await ensureLocalImageForPalette(originalUri, downloadHeaders);
    const size = await getImagePixelSize(localUri);

    let sampleUri = localUri;
    if (size && size.w > 0 && size.h > 0) {
      const cropH = Math.max(1, Math.round(size.h * HERO_PILLS_ZONE_HEIGHT_RATIO));
      try {
        const cropped = await ImageManipulator.manipulateAsync(
          localUri,
          [
            { crop: { originX: 0, originY: 0, width: size.w, height: cropH } },
            { resize: { width: Math.min(128, size.w) } },
          ],
          { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
        );
        if (cropped.uri) sampleUri = cropped.uri;
      } catch (e) {
        console.warn('[fetchHeroPillsZoneSampleHex] crop impossible', e);
      }
    }

    const result = await fetchImageColorsResult(sampleUri);
    if (!result) return null;
    return pickBrightnessSampleHex(result);
  } catch (e) {
    console.warn('[fetchHeroPillsZoneSampleHex] échoué', e);
    return null;
  }
}

export function resolveCaptureHeroPillBackdropMode(
  sampleHex: string | null | undefined,
): CaptureHeroPillBackdropMode {
  if (!sampleHex) return 'light';
  return luminanceFromHex(sampleHex) >= HERO_PILLS_LIGHT_ZONE_LUMINANCE ? 'dark' : 'light';
}

/**
 * Adapte le verre des pillules hero Capturer : fond plus sombre si la zone photo est claire.
 * Local-first : défaut « light » puis bascule silencieuse après analyse en fond.
 */
export function useCaptureHeroPillBackdrop(
  photoUri: string | null | undefined,
): CaptureHeroPillBackdropMode {
  const [mode, setMode] = useState<CaptureHeroPillBackdropMode>('light');

  useEffect(() => {
    const uri = photoUri?.trim() ?? '';
    if (!uri) {
      setMode('light');
      return;
    }

    let cancelled = false;
    const run = async () => {
      const sample = await fetchHeroPillsZoneSampleHex(uri);
      if (cancelled) return;
      setMode(resolveCaptureHeroPillBackdropMode(sample));
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [photoUri]);

  return mode;
}
