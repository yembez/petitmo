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
import { isAnyVideoKeepAlive } from '@/lib/videoPlayerPool';
import {
  buildOptimisticMemoryForPending,
  canRenderOptimisticPendingRow,
} from '@/utils/feedHelpers';

/** Backup après fin de scroll si la viewability n’a pas re-tiré (immédiat). */
const FEED_SCROLL_IDLE_MS = 0;

/** Arrêt lecture : sous ce % de la ligne visible, la vidéo n’est plus « à l’écran ». */
export const FEED_VIDEO_ON_SCREEN_VISIBLE_PCT = 50;

/** Déclenchement lecture : au moins ce % de la vignette visible. */
export const FEED_VIDEO_AUTOPLAY_START_VISIBLE_PCT = 50;

function memoryFromFeedListItem(item: ViewToken['item']): Memory | null {
  if (!item || typeof item !== 'object') return null;
  const it = item as FeedListItem;
  if (it.rowKind === 'memory') return it.memory;
  if (it.rowKind === 'pending') {
    if (it.row.committedMemory) return it.row.committedMemory;
    /** Pending vidéo (trim local) : éligible autoplay avant fin sandbox/upload. */
    if (canRenderOptimisticPendingRow(it.row)) {
      return buildOptimisticMemoryForPending(it.row, null);
    }
  }
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
 * Lecture / arrêt à ≥50 % de la ligne visible ; si plusieurs éligibles, la plus haute (index bas) gagne.
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
    /** Relais immersif : ne pas couper l’id autoplay, sinon le fil rembobine au retour. */
    if (isAnyVideoKeepAlive()) return;

    const current = getFeedAutoplayActiveMemoryId();
    const onScreen = onScreenVideoIdsRef.current;
    const eligible = eligibleVideosRef.current;

    if (current && !onScreen.has(current)) {
      setFeedAutoplayActiveMemoryId(null);
      if (!allowNewPick) return;
    }

    if (!allowNewPick) return;

    /** Toujours la plus haute éligible — évite qu’un bandeau du post précédent garde la lecture. */
    setFeedAutoplayActiveMemoryId(pickBestVideoId(eligible));
  }, []);

  const onOnScreenViewableChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      /**
       * Pendant l’immersif, FlatList renvoie souvent un snapshot vide.
       * Ne pas l’enregistrer : au retour, `reconcile` croirait la vidéo hors écran
       * → coupe l’autoplay → pause + rembobinage t=0.
       */
      if (isAnyVideoKeepAlive()) return;
      onScreenVideoIdsRef.current = collectVideoIdsFromViewable(info.viewableItems);
      setFeedOnScreenVideoIds(onScreenVideoIdsRef.current);
      reconcileAutoplay(false);
    },
    [reconcileAutoplay],
  );

  const onEligibleViewableChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      onPrefetchViewable(info);
      if (isAnyVideoKeepAlive()) return;
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
    if (isAnyVideoKeepAlive()) return;
    const eligible = collectEligibleVideos(lastEligibleViewableRef.current);
    /**
     * Au retour immersif, FlatList peut renvoyer un snapshot vide une frame :
     * ne pas effacer l’id encore valide, sinon lecture à t=0.
     */
    if (eligible.size === 0 && getFeedAutoplayActiveMemoryId()) return;
    eligibleVideosRef.current = eligible;
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
