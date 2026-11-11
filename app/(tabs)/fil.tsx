import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  InteractionManager,
  DeviceEventEmitter,
  useWindowDimensions,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { Plus } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { scale, verticalScale } from '@/utils/responsive';
import { estimateFeedRowHeight } from '@/utils/estimateFeedRowHeight';
import { getFeedRowMeasuredHeight, syncFeedRowHeightCacheAspect } from '@/lib/feedRowHeightCache';
import { FEED_MEDIA_ASPECT_DEFAULT } from '@/utils/feedMediaAspect';
import EditTextModal from '@/components/EditTextModal';
import { VideoTrimModal } from '@/components/VideoTrimModal';
import { FeedMediaPrepOverlay } from '@/components/FeedMediaPrepOverlay';
import { FREE_TIER_VIDEO_MAX_DURATION } from '@/lib/limits';
import { feedMemoryTextEditPreviewVariant } from '@/utils/memoryTextEditStyles';
import { bookLineBudgetForMemoryType, bookCharsPerLineForMemoryType } from '@/utils/textLimits';
import { useFeedVideoAutoplay } from '@/hooks/useFeedVideoAutoplay';
import { usePrefetchMemories } from '@/hooks/usePrefetchMemories';
import { usePendingMediaUploads } from '@/contexts/PendingMediaUploadsContext';
import { useFeedData } from '@/hooks/useFeedData';
import { useToggleFavorite } from '@/hooks/useToggleFavorite';
import { useFilFeedList } from '@/hooks/useFilFeedList';
import { useFeedMetaFonts } from '@/hooks/useFeedMetaFonts';
import { useFilRowActions } from '@/hooks/useFilRowActions';
import { styles } from '@/components/feed/feedStyles';
import { THEME } from '@/constants/theme';
import { emptyStateStyles } from '@/constants/emptyStateStyles';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { peekHasRealAuthAccount } from '@/lib/authAccount';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import {
  tabBarFloatingBottomInset,
  tabBarFloatingOverlapPad,
} from '@/constants/tabBarLayout';
import { FeedHeader } from '@/components/feed/FeedHeader';
import FeedFlashDebugBar from '@/components/feed/FeedFlashDebugBar';
import SettingsHeaderButton from '@/components/SettingsHeaderButton';
import type { FeedListItem } from '@/components/feed/FilMemoryRow';
import { peekSilentInitialFilLoadArmed } from '@/services/feedAfterImportFlags';
import { setMemoryViewerSession } from '@/services/memoryViewerSession';
import { claimVideoKeepAlive, isAnyVideoKeepAlive } from '@/lib/videoPlayerPool';
import {
  buildImmersiveViewerItems,
  immersiveViewerItemKey,
  resolveImmersiveViewerInitialIndex,
} from '@/utils/immersiveViewerItems';
import {
  isUsableSharedOrigin,
  type ImmersiveLaunchArgs,
} from '@/utils/immersiveSharedElement';
import {
  completeFeedImmersiveReturn,
  consumeFeedScrollIntent,
  PETITMO_FIL_APPLY_SCROLL_INTENT,
  type FeedScrollIntent,
} from '@/services/feedScrollRestore';
import {
  hasFeedImmersiveHost,
  measureFeedImmersiveHost,
} from '@/utils/feedImmersiveHostRegistry';
import { useFocusEffect } from '@react-navigation/native';
import { getTimingNudge, markNudgeSeen, recordInstallDate } from '@/lib/paywallTiming';
import SoftNudgeBanner from '@/components/SoftNudgeBanner';
import type { Child, Memory } from '@/types/local';
import {
  buildOptimisticMemoryForPending,
  canRenderOptimisticPendingRow,
} from '@/utils/feedHelpers';
import TabSceneTransition from '@/components/TabSceneTransition';
import TabScreenErrorBoundary from '@/components/TabScreenErrorBoundary';
import { useTabBlankWatchdog } from '@/hooks/useTabBlankWatchdog';
import { recordAction, recordWarn } from '@/lib/diagnosticTrail';
import { FeedLoadingDots } from '@/components/FeedLoadingDots';

function logImmersiveSnap(phase: string, detail: Record<string, unknown>): void {
  if (__DEV__) {
    console.warn(`[fil.immersiveSnap] ${phase}`, detail);
  }
  recordAction(`fil.immersiveSnap.${phase}`, detail);
}

