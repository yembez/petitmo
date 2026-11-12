/** Mode de cadrage dans le cadre page (défaut = remplir / rogner). */
export type PhotoCropFit = 'cover' | 'contain';

export type PhotoCrop = {
  xPct: number;
  yPct: number;
  scale: number;
  /**
   * `cover` (défaut) : remplit le cadre (bords éventuellement coupés).
   * `contain` : format original — toute la photo visible (bandes blanches possibles).
   */
  fit?: PhotoCropFit;
  /**
   * Dims source figées à l’édition — 1er paint spread après restore sans attendre Image.getSize.
   */
  imgPxW?: number;
  imgPxH?: number;
};

/** Crop non trivial (pan / zoom / contain) — nécessite le chemin aspect dès le 1er frame. */
export function photoCropNeedsAspectLayout(crop?: PhotoCrop | null): boolean {
  if (!crop) return false;
  if (crop.fit === 'contain') return true;
  if (Math.max(1, crop.scale) > 1.02) return true;
  if (Math.abs(crop.xPct) > 0.5 || Math.abs(crop.yPct) > 0.5) return true;
  return false;
}

export function defaultPhotoCrop(fit: PhotoCropFit = 'cover'): PhotoCrop {
  return { xPct: 0, yPct: 0, scale: 1, ...(fit === 'contain' ? { fit: 'contain' } : {}) };
}

export function photoCropFit(crop?: PhotoCrop | null): PhotoCropFit {
  return crop?.fit === 'contain' ? 'contain' : 'cover';
}
