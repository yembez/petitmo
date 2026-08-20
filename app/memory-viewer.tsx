import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  PanResponder,
  Animated,
  useWindowDimensions,
  type ViewToken,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { ChevronDown, ChevronUp, Volume2, VolumeX, X } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import {
  clearMemoryViewerSession,
  peekMemoryViewerSession,
} from '@/services/memoryViewerSession';
import { safeRouterBack } from '@/utils/safeRouterBack';
import type { Memory, Child } from '@/types/local';
import { listLocalChildren } from '@/lib/localDb';
import { getChildren } from '@/services/children';
import {
  getPrimaryPhotoUriForImmersiveViewer,
  getAlbumCanonicalFavoriteUrls,
  isPhotoUrlFavoritedWithVariants,
  parseFavoritePhotoUrls,
} from '@/utils/memoryPhotos';
import { toggleFavoritePhotoUrl } from '@/services/media';
import { extractMediaBucketPath } from '@/lib/mediaSignedUrl';
import { formatDateLong, formatDuration } from '@/utils/date';
import { formatFamilyAgesLine, sortChildrenByBirthdateAsc } from '@/utils/childrenAge';
import { useFeedMetaFonts } from '@/hooks/useFeedMetaFonts';
import { useFeedVideoPlaybackUri } from '@/hooks/useFeedVideoPlaybackUri';
import { useExpoAvShouldPlay } from '@/hooks/useExpoAvShouldPlay';
import { getVideoPosterUriForFeedAndViewer, getVoiceCoverUriForFeedAndViewer, normalizeMemoryMediaUriForDisplay } from '@/utils/memoryPhotos';
import { normalizeVideoPlaybackUri } from '@/utils/videoMediaUri';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { ensurePlaybackAudioForListening } from '@/lib/playbackAudioMode';
import AudioPlayer from '@/components/AudioPlayer';
import EditTextModal from '@/components/EditTextModal';
import { feedMemoryTextEditPreviewVariant } from '@/utils/memoryTextEditStyles';
import { bookLineBudgetForMemoryType, bookCharsPerLineForMemoryType } from '@/utils/textLimits';
import { updateMemoryContent } from '@/services/media';
import { useToggleFavorite } from '@/hooks/useToggleFavorite';
import {
  FeedAgeOverlay,
  FeedPhotoFavoriteOverlay,
} from '@/components/feed/FeedMediaOverlays';
import { ScrollableTextBlock } from '@/components/ScrollableTextBlock';
import { IMMERSIVE_CAPTION_SCROLL_MAX_H } from '@/constants/feedLayout';
import { THEME } from '@/constants/theme';
import {
  MemoryTextFontProvider,
  useMemoryEditorialBoldFont,
  useMemoryEditorialFont,
} from '@/contexts/MemoryTextFontContext';
import { styles as feedStyles } from '@/components/feed/feedStyles';
import {
  buildImmersiveViewerItems,
  immersiveViewerItemKey,
  memoryFromImmersiveViewerItem,
  resolveImmersiveViewerInitialIndex,
  type ImmersiveViewerItem,
} from '@/utils/immersiveViewerItems';
import { useStableViewabilityPairs } from '@/hooks/useStableViewabilityPairs';

const BG = THEME.bg;
/** Même pastille que `overlayBadge` du fil (date de prise bas-gauche). */
const CHROME_PILL_BG = 'rgba(0, 0, 0, 0.38)';
const TOP_CHROME_TEXT = '#FFFFFF';
/** Dégradé haut du viewer sur photo / vidéo / vocal (cover). */
const IMMERSIVE_TOP_BLACK_FADE = [
  'rgba(0, 0, 0, 0.55)',
  'rgba(0, 0, 0, 0.22)',
  'rgba(0, 0, 0, 0)',
] as const;
const EM_QUAD = '\u2003';
/** Marges latérales « page de livre » — zone de swipe entre posts texte. */
const TEXT_IMMERSIVE_MARGIN_W = scale(48);
const TEXT_MARGIN_SWIPE_DY = verticalScale(40);
/** Relevé bas des pastilles âge / cœur dans le viewer immersif (safe area + marge). */
function immersiveOverlayBottomInset(safeBottom: number): number {
  return safeBottom + verticalScale(10);
}

function immersiveTopFadeHeight(pageHeight: number): number {
  return Math.max(verticalScale(96), Math.round(pageHeight * 0.24));
}

/** Hauteur réservée sous la vidéo pour le curseur + labels temps (relevé du cœur favori). */
const IMMERSIVE_VIDEO_SCRUBBER_RESERVE = verticalScale(44);

function immersiveVideoSeekFraction(locationX: number, trackWidth: number): number {
  if (trackWidth <= 0) return 0;
  return Math.max(0, Math.min(1, locationX / trackWidth));
}

function ImmersiveVideoSeekBar({
  positionMillis,
  durationMillis,
  bottomInset,
  onSeekStart,
  onSeek,
  onSeekEnd,
}: {
  positionMillis: number;
  durationMillis: number;
  bottomInset: number;
  onSeekStart: () => void;
  onSeek: (positionMillis: number) => void;
  onSeekEnd: () => void;
}) {
  const trackWidthRef = useRef(0);
  const progress =
    durationMillis > 0
      ? Math.max(0, Math.min(1, positionMillis / durationMillis))
      : 0;

  const applySeek = useCallback(
    (locationX: number) => {
      const w = trackWidthRef.current;
      if (w <= 0 || durationMillis <= 0) return;
      const frac = immersiveVideoSeekFraction(locationX, w);
      onSeek(Math.round(frac * durationMillis));
    },
    [durationMillis, onSeek],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: e => {
          onSeekStart();
          applySeek(e.nativeEvent.locationX);
        },
        onPanResponderMove: e => {
          applySeek(e.nativeEvent.locationX);
        },
        onPanResponderRelease: () => {
          onSeekEnd();
        },
        onPanResponderTerminate: () => {
          onSeekEnd();
        },
      }),
    [applySeek, onSeekEnd, onSeekStart],
  );

  const posSec = Math.floor(positionMillis / 1000);
  const durSec = Math.max(0, Math.floor(durationMillis / 1000));
  const thumbSize = scale(14);
  const thumbRadius = thumbSize / 2;

  return (
    <View
      style={[styles.immersiveVideoScrubberHost, { bottom: bottomInset }]}
      pointerEvents="box-none"
    >
      <View style={styles.immersiveVideoScrubberTimeRow} pointerEvents="none">
        <Text style={styles.immersiveVideoScrubberTime}>{formatDuration(posSec)}</Text>
        <Text style={styles.immersiveVideoScrubberTime}>{formatDuration(durSec)}</Text>
      </View>
      <View
        style={styles.immersiveVideoScrubberTrackHit}
        onLayout={e => {
          trackWidthRef.current = e.nativeEvent.layout.width;
        }}
        accessibilityRole="adjustable"
        accessibilityLabel="Position dans la vidéo"
        accessibilityValue={{
          min: 0,
          max: durSec,
          now: posSec,
          text: `${formatDuration(posSec)} sur ${formatDuration(durSec)}`,
        }}
        {...pan.panHandlers}
      >
        <View style={styles.immersiveVideoScrubberTrack} pointerEvents="none">
          <View
            style={[styles.immersiveVideoScrubberFill, { width: `${progress * 100}%` }]}
          />
        </View>
        <View
          style={[
            styles.immersiveVideoScrubberThumb,
            {
              width: thumbSize,
              height: thumbSize,
              borderRadius: thumbRadius,
              left: `${progress * 100}%`,
              marginLeft: -thumbRadius,
              marginTop: -thumbRadius,
            },
          ]}
          pointerEvents="none"
        />
      </View>
    </View>
  );
}

