import { Platform } from 'react-native';
import { Roboto_400Regular } from '@expo-google-fonts/roboto';

/**
 * Typo de **tous les textes de souvenirs** (corps texte, annotations photo/vidéo/vocal)
 * — fil, viewer immersif, favoris, livre.
 */
export const MEMORY_TEXT_FONT_FAMILY = 'Roboto_400Regular';

/**
 * Typo **éditoriale** des souvenirs texte (titre + corps) dans le fil — Charter.
 * Charter est une police **système iOS** (aucun package à charger) ; sur Android
 * elle n’existe pas → repli serif.
 * Garder le nom de famille `Charter` (validé sur le fil) — pas `Charter-Roman`.
 */
export const MEMORY_EDITORIAL_FONT_FAMILY = Platform.select({
  ios: 'Charter',
  android: 'serif',
  default: 'serif',
}) as string;

/** Variante grasse (titre des souvenirs texte) — Charter Bold (système iOS). */
export const MEMORY_EDITORIAL_FONT_BOLD_FAMILY = Platform.select({
  ios: 'Charter-Bold',
  android: 'serif',
  default: 'serif',
}) as string;

export const MEMORY_TEXT_FONT_SOURCES = {
  Roboto_400Regular,
} as const;

/** Fallback sans-serif tant que expo-font n’a pas fini de charger. */
export const MEMORY_TEXT_FONT_FALLBACK = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
}) as string;

/** Fallback serif si Charter indisponible. */
export const MEMORY_EDITORIAL_FONT_FALLBACK = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'serif',
}) as string;

/** Famille CSS pour le serveur PDF (`htmlBook.ts`) — alignée sur le fil. */
export const MEMORY_TEXT_FONT_PDF_FAMILY = "'Roboto', sans-serif";
