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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
  Platform,
  Alert,
  BackHandler,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { PetitmoVideoView } from '@/components/PetitmoVideoView';
import type { VideoPlayer } from 'expo-video';
import { ChevronDown, ChevronUp, Pencil, Volume2, VolumeX, X } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import {
  clearMemoryViewerSession,
  peekMemoryViewerSession,
} from '@/services/memoryViewerSession';
import { safeRouterBack } from '@/utils/safeRouterBack';
import type { Memory, Child } from '@/types/local';
import { getLocalMemoryById, listLocalChildren } from '@/lib/localDb';
import { getChildren } from '@/services/children';
import {
  getPrimaryPhotoUriForImmersiveViewer,
  getAlbumCanonicalFavoriteUrls,
  isPhotoUrlFavoritedWithVariants,
  parseFavoritePhotoUrls,
} from '@/utils/memoryPhotos';
import { toggleFavoritePhotoUrl, updateMemoryContent } from '@/services/media';
import { extractMediaBucketPath } from '@/lib/mediaSignedUrl';
import { formatDateLong, formatDuration } from '@/utils/date';
import { formatFamilyAgesLine, sortChildrenByBirthdateAsc } from '@/utils/childrenAge';
import { useFeedMetaFonts } from '@/hooks/useFeedMetaFonts';
import { loadedFontStyle } from '@/utils/loadedFontStyle';
import { useFeedVideoPlaybackUri } from '@/hooks/useFeedVideoPlaybackUri';
import { useVideoShouldPlay } from '@/hooks/useVideoShouldPlay';
import { getCachedFeedVideoPlaybackUri } from '@/hooks/feedVideoPlaybackUriCache';
import {
  peekPooledVideoPlayer,
  peekPooledVideoUri,
  reattachVideoPlayer,
  releaseAllVideoKeepAlive,
  releaseVideoKeepAlive,
  useSharedVideoPlayer,
} from '@/lib/videoPlayerPool';
import {
  cancelFeedVideoFirstFrameWait,
  waitForFeedVideoFirstFrame,
} from '@/lib/feedVideoReturnHandoff';
import { getVideoPosterUriForFeedAndViewer, getVoiceCoverUriForFeedAndViewer, normalizeMemoryMediaUriForDisplay } from '@/utils/memoryPhotos';
import {
  normalizeVideoPlaybackUri,
  optimisticFeedLocalVideoPlaybackUri,
} from '@/utils/videoMediaUri';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { ensurePlaybackAudioForListening } from '@/lib/playbackAudioMode';
import AudioPlayer from '@/components/AudioPlayer';
import EditTextModal from '@/components/EditTextModal';
import {
  ImmersiveChromeReveal,
  ImmersiveChromeGateProvider,
} from '@/components/ImmersiveChromeReveal';
import MotionPressable from '@/components/MotionPressable';
import {
  ImmersiveMediaReveal,
  ImmersiveMediaRevealProvider,
} from '@/components/ImmersiveMediaReveal';
import { MOTION_ENTER_TRANSLATE_PX, MOTION_SPRING_SETTLE, MOTION_SPRING_ZOOM } from '@/constants/motion';
import { ImmersiveSharedElementHero } from '@/components/ImmersiveSharedElementHero';
import { ImmersivePhotoZoomWrap } from '@/components/ImmersivePhotoZoomWrap';
import { feedMemoryTextEditPreviewVariant } from '@/utils/memoryTextEditStyles';
import { bookLineBudgetForMemoryType, bookCharsPerLineForMemoryType } from '@/utils/textLimits';
import { useToggleFavorite } from '@/hooks/useToggleFavorite';
import { FeedPhotoFavoriteOverlay } from '@/components/feed/FeedMediaOverlays';
import { ScrollableTextBlock } from '@/components/ScrollableTextBlock';
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
  memoryIdFromImmersiveViewerItemKey,
  resolveImmersiveViewerInitialIndex,
  type ImmersiveViewerItem,
} from '@/utils/immersiveViewerItems';
import { armFeedSnapToKeyOnFocus } from '@/services/feedScrollRestore';
import { useStableViewabilityPairs } from '@/hooks/useStableViewabilityPairs';
import {
  draggedFullscreenRect,
  filFeedChromeInsets,
  isUsableSharedOrigin,
  type ImmersiveSharedElement,
} from '@/utils/immersiveSharedElement';
import { measureFeedImmersiveHost } from '@/utils/feedImmersiveHostRegistry';

const BG = THEME.bg;
/** Entrée : fondu + léger scale si pas de vignette mesurée. */
const IMMERSIVE_ENTER_MS = 280;
/** Zoom shared-element (Photos / Instagram) : la course est portée par `MOTION_SPRING_ZOOM`. */
const IMMERSIVE_SHARED_EASING = Easing.bezier(0.22, 1, 0.36, 1);
/**
 * À la fermeture le fil (header + tab bar) réapparaît tôt, avant la fin du zoom-retour.
 * À l’ouverture, le fond suit `heroProgress` (pas ce timing) — sinon le chrome
 * disparaît en ~180 ms pendant que la photo zoome encore → sensation de saccade.
 */
const IMMERSIVE_SHARED_BACKDROP_OUT_MS = 110;
/** Attente du `onLayout` du bloc média avant de lancer le zoom (une à deux frames). */
const IMMERSIVE_MEASURE_GRACE_MS = 80;
/** Le chrome se pose derrière la photo, assez tard pour qu’on voie sa course. */
const IMMERSIVE_CHROME_DELAY_MS = 170;
/**
 * Légende : le dégradé arrive avec le plein écran (même tempo que le chrome),
 * le texte quelques ms après — seul le texte a le spring / rebond.
 */
const IMMERSIVE_CAPTION_SCRIM_DELAY_MS = IMMERSIVE_CHROME_DELAY_MS;
const IMMERSIVE_CAPTION_TEXT_DELAY_MS = IMMERSIVE_CHROME_DELAY_MS + 40;
const IMMERSIVE_CAPTION_SCRIM_IN_MS = 160;
const IMMERSIVE_CAPTION_OUT_MS = 90;
/** Tirage bas avant activation du dismiss — laisse les flicks courts au pager. */
const IMMERSIVE_DISMISS_ACTIVE_Y = 72;
const IMMERSIVE_DISMISS_DISTANCE = 140;
const IMMERSIVE_DISMISS_VELOCITY = 1100;
/** Même pastille que `overlayBadge` du fil (date de prise bas-gauche). */
const CHROME_PILL_BG = 'rgba(0, 0, 0, 0.38)';
const TOP_CHROME_TEXT = '#FFFFFF';
/** Dégradé haut du viewer sur photo / vidéo / vocal (cover). */
const IMMERSIVE_TOP_BLACK_FADE = [
  'rgba(0, 0, 0, 0.55)',
  'rgba(0, 0, 0, 0.22)',
  'rgba(0, 0, 0, 0)',
] as const;
/** Légende sur le média : transparent → noir plus dense sous le texte. */
const IMMERSIVE_BOTTOM_BLACK_FADE = [
  'rgba(0, 0, 0, 0)',
  'rgba(0, 0, 0, 0.42)',
  'rgba(0, 0, 0, 0.72)',
  'rgba(0, 0, 0, 0.84)',
] as const;
const IMMERSIVE_BOTTOM_BLACK_FADE_LOCATIONS = [0, 0.32, 0.68, 1] as const;
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
/** Place du crayon sous le cœur (taille disque + écart). */
const IMMERSIVE_EDIT_UNDER_FAVORITE = scale(32) + verticalScale(8);
/** Légende overlay : ~5 lignes, puis scroll — pas 32 % d’écran blanc. */
const IMMERSIVE_CAPTION_LINE_H = scale(23);
const IMMERSIVE_CAPTION_ON_MEDIA_MAX_H = IMMERSIVE_CAPTION_LINE_H * 5;
/** Hauteur mini / maxi du dégradé au-dessus du texte (s’adapte à la légende). */
const IMMERSIVE_CAPTION_FADE_PAD_MIN = verticalScale(36);
const IMMERSIVE_CAPTION_FADE_PAD_MAX = verticalScale(96);
/** ~chars / ligne pour estimer la hauteur avant mesure (évite le 2ᵉ bandeau). */
const IMMERSIVE_CAPTION_CHARS_PER_LINE = 36;

function immersiveCaptionFadePadTop(captionTextH: number): number {
  const h = Math.max(0, captionTextH);
  /** ~0.75× le texte + base : une ligne → bandeau court ; 5 lignes → montée haute. */
  const scaled = Math.round(h * 0.75 + verticalScale(28));
  return Math.min(
    IMMERSIVE_CAPTION_FADE_PAD_MAX,
    Math.max(IMMERSIVE_CAPTION_FADE_PAD_MIN, scaled),
  );
}