function isImmersiveMediaType(type: Memory['type']): boolean {
  return type === 'photo' || type === 'video' || type === 'voice';
}

export default function MemoryViewerScreen() {
  return (
    <MemoryTextFontProvider>
      <MemoryViewerScreenInner />
    </MemoryTextFontProvider>
  );
}

function MemoryViewerScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const { height: windowH, width: windowW } = useWindowDimensions();
  const rawIdx = useLocalSearchParams<{ initialIndex?: string | string[] }>().initialIndex;
  const initialIndexParam = Array.isArray(rawIdx) ? rawIdx[0] : rawIdx;
  const parsedInitial = initialIndexParam ? Number.parseInt(initialIndexParam, 10) : 0;

  const [memories, setMemories] = useState<Memory[]>([]);
  const [initialIndex, setInitialIndex] = useState(0);
  const [child, setChild] = useState<Child | null>(null);
  const [familyChildren, setFamilyChildren] = useState<Child[]>(() =>
    sortChildrenByBirthdateAsc(listLocalChildren()),
  );
  const [visibleItemKey, setVisibleItemKey] = useState<string | null>(null);
  const [editingTextMemory, setEditingTextMemory] = useState<Memory | null>(null);
  const listRef = useRef<FlatList<ImmersiveViewerItem>>(null);
  const didHydrateRef = useRef(false);
  const innerScrollLockCountRef = useRef(0);
  const [pagerScrollEnabled, setPagerScrollEnabled] = useState(true);
  const toggleFavorite = useToggleFavorite(setMemories);

  const lockPagerScroll = useCallback(() => {
    innerScrollLockCountRef.current += 1;
    setPagerScrollEnabled(false);
  }, []);

  const unlockPagerScroll = useCallback(() => {
    innerScrollLockCountRef.current = Math.max(0, innerScrollLockCountRef.current - 1);
    if (innerScrollLockCountRef.current === 0) setPagerScrollEnabled(true);
  }, []);

  const viewerItems = useMemo(() => buildImmersiveViewerItems(memories), [memories]);

  useEffect(() => {
    if (didHydrateRef.current) return;
    const payload = peekMemoryViewerSession();
    if (!payload?.memories?.length) {
      safeRouterBack(router, '/(tabs)');
      return;
    }
    didHydrateRef.current = true;
    const memoryIdx = Number.isFinite(parsedInitial)
      ? Math.min(Math.max(0, parsedInitial), payload.memories.length - 1)
      : Math.min(Math.max(0, payload.initialIndex), payload.memories.length - 1);
    setMemories(payload.memories);
    const flatIdx = resolveImmersiveViewerInitialIndex(
      payload.memories,
      memoryIdx,
      payload.initialAlbumPhotoIndex,
    );
    setInitialIndex(flatIdx);
    const items = buildImmersiveViewerItems(payload.memories);
    const opened = items[flatIdx];
    setVisibleItemKey(opened ? immersiveViewerItemKey(opened) : null);
    const sessionFamily =
      payload.familyChildren?.length
        ? sortChildrenByBirthdateAsc(payload.familyChildren)
        : sortChildrenByBirthdateAsc(listLocalChildren());
    setFamilyChildren(sessionFamily);
    const cid = payload.memories[0]?.child_id;
    setChild(sessionFamily.find(c => c.id === cid) ?? sessionFamily[0] ?? null);
    void getChildren().then(list => {
      const sorted = sortChildrenByBirthdateAsc(list);
      setFamilyChildren(prev => {
        if (
          prev.length === sorted.length &&
          prev.every(
            (c, i) =>
              c.id === sorted[i]?.id &&
              (c.local_photo_path ?? '') === (sorted[i]?.local_photo_path ?? '') &&
              (c.photo_url ?? '') === (sorted[i]?.photo_url ?? '') &&
              c.name === sorted[i]?.name,
          )
        ) {
          return prev;
        }
        return sorted;
      });
      const memCid = payload.memories[0]?.child_id;
      setChild(prev => {
        const next = sorted.find(c => c.id === memCid) ?? sorted[0] ?? null;
        if (
          prev &&
          next &&
          prev.id === next.id &&
          (prev.local_photo_path ?? '') === (next.local_photo_path ?? '') &&
          (prev.photo_url ?? '') === (next.photo_url ?? '') &&
          prev.name === next.name
        ) {
          return prev;
        }
        return next;
      });
    });
  }, [parsedInitial, router]);

  const visibleMemory = useMemo(() => {
    if (!visibleItemKey || viewerItems.length === 0) {
      return memories[0] ?? null;
    }
    const item = viewerItems.find(it => immersiveViewerItemKey(it) === visibleItemKey);
    return item ? memoryFromImmersiveViewerItem(item) : memories[0] ?? null;
  }, [visibleItemKey, viewerItems, memories]);
  const closeOnMediaChrome = visibleMemory ? isImmersiveMediaType(visibleMemory.type) : true;
  const isTextViewerPage = visibleMemory?.type === 'text';

  const goToViewerIndex = useCallback(
    (index: number) => {
      if (viewerItems.length === 0) return;
      const next = Math.max(0, Math.min(viewerItems.length - 1, index));
      const item = viewerItems[next];
      if (!item) return;
      setVisibleItemKey(immersiveViewerItemKey(item));
      listRef.current?.scrollToIndex({ index: next, animated: true });
    },
    [viewerItems],
  );

  /** Posts texte : pager vertical coupé — navigation via flèches uniquement. */
  const flatListScrollEnabled = !isTextViewerPage && pagerScrollEnabled;

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(closeOnMediaChrome ? 'light' : 'dark');
      void ensurePlaybackAudioForListening();
      const frame = requestAnimationFrame(() => {
        listRef.current?.recordInteraction?.();
      });
      return () => {
        cancelAnimationFrame(frame);
        setStatusBarStyle('dark');
      };
    }, [closeOnMediaChrome]),
  );

  useEffect(() => {
    setStatusBarStyle(closeOnMediaChrome ? 'light' : 'dark');
  }, [closeOnMediaChrome]);

  const itemHeight = windowH;

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const item = viewableItems[0]?.item as ImmersiveViewerItem | undefined;
    setVisibleItemKey(item ? immersiveViewerItemKey(item) : null);
  }, []);

  const immersiveViewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 85 }),
    [],
  );
  const immersiveViewabilityPairs = useStableViewabilityPairs(
    immersiveViewabilityConfig,
    onViewableItemsChanged,
  );

  const handleFavoritePhotoUrlsUpdated = useCallback(
    (memoryId: string, urls: string[]) => {
      setMemories(prev =>
        prev.map(m => {
          if (m.id !== memoryId) return m;
          const withUrls = { ...m, favorite_photo_urls: urls };
          const allUrls = getAlbumCanonicalFavoriteUrls(withUrls);
          const allFav =
            allUrls.length > 0 &&
            allUrls.every(u =>
              isPhotoUrlFavoritedWithVariants(withUrls, urls, u)
            );
          return {
            ...withUrls,
            is_favorite: allFav,
          };
        })
      );
    },
    []
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ImmersiveViewerItem; index: number }) => {
      const memory = memoryFromImmersiveViewerItem(item);
      const albumSlot =
        item.kind === 'albumPhoto'
          ? {
              uri: item.photoUri,
              index: item.albumPhotoIndex,
              total: item.albumPhotoCount,
            }
          : undefined;
      const showTextMarginNav = memory.type === 'text' && viewerItems.length > 1;
      return (
        <ImmersivePage
          memory={memory}
          isActive={isFocused && visibleItemKey === immersiveViewerItemKey(item)}
          height={itemHeight}
          width={windowW}
          albumPhotoSlot={albumSlot}
          familyChildren={familyChildren}
          onRequestEditText={m => setEditingTextMemory(m)}
          toggleFavorite={toggleFavorite}
          onFavoritePhotoUrlsUpdated={urls => handleFavoritePhotoUrlsUpdated(memory.id, urls)}
          onInnerScrollLock={lockPagerScroll}
          onInnerScrollUnlock={unlockPagerScroll}
          showTextMarginNav={showTextMarginNav}
          canTextNavPrev={index > 0}
          canTextNavNext={index < viewerItems.length - 1}
          onTextNavPrev={() => goToViewerIndex(index - 1)}
          onTextNavNext={() => goToViewerIndex(index + 1)}
        />
      );
    },
    [
      visibleItemKey,
      itemHeight,
      windowW,
      familyChildren,
      viewerItems.length,
      toggleFavorite,
      handleFavoritePhotoUrlsUpdated,
      lockPagerScroll,
      unlockPagerScroll,
      goToViewerIndex,
      isFocused,
    ],
  );

  const handleSaveTextEdit = useCallback(
    async (text: string) => {
      const target = editingTextMemory;
      if (!target) return;
      setMemories(prev => prev.map(m => (m.id === target.id ? { ...m, content: text } : m)));
      const ok = await updateMemoryContent(target.id, text);
      if (!ok) {
        Alert.alert(
          'Connexion',
          "Ton texte est bien enregistré sur l’app, mais la synchronisation a échoué. Réessaie plus tard."
        );
      }
      setEditingTextMemory(null);
    },
    [editingTextMemory, setMemories]
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: itemHeight,
      offset: itemHeight * index,
      index,
    }),
    [itemHeight]
  );

  const keyExtractor = useCallback((item: ImmersiveViewerItem) => immersiveViewerItemKey(item), []);

  if (viewerItems.length === 0) {
    return <View style={[styles.root, styles.viewerShell, { minHeight: windowH }]} />;
  }

  return (
    <View style={[styles.root, styles.viewerShell, { minHeight: windowH }]}>
      <StatusBar style={closeOnMediaChrome ? 'light' : 'dark'} />
      <EditTextModal
        key={editingTextMemory?.id ?? 'closed'}
        visible={editingTextMemory !== null}
        initialText={editingTextMemory?.content ?? ''}
        previewVariant={feedMemoryTextEditPreviewVariant(editingTextMemory?.type)}
        bookLineBudget={bookLineBudgetForMemoryType(editingTextMemory?.type)}
        bookCharsPerLine={bookCharsPerLineForMemoryType(editingTextMemory?.type)}
        title="Modifier le texte"
        onClose={() => setEditingTextMemory(null)}
        onSave={handleSaveTextEdit}
      />
      <Pressable
        onPress={() => {
          clearMemoryViewerSession();
          safeRouterBack(router, '/(tabs)');
        }}
        style={[
          styles.closeBtn,
          closeOnMediaChrome ? styles.closeBtnOnMedia : styles.closeBtnOnText,
          { top: insets.top + verticalScale(8), right: scale(12) },
        ]}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel="Fermer"
      >
        <X
          color={closeOnMediaChrome ? TOP_CHROME_TEXT : THEME.textPrimary}
          size={scale(28)}
          strokeWidth={2.2}
        />
      </Pressable>

      <FlatList
        ref={listRef}
        style={styles.viewerList}
        data={viewerItems}
        extraData={familyChildren}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        pagingEnabled
        scrollEnabled={flatListScrollEnabled}
        nestedScrollEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        initialScrollIndex={initialIndex}
        getItemLayout={getItemLayout}
        viewabilityConfigCallbackPairs={immersiveViewabilityPairs}
        removeClippedSubviews
        windowSize={3}
        maxToRenderPerBatch={2}
        initialNumToRender={1}
        onScrollToIndexFailed={({ index }) => {
          listRef.current?.scrollToOffset({
            offset: index * itemHeight,
            animated: false,
          });
        }}
      />
    </View>
  );
}

