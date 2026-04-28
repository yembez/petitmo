import { Image, type ImageSourcePropType } from 'react-native';

export interface DominantColors {
  primary: string;
  secondary: string;
  background: string;
  text: string;
}

export const DEFAULT_COLORS: DominantColors = {
  primary: '#C4784A',
  secondary: '#C9963E',
  background: '#F5F0EA',
  text: '#1C1C1E',
};

export function adjustLuminance(hex: string, factor: number): string {
  const clean = hex.replace('#', '');
  const r = Math.min(
    255,
    Math.round(parseInt(clean.slice(0, 2), 16) * factor + 255 * (1 - factor))
  );
  const g = Math.min(
    255,
    Math.round(parseInt(clean.slice(2, 4), 16) * factor + 255 * (1 - factor))
  );
  const b = Math.min(
    255,
    Math.round(parseInt(clean.slice(4, 6), 16) * factor + 255 * (1 - factor))
  );
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Pour dégradés type Spotify (fade, fond ambiant) */
/** Mélange une couleur avec du blanc (0 = couleur pure, 1 = blanc) — fond lisible type Spotify clair */
export function blendWithWhite(hex: string, whiteRatio: number): string {
  const clean = hex.replace('#', '');
  if (clean.length < 6) return '#F5F0EA';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const t = Math.min(1, Math.max(0, whiteRatio));
  const R = Math.round(r * (1 - t) + 255 * t);
  const G = Math.round(g * (1 - t) + 255 * t);
  const B = Math.round(b * (1 - t) + 255 * t);
  return `#${R.toString(16).padStart(2, '0')}${G.toString(16).padStart(2, '0')}${B.toString(16).padStart(2, '0')}`;
}

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length < 6) return `rgba(245,240,234,${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Assombrit un hex (0–1) pour le bas du dégradé */
export function darkenHex(hex: string, amount: number): string {
  const clean = hex.replace('#', '');
  if (clean.length < 6) return hex;
  const r = Math.max(0, Math.round(parseInt(clean.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(clean.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(clean.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/** Luminance linéaire type interface (alignée sur `getContrastText`) — 0 = noir, 1 = blanc */
export function luminanceFromHex(hex: string): number {
  const clean = hex.replace('#', '');
  if (clean.length < 6) return 0.5;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some(n => Number.isNaN(n))) return 0.5;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function getContrastText(hex: string): string {
  return luminanceFromHex(hex) > 0.55 ? '#1C1C1E' : '#FFFFFF';
}

/**
 * Logo hero : noir si le fond est trop clair, blanc s’il est assez foncé.
 * Seuil au-dessus duquel on bascule en encre (même gris que l’interface).
 */
export function heroLogoFillFromLuminance(luminance: number): '#FFFFFF' | '#1C1C1E' {
  const LIGHT_BG_THRESHOLD = 0.64;
  return luminance > LIGHT_BG_THRESHOLD ? '#1C1C1E' : '#FFFFFF';
}

export function resolveUriForPalette(source: string | ImageSourcePropType): string {
  if (typeof source === 'string') return source;
  const resolved = Image.resolveAssetSource(source);
  return resolved?.uri ?? '';
}
