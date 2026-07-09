import {
  MEMORY_TEXT_FONT_FAMILY,
  MEMORY_TEXT_FONT_FALLBACK,
} from '@/constants/memoryTextFont';

/** Typo maquette livre — chargée une fois par `book-preview`, pas par page. */
export type BookMaquetteTypography = {
  dm400?: string;
  dm600?: string;
  dmItalic?: string;
  garamond?: string;
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
    dmItalic: 'DMSans_400Regular_Italic',
    garamond: 'EBGaramond_400Regular',
    garamondIt: 'EBGaramond_400Regular_Italic',
    memoryTextFont: MEMORY_TEXT_FONT_FAMILY,
  };
}
