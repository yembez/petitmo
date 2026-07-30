import { verticalScale } from '@/utils/responsive';

/**
 * Ancrage `cover` du hero — visage / buste légèrement au-dessus du centre.
 * Aligné entre l’écran Capturer et `CropModal`.
 */
export const CAPTURE_HERO_IMAGE_CONTENT_POSITION = { top: '32%', left: '50%' } as const;

/** `object-position` pour le hero web (`ImageBackground`). */
export const CAPTURE_HERO_IMAGE_OBJECT_POSITION = 'center 32%';

/**
 * Ratio largeur/hauteur de la **carte photo** Capturer et du crop profil (`CropModal`).
 * Source de vérité unique — ne plus dériver le crop du ratio « 70 % écran ».
 */
export const CHILD_PROFILE_PHOTO_ASPECT = 0.93;

/** Variante compacte (écran bas) — affichage Capturer uniquement, pas le crop. */
export const CHILD_PROFILE_PHOTO_ASPECT_COMPACT = 0.85;

/**
 * Viewport legacy (zone photo plein largeur) — réservé aux layouts Capturer hors crop.
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
 * Viewport zone photo Capturer (plein largeur × ~70 % hauteur) — layouts hors crop.
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
 * (même ratio que la zone photo Capturer).
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
 * Rectangle de recadrage inscrit dans `maxWidth` × `maxHeight` pour un ratio w/h donné.
 */
export function insetCropRectForAspect(
  maxWidth: number,
  maxHeight: number,
  aspectWidthOverHeight: number,
): { width: number; height: number } {
  const awh =
    Number.isFinite(aspectWidthOverHeight) && aspectWidthOverHeight > 0
      ? aspectWidthOverHeight
      : CHILD_PROFILE_PHOTO_ASPECT;
  let w = maxWidth;
  let h = Math.round(w / awh);
  if (h > maxHeight) {
    h = maxHeight;
    w = Math.round(h * awh);
  }
  return { width: Math.max(1, w), height: Math.max(1, h) };
}

/** Crop profil = carte photo Capturer (`CHILD_PROFILE_PHOTO_ASPECT`). */
export function insetCropRectForChildProfilePhoto(
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  return insetCropRectForAspect(maxWidth, maxHeight, CHILD_PROFILE_PHOTO_ASPECT);
}

/**
 * @deprecated Préférer `insetCropRectForChildProfilePhoto` (ratio carte 0.93).
 * Conservé pour appels legacy au viewport plein largeur.
 */
export function insetCropRectForCaptureHeroViewport(
  maxWidth: number,
  maxHeight: number,
  viewport: CaptureHeroViewport | { width: number; height: number },
): { width: number; height: number } {
  const awh = viewport.width / Math.max(1, viewport.height);
  return insetCropRectForAspect(maxWidth, maxHeight, awh);
}
