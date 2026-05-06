import { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFonts, DMSans_400Regular, DMSans_600SemiBold } from '@expo-google-fonts/dm-sans';
import { EBGaramond_400Regular_Italic } from '@expo-google-fonts/eb-garamond';
import { Pencil } from 'lucide-react-native';
import type { Memory } from '@/types/local';
import { formatBookLocationShort } from '@/utils/date';
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

export interface PhotoFullPageProps {
  memory: Memory;
  width: number;
  pageNumber?: number;
  rotation?: number;
  onRotate: () => void;
  onEditTitle: (newTitle: string) => void;
}

export default function PhotoFullPage({
  memory,
  width,
  pageNumber = 1,
  rotation = 0,
  onRotate,
  onEditTitle,
}: PhotoFullPageProps) {
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_600SemiBold,
    EBGaramond_400Regular_Italic,
  });

  const [editOpen, setEditOpen] = useState(false);
  const [showEditHint, setShowEditHint] = useState(false);

  const height = width / A5_RATIO;
  const uri = memory.edited_media_url ?? memory.media_url;
  const titleText = memory.content?.trim() ? memory.content : 'Sans titre';
  const bookLocationLine = formatBookLocationShort(memory.location);

  const dm400 = fontsLoaded ? 'DMSans_400Regular' : undefined;
  const dm600 = fontsLoaded ? 'DMSans_600SemiBold' : undefined;
  const garamondItalic = fontsLoaded ? 'EBGaramond_400Regular_Italic' : undefined;

  const handleTitlePress = useCallback(() => {
    setShowEditHint(true);
    setEditOpen(true);
  }, []);

  const handleSaveTitle = useCallback(
    (text: string) => {
      onEditTitle(text);
    },
    [onEditTitle]
  );

  return (
    <View style={[styles.root, { width, height }]}>
      <View style={styles.banner}>
        <View style={styles.bannerLeft}>
          <View style={styles.bannerDot} />
          <Text
            style={[styles.bannerLabel, dm600 ? { fontFamily: dm600 } : { fontWeight: '600' }]}
          >
            Photo
          </Text>
        </View>
        <Text
          style={[styles.bannerDate, dm400 && { fontFamily: dm400 }]}
        >
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

      <View style={styles.caption}>
        <View style={styles.captionMetaRow}>
          <Text style={[styles.captionDate, dm400 && { fontFamily: dm400 }]}>
            {formatBookDate(memory.created_at)}
          </Text>
          {bookLocationLine ? (
            <Text
              style={[styles.captionLocation, dm400 && { fontFamily: dm400 }]}
              numberOfLines={1}
            >
              {bookLocationLine}
            </Text>
          ) : null}
        </View>
        <Pressable
          style={styles.titleRow}
          onPress={handleTitlePress}
          accessibilityRole="button"
          accessibilityLabel="Modifier le titre"
        >
          <Text
            style={[
              styles.titleText,
              garamondItalic ? { fontFamily: garamondItalic } : { fontStyle: 'italic' },
            ]}
            numberOfLines={2}
          >
            {titleText}
          </Text>
          {showEditHint ? (
            <Pencil size={10} color="#C9963E" style={styles.pencilIcon} />
          ) : null}
        </Pressable>
      </View>

      <View style={styles.separator} />

      <View style={styles.folio}>
        <Text style={[styles.folioText, dm400 && { fontFamily: dm400 }]}>
          {pageNumber}
        </Text>
      </View>

      <EditTextModal
        visible={editOpen}
        initialText={memory.content ?? ''}
        title="Modifier le titre"
        onClose={() => setEditOpen(false)}
        onSave={handleSaveTitle}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
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
    flex: 1,
    backgroundColor: '#F2F2F7',
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
  caption: {
    height: 42,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    justifyContent: 'center',
    gap: 2,
  },
  captionMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  captionDate: {
    fontSize: 6,
    color: '#AEAEB2',
    flexShrink: 0,
  },
  captionLocation: {
    fontSize: 6,
    color: '#AEAEB2',
    textAlign: 'right',
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  titleText: {
    flex: 1,
    fontSize: 11,
    color: '#1C1C1E',
  },
  pencilIcon: {
    marginLeft: 2,
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
