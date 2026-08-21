import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  ScrollView,
  useWindowDimensions,
  DeviceEventEmitter,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets, useSafeAreaFrame } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Heart } from 'lucide-react-native';
import ImageImportIcon from '@/components/ImageImportIcon';
import MicIcon from '@/components/MicIcon';
import PenIcon from '@/components/PenIcon';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { Inter_300Light_Italic, Inter_500Medium, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Manrope_400Regular, Manrope_700Bold } from '@expo-google-fonts/manrope';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans';
import TabSceneTransition from '@/components/TabSceneTransition';
import SettingsHeaderButton from '@/components/SettingsHeaderButton';
import { loadedFontStyle } from '@/utils/loadedFontStyle';

/** Tailles maquette capture (px logiques). */
const CAPTURE_TITLE_FONT_SIZE = 18;
const CAPTURE_TITLE_LINE_HEIGHT = 24;
const CAPTURE_TITLE_HEART_SIZE = scale(16);
const CAPTURE_HEADER_DATE_FONT_SIZE = 15;
const CAPTURE_HEADER_DATE_LINE_HEIGHT = 20;
/** Hauteur de la ligne date / logo / paramètres (alignés sur le bouton). */
const CAPTURE_HEADER_ROW_H = scale(40);

import { tabBarFloatingOverlapPad } from '@/constants/tabBarLayout';
import { scale, verticalScale } from '@/utils/responsive';
import {
  CAPTURE_SCREEN_ACCENT,
  CAPTURE_SCREEN_BG,
  CAPTURE_SCREEN_RECORD_ACCENT,
} from '@/constants/captureScreenPalette';
import { THEME } from '@/constants/theme';
import {
  ensureChildFaceBounds,
  getOrSelectFirstChild,
  getCaptureTabChildSnapshot,
  PETITMO_CHILD_PROFILE_UPDATED_EVENT,
  setCaptureTabChildSnapshot,
  type ChildProfileUpdatedPayload,
} from '@/services/children';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';
import type { Child } from '@/types/local';
import { checkMemoryLimit } from '@/lib/limits';
import { promptFreeTierLimitThenPaywall } from '@/utils/freeTierLimitGate';
import { getLocalChild, listLocalChildren, listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { useChildProfileDisplayUri } from '@/hooks/useChildProfileDisplayUri';
import { childDisplayGivenName, childDisplayInitial } from '@/utils/childDisplayName';
import { formatCaptureChildAge, formatCaptureHeaderDate } from '@/utils/date';
import { sortChildrenByBirthdateAsc } from '@/utils/childrenAge';
import { CaptureFamilyMosaic } from '@/components/CaptureFamilyMosaic';
import PetitmoLogoManuscrit from '@/components/PetitmoLogoManuscrit';
import {
  CAPTURE_HERO_IMAGE_CONTENT_POSITION,
  CAPTURE_HERO_IMAGE_OBJECT_POSITION,
  CHILD_PROFILE_PHOTO_ASPECT,
  CHILD_PROFILE_PHOTO_ASPECT_COMPACT,
} from '@/utils/captureHeroMetrics';

/** Enfants visibles pour le compte courant — jamais ceux d’un autre e-mail. */
function listCaptureScopedChildren(): Child[] {
  const uid = peekLastRealAuthUserId();
  if (uid) return listLocalChildrenForUser(uid);
  return listLocalChildren().filter(c => !(c.user_id ?? '').trim());
}

const { width: SCREEN_W } = Dimensions.get('window');

/** Zoom « respiration » sur la photo carte (1 → max). */
const CAPTURE_HERO_BREATHE_MIN = 1;
const CAPTURE_HERO_BREATHE_MAX = 1.03;
const CAPTURE_HERO_BREATHE_HALF_MS = 8500;

const CAPTURE_PHOTO_CARD_RADIUS = scale(32);
const CAPTURE_PHOTO_CARD_ASPECT = CHILD_PROFILE_PHOTO_ASPECT;
const CAPTURE_PHOTO_CARD_ASPECT_COMPACT = CHILD_PROFILE_PHOTO_ASPECT_COMPACT;
/** Padding horizontal du scroll ; la photo utilise `capturePhotoBleed` pour des bords symétriques. */
const CAPTURE_CONTENT_PADDING_H = scale(20);
const CAPTURE_PHOTO_EDGE_PADDING_H = scale(14);

const CAPTURE_CTA_SIZE = scale(78);
const CAPTURE_CTA_SIZE_COMPACT = scale(64);
const CAPTURE_CTA_ICON_SIZE = scale(34);
const CAPTURE_CTA_ICON_SIZE_COMPACT = scale(29);
const CAPTURE_CTA_MIC_ICON_SIZE = scale(38);
const CAPTURE_CTA_MIC_ICON_SIZE_COMPACT = scale(32);

/** Tagline hero photo — maquette capture. */
const CAPTURE_HERO_TAGLINE = '“Avec toi, l’ordinaire devient extraordinaire.”';

type CaptureRoute = '/write' | '/record-voice' | '/import-media';

function captureCtaHaloStyle(color: string) {
  return Platform.select({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.13,
      shadowRadius: 10,
    },
    android: {
      elevation: 3,
      shadowColor: color,
    },
    default: {},
  });
}

