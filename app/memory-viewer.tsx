import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  useWindowDimensions,
  type ViewToken,
  Platform,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import { Video, ResizeMode } from 'expo-av';
import { Volume2, VolumeX, X } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import {
  clearMemoryViewerSession,
  peekMemoryViewerSession,
} from '@/services/memoryViewerSession';
import type { Memory, Child } from '@/types/local';
import { getChildren } from '@/services/children';
import {
  getPrimaryPhotoUriForImmersiveViewer,
  pickPhotoUriForOverlayPalette,
} from '@/utils/memoryPhotos';
import { extractMediaBucketPath } from '@/lib/mediaSignedUrl';
import { formatAgeAtMemory, formatDateLong } from '@/utils/date';
import { childDisplayGivenName } from '@/utils/childDisplayName';
import { useFeedVideoPlaybackUri } from '@/hooks/useFeedVideoPlaybackUri';
import { useExpoAvShouldPlay } from '@/hooks/useExpoAvShouldPlay';
import { normalizeVideoPlaybackUri } from '@/utils/videoMediaUri';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { ensurePlaybackAudioForListening } from '@/lib/playbackAudioMode';
import AudioPlayer from '@/components/AudioPlayer';
import EditTextModal from '@/components/EditTextModal';
import { updateMemoryContent } from '@/services/media';
import { useToggleFavorite } from '@/hooks/useToggleFavorite';
import {
  CapturedAtOverlay,
  FeedPhotoFavoriteOverlay,
} from '@/components/feed/FeedMediaOverlays';
import {
  capturedMediaDateLabel,
  shouldShowCapturedMediaDateOverlay,
} from '@/utils/feedCaptureOverlay';
import { THEME } from '@/constants/theme';
import { MEMORY_TEXT_FONT } from '@/constants/memoryTextFont';

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

function immersiveTopFadeHeight(pageHeight: number): number {
  return Math.max(verticalScale(96), Math.round(pageHeight * 0.24));
}

function isImmersiveMediaType(type: Memory['type']): boolean {
  return type === 'photo' || type === 'video' || type === 'voice';
}

