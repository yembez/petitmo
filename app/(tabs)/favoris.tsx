import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Platform,
  Dimensions,
  DeviceEventEmitter,
  FlatList,
  TouchableOpacity,
  Alert,
  type ListRenderItem,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  cancelAnimation,
  Easing,
  SlideInDown,
  SlideOutDown,
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
import TabSceneTransition from '@/components/TabSceneTransition';
import { THEME } from '@/constants/theme';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import {
  tabBarFloatingBottomInset,
  tabBarFloatingOverlapPad,
} from '@/constants/tabBarLayout';
import { SPACING, FONT_SIZES } from '@/constants/sizes';
import { useMemoryTextFont } from '@/contexts/MemoryTextFontContext';
import { getFamilyMemories, requestMissingMediaDerivatives } from '@/services/media';
import { getOrSelectFirstChild } from '@/services/children';
import { getLocalMemoryById, getLocalBook } from '@/lib/localDb';
import {
  feedChildHydrationSnapshot,
  feedMemoriesHydrationSnapshot,
} from '@/services/tabScreensCache';
import type { Memory } from '@/types/local';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { Image as ExpoImage } from 'expo-image';
import {
  getAllPhotoUrls,
  getAllPhotoUrlsForFeed,
  parseFavoritePhotoUrls,
  normalizePhotoUrlForCompare,
  mapPhotoUrlToThumb,
  getVoiceCoverUriForBookPreview,
  getVoiceCoverUriForFeedAndViewer,
  getVideoPosterUriForFeedAndViewer,
  normalizeMemoryMediaUriForDisplay,
  canonicalBookCoverPhotoRef,
} from '@/utils/memoryPhotos';
import { useFeedPhotoDisplayUrls } from '@/hooks/useFeedPhotoDisplayUrls';
import { clampAudioBookAnnotation } from '@/lib/audioBookAnnotation';
import { AddToBookModal } from '@/components/AddToBookModal';
import {
  addMemoriesToBook,
  BookUpgradeRequiredError,
  createBook,
  dedupeMemoryIds,
  upsertBook,
} from '@/services/books';
import {
  clearPendingFavorisAddToBookId,
  consumePendingFavorisAddToBookId,
  setFavorisAddToBookSession,
  clearFavorisAddToBookSession,
} from '@/services/favorisBookAddFlow';

type FavListItem = {
  key: string;
  memory: Memory;
  thumbUrl: string;
  kind: 'whole' | 'photo';
  /** Pour `kind === 'photo'` : URL originale dans `favorite_photo_urls` (alignement index avec le fil). */
  favPhotoOriginalUrl?: string;
};

function thumbUri(m: Memory): string | null {
  if (m.type === 'voice') {
    const u = getVoiceCoverUriForBookPreview(m);
    return u.trim() || null;
  }
  if (m.type === 'video') {
    const u = getVideoPosterUriForFeedAndViewer(m);
    return u.trim() || null;
  }
  return null;
}

/** Identique à `FilMemoryRow` : vignette vidéo dans le fil. */
function feedVideoPosterRaw(memory: Memory): string {
  return getVideoPosterUriForFeedAndViewer(memory);
}

/** Identique au fil : cover vocale rebasée + normalisée. */
function feedVoiceCoverRaw(memory: Memory): string {
  return getVoiceCoverUriForFeedAndViewer(memory);
}

function primaryDisplayThumb(m: Memory): string {
  if (m.type === 'photo') {
    return getAllPhotoUrlsForFeed(m)[0]?.trim() || '';
  }
  if (m.type === 'video') {
    const v = feedVideoPosterRaw(m);
    if (v) return v;
  }
  if (m.type === 'voice') {
    const c = feedVoiceCoverRaw(m);
    if (c) return c;
  }
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
          favPhotoOriginalUrl: url,
        });
      }
    }
  }
  return items.sort(
    (a, b) => new Date(b.memory.created_at).getTime() - new Date(a.memory.created_at).getTime()
  );
}

/** Items pour le diaporama (médias avec une vignette possible ; les photos résolvent comme le fil). */
function buildSlideshowItems(items: FavListItem[]): FavListItem[] {
  const out: FavListItem[] = [];
  for (const it of items) {
    const t = it.memory.type;
    if (t !== 'photo' && t !== 'video' && t !== 'voice') continue;
    if (t === 'photo') {
      out.push(it);
      continue;
    }
    if (t === 'video') {
      if (feedVideoPosterRaw(it.memory) || it.thumbUrl.trim()) out.push(it);
      continue;
    }
    if (t === 'voice') {
      if (feedVoiceCoverRaw(it.memory) || it.thumbUrl.trim()) out.push(it);
      continue;
    }
  }
  return out;
}

/** URL brute pour une slide : même pipeline que `useFeedPhotoDisplayUrls` (fichier mort → distant). */
function slideshowSlideRawUri(item: FavListItem, feedUrls: string[]): string {
  const memory = item.memory;
  if (memory.type === 'photo') {
    if (item.kind === 'photo' && item.favPhotoOriginalUrl) {
      const slots = getAllPhotoUrlsForFeed(memory);
      const fav = item.favPhotoOriginalUrl;
      const idx = slots.findIndex(
        u => normalizePhotoUrlForCompare(u) === normalizePhotoUrlForCompare(fav)
      );
      return ((idx >= 0 ? feedUrls[idx] : '') ?? '').trim() || item.thumbUrl.trim();
    }
    return feedUrls[0]?.trim() || item.thumbUrl.trim();
  }
  if (memory.type === 'video') {
    return feedVideoPosterRaw(memory) || item.thumbUrl.trim();
  }
  if (memory.type === 'voice') {
    return feedVoiceCoverRaw(memory) || item.thumbUrl.trim();
  }
  return item.thumbUrl.trim();
}

