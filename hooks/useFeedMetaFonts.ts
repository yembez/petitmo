import { useFonts } from 'expo-font';
import * as Font from 'expo-font';
import {
  FEED_META_FONT_FAMILY,
  FEED_META_FONT_SOURCES,
} from '@/constants/feedMetaFont';

function feedMetaFontsReady(): boolean {
  return (
    Font.isLoaded(FEED_META_FONT_FAMILY.date) &&
    Font.isLoaded(FEED_META_FONT_FAMILY.age) &&
    Font.isLoaded(FEED_META_FONT_FAMILY.locationFilled)
  );
}

/** Inter pour date, âges et lieu dans le fil et le viewer immersif. */
export function useFeedMetaFonts(): {
  feedDateFontFamily: string | undefined;
  feedAgeFontFamily: string | undefined;
  feedLocationFilledFontFamily: string | undefined;
  feedLocationPlaceholderFontFamily: string | undefined;
} {
  const [loaded] = useFonts(FEED_META_FONT_SOURCES);
  const ready = loaded && feedMetaFontsReady();

  return {
    feedDateFontFamily: ready ? FEED_META_FONT_FAMILY.date : undefined,
    feedAgeFontFamily: ready ? FEED_META_FONT_FAMILY.age : undefined,
    feedLocationFilledFontFamily: ready ? FEED_META_FONT_FAMILY.locationFilled : undefined,
    feedLocationPlaceholderFontFamily: ready
      ? FEED_META_FONT_FAMILY.locationPlaceholder
      : undefined,
  };
}
