import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  FlatList,
  Image,
  Pressable,
  Text,
  useWindowDimensions,
  StyleSheet,
  Platform,
  ActivityIndicator,
  InteractionManager,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import { Heart, X } from 'lucide-react-native';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';
import type { Memory } from '@/types/local';
import { isPhotoUrlFavorited, isPhotoUrlFavoritedWithVariants } from '@/utils/memoryPhotos';

/** Cœurs favoris : rosé charte (`THEME.brandPrimary`). */
const FAVORI_FILL = THEME.brandPrimary;

type Props = {
  visible: boolean;
  urls: string[];
  initialIndex: number;
  onClose: () => void;
  /** Favoris par image (album) — si défini, un cœur par photo. */
  favoritePhotoUrls?: string[];
  onToggleFavoritePhoto?: (url: string) => void | Promise<void>;
  /** Album multi-photos : favori sur tout le souvenir (`memories.is_favorite`). */
  memoryFavorited?: boolean;
  onToggleMemoryFavorite?: () => void | Promise<void>;
  /** Pour comparer cœur / favoris quand l’URL affichée est un dérivé ou une nouvelle signature Storage. */
  memoryForFavoriteVariants?: Memory | null;
};

const PLACEHOLDER_ASPECT = 4 / 5;
/** Bandeau blanc entre chaque photo (hors dernière). */
const PHOTO_GAP = verticalScale(48);

/**
 * Fil vertical plein écran : fond blanc, photos en pleine largeur, hauteur selon le ratio
 * (bandes blanches si besoin ; la suivante peut apparaître en partie en dessous).
 */
