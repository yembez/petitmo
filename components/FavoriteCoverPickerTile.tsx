import { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useFeedPhotoDisplayUrls } from '@/hooks/useFeedPhotoDisplayUrls';
import { useFeedRasterMediaUrl } from '@/hooks/useFeedRasterMediaUrl';
import {
  getVideoPosterUriForFeedAndViewer,
  getVoiceCoverUriForFeedAndViewer,
  indexOfPhotoUrlInFeed,
  normalizeMemoryMediaUriForDisplay,
} from '@/utils/memoryPhotos';
import type { FavorisGridItem } from '@/utils/favorisGridItems';

type Props = {
  item: FavorisGridItem;
  onPress: (source: string) => void;
};

function coverSourceForItem(item: FavorisGridItem): string {
  if (item.kind === 'photo' && item.favPhotoOriginalUrl?.trim()) {
    return item.favPhotoOriginalUrl.trim();
  }
  const m = item.memory;
  if (m.type === 'photo') {
    return item.thumbUrl.trim();
  }
  if (m.type === 'video') {
    return getVideoPosterUriForFeedAndViewer(m).trim() || item.thumbUrl.trim();
  }
  if (m.type === 'voice') {
    return getVoiceCoverUriForFeedAndViewer(m).trim() || item.thumbUrl.trim();
  }
  return item.thumbUrl.trim();
}

function FavoriteCoverPickerTileInner({ item, onPress }: Props) {
  const { memory } = item;
  const feedPhotoUrls = useFeedPhotoDisplayUrls(memory);
  const voiceCoverRaster = useFeedRasterMediaUrl(memory, 'voice-cover');

  let displayUri = '';
  if (memory.type === 'photo') {
    if (item.kind === 'photo' && item.favPhotoOriginalUrl) {
      const idx = indexOfPhotoUrlInFeed(memory, item.favPhotoOriginalUrl);
      displayUri =
        ((idx >= 0 ? feedPhotoUrls[idx] : '') ?? '').trim() || item.thumbUrl.trim();
    } else {
      displayUri = feedPhotoUrls[0]?.trim() || item.thumbUrl.trim();
    }
  } else if (memory.type === 'voice') {
    displayUri = voiceCoverRaster.trim() || item.thumbUrl.trim();
  } else {
    displayUri = item.thumbUrl.trim();
  }

  const source = coverSourceForItem(item);
  const uri = normalizeMemoryMediaUriForDisplay(displayUri) || displayUri;
  if (!source || !uri) return null;

  return (
    <Pressable
      onPress={() => onPress(source)}
      style={({ pressed }) => [{ flex: 1 / 3, aspectRatio: 1, opacity: pressed ? 0.9 : 1 }]}
      accessibilityRole="button"
    >
      <ExpoImage
        source={{ uri }}
        style={styles.image}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={`cover-pick-${item.key}`}
      />
    </Pressable>
  );
}

export const FavoriteCoverPickerTile = memo(FavoriteCoverPickerTileInner);

const styles = StyleSheet.create({
  image: {
    width: '100%',
    height: '100%',
  },
});
