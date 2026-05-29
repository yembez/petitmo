import React from 'react';
import { isSkiaAvailable } from '@/utils/isSkiaAvailable';

type CaptureHeroSkiaPhotoProps = {
  photoUri: string;
};

/**
 * Flou sur les bords de la photo Capturer (Skia si le module natif est présent).
 * Import différé pour ne pas crasher Expo Go / binaire sans `RNSkiaModule`.
 */
export function CaptureHeroSkiaPhoto({ photoUri }: CaptureHeroSkiaPhotoProps) {
  if (!isSkiaAvailable()) {
    return null;
  }

  const { CaptureHeroSkiaPhotoInner } =
    require('@/components/CaptureHeroSkiaPhotoInner') as typeof import('@/components/CaptureHeroSkiaPhotoInner');

  return <CaptureHeroSkiaPhotoInner photoUri={photoUri} />;
}
