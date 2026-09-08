import {
  EBGaramond_400Regular,
  EBGaramond_400Regular_Italic,
} from '@expo-google-fonts/eb-garamond';

/**
 * Serif éditoriale du livre — **uniquement** les zones de titre :
 * titre + période de couverture, page d’ouverture « Notre histoire », dos.
 *
 * Les textes de souvenirs et les annotations restent en DM Sans
 * (`@/constants/memoryTextFont`), alignés sur le fil.
 */
export const BOOK_SERIF_FONT_FAMILY = 'EBGaramond_400Regular';
export const BOOK_SERIF_ITALIC_FONT_FAMILY = 'EBGaramond_400Regular_Italic';

export const BOOK_SERIF_FONT_SOURCES = {
  EBGaramond_400Regular,
  EBGaramond_400Regular_Italic,
} as const;

/** Famille CSS miroir pour le serveur PDF (`server/src/pdf/htmlBook.ts`). */
export const BOOK_SERIF_PDF_FAMILY = "'EB Garamond', serif";
