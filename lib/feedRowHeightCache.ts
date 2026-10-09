/** Hauteurs mesurées des lignes fil (clé = keyExtractor). */
const heights = new Map<string, number>();

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
