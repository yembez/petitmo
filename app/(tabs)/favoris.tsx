import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  ActivityIndicator,
  Platform,
  Dimensions,
  DeviceEventEmitter,
  FlatList,
  TouchableOpacity,
  type ListRenderItem,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  SlideInDown,
  SlideOutDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import { BookOpen, Check, Heart, Type, Mic, Video, Camera, PenLine, Play } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import { SPACING, FONT_SIZES } from '@/constants/sizes';
import { useFonts, EBGaramond_400Regular_Italic } from '@expo-google-fonts/eb-garamond';
import { getMemories, requestMissingMediaDerivatives } from '@/services/media';
import { getOrSelectFirstChild } from '@/services/children';
import {
  feedChildHydrationSnapshot,
  feedMemoriesHydrationSnapshot,
} from '@/services/tabScreensCache';
import type { Memory } from '@/types/local';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import {
  getAllPhotoUrls,
  parseFavoritePhotoUrls,
  normalizePhotoUrlForCompare,
  mapPhotoUrlToThumb,
  pickPrimaryPhotoNormalizedForFeedAndViewer,
  getVoiceCoverUriForBookPreview,
  getVideoPosterUriForBookPreview,
} from '@/utils/memoryPhotos';
import { AddToBookModal } from '@/components/AddToBookModal';

type FavListItem = {
  key: string;
  memory: Memory;
  thumbUrl: string;
  kind: 'whole' | 'photo';
};

function primaryDisplayThumb(m: Memory): string {
  // Aligné sur le fil : dérivés + sandbox fantôme → URLs bucket (`pickPrimary*` / posters / covers).
  if (m.type === 'photo') return pickPrimaryPhotoNormalizedForFeedAndViewer(m);
  return thumbUri(m) ?? '';
}

function buildFavoriteItems(memories: Memory[]): FavListItem[] {
  const items: FavListItem[] = [];
  for (const m of memories) {
    const primary = primaryDisplayThumb(m);

    if (m.is_favorite) {
      items.push({
        key: `${m.id}-whole`,
        memory: m,
        thumbUrl: primary,
        kind: 'whole',
      });
    }

    if (m.type === 'photo') {
      const favUrls = parseFavoritePhotoUrls(m);
      const primaryNorm = normalizePhotoUrlForCompare(primary);
      for (const url of favUrls) {
        if (m.is_favorite && normalizePhotoUrlForCompare(url) === primaryNorm) continue;
        items.push({
          key: `${m.id}-photo-${normalizePhotoUrlForCompare(url)}`,
          memory: m,
          thumbUrl: mapPhotoUrlToThumb(m, url),
          kind: 'photo',
        });
      }
    }
  }
  return items.sort(
    (a, b) => new Date(b.memory.created_at).getTime() - new Date(a.memory.created_at).getTime()
  );
}

/** URLs pour le diaporama (médias avec image uniquement, pas les cartes texte). */
function buildSlideshowUrls(items: FavListItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    const u = it.thumbUrl.trim();
    if (!u) continue;
    const t = it.memory.type;
    if (t !== 'photo' && t !== 'video' && t !== 'voice') continue;
    out.push(u);
  }
  return out;
}

/** Extrait sous les vignettes photo / vidéo (premiers mots, même annotation que le souvenir). */
const PHOTO_CAPTION_MAX_WORDS = 14;

function photoCaptionOverlayText(content: string | null | undefined): string | null {
  const raw = (content ?? '').trim();
  if (!raw) return null;
  const words = raw.split(/\s+/u).filter(Boolean);
  if (words.length <= PHOTO_CAPTION_MAX_WORDS) return raw;
  return `${words.slice(0, PHOTO_CAPTION_MAX_WORDS).join(' ')}…`;
}

/** Zoom de départ → 1 : uniquement zoom arrière (aucun zoom avant visible). */
const SLIDESHOW_ZOOM_START = 1.12;
const SLIDESHOW_ZOOM_END = 1;
/** Temps total pendant lequel une photo reste affichée avant le slide suivant. */
const SLIDESHOW_SLIDE_TOTAL_MS = 7200;
/**
 * Durée du zoom arrière (plus long = zoom plus lent). Un court reliquat = peu de « figé » à l’échelle 1.
 * Doit être ≤ SLIDESHOW_SLIDE_TOTAL_MS.
 */
const SLIDESHOW_ZOOM_MS = 7000;

/** Dégradé haut d’écran (héros + bandeaux) : identique partout pour éviter une « bande » noire plate. */
const FAVORIS_TOP_GRADIENT_COLORS: [string, string, string] = [
  'rgba(0,0,0,0.78)',
  'rgba(0,0,0,0.38)',
  'rgba(0,0,0,0)',
];
const FAVORIS_TOP_GRADIENT_LOCATIONS: [number, number, number] = [0, 0.42, 1];

/** Diaporama : chemins bucket → URLs signées comme dans le fil. */
function SlideshowSignedLayer({
  rawUri,
  onLoad,
}: {
  rawUri: string;
  onLoad: () => void;
}) {
  const signed = useSignedMediaUrl(rawUri.trim() || null);
  const uri = (signed ?? rawUri).trim();

  useEffect(() => {
    if (!uri) return;
    void Image.prefetch(uri).catch(() => {});
  }, [uri]);

  if (!uri) return null;
  return (
    <Image
      key={uri}
      source={{ uri }}
      style={StyleSheet.absoluteFillObject}
      resizeMode="cover"
      onLoad={onLoad}
    />
  );
}

