import { useSyncExternalStore } from 'react';
import { getLocalMemoryById } from '@/lib/localDb';
import { bookQrUrlForToken } from '@/lib/publicMediaBaseUrl';

type Listener = () => void;

/** Tokens résolus en mémoire (complète le cache SQLite pour éviter des lectures répétées). */
const tokenByMemoryId = new Map<string, string>();
const listenersByMemoryId = new Map<string, Set<Listener>>();

export function readBookQrTokenFromLocal(memoryId: string): string {
  const fromMap = tokenByMemoryId.get(memoryId)?.trim();
  if (fromMap) return fromMap;
  return (getLocalMemoryById(memoryId)?.public_media_token ?? '').trim();
}

export function bookQrPreviewUrl(memoryId: string | undefined): string {
  if (!memoryId) return '';
  const token = readBookQrTokenFromLocal(memoryId);
  return token ? bookQrUrlForToken(token) : '';
}

/** Met à jour le store et notifie uniquement les souvenirs concernés. */
export function primeBookQrTokens(tokens: Record<string, string>): string[] {
  const changedIds: string[] = [];
  for (const [memoryId, token] of Object.entries(tokens)) {
    const t = token.trim();
    if (!t) continue;
    if (tokenByMemoryId.get(memoryId) === t) continue;
    tokenByMemoryId.set(memoryId, t);
    changedIds.push(memoryId);
  }
  for (const id of changedIds) {
    const set = listenersByMemoryId.get(id);
    if (!set) continue;
    for (const listener of set) listener();
  }
  return changedIds;
}

export function subscribeBookQrToken(memoryId: string, listener: Listener): () => void {
  let set = listenersByMemoryId.get(memoryId);
  if (!set) {
    set = new Set();
    listenersByMemoryId.set(memoryId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listenersByMemoryId.delete(memoryId);
  };
}

/** URL QR pour un souvenir — re-render ciblé quand son token arrive. */
export function useBookQrUrl(memoryId: string | undefined): string {
  return useSyncExternalStore(
    onStoreChange => {
      if (!memoryId) return () => {};
      return subscribeBookQrToken(memoryId, onStoreChange);
    },
    () => bookQrPreviewUrl(memoryId),
    () => bookQrPreviewUrl(memoryId),
  );
}
