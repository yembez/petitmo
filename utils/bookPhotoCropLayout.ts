import { defaultPhotoCrop, type PhotoCrop } from '@/src/book/photoCrop';

/**
 * Recadrage photo couverture au **ratio réel de la photo** (et non `contentFit="cover"`).
 *
 * Avec `cover`, la photo est rognée AVANT tout zoom/déplacement : les zones coupées
 * (haut/bas d'un portrait dans le bandeau paysage) sont perdues et inatteignables.
 * Ici on calcule la taille « cover » de l'image (elle déborde le cadre sur un axe), puis
 * on la déplace dans le cadre : en zoomant / glissant on peut atteindre **toute** la photo,
 * même si le cadrage couverture impose un crop centré au départ.
 *
 * Convention de `PhotoCrop` (identique à l'existant) : `xPct`/`yPct` = décalage de pan en %
 * de la largeur/hauteur du cadre ; `scale` = zoom (≥ 1). `{0,0,1}` = cover centré.
 */

/** Taille « cover » de l'image dans le cadre, au ratio réel de la photo (déborde sur un axe). */
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

/** Bornes de pan (px du cadre) pour que le cadre reste entièrement couvert (centré). */
export function clampBookPhotoCropPan(
  frameW: number,
  frameH: number,
  imgPxW: number,
  imgPxH: number,
  scale: number,
  tx: number,
  ty: number,
): { tx: number; ty: number } {
  'worklet';
  const s = Math.max(1, scale);
  const { baseW, baseH } = bookPhotoCoverBaseSize(frameW, frameH, imgPxW, imgPxH);
  const maxTx = Math.max(0, (baseW * s - frameW) / 2);
  const maxTy = Math.max(0, (baseH * s - frameH) / 2);
  return {
    tx: Math.max(-maxTx, Math.min(maxTx, tx)),
    ty: Math.max(-maxTy, Math.min(maxTy, ty)),
  };
}

/** Position / taille de l'image dans le cadre (parité éditeur ↔ aperçu). */
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
