/**
 * Détection de flou (Laplacien) — **désactivée en V1**.
 *
 * Faux positifs fréquents sur photos Portrait iPhone (bokeh volontaire).
 * Conservé pour une éventuelle V2 (ROI sujet / centre), non branché à l’UI ni à l’export.
 */
export type PhotoBlurStatus = 'sharp' | 'soft' | 'blurry' | 'unknown';

export function photoBlurStatus(_score: number | null | undefined): PhotoBlurStatus {
  return 'unknown';
}

export function effectiveBlurScoreForCropScale(
  _score: number | null | undefined,
  _scale: number,
): number | null {
  return null;
}

export function photoBlurStatusLabel(_status: PhotoBlurStatus): string {
  return 'Netteté —';
}

export async function estimatePhotoBlurScore(_uri: string): Promise<number | null> {
  return null;
}
