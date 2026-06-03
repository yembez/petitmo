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
} from 'react-native';
import { useSafeAreaInsets, useSafeAreaFrame } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { Image as ExpoImage } from 'expo-image';
import { BlurView } from 'expo-blur';
import { Heart, Menu } from 'lucide-react-native';
import ImageImportIcon from '@/components/ImageImportIcon';
import MicIcon from '@/components/MicIcon';
import PenIcon from '@/components/PenIcon';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useFonts, Sora_600SemiBold } from '@expo-google-fonts/sora';

import { Manrope_400Regular, Manrope_700Bold } from '@expo-google-fonts/manrope';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans';

/** Tailles maquette capture (px logiques). */
const CAPTURE_TITLE_FONT_SIZE = 18;
const CAPTURE_TITLE_LINE_HEIGHT = 24;
const CAPTURE_TITLE_HEART_SIZE = scale(16);
const CAPTURE_HEADER_DATE_FONT_SIZE = 20;
const CAPTURE_HEADER_DATE_LINE_HEIGHT = 24;
/** Hauteur de la ligne date / logo / menu (alignés sur le bouton burger). */
const CAPTURE_HEADER_ROW_H = scale(40);

import { tabBarFloatingOverlapPad } from '@/constants/tabBarLayout';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import {
  getOrSelectFirstChild,
  getCaptureTabChildSnapshot,
  PETITMO_CHILD_PROFILE_UPDATED_EVENT,
  setCaptureTabChildSnapshot,
  type ChildProfileUpdatedPayload,
} from '@/services/children';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';
import type { Child } from '@/types/local';
import PetitmoLogoManuscrit, { PETITMO_LOGO_VIEWBOX } from '@/components/PetitmoLogoManuscrit';
import { checkMemoryLimit } from '@/lib/limits';
import { getLocalChild, listLocalChildren } from '@/lib/localDb';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { resolveChildProfileImageDisplayUri } from '@/utils/childPhotoUri';
import { childDisplayGivenName, childDisplayInitial } from '@/utils/childDisplayName';
import { formatCaptureChildAge, formatCaptureHeaderDate } from '@/utils/date';
import { CAPTURE_HERO_COLOR_MATRIX } from '@/utils/captureHeroColorMatrix';
import {
  CAPTURE_HERO_IMAGE_CONTENT_POSITION,
  CAPTURE_HERO_IMAGE_OBJECT_POSITION,
} from '@/utils/captureHeroMetrics';
import { ColorMatrix } from 'react-native-color-matrix-image-filters';

const { width: SCREEN_W } = Dimensions.get('window');

/** Zoom « respiration » sur la photo carte (1 → max). */
const CAPTURE_HERO_BREATHE_MIN = 1;
const CAPTURE_HERO_BREATHE_MAX = 1.03;
const CAPTURE_HERO_BREATHE_HALF_MS = 8500;

const CAPTURE_PHOTO_CARD_RADIUS = scale(32);
const CAPTURE_PHOTO_CARD_ASPECT = 0.93;
const CAPTURE_PHOTO_CARD_ASPECT_COMPACT = 0.85;
/** Padding horizontal du scroll ; la photo utilise `capturePhotoBleed` pour des bords symétriques. */
const CAPTURE_CONTENT_PADDING_H = scale(20);
const CAPTURE_PHOTO_EDGE_PADDING_H = scale(14);

const CAPTURE_CTA_SIZE = scale(78);
const CAPTURE_CTA_SIZE_COMPACT = scale(64);
const CAPTURE_CTA_ICON_SIZE = scale(34);
const CAPTURE_CTA_ICON_SIZE_COMPACT = scale(29);
const CAPTURE_CTA_MIC_ICON_SIZE = scale(38);
const CAPTURE_CTA_MIC_ICON_SIZE_COMPACT = scale(32);

type CaptureRoute = '/write' | '/record-voice' | '/import-media';

