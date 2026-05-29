import { verticalScale } from '@/utils/responsive';

/**
 * Ancrage `cover` du hero — visage / buste légèrement au-dessus du centre.
 * Aligné entre l’écran Capturer et `CropModal`.
 */
export const CAPTURE_HERO_IMAGE_CONTENT_POSITION = { top: '32%', left: '50%' } as const;

/** `object-position` pour le hero web (`ImageBackground`). */
export const CAPTURE_HERO_IMAGE_OBJECT_POSITION = 'center 32%';

/**
 * Viewport d’affichage + recadrage profil = zone photo Capturer (≈ 70 % hauteur écran).
 * Même ratio que `capturePhotoZone` dans `app/(tabs)/index.tsx` et `CropModal`.
 */
export type CaptureHeroViewport = {
  width: number;
  height: number;
  /** Hauteur utile = zone photo (pas l’écran entier). */
  heroH: number;
};

/** Zone photo (titre en overlay en bas) — le bandeau marron ne sert qu’aux CTA. */
export const CAPTURE_PHOTO_ZONE_HEIGHT_RATIO = 0.7;

/** Bandeau marron CTA uniquement. */
export const CAPTURE_BROWN_PANEL_HEIGHT_RATIO = 1 - CAPTURE_PHOTO_ZONE_HEIGHT_RATIO;

/** Hauteur du fondu beige sur le bas de la zone photo (sous le titre). */
export const CAPTURE_PHOTO_GRADIENT_HEIGHT_RATIO = 0.42;

export function computeCaptureBrownPanelHeight(layoutHeight: number): number {
  return Math.round(layoutHeight * CAPTURE_BROWN_PANEL_HEIGHT_RATIO);
}

/** Hauteur photo = écran moins bandeau — bord bas photo = bord haut bandeau. */
export function computeCapturePhotoZoneHeight(layoutHeight: number): number {
  const brownH = computeCaptureBrownPanelHeight(layoutHeight);
  return Math.max(verticalScale(240), layoutHeight - brownH);
}

export function computeCapturePhotoGradientHeight(photoZoneHeight: number): number {
  return Math.max(
    verticalScale(140),
    Math.round(photoZoneHeight * CAPTURE_PHOTO_GRADIENT_HEIGHT_RATIO),
  );
}

/**
 * Ratio largeur/hauteur du crop profil = zone photo Capturer (70 % écran, pleine largeur).
 */
export function computeCaptureHeroPhotoViewport(
  frameHeight: number,
  windowHeight: number,
  screenWidth: number,
  _insetTop: number,
): CaptureHeroViewport {
  const usableH = Math.max(280, windowHeight);
  const layoutH = Math.min(frameHeight > 1 ? frameHeight : usableH, usableH);
  const photoZoneH = computeCapturePhotoZoneHeight(layoutH);
  return {
    width: screenWidth,
    height: photoZoneH,
    heroH: photoZoneH,
  };
}

/**
 * Taille du bloc photo dans une carte avec marges horizontales
 * (même ratio que la zone photo Capturer / `CropModal`).
 */
export function computeCaptureHeroCardInnerPhotoSize(
  viewport: CaptureHeroViewport,
  horizontalInset: number,
): { width: number; height: number } {
  const innerW = Math.max(1, viewport.width - 2 * horizontalInset);
  const innerH = Math.max(1, Math.round((innerW * viewport.height) / viewport.width));
  return { width: innerW, height: innerH };
}

/**
 * Rectangle de recadrage inscrit dans `maxWidth` × `maxHeight`,
 * avec le même ratio largeur/hauteur que le viewport photo Capturer.
 */
export function insetCropRectForCaptureHeroViewport(
  maxWidth: number,
  maxHeight: number,
  viewport: CaptureHeroViewport | { width: number; height: number },
): { width: number; height: number } {
  const awh = viewport.width / viewport.height;
  let w = maxWidth;
  let h = Math.round(w / awh);
  if (h > maxHeight) {
    h = maxHeight;
    w = Math.round(h * awh);
  }
  return { width: Math.max(1, w), height: Math.max(1, h) };
}
