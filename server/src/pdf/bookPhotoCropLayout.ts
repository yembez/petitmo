/**
 * Miroir de `utils/bookPhotoCropLayout.ts` (aperçu livre) — parité export PDF couverture.
 */

export type PhotoCrop = { xPct: number; yPct: number; scale: number };

export function defaultPhotoCrop(): PhotoCrop {
  return { xPct: 0, yPct: 0, scale: 1 };
}

export function bookPhotoCoverBaseSize(
  frameW: number,
  frameH: number,
  imgPxW: number,
  imgPxH: number,
): { baseW: number; baseH: number } {
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

export function clampBookPhotoCropPan(
  frameW: number,
  frameH: number,
  imgPxW: number,
  imgPxH: number,
  scale: number,
  tx: number,
  ty: number,
): { tx: number; ty: number } {
  const s = Math.max(1, scale);
  const { baseW, baseH } = bookPhotoCoverBaseSize(frameW, frameH, imgPxW, imgPxH);
  const maxTx = Math.max(0, (baseW * s - frameW) / 2);
  const maxTy = Math.max(0, (baseH * s - frameH) / 2);
  return {
    tx: Math.max(-maxTx, Math.min(maxTx, tx)),
    ty: Math.max(-maxTy, Math.min(maxTy, ty)),
  };
}

export function bookPhotoCropImageRect(
  frameW: number,
  frameH: number,
  imgPxW: number,
  imgPxH: number,
  crop?: PhotoCrop,
): { width: number; height: number; left: number; top: number } {
  const ic = crop ?? defaultPhotoCrop();
  const s = Math.max(1, ic.scale);
  const { baseW, baseH } = bookPhotoCoverBaseSize(frameW, frameH, imgPxW, imgPxH);
  const width = baseW * s;
  const height = baseH * s;
  const rawTx = (ic.xPct / 100) * frameW;
  const rawTy = (ic.yPct / 100) * frameH;
  const { tx, ty } = clampBookPhotoCropPan(frameW, frameH, imgPxW, imgPxH, s, rawTx, rawTy);
  return {
    width,
    height,
    left: (frameW - width) / 2 + tx,
    top: (frameH - height) / 2 + ty,
  };
}

/** Style inline `<img>` couverture (pourcentages du cadre photo). */
export function coverCropImgInlineStyle(
  crop: PhotoCrop | undefined,
  imgPxW: number,
  imgPxH: number,
  frameRefW = 1000,
  frameRefH = (1000 * 142) / 216,
): string {
  const rect = bookPhotoCropImageRect(frameRefW, frameRefH, imgPxW, imgPxH, crop);
  const leftPct = (rect.left / frameRefW) * 100;
  const topPct = (rect.top / frameRefH) * 100;
  const widthPct = (rect.width / frameRefW) * 100;
  const heightPct = (rect.height / frameRefH) * 100;
  return [
    'position:absolute',
    `left:${leftPct.toFixed(4)}%`,
    `top:${topPct.toFixed(4)}%`,
    `width:${widthPct.toFixed(4)}%`,
    `height:${heightPct.toFixed(4)}%`,
    'object-fit:cover',
  ].join(';');
}
