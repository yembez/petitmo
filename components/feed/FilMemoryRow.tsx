import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { Pencil, Heart, Play, Trash2, ImagePlus } from 'lucide-react-native';
import {
  memo,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from 'react';
import { THEME } from "@/constants/theme";
import { scale, verticalScale } from "@/utils/responsive";
import { ICON_SIZES } from "@/constants/sizes";
import { TEXT_POST_CARD_INSET } from '@/constants/feedLayout';
import { APP_ICON_PX } from '@/constants/iconSizes';
import PhotoMosaic from "@/components/PhotoMosaic";
import { parseFavoritePhotoUrls } from "@/utils/memoryPhotos";
import { useFeedPhotoDisplayUrls } from "@/hooks/useFeedPhotoDisplayUrls";
import { useFeedVideoPlaybackUri } from "@/hooks/useFeedVideoPlaybackUri";
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { Video, ResizeMode } from "expo-av";
import { Swipeable, RectButton } from "react-native-gesture-handler";
import { useDominantImageColors } from "@/hooks/useDominantImageColors";
import type { PendingUpload } from "@/contexts/PendingMediaUploadsContext";
import {
  formatDuration,
  formatDateLong,
  formatAgeAtMemory,
  formatCaptureStickerLabel,
} from '@/utils/date';
import AudioPlayer from "@/components/AudioPlayer";
import {
  filChildLiteKey,
  filMemoryLiteKey,
  type Memory,
  type Child,
} from "@/utils/feedHelpers";
import { styles, TEXT_POST_GUTTER } from "@/components/feed/feedStyles";

/** Icônes d’action (hors favori couleur charte) */
const ACTION_ICON_INK = '#0A0A0A';

/** Textes des souvenirs `type: 'text'` créés depuis « Écrire » (Lora Italic) */
const FONT_MAMAN = 'Lora_400Regular_Italic';

const EM_QUAD = '\u2003';

/** Même logique que l’étiquette date (patch bas-droite) : blanc par défaut, noir si le serveur l’indique. */
function feedPhotoOverlayInk(inkOverride?: string | null): '#FFFFFF' | '#0A0A0A' {
  const inkRaw = (inkOverride ?? '').trim().toUpperCase();
  if (inkRaw === '#0A0A0A' || inkRaw === '#FFFFFF') return inkRaw;
  return '#FFFFFF';
}

function CapturedAtOverlay({ uriForAnalysis, label, inkOverride }: { uriForAnalysis: string; label: string; inkOverride?: string | null }) {
  // IMPORTANT: le calcul fiable est fait côté serveur sur un patch bas-droite (captured_overlay_ink).
  // Côté app, on évite toute heuristique "globale" (souvent fausse au premier render),
  // et on force BLANC par défaut. Noir uniquement si le serveur l'a explicitement demandé.
  useDominantImageColors(uriForAnalysis); // garde le hook (pré-chargement/caching), mais n'influence pas l'encre.
  const ink = feedPhotoOverlayInk(inkOverride);

  return (
    <View style={[styles.capturedOverlay, { maxWidth: '78%', alignSelf: 'flex-end' }]} pointerEvents="none">
      <View style={styles.overlayBadge}>
        <Text
          style={[
            styles.capturedOverlayText,
            { color: ink, textAlign: 'right' as const },
          ]}
          numberOfLines={2}
        >
          {label}
        </Text>
      </View>
    </View>
  );
}

/** Taille unique des icônes dans le fil (actions + overlays). */
const FEED_ICON_PX = APP_ICON_PX;
/** Cœur favori : même taille sur médias (photo/vidéo) et sur la ligne d’actions (texte/vocal). */
const FEED_FAVORITE_HEART_PX = scale(20);

/** Favori sur média : hors sélection = contour blanc sur fond sombre ; actif = cœur terracotta plein, fond disque blanc léger. */
function FeedPhotoFavoriteOverlay({
  isFavorite,
  inkOverride,
  onPress,
}: {
  isFavorite: boolean;
  inkOverride?: string | null;
  onPress: () => void;
}) {
  void inkOverride;
  const outlineInk = '#FFFFFF' as const;
  const terracotta = THEME.feedFavoriteTerracotta;

  return (
    <View style={styles.feedPhotoFavoriteOverlay} pointerEvents="box-none">
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.75}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={isFavorite ? 'Retirer des favoris' : 'Mettre en favori'}
        style={[
          styles.feedFavoriteMediaCircle,
          isFavorite && styles.feedFavoriteMediaCircleActive,
        ]}
      >
        <Heart
          size={FEED_FAVORITE_HEART_PX}
          color={isFavorite ? terracotta : outlineInk}
          strokeWidth={isFavorite ? 2.05 : 2.45}
          fill={isFavorite ? terracotta : 'none'}
        />
      </TouchableOpacity>
    </View>
  );
}
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
  fontsLoaded: boolean;
  playingVideoId: string | null;
  setPlayingVideoId: Dispatch<SetStateAction<string | null>>;
  uploadingVoiceCoverId: string | null;
  setMemories: Dispatch<SetStateAction<Memory[]>>;
  toggleFavorite: (id: string) => void | Promise<void>;
  handleEditMemory: (m: Memory) => void;
  handleEditLocation: (m: Memory) => void;
  handlePickVoiceCover: (m: Memory) => void | Promise<void>;
  handleDeleteMemory: (m: Memory) => void;
  swipeRefs: MutableRefObject<Map<string, Swipeable | null>>;
  /** Ligne « import en cours » : ne pas écrire dans `postHeights` (index hors `memories`). */
  skipPostHeightMeasurement?: boolean;
  /** Import non finalisé : pas de favori / swipe / actions. */
  isOptimisticFeedPending?: boolean;
};
function filMemoryRowDataPropsEqual(prev: FilMemoryRowProps, next: FilMemoryRowProps): boolean {
  if (prev.memoryIndex !== next.memoryIndex) return false;
  if (prev.playingVideoId !== next.playingVideoId) return false;
  if (prev.uploadingVoiceCoverId !== next.uploadingVoiceCoverId) return false;
  if (prev.fontsLoaded !== next.fontsLoaded) return false;
  if (!!prev.skipPostHeightMeasurement !== !!next.skipPostHeightMeasurement) return false;
  if (!!prev.isOptimisticFeedPending !== !!next.isOptimisticFeedPending) return false;
  if (filChildLiteKey(prev.child) !== filChildLiteKey(next.child)) return false;
  if (filMemoryLiteKey(prev.memory) !== filMemoryLiteKey(next.memory)) return false;
  return true;
}
const PendingFeedUploadCard = memo(function PendingFeedUploadCard({ p }: { p: PendingUpload }) {
  const isVideo = p.kind === 'video';
  const preview0 = p.previewUris[0];
  return (
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
                <View style={[styles.mediaCard, styles.videoBody]}>
                  <Video
                    source={{ uri: preview0 }}
                    style={styles.photoImage}
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
  );
});

