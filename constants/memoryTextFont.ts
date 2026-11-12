import { Platform, type TextStyle } from 'react-native';
import {
  DMSans_400Regular,
  DMSans_400Regular_Italic,
  DMSans_600SemiBold,
} from '@expo-google-fonts/dm-sans';
import {
  Manrope_300Light,
  Manrope_600SemiBold,
} from '@expo-google-fonts/manrope';

/**
 * Essai A/B fil — typo souvenirs texte + annotations photo/A/V.
 * - `manrope` : Manrope 300 (parité livre Petits mots / légendes) — essai en cours
 * - `system` : SF Pro / Roboto
 * - `dm-sans` : backup charte DM Sans
 */
export type MemoryTextFontTrial = 'manrope' | 'system' | 'dm-sans';
export const MEMORY_TEXT_FONT_TRIAL: MemoryTextFontTrial = 'manrope';

export const USE_MANROPE_MEMORY_TEXT_FONTS = MEMORY_TEXT_FONT_TRIAL === 'manrope';
/** @deprecated Préférer `MEMORY_TEXT_FONT_TRIAL === 'system'`. */
export const USE_SYSTEM_MEMORY_TEXT_FONTS = MEMORY_TEXT_FONT_TRIAL === 'system';

/** Face Expo — même que `BOOK_TEXT_MEMORY_FONT_FAMILY` (maquette). */
export const MEMORY_MANROPE_REGULAR_FAMILY = 'Manrope_300Light';
export const MEMORY_MANROPE_BOLD_FAMILY = 'Manrope_600SemiBold';

/**
 * Backup charte — DM Sans (état avant essai système / Manrope).
 * Ne pas supprimer : bascule via `MEMORY_TEXT_FONT_TRIAL`.
 */
export const MEMORY_TEXT_FONT_FAMILY_BACKUP = 'DMSans_400Regular';
export const MEMORY_EDITORIAL_FONT_FAMILY_BACKUP = 'DMSans_400Regular';
export const MEMORY_EDITORIAL_FONT_BOLD_FAMILY_BACKUP = 'DMSans_600SemiBold';
export const MEMORY_TEXT_FONT_ITALIC_FAMILY_BACKUP = 'DMSans_400Regular_Italic';

const SYSTEM_MEMORY_TEXT_FONT = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
})!;

/**
 * Typo de **tous les textes de souvenirs** (corps texte, annotations photo/vidéo/vocal)
 * — fil, viewer immersif, favoris, livre (hors face maquette dédiée).
 */
export const MEMORY_TEXT_FONT_FAMILY = USE_MANROPE_MEMORY_TEXT_FONTS
  ? MEMORY_MANROPE_REGULAR_FAMILY
  : USE_SYSTEM_MEMORY_TEXT_FONTS
    ? SYSTEM_MEMORY_TEXT_FONT
    : MEMORY_TEXT_FONT_FAMILY_BACKUP;

/**
 * Typo des souvenirs texte (titre + corps) + légendes.
 */
export const MEMORY_EDITORIAL_FONT_FAMILY = USE_MANROPE_MEMORY_TEXT_FONTS
  ? MEMORY_MANROPE_REGULAR_FAMILY
  : USE_SYSTEM_MEMORY_TEXT_FONTS
    ? MEMORY_TEXT_FONT_FAMILY
    : MEMORY_EDITORIAL_FONT_FAMILY_BACKUP;

/** Variante semi-bold (titre des souvenirs texte). */
export const MEMORY_EDITORIAL_FONT_BOLD_FAMILY = USE_MANROPE_MEMORY_TEXT_FONTS
  ? MEMORY_MANROPE_BOLD_FAMILY
  : USE_SYSTEM_MEMORY_TEXT_FONTS
    ? MEMORY_TEXT_FONT_FAMILY
    : MEMORY_EDITORIAL_FONT_BOLD_FAMILY_BACKUP;

/** Italique optionnelle (citations / accents livre). */
export const MEMORY_TEXT_FONT_ITALIC_FAMILY = USE_MANROPE_MEMORY_TEXT_FONTS
  ? MEMORY_MANROPE_REGULAR_FAMILY
  : USE_SYSTEM_MEMORY_TEXT_FONTS
    ? MEMORY_TEXT_FONT_FAMILY
    : MEMORY_TEXT_FONT_ITALIC_FAMILY_BACKUP;

/** Sources expo-font à charger (skip si essai système pur). */
export const MEMORY_TEXT_FONT_SOURCES = USE_MANROPE_MEMORY_TEXT_FONTS
  ? {
      Manrope_300Light,
      Manrope_600SemiBold,
    }
  : USE_SYSTEM_MEMORY_TEXT_FONTS
    ? {}
    : {
        DMSans_400Regular,
        DMSans_400Regular_Italic,
        DMSans_600SemiBold,
      };

/** Fallback sans-serif tant que expo-font n’a pas fini de charger. */
export const MEMORY_TEXT_FONT_FALLBACK = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
}) as string;

export const MEMORY_EDITORIAL_FONT_FALLBACK = MEMORY_TEXT_FONT_FALLBACK;

/** Famille CSS pour le serveur PDF (`htmlBook.ts`) — alignée sur le fil (hors essai système). */
export const MEMORY_TEXT_FONT_PDF_FAMILY = USE_MANROPE_MEMORY_TEXT_FONTS
  ? "'Manrope', sans-serif"
  : "'DM Sans', sans-serif";

/**
 * Style prêt à l’emploi pour corps / titre éditorial mémoire.
 * Face déjà weightée (Manrope / DM Sans) → `fontWeight: 'normal'` (évite double graisse iOS).
 */
export function memoryEditorialTextStyle(kind: 'regular' | 'bold' = 'regular'): TextStyle {
  if (USE_MANROPE_MEMORY_TEXT_FONTS) {
    return {
      fontFamily:
        kind === 'bold' ? MEMORY_MANROPE_BOLD_FAMILY : MEMORY_MANROPE_REGULAR_FAMILY,
      fontWeight: 'normal',
      fontStyle: 'normal',
    };
  }
  if (USE_SYSTEM_MEMORY_TEXT_FONTS) {
    return kind === 'bold'
      ? { fontFamily: MEMORY_TEXT_FONT_FAMILY, fontWeight: '600' }
      : { fontFamily: MEMORY_TEXT_FONT_FAMILY, fontWeight: '400' };
  }
  const family =
    kind === 'bold'
      ? MEMORY_EDITORIAL_FONT_BOLD_FAMILY_BACKUP
      : MEMORY_EDITORIAL_FONT_FAMILY_BACKUP;
  return {
    fontFamily: family,
    fontWeight: 'normal',
    fontStyle: 'normal',
  };
}
