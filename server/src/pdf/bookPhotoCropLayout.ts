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

/**
 * Style inline `<img>` couverture (pourcentages du cadre photo).
 * `frameRefW` / `frameRefH` doivent être le **vrai** bandeau rendu
 * (digital : pageW × pageH×142/216 ; print+bleed : pageW+2×bleed × pageH×142/216).
 * Ne jamais utiliser le cadre historique 216:142 — il zoome trop (ratio ~1,52 vs ~1,14).
 *
 * Préférer `coverCropFrameHtml` pour le PDF : Chromium print-to-PDF gère mal
 * left/top/width/height % directement sur `<img>` (bandeau blanc haut).
 */
export function coverCropImgInlineStyle(
  crop: PhotoCrop | undefined,
  imgPxW: number,
  imgPxH: number,
  frameRefW: number,
  frameRefH: number,
): string {
  const fw = Math.max(1, frameRefW);
  const fh = Math.max(1, frameRefH);
  const rect = bookPhotoCropImageRect(fw, fh, imgPxW, imgPxH, crop);
  const leftPct = (rect.left / fw) * 100;
  const topPct = (rect.top / fh) * 100;
  const widthPct = (rect.width / fw) * 100;
  const heightPct = (rect.height / fh) * 100;
  return [
    'position:absolute',
    'inset:auto',
    `left:${leftPct.toFixed(4)}%`,
    `top:${topPct.toFixed(4)}%`,
    `width:${widthPct.toFixed(4)}%`,
    `height:${heightPct.toFixed(4)}%`,
    'object-fit:fill',
  ].join(';');
}

/** Crop identité (cover centré, pas de pan/zoom utilisateur). */
export function isDefaultPhotoCrop(crop: PhotoCrop | undefined | null): boolean {
  if (!crop) return true;
  const s = typeof crop.scale === 'number' && Number.isFinite(crop.scale) ? crop.scale : 1;
  const x = typeof crop.xPct === 'number' && Number.isFinite(crop.xPct) ? crop.xPct : 0;
  const y = typeof crop.yPct === 'number' && Number.isFinite(crop.yPct) ? crop.yPct : 0;
  return Math.abs(x) < 0.05 && Math.abs(y) < 0.05 && Math.abs(s - 1) < 0.005;
}

const PDF_COVER_FIT_STYLE =
  'position:absolute;inset:-1px;width:calc(100% + 2px);height:calc(100% + 2px);object-fit:cover;display:block;';

/**
 * Markup cadre photo PDF (couverture / pages) — Chromium-safe.
 * - crop défaut ou sans dims → `object-fit:cover` plein cadre
 * - crop custom + dims → wrapper en **% du cadre** (pas mm absolus : print Chromium
 *   décalait l’image dans les marges blanches → date collée sous la photo).
 *   Ancien chemin mm : OK pour cover full-bleed, KO pour `.pn-image` paddé.
 */
export function coverCropFrameHtml(params: {
  srcAttr: string;
  crop?: PhotoCrop | null;
  imgPxW?: number;
  imgPxH?: number;
  frameRefW: number;
  frameRefH: number;
  /** ex. `transform: rotate(90deg); transform-origin: center;` */
  extraImgStyle?: string;
}): string {
  const src = (params.srcAttr ?? '').trim();
  if (!src) return '';
  const extra = (params.extraImgStyle ?? '').trim();
  const fw = Math.max(1, params.frameRefW);
  const fh = Math.max(1, params.frameRefH);
  const hasDims =
    typeof params.imgPxW === 'number' &&
    typeof params.imgPxH === 'number' &&
    params.imgPxW > 0 &&
    params.imgPxH > 0;
  const custom = hasDims && !isDefaultPhotoCrop(params.crop);

  // Remplit le parent (cover / pn-image / gw-front-photo). Hauteur en mm ici
  // cassait la couverture Gelato (cadre plus petit que le panneau → bandes blanches).
  const frameBox = 'width:100%;height:100%;position:relative;overflow:hidden;';

  if (!custom) {
    const style = extra ? `${PDF_COVER_FIT_STYLE}${extra}` : PDF_COVER_FIT_STYLE;
    return `<div class="crop-frame" style="${frameBox}"><img class="crop-img" src="${src}" alt="" style="${style}" /></div>`;
  }

  const rect = bookPhotoCropImageRect(fw, fh, params.imgPxW!, params.imgPxH!, params.crop ?? undefined);
  // % du cadre (pas mm absolus) : aligne le crop sur la boîte réelle rendue par Chromium
  // (sinon débordement dans les marges blanches `.pn-image` / date collée sous la photo).
  const leftPct = (rect.left / fw) * 100;
  const topPct = (rect.top / fh) * 100;
  const widthPct = (rect.width / fw) * 100;
  const heightPct = (rect.height / fh) * 100;
  const wrapStyle = [
    'position:absolute',
    `left:${leftPct.toFixed(4)}%`,
    `top:${topPct.toFixed(4)}%`,
    `width:${widthPct.toFixed(4)}%`,
    `height:${heightPct.toFixed(4)}%`,
    'overflow:hidden',
  ].join(';');
  const imgStyle = extra
    ? `position:absolute;inset:0;width:100%;height:100%;object-fit:fill;display:block;${extra}`
    : 'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;display:block;';
  return `<div class="crop-frame" style="${frameBox}"><div style="${wrapStyle}"><img src="${src}" alt="" style="${imgStyle}" /></div></div>`;
}
