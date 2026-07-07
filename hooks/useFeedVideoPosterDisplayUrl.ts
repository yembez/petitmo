import { useEffect, useState } from 'react';
import type { Memory } from '@/types/local';
import { peekFeedVideoPosterStableCache } from '@/hooks/feedVideoPosterStableCache';
import {
  peekSyncFeedVideoPosterDisplayUri,
  resolveFeedVideoPosterDisplayUri,
} from '@/utils/feedVideoPosterUri';

function stickyPosterUri(prev: string, next: string): string {
  const n = next.trim();
  if (n) return n;
  return prev.trim();
}

/**
 * Poster vidéo fil — résolu une fois par souvenir, jamais démonté au scroll.
 * Chemins sandbox morts (pré-Petitmo+) ignorés ; cache session stable.
 */
export function useFeedVideoPosterDisplayUrl(memory: Memory): string {
  const [uri, setUri] = useState(() => peekSyncFeedVideoPosterDisplayUri(memory));

  useEffect(() => {
    if (memory.type !== 'video') {
      setUri('');
      return;
    }

    const cached = peekFeedVideoPosterStableCache(memory.id);
    if (cached) {
      setUri(prev => stickyPosterUri(prev, cached));
      return;
    }

    let alive = true;
    void (async () => {
      const resolved = await resolveFeedVideoPosterDisplayUri(memory);
      if (!alive || !resolved.trim()) return;
      setUri(prev => stickyPosterUri(prev, resolved));
    })();

    return () => {
      alive = false;
    };
  }, [memory.id, memory.type]);

  if (memory.type !== 'video') return '';
  const cachedLive = peekFeedVideoPosterStableCache(memory.id);
  return uri.trim() || (cachedLive?.trim() ?? '');
}
