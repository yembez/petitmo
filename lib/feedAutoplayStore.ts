import { useSyncExternalStore } from 'react';

/** Autoplay vidéo inline fil — store externe pour ne pas re-render `FilScreen` / `renderItem`. */
let activeMemoryId: string | null = null;
const autoplayListeners = new Set<() => void>();

/** Vidéos encore visibles à l’écran (seuil 0 % — sortie = arrêt). */
let onScreenVideoIds = new Set<string>();
const onScreenListeners = new Set<() => void>();

let scrollIdle = true;

function emitAutoplay(): void {
  for (const l of autoplayListeners) l();
}

function emitOnScreen(): void {
  for (const l of onScreenListeners) l();
}

function emitScrollIdle(): void {
  // Réservé si on branche un hook scroll-idle global ; noop pour l’instant.
}

function sameIdSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

export function getFeedAutoplayActiveMemoryId(): string | null {
  return activeMemoryId;
}

export function setFeedAutoplayActiveMemoryId(id: string | null): void {
  if (activeMemoryId === id) return;
  activeMemoryId = id;
  emitAutoplay();
}

export function isFeedScrollIdle(): boolean {
  return scrollIdle;
}

export function setFeedScrollIdle(idle: boolean): void {
  if (scrollIdle === idle) return;
  scrollIdle = idle;
  emitScrollIdle();
}

export function setFeedOnScreenVideoIds(ids: Iterable<string>): void {
  const next = new Set(ids);
  if (sameIdSet(onScreenVideoIds, next)) return;
  onScreenVideoIds = next;
  emitOnScreen();
}

export function isFeedVideoOnScreen(memoryId: string): boolean {
  return onScreenVideoIds.has(memoryId.trim());
}

export function subscribeFeedAutoplay(onStoreChange: () => void): () => void {
  autoplayListeners.add(onStoreChange);
  return () => autoplayListeners.delete(onStoreChange);
}

export function subscribeFeedOnScreenVideos(onStoreChange: () => void): () => void {
  onScreenListeners.add(onStoreChange);
  return () => onScreenListeners.delete(onStoreChange);
}

/** Une seule ligne vidéo re-render quand son statut autoplay change. */
export function useIsFeedVideoAutoplay(memoryId: string): boolean {
  return useSyncExternalStore(
    subscribeFeedAutoplay,
    () => getFeedAutoplayActiveMemoryId() === memoryId,
    () => false,
  );
}

export function useIsFeedVideoOnScreen(memoryId: string): boolean {
  return useSyncExternalStore(
    subscribeFeedOnScreenVideos,
    () => isFeedVideoOnScreen(memoryId),
    () => false,
  );
}
