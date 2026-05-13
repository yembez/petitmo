import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  Animated,
  Easing,
  Dimensions,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
  DeviceEventEmitter,
  PanResponder,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets, useSafeAreaFrame } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Heart, Menu } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useFonts, DMSans_400Regular, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import { tabBarFloatingOverlapPad } from '@/constants/tabBarLayout';
import {
  cacheRemoteChildProfilePhotoLocally,
  getChildren,
  getOrSelectFirstChild,
  getCaptureTabChildSnapshot,
  PETITMO_CHILD_PROFILE_UPDATED_EVENT,
  sanitizeChildLocalAvatarIfMissing,
  setCaptureTabChildSnapshot,
} from '@/services/children';
import type { Child } from '@/types/local';
import PetitmoLogoManuscrit, { PETITMO_LOGO_VIEWBOX } from '@/components/PetitmoLogoManuscrit';
import ImageImportIcon from '@/components/ImageImportIcon';
import MicIcon from '@/components/MicIcon';
import PenIcon from '@/components/PenIcon';
import { checkMemoryLimit } from '@/lib/limits';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { resolveChildProfileImageDisplayUri } from '@/utils/childPhotoUri';
import { CAPTURE_HERO_COLOR_MATRIX } from '@/utils/captureHeroColorMatrix';
import {
  computeCaptureHeroCardInnerPhotoSize,
  computeCaptureHeroPhotoViewport,
} from '@/utils/captureHeroMetrics';
import { ColorMatrix } from 'react-native-color-matrix-image-filters';

const { width: SCREEN_W } = Dimensions.get('window');

const CHARTE = {
  bg: '#FBFAF7',
  eyebrow: '#C4784A',
  textPrimary: '#1C1C1E',
  textMuted: '#8E8E93',
  terracotta: '#D4784A',
} as const;

/**
 * Bloc bas Capturer (titres + CTA) + fondu — brun foncé (contraste texte clair).
 */
const CAPTURE_BOTTOM_BG = '#2f271e';
const CAPTURE_BOTTOM_BG_RGB = '47, 39, 30';

/** Texte sur fond brun foncé. */
const CAPTURE_ON_SOIL_TITLE = '#FAF6F2';
const CAPTURE_ON_SOIL_SUBTITLE = 'rgba(250, 246, 242, 0.72)';
const CAPTURE_ON_SOIL_ACCENT = THEME.captureCtaSoftTerracotta;

/** Fondu bas de la photo → même brun que le bloc CTA. */
const HERO_FADE_TO_BG = [
  `rgba(${CAPTURE_BOTTOM_BG_RGB},0)`,
  `rgba(${CAPTURE_BOTTOM_BG_RGB},0.28)`,
  `rgba(${CAPTURE_BOTTOM_BG_RGB},0.58)`,
  `rgba(${CAPTURE_BOTTOM_BG_RGB},0.88)`,
  `rgba(${CAPTURE_BOTTOM_BG_RGB},0.97)`,
  CAPTURE_BOTTOM_BG,
] as const;

/**
 * Voile doux sur la photo (léger, compatible brun en bas).
 */
const HERO_OPTICAL_SOFTNESS = [
  'rgba(208, 98, 53, 0.04)',
  'rgba(255, 248, 242, 0.02)',
  'rgba(47, 39, 30, 0.08)',
] as const;

/** Marge latérale autour de la carte (0 = plein écran horizontal). */
const CAPTURE_CARD_MARGIN_H = 0;

/**
 * Décale le bandeau logo + menu (vue absolue). Valeur plus basse = bandeau plus haut sur l’écran.
 */
const CAPTURE_HEADER_LOGO_MENU_TRANSLATE_Y = verticalScale(8);

/**
 * Hauteur minimale réservée sous la photo (prénom + titre + sous-titre + 3 CTA + libellés sous les icônes).
 * Trop bas → le hero prend trop de place et `overflow: hidden` sur la carte rogne le bas (libellés CTA).
 */
const CAPTURE_CARD_FOOTER_RESERVE = verticalScale(276);

