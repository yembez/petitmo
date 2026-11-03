import { useSyncExternalStore } from 'react';

/** Autoplay vidéo inline fil — store externe pour ne pas re-render `FilScreen` / `renderItem`. */
let activeMemoryId: string | null = null;
const autoplayListeners = new Set<() => void>();

/** Vidéos encore visibles à l’écran (seuil fil — sous ce % → arrêt lecture). */
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
  /* scroll-idle consommé via `isFeedScrollIdle()` (pas de re-render global). */
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

export function setFeedAutoplayActiveMemoryId(
  id: string | null,
  via?: string,
): void {
  if (activeMemoryId === id) return;
  const prev = activeMemoryId;
  activeMemoryId = id;
  try {
    const { feedFlashLog } = require('@/lib/feedFlashDebug') as typeof import('@/lib/feedFlashDebug');
    feedFlashLog('autoplay.active', {
      from: prev ? prev.slice(0, 8) : null,
      to: id ? id.slice(0, 8) : null,
      via: via ?? null,
    });
  } catch {
    /* ignore */
  }
  try {
    const { recordWarn } = require('@/lib/diagnosticTrail') as typeof import('@/lib/diagnosticTrail');
    recordWarn('feed.video.autoplay', `${(prev ?? '∅').slice(0, 8)}→${(id ?? '∅').slice(0, 8)}`);
  } catch {
    /* ignore */
  }
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

function subscribeAutoplayNoop(): () => void {
  return () => {};
}

/** Une seule ligne vidéo re-render quand son statut autoplay change. */
export function useIsFeedVideoAutoplay(memoryId: string | null | undefined): boolean {
  const id = memoryId?.trim() ?? '';
  return useSyncExternalStore(
    id ? subscribeFeedAutoplay : subscribeAutoplayNoop,
    () => (id ? getFeedAutoplayActiveMemoryId() === id : false),
    () => false,
  );
}

/** `null` / vide : pas d’abonnement (évite re-render de toutes les rows photo/texte). */
export function useIsFeedVideoOnScreen(memoryId: string | null | undefined): boolean {
  const id = memoryId?.trim() ?? '';
  return useSyncExternalStore(
    id ? subscribeFeedOnScreenVideos : subscribeAutoplayNoop,
    () => (id ? isFeedVideoOnScreen(id) : false),
    () => false,
  );
}
