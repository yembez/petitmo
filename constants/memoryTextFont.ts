import { Platform } from 'react-native';
import {
  DMSans_400Regular,
  DMSans_400Regular_Italic,
  DMSans_600SemiBold,
} from '@expo-google-fonts/dm-sans';

/**
 * Typo de **tous les textes de souvenirs** (corps texte, annotations photo/vidéo/vocal)
 * — fil, viewer immersif, favoris, livre.
 */
export const MEMORY_TEXT_FONT_FAMILY = 'DMSans_400Regular';

/**
 * Typo des souvenirs texte (titre + corps) + légendes — DM Sans.
 * Même famille que le chrome UI pour une identité unifiée app ↔ livre.
 */
export const MEMORY_EDITORIAL_FONT_FAMILY = 'DMSans_400Regular';

/** Variante semi-bold (titre des souvenirs texte). */
export const MEMORY_EDITORIAL_FONT_BOLD_FAMILY = 'DMSans_600SemiBold';

/** Italique optionnelle (citations / accents livre). */
export const MEMORY_TEXT_FONT_ITALIC_FAMILY = 'DMSans_400Regular_Italic';

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

/** Famille CSS pour le serveur PDF (`htmlBook.ts`) — alignée sur le fil. */
export const MEMORY_TEXT_FONT_PDF_FAMILY = "'DM Sans', sans-serif";
