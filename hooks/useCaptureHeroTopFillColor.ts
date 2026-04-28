import { useEffect, useState } from 'react';
import { darkenHex } from '@/hooks/dominantImagePalette';
import { fetchImageColorsResult, pickBrightnessSampleHex } from '@/hooks/imageColorsFetch';

const FALLBACK = '#111827' as const;

/**
 * Couleur d’appoint pour “tricher” sous la status bar sur Capturer.
 * On prend un échantillon type background/average, puis on assombrit très légèrement
 * pour mieux se fondre sous le scrim noir existant.
 */
export function useCaptureHeroTopFillColor(photoUri: string | null | undefined): string {
  const [color, setColor] = useState<string>(FALLBACK);

  useEffect(() => {
    const uri = photoUri?.trim() ?? '';
    if (!uri) {
      setColor(FALLBACK);
      return;
    }

    let cancelled = false;
    const run = async () => {
      const result = await fetchImageColorsResult(uri);
      if (cancelled) return;
      if (!result) {
        setColor(FALLBACK);
        return;
      }
      const sample = pickBrightnessSampleHex(result);
      setColor(darkenHex(sample, 0.06));
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [photoUri]);

  return color;
}

