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
import { feedFlashLog } from '@/lib/feedFlashDebug';
import {
  buildOptimisticMemoryForPending,
  canRenderOptimisticPendingRow,
} from '@/utils/feedHelpers';

/** Backup après fin de scroll si la viewability n’a pas re-tiré (immédiat). */
const FEED_SCROLL_IDLE_MS = 0;

/**
 * Arrêt lecture : sous ce % de la **ligne** (header + média + légende), hors écran.
 * Doit rester **plus bas** que le seuil de démarrage (hystérésis) — sinon un léger
 * scroll coupe la lecture alors que la vignette est encore bien visible.
 */
export const FEED_VIDEO_ON_SCREEN_VISIBLE_PCT = 15;

/** Déclenchement lecture : au moins ce % de la ligne visible. */
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
 * Démarre ≥50 % visible ; continue jusqu’à <15 % (hystérésis). Si plusieurs éligibles,
 * la plus haute (index bas) gagne.
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
  const lastReconcileSigRef = useRef('');

  const clearScrollIdleTimer = useCallback(() => {
    if (scrollIdleTimerRef.current) {
      clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearScrollIdleTimer(), [clearScrollIdleTimer]);

  const suspendFeedInlineVideo = useCallback(() => {
    setFeedAutoplayActiveMemoryId(null, 'suspend');
  }, []);

  const reconcileAutoplay = useCallback((allowNewPick: boolean) => {
    /** Relais immersif : ne pas couper l’id autoplay, sinon le fil rembobine au retour. */
    if (isAnyVideoKeepAlive()) {
      return;
    }

    const current = getFeedAutoplayActiveMemoryId();
    const onScreen = onScreenVideoIdsRef.current;
    const eligible = eligibleVideosRef.current;
    const onScreenIds = [...onScreen].map(id => id.slice(0, 8)).join(',');
    const eligibleIds = [...eligible.entries()]
      .map(([id, idx]) => `${id.slice(0, 8)}@${idx}`)
      .join(',');

    const logReconcile = (
      reason: string,
      extra?: Record<string, string | number | boolean | null | undefined>,
    ) => {
      const sig = `${reason}|${current?.slice(0, 8) ?? ''}|${onScreenIds}|${eligibleIds}|${allowNewPick}`;
      /** Dedup hold/noPick spam ; toujours loguer offscreen / switch / pick. */
      const always =
        reason === 'offscreen→null' || reason === 'switch' || reason === 'pick';
      if (!always && sig === lastReconcileSigRef.current) return;
      lastReconcileSigRef.current = sig;
      feedFlashLog('autoplay.reconcile', {
        reason,
        allowNewPick,
        onScreen: onScreenIds,
        eligible: eligibleIds,
        ...extra,
      });
    };

    if (current && !onScreen.has(current)) {
      logReconcile('offscreen→null', { current: current.slice(0, 8) });
      setFeedAutoplayActiveMemoryId(null, 'offscreen');
      if (!allowNewPick) return;
    }

    if (!allowNewPick) {
      logReconcile('noPick', {
        current: current ? current.slice(0, 8) : null,
      });
      return;
    }

    const best = pickBestVideoId(eligible);

    /**
     * Hystérésis : si la vidéo active est encore « à l’écran » (≥15 %) mais sous le
     * seuil de démarrage (50 %), elle n’est plus dans `eligible`. Sans garde, on
     * remettait `null` et la lecture coupait au moindre scroll.
     * On ne bascule que si une autre vignette est clairement éligible (ex. scroll up).
     */
    if (current && onScreen.has(current)) {
      if (best && best !== current) {
        logReconcile('switch', {
          from: current.slice(0, 8),
          to: best.slice(0, 8),
        });
        setFeedAutoplayActiveMemoryId(best, 'switch');
      } else {
        logReconcile('hysteresis-hold', {
          current: current.slice(0, 8),
          best: best ? best.slice(0, 8) : null,
        });
      }
      return;
    }

    logReconcile('pick', { best: best ? best.slice(0, 8) : null });
    setFeedAutoplayActiveMemoryId(best, 'pick');
  }, []);

  const onOnScreenViewableChanged = useCallback(
    (info: { viewableItems: ViewToken[]; changed: ViewToken[] }) => {
      /**
       * Pendant l’immersif, FlatList renvoie souvent un snapshot vide.
       * Ne pas l’enregistrer : au retour, `reconcile` croirait la vidéo hors écran
       * → coupe l’autoplay → pause + rembobinage t=0.
       */
      if (isAnyVideoKeepAlive()) return;
      const next = collectVideoIdsFromViewable(info.viewableItems);
      const prevSig = [...onScreenVideoIdsRef.current].map(id => id.slice(0, 8)).sort().join(',');
      const nextSig = [...next].map(id => id.slice(0, 8)).sort().join(',');
      if (prevSig !== nextSig) {
        feedFlashLog('autoplay.viewable15', { from: prevSig, to: nextSig });
      }
      onScreenVideoIdsRef.current = next;
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
      const next = collectEligibleVideos(info.viewableItems);
      const prevSig = [...eligibleVideosRef.current.entries()]
        .map(([id, idx]) => `${id.slice(0, 8)}@${idx}`)
        .join(',');
      const nextSig = [...next.entries()]
        .map(([id, idx]) => `${id.slice(0, 8)}@${idx}`)
        .join(',');
      if (prevSig !== nextSig) {
        feedFlashLog('autoplay.viewable50', { from: prevSig, to: nextSig });
      }
      eligibleVideosRef.current = next;
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
    feedFlashLog('autoplay.scrollBegin', {
      active: getFeedAutoplayActiveMemoryId()?.slice(0, 8) ?? null,
    });
    setFeedScrollIdle(false);
    clearScrollIdleTimer();
  }, [clearScrollIdleTimer]);

  const onFeedScrollIdle = useCallback(() => {
    clearScrollIdleTimer();
    scrollIdleTimerRef.current = setTimeout(() => {
      scrollIdleTimerRef.current = null;
      feedFlashLog('autoplay.scrollIdle', {
        active: getFeedAutoplayActiveMemoryId()?.slice(0, 8) ?? null,
        eligible: [...eligibleVideosRef.current.keys()].map(id => id.slice(0, 8)).join(','),
        onScreen: [...onScreenVideoIdsRef.current].map(id => id.slice(0, 8)).join(','),
      });
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
