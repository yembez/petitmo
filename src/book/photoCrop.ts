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
};

export function defaultPhotoCrop(fit: PhotoCropFit = 'cover'): PhotoCrop {
  return { xPct: 0, yPct: 0, scale: 1, ...(fit === 'contain' ? { fit: 'contain' } : {}) };
}

export function photoCropFit(crop?: PhotoCrop | null): PhotoCropFit {
  return crop?.fit === 'contain' ? 'contain' : 'cover';
}
