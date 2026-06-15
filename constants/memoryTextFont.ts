import { Platform } from 'react-native';
import { RobotoFlex_400Regular } from '@expo-google-fonts/roboto-flex';

/**
 * Typo de **tous les textes de souvenirs** (corps texte, annotations photo/vidéo/vocal)
 * — fil, viewer immersif, favoris.
 *
 * Essai actuel : Roboto Flex Regular (aligné sur le site web).
 * Pour revenir à Garamond : `@expo-google-fonts/eb-garamond` + `EBGaramond_400Regular`.
 */
export const MEMORY_TEXT_FONT_FAMILY = 'RobotoFlex_400Regular';

export const MEMORY_TEXT_FONT_SOURCES = {
  RobotoFlex_400Regular,
} as const;

/** Fallback sans-serif tant que expo-font n’a pas fini de charger. */
export const MEMORY_TEXT_FONT_FALLBACK = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
}) as string;

/** Famille CSS pour le serveur PDF (`htmlBook.ts`) — alignée sur le fil. */
export const MEMORY_TEXT_FONT_PDF_FAMILY = "'Roboto Flex', sans-serif";