function FilMemoryRow({
  memory,
  memoryIndex,
  memories,
  setPostHeights,
  child,
  fontsLoaded,
  playingVideoId,
  setPlayingVideoId,
  uploadingVoiceCoverId,
  setMemories,
  toggleFavorite,
  handleEditMemory,
  handleEditLocation,
  handlePickVoiceCover,
  handleDeleteMemory,
  swipeRefs,
  skipPostHeightMeasurement = false,
  isOptimisticFeedPending = false,
}: FilMemoryRowProps) {
  const photoUrls = useFeedPhotoDisplayUrls(memory);
  const contentText = memory.content?.trim() || '';
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
  const videoPosterUri = useSignedMediaUrl(videoPosterRaw || null) ?? '';
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
  const capturedIso = memory.created_at;
  /** `formatDateLong` ignore l’heure : même jour prise/import masquait l’overlay ; import optimiste avait created = inserted. */
  const showCapturedOverlay = (() => {
    if (!capturedIso?.trim()) return false;
    const added = addedAtIso?.trim();
    if (!added) return false;
    const tA = new Date(added).getTime();
    const tC = new Date(capturedIso).getTime();
    if (Number.isNaN(tA) || Number.isNaN(tC)) return false;
    if (Math.abs(tA - tC) < 90_000) return false;
    return true;
  })();
  const capturedOverlayLabel = showCapturedOverlay
    ? formatCaptureStickerLabel(capturedIso, memory.location)
    : '';
  const videoUriForOverlay = (videoPosterUri || videoPlaybackUri || '').trim();

  const postCard = (
    <View
      style={styles.post}
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
              />
              <FeedPhotoFavoriteOverlay
                isFavorite={!!memory.is_favorite}
                inkOverride={memory.captured_overlay_ink}
                onPress={() => void toggleFavorite(memory.id)}
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
              <View style={[styles.mediaCard, styles.videoBody]}>
                {playingVideoId === memory.id ? (
                  <Video
                    source={{ uri: videoPlaybackUri }}
                    style={styles.photoImage}
                    resizeMode={ResizeMode.COVER}
                    shouldPlay
                    isLooping={false}
                    isMuted={false}
                    useNativeControls={false}
                    onPlaybackStatusUpdate={status => {
                      if (status.isLoaded && status.didJustFinish) {
                        setPlayingVideoId(prev => (prev === memory.id ? null : prev));
                      }
                    }}
                  />
                ) : videoPosterUri ? (
                  <Image
                    source={{ uri: videoPosterUri }}
                    style={styles.photoImage}
                    contentFit="cover"
                    cachePolicy="disk"
                    recyclingKey={memory.id}
                  />
                ) : videoPlaybackUri ? (
                  <Video
                    source={{ uri: videoPlaybackUri }}
                    style={styles.photoImage}
                    resizeMode={ResizeMode.COVER}
                    shouldPlay={false}
                    isLooping={false}
                    isMuted
                    useNativeControls={false}
                  />
                ) : (
                  <View style={[styles.photoImage, { backgroundColor: '#ECECEF' }]} />
                )}
                <Pressable
                  onPress={() =>
                    setPlayingVideoId(prev => (prev === memory.id ? null : memory.id))
                  }
                  style={styles.videoTapLayer}
                  accessibilityRole="button"
                  accessibilityLabel={
                    playingVideoId === memory.id ? 'Mettre en pause' : 'Lire la vidéo'
                  }
                />
                {playingVideoId !== memory.id ? (
                  <View style={[styles.playOverlay, styles.videoPlayIconAboveTap]} pointerEvents="none">
                    <View style={styles.playButton}>
                      <Play size={ICON_SIZES.sm} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
                    </View>
                  </View>
                ) : null}
                {memory.duration ? (
                  <View style={[styles.durationBadge, styles.videoDurationAboveTap]} pointerEvents="none">
                    <Text style={styles.durationText}>{formatDuration(memory.duration)}</Text>
                  </View>
                ) : null}
              </View>
              <FeedPhotoFavoriteOverlay
                isFavorite={!!memory.is_favorite}
                inkOverride={memory.captured_overlay_ink}
                onPress={() => void toggleFavorite(memory.id)}
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
                  />
                </View>
              </View>
            </View>
          )}

          {memory.type === 'text' && (
            <Pressable
              onPress={() => handleEditMemory(memory)}
              style={({ pressed }) => [pressed && { opacity: 0.92 }]}
              accessibilityRole="button"
              accessibilityLabel="Modifier le texte"
            >
              <View style={styles.textBody}>
                {bookParagraphs.map((para, idx) => (
                  <Text
                    key={idx}
                    style={[
                      styles.textContent,
                      idx > 0 && styles.textBookParagraphSpacing,
                      fontsLoaded && { fontFamily: FONT_MAMAN },
                    ]}
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
                style={[styles.captionAnnotation, fontsLoaded && { fontFamily: FONT_MAMAN }]}
                numberOfLines={4}
              >
                {contentText}
              </Text>
            </Pressable>
          </>
        )}

        <View
          style={[
            styles.postActions,
            memory.type === 'text' && { paddingHorizontal: TEXT_POST_GUTTER },
          ]}
        >
          {!contentText ? (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => handleEditMemory(memory)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={
                memory.type === 'text'
                  ? 'Modifier'
                  : memory.content?.trim()
                    ? 'Modifier'
                    : 'Annoter'
              }
            >
              <Pencil size={FEED_ICON_PX} color={ACTION_ICON_INK} strokeWidth={2.2} />
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

          {memory.type !== 'photo' && memory.type !== 'video' ? (
            <TouchableOpacity
              style={[
                styles.feedFavoriteActionCircle,
                { marginLeft: 'auto' },
                memory.is_favorite && styles.feedFavoriteActionCircleActive,
              ]}
              onPress={() => void toggleFavorite(memory.id)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel="Favori"
            >
              <Heart
                size={FEED_FAVORITE_HEART_PX}
                color={memory.is_favorite ? THEME.feedFavoriteTerracotta : ACTION_ICON_INK}
                strokeWidth={2.05}
                fill={memory.is_favorite ? THEME.feedFavoriteTerracotta : 'none'}
              />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </View>
  );

  return (
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
  );
}

const FilMemoryRowMemo = memo(FilMemoryRow, filMemoryRowDataPropsEqual);

export { FilMemoryRowMemo, PendingFeedUploadCard };
