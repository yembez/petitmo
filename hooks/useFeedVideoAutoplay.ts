import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform } from 'react-native';
import type { ViewToken } from 'react-native';
import type { Memory } from '@/types/local';
import type { FeedListItem } from '@/components/feed/FilMemoryRow';
import {
  getFeedAutoplayActiveMemoryId,
  setFeedAutoplayActiveMemoryId,
  setFeedOnScreenVideoIds,
  setFeedScrollIdle,
} from '@/lib/feedAutoplayStore';
import { peekFeedBootstrapVideoUri } from '@/services/feedLocalPhotoCache';
import { videoPlaybackCandidateFromMemory } from '@/utils/videoMediaUri';
import { useStableViewabilityPairsMulti } from '@/hooks/useStableViewabilityPairs';

/** Backup après fin de scroll si la viewability n’a pas re-tiré (immédiat). */
const FEED_SCROLL_IDLE_MS = 0;

/** Présence à l’écran : arrêt lecture quand la vidéo sort complètement du viewport. */
export const FEED_VIDEO_ON_SCREEN_VISIBLE_PCT = 1;

/** Déclenchement lecture : au moins 25 % de la vignette visible. */
export const FEED_VIDEO_AUTOPLAY_START_VISIBLE_PCT = 25;

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

function collectVideoIdsFromViewable(viewableItems: ViewToken[]): Set<string> {
  const out = new Set<string>();
  for (const t of viewableItems) {
    if (!t.isViewable) continue;
    const m = memoryFromFeedListItem(t.item);
    if (m && hasLikelyPlayableVideoUri(m)) out.add(m.id);
  }
  return out;
}

function collectEligibleVideos(
  viewableItems: ViewToken[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of viewableItems) {
    if (!t.isViewable) continue;
    const m = memoryFromFeedListItem(t.item);
    if (!m || !hasLikelyPlayableVideoUri(m)) continue;
    const idx = typeof t.index === 'number' ? t.index : 999999;
    out.set(m.id, idx);
  }
  return out;
}

function pickBestVideoId(eligible: Map<string, number>): string | null {
  let bestId: string | null = null;
  let bestIdx = Number.POSITIVE_INFINITY;
  for (const [id, idx] of eligible) {
    if (idx < bestIdx) {
      bestIdx = idx;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Prefetch médias + sélection d’**une** vidéo « active » dans le fil (lecture auto muette).
 * Lecture à ≥25 % visible ; arrêt uniquement quand la vidéo n’est plus du tout à l’écran.
 */
export function useFeedVideoAutoplay(
  onPrefetchViewable: (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => void,
): {
  feedViewabilityPairs: ReturnType<typeof useStableViewabilityPairsMulti>;
  refreshFeedVideoAutoplay: () => void;
  suspendFeedInlineVideo: () => void;
  onFeedScrollBegin: () => void;
  onFeedScrollIdle: () => void;
} {
  const onScreenVideoIdsRef = useRef(new Set<string>());
  const eligibleVideosRef = useRef(new Map<string, number>());
  const lastEligibleViewableRef = useRef<ViewToken[]>([]);
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

  const reconcileAutoplay = useCallback((allowNewPick: boolean) => {
    const current = getFeedAutoplayActiveMemoryId();
    const onScreen = onScreenVideoIdsRef.current;
    const eligible = eligibleVideosRef.current;

    if (current && !onScreen.has(current)) {
      setFeedAutoplayActiveMemoryId(null);
      return;
    }

    if (current && eligible.has(current)) {
      return;
    }

    if (!allowNewPick) return;

    setFeedAutoplayActiveMemoryId(pickBestVideoId(eligible));
  }, []);

  const onOnScreenViewableChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      onScreenVideoIdsRef.current = collectVideoIdsFromViewable(info.viewableItems);
      setFeedOnScreenVideoIds(onScreenVideoIdsRef.current);
      reconcileAutoplay(false);
    },
    [reconcileAutoplay],
  );

  const onEligibleViewableChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      onPrefetchViewable(info);
      lastEligibleViewableRef.current = info.viewableItems;
      eligibleVideosRef.current = collectEligibleVideos(info.viewableItems);
      reconcileAutoplay(true);
    },
    [onPrefetchViewable, reconcileAutoplay],
  );

  const feedViewabilityPairs = useStableViewabilityPairsMulti(
    useMemo(
      () => [
        {
          viewabilityConfig: {
            itemVisiblePercentThreshold: FEED_VIDEO_ON_SCREEN_VISIBLE_PCT,
            minimumViewTime: 0,
            waitForInteraction: false,
          },
          onViewableItemsChanged: onOnScreenViewableChanged,
        },
        {
          viewabilityConfig: {
            itemVisiblePercentThreshold: FEED_VIDEO_AUTOPLAY_START_VISIBLE_PCT,
            minimumViewTime: 0,
            waitForInteraction: false,
          },
          onViewableItemsChanged: onEligibleViewableChanged,
        },
      ],
      [onEligibleViewableChanged, onOnScreenViewableChanged],
    ),
  );

  const refreshFeedVideoAutoplay = useCallback(() => {
    eligibleVideosRef.current = collectEligibleVideos(lastEligibleViewableRef.current);
    reconcileAutoplay(true);
  }, [reconcileAutoplay]);

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
    feedViewabilityPairs,
    refreshFeedVideoAutoplay,
    suspendFeedInlineVideo,
    onFeedScrollBegin,
    onFeedScrollIdle,
  };
}
