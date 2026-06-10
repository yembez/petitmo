import { Platform } from 'react-native';
import { EBGaramond_400Regular } from '@expo-google-fonts/eb-garamond';

/**
 * Typo Garamond de **tous les textes de souvenirs** (corps texte, annotations photo/vidéo/vocal)
 * — fil, viewer immersif, favoris.
 *
 * **GLC Garamond** (1592) : police commerciale — déposer `GLCGaramond-Regular.otf`
 * dans `assets/fonts/`, puis remplacer `MEMORY_TEXT_FONT_SOURCES` par :
 * `{ 'GLCGaramond-Regular': require('@/assets/fonts/GLCGaramond-Regular.otf') }`
 * et `MEMORY_TEXT_FONT_FAMILY` par `'GLCGaramond-Regular'` (licence app requise).
 *
 * En attendant : EB Garamond Regular (Google Fonts, déjà dans le projet).
 */
export const MEMORY_TEXT_FONT_FAMILY = 'EBGaramond_400Regular';

export const MEMORY_TEXT_FONT_SOURCES = {
  EBGaramond_400Regular,
} as const;

/** Fallback serif tant que expo-font n’a pas fini de charger. */
export const MEMORY_TEXT_FONT_FALLBACK = Platform.select({
  ios: 'Georgia',
  android: 'serif',
  default: 'Georgia',
}) as string;