export default function PhotoGalleryModal({
  visible,
  urls,
  initialIndex,
  onClose,
  favoritePhotoUrls = [],
  onToggleFavoritePhoto,
  memoryFavorited = false,
  onToggleMemoryFavorite,
  memoryForFavoriteVariants = null,
}: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<string>>(null);
  const [current, setCurrent] = useState(0);
  const [rowHeights, setRowHeights] = useState<number[] | null>(null);
  const didInitialScroll = useRef(false);
  const count = urls.length;
  const safeInitial = count > 0 ? Math.min(Math.max(0, initialIndex), count - 1) : 0;

  /** Précalcule les hauteurs affichées (pleine largeur, ratio conservé) pour scroll fiable. */
  useEffect(() => {
    if (!visible || count === 0) {
      setRowHeights(null);
      return;
    }
    let cancelled = false;
    Promise.all(
      urls.map(
        (uri) =>
          new Promise<number>((resolve) => {
            Image.getSize(
              uri,
              (w, h) => {
                if (w <= 0 || h <= 0) resolve(width * PLACEHOLDER_ASPECT);
                else resolve((width * h) / w);
              },
              () => resolve(width * PLACEHOLDER_ASPECT)
            );
          })
      )
    ).then((heights) => {
      if (!cancelled) setRowHeights(heights);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, urls, width, count]);

  useEffect(() => {
    if (!visible) didInitialScroll.current = false;
  }, [visible]);

  /**
   * Après fermeture du plein écran, le nœud StatusBar du modal disparaît : sans réappliquer
   * `dark`, l’app pouvait retomber sur le défaut (icônes claires si thème système sombre) alors
   * que le fil est blanc. On force après la fin des interactions (animation native du Modal).
   */
  useEffect(() => {
    if (!visible) {
      const raf = requestAnimationFrame(() => {
        setStatusBarStyle('dark');
      });
      const task = InteractionManager.runAfterInteractions(() => {
        setStatusBarStyle('dark');
      });
      return () => {
        cancelAnimationFrame(raf);
        task.cancel?.();
      };
    }
    return undefined;
  }, [visible]);

  useEffect(() => {
    if (!visible || rowHeights === null || count === 0) return;
    setCurrent(safeInitial);
  }, [visible, safeInitial, count, rowHeights]);

  const getItemLayout = useCallback(
    (_: unknown, index: number) => {
      const heights = rowHeights ?? [];
      const imgH = (i: number) => heights[i] ?? width * PLACEHOLDER_ASPECT;
      /** Hauteur scrollée pour l’item i : image + bandeau blanc sous la photo (sauf dernière). */
      const itemSpan = (i: number) => imgH(i) + (i < count - 1 ? PHOTO_GAP : 0);
      let offset = 0;
      for (let i = 0; i < index; i++) {
        offset += itemSpan(i);
      }
      return { length: itemSpan(index), offset, index };
    },
    [rowHeights, width, count]
  );

  const scrollToInitial = useCallback(() => {
    if (didInitialScroll.current || rowHeights === null) return;
    didInitialScroll.current = true;
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: safeInitial, animated: false, viewPosition: 0 });
      } catch {
        const layout = getItemLayout(null, safeInitial);
        listRef.current?.scrollToOffset({ offset: layout.offset, animated: false });
      }
    }, Platform.OS === 'android' ? 48 : 0);
    return () => clearTimeout(t);
  }, [rowHeights, safeInitial, getItemLayout]);

  useEffect(() => {
    if (!visible || rowHeights === null) return;
    const cleanup = scrollToInitial();
    return typeof cleanup === 'function' ? cleanup : undefined;
  }, [visible, rowHeights, scrollToInitial]);

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setCurrent(viewableItems[0].index);
      }
    },
    []
  );

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 40,
  }).current;

  const headerPadTop = insets.top + verticalScale(6);
  const headerPadBottom = verticalScale(10);

  if (count === 0) return null;

  const showAlbumFavorite = count > 1 && !!onToggleMemoryFavorite;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
      statusBarTranslucent={Platform.OS === 'android'}
    >
      <StatusBar style="dark" />
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: headerPadTop, paddingBottom: headerPadBottom }]}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel="Fermer"
          >
            <X color="#1C1C1E" size={scale(26)} strokeWidth={2.2} />
          </Pressable>
          <Text style={styles.counter} accessibilityLiveRegion="polite">
            {current + 1} / {count}
          </Text>
          {showAlbumFavorite ? (
            <GHPressable
              style={styles.headerBtn}
              onPress={() => onToggleMemoryFavorite?.()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={
                memoryFavorited
                  ? 'Retirer tout l’album des favoris'
                  : 'Ajouter tout l’album aux favoris'
              }
            >
              <Heart
                size={scale(24)}
                color={memoryFavorited ? FAVORI_FILL : '#3A3A3C'}
                strokeWidth={2.2}
                fill={memoryFavorited ? FAVORI_FILL : 'none'}
              />
            </GHPressable>
          ) : (
            <View style={styles.headerSpacer} />
          )}
        </View>

        {rowHeights === null ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color="#AEAEB2" />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={urls}
            keyExtractor={(_, index) => `gallery-v-${index}`}
            renderItem={({ item, index }) => {
              const h = rowHeights[index] ?? width * PLACEHOLDER_ASPECT;
              const showHeart = !!onToggleFavoritePhoto;
              const liked = memoryForFavoriteVariants
                ? isPhotoUrlFavoritedWithVariants(memoryForFavoriteVariants, favoritePhotoUrls, item)
                : isPhotoUrlFavorited(favoritePhotoUrls, item);
              return (
                <View
                  style={[
                    styles.row,
                    { width },
                    index < count - 1 && { marginBottom: PHOTO_GAP },
                  ]}
                >
                  <View style={[styles.imageWrap, { width, height: h }]}>
                    <Image
                      source={{ uri: item }}
                      style={{ width, height: h }}
                      resizeMode="contain"
                    />
                    {showHeart ? (
                      <GHPressable
                        style={styles.heartBtn}
                        onPress={() => onToggleFavoritePhoto?.(item)}
                        hitSlop={10}
                        accessibilityRole="button"
                        accessibilityLabel={
                          liked ? 'Retirer cette photo des favoris' : 'Ajouter cette photo aux favoris'
                        }
                      >
                        <Heart
                          size={scale(22)}
                          color={liked ? FAVORI_FILL : '#3A3A3C'}
                          strokeWidth={2.2}
                          fill={liked ? FAVORI_FILL : 'none'}
                        />
                      </GHPressable>
                    ) : null}
                  </View>
                </View>
              );
            }}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            getItemLayout={getItemLayout}
            onScrollToIndexFailed={(info) => {
              const layout = getItemLayout(null, info.index);
              listRef.current?.scrollToOffset({
                offset: layout.offset,
                animated: false,
              });
            }}
            removeClippedSubviews={false}
            windowSize={7}
            initialNumToRender={3}
            maxToRenderPerBatch={4}
            extraData={{ favoritePhotoUrls, memoryFavorited, memoryForFavoriteVariants }}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(8),
    zIndex: 2,
    backgroundColor: THEME.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  headerBtn: {
    padding: scale(8),
    minWidth: scale(44),
    minHeight: scale(44),
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerSpacer: {
    width: scale(44),
  },
  counter: {
    color: '#1C1C1E',
    fontSize: scale(16),
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: THEME.bg,
  },
  list: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  listContent: {
    backgroundColor: THEME.bg,
    paddingBottom: verticalScale(24),
  },
  row: {
    backgroundColor: THEME.bg,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  imageWrap: {
    position: 'relative',
    backgroundColor: THEME.bg,
  },
  heartBtn: {
    position: 'absolute',
    right: scale(10),
    bottom: scale(10),
    padding: scale(8),
    borderRadius: scale(22),
    backgroundColor: 'rgba(255,255,255,0.94)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 3,
      },
      android: { elevation: 3 },
      default: {},
    }),
  },
});
