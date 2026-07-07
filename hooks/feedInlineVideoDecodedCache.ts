/** Souvenirs vidéo déjà décodés inline dans le fil — évite le fondu poster au re-scroll. */
const feedInlineVideoDecodedIds = new Set<string>();

export function markFeedInlineVideoDecoded(memoryId: string): void {
  const id = memoryId.trim();
  if (id) feedInlineVideoDecodedIds.add(id);
}

export function isFeedInlineVideoDecoded(memoryId: string): boolean {
  return feedInlineVideoDecodedIds.has(memoryId.trim());
}

export function clearFeedInlineVideoDecoded(memoryId: string): void {
  feedInlineVideoDecodedIds.delete(memoryId.trim());
}
