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
import { Pencil, Heart, Play, Trash2, ImagePlus, Volume2, VolumeX } from 'lucide-react-native';
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
import { TEXT_POST_CARD_INSET } from '@/constants/feedLayout';
import { APP_ICON_PX } from '@/constants/iconSizes';
import PhotoMosaic from "@/components/PhotoMosaic";
import {
  isAlbumFullyFavorited,
  isFeedMultiPhotoAlbum,
  parseFavoritePhotoUrls,
} from '@/utils/memoryPhotos';
import { useFeedPhotoDisplayUrls } from "@/hooks/useFeedPhotoDisplayUrls";
import { useFeedVideoPlaybackUri } from '@/hooks/useFeedVideoPlaybackUri';
import { useExpoAvShouldPlay } from '@/hooks/useExpoAvShouldPlay';
import { normalizeVideoPlaybackUri } from '@/utils/videoMediaUri';
import { clampAudioBookAnnotation } from '@/lib/audioBookAnnotation';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { Video, ResizeMode, type AVPlaybackStatus } from 'expo-av';
import { Swipeable, RectButton } from "react-native-gesture-handler";
import { CapturedAtOverlay } from '@/components/feed/FeedMediaOverlays';
import PenIcon from '@/components/PenIcon';
import type { PendingUpload } from "@/contexts/PendingMediaUploadsContext";
import {
  formatDuration,
  formatDateLong,
  formatAgeAtMemory,
} from '@/utils/date';
import {
  capturedMediaDateLabel,
  shouldShowCapturedMediaDateOverlay,
} from '@/utils/feedCaptureOverlay';
import AudioPlayer from "@/components/AudioPlayer";
import {
  filChildLiteKey,
  filMemoryLiteKey,
  type Memory,
  type Child,
} from "@/utils/feedHelpers";
import { styles, TEXT_POST_GUTTER } from "@/components/feed/feedStyles";
import { ensurePlaybackAudioForListening } from '@/lib/playbackAudioMode';

/** Icônes d’action (hors favori couleur charte) */
const ACTION_ICON_INK = '#0A0A0A';

const EM_QUAD = '\u2003';

/** Taille unique des icônes dans le fil (actions + overlays). */
const FEED_ICON_PX = APP_ICON_PX;
const FEED_PEN_ICON_PX = scale(20);
/** Cœur favori sous le post (à côté du crayon). */
const FEED_FAVORITE_HEART_PX = scale(20);

/** Une ligne « envoi en cours » (même liste que les souvenirs → pas de saut de header FlatList). */
export type FeedListItem =
  | { rowKind: 'pending'; row: PendingUpload }
  | { rowKind: 'memory'; memory: Memory };

