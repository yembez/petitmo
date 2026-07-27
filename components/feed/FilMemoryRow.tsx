import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Platform,
  Animated,
} from 'react-native';
import { Image } from 'expo-image';
import {
  Pencil,
  Heart,
  Play,
  Trash2,
  ImagePlus,
  MapPin,
  Maximize2,
} from 'lucide-react-native';
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { THEME } from "@/constants/theme";
import { scale, verticalScale } from "@/utils/responsive";
import { ICON_SIZES } from "@/constants/sizes";
import {
  FEED_CAPTION_SCROLL_MAX_H,
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
import { useExpoAvShouldPlay } from '@/hooks/useExpoAvShouldPlay';
import { normalizeVideoPlaybackUri } from '@/utils/videoMediaUri';
import { clampAudioBookAnnotation } from '@/lib/audioBookAnnotation';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { FeedMediaPrepOverlay } from '@/components/FeedMediaPrepOverlay';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { Swipeable, RectButton } from "react-native-gesture-handler";
import {
  CapturedAtOverlay,
  FeedPostMetaOverlay,
  FeedVideoDurationSoundBar,
} from '@/components/feed/FeedMediaOverlays';
import type { PendingUpload } from "@/contexts/PendingMediaUploadsContext";
import {
  formatDuration,
  formatDateLong,
} from '@/utils/date';
import { formatFamilyAgesLine } from '@/utils/childrenAge';
import {
  capturedMediaDateLabel,
  shouldShowCapturedMediaDateOverlay,
} from '@/utils/feedCaptureOverlay';
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
import { useIsFeedVideoAutoplay } from '@/lib/feedAutoplayStore';

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
const FEED_POST_ACTION_STROKE = 2.05;

/** Une ligne « envoi en cours » (même liste que les souvenirs → pas de saut de header FlatList). */
export type FeedListItem =
  | { rowKind: 'pending'; row: PendingUpload }
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
  immersiveLaunchRef: RefObject<(memoryId: string, albumPhotoIndex?: number) => void>;
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
              preview0 ? (
                <View style={[styles.mediaCard, styles.videoBody, styles.videoMediaCard]}>
                  <Video
                    source={{ uri: preview0 }}
                    style={styles.photoImage}
                    videoStyle={styles.feedInlineVideoNativeBg}
                    resizeMode={ResizeMode.COVER}
                    shouldPlay={false}
                    isLooping={false}
                    isMuted
                    useNativeControls={false}
                  />
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
  const isFeedVideoAutoplay = useIsFeedVideoAutoplay(memory.id);
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
  const showCapturedOverlay = shouldShowCapturedMediaDateOverlay(memory);
  const capturedOverlayLabel = showCapturedOverlay ? capturedMediaDateLabel(memory) : '';
  const videoUriForOverlay = videoPosterUri.trim();
  const canAutoplayVideoInline =
    isFeedVideoAutoplay && memory.type === 'video' && !!videoPlaybackUri.trim();

  const [feedInlineVideoSoundOn, setFeedInlineVideoSoundOn] = useState(false);
  const [feedInlineVideoDisplayReady, setFeedInlineVideoDisplayReady] = useState(false);
  /** Poster au-dessus de la vidéo : fondu 1→0 une fois la vidéo décodée (évite le « saut » thumbnail → frame). */
  const feedInlinePosterFade = useRef(new Animated.Value(1)).current;
  const feedInlineVideoReveal = useRef(new Animated.Value(0)).current;
  const feedInlineVideoRef = useRef<Video | null>(null);
  /** Swipe « supprimer » : ne pas ouvrir l’immersif au relâchement du doigt. */
  const suppressImmersivePressRef = useRef(false);
  useExpoAvShouldPlay(feedInlineVideoRef, canAutoplayVideoInline, videoPlaybackUri, {
    restartFromBeginningOnPlay: true,
  });

  /** `setAudioModeAsync` / `isMuted` peuvent interrompre expo-av — mute impératif + reprise lecture. */
  useEffect(() => {
    const player = feedInlineVideoRef.current;
    if (!canAutoplayVideoInline) {
      if (player) void player.setIsMutedAsync(true).catch(() => {});
      return;
    }
    if (!player) return;
    let cancelled = false;
    void (async () => {
      try {
        if (feedInlineVideoSoundOn) {
          await ensurePlaybackAudioForListening();
        }
        if (cancelled) return;
        await player.setIsMutedAsync(!feedInlineVideoSoundOn);
        if (cancelled) return;
        const status = await player.getStatusAsync();
        if (status.isLoaded && !status.isPlaying) {
          await player.playAsync();
        }
      } catch {
        /* source pas prête */
      }
    })();
    return () => {
      cancelled = true;
      void player.setIsMutedAsync(true).catch(() => {});
    };
  }, [canAutoplayVideoInline, feedInlineVideoSoundOn]);

  useEffect(() => {
    setFeedInlineVideoSoundOn(false);
    setFeedInlineVideoDisplayReady(false);
    feedInlinePosterFade.setValue(1);
    feedInlineVideoReveal.setValue(0);
    // Reset seulement si la source visuelle change — pas au swap pending→id (même URI).
  }, [canAutoplayVideoInline, videoPlaybackUri, feedInlinePosterFade, feedInlineVideoReveal]);

  useEffect(() => {
    if (!feedInlineVideoDisplayReady || !canAutoplayVideoInline) return;
    const hasPoster = !!videoPosterUri.trim();
    if (hasPoster) {
      Animated.timing(feedInlinePosterFade, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(feedInlineVideoReveal, {
        toValue: 1,
        duration: 280,
        useNativeDriver: true,
      }).start();
    }
  }, [
    feedInlineVideoDisplayReady,
    canAutoplayVideoInline,
    videoPosterUri,
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

  const launchImmersive = (albumPhotoIndex = 0) => {
    if (isOptimisticFeedPending) return;
    if (suppressImmersivePressRef.current) {
      suppressImmersivePressRef.current = false;
      return;
    }
    immersiveLaunchRef.current(memory.id, albumPhotoIndex);
  };

  const skipImmersive = isOptimisticFeedPending;

  const feedPhotoFavorited =
    memory.type === 'photo' && isFeedMultiPhotoAlbum(memory)
      ? !!memory.is_favorite || isAlbumFullyFavorited(memory)
      : !!memory.is_favorite;

  const isMediaPost =
    memory.type === 'photo' || memory.type === 'video' || memory.type === 'voice';

  const mediaMetaOverlayProps = {
    dateLabel: addedAtLabel,
    ageLabel: ageAtMemory || undefined,
    locationLabel: locationLabel || undefined,
    onEditLocation: () => handleEditLocation(memory),
    showLocationEdit: !isOptimisticFeedPending,
    feedDateFontFamily,
    feedAgeFontFamily,
    feedLocationFilledFontFamily,
    feedLocationPlaceholderFontFamily,
  };

  const voiceMetaInline = memory.type === 'voice' && !hasVoiceCover;

  const mediaMetaOverlay = isMediaPost && !voiceMetaInline ? (
    <FeedPostMetaOverlay {...mediaMetaOverlayProps} />
  ) : null;

  const postCard = (
    <View style={styles.postShell}>
      <View style={styles.post}>
      {memory.type === 'text' ? (
      <View style={styles.daySeparatorBlock}>
        <View style={styles.dayHeaderRow}>
          <View style={styles.dayHeaderLeft}>
            <Text
              style={[styles.daySepDate, feedDateFontFamily ? { fontFamily: feedDateFontFamily } : null]}
              numberOfLines={1}
            >
              {addedAtLabel}
            </Text>
            {!!ageAtMemory && (
              <Text
                style={[styles.daySepAge, feedAgeFontFamily ? { fontFamily: feedAgeFontFamily } : null]}
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
                      feedLocationFilledFontFamily
                        ? { fontFamily: feedLocationFilledFontFamily }
                        : null,
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
                      feedLocationPlaceholderFontFamily
                        ? { fontFamily: feedLocationPlaceholderFontFamily }
                        : null,
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
                  !isOptimisticFeedPending && photoUrls.length > 0 ? launchImmersive : undefined
                }
                memoryForFavoriteVariants={memory}
              />
              {isOptimisticFeedPending ? (
                <FeedMediaPrepOverlay
                  compact
                  prominent
                  blockTouches
                  label={pendingPrepLabel?.trim() || t('mediaPrep.addingPhoto')}
                />
              ) : null}
              {showCapturedOverlay ? (
                <CapturedAtOverlay
                  uriForAnalysis={photoUrls[0]}
                  label={capturedOverlayLabel}
                  inkOverride={memory.captured_overlay_ink}
                />
              ) : null}
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
            </View>
          )}

          {memory.type === 'video' && (!!videoPlaybackUri || !!videoPosterUri) && (
            <View style={{ position: 'relative' }}>
              {mediaMetaOverlay}
              <Pressable
                onPress={launchImmersive}
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
                          { backgroundColor: '#000000', zIndex: 0 },
                        ]}
                        pointerEvents="none"
                      />
                      <Animated.View
                        style={[
                          StyleSheet.absoluteFillObject,
                          {
                            opacity: videoPosterUri.trim()
                              ? 1
                              : feedInlineVideoReveal,
                            zIndex: 1,
                            backgroundColor: '#000000',
                          },
                        ]}
                        pointerEvents="none"
                      >
                        <Video
                          ref={feedInlineVideoRef}
                          source={{ uri: videoPlaybackUri }}
                          style={StyleSheet.absoluteFillObject}
                          videoStyle={styles.feedInlineVideoNativeBg}
                          resizeMode={ResizeMode.COVER}
                          shouldPlay={false}
                          isLooping={canAutoplayVideoInline}
                          isMuted={!canAutoplayVideoInline || !feedInlineVideoSoundOn}
                          useNativeControls={false}
                          onReadyForDisplay={() => {
                            setFeedInlineVideoDisplayReady(prev => prev || true);
                          }}
                          onPlaybackStatusUpdate={(status: AVPlaybackStatus) => {
                            if (!status.isLoaded) return;
                            if (
                              status.isPlaying ||
                              (typeof status.positionMillis === 'number' &&
                                status.positionMillis > 40)
                            ) {
                              setFeedInlineVideoDisplayReady(prev => prev || true);
                            }
                          }}
                        />
                      </Animated.View>
                      {videoPosterUri.trim() ? (
                        canAutoplayVideoInline ? (
                          <Animated.View
                            style={[
                              StyleSheet.absoluteFillObject,
                              { opacity: feedInlinePosterFade, zIndex: 2 },
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
                          </Animated.View>
                        ) : (
                          <Image
                            source={{ uri: videoPosterUri }}
                            style={[StyleSheet.absoluteFillObject, { zIndex: 2 }]}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={`poster-${memory.id}`}
                          />
                        )
                      ) : null}
                      {/** Roue uniquement sur carte d’upload vidéo (pending) — jamais au scroll autoplay. */}
                      {isOptimisticFeedPending ? (
                        <FeedMediaPrepOverlay
                          compact
                          prominent
                          blockTouches
                          label={videoPosterUri.trim() ? '' : t('mediaPrep.preparing')}
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
                      {isOptimisticFeedPending ? (
                        <FeedMediaPrepOverlay compact prominent blockTouches label="" />
                      ) : null}
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
              />
              {showCapturedOverlay && videoUriForOverlay ? (
                <CapturedAtOverlay
                  uriForAnalysis={videoUriForOverlay}
                  label={capturedOverlayLabel}
                  inkOverride={memory.captured_overlay_ink}
                />
              ) : null}
            </View>
          )}

          {memory.type === 'voice' && (!!memory.media_url || !!voicePlaybackSigned) && (
            <View style={{ position: 'relative' }}>
              {mediaMetaOverlay}
            <Pressable
              onPress={launchImmersive}
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
                <FeedPostMetaOverlay {...mediaMetaOverlayProps} layout="inline" />
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
                  style={[styles.textTitle, { fontFamily: memoryEditorialBoldFont }]}
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
                      { fontFamily: memoryEditorialFont },
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
                    { fontFamily: memoryEditorialFont },
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
              <TouchableOpacity
                style={styles.feedPencilDiscCta}
                onPress={() => handleEditMemory(memory)}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel={
                  memory.type === 'text'
                    ? 'Modifier le texte'
                    : memory.content?.trim()
                      ? 'Modifier'
                      : 'Annoter'
                }
              >
                <Pencil
                  size={FEED_POST_ACTION_ICON_PX}
                  color={ACTION_ICON_INK}
                  strokeWidth={FEED_POST_ACTION_STROKE}
                />
              </TouchableOpacity>
            ) : null}

            {memory.type === 'text' && !skipImmersive ? (
              <TouchableOpacity
                style={styles.feedPencilDiscCta}
                onPress={launchImmersive}
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

          <TouchableOpacity
            style={[
              styles.feedFavoriteDiscCta,
              (memory.type === 'photo' ? feedPhotoFavorited : !!memory.is_favorite) &&
                styles.feedFavoriteDiscCtaActive,
            ]}
            onPress={() => void toggleFavorite(memory.id)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Favori"
          >
            <Heart
              size={FEED_POST_ACTION_ICON_PX}
              color={
                (memory.type === 'photo' ? feedPhotoFavorited : !!memory.is_favorite)
                  ? THEME.brandCtaOrange
                  : ACTION_ICON_INK
              }
              strokeWidth={FEED_POST_ACTION_STROKE}
              fill={
                (memory.type === 'photo' ? feedPhotoFavorited : !!memory.is_favorite)
                  ? THEME.brandCtaOrange
                  : 'none'
              }
            />
          </TouchableOpacity>
        </View>
      </View>
      </View>
    </View>
  );

  return (
    <View style={[styles.feedRowRoot, memoryIndex > 0 && styles.feedRowSpacingTop]}>
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
    </View>
  );
}

const FilMemoryRowMemo = memo(FilMemoryRow, filMemoryRowDataPropsEqual);

export { FilMemoryRowMemo, PendingFeedUploadCard };
