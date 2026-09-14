import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import {
  FEED_POST_CARD_RADIUS,
  MEDIA_CARD_INSET,
  MEDIA_CARD_RADIUS,
} from '@/constants/feedLayout';
import { scale } from '@/utils/responsive';
import type { Memory } from '@/types/local';
import {
  measureViewInWindow,
  type ImmersiveSharedOrigin,
} from '@/utils/immersiveSharedElement';
import {
  registerFeedImmersiveHost,
  unregisterFeedImmersiveHost,
} from '@/utils/feedImmersiveHostRegistry';

const GAP = scale(3);

type Props = {
  urls: string[];
  /** Album : favoris par photo (visionneuse / fil). */
  memoryId?: string;
  favoritePhotoUrls?: string[];
  onFavoritePhotoUrlsUpdated?: (urls: string[]) => void;
  /** Au tap : ouvre le viewer immersif à l’index donné (1 ou N photos). */
  onPhotoImmersive?: (args: {
    index: number;
    origin: ImmersiveSharedOrigin | null;
    uri: string;
    cornerRadius: number;
  }) => void;
  /** @deprecated Utiliser `onPhotoImmersive`. */
  onSinglePhotoImmersive?: () => void;
  memoryForFavoriteVariants?: Memory | null;
};

function mosaicImmersiveKey(
  memoryId: string | undefined,
  index: number,
  album: boolean,
): string | null {
  if (!memoryId?.trim()) return null;
  return album ? `${memoryId}-album-${index}` : memoryId;
}

function MosaicTapCell({
  style,
  uri,
  index,
  immersiveKey,
  cornerRadius,
  onOpen,
  accessibilityLabel,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  uri: string;
  index: number;
  immersiveKey: string | null;
  cornerRadius: number;
  onOpen: (index: number, origin: ImmersiveSharedOrigin | null, uri: string) => void;
  accessibilityLabel?: string;
  children: ReactNode;
}) {
  const ref = useRef<View>(null);

  useEffect(() => {
    if (!immersiveKey) return;
    registerFeedImmersiveHost(immersiveKey, {
      getView: () => ref.current,
      uri,
      cornerRadius,
    });
    return () => unregisterFeedImmersiveHost(immersiveKey);
  }, [immersiveKey, uri, cornerRadius]);

  return (
    <Pressable
      ref={ref}
      collapsable={false}
      style={style}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? 'Ouvrir la photo en grand'}
      onPress={() => {
        measureViewInWindow(ref.current, origin => {
          onOpen(index, origin, uri);
        });
      }}
    >
      {children}
    </Pressable>
  );
}

/**
 * Grille type WhatsApp ; au tap → viewer immersif si `onPhotoImmersive` est fourni.
 */
