import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Platform,
  Animated as RNAnimated,
} from 'react-native';
import { Image } from 'expo-image';
import {
  Pencil,
  Play,
  Trash2,
  ImagePlus,
  MapPin,
  Maximize2,
} from 'lucide-react-native';
import ShareForwardIcon from '@/components/ShareForwardIcon';
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { THEME } from "@/constants/theme";
import { MOTION_FEED_VIDEO_POSTER_MS } from '@/constants/motion';
import { scale, verticalScale } from "@/utils/responsive";
import { FavoriteHeartButton } from '@/components/FavoriteHeartButton';
import MotionPressable from '@/components/MotionPressable';
import { ICON_SIZES } from "@/constants/sizes";
import {
  MOTION_PRESS_FILL_ANNOTATE,
  MOTION_PRESS_IN_ANNOTATE_MS,
  MOTION_PRESS_OPACITY_DIP_ANNOTATE,
  MOTION_PRESS_SCALE_ANNOTATE,
  MOTION_EASE,
} from '@/constants/motion';
import {
  FEED_CAPTION_SCROLL_MAX_H,
  FEED_POST_CARD_RADIUS,
  FEED_TEXT_POST_SCROLL_MAX_H,
  TEXT_POST_CARD_INSET,
} from '@/constants/feedLayout';
import { ScrollableTextBlock } from '@/components/ScrollableTextBlock';
import PhotoMosaic from "@/components/PhotoMosaic";
import {
  appendLocalMediaCacheBuster,
  getVoiceCoverUriForFeedAndViewer,
  isAlbumFullyFavorited,
  isFeedMultiPhotoAlbum,
  memoryHasExplicitVoiceCover,
  normalizeMemoryMediaUriForDisplay,
  parseFavoritePhotoUrls,
} from '@/utils/memoryPhotos';
import { useFeedPhotoDisplayUrls } from '@/hooks/useFeedPhotoDisplayUrls';
import { useFeedVideoPlaybackUri } from '@/hooks/useFeedVideoPlaybackUri';
import { useFeedVideoPosterDisplayUrl } from '@/hooks/useFeedVideoPosterDisplayUrl';
import { useVideoShouldPlay } from '@/hooks/useVideoShouldPlay';
import { normalizeVideoPlaybackUri } from '@/utils/videoMediaUri';
import { PetitmoVideoView } from '@/components/PetitmoVideoView';
import {
  useSharedVideoPlayer,
  useIsVideoKeepAlive,
} from '@/lib/videoPlayerPool';
import { notifyFeedVideoFirstFrame } from '@/lib/feedVideoReturnHandoff';
import { clampAudioBookAnnotation } from '@/lib/audioBookAnnotation';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { FeedMediaPrepOverlay } from '@/components/FeedMediaPrepOverlay';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { shareMemory } from '@/services/shareMemory';
import { Swipeable, RectButton } from "react-native-gesture-handler";
import Reanimated, { FadeOut } from 'react-native-reanimated';
import {
  FeedAgeOverlay,
  FeedPostMetaOverlay,
  FeedVideoDurationSoundBar,
  FEED_AGE_PILL_STACK_RESERVE,
} from '@/components/feed/FeedMediaOverlays';
import type { PendingUpload } from "@/contexts/PendingMediaUploadsContext";
import {
  formatDuration,
  formatDateLong,
} from '@/utils/date';
import { formatFamilyAgesLine } from '@/utils/childrenAge';
import AudioPlayer from "@/components/AudioPlayer";
import {
  filChildLiteKey,
  filFamilyChildrenLiteKey,
  filMemoryLiteKey,
  type Memory,
  type Child,
} from "@/utils/feedHelpers";
import { styles, TEXT_POST_GUTTER } from "@/components/feed/feedStyles";
import {
  useMemoryEditorialFont,
  useMemoryEditorialBoldFont,
} from '@/contexts/MemoryTextFontContext';
import { ensurePlaybackAudioForListening } from '@/lib/playbackAudioMode';
import { useIsFeedVideoAutoplay, useIsFeedVideoOnScreen } from '@/lib/feedAutoplayStore';
import { loadedFontStyle } from '@/utils/loadedFontStyle';
import {
  measureViewInWindow,
  type ImmersiveLaunchArgs,
  type ImmersiveSharedOrigin,
} from '@/utils/immersiveSharedElement';
import {
  registerFeedImmersiveHost,
  unregisterFeedImmersiveHost,
} from '@/utils/feedImmersiveHostRegistry';

/** Icônes d’action (hors favori couleur charte) */
const ACTION_ICON_INK = '#0A0A0A';

const EM_QUAD = '\u2003';

/** Laisse le scroll vertical interne (texte) au Swipeable horizontal « supprimer ». */
const FEED_SWIPEABLE_AXIS_LOCK = {
  activeOffsetX: [-14, 14] as [number, number],
  failOffsetY: [-12, 12] as [number, number],
};

/** Taille unique des icônes dans le fil (actions + overlays). */
/** Icônes d’action sous le post — taille et trait unifiés (crayon, photo, cœur). */
const FEED_POST_ACTION_ICON_PX = scale(20);
/** Cœur favori plus grand que crayon / share ; trait calé sur `FEED_POST_ACTION_STROKE`. */
const FEED_FAVORITE_HEART_ICON_PX = scale(28);
const FEED_POST_ACTION_STROKE = 2.05;

/** Une ligne « envoi en cours » (même liste que les souvenirs → pas de saut de header FlatList). */
export type FeedListItem =
  | { rowKind: 'pending'; row: PendingUpload }
  /** Emplacements restants d’un lot « une photo par post » — points d’attente. */
  | { rowKind: 'batchSlot'; parentTempId: string; slotIndex: number }
  | { rowKind: 'memory'; memory: Memory };

