import { useSyncExternalStore } from 'react';

/** Autoplay vidéo inline fil — store externe pour ne pas re-render `FilScreen` / `renderItem`. */
let activeMemoryId: string | null = null;
const autoplayListeners = new Set<() => void>();

let scrollIdle = true;
const scrollIdleListeners = new Set<() => void>();

function emitAutoplay(): void {
  for (const l of autoplayListeners) l();
}

function emitScrollIdle(): void {
  for (const l of scrollIdleListeners) l();
}

export function getFeedAutoplayActiveMemoryId(): string | null {
  return activeMemoryId;
}

export function setFeedAutoplayActiveMemoryId(id: string | null): void {
  if (activeMemoryId === id) return;
  activeMemoryId = id;
  emitAutoplay();
}

export function subscribeFeedAutoplay(onStoreChange: () => void): () => void {
  autoplayListeners.add(onStoreChange);
  return () => autoplayListeners.delete(onStoreChange);
}

export function isFeedScrollIdle(): boolean {
  return scrollIdle;
}

export function setFeedScrollIdle(next: boolean): void {
  if (scrollIdle === next) return;
  scrollIdle = next;
  emitScrollIdle();
}

export function subscribeFeedScrollIdle(onStoreChange: () => void): () => void {
  scrollIdleListeners.add(onStoreChange);
  return () => scrollIdleListeners.delete(onStoreChange);
}

/** Une seule ligne vidéo re-render quand son statut autoplay change. */
export function useIsFeedVideoAutoplay(memoryId: string): boolean {
  return useSyncExternalStore(
    subscribeFeedAutoplay,
    () => getFeedAutoplayActiveMemoryId() === memoryId,
    () => false,
  );
}