/**
 * Révision photo hero — chemin local + `updated_at` (fichier souvent écrasé au même path).
 * Sans `updated_at`, plusieurs changements de photo sont ignorés par `captureChildDisplayEqual`.
 * Remote-only : path + updated_at (pas de fichier local).
 */
function captureHeroPhotoRevision(child: Child): string {
  const local = (child.local_photo_path ?? '').trim();
  const rev = (child.updated_at ?? '').trim();
  if (local) return `local:${local}|${rev}`;
  return `remote:${(child.photo_url ?? '').trim()}|${rev}`;
}

function captureChildDisplayEqual(a: Child | null, b: Child | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.id !== b.id) return false;
  return (
    captureHeroPhotoRevision(a) === captureHeroPhotoRevision(b) &&
    a.name === b.name &&
    a.birthdate === b.birthdate
  );
}

function CapturePhotoGlassPill({
  label,
  labelFontFamily,
  emphasized = false,
  align = 'left',
  accentDot = false,
}: {
  label: string;
  labelFontFamily?: string;
  emphasized?: boolean;
  align?: 'left' | 'right';
  accentDot?: boolean;
}) {
  const content = (
    <View style={styles.capturePhotoPillInner}>
      {accentDot ? <View style={styles.capturePhotoPillAccentDot} /> : null}
      <Text
        style={[
          styles.capturePhotoPillText,
          emphasized && styles.capturePhotoPillTextEmphasized,
          align === 'right' && styles.capturePhotoPillTextRight,
          loadedFontStyle(labelFontFamily) ?? (emphasized ? { fontWeight: '700' } : null),
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );

  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={48} tint="light" style={styles.capturePhotoPill}>
        {content}
      </BlurView>
    );
  }

  return <View style={[styles.capturePhotoPill, styles.capturePhotoPillFallback]}>{content}</View>;
}

