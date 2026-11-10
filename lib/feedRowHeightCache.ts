/** Hauteurs mesurées des lignes fil (clé = keyExtractor). */
const heights = new Map<string, number>();
/** Invalide le cache si le ratio carte fil change (ex. 4/5 → carré). */
let aspectStamp: number | null = null;

export function setFeedRowMeasuredHeight(key: string, height: number): void {
  const k = key.trim();
  const h = Math.round(height);
  if (!k || h <= 0) return;
  if (heights.get(k) === h) return;
  heights.set(k, h);
}

export function getFeedRowMeasuredHeight(key: string): number | undefined {
  return heights.get(key.trim());
}

export function clearFeedRowHeightCache(): void {
  heights.clear();
}

/** À appeler avec `FEED_MEDIA_ASPECT_DEFAULT` — purge si le format carte a changé. */
export function syncFeedRowHeightCacheAspect(aspect: number): void {
  if (aspectStamp != null && aspectStamp === aspect) return;
  aspectStamp = aspect;
  heights.clear();
}
