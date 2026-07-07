import { useSyncExternalStore } from 'react';

/** Souvenirs dont la ligne intersecte le viewport (FlatList viewability 0 %). */
let nearViewportMemoryIds = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

export function setFeedNearViewportMemoryIds(ids: Iterable<string>): void {
  const next = new Set(ids);
  if (sameIdSet(nearViewportMemoryIds, next)) return;
  nearViewportMemoryIds = next;
  emit();
}

export function isFeedMemoryNearViewport(memoryId: string): boolean {
  return nearViewportMemoryIds.has(memoryId.trim());
}

export function subscribeFeedNearViewport(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function useIsFeedMemoryNearViewport(memoryId: string): boolean {
  return useSyncExternalStore(
    subscribeFeedNearViewport,
    () => isFeedMemoryNearViewport(memoryId),
    () => false,
  );
}