/** Extrait sous les vignettes photo / vidéo / audio annoté (premiers mots, comme le fil). */
const PHOTO_CAPTION_MAX_WORDS = 14;

function photoCaptionOverlayText(content: string | null | undefined): string | null {
  const raw = (content ?? '').trim();
  if (!raw) return null;
  const words = raw.split(/\s+/u).filter(Boolean);
  if (words.length <= PHOTO_CAPTION_MAX_WORDS) return raw;
  return `${words.slice(0, PHOTO_CAPTION_MAX_WORDS).join(' ')}…`;
}

function galleryTileCaptionSnippet(memory: Memory): string | null {
  const raw = (memory.content ?? '').trim();
  if (!raw) return null;
  if (memory.type === 'photo' || memory.type === 'video') {
    return photoCaptionOverlayText(raw);
  }
  if (memory.type === 'voice') {
    return photoCaptionOverlayText(clampAudioBookAnnotation(raw));
  }
  return null;
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

/** Une slide du diaporama : même chaîne que le fil (`PhotoMosaic` + `FilMemoryRow`). */
function SlideshowSlideImage({
  item,
  onLoad,
}: {
  item: FavListItem;
  onLoad: () => void;
}) {
  const memory = item.memory;
  const feedUrls = useFeedPhotoDisplayUrls(memory);

  const rawPhoto =
    memory.type === 'photo' ? slideshowSlideRawUri(item, feedUrls).trim() : '';
  const rawVideo =
    memory.type === 'video' ? (feedVideoPosterRaw(memory) || item.thumbUrl.trim()).trim() : '';
  const rawVoice =
    memory.type === 'voice' ? (feedVoiceCoverRaw(memory) || item.thumbUrl.trim()).trim() : '';

  const signedVideo = useSignedMediaUrl(memory.type === 'video' ? rawVideo || null : null);
  const signedVoice = useSignedMediaUrl(memory.type === 'voice' ? rawVoice || null : null);

  const uriRaw =
    memory.type === 'photo'
      ? rawPhoto
      : memory.type === 'video'
        ? (signedVideo ?? rawVideo).trim()
        : memory.type === 'voice'
          ? (signedVoice ?? rawVoice).trim()
          : '';
  const uri = uriRaw ? normalizeMemoryMediaUriForDisplay(uriRaw) : '';

  useEffect(() => {
    if (!uri) return;
    void ExpoImage.prefetch(uri).catch(() => {});
  }, [uri]);

  if (!uri) return null;
  return (
    <ExpoImage
      key={`${item.key}|${uri}`}
      source={{ uri }}
      style={StyleSheet.absoluteFillObject}
      contentFit="cover"
      cachePolicy="disk"
      onLoad={onLoad}
    />
  );
}

/** Diaporama : double calque — l’image visible reste à l’écran pendant que la suivante se charge en dessous (pas d’écran noir). */
function FavorisSlideshow({
  items,
  height,
  isActive,
}: {
  items: FavListItem[];
  height: number;
  isActive: boolean;
}) {
  const n = items.length;
  const itemsKey = useMemo(() => items.map(i => i.key).join('\0'), [items]);
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

  const layer0Item: FavListItem | null =
    n <= 1 ? (items[0] ?? null) : topLayer === 0 ? items[visibleIdx] ?? null : items[(visibleIdx + 1) % n] ?? null;
  const layer1Item: FavListItem | null =
    n <= 1
      ? null
      : topLayer === 1
        ? items[visibleIdx] ?? null
        : items[(visibleIdx + 1) % n] ?? null;

  useEffect(() => {
    readyRef.current[0] = false;
    readyRef.current[1] = false;
  }, [layer0Item?.key, layer1Item?.key]);

  useEffect(() => {
    if (isActive && n > 0) {
      setVisibleIdx(0);
      setTopLayer(0);
    }
  }, [isActive, n, itemsKey]);

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
  }, [isActive, n, topLayer, visibleIdx, itemsKey, scale0, scale1]);

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
        {layer0Item ? (
          <SlideshowSlideImage
            item={layer0Item}
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
          {layer1Item ? <SlideshowSlideImage item={layer1Item} onLoad={onLayer1Load} /> : null}
        </Reanimated.View>
      ) : null}
    </View>
  );
}

type HeroSlideshowListHeaderProps = {
  scrollY: SharedValue<number>;
  slideshowItems: FavListItem[];
  heroHeight: number;
  isTabFocused: boolean;
};

