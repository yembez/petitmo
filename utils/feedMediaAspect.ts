import type { Memory } from '@/types/local';

/** Repli fil — ratio historique carte média. */
export const FEED_MEDIA_ASPECT_DEFAULT = 4 / 5;

/**
 * Bornes pour éviter cartes absurdes (pano ultra-large / story ultra-haute)
 * tout en distinguant clairement portrait vs paysage.
 */
export const FEED_MEDIA_ASPECT_MIN = 9 / 16;
export const FEED_MEDIA_ASPECT_MAX = 16 / 9;

/** `width / height` clampé pour le cadre média du fil. */
export function clampFeedMediaAspectRatio(widthOverHeight: number): number {
  if (!Number.isFinite(widthOverHeight) || widthOverHeight <= 0) {
    return FEED_MEDIA_ASPECT_DEFAULT;
  }
  return Math.min(FEED_MEDIA_ASPECT_MAX, Math.max(FEED_MEDIA_ASPECT_MIN, widthOverHeight));
}

export function feedMediaAspectFromPixels(
  w: number | null | undefined,
  h: number | null | undefined,
): number | null {
  if (typeof w !== 'number' || typeof h !== 'number' || w <= 0 || h <= 0) return null;
  return clampFeedMediaAspectRatio(w / h);
}

/**
 * Aspect sync depuis SQLite (`print_px_*` = pixels print / poster vidéo).
 * `null` → mesurer l’URI affichée ou utiliser le défaut.
 */
export function feedMediaAspectFromMemory(memory: Memory): number | null {
  if (memory.type !== 'photo' && memory.type !== 'video' && memory.type !== 'voice') {
    return null;
  }
  return feedMediaAspectFromPixels(memory.print_px_w, memory.print_px_h);
}
