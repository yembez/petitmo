/** Évite les flashs photo au scroll : URLs stabilisées par slot souvenir. */
const feedPhotoStableCache = new Map<string, string>();

export function resolveFeedPhotoStableCache(slotKey: string, live: string): string {
  const key = slotKey.trim();
  const next = live.trim();
  if (!key) return next;
  if (!next) return feedPhotoStableCache.get(key)?.trim() ?? '';

  const cached = feedPhotoStableCache.get(key)?.trim() ?? '';
  if (cached && cached === next) return cached;
  if (cached && isDeviceLocal(cached) && !isDeviceLocal(next)) return cached;

  feedPhotoStableCache.set(key, next);
  return next;
}

function isDeviceLocal(u: string): boolean {
  const t = u.trim();
  if (!t || /^https?:\/\//i.test(t)) return false;
  return (
    t.startsWith('file:') ||
    t.startsWith('/') ||
    t.includes('petitmo_memories/') ||
    t.includes('petitmo_feed_local_thumbs/')
  );
}

export function invalidateFeedPhotoStableCache(memoryId: string): void {
  const prefix = `${memoryId.trim()}:`;
  for (const k of feedPhotoStableCache.keys()) {
    if (k.startsWith(prefix)) feedPhotoStableCache.delete(k);
  }
}
