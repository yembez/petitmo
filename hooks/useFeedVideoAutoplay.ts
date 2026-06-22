import { useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { ViewToken } from 'react-native';
import type { Memory } from '@/types/local';
import type { FeedListItem } from '@/components/feed/FilMemoryRow';
import {
  getFeedAutoplayActiveMemoryId,
  isFeedScrollIdle,
  setFeedAutoplayActiveMemoryId,
  setFeedScrollIdle,
} from '@/lib/feedAutoplayStore';
import { peekFeedBootstrapVideoUri } from '@/services/feedLocalPhotoCache';
import { videoPlaybackCandidateFromMemory } from '@/utils/videoMediaUri';

/** Délai après l’arrêt du scroll avant autoplay (évite montage vidéo pendant l’inertie). */
const FEED_SCROLL_IDLE_MS = 220;

function memoryFromFeedListItem(item: ViewToken['item']): Memory | null {
  if (!item || typeof item !== 'object') return null;
  const it = item as FeedListItem;
  if (it.rowKind === 'memory') return it.memory;
  if (it.rowKind === 'pending' && it.row.committedMemory) return it.row.committedMemory;
  return null;
}

function hasLikelyPlayableVideoUri(m: Memory): boolean {
  if (m.type !== 'video') return false;
  if (videoPlaybackCandidateFromMemory(m)) return true;
  if (Platform.OS === 'web') return false;
  return !!peekFeedBootstrapVideoUri(m.id)?.trim();
}

/**
 * Prefetch médias + sélection d’**une** vidéo « active » dans le fil (lecture auto muette).
 * L’état autoplay vit dans `feedAutoplayStore` — pas de re-render de la liste entière.
 */
export function useFeedVideoAutoplay(
  onPrefetchViewable: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void,
): {
  onViewableItemsChanged: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void;
  refreshFeedVideoAutoplay: () => void;
  suspendFeedInlineVideo: () => void;
  onFeedScrollBegin: () => void;
  onFeedScrollIdle: () => void;
} {
  const lastViewableRef = useRef<ViewToken[]>([]);
  const scrollIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearScrollIdleTimer = useCallback(() => {
    if (scrollIdleTimerRef.current) {
      clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearScrollIdleTimer(), [clearScrollIdleTimer]);

  const suspendFeedInlineVideo = useCallback(() => {
    setFeedAutoplayActiveMemoryId(null);
  }, []);

  const applyViewableItems = useCallback((viewableItems: ViewToken[]) => {
    let bestId: string | null = null;
    let bestIdx = Number.POSITIVE_INFINITY;
    for (const t of viewableItems) {
      if (!t.isViewable) continue;
      const m = memoryFromFeedListItem(t.item);
      if (!m || !hasLikelyPlayableVideoUri(m)) continue;
      const idx = typeof t.index === 'number' ? t.index : 999999;
      if (idx < bestIdx) {
        bestIdx = idx;
        bestId = m.id;
      }
    }
    setFeedAutoplayActiveMemoryId(bestId);
  }, []);

  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      onPrefetchViewable(info);
      lastViewableRef.current = info.viewableItems;
      if (!isFeedScrollIdle()) return;
      applyViewableItems(info.viewableItems);
    },
    [onPrefetchViewable, applyViewableItems],
  );

  const refreshFeedVideoAutoplay = useCallback(() => {
    if (lastViewableRef.current.length > 0) {
      applyViewableItems(lastViewableRef.current);
      return;
    }
    if (getFeedAutoplayActiveMemoryId() !== null) {
      setFeedAutoplayActiveMemoryId(null);
    }
  }, [applyViewableItems]);

  const onFeedScrollBegin = useCallback(() => {
    setFeedScrollIdle(false);
    clearScrollIdleTimer();
  }, [clearScrollIdleTimer]);

  const onFeedScrollIdle = useCallback(() => {
    clearScrollIdleTimer();
    scrollIdleTimerRef.current = setTimeout(() => {
      scrollIdleTimerRef.current = null;
      setFeedScrollIdle(true);
      refreshFeedVideoAutoplay();
    }, FEED_SCROLL_IDLE_MS);
  }, [clearScrollIdleTimer, refreshFeedVideoAutoplay]);

  return {
    onViewableItemsChanged,
    refreshFeedVideoAutoplay,
    suspendFeedInlineVideo,
    onFeedScrollBegin,
    onFeedScrollIdle,
  };
}
