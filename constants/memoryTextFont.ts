import { Platform } from 'react-native';
import { Roboto_400Regular } from '@expo-google-fonts/roboto';

/**
 * Typo de **tous les textes de souvenirs** (corps texte, annotations photo/vidéo/vocal)
 * — fil, viewer immersif, favoris, livre.
 */
export const MEMORY_TEXT_FONT_FAMILY = 'Roboto_400Regular';

export const MEMORY_TEXT_FONT_SOURCES = {
  Roboto_400Regular,
} as const;

/** Fallback sans-serif tant que expo-font n’a pas fini de charger. */
export const MEMORY_TEXT_FONT_FALLBACK = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
}) as string;

/** Famille CSS pour le serveur PDF (`htmlBook.ts`) — alignée sur le fil. */
export const MEMORY_TEXT_FONT_PDF_FAMILY = "'Roboto', sans-serif";
