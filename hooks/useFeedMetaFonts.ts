import {
  useFonts,
  Inter_300Light,
  Inter_500Medium,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';

/** Inter pour date, âges et lieu dans l’en-tête de jour du fil. */
export function useFeedMetaFonts(): {
  feedDateFontFamily: string | undefined;
  feedAgeFontFamily: string | undefined;
  feedLocationFilledFontFamily: string | undefined;
  feedLocationPlaceholderFontFamily: string | undefined;
} {
  const [loaded] = useFonts({
    Inter_300Light,
    Inter_500Medium,
    Inter_800ExtraBold,
  });

  return {
    feedDateFontFamily: loaded ? 'Inter_800ExtraBold' : undefined,
    feedAgeFontFamily: loaded ? 'Inter_300Light' : undefined,
    feedLocationFilledFontFamily: loaded ? 'Inter_500Medium' : undefined,
    feedLocationPlaceholderFontFamily: loaded ? 'Inter_300Light' : undefined,
  };
}
