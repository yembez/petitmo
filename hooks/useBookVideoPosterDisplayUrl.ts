import { useEffect, useState } from 'react';
import type { Memory } from '@/types/local';
import { awaitVideoPosterForBookMemory } from '@/services/memoryLocalStore';
import { getVideoPosterUriForBookPreview } from '@/utils/memoryPhotos';
import {
  peekSyncFeedVideoPosterDisplayUri,
  resolveFeedVideoPosterDisplayUri,
} from '@/utils/feedVideoPosterUri';

function stickyUri(prev: string, next: string): string {
  const n = next.trim();
  if (n) return n;
  return prev.trim();
}

/**
 * Poster vidéo pour la maquette livre — parité fil : fichier local lisible,
 * repli cloud signé, génération `poster.jpg` si absent.
 */
export function useBookVideoPosterDisplayUrl(memory: Memory): string {
  const [uri, setUri] = useState(() => {
    if (memory.type !== 'video') return '';
    const cached = peekSyncFeedVideoPosterDisplayUri(memory);
    if (cached) return cached;
    return getVideoPosterUriForBookPreview(memory).trim();
  });

  useEffect(() => {
    if (memory.type !== 'video') {
      setUri('');
      return;
    }

    const cached = peekSyncFeedVideoPosterDisplayUri(memory);
    if (cached) {
      setUri(prev => stickyUri(prev, cached));
      return;
    }

    let alive = true;
    void (async () => {
      let resolved = await resolveFeedVideoPosterDisplayUri(memory);
      if (!resolved.trim()) {
        const updated = await awaitVideoPosterForBookMemory(memory.id);
        if (updated) {
          resolved = await resolveFeedVideoPosterDisplayUri(updated);
        }
      }
      if (!alive || !resolved.trim()) return;
      setUri(prev => stickyUri(prev, resolved));
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
    memory.poster_print_url,
    memory.updated_at,
  ]);

  if (memory.type !== 'video') return '';
  const liveCached = peekSyncFeedVideoPosterDisplayUri(memory);
  return uri.trim() || (liveCached?.trim() ?? '');
}
