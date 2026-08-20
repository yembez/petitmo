import {
  Inter_300Light_Italic,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { Manrope_400Regular, Manrope_700Bold } from '@expo-google-fonts/manrope';
import {
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { FEED_META_FONT_SOURCES } from '@/constants/feedMetaFont';
import { MEMORY_TEXT_FONT_SOURCES } from '@/constants/memoryTextFont';

/**
 * Polices du 1er écran (Capturer + tab bar + fil méta + souvenirs).
 * Chargées une fois dans `app/_layout.tsx` avant de cacher le splash.
 */
export const APP_BOOT_FONT_SOURCES = {
  ...FEED_META_FONT_SOURCES,
  ...MEMORY_TEXT_FONT_SOURCES,
  Inter_300Light_Italic,
  Inter_700Bold,
  Manrope_400Regular,
  Manrope_700Bold,
  DMSans_400Regular,
  DMSans_500Medium,
  DMSans_700Bold,
} as const;
