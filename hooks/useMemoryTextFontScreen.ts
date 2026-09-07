import { useFonts } from 'expo-font';
import * as Font from 'expo-font';
import {
  MEMORY_TEXT_FONT_FALLBACK,
  MEMORY_TEXT_FONT_FAMILY,
  MEMORY_TEXT_FONT_SOURCES,
} from '@/constants/memoryTextFont';

/** Écrans hors onglets (viewer, modale…) : DM Sans (souvent déjà au boot). */
export function useMemoryTextFontScreen(): string {
  const [loaded] = useFonts(MEMORY_TEXT_FONT_SOURCES);
  const ready =
    loaded ||
    (Font.isLoaded('DMSans_400Regular') && Font.isLoaded('DMSans_600SemiBold'));
  return ready ? MEMORY_TEXT_FONT_FAMILY : MEMORY_TEXT_FONT_FALLBACK;
}
