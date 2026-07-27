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
import { Swipeable } from 'react-native-gesture-handler';
import type { Memory } from '@/utils/feedHelpers';

export function useFilRowActions(setMemories: Dispatch<SetStateAction<Memory[]>>) {
  const router = useRouter();
  const swipeRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [editLocationModalVisible, setEditLocationModalVisible] = useState(false);
  const [editingLocationMemory, setEditingLocationMemory] = useState<Memory | null>(null);
  const [uploadingVoiceCoverId, setUploadingVoiceCoverId] = useState<string | null>(null);

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
        Alert.alert(
          'Connexion',
          "Ton texte est bien enregistré sur l’app, mais la synchronisation a échoué. Réessaie plus tard."
        );
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
        Alert.alert(
          'Connexion',
          "Ton lieu est bien enregistré sur l’app, mais la synchronisation a échoué. Réessaie plus tard."
        );
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
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert('Accès refusé', 'Autorise l’accès aux photos pour ajouter une illustration.');
          return;
        }
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
      Alert.alert('Supprimer ce moment', 'Es-tu sûr de vouloir supprimer ce moment ?', [
        { text: 'Annuler', style: 'cancel', onPress: () => swipeRefs.current.get(memory.id)?.close() },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: async () => {
            swipeRefs.current.get(memory.id)?.close();
            const id = memory.id;
            setMemories(prev => prev.filter(m => m.id !== id));
            await deleteMemory(id);
          },
        },
      ]);
    },
    [setMemories]
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