/** Diaporama : double calque — l’image visible reste à l’écran pendant que la suivante se charge en dessous (pas d’écran noir). */
function FavorisSlideshow({
  urls,
  height,
  isActive,
}: {
  urls: string[];
  height: number;
  isActive: boolean;
}) {
  const n = urls.length;
  const urlsKey = useMemo(() => urls.join('\0'), [urls]);
  const [visibleIdx, setVisibleIdx] = useState(0);
  /** Couche au premier plan (opaque) ; l’autre précharge la photo suivante sous opacity 0. */
  const [topLayer, setTopLayer] = useState<0 | 1>(0);
  const scale0 = useSharedValue(SLIDESHOW_ZOOM_START);
  /** Même échelle de départ que le calque avant : la couche cachée précharge toujours en « cadrage serré » (1.12), jamais en 1. */
  const scale1 = useSharedValue(SLIDESHOW_ZOOM_START);
  const topLayerRef = useRef(topLayer);
  topLayerRef.current = topLayer;
  const readyRef = useRef<[boolean, boolean]>([false, false]);
  const pendingAdvanceRef = useRef(false);

  const layer0Uri =
    n <= 1 ? (urls[0] ?? '') : topLayer === 0 ? (urls[visibleIdx] ?? '') : (urls[(visibleIdx + 1) % n] ?? '');
  const layer1Uri =
    n <= 1
      ? ''
      : topLayer === 1
        ? (urls[visibleIdx] ?? '')
        : (urls[(visibleIdx + 1) % n] ?? '');

  useEffect(() => {
    readyRef.current[0] = false;
    readyRef.current[1] = false;
  }, [layer0Uri, layer1Uri]);

  useEffect(() => {
    if (isActive && n > 0) {
      setVisibleIdx(0);
      setTopLayer(0);
    }
  }, [isActive, n, urlsKey]);

  useEffect(() => {
    if (!isActive || n === 0) {
      cancelAnimation(scale0);
      cancelAnimation(scale1);
      scale0.value = withTiming(SLIDESHOW_ZOOM_END, { duration: 220, easing: Easing.out(Easing.cubic) });
      scale1.value = withTiming(SLIDESHOW_ZOOM_END, { duration: 220, easing: Easing.out(Easing.cubic) });
      return;
    }
    if (n === 1) {
      cancelAnimation(scale0);
      scale0.value = SLIDESHOW_ZOOM_START;
      cancelAnimation(scale1);
      scale1.value = SLIDESHOW_ZOOM_END;
      return;
    }
    const sFront = topLayer === 0 ? scale0 : scale1;
    const sBack = topLayer === 0 ? scale1 : scale0;
    /*
     * Premier plan : vient d’être promu depuis le calque caché → déjà à START (1.12) pendant le chargement ;
     * on ne fait que zoom arrière vers 1. Pas de passage 1 → 1.12 visible (effet zoom avant).
     * Arrière-plan : reste figé à START pendant que l’image suivante se charge ; l’ancienne reste au premier plan à 1.
     */
    cancelAnimation(sFront);
    sFront.value = SLIDESHOW_ZOOM_START;
    sFront.value = withTiming(SLIDESHOW_ZOOM_END, {
      duration: SLIDESHOW_ZOOM_MS,
      easing: Easing.linear,
    });
    cancelAnimation(sBack);
    sBack.value = SLIDESHOW_ZOOM_START;
  }, [isActive, n, topLayer, visibleIdx, urlsKey, scale0, scale1]);

  const tryAdvance = useCallback(() => {
    if (n <= 1) return;
    const t = topLayerRef.current;
    const hidden = (1 - t) as 0 | 1;
    if (!readyRef.current[hidden]) {
      pendingAdvanceRef.current = true;
      return;
    }
    pendingAdvanceRef.current = false;
    setTopLayer(t === 0 ? 1 : 0);
    setVisibleIdx(i => (i + 1) % n);
  }, [n]);

  const onLayer0Load = useCallback(() => {
    readyRef.current[0] = true;
    if (pendingAdvanceRef.current) tryAdvance();
  }, [tryAdvance]);

  const onLayer1Load = useCallback(() => {
    readyRef.current[1] = true;
    if (pendingAdvanceRef.current) tryAdvance();
  }, [tryAdvance]);

  useEffect(() => {
    if (!isActive || n <= 1) return;
    const id = setInterval(() => tryAdvance(), SLIDESHOW_SLIDE_TOTAL_MS);
    return () => clearInterval(id);
  }, [isActive, n, tryAdvance]);

  const onSingleImageLoad = useCallback(() => {
    if (!isActive || n !== 1) return;
    cancelAnimation(scale0);
    scale0.value = SLIDESHOW_ZOOM_START;
    scale0.value = withTiming(SLIDESHOW_ZOOM_END, {
      duration: SLIDESHOW_ZOOM_MS,
      easing: Easing.linear,
    });
  }, [isActive, n, scale0]);

  const layer0Style = useAnimatedStyle(() => ({
    transform: [{ scale: scale0.value }],
  }));
  const layer1Style = useAnimatedStyle(() => ({
    transform: [{ scale: scale1.value }],
  }));

  if (height < 2 || n === 0) return null;

  const show0 = n <= 1 || topLayer === 0;
  const show1 = n > 1 && topLayer === 1;

  return (
    <View style={styles.slideshowInner}>
      <Reanimated.View
        style={[
          styles.slideshowZoom,
          layer0Style,
          {
            zIndex: show0 ? 2 : 1,
            opacity: show0 ? 1 : 0,
          },
        ]}
        pointerEvents="none"
      >
        {layer0Uri ? (
          <SlideshowSignedLayer
            rawUri={layer0Uri}
            onLoad={n === 1 ? onSingleImageLoad : onLayer0Load}
          />
        ) : null}
      </Reanimated.View>
      {n > 1 ? (
        <Reanimated.View
          style={[
            styles.slideshowZoom,
            layer1Style,
            {
              zIndex: show1 ? 2 : 1,
              opacity: show1 ? 1 : 0,
            },
          ]}
          pointerEvents="none"
        >
          {layer1Uri ? (
            <SlideshowSignedLayer rawUri={layer1Uri} onLoad={onLayer1Load} />
          ) : null}
        </Reanimated.View>
      ) : null}
    </View>
  );
}

type HeroListHeaderProps = {
  scrollY: SharedValue<number>;
  urls: string[];
  heroHeight: number;
  heroBaseH: number;
  heroGradientHeight: number;
  insetTop: number;
  selectionMode: boolean;
  selectionHeaderTitle: string;
  onExitSelection: () => void;
  onEnterSelection: () => void;
};

/**
 * En-tête liste : diaporama + chrome, calé sur le flux de la grille.
 * Parallaxe + fondu du titrage (comportement proche de la grande prévisualisation
 * en haut des albums dans la Photothèque iOS, qui glisse sous la grille au scroll).
 */