/** Diaporama seul dans l’en-tête de liste (titre + CTAs : barre fixe au-dessus de la FlatList). */
function HeroSlideshowListHeader({
  scrollY,
  slideshowItems,
  heroHeight,
  isTabFocused,
}: HeroSlideshowListHeaderProps) {
  const imageMotionStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    const pulled = y < 0 ? y : 0;
    const scale = 1 + -pulled * HERO_PULL_SCALE_PER_PX;
    return {
      transform: [{ scale }],
    };
  });

  if (heroHeight < 2 || slideshowItems.length === 0) return null;

  return (
    <View style={styles.heroHeaderStack}>
      <View style={[styles.heroColumn, { height: heroHeight }]}>
        <Reanimated.View style={[styles.heroSlideshowLayer, imageMotionStyle]}>
          <FavorisSlideshow
            items={slideshowItems}
            height={heroHeight}
            isActive={isTabFocused && heroHeight > 8}
          />
        </Reanimated.View>
      </View>
      <View style={styles.heroGridWhiteGap} pointerEvents="none" />
    </View>
  );
}

const INK = '#1C1C1E';
const MUTED = '#6B7280';

type FavorisFixedTopChromeProps = {
  insetTop: number;
  gradientHeight: number;
  selectionMode: boolean;
  /** Flux spread livre → favoris : pas d’« Annuler » en haut (CTA bas). */
  bookAddFromSpreadFlow: boolean;
  selectionHeaderTitle: string;
  onExitSelection: () => void;
  onEnterSelection: () => void;
};

