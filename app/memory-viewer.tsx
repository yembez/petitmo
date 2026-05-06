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
import { X } from 'lucide-react-native';
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
import AudioPlayer from '@/components/AudioPlayer';
import EditTextModal from '@/components/EditTextModal';
import { updateMemoryContent } from '@/services/media';

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
      />
    ),
    [visibleId, itemHeight, windowW, child?.name, child?.birthdate]
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
}: {
  memory: Memory;
  isActive: boolean;
  height: number;
  width: number;
  childFirstName: string;
  childBirthdate: string | null;
  onRequestEditText: (m: Memory) => void;
}) {
  const addedLabel = formatDateLong(memory.inserted_at || memory.created_at);
  const ageAt = childBirthdate
    ? formatAgeAtMemory(childBirthdate, memory.created_at)
    : '';
  const loc = memory.location?.trim()
    ? memory.location.replace(/\s*\([^)]*\)\s*$/, '').trim()
    : '';

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
        {memory.type === 'photo' && <ImmersivePhoto memory={memory} />}
        {memory.type === 'video' && (
          <ImmersiveVideo memory={memory} isActive={isActive} width={width} height={height * 0.62} />
        )}
        {memory.type === 'voice' && (
          <ImmersiveVoice memory={memory} width={width} />
        )}
        {memory.type === 'text' && (
          <ImmersiveText memory={memory} onTapEdit={() => onRequestEditText(memory)} />
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

function ImmersivePhoto({ memory }: { memory: Memory }) {
  const uri = getPrimaryPhotoUriForBookPreview(memory);
  if (!uri?.trim()) {
    return <View style={styles.mediaFallback} />;
  }
  return (
    <Image
      source={{ uri: uri.trim() }}
      style={styles.fullBleed}
      contentFit="cover"
      cachePolicy="disk"
      recyclingKey={memory.id}
    />
  );
}

function ImmersiveVideo({
  memory,
  isActive,
  width,
  height,
}: {
  memory: Memory;
  isActive: boolean;
  width: number;
  height: number;
}) {
  const uri = useFeedVideoPlaybackUri(memory);
  const posterRaw =
    (memory.poster_url?.trim() || memory.thumbnail_url?.trim() || '') || '';
  const posterSigned = useSignedMediaUrl(posterRaw || null) ?? '';

  if (!uri?.trim() && !posterSigned?.trim()) {
    return <View style={[styles.mediaFallback, { width, height }]} />;
  }

  return (
    <View style={{ width, height, backgroundColor: '#0A0A0A' }}>
      {uri?.trim() && isActive ? (
        <Video
          source={{ uri: uri.trim() }}
          style={{ width, height }}
          resizeMode={ResizeMode.COVER}
          shouldPlay={isActive}
          isLooping
          isMuted={false}
          useNativeControls={false}
        />
      ) : posterSigned ? (
        <Image
          source={{ uri: posterSigned }}
          style={{ width, height }}
          contentFit="cover"
          cachePolicy="disk"
        />
      ) : uri?.trim() ? (
        <Video
          source={{ uri: uri.trim() }}
          style={{ width, height }}
          resizeMode={ResizeMode.COVER}
          shouldPlay={false}
          isMuted
          useNativeControls={false}
        />
      ) : (
        <View style={[styles.mediaFallback, { width, height }]} />
      )}
    </View>
  );
}

function ImmersiveVoice({ memory, width }: { memory: Memory; width: number }) {
  const signed =
    useSignedMediaUrl(memory.type === 'voice' ? (memory.media_url ?? null) : null) ?? '';
  const uri = signed.trim() || (memory.media_url ?? '').trim();
  const coverRaw = (memory.voice_cover_path ?? memory.voice_cover_url) ?? null;
  const coverUri = useSignedMediaUrl(coverRaw) ?? '';

  return (
    <View style={[styles.voiceWrap, { width }]}>
      {coverUri.trim() ? (
        <Image
          source={{ uri: coverUri.trim() }}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          cachePolicy="disk"
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#1C1C1E' }]} />
      )}
      <View style={styles.voicePlayer}>
        {uri ? (
          <AudioPlayer
            uri={uri}
            duration={memory.duration || 0}
            playbackStartSec={memory.voice_playback_start_sec ?? null}
            variant={coverUri.trim() ? 'coverBottom' : 'default'}
            controlIconColor="#FFFFFF"
            coverFlushBottom={!!coverUri.trim()}
          />
        ) : null}
      </View>
    </View>
  );
}

function ImmersiveText({
  memory,
  onTapEdit,
}: {
  memory: Memory;
  onTapEdit: () => void;
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
  voiceWrap: {
    minHeight: verticalScale(280),
    justifyContent: 'flex-end',
    overflow: 'hidden',
    borderRadius: scale(12),
    marginHorizontal: scale(16),
  },
  voicePlayer: {
    paddingVertical: verticalScale(16),
    paddingHorizontal: scale(16),
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
