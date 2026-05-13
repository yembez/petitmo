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
import { getPrimaryPhotoUriForBookPreview } from '@/utils/memoryPhotos';
import { formatAgeAtMemory, formatDateLong } from '@/utils/date';
import { useFeedVideoPlaybackUri } from '@/hooks/useFeedVideoPlaybackUri';
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

const BG = '#000000';
const CAPTION = 'rgba(255,255,255,0.92)';
const FONT_MAMAN = 'Lora_400Regular_Italic';
const EM_QUAD = '\u2003';

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

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      void ensurePlaybackAudioForListening();
      return () => setStatusBarStyle('dark');
    }, [])
  );

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
        childFirstName={child?.name?.trim().split(/\s+/)[0] ?? ''}
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
      <StatusBar style="light" />
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
        style={[styles.closeBtn, { top: insets.top + verticalScale(8), right: scale(12) }]}
        hitSlop={14}
        accessibilityRole="button"
        accessibilityLabel="Fermer"
      >
        <X color="#FFFFFF" size={scale(28)} strokeWidth={2.2} />
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

  return (
    <View style={{ height, width, backgroundColor: BG }}>
      <View style={[styles.metaTop, { paddingTop: verticalScale(52) }]}>
        {childFirstName ? (
          <Text style={styles.metaTitle} numberOfLines={1}>
            {ageAt ? `${childFirstName} · ${ageAt}` : childFirstName}
          </Text>
        ) : null}
        <Text style={styles.metaSub} numberOfLines={1}>
          {addedLabel}
          {loc ? ` · ${loc}` : ''}
        </Text>
      </View>

      <View style={styles.mediaBlock}>
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
  const raw = getPrimaryPhotoUriForBookPreview(memory)?.trim() ?? '';
  const signed = useSignedMediaUrl(raw || null);
  const uri = (signed ?? raw).trim();

  const overlays = (
    <>
      <FeedPhotoFavoriteOverlay
        isFavorite={!!memory.is_favorite}
        inkOverride={memory.captured_overlay_ink}
        onPress={() => void onToggleFavorite(memory.id)}
      />
      {showCapturedOverlay && uri ? (
        <CapturedAtOverlay
          uriForAnalysis={uri}
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
        cachePolicy="disk"
        recyclingKey={memory.id}
      />
      {overlays}
    </View>
  );
}

function ImmersiveVideo({
  memory,
  isActive,
  showCapturedOverlay,
  capturedOverlayLabel,
  onToggleFavorite,
}: {
  memory: Memory;
  isActive: boolean;
  showCapturedOverlay: boolean;
  capturedOverlayLabel: string;
  onToggleFavorite: (id: string) => void | Promise<void>;
}) {
  const uri = useFeedVideoPlaybackUri(memory);
  const posterRaw =
    (memory.poster_url?.trim() || memory.thumbnail_url?.trim() || '') || '';
  const posterSigned = useSignedMediaUrl(posterRaw || null) ?? '';

  const seedNatural = useMemo(() => {
    const w = memory.original_px_w ?? 0;
    const h = memory.original_px_h ?? 0;
    return w > 0 && h > 0 ? ({ w, h } as const) : null;
  }, [memory.original_px_w, memory.original_px_h]);

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(seedNatural);
  const [immersiveVideoSoundOn, setImmersiveVideoSoundOn] = useState(true);

  useEffect(() => {
    const w = memory.original_px_w ?? 0;
    const h = memory.original_px_h ?? 0;
    setNatural(w > 0 && h > 0 ? { w, h } : null);
  }, [memory.id, memory.original_px_w, memory.original_px_h]);

  useEffect(() => {
    setImmersiveVideoSoundOn(true);
  }, [memory.id]);

  const onReadyForDisplay = useCallback(
    (e: { naturalSize?: { width: number; height: number } }) => {
      const nw = e.naturalSize?.width ?? 0;
      const nh = e.naturalSize?.height ?? 0;
      if (nw > 0 && nh > 0) setNatural({ w: nw, h: nh });
    },
    []
  );

  const onPosterLoad = useCallback((e: { source: { width?: number; height?: number } }) => {
    const w = e.source.width ?? 0;
    const h = e.source.height ?? 0;
    if (w > 0 && h > 0) setNatural(prev => prev ?? { w, h });
  }, []);

  /** Paysage (et carré) : tout voir, jamais rogner. Portrait : remplir au max (cover). */
  const resizeMode =
    natural && natural.h > natural.w ? ResizeMode.COVER : ResizeMode.CONTAIN;
  const posterFit = resizeMode === ResizeMode.CONTAIN ? ('contain' as const) : ('cover' as const);

  const trimmedUri = uri?.trim() ?? '';
  const videoUriForOverlay = (posterSigned.trim() || trimmedUri).trim();

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

  if (!trimmedUri && !posterSigned.trim()) {
    return (
      <View style={[styles.videoImmersiveWrap, styles.mediaFallback]}>
        {mediaOverlays}
      </View>
    );
  }

  if (trimmedUri && isActive) {
    return (
      <View style={styles.videoImmersiveWrap}>
        <Video
          source={{ uri: trimmedUri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode={resizeMode}
          shouldPlay
          isLooping
          isMuted={!immersiveVideoSoundOn}
          useNativeControls={false}
          onReadyForDisplay={onReadyForDisplay}
        />
        {mediaOverlays}
        <Pressable
          style={styles.immersiveVideoSoundToggle}
          onPress={() => setImmersiveVideoSoundOn(v => !v)}
          accessibilityRole="button"
          accessibilityLabel={
            immersiveVideoSoundOn ? 'Couper le son de la vidéo' : 'Activer le son de la vidéo'
          }
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {immersiveVideoSoundOn ? (
            <Volume2 color="#FFFFFF" size={scale(20)} strokeWidth={2} />
          ) : (
            <VolumeX color="#FFFFFF" size={scale(20)} strokeWidth={2} />
          )}
        </Pressable>
      </View>
    );
  }

  if (posterSigned) {
    return (
      <View style={styles.videoImmersiveWrap}>
        <Image
          source={{ uri: posterSigned }}
          style={StyleSheet.absoluteFillObject}
          contentFit={posterFit}
          cachePolicy="disk"
          recyclingKey={memory.id}
          onLoad={onPosterLoad}
        />
        {mediaOverlays}
      </View>
    );
  }

  if (trimmedUri) {
    return (
      <View style={styles.videoImmersiveWrap}>
        <Video
          source={{ uri: trimmedUri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode={resizeMode}
          shouldPlay={false}
          isMuted
          useNativeControls={false}
          onReadyForDisplay={onReadyForDisplay}
        />
        {mediaOverlays}
      </View>
    );
  }

  return (
    <View style={[styles.videoImmersiveWrap, styles.mediaFallback]}>
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
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#1C1C1E' }]} />
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
    padding: scale(8),
    borderRadius: scale(22),
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  metaTop: {
    paddingHorizontal: scale(20),
    paddingBottom: verticalScale(8),
  },
  metaTitle: {
    color: CAPTION,
    fontSize: scale(17),
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  metaSub: {
    marginTop: verticalScale(4),
    color: 'rgba(255,255,255,0.72)',
    fontSize: scale(14),
  },
  mediaBlock: {
    flex: 1,
    justifyContent: 'center',
    minHeight: verticalScale(200),
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
  /** Texte immersif : fond noir + cœur favori comme ligne d’actions fil. */
  textImmersiveOuter: {
    flex: 1,
    width: '100%',
    minHeight: 0,
    position: 'relative',
  },
  /** Vidéo immersive : même extension que photo / vocal dans le bloc média. */
  videoImmersiveWrap: {
    flex: 1,
    width: '100%',
    alignSelf: 'stretch',
    minHeight: 0,
    position: 'relative',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  /** Même logique que le fil : au-dessus des overlays média (favori, date). */
  immersiveVideoSoundToggle: {
    position: 'absolute',
    left: scale(12),
    top: verticalScale(12),
    zIndex: 8,
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  fullBleed: {
    width: '100%',
    minHeight: verticalScale(320),
    flex: 1,
  },
  mediaFallback: {
    flex: 1,
    minHeight: verticalScale(200),
    backgroundColor: '#1C1C1E',
  },
  footer: {
    paddingHorizontal: scale(20),
    paddingBottom: verticalScale(28),
    paddingTop: verticalScale(12),
  },
  caption: {
    color: 'rgba(255,255,255,0.88)',
    fontSize: scale(15),
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
  textWrap: {
    flex: 1,
    paddingHorizontal: scale(28),
    justifyContent: 'center',
    minHeight: verticalScale(280),
  },
  textWrapFit1: {
    paddingHorizontal: scale(26),
  },
  textWrapFit2: {
    paddingHorizontal: scale(25),
  },
  textWrapFit3: {
    paddingHorizontal: scale(24),
  },
  textBody: {
    color: '#FFFFFF',
    fontSize: scale(26),
    lineHeight: scale(34),
    textAlign: 'left',
    // Style “roman” : aligné gauche, justification douce.
    textAlignVertical: 'top',
    ...(Platform.OS === 'ios' || Platform.OS === 'android' ? { textAlign: 'left' as const } : {}),
    fontFamily: FONT_MAMAN,
  },
  textBodyFit1: {
    color: '#FFFFFF',
    fontSize: scale(24),
    lineHeight: scale(32),
    textAlign: 'left',
    fontFamily: FONT_MAMAN,
  },
  textBodyFit2: {
    color: '#FFFFFF',
    fontSize: scale(21),
    lineHeight: scale(28),
    textAlign: 'left',
    fontFamily: FONT_MAMAN,
  },
  textBodyFit3: {
    color: '#FFFFFF',
    fontSize: scale(18),
    lineHeight: scale(25),
    textAlign: 'left',
    fontFamily: FONT_MAMAN,
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
