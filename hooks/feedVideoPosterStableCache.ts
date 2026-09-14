import { isLikelyRasterImageUri, isLikelyVideoFileUri } from '@/utils/videoMediaUri';

/** Évite les flashs au scroll : poster stabilisé par souvenir (id seul — pas `updated_at`). */
const feedVideoPosterStableCache = new Map<string, string>();

function isUsableCachedPoster(u: string): boolean {
  const t = u.trim();
  if (!t || isLikelyVideoFileUri(t)) return false;
  return isLikelyRasterImageUri(t);
}

function shouldReplaceCachedPoster(cached: string, next: string): boolean {
  if (!isUsableCachedPoster(cached) && isUsableCachedPoster(next)) return true;
  /** Fil : une fois un JPEG affiché, on ne swap pas (materialisation = flash scroll). */
  return false;
}

export function peekFeedVideoPosterStableCache(memoryId: string): string | undefined {
  const id = memoryId.trim();
  const v = feedVideoPosterStableCache.get(id);
  const t = v?.trim() ?? '';
  if (!t) return undefined;
  if (!isUsableCachedPoster(t)) {
    feedVideoPosterStableCache.delete(id);
    return undefined;
  }
  return t;
}

export function resolveFeedVideoPosterStableCache(memoryId: string, live: string): string {
  const id = memoryId.trim();
  const next = live.trim();
  if (!id) return next;
  if (!next) return feedVideoPosterStableCache.get(id)?.trim() ?? '';

  const cached = feedVideoPosterStableCache.get(id)?.trim() ?? '';
  if (cached) {
    if (shouldReplaceCachedPoster(cached, next)) {
      feedVideoPosterStableCache.set(id, next);
      return next;
    }
    if (isUsableCachedPoster(cached)) return cached;
  }
  if (!isUsableCachedPoster(next)) return cached;
  feedVideoPosterStableCache.set(id, next);
  return next;
}

/** Met à jour le cache sans le vider (materialisation sandbox → pas de flash). */
export function setFeedVideoPosterStableCache(memoryId: string, uri: string): string {
  const id = memoryId.trim();
  const next = uri.trim();
  if (!id || !next || !isUsableCachedPoster(next)) {
    return peekFeedVideoPosterStableCache(id) ?? '';
  }
  feedVideoPosterStableCache.set(id, next);
  return next;
}

export function invalidateFeedVideoPosterStableCache(memoryId: string): void {
  feedVideoPosterStableCache.delete(memoryId.trim());
}
