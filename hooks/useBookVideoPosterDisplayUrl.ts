import { useEffect, useState } from 'react';
import type { Memory } from '@/types/local';
import { peekBookVideoPosterStableCache } from '@/hooks/bookVideoPosterStableCache';
import {
  peekSyncBookVideoPosterDisplayUri,
  resolveBookVideoPosterDisplayUri,
} from '@/utils/bookVideoPosterUri';
import { bookPortraitPerfNetwork, bookPortraitPerfTiming, isBookPortraitPerfEnabled } from '@/utils/bookPortraitSpreadPerf';

function stickyPosterUri(prev: string, next: string): string {
  const n = next.trim();
  if (n) return n;
  return prev.trim();
}

/**
 * Poster vidéo maquette livre (spread + éditeur).
 * Custom `poster_print` si lisible, sinon poster fil ; chemins morts ignorés.
 */
export function useBookVideoPosterDisplayUrl(memory: Memory): string {
  const [uri, setUri] = useState(() => peekSyncBookVideoPosterDisplayUri(memory));

  useEffect(() => {
    if (memory.type !== 'video') {
      setUri('');
      return;
    }

    const cached = peekBookVideoPosterStableCache(memory.id);
    if (cached) {
      setUri(prev => stickyPosterUri(prev, cached));
      return;
    }

    let alive = true;
    const startedAt = Date.now();
    if (isBookPortraitPerfEnabled()) {
      bookPortraitPerfNetwork('useBookVideoPoster:resolve-start', {
        memoryId: memory.id.slice(0, 8),
      });
    }
    void (async () => {
      const resolved = await resolveBookVideoPosterDisplayUri(memory);
      if (isBookPortraitPerfEnabled()) {
        bookPortraitPerfTiming('useBookVideoPoster:resolve-done', startedAt, {
          memoryId: memory.id.slice(0, 8),
          hasUri: Boolean(resolved.trim()),
        });
      }
      if (!alive || !resolved.trim()) return;
      setUri(prev => stickyPosterUri(prev, resolved));
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
  ]);

  if (memory.type !== 'video') return '';
  const cachedLive = peekBookVideoPosterStableCache(memory.id);
  return uri.trim() || (cachedLive?.trim() ?? '');
}
