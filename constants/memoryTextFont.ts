import { Platform } from 'react-native';

/** Typo des textes de souvenirs (fil, annotations, viewer, favoris). */
export const MEMORY_TEXT_FONT = Platform.select({
  ios: 'Helvetica',
  android: 'sans-serif',
  default: 'Helvetica',
});
