import { useFonts } from 'expo-font';
import {
  MEMORY_TEXT_FONT_FALLBACK,
  MEMORY_TEXT_FONT_FAMILY,
  MEMORY_TEXT_FONT_SOURCES,
} from '@/constants/memoryTextFont';

/** Écrans hors onglets (viewer, modale…) : charge Roboto localement. */
export function useMemoryTextFontScreen(): string {
  const [loaded] = useFonts(MEMORY_TEXT_FONT_SOURCES);
  return loaded ? MEMORY_TEXT_FONT_FAMILY : MEMORY_TEXT_FONT_FALLBACK;
}