type FilMemoryRowProps = {
  memory: Memory;
  /** Indice dans `memories` (hors pending), pour espacement entre posts. */
  memoryIndex: number;
  child: Child | null;
  familyChildren: Child[];
  feedDateFontFamily?: string;
  feedAgeFontFamily?: string;
  feedLocationFilledFontFamily?: string;
  feedLocationPlaceholderFontFamily?: string;
  uploadingVoiceCoverId: string | null;
  setMemories: Dispatch<SetStateAction<Memory[]>>;
  toggleFavorite: (id: string) => void | Promise<void>;
  handleEditMemory: (m: Memory) => void;
  handleEditLocation: (m: Memory) => void;
  handlePickVoiceCover: (m: Memory) => void | Promise<void>;
  handleDeleteMemory: (m: Memory) => void;
  swipeRefs: MutableRefObject<Map<string, Swipeable | null>>;
  immersiveLaunchRef: RefObject<(args: ImmersiveLaunchArgs) => void>;
  /** Import non finalisé : pas de favori / swipe / actions. */
  isOptimisticFeedPending?: boolean;
  /** Libellé sous la roue (lot multi-photos, etc.). */
  pendingPrepLabel?: string;
};
function filMemoryRowDataPropsEqual(prev: FilMemoryRowProps, next: FilMemoryRowProps): boolean {
  if (prev.memoryIndex !== next.memoryIndex) return false;
  if (prev.uploadingVoiceCoverId !== next.uploadingVoiceCoverId) return false;
  if (!!prev.isOptimisticFeedPending !== !!next.isOptimisticFeedPending) return false;
  if ((prev.pendingPrepLabel ?? '') !== (next.pendingPrepLabel ?? '')) return false;
  if (filChildLiteKey(prev.child) !== filChildLiteKey(next.child)) return false;
  if (filFamilyChildrenLiteKey(prev.familyChildren) !== filFamilyChildrenLiteKey(next.familyChildren)) {
    return false;
  }
  if (filMemoryLiteKey(prev.memory) !== filMemoryLiteKey(next.memory)) return false;
  return true;
}

