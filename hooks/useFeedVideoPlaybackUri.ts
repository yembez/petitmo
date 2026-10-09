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
 * URI de lecture vidéo dans le fil : copie fil si présente, sinon sandbox `original.*`.
 * Autoplay : ne retourne jamais une URL cloud — la résolution distante sert au viewer immersif.
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

    // Seed immédiat depuis le cache (dernière URI file:// résolue) → pas de fenêtre vide au remontage.
    const cached = getCachedFeedVideoPlaybackUri(memory.id);
    if (cached) setUri(prev => (prev ? prev : cached));

    const optimistic = optimisticFeedLocalVideoPlaybackUri(memory);
    if (optimistic) {
      setCachedFeedVideoPlaybackUri(memory.id, optimistic);
      setUri(prev => (prev ? prev : optimistic));
    }

    const sync = syncFeedLocalVideoPlaybackUri(memory);
    if (sync) {
      setCachedFeedVideoPlaybackUri(memory.id, sync);
      setUri(prev => (prev ? prev : sync));
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
          : optimistic || sync;
      if (localOnly) {
        setCachedFeedVideoPlaybackUri(memory.id, localOnly);
        // Idem : figer la 1ʳᵉ URI locale valide (résolution déjà vérifiée lisible sur disque).
        setUri(prev => (prev ? prev : localOnly));
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
