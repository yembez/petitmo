/** Poster vidéo livre stabilisé par souvenir (spread + éditeur, distinct du fil). */
const bookVideoPosterStableCache = new Map<string, string>();

function shouldReplaceCachedPoster(_cached: string, _next: string): boolean {
  return false;
}

export function peekBookVideoPosterStableCache(memoryId: string): string | undefined {
  const v = bookVideoPosterStableCache.get(memoryId.trim());
  return v?.trim() ? v : undefined;
}

export function resolveBookVideoPosterStableCache(memoryId: string, live: string): string {
  const id = memoryId.trim();
  const next = live.trim();
  if (!id) return next;
  if (!next) return bookVideoPosterStableCache.get(id)?.trim() ?? '';

  const cached = bookVideoPosterStableCache.get(id)?.trim() ?? '';
  if (cached) {
    if (shouldReplaceCachedPoster(cached, next)) {
      bookVideoPosterStableCache.set(id, next);
      return next;
    }
    return cached;
  }
  bookVideoPosterStableCache.set(id, next);
  return next;
}

export function setBookVideoPosterStableCache(memoryId: string, uri: string): string {
  const id = memoryId.trim();
  const next = uri.trim();
  if (!id || !next) return peekBookVideoPosterStableCache(id) ?? '';
  bookVideoPosterStableCache.set(id, next);
  return next;
}

export function invalidateBookVideoPosterStableCache(memoryId: string): void {
  bookVideoPosterStableCache.delete(memoryId.trim());
}
