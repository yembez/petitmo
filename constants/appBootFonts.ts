import {
  Inter_300Light_Italic,
  Inter_500Medium,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { Manrope_400Regular, Manrope_700Bold } from '@expo-google-fonts/manrope';
import {
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import * as Font from 'expo-font';
import { FEED_META_FONT_SOURCES } from '@/constants/feedMetaFont';
import { MEMORY_TEXT_FONT_SOURCES } from '@/constants/memoryTextFont';

/**
 * Polices du 1er écran (Capturer + tab bar + fil méta + souvenirs + formulaires).
 * Chargées une fois dans `app/_layout.tsx` — le splash natif reste jusqu’à `isLoaded`.
 */
export const APP_BOOT_FONT_SOURCES = {
  ...FEED_META_FONT_SOURCES,
  ...MEMORY_TEXT_FONT_SOURCES,
  Inter_300Light_Italic,
  Inter_500Medium,
  Inter_700Bold,
  Manrope_400Regular,
  Manrope_700Bold,
  DMSans_500Medium,
  DMSans_700Bold,
} as const;

/** Familles à vérifier avant de peindre l’UI (évite les « ? » iOS). */
const APP_BOOT_FONT_FAMILIES = Object.keys(APP_BOOT_FONT_SOURCES);

export function areAppBootFontsLoaded(): boolean {
  return APP_BOOT_FONT_FAMILIES.every(name => Font.isLoaded(name));
}
