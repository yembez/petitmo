import type { TextStyle } from 'react-native';

/**
 * Style `fontFamily` pour une police chargée via expo-font / @expo-google-fonts.
 *
 * Sur iOS, `fontFamily: 'Manrope_700Bold'` + `fontWeight: '700'` (ou `'500'`)
 * cherche une face synthétique introuvable → chaque glyphe devient « ? ».
 * Forcer `fontWeight` / `fontStyle` à `normal` : le fichier chargé porte déjà le graisse.
 */
export function loadedFontStyle(fontFamily?: string | null): TextStyle | null {
  const family = (fontFamily ?? '').trim();
  if (!family) return null;
  return {
    fontFamily: family,
    fontWeight: 'normal',
    fontStyle: 'normal',
  };
}
