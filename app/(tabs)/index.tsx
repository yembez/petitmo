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
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets, useSafeAreaFrame } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Heart, Menu, Pencil } from 'lucide-react-native';
import { ImagesIcon, MicrophoneIcon } from 'phosphor-react-native';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useFonts, DMSans_400Regular, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import {
  PETITMO_CTA_BORDER_RADIUS,
  PETITMO_CTA_BORDER_WIDTH,
  PETITMO_CTA_SOFT_ELEVATION,
} from '@/constants/petitmoCtaStyles';
import { tabBarFloatingOverlapPad } from '@/constants/tabBarLayout';
import {
  cacheRemoteChildProfilePhotoLocally,
  getChildren,
  getOrSelectFirstChild,
  getCaptureTabChildSnapshot,
  PETITMO_CHILD_PROFILE_UPDATED_EVENT,
  sanitizeChildLocalAvatarIfMissing,
  setCaptureTabChildSnapshot,
  type ChildProfileUpdatedPayload,
} from '@/services/children';
import type { Child } from '@/types/local';
import PetitmoLogoManuscrit, { PETITMO_LOGO_VIEWBOX } from '@/components/PetitmoLogoManuscrit';
import { checkMemoryLimit } from '@/lib/limits';
import { getLocalChild } from '@/lib/localDb';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { resolveChildProfileImageDisplayUri } from '@/utils/childPhotoUri';
import { childDisplayGivenName, childDisplayInitial } from '@/utils/childDisplayName';
import { CAPTURE_HERO_COLOR_MATRIX } from '@/utils/captureHeroColorMatrix';
import {
  CAPTURE_HERO_IMAGE_CONTENT_POSITION,
  CAPTURE_HERO_IMAGE_OBJECT_POSITION,
  computeCaptureHeroPhotoViewport,
} from '@/utils/captureHeroMetrics';
import { ColorMatrix } from 'react-native-color-matrix-image-filters';

const { width: SCREEN_W } = Dimensions.get('window');

/** Marge latérale autour de la carte (0 = plein écran horizontal). */
const CAPTURE_CARD_MARGIN_H = 0;

/**
 * Décale le bandeau logo + menu (vue absolue). Valeur plus basse = bandeau plus haut sur l’écran.
 */
const CAPTURE_HEADER_LOGO_MENU_TRANSLATE_Y = verticalScale(8);

/** Zoom « respiration » sur le hero (1 → max). */
const CAPTURE_HERO_BREATHE_MIN = 1;
const CAPTURE_HERO_BREATHE_MAX = 1.03;
const CAPTURE_HERO_BREATHE_HALF_MS = 8500;

/** Fondu noir léger en haut du hero (lisibilité logo / menu). */
const HERO_TOP_BLACK_FADE = [
  'rgba(0, 0, 0, 0.52)',
  'rgba(0, 0, 0, 0.22)',
  'rgba(0, 0, 0, 0)',
] as const;

/** Fondu noir en bas du hero (titre blanc sur la photo). */
const HERO_BOTTOM_BLACK_FADE = [
  'rgba(0, 0, 0, 0)',
  'rgba(0, 0, 0, 0.38)',
  'rgba(0, 0, 0, 0.78)',
] as const;

/** Hauteur du fondu haut ≈ 30 % du hero (px, pas de % pour fiabilité layout). */
function captureHeroTopFadeHeight(heroHeight: number): number {
  return Math.max(verticalScale(72), Math.round(heroHeight * 0.3));
}

/** Hauteur du fondu bas ≈ 42 % du hero (bande titre). */
function captureHeroBottomFadeHeight(heroHeight: number): number {
  return Math.max(verticalScale(108), Math.round(heroHeight * 0.42));
}

/** Écart vertical uniforme entre les CTA (Écrire, Importer, Enregistrer). */
const CAPTURE_CTA_GAP = verticalScale(16);

/** Fond du CTA principal « Écrire » — écran Capturer. */
const CAPTURE_WRITE_CTA_BACKGROUND = THEME.captureScreenCtaBackground;
/** Liseré CTA Importer / Enregistrer — même rosé, plus clair que le fond « Écrire ». */
const CAPTURE_WRITE_CTA_BORDER = THEME.captureCtaBorderColor;
/** Libellé + crayon sur fond `CAPTURE_WRITE_CTA_BACKGROUND`. */
const CAPTURE_WRITE_CTA_FOREGROUND = THEME.captureScreenCtaForeground;