export default function PhotoMosaic({
  urls,
  memoryId,
  favoritePhotoUrls: _favoritePhotoUrls,
  onFavoritePhotoUrlsUpdated: _onFavoritePhotoUrlsUpdated,
  onPhotoImmersive,
  onSinglePhotoImmersive,
  memoryForFavoriteVariants: _memoryForFavoriteVariants = null,
}: Props) {
  const { width: screenW } = useWindowDimensions();
  const W = Math.max(0, screenW - 2 * MEDIA_CARD_INSET);
  const n = urls.length;

  const feedImageCache = (index: number) => ({
    cachePolicy: 'memory-disk' as const,
    ...(memoryId ? { recyclingKey: `${memoryId}-${index}` } : {}),
  });

  const openImmersive = useCallback(
    (index: number, origin: ImmersiveSharedOrigin | null, uri: string) => {
      if (onPhotoImmersive) {
        onPhotoImmersive({
          index,
          origin,
          uri,
          /** Photo unique : elle occupe le haut de la carte, donc ses coins sont arrondis. */
          cornerRadius: n === 1 ? FEED_POST_CARD_RADIUS : 0,
        });
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
  const album = n > 1;
  const cellCorner = n === 1 ? FEED_POST_CARD_RADIUS : 0;
  const cellKey = (index: number) => mosaicImmersiveKey(memoryId, index, album);

  const onPressFourthCell = (origin: ImmersiveSharedOrigin | null, uri: string) => {
    if (n > 4) openImmersive(4, origin, uri);
    else openImmersive(3, origin, uri);
  };

  let grid: ReactNode;

  if (n === 1) {
    grid = (
      <MosaicTapCell
        uri={urls[0]}
        index={0}
        immersiveKey={cellKey(0)}
        cornerRadius={cellCorner}
        onOpen={openImmersive}
        style={[styles.wrap, { borderRadius: MEDIA_CARD_RADIUS }]}
      >
        <Image
          source={{ uri: urls[0] }}
          style={styles.singleImg}
          contentFit="cover"
          {...feedImageCache(0)}
        />
      </MosaicTapCell>
    );
  } else if (n === 2) {
    grid = (
      <View style={[styles.wrap, styles.row, { width: W, borderRadius: MEDIA_CARD_RADIUS }]}>
        <MosaicTapCell
          uri={urls[0]}
          index={0}
          immersiveKey={cellKey(0)}
          cornerRadius={cellCorner}
          onOpen={openImmersive}
          style={[styles.fill, { width: cell, height: rowH }]}
        >
          <Image source={{ uri: urls[0] }} style={StyleSheet.absoluteFillObject} contentFit="cover" {...feedImageCache(0)} />
        </MosaicTapCell>
        <View style={{ width: GAP }} />
        <MosaicTapCell
          uri={urls[1]}
          index={1}
          immersiveKey={cellKey(1)}
          cornerRadius={cellCorner}
          onOpen={openImmersive}
          style={[styles.fill, { width: cell, height: rowH }]}
        >
          <Image source={{ uri: urls[1] }} style={StyleSheet.absoluteFillObject} contentFit="cover" {...feedImageCache(1)} />
        </MosaicTapCell>
      </View>
    );
  } else if (n === 3) {
    const H = cell;
    const halfH = (H - GAP) / 2;
    grid = (
      <View style={[styles.wrap, styles.row, { width: W, height: H, borderRadius: MEDIA_CARD_RADIUS }]}>
        <MosaicTapCell
          uri={urls[0]}
          index={0}
          immersiveKey={cellKey(0)}
          cornerRadius={cellCorner}
          onOpen={openImmersive}
          style={[styles.fill, { width: cell, height: H }]}
        >
          <Image source={{ uri: urls[0] }} style={StyleSheet.absoluteFillObject} contentFit="cover" {...feedImageCache(0)} />
        </MosaicTapCell>
        <View style={{ width: GAP }} />
        <View style={{ width: cell, height: H }}>
          <MosaicTapCell
            uri={urls[1]}
            index={1}
            immersiveKey={cellKey(1)}
            cornerRadius={cellCorner}
            onOpen={openImmersive}
            style={[styles.fill, { width: cell, height: halfH, marginBottom: GAP }]}
          >
            <Image source={{ uri: urls[1] }} style={StyleSheet.absoluteFillObject} contentFit="cover" {...feedImageCache(1)} />
          </MosaicTapCell>
          <MosaicTapCell
            uri={urls[2]}
            index={2}
            immersiveKey={cellKey(2)}
            cornerRadius={cellCorner}
            onOpen={openImmersive}
            style={[styles.fill, { width: cell, height: halfH }]}
          >
            <Image source={{ uri: urls[2] }} style={StyleSheet.absoluteFillObject} contentFit="cover" {...feedImageCache(2)} />
          </MosaicTapCell>
        </View>
      </View>
    );
  } else {
    const fourthIndex = n > 4 ? 4 : 3;
    grid = (
      <View style={[styles.wrap, { width: W, borderRadius: MEDIA_CARD_RADIUS }]}>
        <View style={[styles.row, { marginBottom: GAP }]}>
          <MosaicTapCell
            uri={urls[0]}
            index={0}
            immersiveKey={cellKey(0)}
            cornerRadius={cellCorner}
            onOpen={openImmersive}
            style={[styles.fill, { width: cell, height: rowH }]}
          >
            <Image source={{ uri: urls[0] }} style={StyleSheet.absoluteFillObject} contentFit="cover" {...feedImageCache(0)} />
          </MosaicTapCell>
          <View style={{ width: GAP }} />
          <MosaicTapCell
            uri={urls[1]}
            index={1}
            immersiveKey={cellKey(1)}
            cornerRadius={cellCorner}
            onOpen={openImmersive}
            style={[styles.fill, { width: cell, height: rowH }]}
          >
            <Image source={{ uri: urls[1] }} style={StyleSheet.absoluteFillObject} contentFit="cover" {...feedImageCache(1)} />
          </MosaicTapCell>
        </View>
        <View style={styles.row}>
          <MosaicTapCell
            uri={urls[2]}
            index={2}
            immersiveKey={cellKey(2)}
            cornerRadius={cellCorner}
            onOpen={openImmersive}
            style={[styles.fill, { width: cell, height: rowH }]}
          >
            <Image source={{ uri: urls[2] }} style={StyleSheet.absoluteFillObject} contentFit="cover" {...feedImageCache(2)} />
          </MosaicTapCell>
          <View style={{ width: GAP }} />
          <MosaicTapCell
            uri={urls[3]}
            index={fourthIndex}
            immersiveKey={cellKey(fourthIndex)}
            cornerRadius={cellCorner}
            onOpen={(_index, origin, uri) => onPressFourthCell(origin, uri)}
            style={[styles.fill, { width: cell, height: rowH, position: 'relative' }]}
            accessibilityLabel={fourthOverlay > 0 ? `Voir les ${n} photos` : 'Ouvrir la photo en grand'}
          >
            <Image source={{ uri: urls[3] }} style={[StyleSheet.absoluteFillObject, styles.fill]} contentFit="cover" {...feedImageCache(3)} />
            {fourthOverlay > 0 ? (
              <View style={styles.overlay} pointerEvents="none">
                <Text style={styles.overlayText}>+{fourthOverlay}</Text>
              </View>
            ) : null}
          </MosaicTapCell>
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