function HeroListHeader({
  scrollY,
  urls,
  heroHeight,
  heroBaseH,
  heroGradientHeight,
  insetTop,
  selectionMode,
  selectionHeaderTitle,
  onExitSelection,
  onEnterSelection,
}: HeroListHeaderProps) {
  /** Pas de translateY ici : le parallaxe décalait l’image et révélait des bandes noires (haut/bas) sur le fond du héros. */
  const imageMotionStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    const pulled = y < 0 ? y : 0;
    const scale = 1 + -pulled * HERO_PULL_SCALE_PER_PX;
    return {
      transform: [{ scale }],
    };
  });

  const titleFadeStyle = useAnimatedStyle(() => {
    const y = Math.max(0, scrollY.value);
    return {
      opacity: interpolate(
        y,
        [0, heroBaseH * 0.28, heroBaseH * 0.62],
        [1, 0.5, 0],
        Extrapolation.CLAMP
      ),
    };
  });

  const chromeFadeStyle = useAnimatedStyle(() => {
    const y = Math.max(0, scrollY.value);
    return {
      opacity: interpolate(
        y,
        [0, heroBaseH * 0.36, heroBaseH * 0.58],
        [1, 0.4, 0],
        Extrapolation.CLAMP
      ),
    };
  });

  if (heroHeight < 2 || urls.length === 0) return null;

  return (
    <View style={styles.heroHeaderStack}>
      <View style={[styles.heroColumn, { height: heroHeight }]}>
        <Reanimated.View style={[styles.heroSlideshowLayer, imageMotionStyle]}>
          <FavorisSlideshow urls={urls} height={heroHeight} isActive={heroHeight > 8} />
        </Reanimated.View>
        {!selectionMode ? (
          <Reanimated.View style={[StyleSheet.absoluteFill, { zIndex: 14 }, titleFadeStyle]} pointerEvents="none">
            <LinearGradient
              colors={['rgba(0,0,0,0.78)', 'rgba(0,0,0,0.38)', 'rgba(0,0,0,0)']}
              locations={[0, 0.42, 1]}
              pointerEvents="none"
              style={[styles.favorisTitleGradient, { height: heroGradientHeight }]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.favorisTitleWrap,
                { top: insetTop + verticalScale(6), left: SPACING.md },
              ]}
            >
              <Text style={styles.favorisTitleIos}>Favoris</Text>
            </View>
          </Reanimated.View>
        ) : null}
        {selectionMode ? (
          <Reanimated.View
            style={[styles.topChrome, styles.topChromeOnHero, chromeFadeStyle]}
            pointerEvents="box-none"
          >
            <LinearGradient
              colors={FAVORIS_TOP_GRADIENT_COLORS}
              locations={FAVORIS_TOP_GRADIENT_LOCATIONS}
              pointerEvents="none"
              style={[styles.favorisFloatingChromeGradient, { height: heroGradientHeight }]}
            />
            <View
              style={[
                styles.topChromeRow,
                styles.topChromeRowOverGradient,
                { paddingTop: insetTop + verticalScale(10) },
              ]}
              pointerEvents="box-none"
            >
              <Pressable
                onPress={onExitSelection}
                style={styles.topChromeSideBtn}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Annuler la sélection"
              >
                <Text style={styles.topChromeBtnTextLight}>Annuler</Text>
              </Pressable>
              <Text style={styles.topChromeCenterTitleLight} numberOfLines={1}>
                {selectionHeaderTitle}
              </Text>
              <View style={styles.topChromeSideSpacer} />
            </View>
          </Reanimated.View>
        ) : (
          <Reanimated.View
            style={[
              styles.topChrome,
              styles.topChromeOnHero,
              {
                paddingTop: insetTop + verticalScale(10),
                backgroundColor: 'transparent',
              },
              chromeFadeStyle,
            ]}
            pointerEvents="box-none"
          >
            <View style={styles.topChromeRow} pointerEvents="box-none">
              <View style={styles.topChromeFlex} />
              <Pressable
                onPress={onEnterSelection}
                hitSlop={8}
                style={({ pressed }) => [styles.topChromeSelectCta, pressed && { opacity: 0.88 }]}
                accessibilityRole="button"
                accessibilityLabel="Mode sélection"
              >
                <View style={styles.topChromeSelectCtaContent}>
                  <BookOpen size={scale(18)} color="#FFFFFF" strokeWidth={2.2} />
                  <Text style={styles.topChromeBtnTextLight}>Sélectionner</Text>
                </View>
              </Pressable>
            </View>
          </Reanimated.View>
        )}
      </View>
      <View style={styles.heroGridWhiteGap} pointerEvents="none" />
    </View>
  );
}

const INK = '#1C1C1E';
const MUTED = '#6B7280';

type FavorisStickyGalleryChromeProps = {
  scrollY: SharedValue<number>;
  heroBaseH: number;
  insetTop: number;
  gradientHeight: number;
  selectionMode: boolean;
  selectionHeaderTitle: string;
  pointerEventsActive: boolean;
  onExitSelection: () => void;
  onEnterSelection: () => void;
};

/**
 * Barre au-dessus de la grille quand le diaporama a défilé hors vue : titre « Favoris » réduit
 * + accès permanent au mode sélection (même logique que la variante sans diaporama).
 */
