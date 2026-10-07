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
    handleEditMemory,
    handleSaveEdit,
    handleEditLocation,
    handleSaveLocation,
    handlePickVoiceCover,
    handleDeleteMemory,
    closeEditModal,
    closeEditLocationModal,
  };
}
