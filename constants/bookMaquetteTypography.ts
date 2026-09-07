import {
  MEMORY_TEXT_FONT_FAMILY,
  MEMORY_TEXT_FONT_FALLBACK,
  MEMORY_TEXT_FONT_ITALIC_FAMILY,
} from '@/constants/memoryTextFont';

/** Typo maquette livre — chargée une fois par `book-preview`, pas par page. */
export type BookMaquetteTypography = {
  dm400?: string;
  dm600?: string;
  dmItalic?: string;
  /** @deprecated historiquement EB Garamond — désormais DM Sans (contenu). */
  garamond?: string;
  /** @deprecated historiquement EB Garamond Italic — désormais DM Sans Italic. */
  garamondIt?: string;
  memoryTextFont: string;
};

export function buildBookMaquetteTypography(fontsLoaded: boolean): BookMaquetteTypography {
  if (!fontsLoaded) {
    return { memoryTextFont: MEMORY_TEXT_FONT_FALLBACK };
  }
  return {
    dm400: 'DMSans_400Regular',
    dm600: 'DMSans_600SemiBold',
    dmItalic: MEMORY_TEXT_FONT_ITALIC_FAMILY,
    garamond: MEMORY_TEXT_FONT_FAMILY,
    garamondIt: MEMORY_TEXT_FONT_ITALIC_FAMILY,
    memoryTextFont: MEMORY_TEXT_FONT_FAMILY,
  };
}
