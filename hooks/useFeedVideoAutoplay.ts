import { useCallback, useState } from 'react';
import { Platform } from 'react-native';
import type { ViewToken } from 'react-native';
import type { Memory } from '@/types/local';
import type { FeedListItem } from '@/components/feed/FilMemoryRow';
import { peekFeedBootstrapVideoUri } from '@/services/feedLocalPhotoCache';

function memoryFromFeedListItem(item: ViewToken['item']): Memory | null {
  if (!item || typeof item !== 'object') return null;
  const it = item as FeedListItem;
  if (it.rowKind === 'memory') return it.memory;
  if (it.rowKind === 'pending' && it.row.committedMemory) return it.row.committedMemory;
  return null;
}

/** Suffisant pour choisir une ligne « autoplay » sans attendre la résolution async des URLs signées. */
function hasLikelyPlayableVideoUri(m: Memory): boolean {
  if (m.type !== 'video') return false;
  const raw = (m.edited_media_url?.trim() || m.media_url?.trim() || '').trim();
  if (raw) return true;
  if (Platform.OS === 'web') return false;
  return !!peekFeedBootstrapVideoUri(m.id)?.trim();
}

/**
 * Combine le prefetch médias avec la sélection d’**une** vidéo « active » dans le fil (lecture auto muette, type Instagram).
 */
export function useFeedVideoAutoplay(
  onPrefetchViewable: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void
): {
  feedAutoplayMemoryId: string | null;
  onViewableItemsChanged: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void;
  /** Arrête la lecture inline (ex. avant `memory-viewer`) pour éviter deux pistes vidéo. */
  suspendFeedInlineVideo: () => void;
} {
  const [feedAutoplayMemoryId, setFeedAutoplayMemoryId] = useState<string | null>(null);

  const suspendFeedInlineVideo = useCallback(() => {
    setFeedAutoplayMemoryId(null);
  }, []);

  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      onPrefetchViewable(info);

      let bestId: string | null = null;
      let bestIdx = Number.POSITIVE_INFINITY;
      for (const t of info.viewableItems) {
        if (!t.isViewable) continue;
        const m = memoryFromFeedListItem(t.item);
        if (!m || !hasLikelyPlayableVideoUri(m)) continue;
        const idx = typeof t.index === 'number' ? t.index : 999999;
        if (idx < bestIdx) {
          bestIdx = idx;
          bestId = m.id;
        }
      }

      setFeedAutoplayMemoryId(prev => (prev === bestId ? prev : bestId));
    },
    [onPrefetchViewable]
  );

  return { feedAutoplayMemoryId, onViewableItemsChanged, suspendFeedInlineVideo };
}
