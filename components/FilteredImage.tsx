import { Image, Platform } from 'react-native';
import type { ImageStyle, StyleProp, ImageResizeMode } from 'react-native';
import {
  ColorMatrix,
  concatColorMatrices,
  grayscale,
  sepia,
  saturate,
  brightness,
  contrast,
  cool,
  warm,
  vintage,
  kodachrome,
  browni,
  normal,
  type Matrix
} from 'react-native-color-matrix-image-filters';

export type FilterName = 'normal' | 'grayscale' | 'sepia' | 'vintage' | 'warm' | 'cool' | 'kodachrome' | 'browni' | 'bright' | 'contrast';

interface FilteredImageProps {
  source: { uri: string };
  style?: StyleProp<ImageStyle>;
  filterName: FilterName;
  resizeMode?: ImageResizeMode;
}

const getMatrix = (filterName: FilterName): Matrix => {
  const matrices: Record<FilterName, Matrix> = {
    normal: normal(),
    grayscale: grayscale(),
    sepia: sepia(),
    vintage: vintage(),
    warm: warm(),
    cool: cool(),
    kodachrome: kodachrome(),
    browni: browni(),
    bright: concatColorMatrices(brightness(1.2), contrast(1.1)),
    contrast: concatColorMatrices(contrast(1.4), saturate(1.1)),
  };

  return matrices[filterName] || normal();
};

export default function FilteredImage({ source, style, filterName, resizeMode = 'contain' }: FilteredImageProps) {
  /** Sans filtre : Image native uniquement — ColorMatrix casse souvent l’affichage des URLs distantes (nouvelle arch. / maquette livre). */
  if (filterName === 'normal') {
    return <Image source={source} style={style} resizeMode={resizeMode} />;
  }

  const matrix = getMatrix(filterName);

  return (
    <ColorMatrix matrix={matrix}>
      <Image source={source} style={style} resizeMode={resizeMode} />
    </ColorMatrix>
  );
}

export const FILTER_NAMES: FilterName[] = [
  'normal', 'grayscale', 'sepia', 'vintage', 'warm', 'cool', 'kodachrome', 'browni', 'bright', 'contrast'
];

export const FILTER_LABELS: Record<FilterName, string> = {
  normal: 'Normal',
  grayscale: 'N&B',
  sepia: 'Sepia',
  vintage: 'Vintage',
  warm: 'Chaud',
  cool: 'Froid',
  kodachrome: 'Kodak',
  browni: 'Brownie',
  bright: 'Lumineux',
  contrast: 'Contraste',
};