const PendingFeedUploadCard = memo(function PendingFeedUploadCard({
  p,
  feedLocationFilledFontFamily,
}: {
  p: PendingUpload;
  feedLocationFilledFontFamily?: string;
}) {
  const isVideo = p.kind === 'video';
  const preview0 = p.previewUris[0];
  const dateLabel = p.capturedAtPreviewIso
    ? formatDateLong(p.capturedAtPreviewIso)
    : p.status === 'uploading'
      ? 'Envoi en cours…'
      : 'Envoi';
  const locationCore = (p.locationPreview?.trim() || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  const locationLabel = locationCore ? `à ${locationCore}` : '';
  return (
    <View style={styles.postShell}>
      <View style={styles.post}>
      <View style={styles.postMain}>
        <View style={styles.postBody}>
          <View style={{ position: 'relative' }}>
            <FeedPostMetaOverlay
              dateLabel={dateLabel}
              locationLabel={locationLabel || undefined}
              showLocationEdit={false}
              feedLocationFilledFontFamily={feedLocationFilledFontFamily}
            />
            {isVideo ? (
              preview0 || p.previewPosterUri ? (
                <View style={[styles.mediaCard, styles.videoBody, styles.videoMediaCard]}>
                  {p.previewPosterUri?.trim() ? (
                    <Image
                      source={{ uri: p.previewPosterUri.trim() }}
                      style={styles.photoImage}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  ) : (
                    <View style={[styles.photoImage, { backgroundColor: '#000000' }]} />
                  )}
                  <View style={[styles.playOverlay, styles.videoPlayIconAboveTap]} pointerEvents="none">
                    <View style={styles.playButton}>
                      <Play size={ICON_SIZES.sm} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
                    </View>
                  </View>
                </View>
              ) : (
                <View style={[styles.mediaCard, styles.photoPlaceholder]} />
              )
            ) : (
              <PhotoMosaic urls={p.previewUris} />
            )}
            {p.status === 'error' && p.errorMessage ? (
              <Text
                style={{
                  marginTop: verticalScale(6),
                  marginHorizontal: TEXT_POST_CARD_INSET,
                  color: '#B91C1C',
                  fontSize: scale(13),
                }}
              >
                {p.errorMessage}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
      </View>
    </View>
  );
});

/**
 * Carte d’attente pour une photo d’un lot « une photo par post » pas encore prête.
 * Trois points — pas de preview (la 1ʳᵉ / en cours est sur la carte `pending`).
 */
const BatchFeedSlotCard = memo(function BatchFeedSlotCard({
  label,
}: {
  label: string;
}) {
  return (
    <View style={styles.postShell}>
      <View style={styles.post}>
        <View style={styles.postMain}>
          <View style={styles.postBody}>
            <View style={{ position: 'relative' }}>
              <View style={[styles.mediaCard, styles.photoPlaceholder]} />
              <FeedMediaPrepOverlay compact prominent blockTouches label={label} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
});

function FilMemoryRow({
  memory,
  memoryIndex,
  child,
  familyChildren,
  feedDateFontFamily,
  feedAgeFontFamily,
  feedLocationFilledFontFamily,
  feedLocationPlaceholderFontFamily,
  uploadingVoiceCoverId,
  setMemories,
  toggleFavorite,
  handleEditMemory,
  handleEditLocation,
  handlePickVoiceCover,
  handleDeleteMemory,
  swipeRefs,
  immersiveLaunchRef,
  isOptimisticFeedPending = false,
  pendingPrepLabel,
}: FilMemoryRowProps) {
  const { t } = useAppTranslation('common');
  const [shareBusy, setShareBusy] = useState(false);
  const isFeedVideoAutoplay = useIsFeedVideoAutoplay(
    memory.type === 'video' ? memory.id : null,
  );
  const isFeedVideoOnScreen = useIsFeedVideoOnScreen(memory.id);
  const memoryEditorialFont = useMemoryEditorialFont();
  const memoryEditorialBoldFont = useMemoryEditorialBoldFont();
  const photoUrls = useFeedPhotoDisplayUrls(memory);
  const contentTextRaw = memory.content?.trim() || '';
  const contentText =
    memory.type === 'voice' ? clampAudioBookAnnotation(contentTextRaw) : contentTextRaw;
  const bookParagraphs = (() => {
    const raw = (memory.content ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();
    if (!raw) return ['Un joli mot du cœur'];
    const parts = raw.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return parts.length > 0 ? parts : ['Un joli mot du cœur'];
  })();
  const captionParagraphs = (() => {
    const raw = contentText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!raw) return [];
    const parts = raw.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return parts.length > 0 ? parts : [raw];
  })();
  const videoPosterUri = useFeedVideoPosterDisplayUrl(memory);
  const voiceCoverRaw = getVoiceCoverUriForFeedAndViewer(memory);
  const voiceCoverSigned = useSignedMediaUrl(voiceCoverRaw || null) ?? '';
  const voiceCoverDisplayUri = appendLocalMediaCacheBuster(
    normalizeMemoryMediaUriForDisplay((voiceCoverSigned || voiceCoverRaw).trim()),
    memory.updated_at,
  );
  const hasVoiceCover =
    memoryHasExplicitVoiceCover(memory) && !!voiceCoverDisplayUri.trim();
  const voicePlaybackSigned =
    useSignedMediaUrl(memory.type === 'voice' ? (memory.media_url ?? null) : null) ?? '';
  const videoPlaybackUri = useFeedVideoPlaybackUri(memory);
  const ageAtMemory = formatFamilyAgesLine(familyChildren, memory.created_at);
  /** Date d’événement / prise (EXIF) — pas la date d’ajout dans l’app. */
  const addedAtIso = memory.created_at;
  const addedAtLabel = formatDateLong(addedAtIso);
  const locationLabelRaw = memory.location?.trim() || '';
  const locationCore = locationLabelRaw.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const locationLabel = locationCore ? `à ${locationCore}` : '';
  /** Pending : autoplay + immersif OK dès que l’URI locale existe (trim photothèque). */
  const canAutoplayVideoInline =
    isFeedVideoAutoplay &&
    memory.type === 'video' &&
    !!videoPlaybackUri.trim();
  const canOpenImmersiveWhilePending =
    memory.type === 'video' && !!videoPlaybackUri.trim();

  const [feedInlineVideoSoundOn, setFeedInlineVideoSoundOn] = useState(false);
  const [feedInlineVideoDisplayReady, setFeedInlineVideoDisplayReady] = useState(false);
  /** Poster au-dessus de la vidéo : fondu 1→0 une fois la vidéo décodée (évite le « saut » thumbnail → frame). */
  const feedInlinePosterFade = useRef(new RNAnimated.Value(1)).current;
  const feedInlineVideoReveal = useRef(new RNAnimated.Value(0)).current;
  const viewerHoldsVideo = useIsVideoKeepAlive(
    memory.type === 'video' ? memory.id : null,
  );
  /** Garde le lecteur (sans rembobiner) le temps que l’autoplay fil se ré-accroche. */
  const [handoffKeepPlayer, setHandoffKeepPlayer] = useState(false);
  /** Garde la VideoView le temps du fondu vers le poster (sortie de zone autoplay). */
  const [keepPlayerForPosterFade, setKeepPlayerForPosterFade] = useState(false);
  const wasAutoplayingRef = useRef(false);
  const feedInlineVideoDisplayReadyRef = useRef(false);
  feedInlineVideoDisplayReadyRef.current = feedInlineVideoDisplayReady;
  useEffect(() => {
    if (viewerHoldsVideo) setHandoffKeepPlayer(true);
  }, [viewerHoldsVideo]);
  useEffect(() => {
    if (!handoffKeepPlayer || viewerHoldsVideo) return;
    if (canAutoplayVideoInline) {
      setHandoffKeepPlayer(false);
      return;
    }
    /** Plus long : laisse FlatList re-déclarer la vignette visible sans rembobiner. */
    const timer = setTimeout(() => setHandoffKeepPlayer(false), 1200);
    return () => clearTimeout(timer);
  }, [handoffKeepPlayer, viewerHoldsVideo, canAutoplayVideoInline]);
  const sharedVideoPlayer = useSharedVideoPlayer(
    memory.type === 'video' &&
      videoPlaybackUri.trim() &&
      (canAutoplayVideoInline ||
        viewerHoldsVideo ||
        handoffKeepPlayer ||
        keepPlayerForPosterFade)
      ? memory.id
      : null,
    videoPlaybackUri,
  );
  /** Swipe « supprimer » : ne pas ouvrir l’immersif au relâchement du doigt. */
  const suppressImmersivePressRef = useRef(false);
  const videoImmersiveHostRef = useRef<View>(null);
  const voiceImmersiveHostRef = useRef<View>(null);

  useEffect(() => {
    if (memory.type !== 'video') return;
    const uri = videoPosterUri.trim() || videoPlaybackUri.trim();
    if (!uri) return;
    const key = memory.id;
    registerFeedImmersiveHost(key, {
      getView: () => videoImmersiveHostRef.current,
      uri,
      cornerRadius: FEED_POST_CARD_RADIUS,
    });
    return () => unregisterFeedImmersiveHost(key);
  }, [memory.id, memory.type, videoPosterUri, videoPlaybackUri]);

  useEffect(() => {
    if (memory.type !== 'voice' || !hasVoiceCover) return;
    const uri = voiceCoverDisplayUri.trim();
    if (!uri) return;
    const key = memory.id;
    registerFeedImmersiveHost(key, {
      getView: () => voiceImmersiveHostRef.current,
      uri,
      cornerRadius: FEED_POST_CARD_RADIUS,
    });
    return () => unregisterFeedImmersiveHost(key);
  }, [memory.id, memory.type, hasVoiceCover, voiceCoverDisplayUri]);
  useVideoShouldPlay(sharedVideoPlayer, canAutoplayVideoInline && !viewerHoldsVideo, {
    /**
     * Rembobiner seulement si la carte a vraiment quitté l’écran.
     * Au retour immersif, l’autoplay peut flasher « off » une frame : ne pas
     * remettre à t=0 alors que la vignette est toujours là.
     */
    restartFromBeginningOnPlay: !isFeedVideoOnScreen,
    skipPause: viewerHoldsVideo || handoffKeepPlayer,
  });

  useEffect(() => {
    if (!sharedVideoPlayer) return;
    if (canAutoplayVideoInline && feedInlineVideoSoundOn && !viewerHoldsVideo) {
      void ensurePlaybackAudioForListening();
      sharedVideoPlayer.muted = false;
      return;
    }
    if (!viewerHoldsVideo) sharedVideoPlayer.muted = true;
  }, [sharedVideoPlayer, canAutoplayVideoInline, feedInlineVideoSoundOn, viewerHoldsVideo]);

  const wasViewerHoldingRef = useRef(false);
  /**
   * Retour immersif : masquer le JPEG dès l’ouverture (synchrone au paint).
   * Un `useEffect` après coup laisse 1+ frames de poster opaque sous le fade.
   */
  const [suppressPosterAfterImmersive, setSuppressPosterAfterImmersive] = useState(false);
  const suppressPosterAfterImmersiveRef = useRef(false);
  suppressPosterAfterImmersiveRef.current = suppressPosterAfterImmersive;

  /** Masque immédiat — pas d’attente d’effet. */
  const hideFeedVideoPoster =
    viewerHoldsVideo || handoffKeepPlayer || suppressPosterAfterImmersive;

  useLayoutEffect(() => {
    if (!viewerHoldsVideo) return;
    wasViewerHoldingRef.current = true;
    setSuppressPosterAfterImmersive(true);
    feedInlinePosterFade.setValue(0);
    setFeedInlineVideoDisplayReady(false);
  }, [viewerHoldsVideo, feedInlinePosterFade]);

  useEffect(() => {
    if (viewerHoldsVideo) return;
    if (!wasViewerHoldingRef.current || !sharedVideoPlayer || !videoPlaybackUri.trim()) return;
    wasViewerHoldingRef.current = false;
    setSuppressPosterAfterImmersive(true);
    feedInlinePosterFade.setValue(0);
    feedInlineVideoReveal.setValue(1);
    setFeedInlineVideoDisplayReady(false);
    try {
      sharedVideoPlayer.play();
    } catch {
      /* lecteur libéré */
    }
    /**
     * Pas de `reattachVideoPlayer` ici : le `replace` Android force un flash noir
     * alors que le buffer est déjà chaud depuis l’immersif. La VideoView fil
     * reprend le flux ; `onFirstFrameRender` notifie le viewer.
     */
  }, [
    sharedVideoPlayer,
    viewerHoldsVideo,
    videoPlaybackUri,
    feedInlinePosterFade,
    feedInlineVideoReveal,
  ]);

  useEffect(() => {
    /**
     * Reset autoplay « froid » seulement (jamais joué / déjà fondu).
     * Ne pas snaper le poster si on est en fondu de sortie ou retour immersif.
     */
    if (
      canAutoplayVideoInline ||
      viewerHoldsVideo ||
      handoffKeepPlayer ||
      keepPlayerForPosterFade ||
      suppressPosterAfterImmersiveRef.current
    ) {
      return;
    }
    setFeedInlineVideoSoundOn(false);
    setFeedInlineVideoDisplayReady(false);
    feedInlinePosterFade.setValue(1);
    feedInlineVideoReveal.setValue(0);
  }, [
    canAutoplayVideoInline,
    videoPlaybackUri,
    viewerHoldsVideo,
    handoffKeepPlayer,
    keepPlayerForPosterFade,
    feedInlinePosterFade,
    feedInlineVideoReveal,
  ]);

  /**
   * Sortie de zone autoplay : fondu poster par-dessus la dernière frame,
   * puis démontage de la VideoView (évite le cut net).
   */
  useEffect(() => {
    if (canAutoplayVideoInline) {
      wasAutoplayingRef.current = true;
      setKeepPlayerForPosterFade(false);
      return;
    }
    if (!wasAutoplayingRef.current) return;
    wasAutoplayingRef.current = false;

    if (viewerHoldsVideo || suppressPosterAfterImmersiveRef.current) {
      setKeepPlayerForPosterFade(false);
      return;
    }

    const hadVisibleVideo = feedInlineVideoDisplayReadyRef.current;
    const hasPoster = !!videoPosterUri.trim();

    if (hadVisibleVideo && hasPoster) {
      setKeepPlayerForPosterFade(true);
      setFeedInlineVideoSoundOn(false);
      const anim = RNAnimated.timing(feedInlinePosterFade, {
        toValue: 1,
        duration: MOTION_FEED_VIDEO_POSTER_MS,
        useNativeDriver: true,
      });
      anim.start(({ finished }) => {
        if (!finished) return;
        setKeepPlayerForPosterFade(false);
        setFeedInlineVideoDisplayReady(false);
        feedInlineVideoReveal.setValue(0);
      });
      return () => {
        anim.stop();
        /** `stop()` → finished=false : sans ça le décodeur reste acquis. */
        setKeepPlayerForPosterFade(false);
      };
    }

    if (hadVisibleVideo && !hasPoster) {
      setKeepPlayerForPosterFade(true);
      setFeedInlineVideoSoundOn(false);
      const anim = RNAnimated.timing(feedInlineVideoReveal, {
        toValue: 0,
        duration: MOTION_FEED_VIDEO_POSTER_MS,
        useNativeDriver: true,
      });
      anim.start(({ finished }) => {
        if (!finished) return;
        setKeepPlayerForPosterFade(false);
        setFeedInlineVideoDisplayReady(false);
        feedInlinePosterFade.setValue(1);
      });
      return () => {
        anim.stop();
        setKeepPlayerForPosterFade(false);
      };
    }

    setKeepPlayerForPosterFade(false);
    setFeedInlineVideoSoundOn(false);
    setFeedInlineVideoDisplayReady(false);
    feedInlinePosterFade.setValue(1);
    feedInlineVideoReveal.setValue(0);
  }, [
    canAutoplayVideoInline,
    viewerHoldsVideo,
    videoPosterUri,
    feedInlinePosterFade,
    feedInlineVideoReveal,
  ]);

  useEffect(() => {
    if (!suppressPosterAfterImmersive) return;
    /** Filet : si pas de 1ʳᵉ frame, réautoriser le poster (lecture morte). */
    const timer = setTimeout(() => {
      feedInlinePosterFade.setValue(1);
      setSuppressPosterAfterImmersive(false);
    }, 1800);
    return () => clearTimeout(timer);
  }, [suppressPosterAfterImmersive, feedInlinePosterFade]);

  useEffect(() => {
    if (!feedInlineVideoDisplayReady || !canAutoplayVideoInline) return;
    const fromImmersive = suppressPosterAfterImmersiveRef.current;
    if (fromImmersive) {
      feedInlinePosterFade.setValue(0);
      feedInlineVideoReveal.setValue(1);
      /** Garder le masque plus longtemps que le crossfade hero (~160 ms). */
      const t = setTimeout(() => setSuppressPosterAfterImmersive(false), 320);
      return () => clearTimeout(t);
    }
    const hasPoster = !!videoPosterUri.trim();
    const anim = hasPoster
      ? RNAnimated.timing(feedInlinePosterFade, {
          toValue: 0,
          duration: MOTION_FEED_VIDEO_POSTER_MS,
          useNativeDriver: true,
        })
      : RNAnimated.timing(feedInlineVideoReveal, {
          toValue: 1,
          duration: MOTION_FEED_VIDEO_POSTER_MS,
          useNativeDriver: true,
        });
    anim.start();
    return () => anim.stop();
  }, [
    feedInlineVideoDisplayReady,
    canAutoplayVideoInline,
    videoPosterUri,
    suppressPosterAfterImmersive,
    feedInlinePosterFade,
    feedInlineVideoReveal,
  ]);

  const toggleFeedInlineVideoSound = useCallback(async () => {
    const next = !feedInlineVideoSoundOn;
    if (next) {
      await ensurePlaybackAudioForListening();
    }
    setFeedInlineVideoSoundOn(next);
  }, [feedInlineVideoSoundOn]);

  const markSwipeSuppressImmersive = useCallback(() => {
    suppressImmersivePressRef.current = true;
  }, []);

  const clearSwipeSuppressImmersive = useCallback(() => {
    setTimeout(() => {
      suppressImmersivePressRef.current = false;
    }, 200);
  }, []);

  const launchImmersive = (args?: {
    albumPhotoIndex?: number;
    origin?: ImmersiveSharedOrigin | null;
    uri?: string | null;
    cornerRadius?: number;
  }) => {
    if (isOptimisticFeedPending && !canOpenImmersiveWhilePending) return;
    if (suppressImmersivePressRef.current) {
      suppressImmersivePressRef.current = false;
      return;
    }
    immersiveLaunchRef.current({
      memoryId: memory.id,
      albumPhotoIndex: args?.albumPhotoIndex ?? 0,
      origin: args?.origin,
      uri: args?.uri,
      cornerRadius: args?.cornerRadius,
    });
  };

  /** Média pleine largeur en haut de carte : coins hauts arrondis comme le post. */
  const launchImmersiveFromHost = (host: View | null, uri?: string | null) => {
    measureViewInWindow(host, origin => {
      launchImmersive({ origin, uri, cornerRadius: FEED_POST_CARD_RADIUS });
    });
  };

  const handleShareMemory = useCallback(() => {
    if (isOptimisticFeedPending || shareBusy) return;
    setShareBusy(true);
    void shareMemory(memory, {
      unavailableTitle: t('fil.share.unavailableTitle'),
      unavailableBody: t('fil.share.unavailableBody'),
      mediaMissingTitle: t('fil.share.mediaMissingTitle'),
      mediaMissingBody: t('fil.share.mediaMissingBody'),
      failedTitle: t('fil.share.failedTitle'),
      failedBody: t('fil.share.failedBody'),
    }).finally(() => setShareBusy(false));
  }, [isOptimisticFeedPending, memory, shareBusy, t]);

  const skipImmersive = isOptimisticFeedPending && !canOpenImmersiveWhilePending;

  const feedPhotoFavorited =
    memory.type === 'photo' && isFeedMultiPhotoAlbum(memory)
      ? !!memory.is_favorite || isAlbumFullyFavorited(memory)
      : !!memory.is_favorite;

  const rowFavorite =
    memory.type === 'photo' ? feedPhotoFavorited : !!memory.is_favorite;

  const isMediaPost =
    memory.type === 'photo' || memory.type === 'video' || memory.type === 'voice';

  const mediaMetaOverlayProps = {
    dateLabel: addedAtLabel,
    locationLabel: locationLabel || undefined,
    onEditLocation: () => handleEditLocation(memory),
    showLocationEdit: !isOptimisticFeedPending,
    feedDateFontFamily,
    feedLocationFilledFontFamily,
    feedLocationPlaceholderFontFamily,
  };

  const ageOverlayProps = {
    ageLabel: ageAtMemory || undefined,
    feedAgeFontFamily,
  };

  const voiceMetaInline = memory.type === 'voice' && !hasVoiceCover;

  const mediaMetaOverlay = isMediaPost && !voiceMetaInline ? (
    <FeedPostMetaOverlay {...mediaMetaOverlayProps} />
  ) : null;

  const mediaAgeOverlay = isMediaPost && !voiceMetaInline ? (
    <FeedAgeOverlay {...ageOverlayProps} />
  ) : null;

  const postCard = (
    <View style={styles.postShell}>
      <View style={styles.post}>
      {memory.type === 'text' ? (
      <View style={styles.daySeparatorBlock}>
        <View style={styles.dayHeaderRow}>
          <View style={styles.dayHeaderLeft}>
            <Text
              style={[styles.daySepDate, loadedFontStyle(feedDateFontFamily)]}
              numberOfLines={1}
            >
              {addedAtLabel}
            </Text>
            {!!ageAtMemory && (
              <Text
                style={[styles.daySepAge, loadedFontStyle(feedAgeFontFamily)]}
                numberOfLines={1}
              >
                {ageAtMemory}
              </Text>
            )}
          </View>
          <View style={styles.dayHeaderRight}>
            {!isOptimisticFeedPending ? (
              <Pressable
                onPress={() => handleEditLocation(memory)}
                accessibilityRole="button"
                accessibilityLabel={locationLabel ? 'Modifier le lieu' : 'Ajouter un lieu'}
                style={({ pressed }) => [
                  styles.dayLocationEdit,
                  pressed && { opacity: 0.85 },
                ]}
              >
                {locationLabel ? (
                  <Text
                    style={[
                      styles.daySepLocation,
                      styles.daySepLocationFilled,
                      loadedFontStyle(feedLocationFilledFontFamily),
                    ]}
                    numberOfLines={1}
                  >
                    {locationLabel}
                  </Text>
                ) : (
                  <Text
                    style={[
                      styles.daySepLocation,
                      styles.daySepLocationPlaceholder,
                      loadedFontStyle(feedLocationPlaceholderFontFamily),
                    ]}
                    numberOfLines={1}
                  >
                    Lieu
                  </Text>
                )}
                <MapPin
                  size={scale(16)}
                  color={locationLabel ? '#4B5563' : THEME.textSecondary}
                  strokeWidth={2}
                />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
      ) : null}
      <View style={styles.postMain}>
          <View style={styles.postBody}>
          {memory.type === 'photo' && photoUrls.length > 0 && (
            <View style={{ position: 'relative' }}>
              {mediaMetaOverlay}
              <PhotoMosaic
                urls={photoUrls}
                memoryId={isOptimisticFeedPending ? undefined : memory.id}
                favoritePhotoUrls={parseFavoritePhotoUrls(memory)}
                onFavoritePhotoUrlsUpdated={urls =>
                  setMemories(prev =>
                    prev.map(m =>
                      m.id === memory.id ? { ...m, favorite_photo_urls: urls } : m
                    )
                  )
                }
                onPhotoImmersive={
                  !isOptimisticFeedPending && photoUrls.length > 0
                    ? ({ index, origin, uri, cornerRadius }) =>
                        launchImmersive({
                          albumPhotoIndex: index,
                          origin,
                          uri,
                          cornerRadius,
                        })
                    : undefined
                }
                memoryForFavoriteVariants={memory}
              />
              {mediaAgeOverlay}
            </View>
          )}
          {memory.type === 'photo' && photoUrls.length === 0 && (
            <View style={{ position: 'relative' }}>
              {mediaMetaOverlay}
              <View style={[styles.mediaCard, styles.photoPlaceholder]} />
              {isOptimisticFeedPending ? (
                <FeedMediaPrepOverlay
                  compact
                  prominent
                  blockTouches
                  label={pendingPrepLabel?.trim() || t('mediaPrep.addingPhoto')}
                />
              ) : null}
              {mediaAgeOverlay}
            </View>
          )}

          {memory.type === 'video' && (!!videoPlaybackUri || !!videoPosterUri) && (
            <View style={{ position: 'relative' }}>
              {mediaMetaOverlay}
              <Pressable
                ref={videoImmersiveHostRef}
                collapsable={false}
                onPress={() =>
                  launchImmersiveFromHost(
                    videoImmersiveHostRef.current,
                    videoPosterUri.trim() || videoPlaybackUri.trim() || null,
                  )
                }
                disabled={skipImmersive}
                accessibilityRole="button"
                accessibilityLabel="Ouvrir en plein écran"
              >
                <View style={[styles.mediaCard, styles.videoBody, styles.videoMediaCard]}>
                  {videoPlaybackUri.trim() ? (
                    <View style={[styles.photoImage, styles.feedInlineAutoplayStack]} pointerEvents="none">
                      <View
                        style={[
                          StyleSheet.absoluteFillObject,
                          {
                            /**
                             * Retour immersif : pas de sous-couche noire (flash).
                             * Autoplay froid : noir OK sous le poster / la 1ʳᵉ frame.
                             */
                            backgroundColor: hideFeedVideoPoster ? 'transparent' : '#000000',
                            zIndex: 0,
                          },
                        ]}
                        pointerEvents="none"
                      />
                      <RNAnimated.View
                        style={[
                          StyleSheet.absoluteFillObject,
                          {
                            opacity: hideFeedVideoPoster ? feedInlineVideoReveal : videoPosterUri.trim() ? 1 : feedInlineVideoReveal,
                            zIndex: 1,
                            backgroundColor: hideFeedVideoPoster ? 'transparent' : '#000000',
                          },
                        ]}
                        pointerEvents="none"
                      >
                        {sharedVideoPlayer && !viewerHoldsVideo ? (
                          <PetitmoVideoView
                            player={sharedVideoPlayer}
                            style={StyleSheet.absoluteFillObject}
                            onFirstFrameRender={() => {
                              setFeedInlineVideoDisplayReady(prev => prev || true);
                              notifyFeedVideoFirstFrame(memory.id);
                            }}
                          />
                        ) : null}
                      </RNAnimated.View>
                      {videoPosterUri.trim() && !hideFeedVideoPoster ? (
                        <RNAnimated.View
                          style={[
                            StyleSheet.absoluteFillObject,
                            {
                              /**
                               * Toujours le fade animé si on a une URI de lecture :
                               * la branche `Image` opaque s’affichait dès que
                               * `canAutoplay` était false au retour.
                               */
                              opacity: videoPlaybackUri.trim()
                                ? feedInlinePosterFade
                                : canAutoplayVideoInline
                                  ? feedInlinePosterFade
                                  : 1,
                              zIndex: 2,
                            },
                          ]}
                          pointerEvents="none"
                        >
                          <Image
                            source={{ uri: videoPosterUri }}
                            style={StyleSheet.absoluteFillObject}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={`poster-${memory.id}`}
                          />
                        </RNAnimated.View>
                      ) : null}
                      {/** Roue seulement si aucun visuel local (pas de poster / preview). */}
                      {isOptimisticFeedPending &&
                      !videoPosterUri.trim() &&
                      !videoPlaybackUri.trim() ? (
                        <FeedMediaPrepOverlay
                          compact
                          prominent
                          blockTouches
                          label={t('mediaPrep.preparing')}
                        />
                      ) : null}
                    </View>
                  ) : videoPosterUri ? (
                    <View style={styles.photoImage}>
                      <Image
                        source={{ uri: videoPosterUri }}
                        style={StyleSheet.absoluteFillObject}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                        recyclingKey={`poster-${memory.id}`}
                      />
                    </View>
                  ) : (
                    <View style={[styles.photoImage, { backgroundColor: '#000000' }]}>
                      {isOptimisticFeedPending ? (
                        <FeedMediaPrepOverlay
                          compact
                          prominent
                          blockTouches
                          label={t('mediaPrep.preparing')}
                        />
                      ) : null}
                    </View>
                  )}
                  {!skipImmersive && !canAutoplayVideoInline ? (
                    <View style={[styles.playOverlay, styles.videoPlayIconAboveTap]} pointerEvents="none">
                      <View style={styles.playButton}>
                        <Play size={ICON_SIZES.sm} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
                      </View>
                    </View>
                  ) : null}
                </View>
              </Pressable>
              <FeedVideoDurationSoundBar
                durationLabel={
                  memory.duration ? formatDuration(memory.duration) : undefined
                }
                showSoundToggle={canAutoplayVideoInline}
                soundOn={feedInlineVideoSoundOn}
                onToggleSound={() => void toggleFeedInlineVideoSound()}
                bottomInset={ageAtMemory ? FEED_AGE_PILL_STACK_RESERVE : 0}
              />
              {mediaAgeOverlay}
            </View>
          )}

          {memory.type === 'voice' && (!!memory.media_url || !!voicePlaybackSigned) && (
            <View style={{ position: 'relative' }}>
              {mediaMetaOverlay}
            <Pressable
              ref={voiceImmersiveHostRef}
              collapsable={false}
              onPress={() =>
                launchImmersiveFromHost(
                  voiceImmersiveHostRef.current,
                  hasVoiceCover ? voiceCoverDisplayUri : null,
                )
              }
              disabled={skipImmersive}
              accessibilityRole="button"
              accessibilityLabel="Ouvrir en plein écran"
            >
            <View
              style={[
                styles.audioBody,
                hasVoiceCover ? styles.audioBodyWithCover : styles.audioBodyNoCover,
              ]}
            >
              {!hasVoiceCover ? (
                <>
                  <FeedPostMetaOverlay {...mediaMetaOverlayProps} layout="inline" />
                  <FeedAgeOverlay {...ageOverlayProps} layout="inline" />
                </>
              ) : null}
              {hasVoiceCover && (
                <>
                  <Image
                    key={`voice-cover-${memory.id}-${memory.updated_at ?? ''}`}
                    source={{ uri: voiceCoverDisplayUri }}
                    style={styles.voiceCoverBg}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    recyclingKey={`${memory.id}-voice-cover-${memory.updated_at ?? ''}`}
                  />
                  <View style={styles.voiceCoverScrim} />
                </>
              )}
              <View
                style={[
                  styles.audioForeground,
                  hasVoiceCover ? styles.audioForegroundCover : null,
                ]}
              >
                <View
                  style={[
                    styles.audioPlayerWrap,
                    hasVoiceCover ? styles.audioPlayerWrapCover : styles.audioPlayerWrapNoCover,
                  ]}
                >
                  <AudioPlayer
                    uri={voicePlaybackSigned || (memory.media_url ?? '')}
                    duration={memory.duration || 0}
                    playbackStartSec={memory.voice_playback_start_sec ?? null}
                    variant={hasVoiceCover ? 'coverBottom' : 'feedRow'}
                    controlIconColor={ACTION_ICON_INK}
                    coverFlushBottom={hasVoiceCover}
                    feedPlayDiscOutline
                    disableBlurDisc
                  />
                </View>
              </View>
            </View>
            </Pressable>
            {hasVoiceCover ? mediaAgeOverlay : null}
            </View>
          )}

          {memory.type === 'text' && (
            <Pressable
              style={styles.textBody}
              onPress={() => launchImmersive()}
              disabled={skipImmersive}
              accessibilityRole="button"
              accessibilityLabel="Ouvrir en plein écran"
            >
              {!!memory.text_title?.trim() && (
                <Text
                  style={[styles.textTitle, loadedFontStyle(memoryEditorialBoldFont)]}
                  {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
                >
                  {memory.text_title.trim()}
                </Text>
              )}
              <ScrollableTextBlock
                maxHeight={FEED_TEXT_POST_SCROLL_MAX_H}
                onPress={skipImmersive ? undefined : () => launchImmersive()}
              >
                {bookParagraphs.map((para, idx) => (
                  <Text
                    key={idx}
                    style={[
                      styles.textContent,
                      loadedFontStyle(memoryEditorialFont),
                      idx > 0 && styles.textBookParagraphSpacing,
                    ]}
                    {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
                  >
                    {EM_QUAD}
                    {para.replace(/\n/g, `\n${EM_QUAD}`)}
                  </Text>
                ))}
              </ScrollableTextBlock>
            </Pressable>
          )}
          </View>

        {memory.type !== 'text' && !!contentText && (
          <View style={styles.postCaption}>
            <ScrollableTextBlock maxHeight={FEED_CAPTION_SCROLL_MAX_H}>
              {captionParagraphs.map((para, idx) => (
                <Text
                  key={idx}
                  style={[
                    styles.captionAnnotation,
                    loadedFontStyle(memoryEditorialFont),
                    idx > 0 && styles.textBookParagraphSpacing,
                  ]}
                  {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
                >
                  {EM_QUAD}
                  {para.replace(/\n/g, `\n${EM_QUAD}`)}
                </Text>
              ))}
            </ScrollableTextBlock>
          </View>
        )}

        <View
          style={[
            styles.postActions,
            styles.postActionsSpread,
            memory.type === 'text' && { paddingHorizontal: TEXT_POST_GUTTER },
          ]}
        >
          <View style={styles.postActionsLeft}>
            {memory.type === 'text' ||
            memory.type === 'photo' ||
            memory.type === 'video' ||
            memory.type === 'voice' ? (
              <MotionPressable
                style={styles.feedPencilDiscCta}
                onPress={() => handleEditMemory(memory)}
                haptic="medium"
                pressScale={MOTION_PRESS_SCALE_ANNOTATE}
                pressOpacityDip={MOTION_PRESS_OPACITY_DIP_ANNOTATE}
                pressInMs={MOTION_PRESS_IN_ANNOTATE_MS}
                pressFillFrom={THEME.feedPencilDiscCtaBackground}
                pressFill={MOTION_PRESS_FILL_ANNOTATE}
                accessibilityRole="button"
                accessibilityLabel={
                  memory.type === 'text'
                    ? 'Modifier le texte'
                    : memory.content?.trim()
                      ? 'Modifier'
                      : 'Annoter'
                }
                hitSlop={10}
              >
                <Pencil
                  size={FEED_POST_ACTION_ICON_PX}
                  color={ACTION_ICON_INK}
                  strokeWidth={FEED_POST_ACTION_STROKE}
                />
              </MotionPressable>
            ) : null}

            {memory.type === 'text' && !skipImmersive ? (
              <TouchableOpacity
                style={styles.feedPencilDiscCta}
                onPress={() => launchImmersive()}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Ouvrir en plein écran"
              >
                <Maximize2
                  size={FEED_POST_ACTION_ICON_PX}
                  color={ACTION_ICON_INK}
                  strokeWidth={FEED_POST_ACTION_STROKE}
                />
              </TouchableOpacity>
            ) : null}

            {memory.type === 'voice' && (!!memory.media_url || !!voicePlaybackSigned) && (
              <TouchableOpacity
                style={styles.feedPencilDiscCta}
                onPress={() => void handlePickVoiceCover(memory)}
                activeOpacity={0.75}
                disabled={uploadingVoiceCoverId === memory.id}
                accessibilityRole="button"
                accessibilityLabel={
                  memory.voice_cover_url ? 'Changer la photo de fond' : 'Ajouter une photo de fond'
                }
              >
                {uploadingVoiceCoverId === memory.id ? (
                  <ActivityIndicator size="small" color={ACTION_ICON_INK} />
                ) : (
                  <ImagePlus
                    size={FEED_POST_ACTION_ICON_PX}
                    color={ACTION_ICON_INK}
                    strokeWidth={FEED_POST_ACTION_STROKE}
                  />
                )}
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.postActionsRight}>
            {!isOptimisticFeedPending ? (
              <MotionPressable
                style={styles.feedPencilDiscCta}
                onPress={handleShareMemory}
                disabled={shareBusy}
                accessibilityRole="button"
                accessibilityLabel={t('fil.share.a11y')}
                hitSlop={8}
              >
                {shareBusy ? (
                  <ActivityIndicator size="small" color={ACTION_ICON_INK} />
                ) : (
                  <ShareForwardIcon
                    size={FEED_POST_ACTION_ICON_PX}
                    color={ACTION_ICON_INK}
                    strokeWidth={FEED_POST_ACTION_STROKE}
                  />
                )}
              </MotionPressable>
            ) : null}

            <FavoriteHeartButton
              favored={rowFavorite}
              onPress={() => void toggleFavorite(memory.id)}
              size={FEED_FAVORITE_HEART_ICON_PX}
              strokeColor={ACTION_ICON_INK}
              strokeWidth={FEED_POST_ACTION_STROKE}
              fillColor={THEME.feedFavoriteTerracotta}
              halo="terracotta"
              style={[
                styles.feedFavoriteDiscCta,
                rowFavorite && styles.feedFavoriteDiscCtaActive,
              ]}
            />
          </View>
        </View>
      </View>
      </View>
    </View>
  );

  return (
    <Reanimated.View
      style={[styles.feedRowRoot, memoryIndex > 0 && styles.feedRowSpacingTop]}
      exiting={FadeOut.duration(180).easing(MOTION_EASE.exit)}
    >
      <Swipeable
        ref={(r) => {
          if (r) swipeRefs.current.set(memory.id, r);
          else swipeRefs.current.delete(memory.id);
        }}
        enabled={!isOptimisticFeedPending}
        friction={2}
        overshootRight={false}
        {...FEED_SWIPEABLE_AXIS_LOCK}
        onSwipeableOpenStartDrag={markSwipeSuppressImmersive}
        onSwipeableWillOpen={markSwipeSuppressImmersive}
        onSwipeableClose={clearSwipeSuppressImmersive}
        /** Par défaut RNGH met `overflow: 'hidden'` — coupe l’ombre du `postShell`. */
        containerStyle={{ overflow: 'visible' }}
        renderRightActions={
          isOptimisticFeedPending
            ? undefined
            : () => (
                <View style={styles.swipeDeleteContainer}>
                  <RectButton
                    style={styles.swipeDeleteBtn}
                    onPress={() => handleDeleteMemory(memory)}
                  >
                    <Trash2 size={scale(22)} color="#FFFFFF" strokeWidth={2.2} />
                    <Text style={styles.swipeDeleteLabel}>Supprimer</Text>
                  </RectButton>
                </View>
              )
        }
      >
        {postCard}
      </Swipeable>
    </Reanimated.View>
  );
}

const FilMemoryRowMemo = memo(FilMemoryRow, filMemoryRowDataPropsEqual);

export { FilMemoryRowMemo, PendingFeedUploadCard, BatchFeedSlotCard };
