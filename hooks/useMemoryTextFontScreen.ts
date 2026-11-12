import { useFonts } from 'expo-font';
import * as Font from 'expo-font';
import {
  MEMORY_MANROPE_BOLD_FAMILY,
  MEMORY_MANROPE_REGULAR_FAMILY,
  MEMORY_TEXT_FONT_FALLBACK,
  MEMORY_TEXT_FONT_FAMILY,
  MEMORY_TEXT_FONT_SOURCES,
  MEMORY_TEXT_FONT_TRIAL,
  USE_SYSTEM_MEMORY_TEXT_FONTS,
} from '@/constants/memoryTextFont';

/** Écrans hors onglets (viewer, modale…) : face selon `MEMORY_TEXT_FONT_TRIAL`. */
export function useMemoryTextFontScreen(): string {
  const [loaded] = useFonts(
    USE_SYSTEM_MEMORY_TEXT_FONTS ? {} : MEMORY_TEXT_FONT_SOURCES,
  );
  if (USE_SYSTEM_MEMORY_TEXT_FONTS) return MEMORY_TEXT_FONT_FAMILY;
  if (MEMORY_TEXT_FONT_TRIAL === 'manrope') {
    const ready =
      loaded ||
      (Font.isLoaded(MEMORY_MANROPE_REGULAR_FAMILY) &&
        Font.isLoaded(MEMORY_MANROPE_BOLD_FAMILY));
    return ready ? MEMORY_TEXT_FONT_FAMILY : MEMORY_TEXT_FONT_FALLBACK;
  }
  const ready =
    loaded ||
    (Font.isLoaded('DMSans_400Regular') && Font.isLoaded('DMSans_600SemiBold'));
  return ready ? MEMORY_TEXT_FONT_FAMILY : MEMORY_TEXT_FONT_FALLBACK;
}
