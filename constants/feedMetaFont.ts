import {
  Inter_300Light,
  Inter_500Medium,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';

/** Sources Inter pour date / âge / lieu (fil + viewer immersif). */
export const FEED_META_FONT_SOURCES = {
  Inter_300Light,
  Inter_500Medium,
  Inter_800ExtraBold,
} as const;

export const FEED_META_FONT_FAMILY = {
  date: 'Inter_800ExtraBold',
  age: 'Inter_300Light',
  locationFilled: 'Inter_500Medium',
  locationPlaceholder: 'Inter_300Light',
} as const;