/**
 * Chevauchement du bloc texte (prénom + titre) sur le bas de la photo / dégradé.
 * Plus petit = un peu plus de photo visible en bas avant le texte.
 */
const CAPTURE_TITLE_PHOTO_OVERLAP = verticalScale(46);

/**
 * Descend d’un seul tenant le bloc prénom + titre + sous-titre + CTA (sans modifier couleurs / photo).
 */
const CAPTURE_FOOTER_BLOCK_OFFSET_DOWN = verticalScale(34);

/**
 * Décalage vertical du **bloc overlay** titres + CTA uniquement (`captureTitleCtaOverlay` / `top`).
 * Plus négatif = bloc plus haut. N’impacte pas `captureHeroBrownFadeLayout` (dégradé), ni le fond sous le hero.
 */
const CAPTURE_TITLE_CTA_BLOCK_EXTRA_MARGIN_TOP = -verticalScale(80);

/** Zoom « respiration » sur le hero (1 → max). ~3 % reste discret sur le rognage `overflow: hidden` ; cycle un peu plus court pour que le mouvement se lise. */
const CAPTURE_HERO_BREATHE_MIN = 1;
const CAPTURE_HERO_BREATHE_MAX = 1.03;
const CAPTURE_HERO_BREATHE_HALF_MS = 8500;

/**
 * Hauteur minimale du bandeau marron (mêmes stops) si l’alignement titre laisse peu de pixels.
 */
const CAPTURE_HERO_BROWN_FADE_MIN_BAND = verticalScale(160);

/** Glissade max du bandeau dégradé (`translateY`) ; photo et bloc titres + CTA inchangés. */
const CAPTURE_GRADIENT_SLIDE_MAX = verticalScale(88);
/** Bande tactile en bas du fondu : le reste du dégradé laisse passer les taps vers la photo. */
const CAPTURE_GRADIENT_DRAG_STRIP_H = verticalScale(36);

type CaptureRoute = '/write' | '/record-voice' | '/import-media';