type FilMemoryRowProps = {
  memory: Memory;
  /** Indice dans `memories` (hors pending), pour `postHeights` / snap. */
  memoryIndex: number;
  memories: Memory[];
  setPostHeights: Dispatch<SetStateAction<number[]>>;
  child: Child | null;
  uploadingVoiceCoverId: string | null;
  setMemories: Dispatch<SetStateAction<Memory[]>>;
  toggleFavorite: (id: string) => void | Promise<void>;
  handleEditMemory: (m: Memory) => void;
  handleEditLocation: (m: Memory) => void;
  handlePickVoiceCover: (m: Memory) => void | Promise<void>;
  handleDeleteMemory: (m: Memory) => void;
  swipeRefs: MutableRefObject<Map<string, Swipeable | null>>;
  immersiveLaunchRef: RefObject<(memoryId: string, albumPhotoIndex?: number) => void>;
  /** Ligne « import en cours » : ne pas écrire dans `postHeights` (index hors `memories`). */
  skipPostHeightMeasurement?: boolean;
  /** Import non finalisé : pas de favori / swipe / actions. */
  isOptimisticFeedPending?: boolean;
  /** Vidéo sélectionnée pour lecture auto muette dans le fil (style Instagram). */
  isFeedVideoAutoplay?: boolean;
};
function filMemoryRowDataPropsEqual(prev: FilMemoryRowProps, next: FilMemoryRowProps): boolean {
  if (prev.memoryIndex !== next.memoryIndex) return false;
  if (prev.uploadingVoiceCoverId !== next.uploadingVoiceCoverId) return false;
  if (!!prev.skipPostHeightMeasurement !== !!next.skipPostHeightMeasurement) return false;
  if (!!prev.isOptimisticFeedPending !== !!next.isOptimisticFeedPending) return false;
  if (!!prev.isFeedVideoAutoplay !== !!next.isFeedVideoAutoplay) return false;
  if (filChildLiteKey(prev.child) !== filChildLiteKey(next.child)) return false;
  if (filMemoryLiteKey(prev.memory) !== filMemoryLiteKey(next.memory)) return false;
  return true;
}
const PendingFeedUploadCard = memo(function PendingFeedUploadCard({ p }: { p: PendingUpload }) {
  const isVideo = p.kind === 'video';
  const preview0 = p.previewUris[0];
  return (
    <View style={styles.postShell}>
      <View style={styles.post}>
      <View style={styles.daySeparatorBlock}>
        <View style={styles.dayHeaderRow}>
          <View style={styles.dayHeaderLeft}>
            <Text style={styles.daySepDate} numberOfLines={1}>
              {p.status === 'uploading' ? 'Envoi en cours…' : 'Envoi'}
            </Text>
          </View>
          <View style={styles.dayHeaderRight}>
            {!!p.locationPreview?.trim() ? (
              <Text style={styles.daySepLocation} numberOfLines={1}>
                {`à ${p.locationPreview.trim().replace(/\s*\([^)]*\)\s*$/, '').trim()}`}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
      <View style={styles.postMain}>
        <View style={styles.postBody}>
          <View style={{ position: 'relative' }}>
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
  memories,
  setPostHeights,
  child,
  uploadingVoiceCoverId,
  setMemories,
  toggleFavorite,
  handleEditMemory,
  handleEditLocation,
  handlePickVoiceCover,
  handleDeleteMemory,
  swipeRefs,
  immersiveLaunchRef,
  skipPostHeightMeasurement = false,
  isOptimisticFeedPending = false,
  isFeedVideoAutoplay = false,
}: FilMemoryRowProps) {
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
  const videoPosterRaw =
    (memory.poster_url?.trim() || memory.thumbnail_url?.trim() || '') || '';
  const videoPosterSigned = useSignedMediaUrl(videoPosterRaw || null) ?? '';
  const videoPosterUri = normalizeVideoPlaybackUri((videoPosterSigned || videoPosterRaw).trim());
  const voiceCoverDisplayUri =
    useSignedMediaUrl((memory.voice_cover_path ?? memory.voice_cover_url) ?? null) ?? '';
  const voicePlaybackSigned =
    useSignedMediaUrl(memory.type === 'voice' ? (memory.media_url ?? null) : null) ?? '';
  const videoPlaybackUri = useFeedVideoPlaybackUri(memory);
  const ageAtMemory = formatAgeAtMemory(child?.birthdate, memory.created_at);
  const addedAtIso = memory.inserted_at || memory.created_at;
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
  useExpoAvShouldPlay(feedInlineVideoRef, canAutoplayVideoInline, videoPlaybackUri);

  useEffect(() => {
    setFeedInlineVideoSoundOn(false);
    setFeedInlineVideoDisplayReady(false);
    feedInlinePosterFade.setValue(1);
    feedInlineVideoReveal.setValue(0);
  }, [memory.id, canAutoplayVideoInline, videoPlaybackUri, feedInlinePosterFade, feedInlineVideoReveal]);

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

  const launchImmersive = (albumPhotoIndex = 0) => {
    if (isOptimisticFeedPending) return;
    immersiveLaunchRef.current(memory.id, albumPhotoIndex);
  };

  const skipImmersive = isOptimisticFeedPending;

  const feedPhotoFavorited =
    memory.type === 'photo' && isFeedMultiPhotoAlbum(memory)
      ? !!memory.is_favorite || isAlbumFullyFavorited(memory)
      : !!memory.is_favorite;

  const postCard = (
    <View
      style={styles.postShell}
      onLayout={(e) => {
        if (skipPostHeightMeasurement) return;
        const h = e.nativeEvent.layout.height;
        const rowIndex = memoryIndex;
        setPostHeights(prev => {
          const next = memories.map((_, i) => prev[i] ?? 0);
          if (next[rowIndex] === h) return prev;
          next[rowIndex] = h;
          return next;
        });
      }}
    >
      <View style={styles.post}>
      <View style={styles.daySeparatorBlock}>
        <View style={styles.dayHeaderRow}>
          <View style={styles.dayHeaderLeft}>
            <Text style={styles.daySepDate} numberOfLines={1}>
              {addedAtLabel}
            </Text>
            {!!ageAtMemory && (
              <Text style={styles.daySepAge} numberOfLines={1}>
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
                  <Text style={styles.daySepLocation} numberOfLines={1}>
                    {locationLabel}
                  </Text>
                ) : (
                  <Text style={[styles.daySepLocation, { color: '#6B7280' }]} numberOfLines={1}>
                    Ajouter un lieu
                  </Text>
                )}
                <Pencil size={APP_ICON_PX * 0.72} color="#4B5563" strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
      <View style={styles.postMain}>
        <Swipeable
          ref={(r) => {
            if (r) swipeRefs.current.set(memory.id, r);
            else swipeRefs.current.delete(memory.id);
          }}
          enabled={!isOptimisticFeedPending}
          friction={2}
          overshootRight={false}
          renderRightActions={
            isOptimisticFeedPending
              ? undefined
              : () => (
                  <View style={styles.swipeDeleteContainer}>
                    <RectButton style={styles.swipeDeleteBtn} onPress={() => handleDeleteMemory(memory)}>
                      <Trash2 size={scale(22)} color="#FFFFFF" strokeWidth={2.2} />
                      <Text style={styles.swipeDeleteLabel}>Supprimer</Text>
                    </RectButton>
                  </View>
                )
          }
        >
          <View style={styles.postBody}>
          {memory.type === 'photo' && photoUrls.length > 0 && (
            <View style={{ position: 'relative' }}>
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
            <View style={[styles.mediaCard, styles.photoPlaceholder]} />
          )}

          {memory.type === 'video' && (!!videoPlaybackUri || !!videoPosterUri) && (
            <View style={{ position: 'relative' }}>
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
                            opacity: 1,
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
                          shouldPlay={canAutoplayVideoInline}
                          isLooping={canAutoplayVideoInline}
                          isMuted={!canAutoplayVideoInline || !feedInlineVideoSoundOn}
                          useNativeControls={false}
                          onReadyForDisplay={() => {
                            setFeedInlineVideoDisplayReady(prev => prev || true);
                            if (canAutoplayVideoInline) {
                              void feedInlineVideoRef.current?.playAsync();
                            }
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
                              cachePolicy="disk"
                              recyclingKey={memory.id}
                            />
                          </Animated.View>
                        ) : (
                          <Image
                            source={{ uri: videoPosterUri }}
                            style={[StyleSheet.absoluteFillObject, { zIndex: 2 }]}
                            contentFit="cover"
                            cachePolicy="disk"
                            recyclingKey={memory.id}
                          />
                        )
                      ) : null}
                    </View>
                  ) : videoPosterUri ? (
                    <Image
                      source={{ uri: videoPosterUri }}
                      style={styles.photoImage}
                      contentFit="cover"
                      cachePolicy="disk"
                      recyclingKey={memory.id}
                    />
                  ) : (
                    <View style={[styles.photoImage, { backgroundColor: '#000000' }]} />
                  )}
                  {!skipImmersive && !canAutoplayVideoInline ? (
                    <View style={[styles.playOverlay, styles.videoPlayIconAboveTap]} pointerEvents="none">
                      <View style={styles.playButton}>
                        <Play size={ICON_SIZES.sm} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
                      </View>
                    </View>
                  ) : null}
                  {memory.duration ? (
                    <View style={styles.videoDurationBadgeTopRight} pointerEvents="none">
                      <Text style={styles.durationText}>{formatDuration(memory.duration)}</Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
              {canAutoplayVideoInline ? (
                <TouchableOpacity
                  style={styles.videoSoundToggleTopLeft}
                  onPress={() => void toggleFeedInlineVideoSound()}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={
                    feedInlineVideoSoundOn ? 'Couper le son de la vidéo' : 'Activer le son de la vidéo'
                  }
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  {feedInlineVideoSoundOn ? (
                    <Volume2 size={scale(18)} color="#FFFFFF" strokeWidth={2} />
                  ) : (
                    <VolumeX size={scale(18)} color="#FFFFFF" strokeWidth={2} />
                  )}
                </TouchableOpacity>
              ) : null}
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
            <Pressable
              onPress={launchImmersive}
              disabled={skipImmersive}
              accessibilityRole="button"
              accessibilityLabel="Ouvrir en plein écran"
            >
            <View
              style={[
                styles.audioBody,
                (memory.voice_cover_path ?? memory.voice_cover_url) ? styles.audioBodyWithCover : null,
              ]}
            >
              {!!(memory.voice_cover_path ?? memory.voice_cover_url) && (
                <>
                  <Image
                    source={{ uri: voiceCoverDisplayUri }}
                    style={styles.voiceCoverBg}
                    contentFit="cover"
                    cachePolicy="disk"
                    recyclingKey={memory.id}
                  />
                  <View style={styles.voiceCoverScrim} />
                </>
              )}
              <View
                style={[
                  styles.audioForeground,
                  (memory.voice_cover_path ?? memory.voice_cover_url) ? styles.audioForegroundCover : null,
                ]}
              >
                <View
                  style={[
                    styles.audioPlayerWrap,
                    (memory.voice_cover_path ?? memory.voice_cover_url) ? styles.audioPlayerWrapCover : null,
                  ]}
                >
                  <AudioPlayer
                    uri={voicePlaybackSigned || (memory.media_url ?? '')}
                    duration={memory.duration || 0}
                    playbackStartSec={memory.voice_playback_start_sec ?? null}
                    variant={(memory.voice_cover_path ?? memory.voice_cover_url) ? 'coverBottom' : 'default'}
                    controlIconColor={ACTION_ICON_INK}
                    coverFlushBottom={!!(memory.voice_cover_path ?? memory.voice_cover_url)}
                    feedPlayDiscOutline
                  />
                </View>
              </View>
            </View>
            </Pressable>
          )}

          {memory.type === 'text' && (
            <Pressable
              onPress={launchImmersive}
              disabled={skipImmersive}
              style={({ pressed }) => [pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
              accessibilityLabel="Ouvrir en plein écran"
            >
              <View style={styles.textBody}>
                {bookParagraphs.map((para, idx) => (
                  <Text
                    key={idx}
                    style={[styles.textContent, idx > 0 && styles.textBookParagraphSpacing]}
                    {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
                  >
                    {EM_QUAD}
                    {para.replace(/\n/g, `\n${EM_QUAD}`)}
                  </Text>
                ))}
              </View>
            </Pressable>
          )}
          </View>
        </Swipeable>

        {memory.type !== 'text' && !!contentText && (
          <>
            <Pressable
              style={({ pressed }) => [styles.postCaption, pressed && { opacity: 0.92 }]}
              onPress={() => handleEditMemory(memory)}
              accessibilityRole="button"
              accessibilityLabel="Modifier l’annotation"
            >
              <Text
                style={styles.captionAnnotation}
                numberOfLines={memory.type === 'voice' ? 2 : 4}
              >
                {contentText}
              </Text>
            </Pressable>
          </>
        )}

        <View
          style={[
            styles.postActions,
            styles.postActionsSpread,
            memory.type === 'text' && { paddingHorizontal: TEXT_POST_GUTTER },
          ]}
        >
          <View style={styles.postActionsLeft}>
            {memory.type === 'text' || !contentText ? (
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
                <PenIcon size={FEED_PEN_ICON_PX} color={THEME.feedPencilDiscCtaForeground} />
              </TouchableOpacity>
            ) : null}

            {memory.type === 'voice' && (!!memory.media_url || !!voicePlaybackSigned) && (
              <TouchableOpacity
                style={styles.actionButton}
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
                  <ImagePlus size={FEED_ICON_PX} color={ACTION_ICON_INK} strokeWidth={2.2} />
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
              size={FEED_FAVORITE_HEART_PX}
              color={
                (memory.type === 'photo' ? feedPhotoFavorited : !!memory.is_favorite)
                  ? THEME.brandPrimary
                  : ACTION_ICON_INK
              }
              strokeWidth={2.05}
              fill={
                (memory.type === 'photo' ? feedPhotoFavorited : !!memory.is_favorite)
                  ? THEME.brandPrimary
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
