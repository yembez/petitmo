/** Évite les flashs au scroll : poster stabilisé par souvenir (id seul — pas `updated_at`). */
const feedVideoPosterStableCache = new Map<string, string>();

function shouldReplaceCachedPoster(_cached: string, _next: string): boolean {
  /** Fil : une fois affiché, on ne swap jamais l’URI poster (materialisation = flash scroll). */
  return false;
}

export function peekFeedVideoPosterStableCache(memoryId: string): string | undefined {
  const v = feedVideoPosterStableCache.get(memoryId.trim());
  return v?.trim() ? v : undefined;
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
    return cached;
  }
  feedVideoPosterStableCache.set(id, next);
  return next;
}

/** Met à jour le cache sans le vider (materialisation sandbox → pas de flash). */
export function setFeedVideoPosterStableCache(memoryId: string, uri: string): string {
  const id = memoryId.trim();
  const next = uri.trim();
  if (!id || !next) return peekFeedVideoPosterStableCache(id) ?? '';
  feedVideoPosterStableCache.set(id, next);
  return next;
}

export function invalidateFeedVideoPosterStableCache(memoryId: string): void {
  feedVideoPosterStableCache.delete(memoryId.trim());
}
