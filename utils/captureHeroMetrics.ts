import { verticalScale } from '@/utils/responsive';

/**
 * Métrique du bloc photo hero de l’onglet **Capturer** (même formule que `app/(tabs)/index.tsx`).
 * `computeCaptureHeroCardInnerPhotoSize` : même ratio que le viewport → aligné avec `CropModal`.
 *
 * Le ratio largeur/hauteur utilise **`heroH` seul** (sans ajouter `insetTop` à `height`) : sinon le
 * cadre cible est plus « portrait » que le hero réellement affiché dans la carte → `cover` rogne
 * davantage (haut/bas) par rapport à l’éditeur de profil.
 */
export type CaptureHeroViewport = {
  width: number;
  height: number;
  heroH: number;
};

export function computeCaptureHeroPhotoViewport(
  frameHeight: number,
  windowHeight: number,
  screenWidth: number,
  _insetTop: number,
): CaptureHeroViewport {
  const usableH = Math.max(280, windowHeight);
  const layoutH = Math.min(frameHeight > 1 ? frameHeight : usableH, usableH);
  const compact = layoutH < 600;
  const heroH = Math.min(layoutH * (compact ? 0.6 : 0.68), verticalScale(540));
  return {
    width: screenWidth,
    height: heroH,
    heroH,
  };
}

/**
 * Taille du bloc photo quand le hero est dans une carte avec marges horizontales
 * (même ratio largeur/hauteur que le viewport plein écran → parité avec `CropModal`).
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
