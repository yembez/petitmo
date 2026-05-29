import { useCallback, type ReactNode } from 'react';
import { View, Text, StyleSheet, useWindowDimensions, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { MEDIA_CARD_INSET, MEDIA_CARD_RADIUS } from '@/constants/feedLayout';
import { scale } from '@/utils/responsive';
import type { Memory } from '@/types/local';

const GAP = scale(3);

type Props = {
  urls: string[];
  /** Album : favoris par photo (visionneuse / fil). */
  memoryId?: string;
  favoritePhotoUrls?: string[];
  onFavoritePhotoUrlsUpdated?: (urls: string[]) => void;
  /** Au tap : ouvre le viewer immersif à l’index donné (1 ou N photos). */
  onPhotoImmersive?: (index: number) => void;
  /** @deprecated Utiliser `onPhotoImmersive`. */
  onSinglePhotoImmersive?: () => void;
  memoryForFavoriteVariants?: Memory | null;
};

/**
 * Grille type WhatsApp ; au tap → viewer immersif si `onPhotoImmersive` est fourni.
 */
export default function PhotoMosaic({
  urls,
  memoryId: _memoryId,
  favoritePhotoUrls: _favoritePhotoUrls,
  onFavoritePhotoUrlsUpdated: _onFavoritePhotoUrlsUpdated,
  onPhotoImmersive,
  onSinglePhotoImmersive,
  memoryForFavoriteVariants: _memoryForFavoriteVariants = null,
}: Props) {
  const { width: screenW } = useWindowDimensions();
  const W = Math.max(0, screenW - 2 * MEDIA_CARD_INSET);
  const n = urls.length;

  const openImmersive = useCallback(
    (index: number) => {
      if (onPhotoImmersive) {
        onPhotoImmersive(index);
        return;
      }
      if (n === 1 && onSinglePhotoImmersive) {
        onSinglePhotoImmersive();
      }
    },
    [onPhotoImmersive, onSinglePhotoImmersive, n],
  );

  if (n === 0) return null;

  const cell = (W - GAP) / 2;
  const rowH = cell;
  const fourthOverlay = n > 4 ? n - 4 : 0;

  const onPressFourthCell = () => {
    if (n > 4) openImmersive(4);
    else openImmersive(3);
  };

  let grid: ReactNode;

  if (n === 1) {
    grid = (
      <Pressable
        onPress={() => openImmersive(0)}
        style={[styles.wrap, { borderRadius: MEDIA_CARD_RADIUS }]}
        accessibilityRole="image"
        accessibilityLabel="Ouvrir la photo en grand"
      >
        <Image
          source={{ uri: urls[0] }}
          style={styles.singleImg}
          contentFit="cover"
          cachePolicy="disk"
        />
      </Pressable>
    );
  } else if (n === 2) {
    grid = (
      <View style={[styles.wrap, styles.row, { width: W, borderRadius: MEDIA_CARD_RADIUS }]}>
        <Pressable onPress={() => openImmersive(0)} style={[styles.fill, { width: cell, height: rowH }]}>
          <Image source={{ uri: urls[0] }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="disk" />
        </Pressable>
        <View style={{ width: GAP }} />
        <Pressable onPress={() => openImmersive(1)} style={[styles.fill, { width: cell, height: rowH }]}>
          <Image source={{ uri: urls[1] }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="disk" />
        </Pressable>
      </View>
    );
  } else if (n === 3) {
    const H = cell;
    const halfH = (H - GAP) / 2;
    grid = (
      <View style={[styles.wrap, styles.row, { width: W, height: H, borderRadius: MEDIA_CARD_RADIUS }]}>
        <Pressable onPress={() => openImmersive(0)} style={[styles.fill, { width: cell, height: H }]}>
          <Image source={{ uri: urls[0] }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="disk" />
        </Pressable>
        <View style={{ width: GAP }} />
        <View style={{ width: cell, height: H }}>
          <Pressable onPress={() => openImmersive(1)} style={[styles.fill, { width: cell, height: halfH, marginBottom: GAP }]}>
            <Image source={{ uri: urls[1] }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="disk" />
          </Pressable>
          <Pressable onPress={() => openImmersive(2)} style={[styles.fill, { width: cell, height: halfH }]}>
            <Image source={{ uri: urls[2] }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="disk" />
          </Pressable>
        </View>
      </View>
    );
  } else {
    grid = (
      <View style={[styles.wrap, { width: W, borderRadius: MEDIA_CARD_RADIUS }]}>
        <View style={[styles.row, { marginBottom: GAP }]}>
          <Pressable onPress={() => openImmersive(0)} style={[styles.fill, { width: cell, height: rowH }]}>
            <Image source={{ uri: urls[0] }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="disk" />
          </Pressable>
          <View style={{ width: GAP }} />
          <Pressable onPress={() => openImmersive(1)} style={[styles.fill, { width: cell, height: rowH }]}>
            <Image source={{ uri: urls[1] }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="disk" />
          </Pressable>
        </View>
        <View style={styles.row}>
          <Pressable onPress={() => openImmersive(2)} style={[styles.fill, { width: cell, height: rowH }]}>
            <Image source={{ uri: urls[2] }} style={StyleSheet.absoluteFillObject} contentFit="cover" cachePolicy="disk" />
          </Pressable>
          <View style={{ width: GAP }} />
          <Pressable
            onPress={onPressFourthCell}
            style={[styles.fill, { width: cell, height: rowH, position: 'relative' }]}
            accessibilityLabel={fourthOverlay > 0 ? `Voir les ${n} photos` : 'Ouvrir la photo en grand'}
          >
            <Image source={{ uri: urls[3] }} style={[StyleSheet.absoluteFillObject, styles.fill]} contentFit="cover" cachePolicy="disk" />
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

  return grid;
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