/** Titre Capturer — essai San Francisco sur iOS (`System`), graisses via `fontWeight`. */
const CAPTURE_TITLE_FONT_FAMILY = Platform.select({
  ios: 'System',
  default: undefined,
});

function captureTitleFont(weight: '400' | '700') {
  return CAPTURE_TITLE_FONT_FAMILY
    ? { fontFamily: CAPTURE_TITLE_FONT_FAMILY, fontWeight: weight }
    : { fontWeight: weight };
}

/** Phosphor `fill` — CTA secondaires Enregistrer / Importer (noir). */
const CAPTURE_PHOSPHOR_SECONDARY = {
  weight: 'fill' as const,
  color: THEME.textPrimary,
};

type CaptureRoute = '/write' | '/record-voice' | '/import-media';

function CaptureSecondaryRow({
  icon,
  labelBold,
  labelSuffix,
  onPress,
  fontFamilyBold,
  fontFamilyRegular,
}: {
  icon: React.ReactNode;
  labelBold: string;
  labelSuffix: string;
  onPress: () => void;
  fontFamilyBold?: string;
  fontFamilyRegular?: string;
}) {
  const accessibilityLabel = `${labelBold}${labelSuffix}`;
  const pressScale = useRef(new Animated.Value(1)).current;
  const pressOpacity = useRef(new Animated.Value(1)).current;

  const runPressIn = useCallback(() => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Animated.parallel([
      Animated.spring(pressScale, {
        toValue: 0.97,
        useNativeDriver: true,
        friction: 5,
        tension: 340,
      }),
      Animated.timing(pressOpacity, {
        toValue: 0.92,
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
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onPressIn={runPressIn}
      onPressOut={runPressOut}
      style={styles.captureSecondaryRow}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Animated.View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          width: '100%',
          transform: [{ scale: pressScale }],
          opacity: pressOpacity,
        }}
      >
        <View style={styles.captureSecondaryIconWrap}>{icon}</View>
        <View style={styles.captureSecondaryTextCol}>
          <Text style={styles.captureSecondaryLabelRow} numberOfLines={1} ellipsizeMode="tail">
            <Text
              style={[
                styles.captureSecondaryLabelBold,
                fontFamilyBold ? { fontFamily: fontFamilyBold } : { fontWeight: '700' },
              ]}
            >
              {labelBold}
            </Text>
            <Text
              style={[
                styles.captureSecondaryLabel,
                fontFamilyRegular ? { fontFamily: fontFamilyRegular } : { fontWeight: '400' },
              ]}
            >
              {labelSuffix}
            </Text>
          </Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

function CapturePrimaryWriteButton({
  title,
  onPress,
  fontFamilyBold,
}: {
  title: string;
  onPress: () => void;
  fontFamilyBold?: string;
}) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const pressOpacity = useRef(new Animated.Value(1)).current;

  const runPressIn = useCallback(() => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    Animated.parallel([
      Animated.spring(pressScale, {
        toValue: 0.97,
        useNativeDriver: true,
        friction: 5,
        tension: 340,
      }),
      Animated.timing(pressOpacity, {
        toValue: 0.94,
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
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onPressIn={runPressIn}
      onPressOut={runPressOut}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <Animated.View
        style={[
          styles.capturePrimaryWriteBtn,
          { transform: [{ scale: pressScale }], opacity: pressOpacity },
        ]}
      >
        <Pencil
          size={scale(20)}
          color={CAPTURE_WRITE_CTA_FOREGROUND}
          strokeWidth={2.4}
          style={styles.capturePrimaryWritePencil}
        />
        <Text
          style={[
            styles.capturePrimaryWriteBtnText,
            fontFamilyBold ? { fontFamily: fontFamilyBold } : { fontWeight: '700' },
          ]}
        >
          {title}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function CapturerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const { height: windowH } = useWindowDimensions();

  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_700Bold,
  });
  const dmSans700 = fontsLoaded ? 'DMSans_700Bold' : undefined;
  const dmSans = fontsLoaded ? 'DMSans_400Regular' : undefined;

  const usableH = Math.max(280, windowH);
  const layoutH = Math.min(frame.height > 1 ? frame.height : usableH, usableH);
  const compact = layoutH < 600;

  const captureHeroHeight = useMemo(
    () => Math.round(computeCaptureHeroPhotoViewport(frame.height, windowH, frame.width, insets.top).heroH),
    [frame.height, frame.width, windowH, insets.top],
  );
  const captureHeroTopFadeH = useMemo(
    () => captureHeroTopFadeHeight(captureHeroHeight),
    [captureHeroHeight],
  );
  const captureHeroBottomFadeH = useMemo(
    () => captureHeroBottomFadeHeight(captureHeroHeight),
    [captureHeroHeight],
  );

  const [child, setChild] = useState<Child | null>(() => getCaptureTabChildSnapshot());
  const [isLoading, setIsLoading] = useState(() => getCaptureTabChildSnapshot() === null);
  const childRef = useRef<Child | null>(null);
  childRef.current = child;

  useEffect(() => {
    setCaptureTabChildSnapshot(child);
  }, [child]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      PETITMO_CHILD_PROFILE_UPDATED_EVENT,
      (payload: ChildProfileUpdatedPayload) => {
        void (async () => {
          const id = payload?.childId?.trim();
          if (!id || childRef.current?.id !== id) return;
          try {
            let row: Child | null = payload.child?.id === id ? payload.child : null;
            if (!row) {
              const all = await getChildren();
              row = all.find(c => c.id === id) ?? null;
            }
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
      /** Importer : ouvrir la galerie tout de suite ; la limite est vérifiée après la sélection. */
      if (route === '/import-media') {
        router.push(route);
        return;
      }
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
          if (cancelled) return;

          /** Retour onglet (ex. après import fil) : SQLite direct, sans sanitize destructif. */
          if (silent && storedSelectedId) {
            const row = getLocalChild(storedSelectedId);
            if (row) {
              setChild(prev => {
                const lp =
                  (row.local_photo_path ?? '').trim() ||
                  (prev?.local_photo_path ?? '').trim() ||
                  null;
                const pu = (row.photo_url ?? '').trim() || (prev?.photo_url ?? '').trim() || null;
                return { ...row, local_photo_path: lp, photo_url: pu };
              });
            }
            return;
          }

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
        <ActivityIndicator size="large" color={THEME.textPrimary} />
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
  const captureWhiteMinHeight = Math.max(0, layoutH - captureHeroHeight);
  /** Réserve sous les CTA pour la tab bar flottante (zone de centrage vertical). */
  const captureTabBarReserve = tabBarFloatingOverlapPad(insets.bottom);
  const childGivenName = childDisplayGivenName(child.name);

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
          <View style={[styles.captureCard, { minHeight: layoutH }]}>
            <View style={[styles.captureHeroSection, { height: captureHeroHeight }]}>
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
                    <Text style={styles.heroPlaceholderText}>{childDisplayInitial(child.name)}</Text>
                  </View>
                )}
                <LinearGradient
                  colors={[...HERO_TOP_BLACK_FADE]}
                  locations={[0, 0.5, 1]}
                  pointerEvents="none"
                  style={[styles.captureHeroTopBlackFade, { height: captureHeroTopFadeH }]}
                />
              </TouchableOpacity>

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
                  <Menu size={headerMenuIconSize} color={THEME.textPrimary} strokeWidth={2} />
                </TouchableOpacity>
              </View>

              <LinearGradient
                colors={[...HERO_BOTTOM_BLACK_FADE]}
                locations={[0, 0.45, 1]}
                pointerEvents="none"
                style={[styles.captureHeroBottomBlackFade, { height: captureHeroBottomFadeH }]}
              />

              <View style={styles.captureHeroTitleOverlay} pointerEvents="none">
                <View style={styles.captureTitleBlock} accessibilityRole="header">
                  <View
                    style={[
                      styles.captureTitleLine1Row,
                      compact && styles.captureTitleLine1RowCompact,
                    ]}
                  >
                    <Text
                      style={[
                        styles.captureTitleLine1,
                        compact && styles.captureTitleLine1Compact,
                        captureTitleFont('400'),
                      ]}
                    >
                      Quel souvenir pour{' '}
                    </Text>
                    <View style={styles.captureTitleNameHeartRow}>
                      <Text
                        style={[
                          styles.captureTitleLine1,
                          compact && styles.captureTitleLine1Compact,
                          captureTitleFont('400'),
                        ]}
                      >
                        {childGivenName || 'l’enfant'}
                      </Text>
                      <Heart
                        size={scale(compact ? 13 : 16)}
                        color={THEME.brandPrimary}
                        fill={THEME.brandPrimary}
                        strokeWidth={1.6}
                        style={styles.captureTitleHeart}
                      />
                    </View>
                  </View>

                  <View style={styles.captureTitleLine2Row}>
                    <Text
                      style={[
                        styles.captureTitleLine2Bold,
                        compact && styles.captureTitleLine2BoldCompact,
                        captureTitleFont('400'),
                      ]}
                    >
                      <Text style={[styles.captureTitleTodayEmphasis, captureTitleFont('700')]}>
                        aujourd&apos;hui
                      </Text>
                      <Text> ?</Text>
                    </Text>
                  </View>
                </View>
              </View>
            </View>

            <View
              style={[
                styles.captureContentWhite,
                {
                  minHeight: captureWhiteMinHeight,
                  paddingHorizontal: scale(20),
                  paddingBottom: captureTabBarReserve,
                },
              ]}
            >
              <View style={styles.captureCtaZone}>
                <View style={styles.captureCtaBlock}>
                  <View style={styles.capturePrimaryWriteWrap}>
                    <CapturePrimaryWriteButton
                      title="Écrire"
                      fontFamilyBold={dmSans700}
                      onPress={() => handleCaptureCtaPress('/write')}
                    />
                  </View>

                  <View style={styles.captureSecondaryList}>
                    <CaptureSecondaryRow
                      icon={<ImagesIcon size={scale(28)} {...CAPTURE_PHOSPHOR_SECONDARY} />}
                      labelBold="Importer"
                      labelSuffix=" des photos ou vidéos"
                      fontFamilyBold={dmSans700}
                      fontFamilyRegular={dmSans}
                      onPress={() => handleCaptureCtaPress('/import-media')}
                    />
                    <CaptureSecondaryRow
                      icon={<MicrophoneIcon size={scale(28)} {...CAPTURE_PHOSPHOR_SECONDARY} />}
                      labelBold="Enregistrer"
                      labelSuffix=" sa voix ou la votre"
                      fontFamilyBold={dmSans700}
                      fontFamilyRegular={dmSans}
                      onPress={() => handleCaptureCtaPress('/record-voice')}
                    />
                  </View>
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
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.06)',
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
    overflow: 'hidden',
    backgroundColor: THEME.bg,
  },
  captureHeroSection: {
    width: '100%',
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000',
  },
  captureHeroTopBlackFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    elevation: 10,
  },
  captureHeroBottomBlackFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 11,
    elevation: 11,
  },
  captureHeroTitleOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 12,
    elevation: 12,
    paddingHorizontal: scale(20),
    paddingBottom: verticalScale(14),
    paddingTop: verticalScale(8),
    alignItems: 'center',
  },
  captureContentWhite: {
    width: '100%',
    flex: 1,
    minHeight: 0,
    backgroundColor: THEME.bg,
    alignItems: 'stretch',
  },
  captureTitleBlock: {
    alignItems: 'center',
    maxWidth: '100%',
  },
  /** Zone CTA sous le hero — centrée verticalement dans le bandeau blanc. */
  captureCtaZone: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingTop: verticalScale(8),
  },
  captureCtaBlock: {
    alignItems: 'stretch',
    alignSelf: 'center',
    width: '100%',
  },
  captureTitleLine1Row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(3),
  },
  captureTitleLine1RowCompact: {
    marginBottom: verticalScale(2),
  },
  captureTitleNameHeartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(5),
  },
  captureTitleLine1: {
    textAlign: 'center',
    fontSize: scale(23),
    lineHeight: scale(29),
    color: '#FFFFFF',
    letterSpacing: -0.35,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  captureTitleLine1Compact: {
    fontSize: scale(20),
    lineHeight: scale(26),
  },
  captureTitleLine2Row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 0,
  },
  captureTitleLine2Bold: {
    fontSize: scale(23),
    lineHeight: scale(29),
    color: '#FFFFFF',
    letterSpacing: -0.35,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  captureTitleLine2BoldCompact: {
    fontSize: scale(20),
    lineHeight: scale(26),
  },
  /** « aujourd'hui » en bold sur le hero. */
  captureTitleTodayEmphasis: {
    letterSpacing: -0.35,
  },
  captureTitleHeart: {
    marginTop: verticalScale(1),
  },
  capturePrimaryWriteWrap: {
    alignItems: 'center',
    marginBottom: CAPTURE_CTA_GAP,
  },
  capturePrimaryWriteBtn: {
    minWidth: Math.min(scale(300), SCREEN_W - scale(40)),
    width: '88%',
    maxWidth: scale(340),
    backgroundColor: CAPTURE_WRITE_CTA_BACKGROUND,
    borderRadius: PETITMO_CTA_BORDER_RADIUS,
    paddingVertical: verticalScale(14),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    ...PETITMO_CTA_SOFT_ELEVATION,
  },
  capturePrimaryWritePencil: {
    marginRight: scale(8),
  },
  /** Compense le crayon à gauche pour centrer visuellement « Écrire » dans le bouton. */
  capturePrimaryWriteBtnText: {
    fontSize: scale(17),
    color: CAPTURE_WRITE_CTA_FOREGROUND,
    letterSpacing: -0.2,
    paddingRight: scale(30),
  },
  captureSecondaryList: {
    alignSelf: 'center',
    width: '88%',
    maxWidth: scale(340),
    minWidth: Math.min(scale(300), SCREEN_W - scale(40)),
    gap: CAPTURE_CTA_GAP,
  },
  captureSecondaryRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(12),
    borderRadius: PETITMO_CTA_BORDER_RADIUS,
    borderWidth: PETITMO_CTA_BORDER_WIDTH,
    borderColor: CAPTURE_WRITE_CTA_BORDER,
    backgroundColor: THEME.bg,
    ...PETITMO_CTA_SOFT_ELEVATION,
  },
  captureSecondaryIconWrap: {
    width: scale(48),
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureSecondaryTextCol: {
    flex: 1,
    minWidth: 0,
    paddingLeft: scale(4),
  },
  captureSecondaryLabelRow: {
    fontSize: scale(15),
    lineHeight: scale(20),
    color: THEME.textPrimary,
    letterSpacing: -0.25,
  },
  captureSecondaryLabelBold: {
    fontSize: scale(15),
    lineHeight: scale(20),
    color: THEME.textPrimary,
    letterSpacing: -0.25,
  },
  captureSecondaryLabel: {
    fontSize: scale(15),
    lineHeight: scale(20),
    color: THEME.textPrimary,
    letterSpacing: -0.25,
  },
  heroImageCover: {
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web'
      ? ({ objectFit: 'cover', objectPosition: CAPTURE_HERO_IMAGE_OBJECT_POSITION } as const)
      : null),
  },
  heroPlaceholder: {
    backgroundColor: '#E8E8ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlaceholderText: {
    fontSize: scale(72),
    fontWeight: '600',
    color: THEME.brandPrimarySoft,
  },
  ctaGhostText: {
    fontSize: scale(16),
    fontWeight: '600',
    color: THEME.brandPrimarySoft,
  },
});

const captureHeroBreatheNativeDriver = Platform.OS !== 'web';

type CaptureHeroImageStackProps = {
  photoUri: string;
  reactKey: string;
};

/** Photo hero plein cadre + léger zoom « respiration ». */
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
    <View style={StyleSheet.absoluteFillObject} pointerEvents="box-none">
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
              contentPosition={CAPTURE_HERO_IMAGE_CONTENT_POSITION}
              accessibilityIgnoresInvertColors
            />
          </ColorMatrix>
        )}
      </Animated.View>
    </View>
  );
}