function CaptureActionCard({
  Icon,
  customIcon,
  title,
  iconBackground,
  foregroundColor = CHARTE.textPrimary,
  onPress,
}: {
  Icon?: LucideIcon;
  /** Remplace `Icon` (ex. asset SVG) ; reçoit la même taille / couleur que les Lucide. */
  customIcon?: (p: { color: string; size: number }) => React.ReactNode;
  title: string;
  iconBackground: string;
  /** Couleur de l’icône. */
  foregroundColor?: string;
  onPress: () => void;
}) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const pressOpacity = useRef(new Animated.Value(1)).current;
  const iconSize = scale(28);

  const runPressIn = useCallback(() => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Animated.parallel([
      Animated.spring(pressScale, {
        toValue: 0.91,
        useNativeDriver: true,
        friction: 5,
        tension: 340,
      }),
      Animated.timing(pressOpacity, {
        toValue: 0.88,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start();
  }, [pressOpacity, pressScale]);

  const runPressOut = useCallback(() => {
    Animated.parallel([
      Animated.spring(pressScale, {
        toValue: 1,
        useNativeDriver: true,
        friction: 4,
        tension: 220,
      }),
      Animated.spring(pressOpacity, {
        toValue: 1,
        useNativeDriver: true,
        friction: 6,
        tension: 140,
      }),
    ]).start();
  }, [pressOpacity, pressScale]);

  return (
    <View style={styles.actionCardWrap}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        onPressIn={runPressIn}
        onPressOut={runPressOut}
        style={styles.captureCtaColumn}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <Animated.View
          style={{
            alignItems: 'center',
            transform: [{ scale: pressScale }],
            opacity: pressOpacity,
          }}
        >
          <View style={[styles.actionCard, { backgroundColor: iconBackground }]}>
            {customIcon ? (
              customIcon({ color: foregroundColor, size: iconSize })
            ) : Icon ? (
              <Icon color={foregroundColor} size={iconSize} strokeWidth={2} />
            ) : null}
          </View>
          <Text style={styles.captureCtaLabel}>{title}</Text>
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

export default function CapturerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const { width: windowW, height: windowH } = useWindowDimensions();

  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });
  const dmSans700 = fontsLoaded ? 'DMSans_700Bold' : undefined;
  const dmSans = fontsLoaded ? 'DMSans_400Regular' : undefined;
  const dmSans600 = fontsLoaded ? 'DMSans_600SemiBold' : undefined;

  const usableH = Math.max(280, windowH);
  const layoutH = Math.min(frame.height > 1 ? frame.height : usableH, usableH);
  const compact = layoutH < 600;
  const captureHeroViewport = useMemo(
    () => computeCaptureHeroPhotoViewport(frame.height, windowH, windowW, insets.top),
    [frame.height, insets.top, windowH, windowW],
  );
  const heroCardPhotoSize = useMemo(
    () => computeCaptureHeroCardInnerPhotoSize(captureHeroViewport, CAPTURE_CARD_MARGIN_H),
    [captureHeroViewport],
  );

  const [captureCardLayoutHeight, setCaptureCardLayoutHeight] = useState(0);
  /**
   * Hauteur max du hero = `cardH - reserve`. Deux sources :
   * - `layoutH` (safe frame / onglet) ;
   * - `captureCardLayoutHeight` (mesure du flex sur la carte).
   * Au cold start, la mesure peut **dépasser** `layoutH` → hero trop haut → bloc titres + CTA trop bas.
   * On prend **le minimum** des deux plafonds pour rester aligné sur le budget réel de l’onglet.
   */
  const heroInCardHeight = useMemo(() => {
    const reserve = CAPTURE_CARD_FOOTER_RESERVE;
    const maxFromFrame = Math.max(verticalScale(72), layoutH - reserve);
    const maxFromMeasure =
      captureCardLayoutHeight > 0
        ? Math.max(verticalScale(72), captureCardLayoutHeight - reserve)
        : Number.POSITIVE_INFINITY;
    const maxHero = Math.min(maxFromFrame, maxFromMeasure);
    return Math.min(heroCardPhotoSize.height, maxHero);
  }, [captureCardLayoutHeight, heroCardPhotoSize.height, layoutH]);

  /** Fondu marron : calque carte, bord haut du hero = bord haut carte (photo non scrollable). */
  const captureHeroBrownFadeLayout = useMemo(() => {
    const H = heroInCardHeight;
    const titleBandTop = H - CAPTURE_TITLE_PHOTO_OVERLAP + CAPTURE_FOOTER_BLOCK_OFFSET_DOWN;
    const naturalH = Math.max(0, H - titleBandTop);
    const bandH = Math.max(naturalH, CAPTURE_HERO_BROWN_FADE_MIN_BAND);
    const top = H - bandH;
    return { top, height: bandH };
  }, [heroInCardHeight]);

  /** Titres + CTA en overlay (z au-dessus du dégradé) ; `top` indépendant du flux flex sous le hero. */
  const captureTitleCtaOverlayTop = useMemo(() => {
    const H = heroInCardHeight;
    return (
      H -
      CAPTURE_TITLE_PHOTO_OVERLAP +
      CAPTURE_FOOTER_BLOCK_OFFSET_DOWN +
      CAPTURE_TITLE_CTA_BLOCK_EXTRA_MARGIN_TOP
    );
  }, [heroInCardHeight]);

  const [child, setChild] = useState<Child | null>(() => getCaptureTabChildSnapshot());
  const [isLoading, setIsLoading] = useState(() => getCaptureTabChildSnapshot() === null);
  const childRef = useRef<Child | null>(null);
  childRef.current = child;

  const [gradientSlideY, setGradientSlideY] = useState(0);
  const gradientSlideYRef = useRef(0);
  const gradientDragGrantY = useRef(0);

  useEffect(() => {
    gradientSlideYRef.current = 0;
    setGradientSlideY(0);
  }, [heroInCardHeight, child?.id]);

  const gradientFadePan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > Math.abs(g.dx) && Math.abs(g.dy) > 5,
      onPanResponderGrant: () => {
        gradientDragGrantY.current = gradientSlideYRef.current;
      },
      onPanResponderMove: (_, g) => {
        const y = Math.max(
          0,
          Math.min(CAPTURE_GRADIENT_SLIDE_MAX, gradientDragGrantY.current + g.dy),
        );
        gradientSlideYRef.current = y;
        setGradientSlideY(y);
      },
      onPanResponderRelease: (_, g) => {
        const y = Math.max(
          0,
          Math.min(CAPTURE_GRADIENT_SLIDE_MAX, gradientDragGrantY.current + g.dy),
        );
        gradientSlideYRef.current = y;
        setGradientSlideY(y);
      },
    }),
  ).current;

  useEffect(() => {
    setCaptureTabChildSnapshot(child);
  }, [child]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      PETITMO_CHILD_PROFILE_UPDATED_EVENT,
      (payload: { childId: string }) => {
        void (async () => {
          const id = payload?.childId?.trim();
          if (!id || childRef.current?.id !== id) return;
          try {
            const all = await getChildren();
            const row = all.find(c => c.id === id);
            if (!row) return;
            const cleaned = await sanitizeChildLocalAvatarIfMissing(row);
            setChild(cleaned);
            if (cleaned.photo_url?.trim() && !cleaned.local_photo_path?.trim()) {
              void cacheRemoteChildProfilePhotoLocally(cleaned).then(refreshed => {
                if (refreshed.local_photo_path?.trim()) {
                  setChild(refreshed);
                }
              });
            }
          } catch (e) {
            console.error('Capture: refresh profil enfant', e);
          }
        })();
      }
    );
    return () => sub.remove();
  }, []);

  const activeOpacity = useRef(new Animated.Value(1)).current;
  const activeTranslateY = useRef(new Animated.Value(0)).current;

  const handleCaptureCtaPress = useCallback(
    (route: CaptureRoute) => {
      void (async () => {
        const childId = childRef.current?.id;
        if (!childId) {
          router.push(route);
          return;
        }

        const limitCheck = await checkMemoryLimit(childId);
        if (!limitCheck.canCreate) {
          router.push({ pathname: '/paywall', params: { context: 'LIMIT_REACHED' } });
          return;
        }

        router.push(route);
      })();
    },
    [router]
  );

  const openEditChild = useCallback(() => {
    if (child?.id) router.push(`/edit-child?childId=${child.id}`);
  }, [child?.id, router]);

  useEffect(() => {
    activeOpacity.setValue(0.92);
    activeTranslateY.setValue(4);
    Animated.parallel([
      Animated.timing(activeOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(activeTranslateY, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [child?.id, activeOpacity, activeTranslateY]);

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('light');

      let cancelled = false;

      const run = async () => {
        const silent = childRef.current != null;
        try {
          if (!silent) setIsLoading(true);
          const storedSelectedId = await getOrSelectFirstChild();
          const allChildren = await getChildren();
          if (cancelled) return;

          if (storedSelectedId && allChildren.length > 0) {
            const selected = allChildren.find(c => c.id === storedSelectedId) ?? allChildren[0];
            const cleaned = await sanitizeChildLocalAvatarIfMissing(selected);
            setChild(cleaned);
            if (cleaned.photo_url?.trim() && !cleaned.local_photo_path?.trim()) {
              void cacheRemoteChildProfilePhotoLocally(cleaned).then(refreshed => {
                if (!cancelled && refreshed.local_photo_path?.trim()) {
                  setChild(refreshed);
                }
              });
            }
          } else if (allChildren.length === 0) {
            setChild(null);
            router.push('/create-child');
          } else {
            const first = allChildren[0];
            const cleaned = await sanitizeChildLocalAvatarIfMissing(first);
            setChild(cleaned);
            if (cleaned.photo_url?.trim() && !cleaned.local_photo_path?.trim()) {
              void cacheRemoteChildProfilePhotoLocally(cleaned).then(refreshed => {
                if (!cancelled && refreshed.local_photo_path?.trim()) {
                  setChild(refreshed);
                }
              });
            }
          }
        } catch (error) {
          console.error('Error loading child:', error);
        } finally {
          if (!silent && !cancelled) setIsLoading(false);
        }
      };

      run();

      return () => {
        cancelled = true;
        setStatusBarStyle('dark');
      };
    }, [router])
  );

  if (isLoading) {
    return (
      <View style={[styles.root, styles.loadingContainer]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={CAPTURE_ON_SOIL_ACCENT} />
      </View>
    );
  }

  if (!child) {
    return (
      <View style={[styles.root, styles.loadingContainer]}>
        <StatusBar style="dark" />
        <TouchableOpacity onPress={() => router.push('/create-child')} activeOpacity={0.85}>
          <Text style={styles.ctaGhostText}>Créer un profil enfant</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const heroRawUri =
    resolveChildProfileImageDisplayUri(
      child.local_photo_path,
      child.photo_url,
      child.updated_at,
    ) ?? null;
  const heroIsLocalAsset =
    !!heroRawUri &&
    (heroRawUri.startsWith('file:') ||
      heroRawUri.startsWith('content:') ||
      heroRawUri.startsWith('ph://') ||
      (!heroRawUri.startsWith('http://') && !heroRawUri.startsWith('https://')));
  const heroSignedRemote = useSignedMediaUrl(heroRawUri && !heroIsLocalAsset ? heroRawUri : null);
  const photoUri = heroRawUri ? (heroIsLocalAsset ? heroRawUri : heroSignedRemote ?? heroRawUri) : '';

  const captureLogoH = scale(34);
  const captureLogoW = captureLogoH * (PETITMO_LOGO_VIEWBOX.width / PETITMO_LOGO_VIEWBOX.height);
  const headerMenuIconSize = scale(22);
  const ctaBottomOffset = verticalScale(compact ? 8 : 12);
  /** Espace sous les libellés CTA + tab bar flottante (contenu ne passe pas sous les onglets). */
  const captureScrollBottomPad =
    ctaBottomOffset + verticalScale(22) + tabBarFloatingOverlapPad(insets.bottom);
  const childFirstName =
    child.name.trim().split(/\s+/).filter(Boolean)[0] ?? child.name.trim();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <Animated.View
        style={[
          styles.mainColumn,
          {
            opacity: activeOpacity,
            transform: [{ translateY: activeTranslateY }],
          },
        ]}
      >
        {/*
          Ne pas utiliser marginTop négatif (safe area) : la scène onglet clippe le haut —
          une partie du hero disparaissait hors écran.
        */}
        <ScrollView
          style={styles.captureScrollView}
          contentContainerStyle={[styles.captureScrollContent, { minHeight: layoutH }]}
          showsVerticalScrollIndicator={false}
          bounces
          alwaysBounceVertical={Platform.OS === 'ios'}
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={32}
        >
        <View style={[styles.captureCardWrap, { minHeight: layoutH }]}>
          <View
            style={styles.captureCard}
            onLayout={e => {
              const next = Math.round(e.nativeEvent.layout.height);
              setCaptureCardLayoutHeight(prev => (prev === next ? prev : next));
            }}
          >
            <View
              style={[
                styles.captureCardHeader,
                {
                  paddingTop: insets.top + verticalScale(4),
                  transform: [{ translateY: CAPTURE_HEADER_LOGO_MENU_TRANSLATE_Y }],
                },
              ]}
              pointerEvents="box-none"
            >
              <PetitmoLogoManuscrit
                width={captureLogoW}
                height={captureLogoH}
                color="#FFFFFF"
                shadow
              />
              <TouchableOpacity
                style={styles.captureHeaderMenuHit}
                onPress={() => router.push('/parent-space')}
                activeOpacity={0.72}
                accessibilityRole="button"
                accessibilityLabel="Menu"
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Menu size={headerMenuIconSize} color="#FFFFFF" strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <View style={[styles.captureCardHero, { height: heroInCardHeight }]}>
              <TouchableOpacity
                activeOpacity={0.92}
                onPress={openEditChild}
                style={StyleSheet.absoluteFillObject}
                accessibilityRole="button"
                accessibilityLabel="Modifier le profil de l'enfant"
              >
                {photoUri ? (
                  <CaptureHeroImageStack
                    photoUri={photoUri}
                    reactKey={`capture-hero-${child.id}-${child.updated_at}`}
                  />
                ) : (
                  <View style={[StyleSheet.absoluteFillObject, styles.heroPlaceholder]}>
                    <Text style={styles.heroPlaceholderText}>{child.name.charAt(0).toUpperCase()}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>

            <View
              pointerEvents="box-none"
              style={[
                styles.captureHeroBrownFadeWrap,
                {
                  top: captureHeroBrownFadeLayout.top,
                  height: captureHeroBrownFadeLayout.height,
                  transform: [{ translateY: gradientSlideY }],
                },
              ]}
            >
              <LinearGradient
                colors={[...HERO_FADE_TO_BG]}
                locations={[0, 0.12, 0.38, 0.62, 0.82, 1]}
                pointerEvents="none"
                style={StyleSheet.absoluteFillObject}
              />
              <View
                collapsable={false}
                style={styles.captureHeroGradientDragStrip}
                {...gradientFadePan.panHandlers}
                accessibilityRole="adjustable"
                accessibilityLabel="Glisser pour déplacer le fondu sur la photo"
              />
            </View>

            <View style={styles.captureCardBelowHeroFill} />

            <View
              pointerEvents="box-none"
              style={[
                styles.captureTitleCtaOverlay,
                {
                  top: captureTitleCtaOverlayTop,
                  paddingHorizontal: scale(14),
                  paddingBottom: captureScrollBottomPad,
                },
              ]}
            >
              <View pointerEvents="none" style={styles.captureHeroTextOverlay}>
                <Text
                  style={[
                    styles.tagChildFirstName,
                    dmSans600 ? { fontFamily: dmSans600 } : { fontWeight: '600' },
                  ]}
                  accessibilityRole="text"
                  accessibilityLabel={`Prénom de l’enfant, ${childFirstName}`}
                >
                  {childFirstName || '—'}
                </Text>
                <Text
                  style={[styles.panelTitle, compact && styles.panelTitleCompact]}
                  accessibilityRole="header"
                >
                  <Text style={dmSans ? { fontFamily: dmSans } : { fontWeight: '400' }}>
                    {"C'est quoi le souvenir "}
                  </Text>
                  <Text style={dmSans700 ? { fontFamily: dmSans700 } : { fontWeight: '700' }}>
                    aujourd&apos;hui
                  </Text>
                  <Text style={dmSans ? { fontFamily: dmSans } : { fontWeight: '400' }}> ?</Text>
                </Text>
              </View>
              <View style={styles.captureCardBrownBlock} pointerEvents="box-none">
                <View style={styles.subtitleRow} pointerEvents="none">
                  <Text
                    style={[
                      styles.panelSubtitle,
                      compact && styles.panelSubtitleCompact,
                      dmSans ? { fontFamily: dmSans } : null,
                    ]}
                  >
                    Chaque souvenir compte{' '}
                  </Text>
                  <Heart
                    size={scale(16)}
                    color={CAPTURE_ON_SOIL_ACCENT}
                    fill={CAPTURE_ON_SOIL_ACCENT}
                    strokeWidth={1.8}
                  />
                </View>
                <View style={styles.cardsRow} pointerEvents="box-none">
                  <CaptureActionCard
                    customIcon={({ color, size }) => (
                      <MicIcon size={Math.round(size * 1.38)} color={color} />
                    )}
                    title="Enregistrer"
                    iconBackground={THEME.captureRecordCtaBackground}
                    onPress={() => handleCaptureCtaPress('/record-voice')}
                  />
                  <CaptureActionCard
                    customIcon={({ color, size }) => (
                      <PenIcon size={Math.round(size * 1.25)} color={color} />
                    )}
                    title="Écrire"
                    iconBackground={THEME.captureCoralCtaBackground}
                    onPress={() => handleCaptureCtaPress('/write')}
                  />
                  <CaptureActionCard
                    customIcon={({ color, size }) => (
                      <ImageImportIcon size={Math.round(size * 1.2)} color={color} />
                    )}
                    title="Importer"
                    iconBackground={THEME.captureImportCtaBackground}
                    onPress={() => handleCaptureCtaPress('/import-media')}
                  />
                </View>
              </View>
            </View>
          </View>
        </View>
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const cardShadow = Platform.select({
  web: { boxShadow: '0 4px 18px rgba(0,0,0,0.08)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: verticalScale(3) },
    shadowOpacity: 0.08,
    shadowRadius: scale(10),
    elevation: 4,
  },
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: THEME.bg,
  },
  mainColumn: {
    flex: 1,
    width: SCREEN_W,
    minHeight: 0,
    backgroundColor: THEME.bg,
  },
  /** Scroll vertical léger sur tout l’écran Capturer (la tab bar reste flottante au-dessus, hors de cet écran). */
  captureScrollView: {
    flex: 1,
    minHeight: 0,
  },
  captureScrollContent: {
    flexGrow: 1,
  },
  captureCardHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: scale(16),
    paddingBottom: verticalScale(10),
    backgroundColor: 'transparent',
    zIndex: 6,
    pointerEvents: 'box-none',
  },
  captureHeaderMenuHit: {
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(60, 60, 64, 0.42)',
  },
  captureCardWrap: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: CAPTURE_CARD_MARGIN_H,
    paddingTop: 0,
    paddingBottom: 0,
  },
  captureCard: {
    position: 'relative',
    flex: 1,
    minHeight: 0,
    flexDirection: 'column',
    borderRadius: 0,
    overflow: 'visible',
    backgroundColor: CAPTURE_BOTTOM_BG,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: verticalScale(4) },
        shadowOpacity: 0.12,
        shadowRadius: scale(14),
      },
      android: { elevation: 6 },
      default: {},
    }),
  },
  captureCardHero: {
    width: '100%',
    flexShrink: 0,
    overflow: 'hidden',
    zIndex: 0,
  },
  /** Fond marron sous le hero (flux flex) ; titres + CTA sont dans `captureTitleCtaOverlay`. */
  captureCardBelowHeroFill: {
    flex: 1,
    minHeight: 0,
    zIndex: 0,
    backgroundColor: CAPTURE_BOTTOM_BG,
  },
  /** Titres + CTA au-dessus du dégradé (`zIndex` > fondu) ; `top` contrôle la remontée sans toucher au calque dégradé. */
  captureTitleCtaOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    backgroundColor: 'transparent',
    pointerEvents: 'box-none',
    ...Platform.select({
      android: { elevation: 8 },
      default: {},
    }),
  },
  captureHeroTextOverlay: {
    marginBottom: verticalScale(6),
  },
  captureCardBrownBlock: {
    alignSelf: 'stretch',
    marginHorizontal: -scale(14),
    paddingHorizontal: scale(14),
    backgroundColor: CAPTURE_BOTTOM_BG,
    paddingTop: verticalScale(6),
    paddingBottom: 0,
  },
  heroImageCover: {
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web'
      ? ({ objectFit: 'cover', objectPosition: 'center top' } as const)
      : null),
  },
  /** Fondu marron : calque carte, aligné bas du hero (photo fixe). `translateY` ajustable par la bande tactile. */
  captureHeroBrownFadeWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 1,
  },
  /** Zone de drag en bas du bandeau ; `pointerEvents: none` sur le gradient au-dessus laisse passer les taps ailleurs. */
  captureHeroGradientDragStrip: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: CAPTURE_GRADIENT_DRAG_STRIP_H,
    zIndex: 2,
  },
  heroPlaceholder: {
    backgroundColor: '#6B4A3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlaceholderText: {
    fontSize: scale(72),
    fontWeight: '600',
    color: '#FFFFFF',
  },
  tagChildFirstName: {
    fontSize: scale(11),
    letterSpacing: scale(1.2),
    color: CAPTURE_ON_SOIL_ACCENT,
    marginBottom: verticalScale(8),
  },
  panelTitle: {
    fontSize: scale(26),
    lineHeight: scale(32),
    color: CAPTURE_ON_SOIL_TITLE,
    letterSpacing: -0.45,
    marginBottom: verticalScale(8),
  },
  panelTitleCompact: {
    fontSize: scale(22),
    lineHeight: scale(28),
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  panelSubtitle: {
    fontSize: scale(15),
    lineHeight: scale(22),
    color: CAPTURE_ON_SOIL_SUBTITLE,
  },
  panelSubtitleCompact: {
    fontSize: scale(14),
    lineHeight: scale(20),
  },
  cardsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: scale(6),
    width: '100%',
    marginTop: verticalScale(22),
  },
  actionCardWrap: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
  },
  captureCtaColumn: {
    alignItems: 'center',
  },
  actionCard: {
    alignSelf: 'center',
    width: scale(82),
    height: scale(82),
    borderRadius: scale(41),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow,
  },
  captureCtaLabel: {
    marginTop: verticalScale(4),
    fontSize: scale(11),
    lineHeight: scale(14),
    fontWeight: '600',
    color: 'rgba(250, 246, 242, 0.92)',
    textAlign: 'center',
    letterSpacing: -0.12,
  },
  ctaGhostText: {
    fontSize: scale(16),
    fontWeight: '600',
    color: CAPTURE_ON_SOIL_ACCENT,
  },
});