function CaptureDiscCta({
  label,
  icon,
  discColor,
  discBorderColor,
  discBorderWidth = 0,
  haloColor,
  onPress,
  labelFontFamily,
  compact = false,
  accessibilityLabel,
  haptic = 'medium',
}: {
  label: string;
  icon: React.ReactNode;
  discColor: string;
  discBorderColor?: string;
  discBorderWidth?: number;
  /** Teinte du halo — par défaut la couleur du disque (ou du contour si fond clair). */
  haloColor?: string;
  onPress: () => void;
  labelFontFamily?: string;
  compact?: boolean;
  accessibilityLabel?: string;
  haptic?: 'light' | 'medium';
}) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const ctaSize = compact ? CAPTURE_CTA_SIZE_COMPACT : CAPTURE_CTA_SIZE;
  const glowColor = haloColor ?? discBorderColor ?? discColor;

  const runPressIn = useCallback(() => {
    if (Platform.OS === 'ios' || Platform.OS === 'android') {
      void Haptics.impactAsync(
        haptic === 'light'
          ? Haptics.ImpactFeedbackStyle.Light
          : Haptics.ImpactFeedbackStyle.Medium,
      );
    }
    Animated.spring(pressScale, {
      toValue: 0.94,
      useNativeDriver: true,
      friction: 6,
      tension: 380,
    }).start();
  }, [haptic, pressScale]);

  const runPressOut = useCallback(() => {
    Animated.spring(pressScale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 5,
      tension: 260,
    }).start();
  }, [pressScale]);

  return (
    <TouchableOpacity
      activeOpacity={1}
      onPress={onPress}
      onPressIn={runPressIn}
      onPressOut={runPressOut}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={styles.captureCtaTouch}
    >
      <Animated.View
        style={[
          styles.captureCtaDisc,
          {
            width: ctaSize,
            height: ctaSize,
            borderRadius: ctaSize / 2,
            backgroundColor: discColor,
            borderWidth: discBorderWidth,
            borderColor: discBorderColor ?? 'transparent',
            transform: [{ scale: pressScale }],
            ...captureCtaHaloStyle(glowColor),
          },
        ]}
      >
        {icon}
      </Animated.View>
      <Text
        style={[
          styles.captureCtaLabel,
          compact && styles.captureCtaLabelCompact,
          loadedFontStyle(labelFontFamily),
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function CapturerScreen() {
  const router = useRouter();
  const isTabFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const { height: windowH } = useWindowDimensions();

  const [captureFontsLoaded] = useFonts({
    Manrope_400Regular,
    Manrope_700Bold,
    DMSans_500Medium,
    Inter_300Light_Italic,
    Inter_500Medium,
    Inter_700Bold,
  });
  const captureTitleFont = captureFontsLoaded ? 'Inter_500Medium' : undefined;
  const captureTitleBoldFont = captureFontsLoaded ? 'Inter_700Bold' : undefined;
  const captureSubtitleFont = captureFontsLoaded ? 'Manrope_400Regular' : undefined;
  const capturePhotoPillNameFont = captureFontsLoaded ? 'Manrope_700Bold' : undefined;
  const captureCtaLabelFont = captureFontsLoaded ? 'DMSans_500Medium' : undefined;
  const captureTaglineFont = captureFontsLoaded ? 'Inter_300Light_Italic' : undefined;
  const usableH = Math.max(280, windowH);
  const layoutH = Math.min(frame.height > 1 ? frame.height : usableH, usableH);
  const compact = layoutH < 600;

  const [child, setChild] = useState<Child | null>(() => {
    const snap = getCaptureTabChildSnapshot();
    if (snap) return snap;
    hydrateTabScreensFromSqliteSync();
    return getCaptureTabChildSnapshot();
  });
  const [familyChildren, setFamilyChildren] = useState<Child[]>(() =>
    sortChildrenByBirthdateAsc(listCaptureScopedChildren()),
  );
  const [isLoading, setIsLoading] = useState(() => child === null);
  const childRef = useRef<Child | null>(null);
  childRef.current = child;
  const captureScrollRef = useRef<ScrollView>(null);
  const captureScrollYRef = useRef(0);
  const captureScrollMaxYRef = useRef(0);

  const heroDisplayUri = useChildProfileDisplayUri(child);
  const photoUri = heroDisplayUri ?? '';
  const heroPhotoCacheKey = child ? captureHeroPhotoRevision(child) : '';

  useEffect(() => {
    if (!photoUri.trim()) return;
    void ExpoImage.prefetch(photoUri).catch(() => {});
  }, [photoUri]);

  useEffect(() => {
    setCaptureTabChildSnapshot(child);
  }, [child]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      PETITMO_CHILD_PROFILE_UPDATED_EVENT,
      (payload: ChildProfileUpdatedPayload) => {
        const sorted = sortChildrenByBirthdateAsc(listCaptureScopedChildren());
        const id = payload?.childId?.trim();
        const fromPayload =
          payload?.child && (!id || payload.child.id === id) ? payload.child : null;
        const active =
          fromPayload ??
          (id ? sorted.find(c => c.id === id) : null) ??
          sorted.find(c => c.id === childRef.current?.id) ??
          sorted[0] ??
          null;
        const familyNext = fromPayload
          ? sortChildrenByBirthdateAsc(
              sorted.some(c => c.id === fromPayload.id)
                ? sorted.map(c => (c.id === fromPayload.id ? fromPayload : c))
                : [...sorted, fromPayload],
            )
          : sorted;
        setFamilyChildren(familyNext);
        if (!active) {
          setChild(null);
          return;
        }
        setChild(prev => {
          if (captureChildDisplayEqual(prev, active)) return prev;
          setCaptureTabChildSnapshot(active);
          return active;
        });
      }
    );
    return () => sub.remove();
  }, []);

  const activeOpacity = useRef(new Animated.Value(1)).current;
  const activeTranslateY = useRef(new Animated.Value(0)).current;
  /** Skip fade/slide on cold start — only animate when switching child afterwards. */
  const skipCaptureEnterAnimOnceRef = useRef(true);

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

        const limitCheck = await checkMemoryLimit(childId, { skipRemotePull: true });
        if (!limitCheck.canCreate) {
          promptFreeTierLimitThenPaywall({ kind: 'memories', router });
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

  const openEditChildProfile = useCallback(
    (target: Child) => {
      router.push(`/edit-child?childId=${target.id}`);
    },
    [router],
  );

  /** Soft snap : 2 positions (haut hero / bas CTA), retour amorti. */
  const captureSettlingRef = useRef(false);
  const settleCaptureScroll = useCallback(() => {
    if (captureSettlingRef.current) return;
    const y = captureScrollYRef.current;
    const maxY = captureScrollMaxYRef.current;
    if (maxY <= 8) {
      if (y > 1) {
        captureSettlingRef.current = true;
        captureScrollRef.current?.scrollTo({ y: 0, animated: true });
        setTimeout(() => {
          captureSettlingRef.current = false;
        }, 420);
      }
      return;
    }
    const mid = maxY * 0.45;
    const target = y < mid ? 0 : maxY;
    if (Math.abs(y - target) < 3) return;
    captureSettlingRef.current = true;
    captureScrollRef.current?.scrollTo({ y: target, animated: true });
    setTimeout(() => {
      captureSettlingRef.current = false;
    }, 420);
  }, []);

  const onCaptureScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    captureScrollYRef.current = e.nativeEvent.contentOffset.y;
  }, []);

  const captureViewportHRef = useRef(0);

  useEffect(() => {
    if (!child?.id) return;
    if (skipCaptureEnterAnimOnceRef.current) {
      skipCaptureEnterAnimOnceRef.current = false;
      activeOpacity.setValue(1);
      activeTranslateY.setValue(0);
      return;
    }
    activeOpacity.setValue(0.92);
    activeTranslateY.setValue(4);
    Animated.parallel([
      Animated.timing(activeOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.timing(activeTranslateY, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [child?.id, activeOpacity, activeTranslateY]);

  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle('dark');

      let cancelled = false;

      const run = async () => {
        const silent = childRef.current != null;
        try {
          if (!silent) setIsLoading(true);
          // Local-first : ID sélectionné + SQLite (getOrSelectFirstChild ne bloque plus sur le cloud).
          const storedSelectedId = await getOrSelectFirstChild();
          if (cancelled) return;

          /** Retour onglet : lecture SQLite légère (pas de ML / sanitize en boucle). */
          if (silent && storedSelectedId) {
            const sorted = sortChildrenByBirthdateAsc(listCaptureScopedChildren());
            if (!cancelled) setFamilyChildren(sorted);
            const row = getLocalChild(storedSelectedId);
            if (row && !cancelled) {
              // Ne pas écraser le snapshot / state si le hero est déjà le même fichier.
              setChild(prev => {
                if (captureChildDisplayEqual(prev, row)) return prev;
                setCaptureTabChildSnapshot(row);
                return row;
              });
              // Fond : sanitize path mort + cache photo cloud (sans bloquer le paint).
              void ensureChildFaceBounds(row).then(refreshed => {
                if (cancelled || !refreshed) return;
                setChild(prev => {
                  if (captureChildDisplayEqual(prev, refreshed)) return prev;
                  setCaptureTabChildSnapshot(refreshed);
                  return refreshed;
                });
                setFamilyChildren(sortChildrenByBirthdateAsc(listCaptureScopedChildren()));
              });
            }
            return;
          }

          /** SQLite uniquement — pas `await getChildren()` sur le chemin critique. */
          const allChildren = sortChildrenByBirthdateAsc(listCaptureScopedChildren());
          if (cancelled) return;
          setFamilyChildren(allChildren);

          if (storedSelectedId && allChildren.length > 0) {
            const selected = allChildren.find(c => c.id === storedSelectedId) ?? allChildren[0];
            if (!cancelled) {
              setCaptureTabChildSnapshot(selected);
              setChild(prev => (captureChildDisplayEqual(prev, selected) ? prev : selected));
              void ensureChildFaceBounds(selected).then(refreshed => {
                if (cancelled || !refreshed) return;
                setChild(prev => {
                  if (captureChildDisplayEqual(prev, refreshed)) return prev;
                  setCaptureTabChildSnapshot(refreshed);
                  return refreshed;
                });
                setFamilyChildren(sortChildrenByBirthdateAsc(listCaptureScopedChildren()));
              });
            }
          } else if (allChildren.length === 0) {
            setChild(null);
            // replace : évite une pile sans historique + GO_BACK si create-child est déjà la cible.
            router.replace('/create-child');
          } else if (!cancelled) {
            setCaptureTabChildSnapshot(allChildren[0]);
            setChild(prev => (captureChildDisplayEqual(prev, allChildren[0]) ? prev : allChildren[0]));
            void ensureChildFaceBounds(allChildren[0]).then(refreshed => {
              if (cancelled || !refreshed) return;
              setChild(prev => {
                if (captureChildDisplayEqual(prev, refreshed)) return prev;
                setCaptureTabChildSnapshot(refreshed);
                return refreshed;
              });
              setFamilyChildren(sortChildrenByBirthdateAsc(listCaptureScopedChildren()));
            });
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

  if (isLoading && !child) {
    return (
      <View style={[styles.root, styles.loadingContainer]}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color={THEME.textPrimary} />
      </View>
    );
  }

  if (!child || familyChildren.length === 0) {
    return (
      <View style={[styles.root, styles.loadingContainer]}>
        <StatusBar style="dark" />
        <TouchableOpacity onPress={() => router.push('/create-child')} activeOpacity={0.85}>
          <Text style={styles.ctaGhostText}>Créer un profil enfant</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const captureHeaderDate = formatCaptureHeaderDate();
  const captureBottomReserve = tabBarFloatingOverlapPad(insets.bottom);
  const childGivenName = childDisplayGivenName(child.name);
  const childAgeLabel = child.birthdate ? formatCaptureChildAge(child.birthdate) : '';
  const isFamilyMosaic = familyChildren.length > 1;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      <Animated.View
        style={[
          styles.mainColumn,
          {
            opacity: activeOpacity,
            transform: [{ translateY: activeTranslateY }],
          },
        ]}
      >
        <ScrollView
          ref={captureScrollRef}
          style={styles.captureScroll}
          contentContainerStyle={[
            styles.captureScrollContent,
            { paddingBottom: captureBottomReserve + verticalScale(20) },
          ]}
          showsVerticalScrollIndicator={false}
          bounces
          alwaysBounceVertical
          decelerationRate="normal"
          scrollEventThrottle={16}
          onScroll={onCaptureScroll}
          onLayout={e => {
            captureViewportHRef.current = e.nativeEvent.layout.height;
          }}
          onContentSizeChange={(_w, h) => {
            captureScrollMaxYRef.current = Math.max(0, h - captureViewportHRef.current);
          }}
          onScrollEndDrag={settleCaptureScroll}
          onMomentumScrollEnd={settleCaptureScroll}
        >
          <View style={{ paddingTop: insets.top + verticalScale(8) }}>
            <View style={styles.capturePageHeader}>
              <View style={styles.captureHeaderLeading}>
                <Text
                  style={[
                    styles.captureHeaderDate,
                    loadedFontStyle(captureTitleFont) ?? { fontWeight: '500' },
                  ]}
                  accessibilityRole="header"
                >
                  {captureHeaderDate}
                </Text>
              </View>
              <View style={styles.captureHeaderTrailing}>
                <SettingsHeaderButton size={CAPTURE_HEADER_ROW_H} />
              </View>
              <View
                style={styles.captureHeaderLogoAbsolute}
                pointerEvents="none"
                accessible
                accessibilityRole="header"
                accessibilityLabel="Petitmo"
              >
                <PetitmoLogoManuscrit
                  width={scale(100)}
                  height={scale(30)}
                  color={THEME.textTertiary}
                />
              </View>
            </View>
          </View>

          <View
            style={[
              styles.capturePhotoBleed,
              compact && styles.capturePhotoBleedCompact,
            ]}
          >
          <View
            style={[
              styles.capturePhotoCard,
              compact && styles.capturePhotoCardCompact,
            ]}
          >
            {isFamilyMosaic ? (
              <CaptureFamilyMosaic
                familyChildren={familyChildren}
                onPressChild={openEditChildProfile}
                nameFontFamily={capturePhotoPillNameFont ?? captureSubtitleFont}
                ageFontFamily={captureSubtitleFont}
                style={StyleSheet.absoluteFillObject}
              />
            ) : (
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
                    reactKey={`capture-hero-${child.id}`}
                    imageRevision={heroPhotoCacheKey}
                    isTabFocused={isTabFocused}
                  />
                ) : (
                  <View style={[StyleSheet.absoluteFillObject, styles.heroPlaceholder]}>
                    <Text style={styles.heroPlaceholderText}>{childDisplayInitial(child.name)}</Text>
                  </View>
                )}
                <View style={styles.capturePhotoPillsBar} pointerEvents="none">
                  <CapturePhotoGlassPill
                    label={childGivenName || 'Enfant'}
                    labelFontFamily={capturePhotoPillNameFont ?? captureSubtitleFont}
                    emphasized
                    align="left"
                  />
                  {childAgeLabel ? (
                    <CapturePhotoGlassPill
                      label={childAgeLabel}
                      labelFontFamily={captureSubtitleFont}
                      align="right"
                      accentDot
                    />
                  ) : null}
                </View>
              </TouchableOpacity>
            )}
            {!isFamilyMosaic ? (
              <>
                <LinearGradient
                  colors={['rgba(0, 0, 0, 0)', 'rgba(28, 28, 30, 0.18)', 'rgba(28, 28, 30, 0.55)']}
                  locations={[0, 0.42, 1]}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 1 }}
                  pointerEvents="none"
                  style={styles.capturePhotoBottomScrim}
                />
                <View style={styles.capturePhotoTagline} pointerEvents="none">
                  <Text
                    style={[
                      styles.capturePhotoTaglineText,
                      loadedFontStyle(captureTaglineFont) ?? {
                        fontWeight: '300',
                        fontStyle: 'italic',
                      },
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.85}
                  >
                    {CAPTURE_HERO_TAGLINE}
                  </Text>
                </View>
              </>
            ) : null}
          </View>
          </View>

          <View
            style={[
              styles.captureLowerSection,
              compact && styles.captureLowerSectionCompact,
            ]}
          >
            <View style={styles.captureContentSection} accessibilityRole="header">
              <View style={styles.captureTitleRow}>
                <Text
                  style={[
                    styles.captureTitle,
                    loadedFontStyle(captureTitleFont) ?? { fontWeight: '500' },
                  ]}
                >
                  Quel souvenir pour{' '}
                  {isFamilyMosaic ? 'votre famille' : childGivenName || "l'enfant"}{' '}
                </Text>
                <Heart
                  size={CAPTURE_TITLE_HEART_SIZE}
                  color={CAPTURE_SCREEN_ACCENT}
                  fill={CAPTURE_SCREEN_ACCENT}
                  style={styles.captureTitleHeart}
                />
                <Text
                  style={[
                    styles.captureTitle,
                    styles.captureTitleBold,
                    loadedFontStyle(captureTitleBoldFont) ?? { fontWeight: '700' },
                  ]}
                >
                  aujourd&apos;hui ?
                </Text>
              </View>
              <Text
                style={[
                  styles.captureSubtitle,
                  loadedFontStyle(captureSubtitleFont),
                ]}
              >
                Écris, enregistre ou importe photos et vidéos
              </Text>
            </View>

            <View style={[styles.captureCtaRow, compact && styles.captureCtaRowCompact]}>
            <CaptureDiscCta
              label="Enregistrer"
              labelFontFamily={captureCtaLabelFont}
              accessibilityLabel="Enregistrer un audio"
              discColor={THEME.captureRecordCtaBackground}
              discBorderColor={CAPTURE_SCREEN_RECORD_ACCENT}
              discBorderWidth={StyleSheet.hairlineWidth}
              haloColor={CAPTURE_SCREEN_RECORD_ACCENT}
              icon={
                <MicIcon
                  size={compact ? CAPTURE_CTA_MIC_ICON_SIZE_COMPACT : CAPTURE_CTA_MIC_ICON_SIZE}
                  color={CAPTURE_SCREEN_RECORD_ACCENT}
                />
              }
              onPress={() => handleCaptureCtaPress('/record-voice')}
              compact={compact}
              haptic="light"
            />
            <CaptureDiscCta
              label="Écrire"
              labelFontFamily={captureCtaLabelFont}
              discColor={CAPTURE_SCREEN_ACCENT}
              haloColor={CAPTURE_SCREEN_ACCENT}
              icon={
                <PenIcon
                  size={compact ? CAPTURE_CTA_ICON_SIZE_COMPACT : CAPTURE_CTA_ICON_SIZE}
                  color="#FFFFFF"
                />
              }
              onPress={() => handleCaptureCtaPress('/write')}
              compact={compact}
            />
            <CaptureDiscCta
              label="Importer"
              labelFontFamily={captureCtaLabelFont}
              accessibilityLabel="Importer des photos ou vidéos"
              discColor={THEME.captureImportCtaBackground}
              haloColor={THEME.captureImportCtaBackground}
              icon={
                <ImageImportIcon
                  size={compact ? CAPTURE_CTA_ICON_SIZE_COMPACT : CAPTURE_CTA_ICON_SIZE}
                  color="#FFFFFF"
                />
              }
              onPress={() => handleCaptureCtaPress('/import-media')}
              compact={compact}
              haptic="light"
            />
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
    backgroundColor: CAPTURE_SCREEN_BG,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: CAPTURE_SCREEN_BG,
  },
  mainColumn: {
    flex: 1,
    width: SCREEN_W,
    minHeight: 0,
    backgroundColor: CAPTURE_SCREEN_BG,
  },
  captureScroll: {
    flex: 1,
    backgroundColor: CAPTURE_SCREEN_BG,
  },
  captureScrollContent: {
    flexGrow: 1,
    paddingHorizontal: CAPTURE_CONTENT_PADDING_H,
  },
  capturePageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'relative',
    minHeight: CAPTURE_HEADER_ROW_H,
    marginBottom: verticalScale(12),
    overflow: 'visible',
  },
  captureHeaderLeading: {
    flexShrink: 1,
    maxWidth: '40%',
    zIndex: 1,
  },
  captureHeaderDate: {
    fontSize: CAPTURE_HEADER_DATE_FONT_SIZE,
    lineHeight: CAPTURE_HEADER_DATE_LINE_HEIGHT,
    color: THEME.textPrimary,
    letterSpacing: -0.3,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  /** Centré sur la largeur écran — indépendant de la longueur de la date. */
  captureHeaderLogoAbsolute: {
    position: 'absolute',
    left: -CAPTURE_CONTENT_PADDING_H,
    right: -CAPTURE_CONTENT_PADDING_H,
    top: 0,
    height: CAPTURE_HEADER_ROW_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureHeaderTrailing: {
    width: CAPTURE_HEADER_ROW_H,
    height: CAPTURE_HEADER_ROW_H,
    zIndex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capturePhotoBleed: {
    width: SCREEN_W,
    marginLeft: -CAPTURE_CONTENT_PADDING_H,
    paddingHorizontal: CAPTURE_PHOTO_EDGE_PADDING_H,
    marginBottom: verticalScale(10),
  },
  capturePhotoBleedCompact: {
    marginBottom: verticalScale(8),
  },
  capturePhotoCard: {
    width: '100%',
    aspectRatio: CAPTURE_PHOTO_CARD_ASPECT,
    borderRadius: CAPTURE_PHOTO_CARD_RADIUS,
    overflow: 'hidden',
    backgroundColor: CAPTURE_SCREEN_BG,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: verticalScale(8) },
        shadowOpacity: 0.12,
        shadowRadius: scale(16),
      },
      android: {
        elevation: 6,
      },
      default: {},
    }),
  },
  capturePhotoCardCompact: {
    aspectRatio: CAPTURE_PHOTO_CARD_ASPECT_COMPACT,
  },
  capturePhotoPillsBar: {
    position: 'absolute',
    top: scale(12),
    left: scale(12),
    right: scale(12),
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    zIndex: 4,
    gap: scale(8),
  },
  capturePhotoPill: {
    flexShrink: 1,
    maxWidth: '48%',
    borderRadius: scale(999),
    overflow: 'hidden',
    paddingHorizontal: scale(14),
    paddingVertical: verticalScale(7),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  capturePhotoPillFallback: {
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  capturePhotoPillInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(6),
  },
  capturePhotoPillAccentDot: {
    width: scale(6),
    height: scale(6),
    borderRadius: scale(3),
    backgroundColor: CAPTURE_SCREEN_ACCENT,
  },
  capturePhotoPillText: {
    fontSize: scale(12),
    lineHeight: scale(16),
    fontWeight: '500',
    color: '#FFFFFF',
    textAlign: 'left',
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  capturePhotoPillTextEmphasized: {
    fontWeight: '700',
  },
  capturePhotoPillTextRight: {
    textAlign: 'right',
  },
  capturePhotoBottomScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '40%',
    zIndex: 3,
  },
  capturePhotoTagline: {
    position: 'absolute',
    left: scale(16),
    right: scale(16),
    bottom: verticalScale(18),
    zIndex: 4,
  },
  capturePhotoTaglineText: {
    fontSize: scale(15),
    lineHeight: scale(20),
    color: '#FFFFFF',
    textShadowColor: 'rgba(0, 0, 0, 0.22)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  /** Bande sous la photo : titre en haut, CTAs centrés verticalement avant la tab bar. */
  captureLowerSection: {
    flex: 1,
    width: '100%',
    justifyContent: 'space-between',
    paddingTop: verticalScale(6),
    minHeight: verticalScale(168),
  },
  captureLowerSectionCompact: {
    minHeight: verticalScale(148),
    paddingTop: verticalScale(4),
  },
  captureContentSection: {
    width: '100%',
    alignItems: 'flex-start',
  },
  captureTitle: {
    fontSize: CAPTURE_TITLE_FONT_SIZE,
    lineHeight: CAPTURE_TITLE_LINE_HEIGHT,
    color: THEME.textPrimary,
    textAlign: 'left',
    letterSpacing: -0.2,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  captureTitleBold: {},
  captureTitleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    alignSelf: 'stretch',
  },
  captureTitleHeart: {
    marginHorizontal: scale(4),
    marginBottom: scale(1),
  },
  captureSubtitle: {
    marginTop: verticalScale(6),
    fontSize: scale(13),
    lineHeight: scale(18),
    color: THEME.textMuted,
    letterSpacing: -0.1,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  captureCtaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: scale(26),
    width: '100%',
    paddingTop: verticalScale(12),
    paddingBottom: verticalScale(4),
  },
  captureCtaRowCompact: {
    gap: scale(20),
  },
  captureCtaTouch: {
    alignItems: 'center',
    gap: verticalScale(10),
    maxWidth: CAPTURE_CTA_SIZE + scale(16),
    paddingHorizontal: scale(6),
  },
  captureCtaDisc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureCtaLabel: {
    fontSize: scale(12),
    lineHeight: scale(14),
    color: THEME.captureCtaLabelColor,
    letterSpacing: 0.15,
    textAlign: 'center',
    maxWidth: '100%',
    paddingHorizontal: scale(2),
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  captureCtaLabelCompact: {
    fontSize: scale(12),
    lineHeight: scale(15),
  },
  heroImageClip: {
    overflow: 'hidden',
    backgroundColor: CAPTURE_SCREEN_BG,
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
  /** Change quand la photo est remplacée → invalide le cache expo-image sans remonter toute la carte. */
  imageRevision: string;
};

/** Photo hero plein cadre + léger zoom « respiration ». */
function CaptureHeroImageStack({
  photoUri,
  reactKey,
  imageRevision,
  isTabFocused,
}: CaptureHeroImageStackProps & { isTabFocused: boolean }) {
  const breatheScale = useRef(new Animated.Value(CAPTURE_HERO_BREATHE_MIN)).current;
  const [imageReady, setImageReady] = useState(false);
  const lastReadyUriRef = useRef('');

  useEffect(() => {
    // Ne masquer que si l’URI visuelle change vraiment — ignorer `?petitmo_v=` / signatures.
    const strip = (u: string) =>
      u
        .replace(/[?&]petitmo_v=[^&]*/gi, '')
        .replace(/[?&]token=[^&]*/gi, '')
        .replace(/[?&]X-Amz-[^=]+=[^&]*/gi, '')
        .replace(/\?&+/, '?')
        .replace(/[?&]$/, '');
    if (strip(lastReadyUriRef.current) === strip(photoUri) && photoUri.trim()) {
      // Même path + révision (fichier écrasé) : garder opaque, ExpoImage recycle via recyclingKey.
      setImageReady(true);
      lastReadyUriRef.current = photoUri;
      return;
    }
    const prev = lastReadyUriRef.current;
    const next = photoUri.trim();
    const upgradingRemoteToLocal =
      !!prev &&
      /^https?:\/\//i.test(prev) &&
      !!next &&
      (next.startsWith('file:') ||
        next.startsWith('content:') ||
        next.startsWith('ph://'));
    const sameRemoteHost =
      !!prev &&
      /^https?:\/\//i.test(prev) &&
      !!next &&
      /^https?:\/\//i.test(next);
    // Cache sandbox après sync / URL signée : garder l’image affichée.
    if (!upgradingRemoteToLocal && !sameRemoteHost) {
      setImageReady(false);
    }
  }, [photoUri, imageRevision]);

  useEffect(() => {
    breatheScale.setValue(CAPTURE_HERO_BREATHE_MIN);
    if (!isTabFocused || CAPTURE_HERO_BREATHE_MAX <= CAPTURE_HERO_BREATHE_MIN) {
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
  }, [reactKey, breatheScale, isTabFocused]);

  /**
   * ExpoImage peut peindre 1 frame à taille intrinsèque (miniature bas-gauche)
   * avant le layout cover — on masque jusqu’à `onLoad` **uniquement** au 1er paint d’une URI.
   */
  return (
    <View style={[StyleSheet.absoluteFillObject, styles.heroImageClip]} pointerEvents="box-none" collapsable={false}>
      <Animated.View
        style={[StyleSheet.absoluteFillObject, { transform: [{ scale: breatheScale }] }]}
        collapsable={false}
      >
        {Platform.OS === 'web' ? (
          <ImageBackground
            source={{ uri: photoUri }}
            style={StyleSheet.absoluteFillObject}
            imageStyle={styles.heroImageCover}
            resizeMode="cover"
          />
        ) : (
          <ExpoImage
            source={{ uri: photoUri }}
            style={[
              StyleSheet.absoluteFillObject,
              styles.heroImageCover,
              { opacity: imageReady ? 1 : 0 },
            ]}
            contentFit="cover"
            contentPosition={CAPTURE_HERO_IMAGE_CONTENT_POSITION}
            cachePolicy="memory-disk"
            recyclingKey={`${reactKey}-${imageRevision}`}
            priority="high"
            transition={0}
            onLoad={() => {
              lastReadyUriRef.current = photoUri;
              setImageReady(true);
            }}
            accessibilityIgnoresInvertColors
          />
        )}
      </Animated.View>
    </View>
  );
}

export default function CapturerScreenTab() {
  return (
    <TabSceneTransition backgroundColor={CAPTURE_SCREEN_BG}>
      <CapturerScreen />
    </TabSceneTransition>
  );
}