type AlbumPhotoSlot = {
  uri: string;
  index: number;
  total: number;
};

function ImmersivePage({
  memory,
  isActive,
  height,
  width,
  albumPhotoSlot,
  familyChildren,
  onRequestEditText,
  toggleFavorite,
  onFavoritePhotoUrlsUpdated,
  onInnerScrollLock,
  onInnerScrollUnlock,
  showTextMarginNav,
  canTextNavPrev,
  canTextNavNext,
  onTextNavPrev,
  onTextNavNext,
}: {
  memory: Memory;
  isActive: boolean;
  height: number;
  width: number;
  albumPhotoSlot?: AlbumPhotoSlot;
  familyChildren: Child[];
  onRequestEditText: (m: Memory) => void;
  toggleFavorite: (id: string) => void | Promise<void>;
  onFavoritePhotoUrlsUpdated: (urls: string[]) => void;
  onInnerScrollLock?: () => void;
  onInnerScrollUnlock?: () => void;
  showTextMarginNav?: boolean;
  canTextNavPrev?: boolean;
  canTextNavNext?: boolean;
  onTextNavPrev?: () => void;
  onTextNavNext?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { feedDateFontFamily, feedAgeFontFamily } = useFeedMetaFonts();
  const postDateLabel = formatDateLong(memory.created_at);
  const ageAt = formatFamilyAgesLine(familyChildren, memory.created_at);
  const loc = memory.location?.trim()
    ? memory.location.replace(/\s*\([^)]*\)\s*$/, '').trim()
    : '';

  const mediaChrome = isImmersiveMediaType(memory.type);
  const topChromePadTop = insets.top + verticalScale(8);
  const topFadeHeight = useMemo(() => immersiveTopFadeHeight(height), [height]);
  const captionScrollMaxH = useMemo(
    () => Math.min(IMMERSIVE_CAPTION_SCROLL_MAX_H, Math.round(height * 0.32)),
    [height],
  );
  const textTopInset = insets.top + verticalScale(52);
  const textBottomReserve = insets.bottom + verticalScale(20);
  const textViewportH = useMemo(
    () => Math.max(verticalScale(220), height - textTopInset - textBottomReserve),
    [height, textTopInset, textBottomReserve],
  );
  const overlayBottomInset = immersiveOverlayBottomInset(insets.bottom);
  const [videoSoundOn, setVideoSoundOn] = useState(true);
  const memoryEditorialFont = useMemoryEditorialFont();

  useEffect(() => {
    setVideoSoundOn(true);
  }, [memory.id]);

  const metaBlock = (
    <View style={styles.metaStack}>
      <Text
        style={[
          mediaChrome ? styles.metaDateOnMedia : styles.metaDateOnText,
          feedDateFontFamily ? { fontFamily: feedDateFontFamily } : styles.metaDateSystem,
        ]}
        numberOfLines={1}
      >
        {postDateLabel}
        {loc ? ` · ${loc}` : ''}
      </Text>
      {!mediaChrome && !!ageAt ? (
        <Text
          style={[
            styles.metaAgeOnText,
            feedAgeFontFamily ? { fontFamily: feedAgeFontFamily } : styles.metaAgeSystem,
          ]}
          numberOfLines={2}
        >
          {ageAt}
        </Text>
      ) : null}
    </View>
  );

  return (
    <View style={{ height, width, backgroundColor: BG }}>
      <View style={styles.pageBody}>
        <View style={styles.mediaFill}>
          {memory.type === 'photo' && (
            <ImmersivePhoto
              memory={memory}
              albumPhotoSlot={albumPhotoSlot}
              onToggleMemoryFavorite={toggleFavorite}
              onFavoritePhotoUrlsUpdated={onFavoritePhotoUrlsUpdated}
              overlayBottomInset={overlayBottomInset}
            />
          )}
          {memory.type === 'video' && (
            <ImmersiveVideo
              memory={memory}
              isActive={isActive}
              soundOn={videoSoundOn}
              onToggleFavorite={toggleFavorite}
              overlayBottomInset={overlayBottomInset}
            />
          )}
          {memory.type === 'voice' && (
            <ImmersiveVoice
              memory={memory}
              width={width}
              onToggleFavorite={toggleFavorite}
              overlayBottomInset={overlayBottomInset}
            />
          )}
          {memory.type === 'text' && (
            <ImmersiveText
              memory={memory}
              topInset={textTopInset}
              viewportHeight={textViewportH}
              onTapEdit={() => onRequestEditText(memory)}
              onToggleFavorite={toggleFavorite}
              overlayBottomInset={overlayBottomInset}
              showMarginNav={!!showTextMarginNav}
              canGoPrev={!!canTextNavPrev}
              canGoNext={!!canTextNavNext}
              onGoPrev={onTextNavPrev ?? (() => {})}
              onGoNext={onTextNavNext ?? (() => {})}
            />
          )}
        </View>

        {mediaChrome ? (
          <>
            <LinearGradient
              colors={[...IMMERSIVE_TOP_BLACK_FADE]}
              locations={[0, 0.5, 1]}
              pointerEvents="none"
              style={[styles.topMediaGradient, { height: topFadeHeight }]}
            />
            <View
              style={[styles.topChromeFloat, { paddingTop: topChromePadTop }]}
              pointerEvents="box-none"
            >
              {metaBlock}
              {memory.type === 'video' && isActive ? (
                <Pressable
                  style={[styles.chromePill, styles.chromeIconPill]}
                  onPress={() => setVideoSoundOn(v => !v)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    videoSoundOn ? 'Couper le son de la vidéo' : 'Activer le son de la vidéo'
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {videoSoundOn ? (
                    <Volume2 color={TOP_CHROME_TEXT} size={scale(20)} strokeWidth={2} />
                  ) : (
                    <VolumeX color={TOP_CHROME_TEXT} size={scale(20)} strokeWidth={2} />
                  )}
                </Pressable>
              ) : null}
            </View>
            {albumPhotoSlot && albumPhotoSlot.total > 1 ? (
              <View style={styles.albumPageBadge} pointerEvents="none">
                <Text style={styles.albumPageBadgeText}>
                  {albumPhotoSlot.index + 1} / {albumPhotoSlot.total}
                </Text>
              </View>
            ) : null}
            {!!ageAt && (memory.type === 'photo' || memory.type === 'video' || memory.type === 'voice') ? (
              <FeedAgeOverlay
                ageLabel={ageAt}
                feedAgeFontFamily={feedAgeFontFamily}
                bottomInset={
                  overlayBottomInset +
                  (memory.type === 'video' && isActive ? IMMERSIVE_VIDEO_SCRUBBER_RESERVE : 0)
                }
              />
            ) : null}
          </>
        ) : (
          <View style={[styles.topTextMeta, { paddingTop: topChromePadTop }]} pointerEvents="none">
            {metaBlock}
          </View>
        )}
      </View>

      {memory.type !== 'text' && !!memory.content?.trim() && (
        <View style={styles.footer}>
          <ScrollableTextBlock
            maxHeight={captionScrollMaxH}
            onInnerScrollLock={onInnerScrollLock}
            onInnerScrollUnlock={onInnerScrollUnlock}
          >
            <Text
              style={[feedStyles.captionAnnotation, { fontFamily: memoryEditorialFont }]}
              {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
            >
              {memory.content.trim()}
            </Text>
          </ScrollableTextBlock>
        </View>
      )}
    </View>
  );
}

function ImmersivePhotoSlide({
  uri,
  memoryId,
}: {
  uri: string;
  memoryId: string;
}) {
  const raw = uri.trim();
  const isDeviceLocal =
    !!raw &&
    (raw.startsWith('file:') ||
      raw.startsWith('content:') ||
      raw.startsWith('ph://') ||
      raw.startsWith('assets-library://') ||
      (raw.startsWith('/') && !extractMediaBucketPath(raw)));
  const needsRemoteSign = !!raw && !isDeviceLocal;
  const signed = useSignedMediaUrl(needsRemoteSign ? raw : null);
  const displayUri = (needsRemoteSign ? signed ?? raw : raw).trim();

  if (!displayUri) {
    return <View style={[styles.fullBleed, styles.mediaFallback]} />;
  }

  return (
    <Image
      source={{ uri: displayUri }}
      style={styles.fullBleed}
      contentFit="cover"
      cachePolicy="memory-disk"
      priority="high"
      recyclingKey={`${memoryId}-${raw}`}
    />
  );
}

function ImmersivePhoto({
  memory,
  albumPhotoSlot,
  onToggleMemoryFavorite,
  onFavoritePhotoUrlsUpdated,
  overlayBottomInset,
}: {
  memory: Memory;
  albumPhotoSlot?: AlbumPhotoSlot;
  onToggleMemoryFavorite: (id: string) => void | Promise<void>;
  onFavoritePhotoUrlsUpdated: (urls: string[]) => void;
  overlayBottomInset: number;
}) {
  const favoritePhotoUrls = useMemo(() => parseFavoritePhotoUrls(memory), [memory]);

  const raw = albumPhotoSlot
    ? albumPhotoSlot.uri.trim()
    : (getPrimaryPhotoUriForImmersiveViewer(memory)?.trim() ?? '');

  const handleTogglePhotoFavorite = useCallback(
    async (url: string) => {
      const next = await toggleFavoritePhotoUrl(memory.id, url);
      if (next) onFavoritePhotoUrlsUpdated(next);
    },
    [memory.id, onFavoritePhotoUrlsUpdated]
  );

  if (!raw) {
    return (
      <View style={[styles.photoImmersiveWrap, styles.mediaFallback]}>
        <FeedPhotoFavoriteOverlay
          isFavorite={!!memory.is_favorite}
          inkOverride={memory.captured_overlay_ink}
          onPress={() => void onToggleMemoryFavorite(memory.id)}
          bottomInset={overlayBottomInset}
        />
      </View>
    );
  }

  const photoFavorited = albumPhotoSlot
    ? isPhotoUrlFavoritedWithVariants(memory, favoritePhotoUrls, raw)
    : !!memory.is_favorite;

  return (
    <View style={styles.photoImmersiveWrap}>
      <ImmersivePhotoSlide uri={raw} memoryId={memory.id} />
      <FeedPhotoFavoriteOverlay
        isFavorite={photoFavorited}
        inkOverride={memory.captured_overlay_ink}
        onPress={() =>
          void (albumPhotoSlot
            ? handleTogglePhotoFavorite(raw)
            : onToggleMemoryFavorite(memory.id))
        }
        bottomInset={overlayBottomInset}
      />
    </View>
  );
}

function ImmersiveVideo({
  memory,
  isActive,
  soundOn,
  onToggleFavorite,
  overlayBottomInset,
}: {
  memory: Memory;
  isActive: boolean;
  soundOn: boolean;
  onToggleFavorite: (id: string) => void | Promise<void>;
  overlayBottomInset: number;
}) {
  const uri = useFeedVideoPlaybackUri(memory);
  const posterRaw = getVideoPosterUriForFeedAndViewer(memory);
  const posterSigned = useSignedMediaUrl(posterRaw || null) ?? '';
  const posterUri = normalizeVideoPlaybackUri((posterSigned || posterRaw).trim());

  const seedNatural = useMemo(() => {
    const w = memory.original_px_w ?? 0;
    const h = memory.original_px_h ?? 0;
    return w > 0 && h > 0 ? ({ w, h } as const) : null;
  }, [memory.original_px_w, memory.original_px_h]);

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(seedNatural);
  const [videoReady, setVideoReady] = useState(false);
  const [positionMillis, setPositionMillis] = useState(0);
  const [durationMillis, setDurationMillis] = useState(() =>
    memory.duration && memory.duration > 0 ? Math.round(memory.duration * 1000) : 0,
  );
  const scrubbingRef = useRef(false);
  const immersiveVideoRef = useRef<Video | null>(null);
  const posterFade = useRef(new Animated.Value(1)).current;

  const trimmedUri = uri?.trim() ?? '';
  useExpoAvShouldPlay(immersiveVideoRef, isActive, trimmedUri);

  useEffect(() => {
    if (isActive) return;
    posterFade.setValue(1);
    setVideoReady(false);
    void immersiveVideoRef.current?.pauseAsync().catch(() => {});
  }, [isActive, posterFade]);

  useEffect(() => {
    const w = memory.original_px_w ?? 0;
    const h = memory.original_px_h ?? 0;
    setNatural(w > 0 && h > 0 ? { w, h } : null);
    posterFade.setValue(1);
    setVideoReady(false);
    setPositionMillis(0);
    setDurationMillis(
      memory.duration && memory.duration > 0 ? Math.round(memory.duration * 1000) : 0,
    );
  }, [memory.id, memory.original_px_w, memory.original_px_h, memory.duration, trimmedUri, posterFade]);

  useEffect(() => {
    if (!videoReady || !isActive || !posterUri.trim()) return;
    Animated.timing(posterFade, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [videoReady, isActive, posterUri, posterFade]);

  const markVideoReady = useCallback(() => {
    setVideoReady(prev => (prev ? prev : true));
  }, []);

  const onReadyForDisplay = useCallback(
    (e: { naturalSize?: { width: number; height: number } }) => {
      const nw = e.naturalSize?.width ?? 0;
      const nh = e.naturalSize?.height ?? 0;
      if (nw > 0 && nh > 0) {
        setNatural(prev => {
          if (prev?.w === nw && prev?.h === nh) return prev;
          return { w: nw, h: nh };
        });
      }
      markVideoReady();
    },
    [markVideoReady],
  );

  const onPlaybackStatusUpdate = useCallback(
    (status: AVPlaybackStatus) => {
      if (!status.isLoaded) return;
      const dur = status.durationMillis ?? 0;
      if (dur > 0) {
        setDurationMillis(dur);
      } else if (memory.duration && memory.duration > 0) {
        setDurationMillis(Math.round(memory.duration * 1000));
      }
      if (!scrubbingRef.current) {
        setPositionMillis(status.positionMillis ?? 0);
      }
      if (
        status.isPlaying ||
        (typeof status.positionMillis === 'number' && status.positionMillis > 40)
      ) {
        markVideoReady();
      }
    },
    [markVideoReady, memory.duration],
  );

  const handleSeekStart = useCallback(() => {
    scrubbingRef.current = true;
    void immersiveVideoRef.current?.pauseAsync().catch(() => {});
  }, []);

  const handleSeek = useCallback((ms: number) => {
    setPositionMillis(ms);
    void immersiveVideoRef.current?.setPositionAsync(ms).catch(() => {});
  }, []);

  const handleSeekEnd = useCallback(() => {
    scrubbingRef.current = false;
    if (isActive) {
      void immersiveVideoRef.current?.playAsync().catch(() => {});
    }
  }, [isActive]);

  const onPosterLoad = useCallback((e: { source: { width?: number; height?: number } }) => {
    const w = e.source.width ?? 0;
    const h = e.source.height ?? 0;
    if (w > 0 && h > 0) setNatural(prev => prev ?? { w, h });
  }, []);

  const dimensions = natural ?? seedNatural;
  /** Paysage (et carré) : tout voir. Portrait : cover — dimensions figées dès l’EXIF pour éviter le saut. */
  const resizeMode =
    dimensions && dimensions.h > dimensions.w ? ResizeMode.COVER : ResizeMode.CONTAIN;
  const posterFit = resizeMode === ResizeMode.CONTAIN ? ('contain' as const) : ('cover' as const);

  const showSeekBar = isActive && !!trimmedUri && durationMillis > 0;
  const favoriteBottomInset = overlayBottomInset + (showSeekBar ? IMMERSIVE_VIDEO_SCRUBBER_RESERVE : 0);

  const favoriteOverlay = (
    <FeedPhotoFavoriteOverlay
      isFavorite={!!memory.is_favorite}
      inkOverride={memory.captured_overlay_ink}
      onPress={() => void onToggleFavorite(memory.id)}
      bottomInset={favoriteBottomInset}
    />
  );

  const mediaOverlays = <>{favoriteOverlay}</>;

  if (!trimmedUri && !posterUri) {
    return (
      <View style={[styles.videoImmersiveWrap, styles.mediaFallback]}>
        {mediaOverlays}
      </View>
    );
  }

  const showPosterLayer = !!posterUri.trim();

  return (
    <View style={styles.videoImmersiveWrap}>
      <View
        style={[StyleSheet.absoluteFillObject, styles.immersiveVideoBackdrop]}
        pointerEvents="none"
      />
      {trimmedUri && isActive ? (
        <View style={[StyleSheet.absoluteFillObject, styles.immersiveVideoLayer]} pointerEvents="none">
          <Video
            ref={immersiveVideoRef}
            source={{ uri: trimmedUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode={resizeMode}
            shouldPlay={isActive}
            isLooping={isActive}
            isMuted={!soundOn}
            useNativeControls={false}
            onReadyForDisplay={e => {
              onReadyForDisplay(e);
              if (isActive) {
                void immersiveVideoRef.current?.playAsync();
              }
            }}
            onPlaybackStatusUpdate={onPlaybackStatusUpdate}
          />
        </View>
      ) : null}

      {showPosterLayer ? (
        <Animated.View
          style={[
            StyleSheet.absoluteFillObject,
            styles.immersiveVideoPosterOverlay,
            { opacity: isActive ? posterFade : 1 },
          ]}
          pointerEvents="none"
        >
          <Image
            source={{ uri: posterUri }}
            style={StyleSheet.absoluteFillObject}
            contentFit={posterFit}
            cachePolicy="disk"
            recyclingKey={`${memory.id}-poster`}
            onLoad={onPosterLoad}
          />
        </Animated.View>
      ) : null}

      {mediaOverlays}

      {showSeekBar ? (
        <ImmersiveVideoSeekBar
          positionMillis={positionMillis}
          durationMillis={durationMillis}
          bottomInset={overlayBottomInset}
          onSeekStart={handleSeekStart}
          onSeek={handleSeek}
          onSeekEnd={handleSeekEnd}
        />
      ) : null}
    </View>
  );
}

function ImmersiveVoice({
  memory,
  width,
  onToggleFavorite,
  overlayBottomInset,
}: {
  memory: Memory;
  width: number;
  onToggleFavorite: (id: string) => void | Promise<void>;
  overlayBottomInset: number;
}) {
  const voiceCoverRaw = getVoiceCoverUriForFeedAndViewer(memory);
  const voiceCoverSigned = useSignedMediaUrl(voiceCoverRaw || null) ?? '';
  const voiceCoverDisplayUri = normalizeMemoryMediaUriForDisplay(
    (voiceCoverSigned || voiceCoverRaw).trim(),
  );
  const hasCover = !!voiceCoverDisplayUri.trim();

  const voicePlaybackSigned =
    useSignedMediaUrl(memory.type === 'voice' ? (memory.media_url ?? null) : null) ?? '';
  const playbackUri = (voicePlaybackSigned || (memory.media_url ?? '')).trim();

  return (
    <View style={[styles.voiceWrapImmersive, { width }, styles.immersiveMediaOverlaysHost]}>
      {hasCover ? (
        <Image
          source={{ uri: voiceCoverDisplayUri }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          cachePolicy="disk"
          recyclingKey={memory.id}
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: THEME.bgScreen }]} />
      )}
      <View style={[styles.voicePlayerImmersive, hasCover && styles.voicePlayerImmersiveCoverScrim]}>
        {playbackUri ? (
          <AudioPlayer
            uri={playbackUri}
            duration={memory.duration || 0}
            playbackStartSec={memory.voice_playback_start_sec ?? null}
            variant={hasCover ? 'coverBottom' : 'default'}
            controlIconColor={hasCover ? '#1C1C1E' : '#FFFFFF'}
            coverFlushBottom={hasCover}
          />
        ) : null}
      </View>
      <FeedPhotoFavoriteOverlay
        isFavorite={!!memory.is_favorite}
        inkOverride={memory.captured_overlay_ink}
        onPress={() => void onToggleFavorite(memory.id)}
        bottomInset={overlayBottomInset}
      />
    </View>
  );
}

function TextImmersiveMarginRail({
  canGoPrev,
  canGoNext,
  onGoPrev,
  onGoNext,
}: {
  canGoPrev: boolean;
  canGoNext: boolean;
  onGoPrev: () => void;
  onGoNext: () => void;
}) {
  const hintActive = 'rgba(28, 28, 30, 0.22)';
  const hintDisabled = 'rgba(28, 28, 30, 0.08)';

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dy) > verticalScale(10) && Math.abs(g.dy) > Math.abs(g.dx) * 1.2,
        onPanResponderRelease: (_, g) => {
          if (g.dy <= -TEXT_MARGIN_SWIPE_DY && canGoNext) onGoNext();
          else if (g.dy >= TEXT_MARGIN_SWIPE_DY && canGoPrev) onGoPrev();
        },
      }),
    [canGoPrev, canGoNext, onGoPrev, onGoNext],
  );

  return (
    <View
      style={styles.textMarginRail}
      {...panResponder.panHandlers}
      accessibilityRole="adjustable"
      accessibilityLabel="Glisser vers le haut ou le bas pour changer de souvenir"
    >
      <View pointerEvents="none" style={styles.textMarginHint}>
        <ChevronUp
          color={canGoPrev ? hintActive : hintDisabled}
          size={scale(13)}
          strokeWidth={1.6}
        />
        <View style={styles.textMarginLine} />
        <ChevronDown
          color={canGoNext ? hintActive : hintDisabled}
          size={scale(13)}
          strokeWidth={1.6}
        />
      </View>
    </View>
  );
}