const captureHeroBreatheNativeDriver = Platform.OS !== 'web';

type CaptureHeroImageStackProps = {
  photoUri: string;
  reactKey: string;
};

/** Photo hero plein cadre + léger zoom + voile optique. Le dégradé taupe est un calque séparé sur la carte. */
function CaptureHeroImageStack({ photoUri, reactKey }: CaptureHeroImageStackProps) {
  const breatheScale = useRef(new Animated.Value(CAPTURE_HERO_BREATHE_MIN)).current;

  useEffect(() => {
    breatheScale.setValue(CAPTURE_HERO_BREATHE_MIN);
    if (CAPTURE_HERO_BREATHE_MAX <= CAPTURE_HERO_BREATHE_MIN) {
      return undefined;
    }
    const ease = Easing.inOut(Easing.ease);
    const up = Animated.timing(breatheScale, {
      toValue: CAPTURE_HERO_BREATHE_MAX,
      duration: CAPTURE_HERO_BREATHE_HALF_MS,
      easing: ease,
      useNativeDriver: captureHeroBreatheNativeDriver,
    });
    const down = Animated.timing(breatheScale, {
      toValue: CAPTURE_HERO_BREATHE_MIN,
      duration: CAPTURE_HERO_BREATHE_HALF_MS,
      easing: ease,
      useNativeDriver: captureHeroBreatheNativeDriver,
    });
    const loop = Animated.loop(Animated.sequence([up, down]));
    loop.start();
    return () => {
      loop.stop();
      breatheScale.setValue(CAPTURE_HERO_BREATHE_MIN);
    };
  }, [photoUri, reactKey, breatheScale]);

  return (
    <>
      <Animated.View
        key={reactKey}
        style={[StyleSheet.absoluteFillObject, { transform: [{ scale: breatheScale }] }]}
      >
        {Platform.OS === 'web' ? (
          <ImageBackground
            source={{ uri: photoUri }}
            style={StyleSheet.absoluteFillObject}
            imageStyle={styles.heroImageCover}
            resizeMode="cover"
          />
        ) : (
          <ColorMatrix matrix={CAPTURE_HERO_COLOR_MATRIX} style={StyleSheet.absoluteFillObject}>
            <ExpoImage
              source={{ uri: photoUri }}
              style={[StyleSheet.absoluteFillObject, styles.heroImageCover]}
              contentFit="cover"
              contentPosition="top"
              accessibilityIgnoresInvertColors
            />
          </ColorMatrix>
        )}
      </Animated.View>
      <LinearGradient
        colors={[...HERO_OPTICAL_SOFTNESS]}
        locations={[0, 0.42, 1]}
        pointerEvents="none"
        style={StyleSheet.absoluteFillObject}
      />
    </>
  );
}
