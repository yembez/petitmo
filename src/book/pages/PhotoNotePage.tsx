import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, DMSans_400Regular, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { EBGaramond_400Regular_Italic } from '@expo-google-fonts/eb-garamond';
import { Pencil } from 'lucide-react-native';
import type { Memory } from '@/types/local';
import FilteredImage from '@/components/FilteredImage';
import EditTextModal from '@/components/EditTextModal';

const A5_RATIO = 0.7;

function formatBookDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleDateString('fr-FR', { month: 'long' }).toUpperCase();
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export interface PhotoNotePageProps {
  memory: Memory;
  width: number;
  pageNumber?: number;
  rotation?: number;
  onRotate: () => void;
  onEdit: (newText: string) => void;
}

export default function PhotoNotePage({
  memory,
  width,
  pageNumber = 1,
  rotation = 0,
  onRotate,
  onEdit,
}: PhotoNotePageProps) {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_600SemiBold,
    EBGaramond_400Regular_Italic,
  });

  const [editOpen, setEditOpen] = useState(false);

  const height = width / A5_RATIO;
  const uri = memory.edited_media_url ?? memory.media_url;
  const bodyText = (memory.content ?? '').trim() || 'Ta note…';

  const dm400 = fontsLoaded ? 'DMSans_400Regular' : undefined;
  const dm600 = fontsLoaded ? 'DMSans_600SemiBold' : undefined;
  const garamondItalic = fontsLoaded ? 'EBGaramond_400Regular_Italic' : undefined;

  const handleSave = useCallback(
    (text: string) => {
      onEdit(text);
    },
    [onEdit]
  );

  return (
    <View style={[styles.root, { width, height }]}>
      <View style={styles.topCol}>
        <View style={styles.banner}>
          <View style={styles.bannerLeft}>
            <View style={styles.bannerDot} />
            <Text
              style={[styles.bannerLabel, dm600 ? { fontFamily: dm600 } : { fontWeight: '600' }]}
            >
              Photo & note
            </Text>
          </View>
          <Text style={[styles.bannerDate, dm400 && { fontFamily: dm400 }]}>
            {formatBookDate(memory.created_at)}
          </Text>
        </View>

        <View style={styles.imageShell}>
        {uri ? (
          <Pressable style={styles.imagePress} onPress={onRotate} accessibilityRole="button">
            <View style={[styles.imageRotate, { transform: [{ rotate: `${rotation}deg` }] }]}>
              <FilteredImage
                source={{ uri }}
                filterName="normal"
                resizeMode="cover"
                style={StyleSheet.absoluteFillObject}
              />
            </View>
          </Pressable>
        ) : (
          <View style={styles.imagePlaceholder} />
        )}
        <LinearGradient
          pointerEvents="none"
          colors={['rgba(0,0,0,0.08)', 'rgba(0,0,0,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.spineGradient}
        />
        </View>

        <Pressable
          style={styles.noteBlock}
          onPress={() => setEditOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Modifier la note"
        >
          <ScrollView
            style={styles.noteScroll}
            contentContainerStyle={styles.noteScrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text
              style={[
                styles.noteText,
                garamondItalic ? { fontFamily: garamondItalic } : { fontStyle: 'italic' },
              ]}
            >
              {bodyText}
            </Text>
            <Pencil size={10} color="#C9963E" style={styles.pencilIcon} />
          </ScrollView>
        </Pressable>
      </View>

      <View style={styles.separator} />

      <View style={styles.folio}>
        <Text style={[styles.folioText, dm400 && { fontFamily: dm400 }]}>{pageNumber}</Text>
      </View>

      <EditTextModal
        visible={editOpen}
        initialText={memory.content ?? ''}
        title="Modifier la note"
        onClose={() => setEditOpen(false)}
        onSave={handleSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  topCol: {
    flex: 1,
  },
  banner: {
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 0.5,
    borderBottomColor: 'rgba(0,0,0,0.06)',
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bannerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#C9963E',
  },
  bannerLabel: {
    fontSize: 8,
    color: '#1C1C1E',
  },
  bannerDate: {
    fontSize: 7,
    color: '#AEAEB2',
  },
  imageShell: {
    flex: 4,
    backgroundColor: '#F2F2F7',
    overflow: 'hidden',
    minHeight: 0,
  },
  imagePress: {
    flex: 1,
  },
  imageRotate: {
    flex: 1,
    overflow: 'hidden',
  },
  imagePlaceholder: {
    flex: 1,
    backgroundColor: '#E5E5EA',
  },
  spineGradient: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
  },
  noteBlock: {
    flex: 6,
    minHeight: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  noteScroll: {
    flex: 1,
  },
  noteScrollContent: {
    flexGrow: 1,
    paddingBottom: 4,
  },
  noteText: {
    fontSize: 10,
    lineHeight: 15,
    color: '#1C1C1E',
  },
  pencilIcon: {
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  separator: {
    height: 0.5,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  folio: {
    height: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  folioText: {
    fontSize: 6,
    color: '#C7C7CC',
  },
});
