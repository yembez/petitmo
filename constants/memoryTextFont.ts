import { Platform, type TextStyle } from 'react-native';
import {
  DMSans_400Regular,
  DMSans_400Regular_Italic,
  DMSans_600SemiBold,
} from '@expo-google-fonts/dm-sans';

/**
 * Essai A/B fil — typo système (SF Pro / Roboto) pour textes + annotations.
 * `false` → restaurer DM Sans (backup ci-dessous).
 */
export const USE_SYSTEM_MEMORY_TEXT_FONTS = true;

/**
 * Backup charte — DM Sans (état avant essai système).
 * Ne pas supprimer : bascule via `USE_SYSTEM_MEMORY_TEXT_FONTS`.
 */
export const MEMORY_TEXT_FONT_FAMILY_BACKUP = 'DMSans_400Regular';
export const MEMORY_EDITORIAL_FONT_FAMILY_BACKUP = 'DMSans_400Regular';
export const MEMORY_EDITORIAL_FONT_BOLD_FAMILY_BACKUP = 'DMSans_600SemiBold';
export const MEMORY_TEXT_FONT_ITALIC_FAMILY_BACKUP = 'DMSans_400Regular_Italic';

/**
 * Typo de **tous les textes de souvenirs** (corps texte, annotations photo/vidéo/vocal)
 * — fil, viewer immersif, favoris, livre.
 */
export const MEMORY_TEXT_FONT_FAMILY = USE_SYSTEM_MEMORY_TEXT_FONTS
  ? Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' })!
  : MEMORY_TEXT_FONT_FAMILY_BACKUP;

/**
 * Typo des souvenirs texte (titre + corps) + légendes.
 */
export const MEMORY_EDITORIAL_FONT_FAMILY = USE_SYSTEM_MEMORY_TEXT_FONTS
  ? MEMORY_TEXT_FONT_FAMILY
  : MEMORY_EDITORIAL_FONT_FAMILY_BACKUP;

/** Variante semi-bold (titre des souvenirs texte). */
export const MEMORY_EDITORIAL_FONT_BOLD_FAMILY = USE_SYSTEM_MEMORY_TEXT_FONTS
  ? MEMORY_TEXT_FONT_FAMILY
  : MEMORY_EDITORIAL_FONT_BOLD_FAMILY_BACKUP;

/** Italique optionnelle (citations / accents livre). */
export const MEMORY_TEXT_FONT_ITALIC_FAMILY = USE_SYSTEM_MEMORY_TEXT_FONTS
  ? MEMORY_TEXT_FONT_FAMILY
  : MEMORY_TEXT_FONT_ITALIC_FAMILY_BACKUP;

export const MEMORY_TEXT_FONT_SOURCES = {
  DMSans_400Regular,
  DMSans_400Regular_Italic,
  DMSans_600SemiBold,
} as const;

/** Fallback sans-serif tant que expo-font n’a pas fini de charger. */
export const MEMORY_TEXT_FONT_FALLBACK = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
}) as string;

export const MEMORY_EDITORIAL_FONT_FALLBACK = MEMORY_TEXT_FONT_FALLBACK;

/** Famille CSS pour le serveur PDF (`htmlBook.ts`) — alignée sur le fil (hors essai système). */
export const MEMORY_TEXT_FONT_PDF_FAMILY = "'DM Sans', sans-serif";

/**
 * Style prêt à l’emploi pour corps / titre éditorial mémoire.
 * Système : poids natif (pas de face DM Sans). Backup : face chargée + weight normalisé.
 */
export function memoryEditorialTextStyle(kind: 'regular' | 'bold' = 'regular'): TextStyle {
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