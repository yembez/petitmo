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
import { checkMemoryLimit } from '@/lib/limits';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { resolveChildProfileImageDisplayUri } from '@/utils/childPhotoUri';
import { CAPTURE_HERO_COLOR_MATRIX } from '@/utils/captureHeroColorMatrix';
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

/** Hauteur du fondu haut ≈ 30 % du hero (px, pas de % pour fiabilité layout). */
function captureHeroTopFadeHeight(heroHeight: number): number {
  return Math.max(verticalScale(72), Math.round(heroHeight * 0.3));
}

/** Espace volontaire entre le bas du bloc titre et le haut du bloc CTA. */
const CAPTURE_TITLE_CTA_GAP = verticalScale(18);

/** Accent CTA écran Capturer — aligné sur `THEME.captureAccentYellow`. */
const CAPTURE_ACCENT = THEME.captureAccentYellow;

const CAPTURE_CTA_BORDER = '#000000';

/** Rayon des coins — identique sur Écrire et CTA secondaires (Importer / Enregistrer). */
const CAPTURE_CTA_BORDER_RADIUS = scale(20);

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
          color={THEME.textPrimary}
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

  const captureHeroHeight = useMemo(() => Math.round(layoutH * 0.5), [layoutH]);
  const captureHeroTopFadeH = useMemo(
    () => captureHeroTopFadeHeight(captureHeroHeight),
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
        <ActivityIndicator size="large" color={CAPTURE_ACCENT} />
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
                    <Text style={styles.heroPlaceholderText}>{child.name.charAt(0).toUpperCase()}</Text>
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
              <View
                style={[
                  styles.captureTitleZone,
                  compact && styles.captureTitleZoneCompact,
                ]}
              >
                <View style={styles.captureTitleBlock} pointerEvents="none">
                  <Text
                    style={[
                      styles.captureTitleLine1,
                      compact && styles.captureTitleLine1Compact,
                      dmSans ? { fontFamily: dmSans } : { fontWeight: '400' },
                    ]}
                    accessibilityRole="header"
                  >
                    {`Quel souvenir pour ${childFirstName || 'l’enfant'}`}
                  </Text>

                  <View style={styles.captureTitleLine2Row}>
                    <Text
                      style={[
                        styles.captureTitleLine2Bold,
                        compact && styles.captureTitleLine2BoldCompact,
                        dmSans700 ? { fontFamily: dmSans700 } : { fontWeight: '700' },
                      ]}
                    >
                      aujourd&apos;hui ?
                    </Text>
                    <Heart
                      size={scale(compact ? 10 : 12)}
                      color={THEME.brandTerracotta}
                      fill={THEME.brandTerracotta}
                      strokeWidth={1.6}
                      style={styles.captureTitleHeart}
                    />
                  </View>
                </View>
              </View>

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
  captureContentWhite: {
    width: '100%',
    flex: 1,
    minHeight: 0,
    backgroundColor: THEME.bg,
    alignItems: 'stretch',
  },
  /**
   * Zone titre : flex 1, contenu calé vers le bas (vers les CTA).
   * Évite le « double vide » du centrage dans chaque moitié d’écran.
   */
  captureTitleZone: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: CAPTURE_TITLE_CTA_GAP,
  },
  captureTitleZoneCompact: {
    paddingBottom: verticalScale(14),
  },
  captureTitleBlock: {
    alignItems: 'center',
    maxWidth: '100%',
  },
  /** Zone CTA : flex 1, contenu calé vers le haut (vers le titre). */
  captureCtaZone: {
    flex: 1,
    minHeight: 0,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
  },
  captureCtaBlock: {
    alignItems: 'stretch',
    alignSelf: 'center',
    width: '100%',
  },
  captureTitleLine1: {
    textAlign: 'center',
    fontSize: scale(21),
    lineHeight: scale(27),
    color: THEME.textPrimary,
    letterSpacing: -0.35,
    marginBottom: verticalScale(3),
  },
  captureTitleLine1Compact: {
    fontSize: scale(18),
    lineHeight: scale(23),
    marginBottom: verticalScale(2),
  },
  captureTitleLine2Row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginBottom: 0,
  },
  captureTitleLine2Bold: {
    fontSize: scale(21),
    lineHeight: scale(27),
    color: THEME.textPrimary,
    letterSpacing: -0.35,
  },
  captureTitleLine2BoldCompact: {
    fontSize: scale(18),
    lineHeight: scale(23),
  },
  captureTitleHeart: {
    marginLeft: scale(4),
  },
  capturePrimaryWriteWrap: {
    alignItems: 'center',
    marginBottom: verticalScale(10),
  },
  capturePrimaryWriteBtn: {
    minWidth: Math.min(scale(300), SCREEN_W - scale(40)),
    width: '88%',
    maxWidth: scale(340),
    backgroundColor: CAPTURE_ACCENT,
    borderRadius: CAPTURE_CTA_BORDER_RADIUS,
    borderWidth: 1,
    borderColor: CAPTURE_CTA_BORDER,
    paddingVertical: verticalScale(16),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  capturePrimaryWritePencil: {
    marginRight: scale(8),
  },
  /** Compense le crayon à gauche pour centrer visuellement « Écrire » dans le bouton. */
  capturePrimaryWriteBtnText: {
    fontSize: scale(17),
    color: THEME.textPrimary,
    letterSpacing: -0.2,
    paddingRight: scale(30),
  },
  captureSecondaryList: {
    alignSelf: 'center',
    width: '88%',
    maxWidth: scale(340),
    minWidth: Math.min(scale(300), SCREEN_W - scale(40)),
    gap: verticalScale(8),
  },
  captureSecondaryRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: verticalScale(10),
    paddingHorizontal: scale(12),
    borderRadius: CAPTURE_CTA_BORDER_RADIUS,
    borderWidth: 1,
    borderColor: CAPTURE_CTA_BORDER,
    backgroundColor: THEME.bg,
    overflow: 'hidden',
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
      ? ({ objectFit: 'cover', objectPosition: 'center top' } as const)
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
    color: CAPTURE_ACCENT,
  },
  ctaGhostText: {
    fontSize: scale(16),
    fontWeight: '600',
    color: CAPTURE_ACCENT,
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
              contentPosition="top"
              accessibilityIgnoresInvertColors
            />
          </ColorMatrix>
        )}
      </Animated.View>
    </View>
  );
}