function ImmersiveText({
  memory,
  topInset,
  viewportHeight,
  onTapEdit,
  onToggleFavorite,
  showMarginNav,
  canGoPrev,
  canGoNext,
  onGoPrev,
  onGoNext,
  overlayBottomInset,
}: {
  memory: Memory;
  topInset: number;
  viewportHeight: number;
  onTapEdit: () => void;
  onToggleFavorite: (id: string) => void | Promise<void>;
  showMarginNav: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  onGoPrev: () => void;
  onGoNext: () => void;
  overlayBottomInset: number;
}) {
  /** Exactement le même hook / styles que `FilMemoryRow` (souvenirs texte du fil). */
  const memoryEditorialFont = useMemoryEditorialFont();
  const memoryEditorialBoldFont = useMemoryEditorialBoldFont();
  const title = memory.text_title?.trim() ?? '';
  const raw = memory.content?.trim() || '';
  const paragraphs = useMemo(() => {
    const t = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!t) return ['Un joli mot du cœur'];
    const parts = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return parts.length ? parts : [t];
  }, [raw]);

  return (
    <View style={[styles.textImmersiveOuter, { top: topInset, height: viewportHeight }]}>
      <View style={styles.textImmersiveRow}>
        {showMarginNav ? (
          <TextImmersiveMarginRail
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            onGoPrev={onGoPrev}
            onGoNext={onGoNext}
          />
        ) : (
          <View style={styles.textMarginSpacer} />
        )}
        <View style={styles.textImmersiveCenter}>
          <ScrollableTextBlock
            maxHeight={viewportHeight}
            contentContainerStyle={styles.textWrapCentered}
          >
            {title ? (
              <Text
                style={[
                  feedStyles.textTitle,
                  styles.immersiveTextCentered,
                  { fontFamily: memoryEditorialBoldFont },
                ]}
                onPress={onTapEdit}
                accessibilityRole="button"
                accessibilityLabel="Modifier le texte"
                {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
              >
                {title}
              </Text>
            ) : null}
            {paragraphs.map((para, idx) => (
              <Text
                key={idx}
                style={[
                  feedStyles.textContent,
                  styles.immersiveTextCentered,
                  { fontFamily: memoryEditorialFont },
                  idx > 0 && feedStyles.textBookParagraphSpacing,
                ]}
                onPress={onTapEdit}
                accessibilityRole="button"
                accessibilityLabel="Modifier le texte"
                {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
              >
                {para}
              </Text>
            ))}
          </ScrollableTextBlock>
        </View>
        {showMarginNav ? (
          <TextImmersiveMarginRail
            canGoPrev={canGoPrev}
            canGoNext={canGoNext}
            onGoPrev={onGoPrev}
            onGoNext={onGoNext}
          />
        ) : (
          <View style={styles.textMarginSpacer} />
        )}
      </View>
      <FeedPhotoFavoriteOverlay
        isFavorite={!!memory.is_favorite}
        inkOverride={memory.captured_overlay_ink}
        onPress={() => void onToggleFavorite(memory.id)}
        bottomInset={overlayBottomInset}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  viewerShell: {
    width: '100%',
  },
  viewerList: {
    flex: 1,
  },
  closeBtn: {
    position: 'absolute',
    zIndex: 20,
    width: scale(44),
    height: scale(44),
    borderRadius: scale(999),
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnOnMedia: {
    backgroundColor: CHROME_PILL_BG,
  },
  closeBtnOnText: {
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
  textImmersiveRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 0,
  },
  textMarginRail: {
    width: TEXT_IMMERSIVE_MARGIN_W,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textMarginSpacer: {
    width: TEXT_IMMERSIVE_MARGIN_W,
  },
  textImmersiveCenter: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  textMarginHint: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: verticalScale(4),
  },
  textMarginLine: {
    width: StyleSheet.hairlineWidth,
    height: verticalScale(36),
    backgroundColor: 'rgba(28, 28, 30, 0.18)',
  },
  pageBody: {
    flex: 1,
    position: 'relative',
    minHeight: 0,
  },
  mediaFill: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
  },
  topMediaGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
  },
  topChromeFloat: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 6,
    paddingHorizontal: scale(12),
    paddingRight: scale(56),
    gap: verticalScale(8),
  },
  metaStack: {
    gap: verticalScale(2),
    maxWidth: '100%',
  },
  metaDateOnMedia: {
    color: TOP_CHROME_TEXT,
    fontSize: scale(12.5),
    letterSpacing: -0.15,
  },
  metaAgeOnMedia: {
    color: 'rgba(255, 255, 255, 0.88)',
    fontSize: scale(12.5),
    letterSpacing: -0.1,
  },
  metaDateSystem: {
    fontWeight: '600',
  },
  metaAgeSystem: {
    fontWeight: '300',
  },
  chromePill: {
    backgroundColor: CHROME_PILL_BG,
    borderRadius: scale(999),
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(8),
    alignSelf: 'flex-start',
    maxWidth: '78%',
  },
  chromeIconPill: {
    width: scale(40),
    height: scale(40),
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTextMeta: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 6,
    paddingHorizontal: scale(20),
    paddingRight: scale(56),
    paddingBottom: verticalScale(10),
    backgroundColor: BG,
  },
  metaDateOnText: {
    color: THEME.textPrimary,
    fontSize: scale(12.5),
    letterSpacing: -0.15,
  },
  metaAgeOnText: {
    color: THEME.textSecondary,
    fontSize: scale(12.5),
    letterSpacing: -0.1,
  },
  /** Photo immersive : conteneur pour overlays (favori + date) comme dans le fil. */
  photoImmersiveWrap: {
    flex: 1,
    width: '100%',
    alignSelf: 'stretch',
    minHeight: 0,
    position: 'relative',
    overflow: 'hidden',
  },
  albumPageBadge: {
    position: 'absolute',
    bottom: verticalScale(20),
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 8,
  },
  albumPageBadgeText: {
    color: TOP_CHROME_TEXT,
    fontSize: scale(13),
    fontWeight: '600',
    backgroundColor: CHROME_PILL_BG,
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(5),
    borderRadius: scale(14),
    overflow: 'hidden',
  },
  /** Hôte positionné pour pastilles fil (cœur bas-droite). */
  immersiveMediaOverlaysHost: {
    position: 'relative',
  },
  /** Texte immersif : fond blanc + cœur favori comme ligne d’actions fil. */
  textImmersiveOuter: {
    position: 'absolute',
    left: 0,
    right: 0,
    width: '100%',
    backgroundColor: BG,
  },
  /** Vidéo immersive : même extension que photo / vocal dans le bloc média. */
  videoImmersiveWrap: {
    flex: 1,
    width: '100%',
    alignSelf: 'stretch',
    minHeight: 0,
    position: 'relative',
    backgroundColor: BG,
    overflow: 'hidden',
  },
  immersiveVideoBackdrop: {
    backgroundColor: '#000000',
  },
  immersiveVideoPosterOverlay: {
    zIndex: 2,
  },
  immersiveVideoLayer: {
    zIndex: 1,
  },
  immersiveVideoScrubberHost: {
    position: 'absolute',
    left: scale(16),
    right: scale(16),
    zIndex: 9,
  },
  immersiveVideoScrubberTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: verticalScale(6),
  },
  immersiveVideoScrubberTime: {
    color: 'rgba(255, 255, 255, 0.92)',
    fontSize: scale(11),
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  immersiveVideoScrubberTrackHit: {
    height: verticalScale(28),
    justifyContent: 'center',
  },
  immersiveVideoScrubberTrack: {
    height: scale(3),
    borderRadius: scale(999),
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
    overflow: 'hidden',
  },
  immersiveVideoScrubberFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
    borderRadius: scale(999),
  },
  immersiveVideoScrubberThumb: {
    position: 'absolute',
    top: '50%',
    backgroundColor: '#FFFFFF',
    ...Platform.select({
      ios: {
        shadowColor: '#000000',
        shadowOpacity: 0.22,
        shadowRadius: 3,
        shadowOffset: { width: 0, height: 1 },
      },
      android: {
        elevation: 3,
      },
      default: {},
    }),
  },
  fullBleed: {
    width: '100%',
    minHeight: verticalScale(320),
    flex: 1,
  },
  mediaFallback: {
    flex: 1,
    minHeight: verticalScale(200),
    backgroundColor: THEME.bgScreen,
  },
  footer: {
    paddingHorizontal: scale(20),
    paddingBottom: verticalScale(28),
    paddingTop: verticalScale(12),
    backgroundColor: BG,
  },
  /** Souvenir texte immersif : centré comme les pages quote du livre. */
  textWrapCentered: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingTop: verticalScale(12),
    paddingBottom: verticalScale(56),
    paddingHorizontal: scale(4),
  },
  immersiveTextCentered: {
    textAlign: 'center',
  },
  /** Vocal immersif : même zone que la photo (flex dans mediaBlock), cover en plein écran. */
  voiceWrapImmersive: {
    flex: 1,
    width: '100%',
    alignSelf: 'stretch',
    minHeight: 0,
    position: 'relative',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  voicePlayerImmersive: {
    width: '100%',
    paddingVertical: verticalScale(16),
    paddingHorizontal: scale(16),
  },
  voicePlayerImmersiveCoverScrim: {
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
});