/** Estimation avant `onContentSizeChange` — pad stable dès le 1er paint. */
function estimateImmersiveCaptionTextHeight(paragraphs: string[]): number {
  if (paragraphs.length === 0) return IMMERSIVE_CAPTION_LINE_H;
  let lines = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const len = paragraphs[i]?.length ?? 0;
    lines += Math.max(1, Math.ceil(len / IMMERSIVE_CAPTION_CHARS_PER_LINE));
    if (i > 0) lines += 0; /* gap géré à part */
  }
  const gaps = Math.max(0, paragraphs.length - 1) * verticalScale(8);
  const raw = lines * IMMERSIVE_CAPTION_LINE_H + gaps;
  return Math.min(IMMERSIVE_CAPTION_ON_MEDIA_MAX_H, Math.max(IMMERSIVE_CAPTION_LINE_H, raw));
}

function immersiveVideoSeekFraction(locationX: number, trackWidth: number): number {
  if (trackWidth <= 0) return 0;
  return Math.max(0, Math.min(1, locationX / trackWidth));
}

function ImmersiveVideoSeekBar({
  player,
  durationMillis,
  bottomInset,
  onSeekStart,
  onSeek,
  onSeekEnd,
}: {
  player: VideoPlayer;
  durationMillis: number;
  bottomInset: number;
  onSeekStart: () => void;
  onSeek: (positionMillis: number) => void;
  onSeekEnd: () => void;
}) {
  const [positionMillis, setPositionMillis] = useState(() =>
    Math.round((player.currentTime || 0) * 1000),
  );
  const scrubbingRef = useRef(false);
  const trackWidthRef = useRef(0);

  useEffect(() => {
    player.timeUpdateEventInterval = 0.25;
    const timeSub = player.addListener('timeUpdate', payload => {
      if (!scrubbingRef.current) {
        setPositionMillis(Math.round(payload.currentTime * 1000));
      }
    });
    setPositionMillis(Math.round((player.currentTime || 0) * 1000));
    return () => {
      timeSub.remove();
      try {
        player.timeUpdateEventInterval = 0;
      } catch {
        /* lecteur libéré */
      }
    };
  }, [player]);

  const progress =
    durationMillis > 0
      ? Math.max(0, Math.min(1, positionMillis / durationMillis))
      : 0;

  const applySeek = useCallback(
    (locationX: number) => {
      const w = trackWidthRef.current;
      if (w <= 0 || durationMillis <= 0) return;
      const frac = immersiveVideoSeekFraction(locationX, w);
      const next = Math.round(frac * durationMillis);
      setPositionMillis(next);
      onSeek(next);
    },
    [durationMillis, onSeek],
  );

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: e => {
          scrubbingRef.current = true;
          onSeekStart();
          applySeek(e.nativeEvent.locationX);
        },
        onPanResponderMove: e => {
          applySeek(e.nativeEvent.locationX);
        },
        onPanResponderRelease: () => {
          scrubbingRef.current = false;
          onSeekEnd();
        },
        onPanResponderTerminate: () => {
          scrubbingRef.current = false;
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

type ViewerBoot = {
  memories: Memory[];
  initialIndex: number;
  visibleItemKey: string | null;
  familyChildren: Child[];
  child: Child | null;
  sharedElement: ImmersiveSharedElement | null;
};

function readViewerBoot(parsedInitial: number): ViewerBoot | null {
  const payload = peekMemoryViewerSession();
  if (!payload?.memories?.length) return null;
  const memoryIdx = Number.isFinite(parsedInitial)
    ? Math.min(Math.max(0, parsedInitial), payload.memories.length - 1)
    : Math.min(Math.max(0, payload.initialIndex), payload.memories.length - 1);
  const flatIdx = resolveImmersiveViewerInitialIndex(
    payload.memories,
    memoryIdx,
    payload.initialAlbumPhotoIndex,
  );
  const items = buildImmersiveViewerItems(payload.memories);
  const opened = items[flatIdx];
  const sessionFamily = payload.familyChildren?.length
    ? sortChildrenByBirthdateAsc(payload.familyChildren)
    : sortChildrenByBirthdateAsc(listLocalChildren());
  const cid = payload.memories[0]?.child_id;
  const shared = payload.sharedElement;
  const usable =
    shared && shared.uri.trim() && shared.origin.width > 8 && shared.origin.height > 8
      ? shared
      : null;
  return {
    memories: payload.memories,
    initialIndex: flatIdx,
    visibleItemKey: opened ? immersiveViewerItemKey(opened) : null,
    familyChildren: sessionFamily,
    child: sessionFamily.find(c => c.id === cid) ?? sessionFamily[0] ?? null,
    sharedElement: usable,
  };
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
  const feedChrome = useMemo(
    () => filFeedChromeInsets(insets.top, insets.bottom),
    [insets.top, insets.bottom],
  );
  const rawIdx = useLocalSearchParams<{ initialIndex?: string | string[] }>().initialIndex;
  const initialIndexParam = Array.isArray(rawIdx) ? rawIdx[0] : rawIdx;
  const parsedInitial = initialIndexParam ? Number.parseInt(initialIndexParam, 10) : 0;

  const bootRef = useRef<ViewerBoot | null | undefined>(undefined);
  if (bootRef.current === undefined) {
    bootRef.current = readViewerBoot(Number.isFinite(parsedInitial) ? parsedInitial : Number.NaN);
  }
  const boot = bootRef.current;
  const sharedElement = boot?.sharedElement ?? null;
  /** Clé d’ouverture figée — pour le handoff vidéo et savoir si on a swipé. */
  const bootOpenedItemKeyRef = useRef(sharedElement?.openedItemKey ?? null);
  /** Hero affiché (peut être re-pointé vers la vignette courante après swipe). */
  const [heroShared, setHeroShared] = useState<ImmersiveSharedElement | null>(sharedElement);
  const handoffMemory =
    sharedElement
      ? (boot?.memories.find(m => m.id === sharedElement.openedItemKey && m.type === 'video') ??
        null)
      : null;
  const handoffVideoId = handoffMemory?.id ?? null;
  /** Audio : diaphragme cadre. Photo : zoom interpolé (plus fluide ressenti). */
  const heroExpandFrameOnly = useMemo(() => {
    if (!sharedElement) return false;
    const openedId = sharedElement.openedItemKey.replace(/-album-\d+$/, '');
    const m = boot?.memories.find(row => row.id === openedId);
    return m?.type === 'voice';
  }, [sharedElement, boot?.memories]);
  const pooledHandoffUri =
    (handoffVideoId ? peekPooledVideoUri(handoffVideoId) : null) ||
    (handoffMemory
      ? getCachedFeedVideoPlaybackUri(handoffMemory.id) ||
        optimisticFeedLocalVideoPlaybackUri(handoffMemory)
      : null) ||
    null;
  const keepAliveVideoIdRef = useRef<string | null>(handoffVideoId);

  const [memories, setMemories] = useState<Memory[]>(() => boot?.memories ?? []);
  const [initialIndex] = useState(() => boot?.initialIndex ?? 0);
  const [child, setChild] = useState<Child | null>(() => boot?.child ?? null);
  const [familyChildren, setFamilyChildren] = useState<Child[]>(
    () => boot?.familyChildren ?? sortChildrenByBirthdateAsc(listLocalChildren()),
  );
  const [visibleItemKey, setVisibleItemKey] = useState<string | null>(
    () => boot?.visibleItemKey ?? null,
  );
  const heroAttached =
    !!handoffVideoId && visibleItemKey === (sharedElement?.openedItemKey ?? null);
  const heroPlayer = useSharedVideoPlayer(
    heroAttached ? handoffVideoId : null,
    heroAttached ? pooledHandoffUri : null,
  );
  /** Pool déjà chaud depuis le fil — avant le `useEffect` du hook. */
  const heroSurfacePlayer =
    heroPlayer ?? (heroAttached && handoffVideoId ? peekPooledVideoPlayer(handoffVideoId) : null);
  const [editingCaptionMemory, setEditingCaptionMemory] = useState<Memory | null>(null);
  const [interactionReady, setInteractionReady] = useState(!sharedElement);
  /** Retour vidéo : calque clip = vignette avant crossfade. */
  const [heroFitClipToThumb, setHeroFitClipToThumb] = useState(false);
  /** Retour vidéo : player détaché — le fil est seul propriétaire de la surface. */
  const [heroSurfaceYielded, setHeroSurfaceYielded] = useState(false);
  const listRef = useRef<FlatList<ImmersiveViewerItem>>(null);
  const innerScrollLockCountRef = useRef(0);
  const [pagerScrollEnabled, setPagerScrollEnabled] = useState(true);
  /** Pinch photo actif : coupe dismiss + pager. */
  const [photoZoomActive, setPhotoZoomActive] = useState(false);
  const toggleFavorite = useToggleFavorite(setMemories);

  const enterProgress = useSharedValue(sharedElement ? 1 : 0);
  const dismissY = useSharedValue(0);
  const chromeGate = useSharedValue(0);
  const contentReveal = useSharedValue(sharedElement ? 0 : 1);
  const backdropOpacity = useSharedValue(sharedElement ? 0 : 0);
  const sharedModeSV = useSharedValue(sharedElement ? 1 : 0);
  const heroProgress = useSharedValue(0);
  const heroOpacity = useSharedValue(sharedElement ? 1 : 0);
  /** Actif au retour seulement : le clone s’efface en arrivant sur la vignette. */
  const heroLandFade = useSharedValue(0);
  /** Dégradé bas : timing sans rebond. Texte : spring, légèrement après. */
  const captionScrimReveal = useSharedValue(0);
  const captionTextReveal = useSharedValue(0);
  const origin = sharedElement?.origin;
  const heroFromX = useSharedValue(origin?.x ?? 0);
  const heroFromY = useSharedValue(origin?.y ?? 0);
  const heroFromW = useSharedValue(origin?.width ?? 0);
  const heroFromH = useSharedValue(origin?.height ?? 0);
  const heroToX = useSharedValue(0);
  const heroToY = useSharedValue(0);
  const heroToW = useSharedValue(windowW);
  const heroToH = useSharedValue(windowH);
  const isClosingRef = useRef(false);
  const sharedElementRef = useRef(sharedElement);
  const openedItemKeyRef = useRef(sharedElement?.openedItemKey ?? null);
  const visibleItemKeyRef = useRef(visibleItemKey);
  visibleItemKeyRef.current = visibleItemKey;
  /** Offset pager — source de vérité à la fermeture (viewability peut rester sur l’item d’ouverture). */
  const pagerOffsetYRef = useRef(initialIndex * windowH);
  const viewerItemsRef = useRef<ImmersiveViewerItem[]>([]);
  const itemHeightRef = useRef(windowH);
  itemHeightRef.current = windowH;

  /**
   * Recalcule la page visible depuis l’offset (pagingEnabled).
   * Sans ça, un swipe + fermeture ramène le fil sur le 1er souvenir ouvert.
   */
  const syncVisibleItemKeyFromPager = useCallback((): string | null => {
    const items = viewerItemsRef.current;
    const h = itemHeightRef.current;
    let key = visibleItemKeyRef.current;
    if (items.length > 0 && h > 0) {
      const index = Math.max(
        0,
        Math.min(items.length - 1, Math.round(pagerOffsetYRef.current / h)),
      );
      const item = items[index];
      if (item) {
        key = immersiveViewerItemKey(item);
        visibleItemKeyRef.current = key;
        setVisibleItemKey(prev => (prev === key ? prev : key));
      }
    }
    return key;
  }, []);
  const interactionReadyRef = useRef(interactionReady);
  interactionReadyRef.current = interactionReady;
  const windowSizeRef = useRef({ w: windowW, h: windowH });
  windowSizeRef.current = { w: windowW, h: windowH };

  const lockPagerScroll = useCallback(() => {
    innerScrollLockCountRef.current += 1;
    setPagerScrollEnabled(false);
  }, []);

  const unlockPagerScroll = useCallback(() => {
    innerScrollLockCountRef.current = Math.max(0, innerScrollLockCountRef.current - 1);
    if (innerScrollLockCountRef.current === 0) setPagerScrollEnabled(true);
  }, []);

  const handlePhotoZoomActiveChange = useCallback((active: boolean) => {
    setPhotoZoomActive(active);
  }, []);

  /** Si le spring dismiss est annulé, leaveViewer / release ne tournaient jamais. */
  const dismissSafetyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Snap déjà armé au début du dismiss (swipe) — éviter un 2ᵉ arm dans leaveViewer. */
  const dismissSnapArmedRef = useRef(false);

  const clearDismissSafetyTimer = useCallback(() => {
    if (!dismissSafetyTimerRef.current) return;
    clearTimeout(dismissSafetyTimerRef.current);
    dismissSafetyTimerRef.current = null;
  }, []);

  const leaveViewer = useCallback(() => {
    clearDismissSafetyTimer();
    setPhotoZoomActive(false);
    /**
     * Retour fil : souvenir de la page pager actuelle (pas celui d’ouverture).
     * Si le dismiss swipe a déjà armé le snap, ne pas réarmer (sinon 2ᵉ
     * applyImmersiveSnapHidden → flash / course avec le 1ᵉ).
     */
    if (!dismissSnapArmedRef.current) {
      const visibleKey = syncVisibleItemKeyFromPager();
      const memId = memoryIdFromImmersiveViewerItemKey(visibleKey);
      if (memId) {
        armFeedSnapToKeyOnFocus(memId, { animated: false });
      }
    }
    dismissSnapArmedRef.current = false;
    clearMemoryViewerSession();
    safeRouterBack(router, '/(tabs)');
  }, [clearDismissSafetyTimer, router, syncVisibleItemKeyFromPager]);

  const armDismissSafety = useCallback(() => {
    clearDismissSafetyTimer();
    dismissSafetyTimerRef.current = setTimeout(() => {
      dismissSafetyTimerRef.current = null;
      if (keepAliveVideoIdRef.current) {
        releaseVideoKeepAlive(keepAliveVideoIdRef.current);
        keepAliveVideoIdRef.current = null;
      }
      releaseAllVideoKeepAlive();
      leaveViewer();
    }, 2800);
  }, [clearDismissSafetyTimer, leaveViewer]);

  /**
   * Miroir de l’aller, sans trou noir :
   * — iOS : le hero garde la VideoView jusqu’à la 1ʳᵉ frame fil (dual OK), puis leave.
   * — Android : still Image (uri) avant release (media3 = 1 surface), puis leave.
   * Pas de detach « vide », pas de notify anticipé sur `playing`.
   */
  const finishVideoReturnCrossfade = useCallback(() => {
    const videoId = keepAliveVideoIdRef.current ?? handoffVideoId;
    if (videoId) cancelFeedVideoFirstFrameWait(videoId);
    setHeroFitClipToThumb(true);

    const runHandoff = async () => {
      await new Promise<void>(resolve => {
        requestAnimationFrame(() => resolve());
      });
      if (Platform.OS === 'android') {
        /** Still du shared-element : évite le rectangle noir pendant le vol de surface. */
        setHeroSurfaceYielded(true);
        await new Promise<void>(resolve => {
          requestAnimationFrame(() => resolve());
        });
      }
      if (keepAliveVideoIdRef.current) {
        releaseVideoKeepAlive(keepAliveVideoIdRef.current);
        keepAliveVideoIdRef.current = null;
      }
      if (videoId) {
        await waitForFeedVideoFirstFrame(videoId);
      }
      /** Fil déjà peint : fermer tout de suite — un fondu long sur un hero vide = 2ᵉ flash. */
      heroOpacity.value = 0;
      leaveViewer();
    };

    void runHandoff();
  }, [handoffVideoId, heroOpacity, leaveViewer]);
  /**
   * Hauteur réelle du bloc média de la page ouverte (la légende lui prend le bas).
   * Sans ça le clone finit plein écran et la photo « saute » à l’atterrissage.
   */
  const mediaAreaHRef = useRef<number | null>(null);
  /** Le zoom ne part qu’une fois — après, déplacer sa cible ferait sauter l’image. */
  const enterStartedRef = useRef(false);

  const applyHeroDest = useCallback(() => {
    heroToX.value = 0;
    heroToY.value = 0;
    heroToW.value = windowSizeRef.current.w;
    heroToH.value = mediaAreaHRef.current ?? windowSizeRef.current.h;
  }, [heroToH, heroToW, heroToX, heroToY]);

  const openCaptionChrome = useCallback(() => {
    captionScrimReveal.value = 0;
    captionTextReveal.value = 0;
    captionScrimReveal.value = withDelay(
      IMMERSIVE_CAPTION_SCRIM_DELAY_MS,
      withTiming(1, {
        duration: IMMERSIVE_CAPTION_SCRIM_IN_MS,
        easing: IMMERSIVE_SHARED_EASING,
      }),
    );
    captionTextReveal.value = withDelay(
      IMMERSIVE_CAPTION_TEXT_DELAY_MS,
      withSpring(1, MOTION_SPRING_SETTLE),
    );
  }, [captionScrimReveal, captionTextReveal]);

  const hideCaptionChrome = useCallback(() => {
    captionScrimReveal.value = withTiming(0, { duration: IMMERSIVE_CAPTION_OUT_MS });
    captionTextReveal.value = withTiming(0, { duration: IMMERSIVE_CAPTION_OUT_MS });
  }, [captionScrimReveal, captionTextReveal]);

  const onSharedEnterDone = useCallback(() => {
    setInteractionReady(true);
    /**
     * Vidéo : le clone **reste** la surface. Fonder vers la page attache un
     * 3ᵉ `VideoView` et iOS lâche le clone (opacité 0) → saccade à l’arrivée,
     * écran noir au retour.
     */
    if (handoffVideoId) return;
    contentReveal.value = 1;
    heroOpacity.value = withTiming(0, { duration: 220 });
  }, [contentReveal, handoffVideoId, heroOpacity]);

  const startSharedEnter = useCallback(() => {
    if (enterStartedRef.current) return;
    enterStartedRef.current = true;
    applyHeroDest();
    /** Spring : la photo dépasse de deux pixels et se pose, au lieu de s’arrêter net. */
    heroProgress.value = withSpring(1, MOTION_SPRING_ZOOM, finished => {
      if (finished) runOnJS(onSharedEnterDone)();
    });
    /**
     * Plafond à 1 : le style lit `min(backdrop, clamp(progress))` pour que header
     * + tab bar se fondent **avec** le zoom (pas un cut avant la photo).
     */
    backdropOpacity.value = 1;
    /**
     * Chrome lâché aux deux tiers de la course : plus tôt il se pose sur une photo
     * encore minuscule et le regard le manque, plus tard il paraît en retard.
     */
    chromeGate.value = withDelay(
      IMMERSIVE_CHROME_DELAY_MS,
      withTiming(1, { duration: 0 }),
    );
    openCaptionChrome();
  }, [
    applyHeroDest,
    backdropOpacity,
    chromeGate,
    heroProgress,
    onSharedEnterDone,
    openCaptionChrome,
  ]);

  const handleMediaAreaHeight = useCallback(
    (h: number) => {
      if (h <= 0 || mediaAreaHRef.current === h) return;
      mediaAreaHRef.current = h;
      if (!enterStartedRef.current) {
        /** Première mesure : partir avec la bonne cible plutôt que la corriger en vol. */
        startSharedEnter();
        return;
      }
      /** Course finie : la cible peut bouger (légende éditée, rotation) sans saccade. */
      if (interactionReadyRef.current) applyHeroDest();
    },
    [applyHeroDest, startSharedEnter],
  );

  const finishDismiss = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    /** Filet : spring annulé (`finished === false`) ne doit pas laisser keepAlive / modal collés. */
    armDismissSafety();
    /** Barre d’état rendue au fil tout de suite : sinon elle bascule après l’animation. */
    setStatusBarStyle('dark');

    const runFadeDismiss = () => {
      chromeGate.value = 0;
      hideCaptionChrome();
      enterProgress.value = withTiming(
        0,
        { duration: 200, easing: Easing.out(Easing.cubic) },
        finished => {
          if (finished) runOnJS(leaveViewer)();
        },
      );
      backdropOpacity.value = withTiming(0, { duration: 200 });
    };

    const runSharedDismiss = (shared: ImmersiveSharedElement) => {
      if (!isUsableSharedOrigin(shared.origin) || !shared.uri.trim()) {
        runFadeDismiss();
        return;
      }
      sharedElementRef.current = shared;
      openedItemKeyRef.current = shared.openedItemKey;
      setHeroShared(shared);

      const returnToHandoffVideo =
        !!handoffVideoId &&
        visibleItemKeyRef.current === bootOpenedItemKeyRef.current;

      const startSpring = () => {
        chromeGate.value = 0;
        hideCaptionChrome();
        const thumb = shared.origin;
        const dest = {
          x: 0,
          y: 0,
          width: windowSizeRef.current.w,
          height: mediaAreaHRef.current ?? windowSizeRef.current.h,
        };
        heroFromX.value = thumb.x;
        heroFromY.value = thumb.y;
        heroFromW.value = thumb.width;
        heroFromH.value = thumb.height;
        if (interactionReadyRef.current) {
          const dragged = draggedFullscreenRect(
            dest,
            dismissY.value,
            IMMERSIVE_DISMISS_DISTANCE,
          );
          heroToX.value = dragged.x;
          heroToY.value = dragged.y;
          heroToW.value = dragged.width;
          heroToH.value = dragged.height;
          heroProgress.value = 1;
        }
        heroOpacity.value = 1;
        heroLandFade.value = returnToHandoffVideo ? 0 : 1;
        contentReveal.value = 0;
        dismissY.value = 0;
        backdropOpacity.value = withTiming(0, {
          duration: IMMERSIVE_SHARED_BACKDROP_OUT_MS,
          easing: IMMERSIVE_SHARED_EASING,
        });
        heroProgress.value = withSpring(
          0,
          { ...MOTION_SPRING_ZOOM, overshootClamping: true },
          finished => {
            if (!finished) return;
            if (returnToHandoffVideo) {
              runOnJS(finishVideoReturnCrossfade)();
            } else {
              runOnJS(leaveViewer)();
            }
          },
        );
      };

      /** Laisser peindre le nouveau URI hero avant le spring (retour après swipe). */
      requestAnimationFrame(() => {
        requestAnimationFrame(startSpring);
      });
    };

    const visibleKey = syncVisibleItemKeyFromPager();
    const bootKey = bootOpenedItemKeyRef.current;
    const currentShared = sharedElementRef.current;

    if (currentShared && visibleKey && visibleKey === bootKey) {
      runSharedDismiss(currentShared);
      return;
    }

    /** Après swipe : scroller le fil sous le modal, re-mesurer la vignette, même shrink. */
    const memId = memoryIdFromImmersiveViewerItemKey(visibleKey);
    if (memId && visibleKey) {
      dismissSnapArmedRef.current = true;
      armFeedSnapToKeyOnFocus(memId, { animated: false });
      const tryMeasure = (attempt: number) => {
        measureFeedImmersiveHost(visibleKey, measured => {
          if (measured) {
            runSharedDismiss(measured);
            return;
          }
          if (attempt < 5) {
            setTimeout(() => tryMeasure(attempt + 1), 56);
            return;
          }
          runFadeDismiss();
        });
      };
      /**
       * Attendre le snap fil (opacity 0 + scrollToIndex ~140ms) avant de mesurer
       * la vignette cible — sinon on mesure encore la carte d’ouverture.
       */
      setTimeout(() => {
        requestAnimationFrame(() => tryMeasure(0));
      }, 160);
      return;
    }

    runFadeDismiss();
  }, [
    backdropOpacity,
    chromeGate,
    contentReveal,
    dismissY,
    enterProgress,
    heroFromH,
    heroFromW,
    heroFromX,
    heroFromY,
    heroLandFade,
    heroOpacity,
    heroProgress,
    heroToH,
    heroToW,
    heroToX,
    heroToY,
    armDismissSafety,
    handoffVideoId,
    hideCaptionChrome,
    leaveViewer,
    finishVideoReturnCrossfade,
    syncVisibleItemKeyFromPager,
  ]);

  useEffect(
    () => () => {
      clearDismissSafetyTimer();
      if (keepAliveVideoIdRef.current) {
        releaseVideoKeepAlive(keepAliveVideoIdRef.current);
        keepAliveVideoIdRef.current = null;
      }
      releaseAllVideoKeepAlive();
      if (handoffVideoId) cancelFeedVideoFirstFrameWait(handoffVideoId);
    },
    [clearDismissSafetyTimer, handoffVideoId],
  );

  const requestClose = useCallback(() => {
    if (isClosingRef.current) return;
    finishDismiss();
  }, [finishDismiss]);

  useEffect(() => {
    applyHeroDest();
  }, [applyHeroDest, windowH, windowW]);

  useEffect(() => {
    if (sharedElement) {
      /** Filet : si le bloc média ne se mesure pas, on part sur la fenêtre entière. */
      const fallback = setTimeout(startSharedEnter, IMMERSIVE_MEASURE_GRACE_MS);
      return () => clearTimeout(fallback);
    }
    enterStartedRef.current = true;
    enterProgress.value = withTiming(1, {
      duration: IMMERSIVE_ENTER_MS,
      easing: Easing.out(Easing.cubic),
    });
    backdropOpacity.value = withTiming(1, {
      duration: IMMERSIVE_ENTER_MS,
      easing: Easing.out(Easing.cubic),
    });
    setInteractionReady(true);
    chromeGate.value = 1;
    openCaptionChrome();
    // Boot unique à l’ouverture du viewer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      requestClose();
      return true;
    });
    return () => sub.remove();
  }, [requestClose]);

  /**
   * Si on quitte la vidéo d’ouverture (pager), la page reprend le relais.
   * Sinon le clone resterait collé au souvenir d’origine.
   */
  useEffect(() => {
    if (!handoffVideoId || !sharedElement || !interactionReady) return;
    const onOpened = visibleItemKey === openedItemKeyRef.current;
    if (onOpened) {
      contentReveal.value = 0;
      heroOpacity.value = 1;
      return;
    }
    contentReveal.value = 1;
    heroOpacity.value = withTiming(0, { duration: 160 });
  }, [
    contentReveal,
    handoffVideoId,
    heroOpacity,
    interactionReady,
    sharedElement,
    visibleItemKey,
  ]);

  const backdropAnimStyle = useAnimatedStyle(() => {
    const drag = Math.max(0, dismissY.value);
    const dragProgress = Math.min(drag / IMMERSIVE_DISMISS_DISTANCE, 1);
    const shared = sharedModeSV.value === 1;
    /**
     * Shared : le fond ne dépasse jamais la course du zoom à l’aller
     * (chrome Fil visible tant que la photo n’a pas « mangé » l’écran).
     * Au retour, `backdropOpacity` redescend tôt → le fil réapparaît avant l’atterrissage.
     */
    const progressClamped = Math.min(1, Math.max(0, heroProgress.value));
    const base = shared
      ? Math.min(backdropOpacity.value, progressClamped)
      : backdropOpacity.value;
    return {
      opacity: base * (1 - dragProgress * 0.55),
    };
  });

  const contentAnimStyle = useAnimatedStyle(() => {
    const drag = Math.max(0, dismissY.value);
    const dragProgress = Math.min(drag / IMMERSIVE_DISMISS_DISTANCE, 1);
    const shared = sharedModeSV.value === 1;
    const enterScale = shared ? 1 : interpolate(enterProgress.value, [0, 1], [0.94, 1]);
    const enterOp = shared ? 1 : enterProgress.value;
    return {
      opacity: enterOp * (1 - dragProgress * 0.45),
      transform: [
        { translateY: drag },
        { scale: enterScale * (1 - dragProgress * 0.08) },
      ],
    };
  });

  const dismissPan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(interactionReady && !photoZoomActive)
        .activeOffsetY(IMMERSIVE_DISMISS_ACTIVE_Y)
        .failOffsetX([-28, 28])
        .onStart(() => {
          runOnJS(lockPagerScroll)();
        })
        .onUpdate(e => {
          dismissY.value = Math.max(0, e.translationY);
        })
        .onEnd(e => {
          const shouldClose =
            dismissY.value > IMMERSIVE_DISMISS_DISTANCE || e.velocityY > IMMERSIVE_DISMISS_VELOCITY;
          if (shouldClose) {
            runOnJS(finishDismiss)();
          } else {
            dismissY.value = withSpring(0, { damping: 22, stiffness: 220 });
            runOnJS(unlockPagerScroll)();
          }
        })
        .onFinalize((_e, success) => {
          if (!success && dismissY.value < IMMERSIVE_DISMISS_DISTANCE) {
            runOnJS(unlockPagerScroll)();
          }
        }),
    [
      dismissY,
      finishDismiss,
      interactionReady,
      lockPagerScroll,
      photoZoomActive,
      unlockPagerScroll,
    ],
  );

  const viewerItems = useMemo(() => buildImmersiveViewerItems(memories), [memories]);
  viewerItemsRef.current = viewerItems;

  useEffect(() => {
    if (!boot?.memories.length) {
      safeRouterBack(router, '/(tabs)');
      return;
    }
    const memCid = boot.memories[0]?.child_id;
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
  }, [boot, router]);

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
      const key = immersiveViewerItemKey(item);
      setVisibleItemKey(key);
      visibleItemKeyRef.current = key;
      pagerOffsetYRef.current = next * itemHeightRef.current;
      listRef.current?.scrollToIndex({ index: next, animated: true });
    },
    [viewerItems],
  );

  /** Posts texte : pager vertical coupé — navigation via flèches uniquement. */
  const flatListScrollEnabled = !isTextViewerPage && pagerScrollEnabled && !photoZoomActive;

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(closeOnMediaChrome ? 'light' : 'dark');
      void ensurePlaybackAudioForListening();
      // Retour depuis /write : recharger titre + corps depuis SQLite (local-first).
      setMemories(prev => {
        let changed = false;
        const next = prev.map(m => {
          const fresh = getLocalMemoryById(m.id);
          if (!fresh) return m;
          if (
            fresh.content === m.content &&
            (fresh.text_title ?? null) === (m.text_title ?? null)
          ) {
            return m;
          }
          changed = true;
          return { ...m, content: fresh.content, text_title: fresh.text_title };
        });
        return changed ? next : prev;
      });
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
    /** Ne pas effacer la clé si la liste est vide un instant (seuil / recycle). */
    if (viewableItems.length === 0) return;
    let best = viewableItems[0];
    for (let i = 1; i < viewableItems.length; i++) {
      const cur = viewableItems[i];
      const bestPct = best?.percentVisible ?? 0;
      const curPct = cur?.percentVisible ?? 0;
      if (curPct > bestPct || (curPct === bestPct && (cur?.index ?? 0) > (best?.index ?? 0))) {
        best = cur;
      }
    }
    const item = best?.item as ImmersiveViewerItem | undefined;
    if (!item) return;
    const key = immersiveViewerItemKey(item);
    visibleItemKeyRef.current = key;
    setVisibleItemKey(key);
    if (typeof best?.index === 'number' && best.index >= 0) {
      pagerOffsetYRef.current = best.index * itemHeightRef.current;
    }
  }, []);

  const onPagerScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    pagerOffsetYRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  const onPagerMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      pagerOffsetYRef.current = e.nativeEvent.contentOffset.y;
      syncVisibleItemKeyFromPager();
    },
    [syncVisibleItemKeyFromPager],
  );

  const immersiveViewabilityConfig = useMemo(
    () => ({ itemVisiblePercentThreshold: 55 }),
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
      const itemKey = immersiveViewerItemKey(item);
      return (
        <ImmersivePage
          memory={memory}
          isActive={isFocused && visibleItemKey === itemKey}
          viewerFocused={isFocused}
          onMediaAreaHeight={
            itemKey === openedItemKeyRef.current ? handleMediaAreaHeight : undefined
          }
          height={itemHeight}
          width={windowW}
          albumPhotoSlot={albumSlot}
          familyChildren={familyChildren}
          onRequestEditText={m => {
            if (m.id.startsWith('pending_')) return;
            if (m.type === 'text') {
              router.push({ pathname: '/write', params: { memoryId: m.id } });
              return;
            }
            setEditingCaptionMemory(m);
          }}
          toggleFavorite={toggleFavorite}
          onFavoritePhotoUrlsUpdated={urls => handleFavoritePhotoUrlsUpdated(memory.id, urls)}
          onInnerScrollLock={lockPagerScroll}
          onInnerScrollUnlock={unlockPagerScroll}
          showTextMarginNav={showTextMarginNav}
          canTextNavPrev={index > 0}
          canTextNavNext={index < viewerItems.length - 1}
          onTextNavPrev={() => goToViewerIndex(index - 1)}
          onTextNavNext={() => goToViewerIndex(index + 1)}
          heroHoldsVideoSurface={
            !!handoffVideoId &&
            memory.type === 'video' &&
            itemKey === openedItemKeyRef.current
          }
          captionFadeResizeReady={interactionReady}
          captionScrimReveal={captionScrimReveal}
          captionTextReveal={captionTextReveal}
          onPhotoZoomActiveChange={handlePhotoZoomActiveChange}
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
      handleMediaAreaHeight,
      isFocused,
      router,
      handoffVideoId,
      interactionReady,
      captionScrimReveal,
      captionTextReveal,
      handlePhotoZoomActiveChange,
    ],
  );

  const handleSaveCaptionEdit = useCallback(
    async (text: string) => {
      const target = editingCaptionMemory;
      if (!target) return;
      setMemories(prev => prev.map(m => (m.id === target.id ? { ...m, content: text } : m)));
      const ok = await updateMemoryContent(target.id, text);
      if (!ok) {
        Alert.alert(
          'Connexion',
          "Ton texte est bien enregistré sur l’app, mais la synchronisation a échoué. Réessaie plus tard."
        );
      }
      setEditingCaptionMemory(null);
    },
    [editingCaptionMemory],
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
    <ImmersiveChromeGateProvider gate={chromeGate}>
      <GestureDetector gesture={dismissPan}>
        <Reanimated.View
          style={[styles.root, styles.viewerShell, { minHeight: windowH }]}
        >
          <Reanimated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFillObject, { backgroundColor: BG }, backdropAnimStyle]}
          />
          <Reanimated.View style={[styles.viewerContent, contentAnimStyle]}>
            <StatusBar style={closeOnMediaChrome ? 'light' : 'dark'} />
            <EditTextModal
              key={editingCaptionMemory?.id ?? 'caption-edit-closed'}
              visible={editingCaptionMemory !== null}
              initialText={editingCaptionMemory?.content ?? ''}
              previewVariant={feedMemoryTextEditPreviewVariant(editingCaptionMemory?.type)}
              bookLineBudget={bookLineBudgetForMemoryType(editingCaptionMemory?.type)}
              bookCharsPerLine={bookCharsPerLineForMemoryType(editingCaptionMemory?.type)}
              title={
                editingCaptionMemory?.content?.trim()
                  ? 'Modifier l’annotation'
                  : 'Annoter'
              }
              onClose={() => setEditingCaptionMemory(null)}
              onSave={handleSaveCaptionEdit}
            />
            <ImmersiveChromeReveal
              from="top"
              style={[
                styles.closeBtn,
                closeOnMediaChrome ? styles.closeBtnOnMedia : styles.closeBtnOnText,
                { top: insets.top + verticalScale(8), right: scale(12) },
              ]}
            >
              <MotionPressable
                onPress={requestClose}
                hitSlop={14}
                accessibilityRole="button"
                accessibilityLabel="Fermer"
                style={styles.closeBtnHit}
              >
                <X
                  color={closeOnMediaChrome ? TOP_CHROME_TEXT : THEME.textPrimary}
                  size={scale(28)}
                  strokeWidth={2.2}
                />
              </MotionPressable>
            </ImmersiveChromeReveal>

            {/* Le masque de zoom ne couvre que les médias des pages, pas leur chrome. */}
            <ImmersiveMediaRevealProvider reveal={contentReveal}>
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
                onScroll={onPagerScroll}
                onMomentumScrollEnd={onPagerMomentumScrollEnd}
                scrollEventThrottle={16}
                removeClippedSubviews
                // Pages voisines montées après le zoom : sinon leur rendu le hache.
                windowSize={interactionReady ? 3 : 1}
                maxToRenderPerBatch={interactionReady ? 2 : 1}
                initialNumToRender={1}
                onScrollToIndexFailed={({ index }) => {
                  const offset = index * itemHeight;
                  pagerOffsetYRef.current = offset;
                  listRef.current?.scrollToOffset({
                    offset,
                    animated: false,
                  });
                }}
              />
            </ImmersiveMediaRevealProvider>
          </Reanimated.View>
          {heroShared ? (
            <ImmersiveSharedElementHero
              uri={heroShared.uri}
              recyclingKey={heroShared.openedItemKey}
              fromX={heroFromX}
              fromY={heroFromY}
              fromW={heroFromW}
              fromH={heroFromH}
              toX={heroToX}
              toY={heroToY}
              toW={heroToW}
              toH={heroToH}
              progress={heroProgress}
              opacity={heroOpacity}
              landFade={heroLandFade}
              cornerRadius={heroShared.cornerRadius}
              videoHandoff={
                !!handoffVideoId &&
                heroShared.openedItemKey === bootOpenedItemKeyRef.current
              }
              fitClipToThumb={heroFitClipToThumb}
              surfaceYielded={heroSurfaceYielded}
              expandFrameOnly={
                heroExpandFrameOnly &&
                heroShared.openedItemKey === bootOpenedItemKeyRef.current
              }
              feedChromeTop={feedChrome.top}
              feedChromeBottom={feedChrome.bottom}
              player={
                !heroSurfaceYielded &&
                handoffVideoId &&
                visibleItemKey === bootOpenedItemKeyRef.current &&
                heroShared.openedItemKey === bootOpenedItemKeyRef.current
                  ? heroSurfacePlayer
                  : undefined
              }
            />
          ) : null}
        </Reanimated.View>
      </GestureDetector>
    </ImmersiveChromeGateProvider>
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
  onMediaAreaHeight,
  heroHoldsVideoSurface,
  viewerFocused,
  captionFadeResizeReady = true,
  captionScrimReveal,
  captionTextReveal,
  onPhotoZoomActiveChange,
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
  /** Renseigné pour la seule page ouverte depuis le fil (cible du zoom). */
  onMediaAreaHeight?: (h: number) => void;
  /** Le clone immersif affiche déjà cette vidéo : ne pas monter une 2ᵉ surface. */
  heroHoldsVideoSurface?: boolean;
  /** Le viewer a encore le focus : à la fermeture on ne pause pas le lecteur partagé. */
  viewerFocused?: boolean;
  /**
   * Après l’entrée shared-element : autorise le redimensionnement du dégradé
   * légende (évite setState pendant le spring → saccades).
   */
  captionFadeResizeReady?: boolean;
  /** Dégradé bas (timing, sans rebond). */
  captionScrimReveal: SharedValue<number>;
  /** Texte légende (spring / rebond). */
  captionTextReveal: SharedValue<number>;
  onPhotoZoomActiveChange?: (active: boolean) => void;
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
  const textTopInset = insets.top + verticalScale(52);
  const textBottomReserve = insets.bottom + verticalScale(20);
  const textViewportH = useMemo(
    () => Math.max(verticalScale(220), height - textTopInset - textBottomReserve),
    [height, textTopInset, textBottomReserve],
  );
  const overlayBottomInset = immersiveOverlayBottomInset(insets.bottom);
  const [videoSoundOn, setVideoSoundOn] = useState(true);
  const memoryEditorialFont = useMemoryEditorialFont();
  const [captionTextH, setCaptionTextH] = useState(0);

  const captionParagraphs = useMemo(() => {
    const raw = (memory.content ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!raw) return [];
    const parts = raw.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [raw];
  }, [memory.content]);

  const captionFadePadTop = useMemo(() => {
    const h =
      captionTextH > 0
        ? captionTextH
        : estimateImmersiveCaptionTextHeight(captionParagraphs);
    return immersiveCaptionFadePadTop(h);
  }, [captionTextH, captionParagraphs]);

  useEffect(() => {
    setVideoSoundOn(true);
  }, [memory.id]);

  useEffect(() => {
    setCaptionTextH(0);
  }, [memory.id, memory.content]);

  const onCaptionViewportHeight = useCallback((h: number) => {
    setCaptionTextH(prev => (prev === h ? prev : h));
  }, []);

  const captionScrimStyle = useAnimatedStyle(() => {
    const p = captionScrimReveal.value;
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * 10 }],
    };
  });

  const captionTextStyle = useAnimatedStyle(() => {
    const p = captionTextReveal.value;
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * MOTION_ENTER_TRANSLATE_PX }],
    };
  });

  const metaBlock = (
    <View style={styles.metaStack}>
      <Text
        style={[
          mediaChrome ? styles.metaDateOnMedia : styles.metaDateOnText,
          loadedFontStyle(feedDateFontFamily) ?? styles.metaDateSystem,
        ]}
        numberOfLines={1}
      >
        {postDateLabel}
        {loc ? ` · ${loc}` : ''}
      </Text>
      {!!ageAt ? (
        <Text
          style={[
            mediaChrome ? styles.metaAgeOnMedia : styles.metaAgeOnText,
            loadedFontStyle(feedAgeFontFamily) ?? styles.metaAgeSystem,
          ]}
          numberOfLines={2}
        >
          {ageAt}
        </Text>
      ) : null}
    </View>
  );

  const editFabBottom =
    overlayBottomInset +
    (memory.type === 'video' && isActive ? IMMERSIVE_VIDEO_SCRUBBER_RESERVE : 0);
  /** Cœur au-dessus du crayon (même colonne bas-droite). */
  const favoriteBottomInset = editFabBottom + IMMERSIVE_EDIT_UNDER_FAVORITE;

  return (
    /**
     * Fond transparent : la couleur vient du backdrop animé du viewer, sinon la page
     * masquerait le fil dès la première frame du zoom.
     */
    <View style={{ height, width }}>
      <View
        style={styles.pageBody}
        onLayout={
          onMediaAreaHeight
            ? e => onMediaAreaHeight(e.nativeEvent.layout.height)
            : undefined
        }
      >
        <View style={styles.mediaFill}>
          {memory.type === 'photo' && (
            <ImmersivePhoto
              memory={memory}
              albumPhotoSlot={albumPhotoSlot}
              isActive={isActive}
              onZoomActiveChange={onPhotoZoomActiveChange}
            />
          )}
          {memory.type === 'video' && (
            <ImmersiveVideo
              memory={memory}
              isActive={isActive}
              viewerFocused={viewerFocused !== false}
              soundOn={videoSoundOn}
              overlayBottomInset={overlayBottomInset}
              heroHoldsSurface={!!heroHoldsVideoSurface}
            />
          )}
          {memory.type === 'voice' && (
            <ImmersiveVoice
              memory={memory}
              width={width}
              mountPlayer={captionFadeResizeReady}
            />
          )}
          {memory.type === 'text' && (
            <ImmersiveText
              memory={memory}
              topInset={textTopInset}
              viewportHeight={textViewportH}
              onTapEdit={() => onRequestEditText(memory)}
              onToggleFavorite={toggleFavorite}
              overlayBottomInset={favoriteBottomInset}
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
            {/* Le bandeau noir se pose avec la photo : même vague que les pastilles. */}
            <ImmersiveChromeReveal
              from="none"
              withScale={false}
              style={[styles.topMediaGradient, { height: topFadeHeight }]}
            >
              <LinearGradient
                colors={[...IMMERSIVE_TOP_BLACK_FADE]}
                locations={[0, 0.5, 1]}
                pointerEvents="none"
                style={StyleSheet.absoluteFillObject}
              />
            </ImmersiveChromeReveal>
            <ImmersiveChromeReveal
              from="top"
              withScale={false}
              style={[styles.topChromeFloat, { paddingTop: topChromePadTop }]}
            >
              {metaBlock}
              {memory.type === 'video' && isActive ? (
                <MotionPressable
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
                </MotionPressable>
              ) : null}
            </ImmersiveChromeReveal>
            {albumPhotoSlot && albumPhotoSlot.total > 1 ? (
              <ImmersiveChromeReveal order={2} style={styles.albumPageBadge}>
                <Text style={styles.albumPageBadgeText}>
                  {albumPhotoSlot.index + 1} / {albumPhotoSlot.total}
                </Text>
              </ImmersiveChromeReveal>
            ) : null}
          </>
        ) : (
          <ImmersiveChromeReveal
            from="top"
            withScale={false}
            style={[styles.topTextMeta, { paddingTop: topChromePadTop }]}
          >
            {metaBlock}
          </ImmersiveChromeReveal>
        )}

        <ImmersiveChromeReveal
          order={2}
          style={[
            styles.editTextFab,
            mediaChrome ? styles.editTextFabOnMedia : styles.editTextFabOnText,
            { bottom: scale(12) + editFabBottom },
          ]}
        >
          <MotionPressable
            onPress={() => onRequestEditText(memory)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={
              memory.type === 'text'
                ? 'Modifier le texte'
                : memory.content?.trim()
                  ? 'Modifier l’annotation'
                  : 'Ajouter une annotation'
            }
            style={styles.closeBtnHit}
          >
            <Pencil
              size={scale(16)}
              color={mediaChrome ? '#FFFFFF' : THEME.textPrimary}
              strokeWidth={2.2}
            />
          </MotionPressable>
        </ImmersiveChromeReveal>
        {mediaChrome && captionParagraphs.length > 0 ? (
          <Reanimated.View
            style={styles.captionOnMediaWrap}
            pointerEvents="box-none"
          >
            <Reanimated.View style={captionScrimStyle} pointerEvents="box-none">
              <LinearGradient
                colors={[...IMMERSIVE_BOTTOM_BLACK_FADE]}
                locations={[...IMMERSIVE_BOTTOM_BLACK_FADE_LOCATIONS]}
                style={[
                  styles.captionOnMediaGradient,
                  {
                    paddingTop: captionFadePadTop,
                    paddingBottom: overlayBottomInset,
                  },
                ]}
                pointerEvents="box-none"
              >
                <Reanimated.View
                  style={[
                    captionTextStyle,
                    memory.type === 'video' && isActive
                      ? { paddingBottom: IMMERSIVE_VIDEO_SCRUBBER_RESERVE }
                      : null,
                  ]}
                >
                  <ScrollableTextBlock
                    maxHeight={IMMERSIVE_CAPTION_ON_MEDIA_MAX_H}
                    fitToContent
                    showsVerticalScrollIndicator={false}
                    onViewportHeightChange={onCaptionViewportHeight}
                    onInnerScrollLock={onInnerScrollLock}
                    onInnerScrollUnlock={onInnerScrollUnlock}
                  >
                    {captionParagraphs.map((para, idx) => (
                      <Text
                        key={idx}
                        style={[
                          styles.captionOnMediaText,
                          loadedFontStyle(memoryEditorialFont),
                          idx > 0 && { marginTop: verticalScale(8) },
                        ]}
                        {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
                      >
                        {para}
                      </Text>
                    ))}
                  </ScrollableTextBlock>
                </Reanimated.View>
              </LinearGradient>
            </Reanimated.View>
          </Reanimated.View>
        ) : null}

        {mediaChrome ? (
          <ImmersiveMediaFavoriteChrome
            memory={memory}
            albumPhotoSlot={albumPhotoSlot}
            bottomInset={favoriteBottomInset}
            onToggleMemoryFavorite={toggleFavorite}
            onFavoritePhotoUrlsUpdated={onFavoritePhotoUrlsUpdated}
          />
        ) : null}
      </View>
    </View>
  );
}

/** Cœur favori au-dessus du dégradé d’annotation (frère du bandeau, zIndex plus haut). */
function ImmersiveMediaFavoriteChrome({
  memory,
  albumPhotoSlot,
  bottomInset,
  onToggleMemoryFavorite,
  onFavoritePhotoUrlsUpdated,
}: {
  memory: Memory;
  albumPhotoSlot?: AlbumPhotoSlot;
  bottomInset: number;
  onToggleMemoryFavorite: (id: string) => void | Promise<void>;
  onFavoritePhotoUrlsUpdated: (urls: string[]) => void;
}) {
  const favoritePhotoUrls = useMemo(() => parseFavoritePhotoUrls(memory), [memory]);
  const raw = (
    albumPhotoSlot?.uri ?? getPrimaryPhotoUriForImmersiveViewer(memory)
  ).trim();

  const handleTogglePhotoFavorite = useCallback(
    async (url: string) => {
      const next = await toggleFavoritePhotoUrl(memory.id, url);
      if (next) onFavoritePhotoUrlsUpdated(next);
    },
    [memory.id, onFavoritePhotoUrlsUpdated],
  );

  const photoFavorited = albumPhotoSlot
    ? isPhotoUrlFavoritedWithVariants(memory, favoritePhotoUrls, raw)
    : !!memory.is_favorite;

  const onPress = () => {
    if (memory.type === 'photo' && albumPhotoSlot && raw) {
      void handleTogglePhotoFavorite(raw);
      return;
    }
    void onToggleMemoryFavorite(memory.id);
  };

  return (
    <ImmersiveChromeReveal order={1} withScale={false} style={styles.mediaFavoriteLayer}>
      <FeedPhotoFavoriteOverlay
        isFavorite={
          memory.type === 'photo' ? photoFavorited : !!memory.is_favorite
        }
        inkOverride={memory.captured_overlay_ink}
        onPress={onPress}
        bottomInset={bottomInset}
      />
    </ImmersiveChromeReveal>
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
  isActive,
  onZoomActiveChange,
}: {
  memory: Memory;
  albumPhotoSlot?: AlbumPhotoSlot;
  isActive: boolean;
  onZoomActiveChange?: (active: boolean) => void;
}) {
  const raw = albumPhotoSlot
    ? albumPhotoSlot.uri.trim()
    : (getPrimaryPhotoUriForImmersiveViewer(memory)?.trim() ?? '');
  const [layout, setLayout] = useState({ w: 0, h: 0 });

  if (!raw) {
    return <View style={[styles.photoImmersiveWrap, styles.mediaFallback]} />;
  }

  return (
    <View
      style={styles.photoImmersiveWrap}
      onLayout={e => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w <= 0 || h <= 0) return;
        setLayout(prev => (prev.w === w && prev.h === h ? prev : { w, h }));
      }}
    >
      <ImmersivePhotoZoomWrap
        width={layout.w}
        height={layout.h}
        isActive={isActive}
        onZoomActiveChange={onZoomActiveChange}
      >
        <ImmersiveMediaReveal style={styles.photoImmersiveWrap}>
          <ImmersivePhotoSlide uri={raw} memoryId={memory.id} />
        </ImmersiveMediaReveal>
      </ImmersivePhotoZoomWrap>
    </View>
  );
}