function FavorisStickyGalleryChrome({
  scrollY,
  heroBaseH,
  insetTop,
  gradientHeight,
  selectionMode,
  selectionHeaderTitle,
  pointerEventsActive,
  onExitSelection,
  onEnterSelection,
}: FavorisStickyGalleryChromeProps) {
  const stickyFadeStyle = useAnimatedStyle(() => {
    const y = Math.max(0, scrollY.value);
    const hb = Math.max(heroBaseH, 1);
    return {
      opacity: interpolate(
        y,
        [hb * 0.48, hb * 0.64],
        [0, 1],
        Extrapolation.CLAMP
      ),
    };
  });

  return (
    <Reanimated.View
      style={[styles.topChrome, styles.topChromeFloatingGradient, stickyFadeStyle]}
      pointerEvents={pointerEventsActive ? 'box-none' : 'none'}
    >
      <View
        style={[styles.stickyChromeInner, { minHeight: gradientHeight }]}
        collapsable={false}
        pointerEvents="box-none"
      >
        <LinearGradient
          colors={FAVORIS_TOP_GRADIENT_COLORS}
          locations={FAVORIS_TOP_GRADIENT_LOCATIONS}
          pointerEvents="none"
          style={[styles.favorisFloatingChromeGradient, { height: gradientHeight }]}
        />
        <View
          style={[
            styles.topChromeRow,
            styles.topChromeRowOverGradient,
            { paddingTop: insetTop + verticalScale(10) },
          ]}
          pointerEvents="box-none"
        >
          {selectionMode ? (
            <>
              <Pressable
                onPress={onExitSelection}
                style={styles.topChromeSideBtn}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Annuler la sélection"
              >
                <Text style={styles.topChromeBtnTextLight}>Annuler</Text>
              </Pressable>
              <Text style={styles.topChromeCenterTitleLight} numberOfLines={1}>
                {selectionHeaderTitle}
              </Text>
              <View style={styles.topChromeSideSpacer} />
            </>
          ) : (
            <>
              <Text style={styles.favorisStickyTitle} numberOfLines={1}>
                Favoris
              </Text>
              <View style={styles.topChromeFlex} />
              <Pressable
                onPress={onEnterSelection}
                hitSlop={8}
                style={({ pressed }) => [styles.topChromeSelectCta, pressed && { opacity: 0.88 }]}
                accessibilityRole="button"
                accessibilityLabel="Mode sélection"
              >
                <View style={styles.topChromeSelectCtaContent}>
                  <BookOpen size={scale(18)} color="#FFFFFF" strokeWidth={2.2} />
                  <Text style={styles.topChromeBtnTextLight}>Sélectionner</Text>
                </View>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Reanimated.View>
  );
}

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

/** Overscroll (px) : agrandit légèrement la zone héros par-dessus la hauteur de base */
const SLIDESHOW_PULL_MAX_PX = 168;
/** Hauteur de base du héros / diaporama : ~50 % de l’écran (jusqu’à la moitié). */
const HERO_BASE_RATIO = 0.5;
/** Seuil de scroll (fraction de la hauteur de base du héros) : barre compacte + Sélectionner collants */
const STICKY_CHROME_SCROLL_THRESHOLD_RATIO = 0.57;
/** Bonus de hauteur max quand on tire (fraction de l’écran) */
const HERO_BONUS_RATIO = 0.1;
/** Zoom léger quand on tire au-delà du haut (rubber-band proche iOS) */
const HERO_PULL_SCALE_PER_PX = 0.00135;
/**
 * Écart entre les tuiles de la grille (`galleryRow`) — la bande sous le diaporama
 * utilise la même épaisseur pour rester visuellement alignée.
 */
const GALLERY_TILE_GAP = 1;

const SELECTION_RING = 22;

const AUDIO_WAVE_BARS = [6, 12, 8, 16, 10, 18, 13, 20, 12, 17, 9, 14] as const;

function normalizeInline(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function ellipsize(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, Math.max(0, max - 1)).trimEnd();
  return `${cut}…`;
}

function memoryTitle(m: Memory): string {
  const raw = normalizeInline(m.content ?? '');
  if (raw) return ellipsize(raw, 34);
  return 'Souvenir';
}

function TypeGlyph({ type }: { type: Memory['type'] }) {
  const c = INK;
  const s = scale(16);
  switch (type) {
    case 'photo':
      return <Camera size={s} color={c} strokeWidth={2} />;
    case 'video':
      return <Video size={s} color={c} strokeWidth={2} />;
    case 'voice':
      return <Mic size={s} color={c} strokeWidth={2} />;
    default:
      return type === 'text' ? (
        <View style={styles.textThumbGlyph}>
          <Heart size={scale(44)} color="#E5E7EB" fill="#E5E7EB" strokeWidth={0} />
          <View style={styles.textThumbPenOverlay}>
            <PenLine size={scale(16)} color={c} strokeWidth={2.2} />
          </View>
        </View>
      ) : (
        <Type size={s} color={c} strokeWidth={2} />
      );
  }
}

function thumbUri(m: Memory): string | null {
  if (m.type === 'voice') {
    const u = getVoiceCoverUriForBookPreview(m);
    return u.trim() || null;
  }
  if (m.type === 'video') {
    const u = getVideoPosterUriForBookPreview(m);
    return u.trim() || null;
  }
  return null;
}

type GalleryTileProps = {
  item: FavListItem;
  tileSize: number;
  fontsLoaded: boolean;
  selectionMode: boolean;
  isSelected: boolean;
  onOpen: (memoryId: string) => void;
  onToggleSelect: (key: string) => void;
};

function galleryTilePropsEqual(a: GalleryTileProps, b: GalleryTileProps): boolean {
  return (
    a.item.key === b.item.key &&
    a.item.thumbUrl === b.item.thumbUrl &&
    a.item.memory.id === b.item.memory.id &&
    a.item.memory.type === b.item.memory.type &&
    a.item.memory.content === b.item.memory.content &&
    a.tileSize === b.tileSize &&
    a.fontsLoaded === b.fontsLoaded &&
    a.selectionMode === b.selectionMode &&
    a.isSelected === b.isSelected &&
    a.onOpen === b.onOpen &&
    a.onToggleSelect === b.onToggleSelect
  );
}

const GalleryTile = memo(function GalleryTile({
  item,
  tileSize,
  fontsLoaded,
  selectionMode,
  isSelected,
  onOpen,
  onToggleSelect,
}: GalleryTileProps) {
  const { memory, thumbUrl } = item;
  const rawThumb = thumbUrl.trim() || thumbUri(memory) || '';
  const signedThumb = useSignedMediaUrl(rawThumb || null);
  const uri = (signedThumb ?? rawThumb).trim();
  const isMedia = memory.type === 'photo' || memory.type === 'video';
  const isText = memory.type === 'text';
  const isAudio = memory.type === 'voice';
  const tileCaptionSnippet =
    memory.type === 'photo' || memory.type === 'video'
      ? photoCaptionOverlayText(memory.content)
      : null;

  const scaleSv = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleSv.value }],
  }));

  const onPress = () => {
    if (selectionMode) {
      scaleSv.value = withSequence(
        withTiming(0.94, { duration: 80 }),
        withSpring(1, { damping: 12 })
      );
      onToggleSelect(item.key);
    } else {
      onOpen(memory.id);
    }
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.galleryTile,
        { width: tileSize, height: tileSize },
        !selectionMode && pressed ? { opacity: 0.92 } : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={
        selectionMode
          ? isSelected
            ? 'Désélectionner'
            : 'Sélectionner'
          : 'Ouvrir le souvenir en plein écran'
      }
    >
      <Reanimated.View style={[styles.galleryTileInner, animStyle]}>
        {isMedia && uri ? (
          <>
            <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
            {tileCaptionSnippet ? (
              <View
                style={[
                  styles.galleryPhotoCaptionBand,
                  selectionMode ? styles.galleryPhotoCaptionBandSelection : null,
                ]}
                pointerEvents="none"
              >
                <LinearGradient
                  pointerEvents="none"
                  colors={['rgba(55,55,55,0)', 'rgba(28,28,28,0.78)']}
                  locations={[0, 1]}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  style={StyleSheet.absoluteFillObject}
                />
                <Text
                  style={[
                    styles.galleryPhotoCaptionText,
                    fontsLoaded
                      ? { fontFamily: 'EBGaramond_400Regular_Italic', fontWeight: '400' }
                      : { fontWeight: '600' },
                  ]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {tileCaptionSnippet}
                </Text>
              </View>
            ) : null}
          </>
        ) : isAudio ? (
          <View style={styles.audioThumb}>
            {uri ? (
              <>
                <Image source={{ uri }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                <View style={styles.audioThumbScrim} pointerEvents="none" />
              </>
            ) : null}
            <View style={styles.audioThumbContent} pointerEvents="none">
              <View style={styles.audioThumbPlay} pointerEvents="none">
                <Play size={scale(18)} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
              </View>
              <View style={styles.audioThumbWaveRow}>
                {AUDIO_WAVE_BARS.map((h, i) => (
                  <View key={i} style={[styles.audioThumbWaveBar, { height: verticalScale(h) }]} />
                ))}
              </View>
            </View>
          </View>
        ) : isText ? (
          <View style={styles.galleryPh}>
            <Text
              style={[
                styles.galleryTextSnippet,
                fontsLoaded ? { fontFamily: 'EBGaramond_400Regular_Italic' } : null,
              ]}
              numberOfLines={6}
            >
              {(memory.content ?? '').trim() || 'Petits mots'}
            </Text>
          </View>
        ) : (
          <View style={styles.galleryPh}>
            <TypeGlyph type={memory.type} />
          </View>
        )}

        {memory.type === 'video' ? (
          <View style={styles.galleryVideoBadge} pointerEvents="none">
            <Video size={scale(18)} color="#FFFFFF" strokeWidth={2.2} />
          </View>
        ) : null}

        {selectionMode ? (
          <View
            style={[
              styles.selectionRing,
              isSelected ? styles.selectionRingSelected : styles.selectionRingIdle,
            ]}
            pointerEvents="none"
          >
            {isSelected ? <Check size={scale(13)} color="#FFFFFF" strokeWidth={3} /> : null}
          </View>
        ) : null}
      </Reanimated.View>
    </Pressable>
  );
}, galleryTilePropsEqual);