function FilScreen() {
  const router = useRouter();
  const { t } = useAppTranslation('common');
  const { pending: pendingUploads } = usePendingMediaUploads();
  const insets = useSafeAreaInsets();
  const { width: screenW } = useWindowDimensions();
  /** Carré vs 4/5 : anciennes hauteurs mesurées faussaient le snap immersif. */
  syncFeedRowHeightCacheAspect(FEED_MEDIA_ASPECT_DEFAULT);
  /** Nudge abo Fil uniquement — pas de bannière rappel ici (sheet Modal OK sur Capturer). */
  const [paywallNudge, setPaywallNudge] = useState<'DAY_30' | 'DAY_60' | null>(null);
  const listRef = useRef<FlatList<FeedListItem> | null>(null);
  const feedScrollOffsetRef = useRef(0);
  /** Après delete : re-pin cet offset (évite le saut FlatList). */
  const pendingPinOffsetRef = useRef<number | null>(null);
  const pendingScrollIntentRef = useRef<FeedScrollIntent | null>(null);
  const [feedListOpacity, setFeedListOpacity] = useState(1);
  /**
   * MVC pendant le scroll uniquement (logs TF : y 9545→9450 au mount/unmount vidéo).
   * Au repos : off — sinon delete / re-mesure → saut en bas (bug Fabric).
   */
  const [mvcWhileScrolling, setMvcWhileScrolling] = useState(false);
  const mvcScrollOffTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (mvcScrollOffTimerRef.current) clearTimeout(mvcScrollOffTimerRef.current);
    },
    [],
  );
  /** Hauteur réelle header glass (overlay) — padding liste + viewOffset snap. */
  const [feedHeaderHeight, setFeedHeaderHeight] = useState(0);
  const feedHeaderHeightRef = useRef(0);
  /** Empêche `onContentSizeChange` de révéler le fil au milieu d’un snap immersif. */
  const immersiveSnapInFlightRef = useRef(false);
  const immersiveRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    memories,
    setMemories,
    child,
    familyChildren,
    isLoading,
    isRefreshing,
    onRefresh,
    memoryFlatListKeyByIdRef,
  } = useFeedData(pendingUploads);

  const getFeedScrollOffset = useCallback(() => feedScrollOffsetRef.current, []);
  const pinFeedScrollOffset = useCallback((y: number) => {
    const next = Math.max(0, y);
    pendingPinOffsetRef.current = next;
    feedScrollOffsetRef.current = next;
    listRef.current?.scrollToOffset({ offset: next, animated: false });
  }, []);

  const {
    swipeRefs,
    editModalVisible,
    editingMemory,
    editLocationModalVisible,
    editingLocationMemory,
    uploadingVoiceCoverId,
    videoTrimTarget,
    videoTrimUri,
    videoTrimDurationSec,
    videoTrimMaxSec,
    videoTrimFreeTier,
    videoTrimInitialRange,
    videoTrimExporting,
    handleEditMemory,
    handleSaveEdit,
    handleEditLocation,
    handleSaveLocation,
    handleEditVideoTrim,
    handleConfirmVideoTrim,
    closeVideoTrimModal,
    handlePickVoiceCover,
    handleDeleteMemory,
    closeEditModal,
    closeEditLocationModal,
  } = useFilRowActions(setMemories, {
    getScrollOffset: getFeedScrollOffset,
    pinScrollOffset: pinFeedScrollOffset,
  });

  const { onViewableItemsChanged: onPrefetchViewable } = usePrefetchMemories();
  const {
    feedViewabilityPairs,
    refreshFeedVideoAutoplay,
    suspendFeedInlineVideo,
    onFeedScrollBegin,
    onFeedScrollIdle,
  } = useFeedVideoAutoplay(onPrefetchViewable);
  const onFeedHeaderChildPress = useCallback(
    (target: Child) => {
      router.push(`/edit-child?childId=${target.id}`);
    },
    [router],
  );
  const immersiveLaunchRef = useRef<(args: ImmersiveLaunchArgs) => void>(() => {});
  immersiveLaunchRef.current = ({
    memoryId,
    albumPhotoIndex = 0,
    origin,
    uri,
    cornerRadius = 0,
  }: ImmersiveLaunchArgs) => {
    let sessionMemories: Memory[] = memories;
    let memoryIndex = memories.findIndex(m => m.id === memoryId);

    /**
     * Vidéo encore en pending (`pending_*`) : pas encore dans `memories`.
     * On injecte le souvenir optimiste / committed pour ouvrir l’immersif tout de suite.
     */
    if (memoryIndex < 0) {
      const pending = pendingUploads.find(
        p =>
          p.tempId === memoryId ||
          p.committedMemory?.id === memoryId,
      );
      if (!pending || pending.kind !== 'video') return;
      const pendingMem =
        pending.committedMemory ??
        (canRenderOptimisticPendingRow(pending)
          ? buildOptimisticMemoryForPending(pending, child)
          : null);
      if (!pendingMem) return;
      if (pending.committedMemory) {
        memoryIndex = memories.findIndex(m => m.id === pending.committedMemory!.id);
        if (memoryIndex < 0) {
          sessionMemories = [pendingMem, ...memories];
          memoryIndex = 0;
        }
      } else {
        sessionMemories = [pendingMem, ...memories];
        memoryIndex = 0;
      }
    }

    /**
     * Photo / texte : on coupe l’autoplay. Vidéo : le même lecteur passe au viewer,
     * donc on ne le suspend pas — on le revendique.
     */
    const openedMemory = sessionMemories[memoryIndex];
    if (openedMemory?.type === 'video') {
      claimVideoKeepAlive(openedMemory.id);
    } else {
      suspendFeedInlineVideo();
    }
    const flatIdx = resolveImmersiveViewerInitialIndex(
      sessionMemories,
      memoryIndex,
      albumPhotoIndex,
    );
    const opened = buildImmersiveViewerItems(sessionMemories)[flatIdx];
    const sharedUri = uri?.trim() ?? '';
    setMemoryViewerSession({
      memories: sessionMemories,
      initialIndex: memoryIndex,
      initialAlbumPhotoIndex: albumPhotoIndex,
      familyChildren,
      sharedElement:
        isUsableSharedOrigin(origin) && sharedUri
          ? {
              origin,
              uri: sharedUri,
              openedItemKey: opened ? immersiveViewerItemKey(opened) : '',
              cornerRadius,
            }
          : null,
    });
    router.push({
      pathname: '/memory-viewer',
      params: { initialIndex: String(memoryIndex) },
    });
  };
  const toggleFavorite = useToggleFavorite(setMemories);
  const {
    feedDateFontFamily,
    feedAgeFontFamily,
    feedLocationFilledFontFamily,
    feedLocationPlaceholderFontFamily,
  } = useFeedMetaFonts();

  const renderFilListCellStyle = useMemo(
    () => ({ overflow: 'visible' as const }),
    [],
  );

  const { feedData, renderItem } = useFilFeedList(
    memories,
    setMemories,
    child,
    familyChildren,
    feedDateFontFamily,
    feedAgeFontFamily,
    feedLocationFilledFontFamily,
    feedLocationPlaceholderFontFamily,
    pendingUploads,
    uploadingVoiceCoverId,
    toggleFavorite,
    handleEditMemory,
    handleEditVideoTrim,
    handleEditLocation,
    handlePickVoiceCover,
    handleDeleteMemory,
    swipeRefs,
    immersiveLaunchRef,
  );

  const listBottomPad = useMemo(
    () => verticalScale(28) + tabBarFloatingOverlapPad(insets.bottom),
    [insets.bottom],
  );
  /** Estimé avant onLayout — évite un jump à l’ouverture. */
  const feedHeaderPadFallback =
    insets.top + verticalScale(6) + verticalScale(52) + verticalScale(8);
  const feedHeaderPad =
    feedHeaderHeight > 0 ? feedHeaderHeight : feedHeaderPadFallback;
  const listContentContainerStyle = useMemo(
    () => [
      styles.scrollContent,
      { paddingTop: feedHeaderPad, paddingBottom: listBottomPad },
    ],
    [feedHeaderPad, listBottomPad],
  );
  const onFeedHeaderLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      const h = Math.round(e.nativeEvent.layout.height);
      if (h <= 0 || h === feedHeaderHeightRef.current) return;
      feedHeaderHeightRef.current = h;
      setFeedHeaderHeight(h);
    },
    [],
  );
  const onFeedScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number } } }) => {
      /**
       * Toujours suivre l’offset réel — y compris pendant le snap immersif.
       * Sinon la correction `cardTop` partait d’un targetY « théorique » et
       * laissait le post trop bas (logs : delta 200–400 px).
       */
      feedScrollOffsetRef.current = e.nativeEvent.contentOffset.y;
    },
    [],
  );

  const onFeedScrollActive = useCallback(() => {
    if (mvcScrollOffTimerRef.current) {
      clearTimeout(mvcScrollOffTimerRef.current);
      mvcScrollOffTimerRef.current = null;
    }
    setMvcWhileScrolling(true);
    onFeedScrollBegin();
  }, [onFeedScrollBegin]);

  const onFeedScrollStopped = useCallback(() => {
    onFeedScrollIdle();
    if (mvcScrollOffTimerRef.current) clearTimeout(mvcScrollOffTimerRef.current);
    /** Laisser le fling / les mounts batch se stabiliser avant de couper MVC. */
    mvcScrollOffTimerRef.current = setTimeout(() => {
      mvcScrollOffTimerRef.current = null;
      setMvcWhileScrolling(false);
    }, 400);
  }, [onFeedScrollIdle]);

  const keyExtractor = useCallback(
    (item: FeedListItem) =>
      item.rowKind === 'pending'
        ? item.row.tempId
        : item.rowKind === 'batchSlot'
          ? `${item.parentTempId}:slot:${item.slotIndex}`
          : memoryFlatListKeyByIdRef.current.get(item.memory.id) ?? item.memory.id,
    [memoryFlatListKeyByIdRef],
  );

  const rowLengthAt = useCallback(
    (item: FeedListItem, index: number): number => {
      const measureKey =
        item.rowKind === 'memory'
          ? item.memory.id
          : item.rowKind === 'pending' && item.row.committedMemory
            ? item.row.committedMemory.id
            : keyExtractor(item);
      return getFeedRowMeasuredHeight(measureKey) ?? estimateFeedRowHeight(item, screenW, index);
    },
    [keyExtractor, screenW],
  );

  /**
   * Hauteurs connues (mesure onLayout) ou estimées — évite le spike contentSize
   * ~+100 px à chaque mount (logs TF scroll down vitesse moyenne).
   */
  const getItemLayout = useCallback(
    (data: ArrayLike<FeedListItem> | null | undefined, index: number) => {
      const items = data ?? feedData;
      if (!items || index < 0 || index >= items.length) {
        return { length: 0, offset: 0, index };
      }
      let offset = 0;
      for (let i = 0; i < index; i++) {
        offset += rowLengthAt(items[i] as FeedListItem, i);
      }
      return { length: rowLengthAt(items[index] as FeedListItem, index), offset, index };
    },
    [feedData, rowLengthAt],
  );

  const applyPendingFeedScrollIntent = useCallback((opts?: { reveal?: boolean }) => {
    const intent = pendingScrollIntentRef.current;
    if (!intent || !listRef.current || feedData.length === 0) return false;
    const reveal = opts?.reveal !== false;

    if (intent.type === 'snapToKey') {
      const key = intent.key;
      const animated = intent.animated === true;
      const index = feedData.findIndex(item =>
        item.rowKind === 'pending'
          ? item.row.tempId === key || item.row.committedMemory?.id === key
          : item.rowKind === 'batchSlot'
            ? item.parentTempId === key
            : item.memory.id === key ||
              memoryFlatListKeyByIdRef.current.get(item.memory.id) === key,
      );
      if (index >= 0) {
        /**
         * `scrollToIndex` ne met pas toujours à jour `onScroll` → sync l’offset cible.
         * `paddingTop` = header : `viewOffset: 0`. Correction fine ensuite via mesure host.
         */
        const headerPad = feedHeaderHeightRef.current;
        try {
          const layout = getItemLayout(feedData as ArrayLike<FeedListItem>, index);
          const measured = getFeedRowMeasuredHeight(key);
          const targetY = Math.max(0, layout.offset);
          logImmersiveSnap('scrollToOffset', {
            key: key.slice(0, 36),
            index,
            layoutOffset: Math.round(layout.offset),
            layoutLen: Math.round(layout.length),
            measuredH: measured != null ? Math.round(measured) : null,
            headerPad: Math.round(headerPad),
            targetY: Math.round(targetY),
            animated,
          });
          /** `scrollToOffset` plus fiable que `scrollToIndex` (hauteurs variables). */
          listRef.current.scrollToOffset({ offset: targetY, animated });
        } catch (e) {
          logImmersiveSnap('scrollToOffset_fail', {
            key: key.slice(0, 36),
            index,
            err: e instanceof Error ? e.message : String(e),
          });
          listRef.current.scrollToOffset({ offset: 0, animated });
          feedScrollOffsetRef.current = 0;
        }
      } else if (!animated) {
        logImmersiveSnap('key_not_found_top', {
          key: key.slice(0, 36),
          feedLen: feedData.length,
        });
        listRef.current.scrollToOffset({ offset: 0, animated: false });
        feedScrollOffsetRef.current = 0;
      }
      /**
       * Immersif : on garde l’intent pour les retries layout (`reveal: false`),
       * sinon le 2ᵉ rAF ne retrouve plus la cible.
       */
      if (reveal) {
        pendingScrollIntentRef.current = null;
        setFeedListOpacity(1);
      }
      return true;
    }

    const offsetY = intent.type === 'restore' ? intent.offsetY : 0;
    listRef.current.scrollToOffset({ offset: offsetY, animated: false });
    feedScrollOffsetRef.current = offsetY;
    pendingScrollIntentRef.current = null;
    if (reveal) setFeedListOpacity(1);
    return true;
  }, [feedData, getItemLayout, memoryFlatListKeyByIdRef]);

  /**
   * Retour immersif : alignement convergé sous le modal (fil **reste opaque** —
   * le backdrop masque ; opacity 0 = flash crème). Un seul scroll théorique,
   * puis uniquement `alignPass` (plus de rejoue qui se bat avec le pin).
   */
  const applyImmersiveSnapHidden = useCallback(() => {
    immersiveSnapInFlightRef.current = true;
    if (immersiveRevealTimerRef.current) {
      clearTimeout(immersiveRevealTimerRef.current);
      immersiveRevealTimerRef.current = null;
    }
    /** Ne pas masquer le fil : le transparentModal + backdrop couvrent le scroll. */
    setFeedListOpacity(1);

    const intentAtStart = pendingScrollIntentRef.current;
    const scrollKey =
      intentAtStart?.type === 'snapToKey' ? intentAtStart.key.trim() : '';
    const measureKey =
      intentAtStart?.type === 'snapToKey'
        ? (intentAtStart.measureKey?.trim() || scrollKey)
        : '';

    /** Un seul scroll théorique — puis on clear l’intent pour couper les rejoues. */
    applyPendingFeedScrollIntent({ reveal: false });
    pendingScrollIntentRef.current = null;

    let hostWait = 0;
    const ALIGN_EPS = 2;
    const MAX_ALIGN_PASSES = 10;
    const MAX_HOST_WAIT = 16;
    /** Air entre bas du header glass et haut du post. */
    const REVEAL_GAP = verticalScale(8);

    const finishReveal = (
      pinY: number,
      hostReady: boolean,
      extra?: Record<string, unknown>,
      /** Vignette déjà mesurée à la dernière passe settled — évite une 2ᵉ mesure stale. */
      premeasured?: Parameters<typeof completeFeedImmersiveReturn>[0],
    ) => {
      pendingPinOffsetRef.current = pinY;
      feedScrollOffsetRef.current = pinY;
      listRef.current?.scrollToOffset({ offset: pinY, animated: false });

      const emitReady = (shared: Parameters<typeof completeFeedImmersiveReturn>[0]) => {
        logImmersiveSnap('reveal', {
          snapKey: scrollKey.slice(0, 36),
          measureKey: measureKey.slice(0, 36),
          hostReady,
          pinY: Math.round(pinY),
          scrollY: Math.round(feedScrollOffsetRef.current),
          sharedOk: !!shared,
          ...extra,
        });
        if (!hostReady && hostWait >= MAX_HOST_WAIT) {
          recordWarn('fil.immersiveReveal.host_timeout', {
            snapKey: scrollKey.slice(0, 36),
            pinY: Math.round(pinY),
          });
        }
        completeFeedImmersiveReturn(shared);
        immersiveSnapInFlightRef.current = false;
        immersiveRevealTimerRef.current = null;
        setTimeout(() => {
          if (pendingPinOffsetRef.current === pinY) {
            pendingPinOffsetRef.current = null;
          }
        }, 480);
      };

      if (premeasured) {
        emitReady(premeasured);
        return;
      }
      if (!measureKey) {
        emitReady(null);
        return;
      }
      measureFeedImmersiveHost(measureKey, shared => {
        emitReady(shared);
      });
    };

    const scheduleAfterLayout = (fn: () => void) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(fn);
      });
    };

    const alignPass = (
      pass: number,
      lastDelta: number | null,
      oscCount: number,
    ) => {
      const desiredTop = feedHeaderHeightRef.current + REVEAL_GAP;
      const hostKey = measureKey || scrollKey;
      measureFeedImmersiveHost(hostKey, shared => {
        const scrollY = feedScrollOffsetRef.current;
        if (!shared || !isUsableSharedOrigin(shared.origin)) {
          if (pass < MAX_ALIGN_PASSES) {
            immersiveRevealTimerRef.current = setTimeout(
              () => alignPass(pass + 1, lastDelta, oscCount),
              32,
            );
            return;
          }
          finishReveal(scrollY, true, { measured: false, passes: pass });
          return;
        }

        const cardTop = shared.origin.y;
        const delta = cardTop - desiredTop;
        const settled = Math.abs(delta) <= ALIGN_EPS;
        const oscillating =
          lastDelta != null &&
          Math.sign(lastDelta) !== 0 &&
          Math.sign(delta) !== 0 &&
          Math.sign(lastDelta) !== Math.sign(delta) &&
          Math.abs(delta) > ALIGN_EPS;

        if (settled) {
          finishReveal(
            scrollY,
            true,
            {
              cardTop: Math.round(cardTop),
              delta: Math.round(delta),
              desiredTop: Math.round(desiredTop),
              gap: Math.round(REVEAL_GAP),
              passes: pass + 1,
              settled: true,
            },
            shared,
          );
          return;
        }

        if (pass >= MAX_ALIGN_PASSES) {
          const pinY = Math.max(0, scrollY + delta);
          listRef.current?.scrollToOffset({ offset: pinY, animated: false });
          feedScrollOffsetRef.current = pinY;
          /** Dernière correction : re-mesurer après un frame pour le spring. */
          scheduleAfterLayout(() => {
            measureFeedImmersiveHost(hostKey, finalShared => {
              finishReveal(
                feedScrollOffsetRef.current,
                true,
                {
                  cardTop: Math.round(cardTop),
                  delta: Math.round(delta),
                  desiredTop: Math.round(desiredTop),
                  gap: Math.round(REVEAL_GAP),
                  passes: pass + 1,
                  settled: false,
                },
                finalShared,
              );
            });
          });
          return;
        }

        const nextOsc = oscillating ? oscCount + 1 : 0;
        const apply = nextOsc >= 2 ? delta * 0.55 : delta;
        const pinY = Math.max(0, scrollY + apply);
        pendingPinOffsetRef.current = pinY;
        listRef.current?.scrollToOffset({ offset: pinY, animated: false });
        feedScrollOffsetRef.current = pinY;
        logImmersiveSnap('align', {
          snapKey: scrollKey.slice(0, 36),
          pass: pass + 1,
          cardTop: Math.round(cardTop),
          delta: Math.round(delta),
          pinY: Math.round(pinY),
          scrollYBefore: Math.round(scrollY),
          desiredTop: Math.round(desiredTop),
          oscillating: !!oscillating,
          oscCount: nextOsc,
        });
        const next = () => alignPass(pass + 1, delta, nextOsc);
        if (oscillating) {
          immersiveRevealTimerRef.current = setTimeout(next, 48);
        } else {
          scheduleAfterLayout(next);
        }
      });
    };

    const waitHostThenAlign = () => {
      hostWait += 1;
      if (!scrollKey) {
        finishReveal(feedScrollOffsetRef.current, true);
        return;
      }
      const hostReady =
        hasFeedImmersiveHost(measureKey || scrollKey) ||
        hasFeedImmersiveHost(scrollKey);

      if (hostReady || hostWait >= MAX_HOST_WAIT) {
        scheduleAfterLayout(() => alignPass(0, null, 0));
        return;
      }
      immersiveRevealTimerRef.current = setTimeout(waitHostThenAlign, 40);
    };

    scheduleAfterLayout(waitHostThenAlign);
  }, [applyPendingFeedScrollIntent]);

  const onFeedContentSizeChange = useCallback(() => {
    const pinY = pendingPinOffsetRef.current;
    if (pinY != null) {
      listRef.current?.scrollToOffset({ offset: pinY, animated: false });
      feedScrollOffsetRef.current = pinY;
      // Laisser un frame pour le layout FlatList, puis relâcher le pin.
      requestAnimationFrame(() => {
        if (pendingPinOffsetRef.current !== pinY) return;
        listRef.current?.scrollToOffset({ offset: pinY, animated: false });
        pendingPinOffsetRef.current = null;
      });
      return;
    }
    /**
     * Pendant snap immersif : intent déjà consommé ; ne jamais rejouer le
     * scroll théorique (logs : targetY écrasait pinY → flash / mauvais calage).
     */
    if (immersiveSnapInFlightRef.current) return;
    if (pendingScrollIntentRef.current) {
      applyPendingFeedScrollIntent({ reveal: true });
    }
  }, [applyPendingFeedScrollIntent]);

  /**
   * Refs stables : `useFocusEffect` rejoue cleanup+setup dès que le callback
   * change d’identité. `applyPendingFeedScrollIntent` dépend de `feedData` →
   * chaque patch / mount voisin suspendait l’autoplay (flash noir / replay).
   * Logs TF 2speek : `active→null` avec `onScreen:true`, sans reconcile.
   */
  const applyPendingFeedScrollIntentRef = useRef(applyPendingFeedScrollIntent);
  applyPendingFeedScrollIntentRef.current = applyPendingFeedScrollIntent;
  const applyImmersiveSnapHiddenRef = useRef(applyImmersiveSnapHidden);
  applyImmersiveSnapHiddenRef.current = applyImmersiveSnapHidden;
  const refreshFeedVideoAutoplayRef = useRef(refreshFeedVideoAutoplay);
  refreshFeedVideoAutoplayRef.current = refreshFeedVideoAutoplay;
  const suspendFeedInlineVideoRef = useRef(suspendFeedInlineVideo);
  suspendFeedInlineVideoRef.current = suspendFeedInlineVideo;

  useFocusEffect(
    useCallback(() => {
      const intent = consumeFeedScrollIntent();
      let scrollTask: { cancel: () => void } | undefined;
      if (intent) {
        pendingScrollIntentRef.current = intent;
        const immersiveJump =
          intent.type === 'snapToKey' && intent.animated !== true;
        if (immersiveJump) {
          applyImmersiveSnapHiddenRef.current();
        } else {
          const softScroll =
            intent.type === 'snapToKey' && intent.animated === true;
          if (!softScroll) {
            setFeedListOpacity(0);
          }
          scrollTask = InteractionManager.runAfterInteractions(() => {
            applyPendingFeedScrollIntentRef.current();
          });
        }
      }

      const viewabilityFrame = requestAnimationFrame(() => {
        listRef.current?.recordInteraction?.();
        refreshFeedVideoAutoplayRef.current();
      });

      void recordInstallDate();
      void getTimingNudge().then(nudge => {
        if (!nudge) return;
        void markNudgeSeen();
        if (nudge === 'DAY_90') {
          router.push({ pathname: '/paywall', params: { context: nudge } });
          return;
        }
        if (nudge === 'DAY_30' || nudge === 'DAY_60') {
          setPaywallNudge(nudge);
        }
      });

      return () => {
        cancelAnimationFrame(viewabilityFrame);
        scrollTask?.cancel();
        /**
         * Quitter l’onglet avec opacity 0 (intent annulé / race InteractionManager)
         * = fil blanc au retour + parfois composite blanc sous les autres onglets.
         */
        if (immersiveRevealTimerRef.current) {
          clearTimeout(immersiveRevealTimerRef.current);
          immersiveRevealTimerRef.current = null;
        }
        immersiveSnapInFlightRef.current = false;
        pendingScrollIntentRef.current = null;
        setFeedListOpacity(1);
        /** Relais immersif : le lecteur doit continuer, pas s’arrêter au blur du fil. */
        if (!isAnyVideoKeepAlive()) suspendFeedInlineVideoRef.current();
      };
    }, [router]),
  );

  /**
   * Immersif = transparentModal : le fil reste focused → pas de re-entrée useFocusEffect.
   * On applique l’intent dès qu’il est armé (retour viewer / import).
   *
   * Retour immersif (`snapToKey` non animé) : scroll + align sous le modal (fil opaque),
   * puis callback viewer pour le spring dézoom.
   */
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(PETITMO_FIL_APPLY_SCROLL_INTENT, () => {
      const intent = consumeFeedScrollIntent();
      if (!intent) return;
      pendingScrollIntentRef.current = intent;
      const immersiveJump =
        intent.type === 'snapToKey' && intent.animated !== true;
      if (immersiveJump) {
        applyImmersiveSnapHidden();
        return;
      }
      const softScroll = intent.type === 'snapToKey' && intent.animated === true;
      if (!softScroll) {
        setFeedListOpacity(0);
      }
      InteractionManager.runAfterInteractions(() => {
        applyPendingFeedScrollIntent();
      });
    });
    return () => sub.remove();
  }, [applyPendingFeedScrollIntent, applyImmersiveSnapHidden]);

  useEffect(() => {
    if (feedListOpacity !== 0) return;
    const fallback = setTimeout(() => {
      const wasImmersive = immersiveSnapInFlightRef.current;
      pendingScrollIntentRef.current = null;
      immersiveSnapInFlightRef.current = false;
      setFeedListOpacity(1);
      recordWarn(
        'fil.opacity.forceReveal',
        wasImmersive ? 'immersive_timeout' : 'scroll_intent_timeout',
      );
    }, immersiveSnapInFlightRef.current ? 900 : 500);
    return () => clearTimeout(fallback);
  }, [feedListOpacity]);

  const filPaintBlank =
    feedListOpacity < 0.05 ||
    (isLoading && pendingUploads.length === 0 && !peekSilentInitialFilLoadArmed()) ||
    (familyChildren.length === 0 && pendingUploads.length === 0 && !peekHasRealAuthAccount());
  const filPaintReason =
    feedListOpacity < 0.05
      ? 'opacity0'
      : isLoading && pendingUploads.length === 0 && !peekSilentInitialFilLoadArmed()
        ? 'loading'
        : familyChildren.length === 0 && !peekHasRealAuthAccount()
          ? 'no_auth_blank'
          : familyChildren.length === 0
            ? 'no_child'
            : 'ok';
  useTabBlankWatchdog('fil', {
    blank: filPaintBlank && filPaintReason !== 'ok',
    reason: filPaintBlank ? filPaintReason : 'ok',
    detail: `op=${feedListOpacity}`,
  });

  /** Import / replace vers le fil déjà actif : le focus ne repasse pas, on consomme l’intent au changement de données. */
  useEffect(() => {
    if (pendingPinOffsetRef.current != null) return;
    /** Snap immersif en cours : ne pas rejouer le scroll théorique. */
    if (immersiveSnapInFlightRef.current) return;
    if (pendingScrollIntentRef.current) {
      applyPendingFeedScrollIntent();
      return;
    }
    const intent = consumeFeedScrollIntent();
    if (!intent) return;
    pendingScrollIntentRef.current = intent;
    const immersiveJump =
      intent.type === 'snapToKey' && intent.animated !== true;
    if (immersiveJump) {
      applyImmersiveSnapHidden();
      return;
    }
    setFeedListOpacity(0);
    applyPendingFeedScrollIntent();
  }, [feedData.length, pendingUploads.length, applyPendingFeedScrollIntent, applyImmersiveSnapHidden]);

  /** Pas d’écran plein pendant l’import : pending, flag « retour import », ou 1er rendu avant consume. */
  if (isLoading && pendingUploads.length === 0 && !peekSilentInitialFilLoadArmed()) {
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={THEME.brandCtaOrange} />
      </View>
    );
  }

  if (familyChildren.length === 0 && pendingUploads.length === 0) {
    // Déconnecté / ghost : jamais « Créer un profil » — dots le temps que la gate kick.
    if (!peekHasRealAuthAccount()) {
      return (
        <View style={[styles.container, styles.centered]}>
          <StatusBar style="dark" />
          <FeedLoadingDots color={THEME.textPrimary} />
        </View>
      );
    }
    return (
      <View style={[styles.container, styles.centered]}>
        <StatusBar style="dark" />
        <View
          style={{
            position: 'absolute',
            top: insets.top + verticalScale(6),
            right: scale(20),
            zIndex: 2,
          }}
        >
          <SettingsHeaderButton />
        </View>
        <Text style={styles.emptyText}>Aucun enfant trouvé</Text>
        <PetitmoPrimaryPressable
          style={styles.createButton}
          onPress={() => router.push('/create-child')}
        >
          <Text style={[petitmoCtaStyles.primaryText, styles.createButtonText]}>Créer un profil</Text>
        </PetitmoPrimaryPressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={[styles.feedViewport, { opacity: feedListOpacity }]}>
        <Animated.FlatList<FeedListItem>
          ref={listRef}
          data={feedData}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          CellRendererComponentStyle={renderFilListCellStyle}
          /** Pas de `itemLayoutAnimation` : anime les sauts de hauteur (aspect) pendant le scroll. */
          viewabilityConfigCallbackPairs={feedViewabilityPairs}
          onScroll={onFeedScroll}
          onScrollBeginDrag={onFeedScrollActive}
          onMomentumScrollBegin={onFeedScrollActive}
          onScrollEndDrag={onFeedScrollStopped}
          onMomentumScrollEnd={onFeedScrollStopped}
          scrollEventThrottle={16}
          onContentSizeChange={(_w, _h) => {
            onFeedContentSizeChange();
          }}
          onScrollToIndexFailed={info => {
            /**
             * Hauteurs variables : l’approx averageItemLength est fausse.
             * Pendant un snap immersif → approx légère puis retry scrollToIndex
             * (évite d’atterrir / mesurer la mauvaise carte).
             */
            const approx = Math.max(0, info.averageItemLength * info.index);
            listRef.current?.scrollToOffset({ offset: approx, animated: false });
            if (immersiveSnapInFlightRef.current && pendingScrollIntentRef.current) {
              setTimeout(() => {
                try {
                  listRef.current?.scrollToIndex({
                    index: info.index,
                    animated: false,
                    viewPosition: 0,
                    viewOffset: 0,
                  });
                } catch {
                  /* ignore */
                }
                applyPendingFeedScrollIntent({ reveal: false });
              }, 72);
              return;
            }
          }}
          bounces
          alwaysBounceVertical
          overScrollMode="auto"
          style={styles.scrollView}
          contentContainerStyle={listContentContainerStyle}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={THEME.brandCtaOrange} />
          }
          ListEmptyComponent={
            feedData.length === 0 ? (
              <View style={[emptyStateStyles.container, { minHeight: verticalScale(420) }]}>
                <TouchableOpacity
                  style={emptyStateStyles.iconDisc}
                  activeOpacity={0.85}
                  onPress={() => router.navigate('/(tabs)')}
                  accessibilityRole="button"
                  accessibilityLabel={t('fil.empty.addA11y')}
                >
                  <Plus
                    size={scale(36)}
                    color={THEME.captureCtaBorderColor}
                    fill="none"
                    strokeWidth={2}
                  />
                </TouchableOpacity>
                <Text style={emptyStateStyles.title}>{t('fil.empty.title')}</Text>
                <Text style={emptyStateStyles.subtitle}>{t('fil.empty.subtitle')}</Text>
              </View>
            ) : null
          }
          removeClippedSubviews={false}
          /**
           * MVC : uploads (prepend) + pendant le scroll (anti-saut mount/unmount hauteurs variables).
           * Au repos strict : off — sinon delete / re-mesure → saut en bas (bug Fabric).
           */
          maintainVisibleContentPosition={
            pendingUploads.length > 0 || mvcWhileScrolling
              ? {
                  minIndexForVisible: 0,
                  ...(pendingUploads.length > 0
                    ? { autoscrollToTopThreshold: Math.round(verticalScale(80)) }
                    : {}),
                }
              : undefined
          }
          initialNumToRender={8}
          /**
           * Fenêtre un peu plus large : logs TF montraient unmount/remount photo en rafale
           * au scroll-up (flash « écran à images ») avec windowSize=7 / batch=2.
           */
          maxToRenderPerBatch={4}
          updateCellsBatchingPeriod={50}
          windowSize={13}
        />
      </View>
      <View style={styles.headerShell} onLayout={onFeedHeaderLayout} pointerEvents="box-none">
        <FeedHeader
          familyChildren={familyChildren}
          paddingTop={insets.top + verticalScale(6)}
          onPressChild={onFeedHeaderChildPress}
        />
      </View>
      {paywallNudge ? (
        <SoftNudgeBanner
          bottom={tabBarFloatingBottomInset(insets.bottom) + verticalScale(10)}
          body={
            paywallNudge === 'DAY_30'
              ? t('fil.nudge.paywallDay30')
              : t('fil.nudge.paywallDay60')
          }
          cta={t('fil.nudge.paywallCta')}
          closeA11y={t('fil.nudge.closeA11y')}
          onClose={() => {
            void markNudgeSeen();
            setPaywallNudge(null);
          }}
          onPress={() => {
            const context = paywallNudge;
            setPaywallNudge(null);
            router.push({ pathname: '/paywall', params: { context } });
          }}
        />
      ) : null}
      <EditTextModal
        key={editingMemory?.id ?? 'edit-caption-modal-closed'}
        visible={editModalVisible}
        initialText={editingMemory?.content?.trim() ?? ''}
        previewVariant={feedMemoryTextEditPreviewVariant(editingMemory?.type)}
        bookLineBudget={bookLineBudgetForMemoryType(editingMemory?.type)}
        bookCharsPerLine={bookCharsPerLineForMemoryType(editingMemory?.type)}
        title={
          !editingMemory
            ? 'Modifier le texte'
            : editingMemory.content?.trim()
              ? 'Modifier l’annotation'
              : 'Annoter'
        }
        onClose={closeEditModal}
        onSave={handleSaveEdit}
      />
      <EditTextModal
        key={editingLocationMemory?.id ?? 'edit-location-modal-closed'}
        visible={editLocationModalVisible}
        initialText={editingLocationMemory?.location?.trim() ?? ''}
        title="Modifier le lieu"
        onClose={closeEditLocationModal}
        onSave={handleSaveLocation}
      />
      <VideoTrimModal
        visible={videoTrimTarget != null && !videoTrimExporting}
        videoUri={videoTrimUri}
        durationSec={videoTrimDurationSec}
        maxDurationSec={videoTrimMaxSec || FREE_TIER_VIDEO_MAX_DURATION}
        isFreeTier={videoTrimFreeTier}
        initialTrim={videoTrimInitialRange}
        onCancel={closeVideoTrimModal}
        onConfirm={handleConfirmVideoTrim}
        onUpgrade={
          videoTrimFreeTier
            ? () => {
                closeVideoTrimModal();
                router.push({ pathname: '/paywall', params: { context: 'GENERAL' } });
              }
            : undefined
        }
      />
      {videoTrimExporting ? (
        <FeedMediaPrepOverlay label={t('videoTrim.exporting')} />
      ) : null}
      <FeedFlashDebugBar />
    </View>
  );
}

export default function FilScreenTab() {
  return (
    <TabScreenErrorBoundary tab="fil">
      <TabSceneTransition>
        <FilScreen />
      </TabSceneTransition>
    </TabScreenErrorBoundary>
  );
}
