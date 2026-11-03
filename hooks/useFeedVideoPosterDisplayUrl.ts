import { useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import type { Memory } from '@/types/local';
import { getLocalMemoryById } from '@/lib/localDb';
import {
  invalidateFeedVideoPosterStableCache,
  peekFeedVideoPosterStableCache,
  setFeedVideoPosterStableCache,
} from '@/hooks/feedVideoPosterStableCache';
import {
  peekSyncFeedVideoPosterDisplayUri,
  resolveFeedVideoPosterDisplayUri,
} from '@/utils/feedVideoPosterUri';
import { feedFlashLog, feedFlashUriKind } from '@/lib/feedFlashDebug';

/**
 * Poster vidéo fil / Favoris — JPEG déjà présent uniquement.
 * Pas d’extraction de frame (conflit décodeur / expo-video).
 *
 * Aligné sur `useBookVideoPosterDisplayUrl` : re-résoudre quand SQLite gagne
 * `local_thumb_path` / `poster_url` (restore 1ʳᵉ session), sinon Favoris reste gris
 * et le fil garde un chemin sandbox mort sous un fond noir.
 */
export function useFeedVideoPosterDisplayUrl(memory: Memory): string {
  const slotKey = `${memory.type}:${memory.id}`;
  const [slot, setSlot] = useState(slotKey);
  const [uri, setUri] = useState(() =>
    memory.type === 'video' ? peekSyncFeedVideoPosterDisplayUri(memory) : '',
  );
  const [tick, setTick] = useState(0);

  /** Recycle FlatList : ne pas coller le poster de la vidéo précédente sur une photo. */
  if (slot !== slotKey) {
    setSlot(slotKey);
    setUri(memory.type === 'video' ? peekSyncFeedVideoPosterDisplayUri(memory) : '');
  }

  useEffect(() => {
    if (memory.type !== 'video') return;
    const sub = DeviceEventEmitter.addListener(
      'petitmo:memories-updated',
      (payload: { memoryId?: string }) => {
        if (payload?.memoryId !== memory.id) return;
        /** Invalider le cache sticky : la materialisation vient d’écrire un JPEG lisible. */
        invalidateFeedVideoPosterStableCache(memory.id);
        setTick(t => t + 1);
      },
    );
    return () => sub.remove();
  }, [memory.id, memory.type]);

  useEffect(() => {
    if (memory.type !== 'video') {
      setUri('');
      return;
    }

    let alive = true;
    void (async () => {
      const live = (getLocalMemoryById(memory.id) as Memory | null) ?? memory;
      const resolved = await resolveFeedVideoPosterDisplayUri(live);
      if (!alive) return;
      feedFlashLog('restore.posterHook', {
        id: memory.id.slice(0, 8),
        via: 'resolve',
        ok: !!resolved.trim(),
        kind: feedFlashUriKind(resolved),
        localThumb: !!live.local_thumb_path?.trim(),
        posterUrl: !!live.poster_url?.trim(),
        tick,
      });
      const next = resolved.trim();
      if (next) {
        setFeedVideoPosterStableCache(memory.id, next);
        setUri(next);
        return;
      }
      /** Pas de sticky sur une URI morte : si resolve échoue, retomber sur sync HTTPS only. */
      const sync = peekSyncFeedVideoPosterDisplayUri(live).trim();
      setUri(sync);
    })();

    return () => {
      alive = false;
    };
  }, [
    memory.id,
    memory.type,
    memory.local_thumb_path,
    memory.poster_url,
    memory.thumbnail_url,
    memory.updated_at,
    tick,
  ]);

  if (memory.type !== 'video') return '';
  const live = uri.trim();
  if (live) return live;
  return peekFeedVideoPosterStableCache(memory.id)?.trim() ?? '';
}
