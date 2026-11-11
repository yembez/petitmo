import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import type { Memory } from '@/types/local';
import {
  getCachedFeedVideoPlaybackUri,
  setCachedFeedVideoPlaybackUri,
} from '@/hooks/feedVideoPlaybackUriCache';
import {
  getFeedLocalVideoPath,
  peekFeedBootstrapVideoUri,
  persistFeedLocalVideo,
  takeFeedBootstrapVideoUri,
} from '@/services/feedLocalPhotoCache';
import {
  isFeedLocalVideoPlaybackUri,
  normalizeVideoPlaybackUri,
  optimisticFeedLocalVideoPlaybackUri,
  resolveReadableVideoPlaybackUri,
  syncFeedLocalVideoPlaybackUri,
} from '@/utils/videoMediaUri';

/** Autoplay fil = local-first strict : aucune URL cloud (le viewer immersif gère le distant). */
async function noRemoteForFeedAutoplay(): Promise<string> {
  return '';
}

function seedUriForMemory(memory: Memory): string {
  if (memory.type !== 'video') return '';
  return (
    optimisticFeedLocalVideoPlaybackUri(memory) ||
    getCachedFeedVideoPlaybackUri(memory.id) ||
    ''
  );
}

/**
 * URI de lecture vidéo dans le fil : extrait (`local_media_path` / copie fil) en priorité,
 * rush sandbox en repli. Autoplay : jamais d’URL cloud (viewer immersif gère le distant).
 */
export function useFeedVideoPlaybackUri(
  memory: Memory,
  resolveEnabled = true,
): string {
  const slotKey = `${memory.type}:${memory.id}`;
  const [slot, setSlot] = useState(slotKey);
  const [uri, setUri] = useState(() => seedUriForMemory(memory));

  /**
   * Recycle FlatList : une photo ne doit jamais garder l’URI vidéo de la cellule précédente
   * (logs TF : `playUri:true` sur des rows `type:photo` → flash média au scroll-up).
   */
  if (slot !== slotKey) {
    setSlot(slotKey);
    setUri(seedUriForMemory(memory));
  }

  useEffect(() => {
    if (memory.type !== 'video') {
      setUri('');
      return;
    }

    const sync = syncFeedLocalVideoPlaybackUri(memory);
    const optimistic = optimisticFeedLocalVideoPlaybackUri(memory);
    const cached = getCachedFeedVideoPlaybackUri(memory.id);
    // Bootstrap / chemins SQLite courants avant le cache (sinon un trim reste collé au rush).
    const preferred = sync || optimistic || cached || '';
    if (preferred) {
      setCachedFeedVideoPlaybackUri(memory.id, preferred);
      setUri(preferred);
    }

    if (!resolveEnabled) return;

    let alive = true;
    void (async () => {
      const feedCopy =
        Platform.OS === 'web' ? null : ((await getFeedLocalVideoPath(memory.id))?.trim() ?? '');
      const boot = peekFeedBootstrapVideoUri(memory.id)?.trim() ?? '';

      const chosen = await resolveReadableVideoPlaybackUri(memory, {
        feedCopy,
        bootstrap: boot,
        resolveRemote: noRemoteForFeedAutoplay,
      });

      if (!alive) return;

      const localOnly =
        chosen && isFeedLocalVideoPlaybackUri(chosen)
          ? normalizeVideoPlaybackUri(chosen)
          : preferred;
      if (localOnly) {
        setCachedFeedVideoPlaybackUri(memory.id, localOnly);
        // URI vérifiée lisible : corrige un optimiste mort et applique l’extrait post-trim.
        setUri(localOnly);
      }

      if (chosen && boot) takeFeedBootstrapVideoUri(memory.id);

      if (
        Platform.OS !== 'web' &&
        !feedCopy &&
        localOnly &&
        memory.id &&
        localOnly.includes('petitmo_memories/')
      ) {
        const sourcePath = localOnly.replace(/^file:\/\//, '');
        void persistFeedLocalVideo(memory.id, sourcePath);
      }
    })();

    return () => {
      alive = false;
    };
  }, [
    memory.type,
    memory.id,
    memory.media_url,
    memory.edited_media_url,
    memory.local_media_path,
    memory.local_original_path,
    memory.updated_at,
    resolveEnabled,
  ]);

  return memory.type === 'video' ? uri : '';
}