export default function MemoryViewerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowH, width: windowW } = useWindowDimensions();
  const rawIdx = useLocalSearchParams<{ initialIndex?: string | string[] }>().initialIndex;
  const initialIndexParam = Array.isArray(rawIdx) ? rawIdx[0] : rawIdx;
  const parsedInitial = initialIndexParam ? Number.parseInt(initialIndexParam, 10) : 0;

  const [memories, setMemories] = useState<Memory[]>([]);
  const [initialIndex, setInitialIndex] = useState(0);
  const [child, setChild] = useState<Child | null>(null);
  const [visibleId, setVisibleId] = useState<string | null>(null);
  const [editingTextMemory, setEditingTextMemory] = useState<Memory | null>(null);
  const listRef = useRef<FlatList<Memory>>(null);
  const didHydrateRef = useRef(false);
  const toggleFavorite = useToggleFavorite(setMemories);

  useEffect(() => {
    if (didHydrateRef.current) return;
    const payload = peekMemoryViewerSession();
    if (!payload?.memories?.length) {
      router.back();
      return;
    }
    didHydrateRef.current = true;
    const idx = Number.isFinite(parsedInitial)
      ? Math.min(Math.max(0, parsedInitial), payload.memories.length - 1)
      : Math.min(Math.max(0, payload.initialIndex), payload.memories.length - 1);
    setMemories(payload.memories);
    setInitialIndex(idx);
    setVisibleId(payload.memories[idx]?.id ?? null);
    void getChildren().then(list => {
      const cid = payload.memories[0]?.child_id;
      setChild(list.find(c => c.id === cid) ?? null);
    });
  }, [parsedInitial, router]);

  const visibleMemory = useMemo(
    () => memories.find(m => m.id === visibleId) ?? memories[0] ?? null,
    [memories, visibleId],
  );
  const closeOnMediaChrome = visibleMemory ? isImmersiveMediaType(visibleMemory.type) : true;

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(closeOnMediaChrome ? 'light' : 'dark');
      void ensurePlaybackAudioForListening();
      return () => setStatusBarStyle('dark');
    }, [closeOnMediaChrome]),
  );

  useEffect(() => {
    setStatusBarStyle(closeOnMediaChrome ? 'light' : 'dark');
  }, [closeOnMediaChrome]);

  const itemHeight = windowH;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const id =
        viewableItems.length > 0 && viewableItems[0].item?.id
          ? (viewableItems[0].item as Memory).id
          : null;
      setVisibleId(id);
    }
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 85,
  }).current;

  const renderItem = useCallback(
    ({ item }: { item: Memory }) => (
      <ImmersivePage
        memory={item}
        isActive={visibleId === item.id}
        height={itemHeight}
        width={windowW}
        childFirstName={childDisplayGivenName(child?.name)}
        childBirthdate={child?.birthdate ?? null}
        onRequestEditText={m => setEditingTextMemory(m)}
        toggleFavorite={toggleFavorite}
      />
    ),
    [visibleId, itemHeight, windowW, child?.name, child?.birthdate, toggleFavorite]
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

  const keyExtractor = useCallback((m: Memory) => m.id, []);

  if (memories.length === 0) {
    return <View style={[styles.root, { height: windowH, backgroundColor: BG }]} />;
  }

  return (
    <View style={[styles.root, { height: windowH, backgroundColor: BG }]}>
      <StatusBar style={closeOnMediaChrome ? 'light' : 'dark'} />
      <EditTextModal
        key={editingTextMemory?.id ?? 'closed'}
        visible={editingTextMemory !== null}
        initialText={editingTextMemory?.content ?? ''}
        title="Modifier le texte"
        onClose={() => setEditingTextMemory(null)}
        onSave={handleSaveTextEdit}
      />
      <Pressable
        onPress={() => {
          clearMemoryViewerSession();
          router.back();
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
        data={memories}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        initialScrollIndex={initialIndex}
        getItemLayout={getItemLayout}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        removeClippedSubviews={Platform.OS === 'android'}
        windowSize={5}
        maxToRenderPerBatch={3}
        initialNumToRender={2}
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

function ImmersivePage({
  memory,
  isActive,
  height,
  width,
  childFirstName,
  childBirthdate,
  onRequestEditText,
  toggleFavorite,
}: {
  memory: Memory;
  isActive: boolean;
  height: number;
  width: number;
  childFirstName: string;
  childBirthdate: string | null;
  onRequestEditText: (m: Memory) => void;
  toggleFavorite: (id: string) => void | Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const addedLabel = formatDateLong(memory.inserted_at || memory.created_at);
  const ageAt = childBirthdate
    ? formatAgeAtMemory(childBirthdate, memory.created_at)
    : '';
  const loc = memory.location?.trim()
    ? memory.location.replace(/\s*\([^)]*\)\s*$/, '').trim()
    : '';

  const showCapturedOnMedia =
    (memory.type === 'photo' || memory.type === 'video') &&
    shouldShowCapturedMediaDateOverlay(memory);
  const capturedLabelOnMedia = showCapturedOnMedia ? capturedMediaDateLabel(memory) : '';
  const mediaChrome = isImmersiveMediaType(memory.type);
  const topChromePadTop = insets.top + verticalScale(8);
  const topFadeHeight = useMemo(() => immersiveTopFadeHeight(height), [height]);
  const [videoSoundOn, setVideoSoundOn] = useState(true);

  useEffect(() => {
    setVideoSoundOn(true);
  }, [memory.id]);

  const immersiveMetaLine = useMemo(() => {
    const parts: string[] = [];
    if (childFirstName) {
      parts.push(ageAt ? `${childFirstName} · ${ageAt}` : childFirstName);
    }
    parts.push(addedLabel);
    if (loc) parts.push(loc);
    return parts.join(' · ');
  }, [childFirstName, ageAt, addedLabel, loc]);

  const metaBlock = (
    <Text
      style={mediaChrome ? styles.metaLineOnMedia : styles.metaLineOnText}
      numberOfLines={1}
    >
      {immersiveMetaLine}
    </Text>
  );

  return (
    <View style={{ height, width, backgroundColor: BG }}>
      <View style={styles.pageBody}>
        <View style={styles.mediaFill}>
          {memory.type === 'photo' && (
            <ImmersivePhoto
              memory={memory}
              showCapturedOverlay={showCapturedOnMedia}
              capturedOverlayLabel={capturedLabelOnMedia}
              onToggleFavorite={toggleFavorite}
            />
          )}
          {memory.type === 'video' && (
            <ImmersiveVideo
              memory={memory}
              isActive={isActive}
              soundOn={videoSoundOn}
              showCapturedOverlay={showCapturedOnMedia}
              capturedOverlayLabel={capturedLabelOnMedia}
              onToggleFavorite={toggleFavorite}
            />
          )}
          {memory.type === 'voice' && (
            <ImmersiveVoice memory={memory} width={width} onToggleFavorite={toggleFavorite} />
          )}
          {memory.type === 'text' && (
            <ImmersiveText
              memory={memory}
              onTapEdit={() => onRequestEditText(memory)}
              onToggleFavorite={toggleFavorite}
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
          </>
        ) : (
          <View style={[styles.topTextMeta, { paddingTop: topChromePadTop }]} pointerEvents="none">
            {metaBlock}
          </View>
        )}
      </View>

      {memory.type !== 'text' && !!memory.content?.trim() && (
        <View style={styles.footer}>
          <Text style={styles.caption} numberOfLines={5}>
            {memory.content.trim()}
          </Text>
        </View>
      )}
    </View>
  );
}

function ImmersivePhoto({
  memory,
  showCapturedOverlay,
  capturedOverlayLabel,
  onToggleFavorite,
}: {
  memory: Memory;
  showCapturedOverlay: boolean;
  capturedOverlayLabel: string;
  onToggleFavorite: (id: string) => void | Promise<void>;
}) {
  const raw = getPrimaryPhotoUriForImmersiveViewer(memory)?.trim() ?? '';
  const isDeviceLocal =
    !!raw &&
    (raw.startsWith('file:') ||
      raw.startsWith('content:') ||
      raw.startsWith('ph://') ||
      raw.startsWith('assets-library://') ||
      (raw.startsWith('/') && !extractMediaBucketPath(raw)));
  const needsRemoteSign = !!raw && !isDeviceLocal;
  const signed = useSignedMediaUrl(needsRemoteSign ? raw : null);
  const uri = (needsRemoteSign ? signed ?? raw : raw).trim();
  const paletteUri = pickPhotoUriForOverlayPalette(memory) || uri;

  const overlays = (
    <>
      <FeedPhotoFavoriteOverlay
        isFavorite={!!memory.is_favorite}
        inkOverride={memory.captured_overlay_ink}
        onPress={() => void onToggleFavorite(memory.id)}
      />
      {showCapturedOverlay && uri ? (
        <CapturedAtOverlay
          uriForAnalysis={paletteUri}
          label={capturedOverlayLabel}
          inkOverride={memory.captured_overlay_ink}
        />
      ) : null}
    </>
  );

  if (!uri) {
    return (
      <View style={[styles.photoImmersiveWrap, styles.mediaFallback]}>
        <FeedPhotoFavoriteOverlay
          isFavorite={!!memory.is_favorite}
          inkOverride={memory.captured_overlay_ink}
          onPress={() => void onToggleFavorite(memory.id)}
        />
      </View>
    );
  }
  return (
    <View style={styles.photoImmersiveWrap}>
      <Image
        source={{ uri }}
        style={styles.fullBleed}
        contentFit="cover"
        cachePolicy="memory-disk"
        priority="high"
        recyclingKey={memory.id}
      />
      {overlays}
    </View>
  );
}

function ImmersiveVideo({
  memory,
  isActive,
  soundOn,
  showCapturedOverlay,
  capturedOverlayLabel,
  onToggleFavorite,
}: {
  memory: Memory;
  isActive: boolean;
  soundOn: boolean;
  showCapturedOverlay: boolean;
  capturedOverlayLabel: string;
  onToggleFavorite: (id: string) => void | Promise<void>;
}) {
  const uri = useFeedVideoPlaybackUri(memory);
  const posterRaw =
    (memory.poster_url?.trim() || memory.thumbnail_url?.trim() || '') || '';
  const posterSigned = useSignedMediaUrl(posterRaw || null) ?? '';
  const posterUri = normalizeVideoPlaybackUri((posterSigned || posterRaw).trim());

  const seedNatural = useMemo(() => {
    const w = memory.original_px_w ?? 0;
    const h = memory.original_px_h ?? 0;
    return w > 0 && h > 0 ? ({ w, h } as const) : null;
  }, [memory.original_px_w, memory.original_px_h]);

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(seedNatural);
  const [videoReady, setVideoReady] = useState(false);
  const immersiveVideoRef = useRef<Video | null>(null);

  const trimmedUri = uri?.trim() ?? '';
  useExpoAvShouldPlay(immersiveVideoRef, isActive, trimmedUri);

  useEffect(() => {
    const w = memory.original_px_w ?? 0;
    const h = memory.original_px_h ?? 0;
    setNatural(w > 0 && h > 0 ? { w, h } : null);
    setVideoReady(false);
  }, [memory.id, memory.original_px_w, memory.original_px_h, trimmedUri]);

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
    (status: { isLoaded?: boolean }) => {
      if (status.isLoaded) markVideoReady();
    },
    [markVideoReady],
  );

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

  const videoUriForOverlay = posterUri.trim();

  const favoriteOverlay = (
    <FeedPhotoFavoriteOverlay
      isFavorite={!!memory.is_favorite}
      inkOverride={memory.captured_overlay_ink}
      onPress={() => void onToggleFavorite(memory.id)}
    />
  );

  const captureOverlay =
    showCapturedOverlay && videoUriForOverlay ? (
      <CapturedAtOverlay
        uriForAnalysis={videoUriForOverlay}
        label={capturedOverlayLabel}
        inkOverride={memory.captured_overlay_ink}
      />
    ) : null;

  const mediaOverlays = (
    <>
      {favoriteOverlay}
      {captureOverlay}
    </>
  );

  if (!trimmedUri && !posterUri) {
    return (
      <View style={[styles.videoImmersiveWrap, styles.mediaFallback]}>
        {mediaOverlays}
      </View>
    );
  }

  const showPosterPlaceholder = !!posterUri && !videoReady;

  return (
    <View style={styles.videoImmersiveWrap}>
      {trimmedUri ? (
        <View style={[StyleSheet.absoluteFillObject, styles.immersiveVideoLayer]} pointerEvents="none">
          <Video
            ref={immersiveVideoRef}
            source={{ uri: trimmedUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode={resizeMode}
            shouldPlay={isActive}
            isLooping
            isMuted={!isActive || !soundOn}
            useNativeControls={false}
            onReadyForDisplay={onReadyForDisplay}
            onPlaybackStatusUpdate={onPlaybackStatusUpdate}
          />
        </View>
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.immersiveVideoBackdrop]} />
      )}

      {showPosterPlaceholder ? (
        <Image
          source={{ uri: posterUri }}
          style={[StyleSheet.absoluteFillObject, styles.immersiveVideoPosterOverlay]}
          contentFit={posterFit}
          cachePolicy="disk"
          recyclingKey={`${memory.id}-poster`}
          onLoad={onPosterLoad}
        />
      ) : null}

      {mediaOverlays}
    </View>
  );
}

function ImmersiveVoice({
  memory,
  width,
  onToggleFavorite,
}: {
  memory: Memory;
  width: number;
  onToggleFavorite: (id: string) => void | Promise<void>;
}) {
  const signed =
    useSignedMediaUrl(memory.type === 'voice' ? (memory.media_url ?? null) : null) ?? '';
  const uri = signed.trim() || (memory.media_url ?? '').trim();
  const coverRaw = (memory.voice_cover_path ?? memory.voice_cover_url) ?? null;
  const coverUri = useSignedMediaUrl(coverRaw) ?? '';
  const hasCover = !!coverUri.trim();

  return (
    <View style={[styles.voiceWrapImmersive, { width }, styles.immersiveMediaOverlaysHost]}>
      {hasCover ? (
        <Image
          source={{ uri: coverUri.trim() }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          cachePolicy="disk"
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: THEME.bgScreen }]} />
      )}
      <View style={[styles.voicePlayerImmersive, hasCover && styles.voicePlayerImmersiveCoverScrim]}>
        {uri ? (
          <AudioPlayer
            uri={uri}
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
      />
    </View>
  );
}

function ImmersiveText({
  memory,
  onTapEdit,
  onToggleFavorite,
}: {
  memory: Memory;
  onTapEdit: () => void;
  onToggleFavorite: (id: string) => void | Promise<void>;
}) {
  const raw = memory.content?.trim() || '';
  const fitLevel = useMemo<0 | 1 | 2 | 3>(() => {
    const t = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!t) return 0;
    const paragraphCount = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean).length;
    // Heuristique simple “sans mesure” pour garantir la visibilité sans scroll.
    // On combine longueur + “coût” des paragraphes (sauts de ligne plus chers visuellement).
    const approxLines = Math.ceil(t.length / 23) + Math.max(0, paragraphCount - 1) * 2;
    // Compromis: réduction visible mais pas extrême.
    if (approxLines >= 24 || t.length >= 720 || paragraphCount >= 7) return 3;
    if (approxLines >= 20 || t.length >= 600 || paragraphCount >= 5) return 2;
    if (approxLines >= 16 || t.length >= 480 || paragraphCount >= 4) return 1;
    return 0;
  }, [raw]);
  const paragraphs = useMemo(() => {
    const t = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!t) return ['Un joli mot du cœur'];
    const parts = t.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    return parts.length ? parts : [t];
  }, [raw]);

  const wrapStyle =
    fitLevel === 3
      ? styles.textWrapFit3
      : fitLevel === 2
        ? styles.textWrapFit2
        : fitLevel === 1
          ? styles.textWrapFit1
          : null;
  const bodyStyle =
    fitLevel === 3
      ? styles.textBodyFit3
      : fitLevel === 2
        ? styles.textBodyFit2
        : fitLevel === 1
          ? styles.textBodyFit1
          : styles.textBody;
  const paraGapStyle =
    fitLevel === 3
      ? styles.textParaGapFit3
      : fitLevel === 2
        ? styles.textParaGapFit2
        : fitLevel === 1
          ? styles.textParaGapFit1
          : styles.textParaGap;

  return (
    <View style={styles.textImmersiveOuter}>
      <Pressable
        onPress={onTapEdit}
        style={[styles.textWrap, wrapStyle]}
        accessibilityRole="button"
        accessibilityLabel="Modifier le texte"
      >
        {paragraphs.map((para, idx) => (
          <Text
            key={idx}
            style={[bodyStyle, idx > 0 && paraGapStyle]}
            {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
          >
            {EM_QUAD}
            {para.replace(/\n/g, `\n${EM_QUAD}`)}
          </Text>
        ))}
      </Pressable>
      <FeedPhotoFavoriteOverlay
        isFavorite={!!memory.is_favorite}
        inkOverride={memory.captured_overlay_ink}
        onPress={() => void onToggleFavorite(memory.id)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
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
  metaLineOnMedia: {
    color: TOP_CHROME_TEXT,
    fontSize: scale(14),
    fontWeight: '600',
    letterSpacing: -0.2,
    maxWidth: '100%',
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
  metaLineOnText: {
    color: THEME.textPrimary,
    fontSize: scale(14),
    fontWeight: '600',
    letterSpacing: -0.2,
    maxWidth: '100%',
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
  /** Hôte positionné pour pastilles fil (cœur bas-droite). */
  immersiveMediaOverlaysHost: {
    position: 'relative',
  },
  /** Texte immersif : fond blanc + cœur favori comme ligne d’actions fil. */
  textImmersiveOuter: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    position: 'relative',
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
    backgroundColor: BG,
  },
  immersiveVideoPosterOverlay: {
    zIndex: 2,
  },
  immersiveVideoLayer: {
    zIndex: 1,
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
  caption: {
    color: THEME.textPrimary,
    fontSize: scale(15),
    fontWeight: '400',
    fontFamily: MEMORY_TEXT_FONT,
    lineHeight: scale(22),
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
  /** Marges latérales type page de livre (texte immersif). */
  textWrap: {
    flex: 1,
    paddingHorizontal: scale(48),
    justifyContent: 'center',
    minHeight: verticalScale(280),
  },
  textWrapFit1: {
    paddingHorizontal: scale(44),
  },
  textWrapFit2: {
    paddingHorizontal: scale(42),
  },
  textWrapFit3: {
    paddingHorizontal: scale(40),
  },
  textBody: {
    color: THEME.textPrimary,
    fontSize: scale(26),
    lineHeight: scale(34),
    width: '100%',
    textAlign: 'justify',
    textAlignVertical: 'top',
    fontFamily: MEMORY_TEXT_FONT,
  },
  textBodyFit1: {
    color: THEME.textPrimary,
    fontSize: scale(24),
    lineHeight: scale(32),
    width: '100%',
    textAlign: 'justify',
    fontFamily: MEMORY_TEXT_FONT,
  },
  textBodyFit2: {
    color: THEME.textPrimary,
    fontSize: scale(21),
    lineHeight: scale(28),
    width: '100%',
    textAlign: 'justify',
    fontFamily: MEMORY_TEXT_FONT,
  },
  textBodyFit3: {
    color: THEME.textPrimary,
    fontSize: scale(18),
    lineHeight: scale(25),
    width: '100%',
    textAlign: 'justify',
    fontFamily: MEMORY_TEXT_FONT,
  },
  textParaGap: {
    marginTop: verticalScale(18),
  },
  textParaGapFit1: {
    marginTop: verticalScale(16),
  },
  textParaGapFit2: {
    marginTop: verticalScale(14),
  },
  textParaGapFit3: {
    marginTop: verticalScale(12),
  },
});
