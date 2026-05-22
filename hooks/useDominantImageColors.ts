import { useEffect, useState } from 'react';
import { InteractionManager, type ImageSourcePropType } from 'react-native';
import type { ImageColorsResult } from 'react-native-image-colors/build/types';
import type { DominantColors } from './dominantImagePalette';
import {
  DEFAULT_COLORS,
  blendWithWhite,
  getContrastText,
  resolveUriForPalette,
} from './dominantImagePalette';
import { fetchImageColorsResult } from './imageColorsFetch';

/** Fond zone texte : moins de blanc = teinte photo plus visible */
const BG_WHITE_RATIO = 0.38;

function mapAndroid(result: Extract<ImageColorsResult, { platform: 'android' }>): DominantColors {
  const dominant = result.dominant ?? '#6B8E6B';
  const vibrant = result.vibrant ?? result.muted ?? dominant;
  return {
    primary: vibrant,
    secondary: dominant,
    background: blendWithWhite(dominant, BG_WHITE_RATIO),
    text: getContrastText(vibrant),
  };
}

function mapIos(result: Extract<ImageColorsResult, { platform: 'ios' }>): DominantColors {
  const primary = result.primary ?? '#6B8E6B';
  const secondary = result.secondary ?? primary;
  const atmosphere = result.background ?? result.detail ?? primary;
  return {
    primary,
    secondary,
    background: blendWithWhite(atmosphere, BG_WHITE_RATIO),
    text: getContrastText(primary),
  };
}

function mapWeb(result: Extract<ImageColorsResult, { platform: 'web' }>): DominantColors {
  const primary = result.vibrant ?? result.dominant ?? '#6B8E6B';
  const secondary = result.muted ?? result.dominant ?? primary;
  const base = result.muted ?? result.dominant ?? primary;
  return {
    primary,
    secondary,
    background: blendWithWhite(base, BG_WHITE_RATIO),
    text: getContrastText(primary),
  };
}

export function useDominantImageColors(
  imageSource: string | ImageSourcePropType | null
): DominantColors {
  const [colors, setColors] = useState<DominantColors>(DEFAULT_COLORS);

  useEffect(() => {
    if (imageSource == null) {
      setColors(DEFAULT_COLORS);
      return;
    }

    let cancelled = false;

    const extract = async () => {
      const originalUri = resolveUriForPalette(imageSource);
      if (!originalUri) {
        setColors(DEFAULT_COLORS);
        return;
      }

      const result = await fetchImageColorsResult(imageSource);
      if (cancelled) return;

      if (!result) {
        setColors(DEFAULT_COLORS);
        return;
      }

      if (result.platform === 'android') {
        setColors(mapAndroid(result));
      } else if (result.platform === 'ios') {
        setColors(mapIos(result));
      } else {
        setColors(mapWeb(result));
      }
    };

    const task = InteractionManager.runAfterInteractions(() => {
      void extract();
    });
    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [imageSource]);

  return colors;
}
