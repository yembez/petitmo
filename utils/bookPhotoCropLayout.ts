import { defaultPhotoCrop, photoCropFit, type PhotoCrop, type PhotoCropFit } from '@/src/book/photoCrop';

/**
 * Recadrage photo livre au **ratio réel de la photo**.
 *
 * - `cover` : taille « cover » (déborde sur un axe) — `{0,0,1}` = cadre rempli, centré.
 * - `contain` : taille « contain » (tient dans le cadre) — `{0,0,1}` = photo entière
 *   (bandes blanches possibles) ; zoom/pan pour recentrer.
 *
 * Convention : `xPct`/`yPct` = décalage de pan en % du cadre ; `scale` = zoom (≥ 1).
 */

/** Taille « cover » — remplit le cadre, déborde sur un axe. */
export function bookPhotoCoverBaseSize(
  frameW: number,
  frameH: number,
  imgPxW: number,
  imgPxH: number,
): { baseW: number; baseH: number } {
  'worklet';
  if (!imgPxW || !imgPxH || !frameW || !frameH) {
    return { baseW: frameW, baseH: frameH };
  }
  const imgAspect = imgPxW / imgPxH;
  const frameAspect = frameW / frameH;
  if (imgAspect > frameAspect) {
    return { baseW: frameH * imgAspect, baseH: frameH };
  }
  return { baseW: frameW, baseH: frameW / imgAspect };
}

/** Taille « contain » — photo entière dans le cadre (letterbox / pillarbox). */
export function bookPhotoContainBaseSize(
  frameW: number,
  frameH: number,
  imgPxW: number,
  imgPxH: number,
): { baseW: number; baseH: number } {
  'worklet';
  if (!imgPxW || !imgPxH || !frameW || !frameH) {
    return { baseW: frameW, baseH: frameH };
  }
  const imgAspect = imgPxW / imgPxH;
  const frameAspect = frameW / frameH;
  if (imgAspect > frameAspect) {
    return { baseW: frameW, baseH: frameW / imgAspect };
  }
  return { baseW: frameH * imgAspect, baseH: frameH };
}

export function bookPhotoBaseSize(
  frameW: number,
  frameH: number,
  imgPxW: number,
  imgPxH: number,
  fit: PhotoCropFit = 'cover',
): { baseW: number; baseH: number } {
  'worklet';
  return fit === 'contain'
    ? bookPhotoContainBaseSize(frameW, frameH, imgPxW, imgPxH)
    : bookPhotoCoverBaseSize(frameW, frameH, imgPxW, imgPxH);
}

/** Bornes de pan (px du cadre) — cadre rempli (cover) ou image ≤ cadre (contain). */
export function clampBookPhotoCropPan(
  frameW: number,
  frameH: number,
  imgPxW: number,
  imgPxH: number,
  scale: number,
  tx: number,
  ty: number,
  fit: PhotoCropFit = 'cover',
): { tx: number; ty: number } {
  'worklet';
  const s = Math.max(1, scale);
  const { baseW, baseH } = bookPhotoBaseSize(frameW, frameH, imgPxW, imgPxH, fit);
  const maxTx = Math.max(0, (baseW * s - frameW) / 2);
  const maxTy = Math.max(0, (baseH * s - frameH) / 2);
  return {
    tx: Math.max(-maxTx, Math.min(maxTx, tx)),
    ty: Math.max(-maxTy, Math.min(maxTy, ty)),
  };
}

/** Position / taille de l'image dans le cadre (parité éditeur ↔ aperçu ↔ PDF). */
export function bookPhotoCropImageRect(
  frameW: number,
  frameH: number,
  imgPxW: number,
  imgPxH: number,
  crop?: PhotoCrop,
): { width: number; height: number; left: number; top: number } {
  const ic = crop ?? defaultPhotoCrop();
  const fit = photoCropFit(ic);
  const s = Math.max(1, ic.scale);
  const { baseW, baseH } = bookPhotoBaseSize(frameW, frameH, imgPxW, imgPxH, fit);
  const width = baseW * s;
  const height = baseH * s;
  const rawTx = (ic.xPct / 100) * frameW;
  const rawTy = (ic.yPct / 100) * frameH;
  const { tx, ty } = clampBookPhotoCropPan(
    frameW,
    frameH,
    imgPxW,
    imgPxH,
    s,
    rawTx,
    rawTy,
    fit,
  );
  return {
    width,
    height,
    left: (frameW - width) / 2 + tx,
    top: (frameH - height) / 2 + ty,
  };
}
