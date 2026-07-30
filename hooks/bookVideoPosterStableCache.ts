/** Poster vidéo livre stabilisé par souvenir (spread + éditeur, distinct du fil). */
const bookVideoPosterStableCache = new Map<string, string>();

function isPrintPosterUri(uri: string): boolean {
  return uri.includes('poster_print');
}

/** Remplace le cache si l’URI change, surtout vers / depuis un `poster_print` custom. */
function shouldReplaceCachedPoster(cached: string, next: string): boolean {
  if (!cached || !next) return true;
  if (cached === next) return false;
  // Jamais downgrade print custom → poster feed (t≈0).
  if (isPrintPosterUri(cached) && !isPrintPosterUri(next)) return false;
  // Bust cache (`?petitmo_v=` / `?t=`) ou nouveau fichier print → toujours prendre le live.
  if (isPrintPosterUri(next) || isPrintPosterUri(cached)) return true;
  const base = (u: string) => (u.split('?')[0] ?? u).trim();
  if (base(cached) === base(next) && cached !== next) return true;
  return base(cached) !== base(next);
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
