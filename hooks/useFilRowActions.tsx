import { useState, useCallback, useRef, type Dispatch, type SetStateAction } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { getLocalMemoryById } from '@/lib/localDb';
import {
  updateMemoryContent,
  updateMemoryLocation,
  deleteMemory,
  updateVoiceMemoryCover,
} from '@/services/media';
import { getMemoryBookDeleteImpact } from '@/services/books';
import { Swipeable } from 'react-native-gesture-handler';
import type { Memory } from '@/utils/feedHelpers';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { resolveEffectiveUserTier } from '@/lib/userTier';
import {
  FREE_TIER_VIDEO_MAX_DURATION,
  PAID_TIER_VIDEO_MAX_DURATION,
} from '@/lib/limits';
import type { VideoTrimModalConfirmResult } from '@/components/VideoTrimModal';
import {
  resolveVideoOriginalUriForRetrim,
  retrimVideoMemoryFromOriginal,
  VideoTrimNativeMissingError,
} from '@/services/retrimVideoMemory';
import { pauseAllPooledVideoPlayersForOverlay } from '@/lib/videoPlayerPool';
import { setFeedAutoplayActiveMemoryId } from '@/lib/feedAutoplayStore';

function formatQuotedBookTitles(titles: string[]): string {
  const quoted = titles.map(t => `« ${t} »`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  if (quoted.length === 2) return `${quoted[0]} et ${quoted[1]}`;
  const head = quoted.slice(0, -1).join(', ');
  return `${head} et ${quoted[quoted.length - 1]}`;
}

export type FilRowActionsScrollBridge = {
  /** Offset Y courant du FlatList (avant retrait). */
  getScrollOffset: () => number;
  /** Re-pin après retrait des data (évite le saut FlatList). */
  pinScrollOffset: (y: number) => void;
};

export function useFilRowActions(
  setMemories: Dispatch<SetStateAction<Memory[]>>,
  scrollBridge?: FilRowActionsScrollBridge,
) {
  const router = useRouter();
  const { t } = useAppTranslation('common');
  const swipeRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [editLocationModalVisible, setEditLocationModalVisible] = useState(false);
  const [editingLocationMemory, setEditingLocationMemory] = useState<Memory | null>(null);
  const [uploadingVoiceCoverId, setUploadingVoiceCoverId] = useState<string | null>(null);
  const [videoTrimTarget, setVideoTrimTarget] = useState<Memory | null>(null);
  const [videoTrimUri, setVideoTrimUri] = useState('');
  const [videoTrimDurationSec, setVideoTrimDurationSec] = useState(0);
  const [videoTrimMaxSec, setVideoTrimMaxSec] = useState(FREE_TIER_VIDEO_MAX_DURATION);
  const [videoTrimFreeTier, setVideoTrimFreeTier] = useState(true);
  const [videoTrimInitialRange, setVideoTrimInitialRange] = useState<{
    startSec: number;
    endSec: number;
  } | null>(null);
  const [videoTrimExporting, setVideoTrimExporting] = useState(false);
  const scrollBridgeRef = useRef(scrollBridge);
  scrollBridgeRef.current = scrollBridge;

  const handleEditMemory = useCallback((memory: Memory) => {
    if (memory.id.startsWith('pending_')) return;
    if (memory.type === 'text') {
      router.push({ pathname: '/write', params: { memoryId: memory.id } });
      return;
    }
    setEditingMemory(memory);
    setEditModalVisible(true);
  }, [router]);

  const handleSaveEdit = useCallback(
    async (text: string) => {
      const target = editingMemory;
      if (!target) return;
      setMemories(prev => prev.map(m => (m.id === target.id ? { ...m, content: text } : m)));
      const ok = await updateMemoryContent(target.id, text);
      if (!ok) {
        Alert.alert('Erreur', "Impossible d’enregistrer le texte sur l’appareil.");
      }
    },
    [editingMemory, setMemories]
  );

  const handleEditLocation = useCallback((memory: Memory) => {
    if (memory.id.startsWith('pending_')) return;
    setEditingLocationMemory(memory);
    setEditLocationModalVisible(true);
  }, []);

  const handleEditVideoTrim = useCallback(
    async (memory: Memory) => {
      if (memory.id.startsWith('pending_') || memory.type !== 'video') return;
      try {
        /** Couper l’autoplay fil AVANT d’ouvrir le 2ᵉ lecteur (sinon freeze iOS). */
        setFeedAutoplayActiveMemoryId(null, 'video-trim-open');
        pauseAllPooledVideoPlayersForOverlay();

        const tier = await resolveEffectiveUserTier();
        const isFree = tier !== 'paid';
        const maxSec = isFree ? FREE_TIER_VIDEO_MAX_DURATION : PAID_TIER_VIDEO_MAX_DURATION;
        const uri = await resolveVideoOriginalUriForRetrim(memory);
        if (!uri.trim()) {
          Alert.alert(t('videoTrim.originalMissingTitle'), t('videoTrim.originalMissingBody'));
          return;
        }
        /**
         * Ne pas inventer une durée (clip ≠ rush). Le modal lit la vraie durée via sourceLoad.
         * Restaure la fenêtre de coupe si déjà éditée.
         */
        const savedStart = memory.video_playback_start_sec;
        const savedEnd = memory.video_playback_end_sec;
        const hasSaved =
          typeof savedStart === 'number' &&
          Number.isFinite(savedStart) &&
          typeof savedEnd === 'number' &&
          Number.isFinite(savedEnd) &&
          savedEnd > savedStart;
        setVideoTrimFreeTier(isFree);
        setVideoTrimMaxSec(maxSec);
        setVideoTrimDurationSec(0);
        setVideoTrimInitialRange(
          hasSaved ? { startSec: Math.max(0, savedStart), endSec: savedEnd } : null,
        );
        setVideoTrimUri(uri);
        setVideoTrimTarget(memory);
      } catch (e) {
        console.warn('[fil] handleEditVideoTrim', e);
        Alert.alert(t('videoTrim.originalMissingTitle'), t('videoTrim.originalMissingBody'));
      }
    },
    [t],
  );

  const closeVideoTrimModal = useCallback(() => {
    setVideoTrimExporting(false);
    setVideoTrimTarget(null);
    setVideoTrimUri('');
    setVideoTrimDurationSec(0);
    setVideoTrimInitialRange(null);
  }, []);

  const handleConfirmVideoTrim = useCallback(
    (range: VideoTrimModalConfirmResult) => {
      const target = videoTrimTarget;
      if (!target) return;
      setVideoTrimTarget(null);
      setVideoTrimUri('');
      setVideoTrimDurationSec(0);
      setVideoTrimInitialRange(null);
      void (async () => {
        setVideoTrimExporting(true);
        await new Promise<void>(r => setTimeout(r, 280));
        try {
          const next = await retrimVideoMemoryFromOriginal({
            memoryId: target.id,
            startSec: range.startSec,
            endSec: range.endSec,
          });
          setMemories(prev => prev.map(m => (m.id === next.id ? next : m)));
        } catch (e) {
          if (e instanceof VideoTrimNativeMissingError) {
            Alert.alert(t('videoTrim.needsRebuildTitle'), t('videoTrim.needsRebuildBody'));
          } else {
            const code = e instanceof Error ? e.message : String(e);
            console.warn('[fil] retrim video', code, e);
            if (
              code === 'original_unreadable' ||
              code === 'VIDEO_TRIM_INPUT_UNREADABLE' ||
              code === 'VIDEO_TRIM_EMPTY_INPUT'
            ) {
              Alert.alert(t('videoTrim.originalMissingTitle'), t('videoTrim.originalMissingBody'));
            } else {
              Alert.alert(t('videoTrim.exportFailedTitle'), t('videoTrim.exportFailedBody'));
            }
          }
        } finally {
          setVideoTrimExporting(false);
        }
      })();
    },
    [setMemories, t, videoTrimTarget],
  );

  const handleSaveLocation = useCallback(
    async (text: string) => {
      const target = editingLocationMemory;
      if (!target) return;
      const next = text.trim();
      setMemories(prev =>
        prev.map(m => (m.id === target.id ? { ...m, location: next ? next : null } : m))
      );
      const ok = await updateMemoryLocation(target.id, next ? next : null);
      if (!ok) {
        Alert.alert('Erreur', "Impossible d’enregistrer le lieu sur l’appareil.");
      }
    },
    [editingLocationMemory, setMemories]
  );

  const handlePickVoiceCover = useCallback(
    async (memory: Memory) => {
      if (memory.type !== 'voice') return;
      const hasAudio = !!(memory.media_url?.trim() || memory.local_media_path?.trim());
      if (!hasAudio) return;
      try {
        const { ensureMediaLibraryPickerAllowed } = await import('@/lib/mediaLibraryOptIn');
        if (!(await ensureMediaLibraryPickerAllowed())) return;

        /** PHPicker après opt-in compte. */
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.85,
          allowsEditing: true,
          aspect: [4, 5],
        });
        if (result.canceled || !result.assets[0]?.uri) return;
        setUploadingVoiceCoverId(memory.id);
        const url = await updateVoiceMemoryCover(memory.id, memory.child_id, result.assets[0].uri);
        setUploadingVoiceCoverId(null);
        if (url) {
          const fresh = getLocalMemoryById(memory.id);
          setMemories(prev =>
            prev.map(m => {
              if (m.id !== memory.id) return m;
              if (fresh) return fresh;
              return {
                ...m,
                voice_cover_url: url,
                voice_cover_path: url,
                updated_at: new Date().toISOString(),
              };
            }),
          );
        } else {
          Alert.alert('Erreur', 'Impossible d’enregistrer la photo de fond.');
        }
      } catch (e) {
        setUploadingVoiceCoverId(null);
        console.error('handlePickVoiceCover', e);
        Alert.alert('Erreur', 'Impossible de choisir une image.');
      }
    },
    [setMemories]
  );

  const handleDeleteMemory = useCallback(
    (memory: Memory) => {
      const closeSwipe = () => swipeRefs.current.get(memory.id)?.close();
      const impact = getMemoryBookDeleteImpact(memory.id);

      if (impact.paidBooks.length > 0) {
        const titles = impact.paidBooks.map(b => b.title);
        Alert.alert(
          t('fil.delete.paidBookTitle'),
          titles.length === 1
            ? t('fil.delete.paidBookBody', { title: titles[0] })
            : t('fil.delete.paidBookMany', { titles: formatQuotedBookTitles(titles) }),
          [{ text: t('ok'), style: 'cancel', onPress: closeSwipe }],
        );
        return;
      }

      const runDelete = () => {
        closeSwipe();
        const id = memory.id;
        const y = Math.max(0, scrollBridgeRef.current?.getScrollOffset() ?? 0);
        // Pin d’abord, puis retire — LinearTransition sur Animated.FlatList anime la remontée.
        scrollBridgeRef.current?.pinScrollOffset(y);
        setMemories(prev => prev.filter(m => m.id !== id));
        void deleteMemory(id);
      };

      if (impact.draftBooks.length > 0) {
        const titles = impact.draftBooks.map(b => b.title);
        Alert.alert(
          t('fil.delete.inBookTitle'),
          titles.length === 1
            ? t('fil.delete.inBookOne', { title: titles[0] })
            : t('fil.delete.inBookMany', { titles: formatQuotedBookTitles(titles) }),
          [
            { text: t('cancel'), style: 'cancel', onPress: closeSwipe },
            { text: t('fil.delete.confirm'), style: 'destructive', onPress: runDelete },
          ],
        );
        return;
      }

      Alert.alert(t('fil.delete.title'), t('fil.delete.body'), [
        { text: t('cancel'), style: 'cancel', onPress: closeSwipe },
        { text: t('fil.delete.confirm'), style: 'destructive', onPress: runDelete },
      ]);
    },
    [setMemories, t],
  );

  const closeEditModal = useCallback(() => {
    setEditModalVisible(false);
    setEditingMemory(null);
  }, []);

  const closeEditLocationModal = useCallback(() => {
    setEditLocationModalVisible(false);
    setEditingLocationMemory(null);
  }, []);

  return {
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
  };
}
