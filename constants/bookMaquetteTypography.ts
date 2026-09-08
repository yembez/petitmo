import {
  MEMORY_TEXT_FONT_FAMILY,
  MEMORY_TEXT_FONT_FALLBACK,
  MEMORY_TEXT_FONT_ITALIC_FAMILY,
} from '@/constants/memoryTextFont';
import {
  BOOK_SERIF_FONT_FAMILY,
  BOOK_SERIF_ITALIC_FONT_FAMILY,
} from '@/constants/bookSerifFont';

/** Typo maquette livre — chargée une fois par `book-preview`, pas par page. */
export type BookMaquetteTypography = {
  dm400?: string;
  dm600?: string;
  dmItalic?: string;
  /** @deprecated historiquement EB Garamond — désormais DM Sans (contenu). */
  garamond?: string;
  /** @deprecated historiquement EB Garamond Italic — désormais DM Sans Italic. */
  garamondIt?: string;
  /** Serif des titres du livre (couverture, ouverture, dos) — pas le contenu. */
  serif?: string;
  serifItalic?: string;
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
    serif: BOOK_SERIF_FONT_FAMILY,
    serifItalic: BOOK_SERIF_ITALIC_FONT_FAMILY,
    memoryTextFont: MEMORY_TEXT_FONT_FAMILY,
  };
}