/** Titre + CTAs toujours visibles (hors scroll). */
function FavorisFixedTopChrome({
  insetTop,
  gradientHeight,
  selectionMode,
  bookAddFromSpreadFlow,
  selectionHeaderTitle,
  onExitSelection,
  onEnterSelection,
}: FavorisFixedTopChromeProps) {
  return (
    <View style={styles.favorisFixedTopChrome} pointerEvents="box-none">
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
            selectionMode ? styles.topChromeRowSelecting : null,
            { paddingTop: insetTop + verticalScale(10) },
          ]}
          pointerEvents="box-none"
        >
          {selectionMode ? (
            <>
              {bookAddFromSpreadFlow ? (
                <View style={styles.topChromeSideSpacer} />
              ) : (
                <Pressable
                  onPress={onExitSelection}
                  style={styles.topChromeSideBtn}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Annuler la sélection"
                >
                  <Text style={styles.topChromeBtnTextLight}>Annuler</Text>
                </Pressable>
              )}
              <Text style={styles.topChromeCenterTitleLight} numberOfLines={1}>
                {selectionHeaderTitle}
              </Text>
              <View style={styles.topChromeSideSpacer} />
            </>
          ) : (
            <>
              <View style={styles.favorisTitleRow}>
                <Text style={styles.favorisStickyTitle} numberOfLines={1}>
                  Favoris
                </Text>
                <Heart
                  size={scale(22)}
                  color="#FFFFFF"
                  fill="#FFFFFF"
                  strokeWidth={1.6}
                  style={styles.favorisTitleHeart}
                />
              </View>
              <View style={styles.topChromeFlex} />
              <Pressable
                onPress={onEnterSelection}
                hitSlop={8}
                style={({ pressed }) => [styles.topChromeSelectCta, pressed && { opacity: 0.88 }]}
                accessibilityRole="button"
                accessibilityLabel="Mode sélection"
              >
                <View style={styles.topChromeSelectCtaContent}>
                  <BookOpen size={scale(18)} color={THEME.captureScreenCtaForeground} strokeWidth={2.2} />
                  <Text style={styles.topChromeSelectCtaText}>Sélectionner</Text>
                </View>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;

/** Overscroll (px) : agrandit légèrement la zone héros par-dessus la hauteur de base */
const SLIDESHOW_PULL_MAX_PX = 168;
/** Hauteur de base du héros / diaporama : ~50 % de l’écran (jusqu’à la moitié). */
const HERO_BASE_RATIO = 0.5;
/** Bonus de hauteur max quand on tire (fraction de l’écran) */
const HERO_BONUS_RATIO = 0.1;
/** Zoom léger quand on tire au-delà du haut (rubber-band proche iOS) */
const HERO_PULL_SCALE_PER_PX = 0.00135;
/**
 * Écart entre les tuiles (`galleryRow`) ; ligne fine sous le diaporama pour l’alignement grille.
 */
const GALLERY_TILE_GAP = 1;

const SELECTION_RING = 22;
/** Vert « déjà dans le livre » — parité `AddToBookModal.modalThumbCheck`. */
const IN_BOOK_NOTCH_GREEN = '#16A34A';

/** Zone CTA + padding haut du bandeau « Ajouter au livre » (hors tab bar). */
const FAVORIS_SELECTION_CTA_BLOCK_HEIGHT = verticalScale(52);

/** Hauteur totale du bandeau blanc : CTA + remplissage sous la tab bar flottante. */
function favorisSelectionBarHeight(insetsBottom: number): number {
  return FAVORIS_SELECTION_CTA_BLOCK_HEIGHT + tabBarFloatingBottomInset(insetsBottom);
}

/** Bandeau CTA seul (tab bar masquée — flux spread livre → favoris). */
function favorisBookAddFlowBarHeight(insetsBottom: number): number {
  return FAVORIS_SELECTION_CTA_BLOCK_HEIGHT + Math.max(0, insetsBottom);
}

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

type GalleryTileProps = {
  item: FavListItem;
  tileSize: number;
  selectionMode: boolean;
  isSelected: boolean;
  /** Encoche verte : souvenir déjà présent dans le livre cible (flux spread → favoris). */
  isAlreadyInTargetBook: boolean;
  onOpen: (memoryId: string) => void;
  onToggleSelect: (key: string) => void;
};

function galleryTilePropsEqual(a: GalleryTileProps, b: GalleryTileProps): boolean {
  return (
    a.item.key === b.item.key &&
    a.item.kind === b.item.kind &&
    a.item.favPhotoOriginalUrl === b.item.favPhotoOriginalUrl &&
    a.item.thumbUrl === b.item.thumbUrl &&
    a.item.memory.id === b.item.memory.id &&
    a.item.memory.type === b.item.memory.type &&
    a.item.memory.content === b.item.memory.content &&
    a.item.memory.thumb_url === b.item.memory.thumb_url &&
    a.item.memory.display_url === b.item.memory.display_url &&
    a.item.memory.poster_url === b.item.memory.poster_url &&
    a.item.memory.thumbnail_url === b.item.memory.thumbnail_url &&
    a.item.memory.voice_cover_url === b.item.memory.voice_cover_url &&
    (a.item.memory.voice_cover_path ?? '') === (b.item.memory.voice_cover_path ?? '') &&
    a.tileSize === b.tileSize &&
    a.selectionMode === b.selectionMode &&
    a.isSelected === b.isSelected &&
    a.isAlreadyInTargetBook === b.isAlreadyInTargetBook &&
    a.onOpen === b.onOpen &&
    a.onToggleSelect === b.onToggleSelect
  );
}

const GalleryTile = memo(function GalleryTile({
  item,
  tileSize,
  selectionMode,
  isSelected,
  isAlreadyInTargetBook,
  onOpen,
  onToggleSelect,
}: GalleryTileProps) {
  const memoryTextFont = useMemoryTextFont();
  const { memory, thumbUrl } = item;
  const feedPhotoUrls = useFeedPhotoDisplayUrls(memory);

  let photoUri = '';
  if (memory.type === 'photo') {
    if (item.kind === 'photo' && item.favPhotoOriginalUrl) {
      const slots = getAllPhotoUrlsForFeed(memory);
      const fav = item.favPhotoOriginalUrl;
      const idx = slots.findIndex(
        u => normalizePhotoUrlForCompare(u) === normalizePhotoUrlForCompare(fav)
      );
      photoUri = ((idx >= 0 ? feedPhotoUrls[idx] : '') ?? '').trim() || thumbUrl.trim();
    } else {
      photoUri = feedPhotoUrls[0]?.trim() || thumbUrl.trim();
    }
  }

  const videoPosterRaw = memory.type === 'video' ? feedVideoPosterRaw(memory) : '';
  const voiceCoverRaw = memory.type === 'voice' ? feedVoiceCoverRaw(memory) : '';

  const videoPosterSigned = useSignedMediaUrl(memory.type === 'video' ? videoPosterRaw || null : null);
  const voiceCoverSigned = useSignedMediaUrl(memory.type === 'voice' ? voiceCoverRaw || null : null);

  const videoPosterUri =
    memory.type === 'video'
      ? normalizeMemoryMediaUriForDisplay((videoPosterSigned ?? videoPosterRaw).trim())
      : '';
  const voiceCoverUri =
    memory.type === 'voice'
      ? normalizeMemoryMediaUriForDisplay((voiceCoverSigned ?? voiceCoverRaw).trim())
      : '';

  /** Comme `PhotoMosaic` / `FilMemoryRow` : pas de seconde signature sur les URLs déjà résolues par le hook photo. */
  const uri =
    memory.type === 'photo'
      ? normalizeMemoryMediaUriForDisplay(photoUri)
      : memory.type === 'video'
        ? videoPosterUri
        : memory.type === 'voice'
          ? voiceCoverUri
          : normalizeMemoryMediaUriForDisplay(thumbUrl.trim());

  const showRasterThumb =
    !!uri &&
    (memory.type === 'photo' ||
      memory.type === 'video' ||
      memory.type === 'voice');

  const isMedia = memory.type === 'photo' || memory.type === 'video';
  const isText = memory.type === 'text';
  const isAudio = memory.type === 'voice';
  const tileCaptionSnippet = galleryTileCaptionSnippet(memory);

  const scaleSv = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleSv.value }],
  }));

  const onPress = () => {
    if (selectionMode) {
      if (isAlreadyInTargetBook) return;
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
          ? isAlreadyInTargetBook
            ? 'Déjà dans le livre'
            : isSelected
              ? 'Désélectionner'
              : 'Sélectionner'
          : 'Ouvrir le souvenir en plein écran'
      }
    >
      <Reanimated.View style={[styles.galleryTileInner, animStyle]}>
        {isMedia && showRasterThumb ? (
          <>
            <ExpoImage
              source={{ uri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              cachePolicy="disk"
              recyclingKey={`${item.key}|${memory.type}|${uri.slice(0, 120)}`}
            />
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
                  style={[styles.galleryPhotoCaptionText, { fontFamily: memoryTextFont }]}
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
            {showRasterThumb ? (
              <>
                <ExpoImage
                  source={{ uri }}
                  style={StyleSheet.absoluteFillObject}
                  contentFit="cover"
                  cachePolicy="disk"
                  recyclingKey={`${item.key}|voice|${uri.slice(0, 120)}`}
                />
                <View style={styles.audioThumbScrim} pointerEvents="none" />
              </>
            ) : null}
            <View
              style={[
                styles.audioThumbContent,
                tileCaptionSnippet ? styles.audioThumbContentWithCaption : null,
              ]}
              pointerEvents="none"
            >
              <View style={styles.audioThumbPlay} pointerEvents="none">
                <Play size={scale(18)} color="#FFFFFF" fill="#FFFFFF" strokeWidth={0} />
              </View>
              <View style={styles.audioThumbWaveRow}>
                {AUDIO_WAVE_BARS.map((h, i) => (
                  <View key={i} style={[styles.audioThumbWaveBar, { height: verticalScale(h) }]} />
                ))}
              </View>
            </View>
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
                  style={[styles.galleryPhotoCaptionText, { fontFamily: memoryTextFont }]}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {tileCaptionSnippet}
                </Text>
              </View>
            ) : null}
          </View>
        ) : isText ? (
          <View style={styles.galleryPh}>
            <Text
              style={[styles.galleryTextSnippet, { fontFamily: memoryTextFont }]}
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

        {isAlreadyInTargetBook ? (
          <View style={styles.inBookNotch} pointerEvents="none">
            <Check size={scale(12)} color="#FFFFFF" strokeWidth={3} />
          </View>
        ) : null}

        {selectionMode && !isAlreadyInTargetBook ? (
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

function FavorisScreen() {
  const router = useRouter();
  const isTabFocused = useIsFocused();
  const params = useLocalSearchParams<{
    bookId?: string;
    createBookTitle?: string;
    addToBookId?: string;
  }>();
  const insets = useSafeAreaInsets();
  /** Prérempli après `hydrateTabScreensFromLocal` : pas de roue si les données locales sont déjà connues. */
  const [loading, setLoading] = useState(() => feedChildHydrationSnapshot === null);
  const [memories, setMemories] = useState<Memory[]>(() => [...feedMemoriesHydrationSnapshot]);
  const memoriesRef = useRef(memories);
  memoriesRef.current = memories;
  const [hasChild, setHasChild] = useState(() => feedChildHydrationSnapshot !== null);
  /** Pixels d’overscroll en haut (y négatif → valeur positive), suit le doigt */
  const [pullOverscrollPx, setPullOverscrollPx] = useState(0);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const galleryListRef = useRef<FlatList<FavListItem> | null>(null);
  /** Offset de scroll (UI thread) : zoom léger au pull sur le héros */
  const galleryScrollY = useSharedValue(0);
  const [bookModalVisible, setBookModalVisible] = useState(false);
  const [createBookFlowTitle, setCreateBookFlowTitle] = useState<string | null>(null);
  const [addToBookTargetId, setAddToBookTargetId] = useState<string | null>(null);

  const load = useCallback(async (opts?: { background?: boolean }) => {
    const childId = await getOrSelectFirstChild();
    if (!childId) {
      setMemories([]);
      setHasChild(false);
      setLoading(false);
      return;
    }
    setHasChild(true);

    const list = await getFamilyMemories();
    setMemories(prev => {
      if (
        prev.length === list.length &&
        prev.every(
          (m, i) =>
            m.id === list[i]?.id &&
            m.updated_at === list[i]?.updated_at &&
            m.is_favorite === list[i]?.is_favorite,
        )
      ) {
        return prev;
      }
      return list;
    });
    void requestMissingMediaDerivatives(list);
    setLoading(false);
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setAddToBookTargetId(null);
    clearPendingFavorisAddToBookId();
    clearFavorisAddToBookSession();
  }, []);

  const applyAddToBookIntent = useCallback((bookId: string) => {
    const id = bookId.trim();
    if (!id) return;
    setAddToBookTargetId(id);
    setFavorisAddToBookSession(id);
    setCreateBookFlowTitle(null);
    setSelectionMode(true);
    setSelectedIds(new Set());
  }, []);

  const handleExitSelection = useCallback(() => {
    const returnBookId = addToBookTargetId;
    exitSelection();
    if (returnBookId) {
      router.replace({ pathname: '/book-preview', params: { bookId: returnBookId } });
    }
  }, [addToBookTargetId, exitSelection, router]);

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
      const pendingBookId = consumePendingFavorisAddToBookId();
      if (pendingBookId) {
        applyAddToBookIntent(pendingBookId);
      }

      setStatusBarStyle('light');
      /** Déjà hydraté → resync SQLite légère (favoris modifiés depuis le fil). */
      if (memoriesRef.current.length > 0) {
        setLoading(false);
        void load({ background: true });
        return () => {
          setPullOverscrollPx(0);
          galleryScrollY.value = 0;
          setSelectionMode(false);
          setSelectedIds(new Set());
          setAddToBookTargetId(null);
          clearFavorisAddToBookSession();
        };
      }

      const hasCached =
        feedMemoriesHydrationSnapshot.length > 0 || feedChildHydrationSnapshot !== null;
      if (hasCached) {
        if (feedMemoriesHydrationSnapshot.length > 0) {
          setMemories([...feedMemoriesHydrationSnapshot]);
        }
        setHasChild(feedChildHydrationSnapshot !== null);
        setLoading(false);
        void load({ background: true });
      } else {
        void load();
      }
      return () => {
        setPullOverscrollPx(0);
        galleryScrollY.value = 0;
        setSelectionMode(false);
        setSelectedIds(new Set());
        setAddToBookTargetId(null);
        clearFavorisAddToBookSession();
      };
    }, [applyAddToBookIntent, load])
  );

  useEffect(() => {
    const subInvalidate = DeviceEventEmitter.addListener('petitmo:memories-invalidate', () => {
      void load();
    });
    const subUpdated = DeviceEventEmitter.addListener('petitmo:memories-updated', (payload: unknown) => {
      const memoryId =
        payload &&
        typeof payload === 'object' &&
        payload !== null &&
        'memoryId' in payload &&
        typeof (payload as { memoryId?: unknown }).memoryId === 'string'
          ? (payload as { memoryId: string }).memoryId.trim()
          : '';
      if (memoryId) {
        const row = getLocalMemoryById(memoryId);
        if (row) {
          setMemories(prev => {
            const idx = prev.findIndex(m => m.id === memoryId);
            if (idx < 0) return prev;
            const next = [...prev];
            next[idx] = row;
            return next;
          });
          return;
        }
      }
      void load({ background: true });
    });
    return () => {
      subInvalidate.remove();
      subUpdated.remove();
    };
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
    setAddToBookTargetId(null);
    // Auto: passer en mode sélection.
    setSelectionMode(true);
    setSelectedIds(new Set());
    // Nettoyage params non critique (on évite des loops en restant minimaliste).
  }, [params.createBookTitle]);

  useEffect(() => {
    const id = typeof params.addToBookId === 'string' ? params.addToBookId.trim() : '';
    if (!id) return;
    applyAddToBookIntent(id);
  }, [applyAddToBookIntent, params.addToBookId]);

  const favoriteItems = useMemo(() => buildFavoriteItems(memories), [memories]);

  const galleryItems = useMemo(() => favoriteItems, [favoriteItems]);

  const addToBookMemoryIdSet = useMemo(() => {
    if (!addToBookTargetId) return null;
    const book = getLocalBook(addToBookTargetId);
    return new Set(book?.memoryIds ?? []);
  }, [addToBookTargetId, memories]);

  const selectedMemoryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const it of galleryItems) {
      if (selectedIds.has(it.key)) ids.add(it.memory.id);
    }
    return [...ids];
  }, [galleryItems, selectedIds]);

  const slideshowItems = useMemo(() => buildSlideshowItems(galleryItems), [galleryItems]);

  /** Icônes claires sur le hero sombre : seulement quand cet onglet est au premier plan (pas sous memory-view / autre stack). */
  useEffect(() => {
    if (!isTabFocused || loading) return;
    setStatusBarStyle('light');
  }, [loading, isTabFocused]);

  const columns = 3;
  const gridGap = GALLERY_TILE_GAP;
  const tileSize = Math.floor((SCREEN_W - gridGap * (columns - 1)) / columns);
  const heroBaseH = slideshowItems.length > 0 ? SCREEN_H * HERO_BASE_RATIO : 0;
  const heroBonusH =
    slideshowItems.length > 0
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

  const isBookAddFromSpreadFlow = addToBookTargetId != null;
  const showSelectionBottomBar =
    isBookAddFromSpreadFlow || (selectionMode && selectedIds.size > 0);

  const galleryListPaddingBottom = useMemo(() => {
    const extra = verticalScale(6);
    if (isBookAddFromSpreadFlow) {
      return favorisBookAddFlowBarHeight(insets.bottom) + extra;
    }
    if (selectionMode && selectedIds.size > 0) {
      return favorisSelectionBarHeight(insets.bottom) + extra;
    }
    return tabBarFloatingOverlapPad(insets.bottom) + extra;
  }, [insets.bottom, isBookAddFromSpreadFlow, selectionMode, selectedIds.size]);

  const handleConfirmSelectionAction = useCallback(async () => {
    if (selectedMemoryIds.length === 0) return;

    if (createBookFlowTitle) {
      const created = await createBook(createBookFlowTitle);
      let updated = null;
      try {
        updated = await addMemoriesToBook(created.id, selectedMemoryIds);
      } catch (e) {
        if (e instanceof BookUpgradeRequiredError) {
          Alert.alert(
            'Petitmo+',
            'Pour pouvoir ajouter une vidéo dans le livre et la revoir à tout moment grâce au QR Code, passer à Petitmo+.',
            [
              {
                text: 'Annuler',
                style: 'cancel',
                onPress: () => {
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    for (const it of galleryItems) {
                      if (!next.has(it.key)) continue;
                      if (it.memory.type === 'video') next.delete(it.key);
                    }
                    return next;
                  });
                },
              },
              {
                text: 'Passer à Petitmo+',
                style: 'default',
                onPress: () =>
                  router.push({ pathname: '/paywall', params: { context: 'BOOK_VIDEO' } }),
              },
            ],
          );
          return;
        }
        Alert.alert('Petitmo', e instanceof Error ? e.message : "Impossible d'ajouter à ce livre.");
        return;
      }
      if (!updated) {
        Alert.alert('Petitmo', 'Livre introuvable.');
        return;
      }
      for (const id of selectedMemoryIds) {
        const m = getLocalMemoryById(id);
        if (!m || m.type !== 'photo') continue;
        const src = canonicalBookCoverPhotoRef(m).trim();
        if (src) {
          await upsertBook({ ...updated, coverPhotoUrl: src });
        }
        break;
      }
      setCreateBookFlowTitle(null);
      exitSelection();
      router.push({ pathname: '/book-preview', params: { bookId: created.id } });
      return;
    }

    if (addToBookTargetId) {
      const targetId = addToBookTargetId;
      const book = getLocalBook(targetId);
      const inBook = new Set(book?.memoryIds ?? []);
      const idsToAdd = dedupeMemoryIds(selectedMemoryIds.filter(id => !inBook.has(id)));
      if (idsToAdd.length === 0) {
        Alert.alert('Petitmo', 'Ces souvenirs sont déjà dans le livre.');
        return;
      }
      try {
        const updated = await addMemoriesToBook(targetId, idsToAdd);
        if (!updated) {
          Alert.alert('Petitmo', 'Livre introuvable.');
          return;
        }
      } catch (e) {
        if (e instanceof BookUpgradeRequiredError) {
          Alert.alert(
            'Petitmo+',
            'Pour pouvoir ajouter une vidéo dans le livre et la revoir à tout moment grâce au QR Code, passer à Petitmo+.',
            [
              {
                text: 'Annuler',
                style: 'cancel',
                onPress: () => {
                  setSelectedIds(prev => {
                    const next = new Set(prev);
                    for (const it of galleryItems) {
                      if (!next.has(it.key)) continue;
                      if (it.memory.type === 'video') next.delete(it.key);
                    }
                    return next;
                  });
                },
              },
              {
                text: 'Passer à Petitmo+',
                style: 'default',
                onPress: () =>
                  router.push({ pathname: '/paywall', params: { context: 'BOOK_VIDEO' } }),
              },
            ],
          );
          return;
        }
        Alert.alert('Petitmo', e instanceof Error ? e.message : "Impossible d'ajouter à ce livre.");
        return;
      }
      exitSelection();
      router.replace({ pathname: '/book-preview', params: { bookId: targetId } });
      return;
    }

    setBookModalVisible(true);
  }, [
    addToBookTargetId,
    createBookFlowTitle,
    exitSelection,
    galleryItems,
    router,
    selectedMemoryIds,
  ]);

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
        selectionMode={selectionMode}
        isSelected={selectedIds.has(item.key)}
        isAlreadyInTargetBook={
          addToBookMemoryIdSet != null && addToBookMemoryIdSet.has(item.memory.id)
        }
        onOpen={openMemory}
        onToggleSelect={toggleSelection}
      />
    ),
    [tileSize, selectionMode, selectedIds, addToBookMemoryIdSet, openMemory, toggleSelection]
  );

  const favoritesListHeader = useMemo(() => {
    if (slideshowItems.length === 0) return null;
    return (
      <HeroSlideshowListHeader
        scrollY={galleryScrollY}
        slideshowItems={slideshowItems}
        heroHeight={heroHeight}
        isTabFocused={isTabFocused}
      />
    );
  }, [slideshowItems, heroHeight, isTabFocused]);

  return (
    <View style={styles.container}>
      {isTabFocused ? <StatusBar style="light" /> : null}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={THEME.brandCtaOrange} />
        </View>
      ) : !hasChild ? (
        <View style={[styles.centered, styles.noChildPad]}>
          <Text style={styles.noChildTitle}>Aucun profil enfant</Text>
          <Text style={styles.noChildSub}>
            Crée un profil pour enregistrer des souvenirs et des favoris.
          </Text>
          <TouchableOpacity
            style={[petitmoCtaStyles.primary, styles.noChildCta]}
            onPress={() => router.push('/create-child')}
            activeOpacity={0.85}
          >
            <Text style={[petitmoCtaStyles.primaryText, styles.noChildCtaText]}>Créer un profil</Text>
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
            <View style={styles.galleryShell}>
              <FlatList
                ref={galleryListRef}
                data={galleryItems}
                keyExtractor={(it) => it.key}
                renderItem={renderGalleryItem}
                numColumns={columns}
                columnWrapperStyle={styles.galleryRow}
                contentContainerStyle={[
                  styles.galleryContent,
                  { paddingBottom: galleryListPaddingBottom },
                ]}
                style={styles.gallery}
                showsVerticalScrollIndicator={false}
                scrollEventThrottle={16}
                ListHeaderComponent={favoritesListHeader}
                extraData={{ heroHeight, selectionMode, selectionHeaderTitle, addToBookTargetId }}
                onScroll={e => {
                  const y = e.nativeEvent.contentOffset.y;
                  galleryScrollY.value = y;
                  setPullOverscrollPx(
                    y < 0 ? Math.min(-y, SLIDESHOW_PULL_MAX_PX) : 0
                  );
                }}
                {...Platform.select({
                  android: { overScrollMode: 'always' as const },
                })}
              />
              {/** Titre + Sélectionner au-dessus du scroll : ne réserve plus de hauteur — la photo du header va jusqu’en haut. */}
              <FavorisFixedTopChrome
                insetTop={insets.top}
                gradientHeight={heroGradientHeight}
                selectionMode={selectionMode}
                bookAddFromSpreadFlow={isBookAddFromSpreadFlow}
                selectionHeaderTitle={selectionHeaderTitle}
                onExitSelection={handleExitSelection}
                onEnterSelection={enterSelectionMode}
              />
            </View>
          )}

          {showSelectionBottomBar ? (
            <Reanimated.View
              entering={SlideInDown.duration(280)}
              exiting={SlideOutDown.duration(200)}
              style={[
                styles.selectionActionBar,
                {
                  paddingBottom: isBookAddFromSpreadFlow
                    ? Math.max(0, insets.bottom)
                    : tabBarFloatingBottomInset(insets.bottom),
                },
              ]}
            >
              {isBookAddFromSpreadFlow && selectedIds.size === 0 ? (
                <TouchableOpacity
                  style={[styles.selectionActionBtn, styles.selectionActionBtnOutline]}
                  activeOpacity={0.9}
                  onPress={handleExitSelection}
                  accessibilityRole="button"
                  accessibilityLabel="Annuler et retourner au livre"
                >
                  <Text style={[styles.selectionActionBtnText, styles.selectionActionBtnOutlineText]}>
                    Annuler
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.selectionActionBtn}
                  activeOpacity={0.9}
                  onPress={handleConfirmSelectionAction}
                  accessibilityRole="button"
                  accessibilityLabel={
                    isBookAddFromSpreadFlow ? 'Ajouter au livre' : 'Ajouter au livre'
                  }
                >
                  <Text style={styles.selectionActionBtnText}>
                    {createBookFlowTitle
                      ? `Créer « ${createBookFlowTitle} » →`
                      : isBookAddFromSpreadFlow
                        ? 'Ajouter'
                        : 'Ajouter au livre →'}
                  </Text>
                </TouchableOpacity>
              )}
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

export default function FavorisScreenTab() {
  return (
    <TabSceneTransition>
      <FavorisScreen />
    </TabSceneTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  mainColumn: {
    flex: 1,
  },
  mainColumnGallery: {
    backgroundColor: THEME.bg,
  },
  mainColumnLight: {
    backgroundColor: THEME.bg,
  },
  /** Colonne liste pleine hauteur ; chrome titre en absolu par-dessus (sans bandeau réservé). */
  galleryShell: {
    flex: 1,
    minHeight: 0,
    position: 'relative',
  },
  favorisFixedTopChrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingBottom: 0,
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
    backgroundColor: THEME.bg,
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
    backgroundColor: THEME.surfaceCard,
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
    backgroundColor: THEME.bg,
  },
  galleryContent: {
    paddingTop: 0,
    paddingBottom: verticalScale(6),
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
    backgroundColor: '#5799FC',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  /** Encoche verte coin supérieur droit — souvenir déjà dans le livre cible. */
  inBookNotch: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: scale(28),
    height: scale(28),
    borderBottomLeftRadius: scale(14),
    backgroundColor: IN_BOOK_NOTCH_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    paddingLeft: scale(2),
    paddingBottom: scale(1),
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
  topChromeRowSelecting: {
    justifyContent: 'space-between',
  },
  topChromeFlex: {
    flex: 1,
  },
  topChromeRowOverGradient: {
    zIndex: 1,
  },
  topChromeSideBtn: {
    minWidth: scale(76),
    paddingVertical: verticalScale(6),
  },
  /** CTA « Sélectionner » sur le héros — fond gris translucide sur la photo. */
  topChromeSelectCta: {
    minWidth: scale(76),
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(15),
    borderRadius: scale(20),
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.38)',
  },
  topChromeSelectCtaContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(7),
  },
  topChromeSelectCtaText: {
    color: THEME.captureScreenCtaForeground,
    fontSize: scale(16),
    fontWeight: '600',
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
  /** Titre « Favoris » + cœur rosé — gardé lisible à côté de Sélectionner */
  favorisTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
    maxWidth: '58%',
    gap: scale(6),
  },
  favorisStickyTitle: {
    flexShrink: 1,
    color: '#FFFFFF',
    fontSize: scale(28),
    fontWeight: '700',
    letterSpacing: scale(-0.45),
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  favorisTitleHeart: {
    flexShrink: 0,
  },
  selectionActionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    backgroundColor: THEME.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: THEME.familyFlowLine,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingTop: verticalScale(10),
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
      },
      android: { elevation: 8 },
    }),
  },
  selectionActionBtn: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: scale(320),
    backgroundColor: THEME.brandArdoise,
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
  selectionActionBtnOutline: {
    backgroundColor: THEME.bg,
    borderWidth: 1.5,
    borderColor: THEME.brandArdoise,
  },
  selectionActionBtnOutlineText: {
    color: THEME.brandArdoise,
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
  audioThumbContentWithCaption: {
    paddingBottom: verticalScale(38),
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
  },
  galleryPhotoCaptionText: {
    fontSize: scale(11),
    lineHeight: scale(14),
    fontWeight: '400',
    color: '#FFFFFF',
    textAlign: 'left',
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 0.5 },
    textShadowRadius: 3,
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
    paddingHorizontal: SPACING.xl,
    paddingVertical: verticalScale(12),
  },
  noChildCtaText: {
    fontSize: FONT_SIZES.md,
  },

  // (Menu horizontal supprimé)
});