export default function FavorisScreen() {
  const router = useRouter();
  const isTabFocused = useIsFocused();
  const params = useLocalSearchParams<{ bookId?: string; createBookTitle?: string }>();
  const insets = useSafeAreaInsets();
  const [fontsLoaded] = useFonts({ EBGaramond_400Regular_Italic });
  /** Prérempli après `hydrateTabScreensFromLocal` : pas de roue si les données locales sont déjà connues. */
  const [loading, setLoading] = useState(() => feedChildHydrationSnapshot === null);
  const [memories, setMemories] = useState<Memory[]>(() => [...feedMemoriesHydrationSnapshot]);
  const [hasChild, setHasChild] = useState(() => feedChildHydrationSnapshot !== null);
  /** Pixels d’overscroll en haut (y négatif → valeur positive), suit le doigt */
  const [pullOverscrollPx, setPullOverscrollPx] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const galleryListRef = useRef<FlatList<FavListItem> | null>(null);
  /** Offset de scroll (UI thread) : parallaxe / fondu type Photothèque iOS */
  const galleryScrollY = useSharedValue(0);
  /** Barre compacte au-dessus de la grille : activer les touches seulement quand le seuil est dépassé */
  const slideshowStickyChromeRef = useRef(false);
  const [slideshowStickyChrome, setSlideshowStickyChrome] = useState(false);
  const [bookModalVisible, setBookModalVisible] = useState(false);
  const [createBookFlowTitle, setCreateBookFlowTitle] = useState<string | null>(null);

  const load = useCallback(async () => {
    const childId = await getOrSelectFirstChild();
    if (!childId) {
      setMemories([]);
      setHasChild(false);
      setLoading(false);
      return;
    }
    setHasChild(true);

    const list = await getMemories(childId);
    setMemories(list);
    void requestMissingMediaDerivatives(list);
    setLoading(false);
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, []);

  const toggleSelection = useCallback((key: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const enterSelectionMode = useCallback(() => {
    setPullOverscrollPx(0);
    setSelectionMode(true);
    setSelectedIds(new Set());
  }, []);

  const heroGradientHeight = useMemo(
    () => insets.top + verticalScale(104),
    [insets.top]
  );

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');
      load();
      return () => {
        setPullOverscrollPx(0);
        galleryScrollY.value = 0;
        slideshowStickyChromeRef.current = false;
        setSlideshowStickyChrome(false);
        setSelectionMode(false);
        setSelectedIds(new Set());
      };
    }, [load])
  );

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('petitmo:memories-invalidate', () => {
      void load();
    });
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    const id = typeof params.bookId === 'string' ? params.bookId : null;
    if (id) {
      // Compat: si on arrive ici avec un bookId (ex. depuis un lien),
      // on ouvre l’aperçu du livre directement.
      router.push({ pathname: '/book-preview', params: { bookId: id } });
    }
  }, [params.bookId, router]);

  useEffect(() => {
    const t = typeof params.createBookTitle === 'string' ? params.createBookTitle.trim() : '';
    if (!t) return;
    setCreateBookFlowTitle(t);
    // Auto: passer en mode sélection.
    setSelectionMode(true);
    setSelectedIds(new Set());
    // Nettoyage params non critique (on évite des loops en restant minimaliste).
  }, [params.createBookTitle]);

  const favoriteItems = useMemo(() => buildFavoriteItems(memories), [memories]);

  const galleryItems = useMemo(() => favoriteItems, [favoriteItems]);

  const selectedMemoryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const it of galleryItems) {
      if (selectedIds.has(it.key)) ids.add(it.memory.id);
    }
    return [...ids];
  }, [galleryItems, selectedIds]);

  const slideshowUrls = useMemo(() => buildSlideshowUrls(galleryItems), [galleryItems]);

  useEffect(() => {
    if (slideshowUrls.length === 0) {
      slideshowStickyChromeRef.current = false;
      setSlideshowStickyChrome(false);
    }
  }, [slideshowUrls.length]);

  /** Icônes claires sur le hero sombre : seulement quand cet onglet est au premier plan (pas sous memory-view / autre stack). */
  useEffect(() => {
    if (!isTabFocused || loading) return;
    setStatusBarStyle('light');
  }, [loading, isTabFocused]);

  const columns = 3;
  const gridGap = GALLERY_TILE_GAP;
  const tileSize = Math.floor((SCREEN_W - gridGap * (columns - 1)) / columns);
  const heroBaseH = slideshowUrls.length > 0 ? SCREEN_H * HERO_BASE_RATIO : 0;
  const heroBonusH =
    slideshowUrls.length > 0
      ? (Math.min(pullOverscrollPx, SLIDESHOW_PULL_MAX_PX) / SLIDESHOW_PULL_MAX_PX) *
        (SCREEN_H * HERO_BONUS_RATIO)
      : 0;
  const heroHeight = heroBaseH + heroBonusH;

  const selectionHeaderTitle = useMemo(() => {
    const n = selectedIds.size;
    if (n === 0) return '0 sélectionné';
    if (n === 1) return '1 sélectionné';
    return `${n} sélectionnés`;
  }, [selectedIds]);

  const openMemory = useCallback(
    (memoryId: string) => {
      router.push({ pathname: '/memory-view', params: { memoryId } });
    },
    [router]
  );

  const renderGalleryItem: ListRenderItem<FavListItem> = useCallback(
    ({ item }) => (
      <GalleryTile
        item={item}
        tileSize={tileSize}
        fontsLoaded={fontsLoaded}
        selectionMode={selectionMode}
        isSelected={selectedIds.has(item.key)}
        onOpen={openMemory}
        onToggleSelect={toggleSelection}
      />
    ),
    [fontsLoaded, tileSize, selectionMode, selectedIds, openMemory, toggleSelection]
  );

  const favoritesListHeader = useMemo(() => {
    if (slideshowUrls.length === 0) return null;
    return (
      <HeroListHeader
        scrollY={galleryScrollY}
        urls={slideshowUrls}
        heroHeight={heroHeight}
        heroBaseH={heroBaseH}
        heroGradientHeight={heroGradientHeight}
        insetTop={insets.top}
        selectionMode={selectionMode}
        selectionHeaderTitle={selectionHeaderTitle}
        onExitSelection={exitSelection}
        onEnterSelection={enterSelectionMode}
      />
    );
  }, [
    slideshowUrls,
    heroHeight,
    heroBaseH,
    heroGradientHeight,
    insets.top,
    selectionMode,
    selectionHeaderTitle,
    exitSelection,
    enterSelectionMode,
  ]);

  return (
    <View style={styles.container}>
      {isTabFocused ? <StatusBar style="light" /> : null}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={THEME.accent} />
        </View>
      ) : !hasChild ? (
        <View style={[styles.centered, styles.noChildPad]}>
          <Text style={styles.noChildTitle}>Aucun profil enfant</Text>
          <Text style={styles.noChildSub}>
            Crée un profil pour enregistrer des souvenirs et des favoris.
          </Text>
          <TouchableOpacity
            style={styles.noChildCta}
            onPress={() => router.push('/create-child')}
            activeOpacity={0.85}
          >
            <Text style={styles.noChildCtaText}>Créer un profil</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View
          style={[
            styles.mainColumn,
            galleryItems.length > 0 ? styles.mainColumnGallery : styles.mainColumnLight,
          ]}
        >
          {galleryItems.length === 0 ? (
            <View style={[styles.emptyBox, { flex: 1, margin: SPACING.md }]}>
              <BookOpen size={scale(40)} color="#D1D5DB" strokeWidth={2} />
              <Text style={styles.emptyTitle}>Aucun favori pour le moment</Text>
              <Text style={styles.emptySub}>
                Ajoute des souvenirs en favoris depuis le fil ou depuis un album.
              </Text>
            </View>
          ) : (
            <>
              <FlatList
                ref={galleryListRef}
                data={galleryItems}
                keyExtractor={(it) => it.key}
                renderItem={renderGalleryItem}
                numColumns={columns}
                columnWrapperStyle={styles.galleryRow}
                contentContainerStyle={[
                  styles.galleryContent,
                  selectionMode && selectedIds.size > 0 ? styles.galleryContentWithSelectionCta : null,
                ]}
                style={styles.gallery}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                ListHeaderComponent={favoritesListHeader}
                extraData={{ heroHeight, selectionMode, selectionHeaderTitle }}
                onScroll={e => {
                  const y = e.nativeEvent.contentOffset.y;
                  galleryScrollY.value = y;
                  setPullOverscrollPx(
                    y < 0 ? Math.min(-y, SLIDESHOW_PULL_MAX_PX) : 0
                  );
                  if (slideshowUrls.length > 0 && heroBaseH > 1e-6) {
                    const past =
                      y > heroBaseH * STICKY_CHROME_SCROLL_THRESHOLD_RATIO;
                    if (past !== slideshowStickyChromeRef.current) {
                      slideshowStickyChromeRef.current = past;
                      setSlideshowStickyChrome(past);
                    }
                  }
                }}
                {...Platform.select({
                  android: { overScrollMode: 'always' as const },
                })}
              />

              {slideshowUrls.length > 0 && galleryItems.length > 0 ? (
                <FavorisStickyGalleryChrome
                  scrollY={galleryScrollY}
                  heroBaseH={heroBaseH}
                  insetTop={insets.top}
                  gradientHeight={heroGradientHeight}
                  selectionMode={selectionMode}
                  selectionHeaderTitle={selectionHeaderTitle}
                  pointerEventsActive={slideshowStickyChrome}
                  onExitSelection={exitSelection}
                  onEnterSelection={enterSelectionMode}
                />
              ) : null}

              {slideshowUrls.length === 0 && galleryItems.length > 0 ? (
                <View style={[styles.topChrome, styles.topChromeFloatingGradient]} pointerEvents="box-none">
                  <View
                    style={[styles.stickyChromeInner, { minHeight: heroGradientHeight }]}
                    collapsable={false}
                    pointerEvents="box-none"
                  >
                    <LinearGradient
                      colors={FAVORIS_TOP_GRADIENT_COLORS}
                      locations={FAVORIS_TOP_GRADIENT_LOCATIONS}
                      pointerEvents="none"
                      style={[styles.favorisFloatingChromeGradient, { height: heroGradientHeight }]}
                    />
                    <View
                      style={[
                        styles.topChromeRow,
                        styles.topChromeRowOverGradient,
                        { paddingTop: insets.top + verticalScale(10) },
                      ]}
                      pointerEvents="box-none"
                    >
                    {selectionMode ? (
                      <>
                        <Pressable
                          onPress={exitSelection}
                          style={styles.topChromeSideBtn}
                          hitSlop={12}
                          accessibilityRole="button"
                          accessibilityLabel="Annuler la sélection"
                        >
                          <Text style={styles.topChromeBtnTextLight}>Annuler</Text>
                        </Pressable>
                        <Text style={styles.topChromeCenterTitleLight} numberOfLines={1}>
                          {selectionHeaderTitle}
                        </Text>
                        <View style={styles.topChromeSideSpacer} />
                      </>
                    ) : (
                      <>
                        <View style={styles.topChromeFlex} />
                        <Pressable
                          onPress={enterSelectionMode}
                          hitSlop={8}
                          style={({ pressed }) => [styles.topChromeSelectCta, pressed && { opacity: 0.88 }]}
                          accessibilityRole="button"
                          accessibilityLabel="Mode sélection"
                        >
                          <View style={styles.topChromeSelectCtaContent}>
                            <BookOpen size={scale(18)} color="#FFFFFF" strokeWidth={2.2} />
                            <Text style={styles.topChromeBtnTextLight}>Sélectionner</Text>
                          </View>
                        </Pressable>
                      </>
                    )}
                    </View>
                  </View>
                </View>
              ) : null}
            </>
          )}

          {selectionMode && selectedIds.size > 0 ? (
            <Reanimated.View
              entering={SlideInDown.duration(280)}
              exiting={SlideOutDown.duration(200)}
              style={[
                styles.selectionActionBar,
                /* Pas d’insets.bottom ici : la tab bar occupe déjà la zone home indicator ; sinon bandeau blanc trop haut. */
                { paddingBottom: verticalScale(6) },
              ]}
            >
              <TouchableOpacity
                style={styles.selectionActionBtn}
                activeOpacity={0.9}
                onPress={async () => {
                  if (createBookFlowTitle) {
                    // Flux "Livres → Nouveau" : on crée le livre maintenant, puis on ajoute la sélection.
                    const { createBook, addMemoriesToBook, upsertBook } = await import('@/services/books');
                    const { getLocalMemoryById } = await import('@/lib/localDb');
                    const created = await createBook(createBookFlowTitle);
                    const updated = await addMemoriesToBook(created.id, selectedMemoryIds);
                    // Couverture par défaut: première photo sélectionnée (source, jamais un thumb).
                    for (const id of selectedMemoryIds) {
                      const m = getLocalMemoryById(id);
                      if (!m || m.type !== 'photo') continue;
                      const src =
                        (m.local_print_path ??
                          m.local_original_path ??
                          m.local_media_path ??
                          m.print_url ??
                          m.display_url ??
                          m.edited_media_url ??
                          m.media_url ??
                          '')?.trim();
                      if (src) {
                        // IMPORTANT: ne pas écraser memoryIds (utiliser la version déjà enrichie).
                        await upsertBook({ ...(updated ?? created), coverPhotoUrl: src });
                      }
                      break;
                    }
                    setCreateBookFlowTitle(null);
                    exitSelection();
                    router.push({ pathname: '/book-preview', params: { bookId: created.id } });
                    return;
                  }
                  setBookModalVisible(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Ajouter au livre"
              >
                <Text style={styles.selectionActionBtnText}>
                  {createBookFlowTitle ? `Créer « ${createBookFlowTitle} » →` : 'Ajouter au livre →'}
                </Text>
              </TouchableOpacity>
            </Reanimated.View>
          ) : null}

          <AddToBookModal
            visible={bookModalVisible}
            onClose={() => setBookModalVisible(false)}
            memoryIds={selectedMemoryIds}
            redirectToBooksOnDone
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  mainColumn: {
    flex: 1,
  },
  mainColumnGallery: {
    backgroundColor: '#FFFFFF',
  },
  mainColumnLight: {
    backgroundColor: '#FFFFFF',
  },
  heroHeaderStack: {
    width: '100%',
  },
  heroColumn: {
    width: '100%',
    position: 'relative',
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  heroGridWhiteGap: {
    width: '100%',
    height: GALLERY_TILE_GAP,
    backgroundColor: '#FFFFFF',
  },
  heroSlideshowLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  /** Remplit le héros et masque le débordement (overscan des calques zoom). */
  slideshowInner: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  /**
   * Calque légèrement plus grand que le cadre : le zoom arrière (scale → 1) reste centré
   * sans laisser voir le fond noir du héros sur les bords.
   */
  slideshowZoom: {
    position: 'absolute',
    top: '-9%',
    left: '-9%',
    width: '118%',
    height: '118%',
  },
  favorisTitleGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 14,
  },
  favorisTitleWrap: {
    position: 'absolute',
    zIndex: 15,
  },
  favorisTitleIos: {
    fontSize: scale(34),
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: scale(-0.6),
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 0,
    paddingTop: 0,
  },
  emptyBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: scale(12),
    padding: SPACING.xl,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    gap: verticalScale(14),
  },
  emptyTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: MUTED,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: FONT_SIZES.md,
    color: MUTED,
    textAlign: 'center',
    lineHeight: scale(22),
  },
  gallery: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  galleryContent: {
    paddingTop: 0,
    paddingBottom: verticalScale(6),
  },
  /** Espace pour le CTA « Ajouter au livre » en overlay bas (évite les tuiles cachées). */
  galleryContentWithSelectionCta: {
    paddingBottom: verticalScale(52),
  },
  galleryRow: {
    gap: GALLERY_TILE_GAP,
    paddingHorizontal: 0,
    marginBottom: GALLERY_TILE_GAP,
  },
  galleryTile: {
    backgroundColor: '#E5E5EA',
    overflow: 'hidden',
  },
  galleryTileInner: {
    flex: 1,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
  },
  selectionRing: {
    position: 'absolute',
    right: scale(6),
    bottom: scale(6),
    width: SELECTION_RING,
    height: SELECTION_RING,
    borderRadius: SELECTION_RING / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionRingIdle: {
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  selectionRingSelected: {
    backgroundColor: '#0A0A0A',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  topChrome: {
    paddingBottom: verticalScale(8),
  },
  topChromeOnHero: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 20,
  },
  /** Bandeau flottant : même dégradé que le héros ; pas d’overflow hidden (évite de rogner le fondu → bande noire). */
  topChromeFloatingGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 22,
  },
  favorisFloatingChromeGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  stickyChromeInner: {
    width: '100%',
  },
  topChromeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
  },
  topChromeRowOverGradient: {
    zIndex: 1,
  },
  topChromeFlex: {
    flex: 1,
  },
  topChromeSideBtn: {
    minWidth: scale(76),
    paddingVertical: verticalScale(6),
  },
  /** CTA « Sélectionner » sur le héros : pilule grise translucide, alignée avec la ligne du titre Favoris */
  topChromeSelectCta: {
    minWidth: scale(76),
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(15),
    borderRadius: scale(999),
    backgroundColor: 'rgba(120,120,128,0.42)',
  },
  topChromeSelectCtaContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(7),
  },
  topChromeSideSpacer: {
    minWidth: scale(76),
  },
  topChromeBtnTextLight: {
    color: '#FFFFFF',
    fontSize: scale(16),
    fontWeight: '600',
  },
  topChromeCenterTitleLight: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: scale(16),
    fontWeight: '700',
    textAlign: 'center',
  },
  /** Titre « Favoris » au-dessus de la grille (bandeau collant) */
  favorisStickyTitle: {
    flexShrink: 1,
    maxWidth: '52%',
    color: '#FFFFFF',
    fontSize: scale(22),
    fontWeight: '700',
    letterSpacing: scale(-0.35),
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  selectionActionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.32)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: verticalScale(10),
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -1 },
        shadowOpacity: 0.05,
        shadowRadius: 4,
      },
      android: { elevation: 6 },
    }),
  },
  selectionActionBtn: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: scale(320),
    backgroundColor: '#0A0A0A',
    borderRadius: scale(999),
    paddingVertical: verticalScale(12),
    paddingHorizontal: scale(22),
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectionActionBtnText: {
    color: '#FFFFFF',
    fontSize: scale(16),
    fontWeight: '800',
  },
  galleryPh: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.sm,
  },
  audioThumb: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#EEF2F6',
  },
  audioThumbScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  audioThumbContent: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: SPACING.sm,
    paddingBottom: verticalScale(10),
    gap: verticalScale(10),
  },
  audioThumbPlay: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: [{ translateX: -scale(18) }, { translateY: -scale(18) }],
    width: scale(36),
    height: scale(36),
    borderRadius: scale(18),
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioThumbWaveRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: scale(2),
    opacity: 0.92,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.28,
        shadowRadius: 10,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  audioThumbWaveBar: {
    width: scale(2),
    borderRadius: scale(999),
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  galleryTextSnippet: {
    fontSize: 12,
    lineHeight: 16,
    color: INK,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  /** Même centrage et taille de pastille que `audioThumbPlay` (icône play audio). */
  galleryVideoBadge: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    transform: [{ translateX: -scale(18) }, { translateY: -scale(18) }],
    width: scale(36),
    height: scale(36),
    borderRadius: scale(18),
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Bandeau bas : dégradé gris (transparent → foncé) + extrait de l’annotation photo. */
  galleryPhotoCaptionBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '42%',
    justifyContent: 'flex-end',
    paddingHorizontal: scale(8),
    paddingBottom: verticalScale(7),
    paddingTop: verticalScale(10),
    overflow: 'hidden',
  },
  galleryPhotoCaptionBandSelection: {
    paddingRight: scale(34),
  },
  galleryPhotoCaptionText: {
    fontSize: scale(11),
    lineHeight: scale(14),
    color: '#FFFFFF',
    textAlign: 'left',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 3,
  },

  textThumbGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  textThumbPenOverlay: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },

  noChildPad: {
    paddingHorizontal: SPACING.lg,
  },
  noChildTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '700',
    color: INK,
    marginBottom: verticalScale(8),
    textAlign: 'center',
  },
  noChildSub: {
    fontSize: FONT_SIZES.md,
    color: MUTED,
    textAlign: 'center',
    lineHeight: scale(22),
    marginBottom: verticalScale(20),
  },
  noChildCta: {
    backgroundColor: THEME.accent,
    paddingHorizontal: SPACING.xl,
    paddingVertical: verticalScale(12),
    borderRadius: scale(12),
  },
  noChildCtaText: {
    color: '#FFFFFF',
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },

  // (Menu horizontal supprimé)
});
