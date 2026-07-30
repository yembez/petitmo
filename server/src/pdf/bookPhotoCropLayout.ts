/**
 * Miroir de `utils/bookPhotoCropLayout.ts` (aperçu livre) — parité export PDF.
 *
 * ─── Chromium print-to-PDF (règle absolue) ───
 * Ne jamais positionner un crop custom avec left/top/width/height en **%**.
 * Blink ignore souvent ces % quand le containing block est un flex/% instable
 * → `<img>` invisible → page avec date/filet seuls (photo-full FP, vidéo, etc.).
 *
 * Contrat unique : cadre + image en **mm absolus** (frameRefW/H = mm du bandeau réel).
 * - crop défaut / sans dims px → object-fit:cover dans le cadre mm
 * - crop custom + dims px → left/top/width/height en mm sur l’`<img>`
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

/** Crop identité (cover centré, pas de pan/zoom utilisateur). */
export function isDefaultPhotoCrop(crop: PhotoCrop | undefined | null): boolean {
  if (!crop) return true;
  const s = typeof crop.scale === 'number' && Number.isFinite(crop.scale) ? crop.scale : 1;
  const x = typeof crop.xPct === 'number' && Number.isFinite(crop.xPct) ? crop.xPct : 0;
  const y = typeof crop.yPct === 'number' && Number.isFinite(crop.yPct) ? crop.yPct : 0;
  return Math.abs(x) < 0.05 && Math.abs(y) < 0.05 && Math.abs(s - 1) < 0.005;
}

/**
 * Style inline `<img>` crop custom — **mm uniquement** (jamais %).
 * `frameRefW` / `frameRefH` = bandeau réel en mm (pas le ratio historique 216:142).
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
  return [
    'position:absolute',
    'inset:auto',
    `left:${rect.left.toFixed(3)}mm`,
    `top:${rect.top.toFixed(3)}mm`,
    `width:${rect.width.toFixed(3)}mm`,
    `height:${rect.height.toFixed(3)}mm`,
    'object-fit:fill',
    'display:block',
  ].join(';');
}

/** Anti-gap 1px (couverture / wraparound) — % relatifs au cadre déjà dimensionné en mm. */
const PDF_FIT_BLEED_STYLE =
  'position:absolute;inset:-1px;width:calc(100% + 2px);height:calc(100% + 2px);object-fit:cover;display:block;';

/** Pages à marges blanches : fill strict du cadre mm. */
const PDF_FIT_STRICT_STYLE =
  'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';

export type CoverCropFitMode = 'bleed' | 'strict';

/**
 * Markup cadre photo PDF — **toujours** Chromium-safe (cadre en mm).
 * Plus de chemin `%` pour crop custom (supprimé : fragile sous print-to-PDF).
 *
 * @param frameRefW / frameRefH — dimensions du cadre en **mm**
 * @param fitMode — `bleed` couverture ; `strict` photo-full / note / A-V (défaut)
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
  fitMode?: CoverCropFitMode;
  /**
   * @deprecated Toujours true. Conservé pour compat appelants ; ignoré.
   */
  lockFrameMm?: boolean;
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
  const fitMode: CoverCropFitMode = params.fitMode === 'bleed' ? 'bleed' : 'strict';
  const clip = 'clip-path:inset(0);-webkit-clip-path:inset(0);';
  const frameBox = `width:${fw.toFixed(3)}mm;height:${fh.toFixed(3)}mm;position:relative;overflow:hidden;${clip}`;

  if (!custom) {
    const base = fitMode === 'bleed' ? PDF_FIT_BLEED_STYLE : PDF_FIT_STRICT_STYLE;
    const style = extra ? `${base}${extra}` : base;
    return `<div class="crop-frame" style="${frameBox}"><img class="crop-img" src="${src}" alt="" style="${style}" /></div>`;
  }

  const imgStyle = [
    coverCropImgInlineStyle(params.crop ?? undefined, params.imgPxW!, params.imgPxH!, fw, fh),
    extra,
  ]
    .filter(Boolean)
    .join(';');
  return `<div class="crop-frame" style="${frameBox}"><img class="crop-img" src="${src}" alt="" style="${imgStyle}" /></div>`;
}

/**
 * Garde-fou tests / CI : le markup crop ne doit jamais repositionner via des %.
 * (Les `width:100%` de object-fit cover à l’intérieur d’un cadre mm sont OK.)
 */
export function cropMarkupUsesFragilePercentPositioning(html: string): boolean {
  // left/top/width/height en % sur un style de positionnement crop (pas width:100% seul).
  return /(?:^|[;"\s])(?:left|top)\s*:\s*-?[\d.]+%/i.test(html);
}