/** Révision photo (chemins + date) — `updated_at` change à chaque upload même si le chemin fichier est identique. */
function captureHeroPhotoRevision(child: Child): string {
  return `${(child.local_photo_path ?? '').trim()}|${(child.photo_url ?? '').trim()}|${(child.updated_at ?? '').trim()}`;
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
          labelFontFamily ? { fontFamily: labelFontFamily } : emphasized ? { fontWeight: '700' } : null,
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
  onPress: () => void;
  labelFontFamily?: string;
  compact?: boolean;
  accessibilityLabel?: string;
  haptic?: 'light' | 'medium';
}) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const ctaSize = compact ? CAPTURE_CTA_SIZE_COMPACT : CAPTURE_CTA_SIZE;

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
          },
        ]}
      >
        {icon}
      </Animated.View>
      <Text
        style={[
          styles.captureCtaLabel,
          compact && styles.captureCtaLabelCompact,
          labelFontFamily ? { fontFamily: labelFontFamily } : null,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

export default function CapturerScreen() {
  const router = useRouter();
  const isTabFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const { height: windowH } = useWindowDimensions();

  const [captureFontsLoaded] = useFonts({
    Sora_600SemiBold,
    Manrope_400Regular,
    Manrope_700Bold,
    DMSans_500Medium,
  });
  const captureTitleFont = captureFontsLoaded ? 'Sora_600SemiBold' : undefined;
  const captureSubtitleFont = captureFontsLoaded ? 'Manrope_400Regular' : undefined;
  const capturePhotoPillNameFont = captureFontsLoaded ? 'Manrope_700Bold' : undefined;
  const captureCtaLabelFont = captureFontsLoaded ? 'DMSans_500Medium' : undefined;
  const usableH = Math.max(280, windowH);
  const layoutH = Math.min(frame.height > 1 ? frame.height : usableH, usableH);
  const compact = layoutH < 600;

  const [child, setChild] = useState<Child | null>(() => {
    const snap = getCaptureTabChildSnapshot();
    if (snap) return snap;
    hydrateTabScreensFromSqliteSync();
    return getCaptureTabChildSnapshot();
  });
  const [isLoading, setIsLoading] = useState(() => child === null);
  const childRef = useRef<Child | null>(null);
  childRef.current = child;

  const heroDisplayUri = child
    ? resolveChildProfileImageDisplayUri(
        child.local_photo_path,
        child.photo_url,
        child.updated_at,
      )
    : null;
  const heroIsLocalAsset =
    !!heroDisplayUri &&
    (heroDisplayUri.startsWith('file:') ||
      heroDisplayUri.startsWith('content:') ||
      heroDisplayUri.startsWith('ph://') ||
      (!heroDisplayUri.startsWith('http://') && !heroDisplayUri.startsWith('https://')));
  const heroRemoteBase =
    child && !heroIsLocalAsset
      ? resolveChildProfileImageDisplayUri(null, child.photo_url, child.updated_at)
      : null;
  const heroSignedRemote = useSignedMediaUrl(heroRemoteBase);
  const photoUri = heroDisplayUri
    ? heroIsLocalAsset
      ? heroDisplayUri
      : heroSignedRemote ?? heroDisplayUri
    : '';
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
        const id = payload?.childId?.trim();
        if (!id || childRef.current?.id !== id) return;
        const next =
          payload.child?.id === id ? payload.child : getLocalChild(id);
        if (!next) return;
        setCaptureTabChildSnapshot(next);
        setChild(prev => (captureChildDisplayEqual(prev, next) ? prev : next));
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
      setStatusBarStyle('dark');

      let cancelled = false;

      const run = async () => {
        const silent = childRef.current != null;
        try {
          if (!silent) setIsLoading(true);
          const storedSelectedId = await getOrSelectFirstChild();
          if (cancelled) return;

          /** Retour onglet : lecture SQLite légère (pas de ML / sanitize en boucle). */
          if (silent && storedSelectedId) {
            const row = getLocalChild(storedSelectedId);
            if (row && !cancelled) {
              setCaptureTabChildSnapshot(row);
              setChild(prev => (captureChildDisplayEqual(prev, row) ? prev : row));
            }
            return;
          }

          /** SQLite uniquement — pas `getChildren()` (évite ML face bounds + sanitize async). */
          const allChildren = listLocalChildren();
          if (cancelled) return;

          if (storedSelectedId && allChildren.length > 0) {
            const selected = allChildren.find(c => c.id === storedSelectedId) ?? allChildren[0];
            if (!cancelled) {
              setChild(prev => (captureChildDisplayEqual(prev, selected) ? prev : selected));
            }
          } else if (allChildren.length === 0) {
            setChild(null);
            router.push('/create-child');
          } else if (!cancelled) {
            setChild(prev => (captureChildDisplayEqual(prev, allChildren[0]) ? prev : allChildren[0]));
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

  const headerMenuIconSize = scale(22);
  const captureLogoH = scale(36);
  const captureLogoW = captureLogoH * (PETITMO_LOGO_VIEWBOX.width / PETITMO_LOGO_VIEWBOX.height);
  const captureHeaderDate = formatCaptureHeaderDate();
  const captureBottomReserve = tabBarFloatingOverlapPad(insets.bottom);
  const childGivenName = childDisplayGivenName(child.name);
  const childAgeLabel = child.birthdate ? formatCaptureChildAge(child.birthdate) : '';

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
          style={styles.captureScroll}
          contentContainerStyle={[
            styles.captureScrollContent,
            { paddingBottom: captureBottomReserve + verticalScale(20) },
          ]}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={{ paddingTop: insets.top + verticalScale(8) }}>
            <View style={styles.capturePageHeader}>
              <View style={styles.captureHeaderLeading}>
                <Text
                  style={[
                    styles.captureHeaderDate,
                    captureTitleFont ? { fontFamily: captureTitleFont } : { fontWeight: '600' },
                  ]}
                  accessibilityRole="header"
                >
                  {captureHeaderDate}
                </Text>
              </View>
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
              <View style={styles.captureHeaderLogoAbsolute} pointerEvents="none">
                <PetitmoLogoManuscrit
                  width={captureLogoW}
                  height={captureLogoH}
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
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={openEditChild}
            style={[
              styles.capturePhotoCard,
              compact && styles.capturePhotoCardCompact,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Modifier le profil de l'enfant"
          >
            {photoUri ? (
              <CaptureHeroImageStack
                photoUri={photoUri}
                reactKey={`capture-hero-${child.id}`}
                imageRevision={heroPhotoCacheKey}
                isTabFocused={isTabFocused}
                instantReveal={heroIsLocalAsset}
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
          </View>

          <View
            style={[
              styles.captureTitleBridge,
              compact && styles.captureTitleBridgeCompact,
            ]}
          >
            <View style={styles.captureContentSection} accessibilityRole="header">
              <View style={styles.captureTitleRow}>
                <Text
                  style={[
                    styles.captureTitle,
                    captureTitleFont ? { fontFamily: captureTitleFont } : { fontWeight: '600' },
                  ]}
                >
                  Quel souvenir pour {childGivenName || "l'enfant"}{' '}
                </Text>
                <Heart
                  size={CAPTURE_TITLE_HEART_SIZE}
                  color={THEME.captureDiscCtaBackground}
                  fill={THEME.captureDiscCtaBackground}
                  style={styles.captureTitleHeart}
                />
                <Text
                  style={[
                    styles.captureTitle,
                    captureTitleFont ? { fontFamily: captureTitleFont } : { fontWeight: '600' },
                  ]}
                >
                  aujourd&apos;hui ?
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.captureCtaRow, compact && styles.captureCtaRowCompact]}>
            <CaptureDiscCta
              label="Enregistrer"
              labelFontFamily={captureCtaLabelFont}
              accessibilityLabel="Enregistrer un audio"
              discColor={THEME.captureRecordCtaBackground}
              discBorderColor={THEME.captureRecordCtaBorderColor}
              discBorderWidth={StyleSheet.hairlineWidth}
              icon={
                <MicIcon
                  size={compact ? CAPTURE_CTA_MIC_ICON_SIZE_COMPACT : CAPTURE_CTA_MIC_ICON_SIZE}
                  color={THEME.brandCtaOrange}
                />
              }
              onPress={() => handleCaptureCtaPress('/record-voice')}
              compact={compact}
              haptic="light"
            />
            <CaptureDiscCta
              label="Écrire"
              labelFontFamily={captureCtaLabelFont}
              discColor={THEME.captureWriteCtaBackground}
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
              icon={
                <ImageImportIcon
                  size={compact ? CAPTURE_CTA_ICON_SIZE_COMPACT : CAPTURE_CTA_ICON_SIZE}
                  color={THEME.captureCtaIconColor}
                />
              }
              onPress={() => handleCaptureCtaPress('/import-media')}
              compact={compact}
              haptic="light"
            />
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
    backgroundColor: THEME.captureScreenBg,
  },
  captureScroll: {
    flex: 1,
    backgroundColor: THEME.captureScreenBg,
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
  captureHeaderMenuHit: {
    zIndex: 1,
    width: CAPTURE_HEADER_ROW_H,
    height: CAPTURE_HEADER_ROW_H,
    borderRadius: scale(20),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
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
    backgroundColor: THEME.captureScreenBg,
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
    backgroundColor: THEME.captureDiscCtaBackground,
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
  captureTitleBridge: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    minHeight: verticalScale(52),
  },
  captureTitleBridgeCompact: {
    minHeight: verticalScale(40),
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
  captureCtaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: scale(26),
    width: '100%',
    paddingBottom: verticalScale(8),
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
  heroImageMatrixWrap: {
    backgroundColor: THEME.captureScreenBg,
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
  instantReveal = false,
}: CaptureHeroImageStackProps & { isTabFocused: boolean; instantReveal?: boolean }) {
  const breatheScale = useRef(new Animated.Value(CAPTURE_HERO_BREATHE_MIN)).current;

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
          <ColorMatrix
            matrix={CAPTURE_HERO_COLOR_MATRIX}
            style={[StyleSheet.absoluteFillObject, styles.heroImageMatrixWrap]}
          >
            <ExpoImage
              source={{ uri: photoUri }}
              style={[StyleSheet.absoluteFillObject, styles.heroImageCover]}
              contentFit="cover"
              contentPosition={CAPTURE_HERO_IMAGE_CONTENT_POSITION}
              cachePolicy="memory-disk"
              recyclingKey={`${reactKey}-${imageRevision}`}
              priority="high"
              transition={instantReveal ? 0 : 200}
              accessibilityIgnoresInvertColors
            />
          </ColorMatrix>
        )}
      </Animated.View>
    </View>
  );
}
