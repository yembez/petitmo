import { Image } from 'react-native';
import type { ImageStyle, StyleProp, ImageResizeMode } from 'react-native';

export type FilterName = 'normal' | 'grayscale' | 'sepia' | 'vintage' | 'warm' | 'cool' | 'kodachrome' | 'browni' | 'bright' | 'contrast';

interface FilteredImageProps {
  source: { uri: string };
  style?: StyleProp<ImageStyle>;
  filterName: FilterName;
  resizeMode?: ImageResizeMode;
}

export default function FilteredImage({ source, style, resizeMode = 'contain' }: FilteredImageProps) {
  return <Image source={source} style={style} resizeMode={resizeMode} />;
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
