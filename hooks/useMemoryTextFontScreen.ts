import { useFonts } from 'expo-font';
import * as Font from 'expo-font';
import {
  MEMORY_TEXT_FONT_FALLBACK,
  MEMORY_TEXT_FONT_FAMILY,
  MEMORY_TEXT_FONT_SOURCES,
  USE_SYSTEM_MEMORY_TEXT_FONTS,
} from '@/constants/memoryTextFont';

/** Écrans hors onglets (viewer, modale…) : DM Sans ou typo système (flag). */
export function useMemoryTextFontScreen(): string {
  const [loaded] = useFonts(
    USE_SYSTEM_MEMORY_TEXT_FONTS ? {} : MEMORY_TEXT_FONT_SOURCES,
  );
  if (USE_SYSTEM_MEMORY_TEXT_FONTS) return MEMORY_TEXT_FONT_FAMILY;
  const ready =
    loaded ||
    (Font.isLoaded('DMSans_400Regular') && Font.isLoaded('DMSans_600SemiBold'));
  return ready ? MEMORY_TEXT_FONT_FAMILY : MEMORY_TEXT_FONT_FALLBACK;
}
