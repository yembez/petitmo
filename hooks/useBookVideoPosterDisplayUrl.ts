import { useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import type { Memory } from '@/types/local';
import { getLocalMemoryById } from '@/lib/localDb';
import {
  invalidateBookVideoPosterStableCache,
  peekBookVideoPosterStableCache,
  setBookVideoPosterStableCache,
} from '@/hooks/bookVideoPosterStableCache';
import {
  peekSyncBookVideoPosterDisplayUri,
  resolveBookVideoPosterDisplayUri,
} from '@/utils/bookVideoPosterUri';
import { bookPortraitPerfNetwork, bookPortraitPerfTiming, isBookPortraitPerfEnabled } from '@/utils/bookPortraitSpreadPerf';

/**
 * Poster vidéo maquette livre (spread + éditeur).
 * Re-résout à chaque changement de chemins / `updated_at` et sur `petitmo:memories-updated`
 * en relisant SQLite (les FlatList/mémo du spread gardent souvent une Memory stale).
 */
export function useBookVideoPosterDisplayUrl(memory: Memory): string {
  const [uri, setUri] = useState(() => peekSyncBookVideoPosterDisplayUri(memory));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (memory.type !== 'video') return;
    const sub = DeviceEventEmitter.addListener(
      'petitmo:memories-updated',
      (payload: { memoryId?: string }) => {
        if (payload?.memoryId === memory.id) {
          invalidateBookVideoPosterStableCache(memory.id);
          setTick(t => t + 1);
        }
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
    const startedAt = Date.now();
    if (isBookPortraitPerfEnabled()) {
      bookPortraitPerfNetwork('useBookVideoPoster:resolve-start', {
        memoryId: memory.id.slice(0, 8),
        tick,
      });
    }
    void (async () => {
      /** Toujours la ligne SQLite fraîche — props `memory` du spread peuvent être périmées. */
      const live = (getLocalMemoryById(memory.id) as Memory | null) ?? memory;
      const resolved = await resolveBookVideoPosterDisplayUri(live);
      if (isBookPortraitPerfEnabled()) {
        bookPortraitPerfTiming('useBookVideoPoster:resolve-done', startedAt, {
          memoryId: memory.id.slice(0, 8),
          hasUri: Boolean(resolved.trim()),
        });
      }
      if (!alive) return;
      const next = resolved.trim();
      if (next) {
        setBookVideoPosterStableCache(memory.id, next);
        setUri(next);
      } else {
        // Custom print : ne pas retomber sur peekSync feed stale — garder l’URI actuelle / live bustée.
        const sync = peekSyncBookVideoPosterDisplayUri(live).trim();
        if (sync) setUri(sync);
      }
    })();

    return () => {
      alive = false;
    };
  }, [
    memory.id,
    memory.type,
    memory.local_poster_print_path,
    memory.local_thumb_path,
    memory.poster_url,
    memory.poster_print_url,
    memory.thumbnail_url,
    memory.updated_at,
    tick,
  ]);

  if (memory.type !== 'video') return '';
  const live = uri.trim();
  if (live) return live;
  return peekBookVideoPosterStableCache(memory.id)?.trim() ?? '';
}
