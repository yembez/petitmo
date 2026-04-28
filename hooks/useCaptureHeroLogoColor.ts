import { useEffect, useState } from 'react';
import {
  heroLogoFillFromLuminance,
  luminanceFromHex,
} from '@/hooks/dominantImagePalette';
import {
  fetchImageColorsResult,
  pickBrightnessSampleHex,
} from '@/hooks/imageColorsFetch';

const DEFAULT_FILL = '#FFFFFF' as const;

/**
 * Couleur du logo manuscrit sur l’écran Capturer : blanc sur fond assez foncé,
 * noir (#1C1C1E) si la photo est trop claire (échantillon type moyenne / fond iOS).
 */
export function useCaptureHeroLogoColor(photoUri: string | null | undefined): {
  color: string;
  /** Halo noir uniquement derrière le tracé blanc */
  shadow: boolean;
} {
  const [color, setColor] = useState<string>(DEFAULT_FILL);

  useEffect(() => {
    const uri = photoUri?.trim() ?? '';
    if (!uri) {
      setColor(DEFAULT_FILL);
      return;
    }

    let cancelled = false;

    const run = async () => {
      const result = await fetchImageColorsResult(uri);
      if (cancelled) return;
      if (!result) {
        setColor(DEFAULT_FILL);
        return;
      }
      const sample = pickBrightnessSampleHex(result);
      const L = luminanceFromHex(sample);
      setColor(heroLogoFillFromLuminance(L));
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [photoUri]);

  return {
    color,
    shadow: color === DEFAULT_FILL,
  };
}
