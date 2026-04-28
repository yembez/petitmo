import { useState, useCallback, type ReactNode } from 'react';
import { View, Image, Text, StyleSheet, useWindowDimensions, Pressable } from 'react-native';
import { MEDIA_CARD_INSET, MEDIA_CARD_RADIUS } from '@/constants/feedLayout';
import { scale } from '@/utils/responsive';
import PhotoGalleryModal from '@/components/PhotoGalleryModal';
import { toggleFavoritePhotoUrl } from '@/services/media';

const GAP = scale(3);

type Props = {
  urls: string[];
  /** Album : favoris par photo dans la visionneuse (optionnel). */
  memoryId?: string;
  favoritePhotoUrls?: string[];
  onFavoritePhotoUrlsUpdated?: (urls: string[]) => void;
};

/**
 * Grille type WhatsApp + visionneuse plein écran au tap (swipe entre toutes les photos).
 */
export default function PhotoMosaic({
  urls,
  memoryId,
  favoritePhotoUrls,
  onFavoritePhotoUrlsUpdated,
}: Props) {
  const { width: screenW } = useWindowDimensions();
  const W = Math.max(0, screenW - 2 * MEDIA_CARD_INSET);
  const n = urls.length;
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const openGallery = useCallback((index: number) => {
    setGalleryIndex(index);
    setGalleryOpen(true);
  }, []);

  const closeGallery = useCallback(() => setGalleryOpen(false), []);

  const handleToggleFavoritePhoto = useCallback(
    async (url: string) => {
      if (!memoryId || !onFavoritePhotoUrlsUpdated) return;
      const next = await toggleFavoritePhotoUrl(memoryId, url);
      if (next) onFavoritePhotoUrlsUpdated(next);
    },
    [memoryId, onFavoritePhotoUrlsUpdated]
  );

  if (n === 0) return null;

  const cell = (W - GAP) / 2;
  const rowH = cell;
  const fourthOverlay = n > 4 ? n - 4 : 0;

  const onPressFourthCell = () => {
    if (n > 4) openGallery(4);
    else openGallery(3);
  };

  let grid: ReactNode;

  if (n === 1) {
    grid = (
      <Pressable
        onPress={() => openGallery(0)}
        style={[styles.wrap, { borderRadius: MEDIA_CARD_RADIUS }]}
        accessibilityRole="image"
        accessibilityLabel="Ouvrir la photo en grand"
      >
        <Image source={{ uri: urls[0] }} style={styles.singleImg} resizeMode="cover" />
      </Pressable>
    );
  } else if (n === 2) {
    grid = (
      <View style={[styles.wrap, styles.row, { width: W, borderRadius: MEDIA_CARD_RADIUS }]}>
        <Pressable onPress={() => openGallery(0)} style={[styles.fill, { width: cell, height: rowH }]}>
          <Image source={{ uri: urls[0] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        </Pressable>
        <View style={{ width: GAP }} />
        <Pressable onPress={() => openGallery(1)} style={[styles.fill, { width: cell, height: rowH }]}>
          <Image source={{ uri: urls[1] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        </Pressable>
      </View>
    );
  } else if (n === 3) {
    const H = cell;
    const halfH = (H - GAP) / 2;
    grid = (
      <View style={[styles.wrap, styles.row, { width: W, height: H, borderRadius: MEDIA_CARD_RADIUS }]}>
        <Pressable onPress={() => openGallery(0)} style={[styles.fill, { width: cell, height: H }]}>
          <Image source={{ uri: urls[0] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
        </Pressable>
        <View style={{ width: GAP }} />
        <View style={{ width: cell, height: H }}>
          <Pressable onPress={() => openGallery(1)} style={[styles.fill, { width: cell, height: halfH, marginBottom: GAP }]}>
            <Image source={{ uri: urls[1] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          </Pressable>
          <Pressable onPress={() => openGallery(2)} style={[styles.fill, { width: cell, height: halfH }]}>
            <Image source={{ uri: urls[2] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          </Pressable>
        </View>
      </View>
    );
  } else {
    grid = (
      <View style={[styles.wrap, { width: W, borderRadius: MEDIA_CARD_RADIUS }]}>
        <View style={[styles.row, { marginBottom: GAP }]}>
          <Pressable onPress={() => openGallery(0)} style={[styles.fill, { width: cell, height: rowH }]}>
            <Image source={{ uri: urls[0] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          </Pressable>
          <View style={{ width: GAP }} />
          <Pressable onPress={() => openGallery(1)} style={[styles.fill, { width: cell, height: rowH }]}>
            <Image source={{ uri: urls[1] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          </Pressable>
        </View>
        <View style={styles.row}>
          <Pressable onPress={() => openGallery(2)} style={[styles.fill, { width: cell, height: rowH }]}>
            <Image source={{ uri: urls[2] }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
          </Pressable>
          <View style={{ width: GAP }} />
          <Pressable
            onPress={onPressFourthCell}
            style={[styles.fill, { width: cell, height: rowH, position: 'relative' }]}
            accessibilityLabel={fourthOverlay > 0 ? `Voir les ${n} photos` : 'Ouvrir la photo en grand'}
          >
            <Image source={{ uri: urls[3] }} style={[StyleSheet.absoluteFillObject, styles.fill]} resizeMode="cover" />
            {fourthOverlay > 0 ? (
              <View style={styles.overlay} pointerEvents="none">
                <Text style={styles.overlayText}>+{fourthOverlay}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <>
      {grid}
      <PhotoGalleryModal
        visible={galleryOpen}
        urls={urls}
        initialIndex={galleryIndex}
        onClose={closeGallery}
        favoritePhotoUrls={favoritePhotoUrls ?? []}
        onToggleFavoritePhoto={
          memoryId && onFavoritePhotoUrlsUpdated ? handleToggleFavoritePhoto : undefined
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: MEDIA_CARD_INSET,
    overflow: 'hidden',
    backgroundColor: '#ECECEF',
    alignSelf: 'stretch',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  fill: {
    backgroundColor: '#E8E8ED',
  },
  singleImg: {
    width: '100%',
    aspectRatio: 4 / 5,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: {
    color: '#FFFFFF',
    fontSize: scale(28),
    fontWeight: '600',
  },
});