function ImmersiveVideo({
  memory,
  isActive,
  viewerFocused = true,
  soundOn,
  overlayBottomInset,
  heroHoldsSurface = false,
}: {
  memory: Memory;
  isActive: boolean;
  /** false au back : ne pas pauser, le fil reprend le même lecteur. */
  viewerFocused?: boolean;
  soundOn: boolean;
  overlayBottomInset: number;
  /** Clone shared-element déjà collé à ce lecteur : pas de `VideoView` de page. */
  heroHoldsSurface?: boolean;
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
  const [durationMillis, setDurationMillis] = useState(() =>
    memory.duration && memory.duration > 0 ? Math.round(memory.duration * 1000) : 0,
  );
  const posterFade = useRef(new Animated.Value(1)).current;

  const trimmedUri = uri?.trim() ?? '';
  const player = useSharedVideoPlayer(
    isActive && trimmedUri ? memory.id : null,
    trimmedUri || null,
  );
  useVideoShouldPlay(player, isActive && !!trimmedUri, {
    /** Blur du viewer : le fil garde la lecture. Pager interne : on pause toujours. */
    skipPause: !viewerFocused,
  });

  useEffect(() => {
    if (!player) return;
    player.loop = true;
    player.muted = !soundOn;
    if (soundOn) void ensurePlaybackAudioForListening();
  }, [player, soundOn]);

  useEffect(() => {
    if (heroHoldsSurface || !player || !trimmedUri) return;
    if (Platform.OS === 'android') reattachVideoPlayer(player, trimmedUri);
  }, [heroHoldsSurface, player, trimmedUri]);

  useEffect(() => {
    if (isActive) return;
    posterFade.setValue(1);
    setVideoReady(false);
  }, [isActive, posterFade]);

  useEffect(() => {
    const w = memory.original_px_w ?? 0;
    const h = memory.original_px_h ?? 0;
    setNatural(w > 0 && h > 0 ? { w, h } : null);
    posterFade.setValue(1);
    setVideoReady(false);
    setDurationMillis(
      memory.duration && memory.duration > 0 ? Math.round(memory.duration * 1000) : 0,
    );
  }, [memory.id, memory.original_px_w, memory.original_px_h, memory.duration, trimmedUri, posterFade]);

  useEffect(() => {
    if (heroHoldsSurface || !videoReady || !isActive || !posterUri.trim()) return;
    const anim = Animated.timing(posterFade, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [heroHoldsSurface, videoReady, isActive, posterUri, posterFade]);

  const markVideoReady = useCallback(() => {
    setVideoReady(prev => (prev ? prev : true));
  }, []);

  useEffect(() => {
    if (!player || !isActive) return;
    const loadSub = player.addListener('sourceLoad', payload => {
      if (payload.duration > 0) {
        setDurationMillis(Math.round(payload.duration * 1000));
      }
    });
    const playSub = player.addListener('playingChange', ({ isPlaying }) => {
      if (isPlaying) markVideoReady();
    });
    if (player.duration > 0) setDurationMillis(Math.round(player.duration * 1000));
    if (player.playing || player.currentTime > 0.04) markVideoReady();
    return () => {
      loadSub.remove();
      playSub.remove();
    };
  }, [player, isActive, markVideoReady]);

  const handleSeekStart = useCallback(() => {
    try {
      player?.pause();
    } catch {
      /* lecteur libéré */
    }
  }, [player]);

  const handleSeek = useCallback(
    (ms: number) => {
      if (player) player.currentTime = ms / 1000;
    },
    [player],
  );

  const handleSeekEnd = useCallback(() => {
    if (isActive) {
      try {
        player?.play();
      } catch {
        /* lecteur libéré */
      }
    }
  }, [isActive, player]);

  const onPosterLoad = useCallback((e: { source: { width?: number; height?: number } }) => {
    const w = e.source.width ?? 0;
    const h = e.source.height ?? 0;
    if (w > 0 && h > 0) setNatural(prev => prev ?? { w, h });
  }, []);

  const dimensions = natural ?? seedNatural;
  /** Paysage (et carré) : tout voir. Portrait : cover — dimensions figées dès l’EXIF pour éviter le saut. */
  const contentFit =
    dimensions && dimensions.h > dimensions.w ? ('cover' as const) : ('contain' as const);
  const posterFit = contentFit;

  const showSeekBar = isActive && !!player && !!trimmedUri && durationMillis > 0;

  if (!trimmedUri && !posterUri) {
    return <View style={[styles.videoImmersiveWrap, styles.mediaFallback]} />;
  }

  const showPosterLayer = !!posterUri.trim();

  return (
    <View style={styles.videoImmersiveWrap}>
      <ImmersiveMediaReveal style={StyleSheet.absoluteFillObject}>
        {heroHoldsSurface ? null : (
          <View
            style={[StyleSheet.absoluteFillObject, styles.immersiveVideoBackdrop]}
            pointerEvents="none"
          />
        )}
        {trimmedUri && isActive && player && !heroHoldsSurface ? (
          <View
            style={[StyleSheet.absoluteFillObject, styles.immersiveVideoLayer]}
            pointerEvents="none"
          >
            <PetitmoVideoView
              player={player}
              contentFit={contentFit}
              style={StyleSheet.absoluteFillObject}
              onFirstFrameRender={markVideoReady}
            />
          </View>
        ) : null}

        {showPosterLayer && !heroHoldsSurface ? (
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
      </ImmersiveMediaReveal>

      {showSeekBar && player ? (
        <ImmersiveVideoSeekBar
          player={player}
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
  mountPlayer = true,
}: {
  memory: Memory;
  width: number;
  /**
   * Pendant le zoom shared-element : ne pas monter AudioPlayer (coûteux).
   * La cover seule porte la transition, comme une photo.
   */
  mountPlayer?: boolean;
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
    <View style={[styles.voiceWrapImmersive, { width }]}>
      <ImmersiveMediaReveal style={styles.voiceMediaLayer}>
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
        <View
          style={[
            styles.voicePlayerImmersive,
            hasCover && styles.voicePlayerImmersiveCompact,
          ]}
        >
          {playbackUri && mountPlayer ? (
            <AudioPlayer
              uri={playbackUri}
              duration={memory.duration || 0}
              playbackStartSec={memory.voice_playback_start_sec ?? null}
              variant={hasCover ? 'coverBottom' : 'default'}
              compactPlayWave
              controlIconColor={hasCover ? '#1C1C1E' : '#FFFFFF'}
              coverFlushBottom={hasCover}
            />
          ) : null}
        </View>
      </ImmersiveMediaReveal>
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
  const hintActive = 'rgba(28, 28, 30, 0.48)';
  const hintDisabled = 'rgba(28, 28, 30, 0.22)';

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
            onPress={onTapEdit}
            accessibilityLabel="Modifier le texte"
          >
            {title ? (
              <Text
                style={[
                  feedStyles.textTitle,
                  styles.immersiveTextCentered,
                  loadedFontStyle(memoryEditorialBoldFont),
                ]}
                accessibilityRole="header"
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
                  loadedFontStyle(memoryEditorialFont),
                  idx > 0 && feedStyles.textBookParagraphSpacing,
                ]}
                {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
              >
                {EM_QUAD}{para.replace(/\n/g, `\n${EM_QUAD}`)}
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
      <ImmersiveChromeReveal order={1} withScale={false} style={StyleSheet.absoluteFillObject}>
        <FeedPhotoFavoriteOverlay
          isFavorite={!!memory.is_favorite}
          inkOverride={memory.captured_overlay_ink}
          onPress={() => void onToggleFavorite(memory.id)}
          bottomInset={overlayBottomInset}
        />
      </ImmersiveChromeReveal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  viewerShell: {
    width: '100%',
  },
  /**
   * Au-dessus du clone de zoom (`zIndex: 40`) : le chrome et le dégradé se posent
   * **sur** la photo qui grandit, comme dans Photos. Le média, lui, reste masqué
   * pendant la course, donc le clone se voit à travers.
   */
  viewerContent: {
    flex: 1,
    zIndex: 50,
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
  closeBtnHit: {
    width: '100%',
    height: '100%',
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
    width: StyleSheet.hairlineWidth * 1.5,
    height: verticalScale(36),
    backgroundColor: 'rgba(28, 28, 30, 0.40)',
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
  /** Crayon sous le cœur favori (colonne bas-droite). */
  editTextFab: {
    position: 'absolute',
    right: scale(12),
    zIndex: 12,
    width: scale(32),
    height: scale(32),
    borderRadius: scale(16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  editTextFabOnMedia: {
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  editTextFabOnText: {
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
  /**
   * Sous le texte, au-dessus du média. Les icônes (cœur, crayon, scrubber)
   * sont en zIndex 12 pour passer au-dessus de ce bandeau.
   */
  captionOnMediaWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 7,
    pointerEvents: 'box-none',
  },
  captionOnMediaGradient: {
    paddingHorizontal: scale(16),
    paddingRight: scale(56),
  },
  /** Cœur / actions bas-droite : au-dessus du dégradé d’annotation. */
  mediaFavoriteLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 12,
    pointerEvents: 'box-none',
  },
  captionOnMediaText: {
    color: '#FFFFFF',
    fontSize: scale(17.5),
    fontWeight: '400',
    lineHeight: IMMERSIVE_CAPTION_LINE_H,
    textShadowColor: 'rgba(0, 0, 0, 0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
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
    zIndex: 12,
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
  voiceMediaLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  voicePlayerImmersive: {
    width: '100%',
    paddingVertical: verticalScale(16),
    paddingLeft: scale(16),
    // Crayon bas-droite (right 12 + disque 32) + petit écart.
    paddingRight: scale(12) + scale(32) + scale(8),
  },
  /** Vue immersive audio : raccourcit le bandeau sombre derrière la wave. */
  voicePlayerImmersiveCompact: {
    paddingVertical: verticalScale(8),
  },
  voicePlayerImmersiveCoverScrim: {
    backgroundColor: 'rgba(0,0,0,0.42)',
  },
});
