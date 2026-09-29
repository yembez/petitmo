import {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
} from '@expo-google-fonts/inter';

/** Sources Inter pour date / âge / lieu (fil + viewer immersif). */
export const FEED_META_FONT_SOURCES = {
  Inter_300Light,
  Inter_400Regular,
  Inter_500Medium,
} as const;

export const FEED_META_FONT_FAMILY = {
  /** Date fil : regular (pas gras). */
  date: 'Inter_400Regular',
  age: 'Inter_300Light',
  locationFilled: 'Inter_500Medium',
  locationPlaceholder: 'Inter_300Light',
} as const;
