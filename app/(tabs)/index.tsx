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
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Heart, Menu } from 'lucide-react-native';
import ImageImportIcon from '@/components/ImageImportIcon';
import MicIcon from '@/components/MicIcon';
import PenIcon from '@/components/PenIcon';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import * as Haptics from 'expo-haptics';
import { useFonts, Sora_600SemiBold } from '@expo-google-fonts/sora';

const CAPTURE_PHOTO_TAGLINE_FONT = 'Sora-LightItalic';
import { Manrope_400Regular, Manrope_700Bold } from '@expo-google-fonts/manrope';
import { DMSans_500Medium } from '@expo-google-fonts/dm-sans';

/** Tailles maquette capture (px logiques). */
const CAPTURE_TITLE_FONT_SIZE = 15;
const CAPTURE_TITLE_LINE_HEIGHT = 20;
const CAPTURE_SUBTITLE_FONT_SIZE = 11;
const CAPTURE_SUBTITLE_LINE_HEIGHT = 15;
const CAPTURE_HEADER_DATE_FONT_SIZE = 20;
const CAPTURE_HEADER_DATE_LINE_HEIGHT = 24;

const CAPTURE_PHOTO_TAGLINE =
  '\u201CAvec toi, l\'ordinaire devient extraordinaire.\u201D';
const CAPTURE_PHOTO_TAGLINE_FONT_SIZE = 13;
const CAPTURE_PHOTO_TAGLINE_LINE_HEIGHT = 18;

const CAPTURE_PHOTO_TAGLINE_GRADIENT = [
  'rgba(0, 0, 0, 0)',
  'rgba(0, 0, 0, 0.28)',
  'rgba(0, 0, 0, 0.52)',
] as const;
import { tabBarFloatingOverlapPad } from '@/constants/tabBarLayout';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
import {
  getChildren,
  getOrSelectFirstChild,
  getCaptureTabChildSnapshot,
  PETITMO_CHILD_PROFILE_UPDATED_EVENT,
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

const CAPTURE_CTA_SIZE = scale(68);
const CAPTURE_CTA_SIZE_COMPACT = scale(58);
const CAPTURE_CTA_ICON_SIZE = scale(30);
const CAPTURE_CTA_ICON_SIZE_COMPACT = scale(26);
const CAPTURE_CTA_MIC_ICON_SIZE = scale(34);
const CAPTURE_CTA_MIC_ICON_SIZE_COMPACT = scale(28);

type CaptureRoute = '/write' | '/record-voice' | '/import-media';

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
  onPress,
  labelFontFamily,
  compact = false,
  accessibilityLabel,
  haptic = 'medium',
}: {
  label: string;
  icon: React.ReactNode;
  discColor: string;
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
    [CAPTURE_PHOTO_TAGLINE_FONT]: require('@/assets/fonts/Sora-LightItalic.ttf'),
    Manrope_400Regular,
    Manrope_700Bold,
    DMSans_500Medium,
  });
  const captureTitleFont = captureFontsLoaded ? 'Sora_600SemiBold' : undefined;
  const capturePhotoTaglineFont = captureFontsLoaded ? CAPTURE_PHOTO_TAGLINE_FONT : undefined;
  const captureSubtitleFont = captureFontsLoaded ? 'Manrope_400Regular' : undefined;
  const capturePhotoPillNameFont = captureFontsLoaded ? 'Manrope_700Bold' : undefined;
  const captureCtaLabelFont = captureFontsLoaded ? 'DMSans_500Medium' : undefined;
  const usableH = Math.max(280, windowH);
  const layoutH = Math.min(frame.height > 1 ? frame.height : usableH, usableH);
  const compact = layoutH < 600;

  const [child, setChild] = useState<Child | null>(() => getCaptureTabChildSnapshot());
  const [isLoading, setIsLoading] = useState(() => getCaptureTabChildSnapshot() === null);
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
  /** Comme le fil : `petitmo_v` sur fichier local quand la photo est remplacée au même chemin. */
  const photoUri = heroDisplayUri
    ? heroIsLocalAsset
      ? heroDisplayUri
      : heroSignedRemote ?? heroDisplayUri
    : '';

  useEffect(() => {
    setCaptureTabChildSnapshot(child);
  }, [child]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      PETITMO_CHILD_PROFILE_UPDATED_EVENT,
      (payload: ChildProfileUpdatedPayload) => {
        const id = payload?.childId?.trim();
        if (!id || childRef.current?.id !== id) return;
        if (payload.child?.id === id) {
          setChild(payload.child);
          return;
        }
        const row = getLocalChild(id);
        if (row) setChild(row);
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
              setChild(prev => {
                if (
                  prev?.id === row.id &&
                  prev.local_photo_path === row.local_photo_path &&
                  prev.photo_url === row.photo_url &&
                  prev.name === row.name &&
                  prev.birthdate === row.birthdate &&
                  prev.updated_at === row.updated_at
                ) {
                  return prev;
                }
                return row;
              });
            }
            return;
          }

          const allChildren = await getChildren();
          if (cancelled) return;

          if (storedSelectedId && allChildren.length > 0) {
            const selected = allChildren.find(c => c.id === storedSelectedId) ?? allChildren[0];
            if (!cancelled) setChild(selected);
          } else if (allChildren.length === 0) {
            setChild(null);
            router.push('/create-child');
          } else {
            if (!cancelled) setChild(allChildren[0]);
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

  const headerMenuIconSize = scale(22);
  const captureLogoH = scale(28);
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
          <View
            style={[
              styles.capturePageHeader,
              { paddingTop: insets.top + verticalScale(8) },
            ]}
          >
            <Text
              style={[
                styles.captureHeaderDate,
                captureTitleFont ? { fontFamily: captureTitleFont } : { fontWeight: '600' },
              ]}
              accessibilityRole="header"
            >
              {captureHeaderDate}
            </Text>
            <View style={styles.capturePageHeaderRight}>
              <PetitmoLogoManuscrit
                width={captureLogoW}
                height={captureLogoH}
                color={THEME.textPrimary}
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
                imageRevision={child.updated_at ?? child.id}
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
            <LinearGradient
              colors={[...CAPTURE_PHOTO_TAGLINE_GRADIENT]}
              locations={[0, 0.5, 1]}
              pointerEvents="none"
              style={styles.capturePhotoTaglineGradient}
            />
            <View style={styles.capturePhotoTaglineWrap} pointerEvents="none">
              <Text
                style={[
                  styles.capturePhotoTagline,
                  compact && styles.capturePhotoTaglineCompact,
                  capturePhotoTaglineFont ? { fontFamily: capturePhotoTaglineFont } : null,
                ]}
              >
                {CAPTURE_PHOTO_TAGLINE}
              </Text>
            </View>
          </TouchableOpacity>
          </View>

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
                size={scale(14)}
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
            <Text
              style={[
                styles.captureSubtitle,
                compact && styles.captureSubtitleCompact,
                captureSubtitleFont ? { fontFamily: captureSubtitleFont } : null,
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
              discColor={THEME.captureDiscCtaBackground}
              icon={
                <MicIcon
                  size={compact ? CAPTURE_CTA_MIC_ICON_SIZE_COMPACT : CAPTURE_CTA_MIC_ICON_SIZE}
                  color="#FFFFFF"
                />
              }
              onPress={() => handleCaptureCtaPress('/record-voice')}
              compact={compact}
              haptic="light"
            />
            <CaptureDiscCta
              label="Écrire"
              labelFontFamily={captureCtaLabelFont}
              discColor={THEME.captureDiscCtaBackground}
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
              discColor={THEME.captureDiscCtaBackground}
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
    marginBottom: verticalScale(12),
    paddingBottom: verticalScale(4),
  },
  captureHeaderDate: {
    fontSize: CAPTURE_HEADER_DATE_FONT_SIZE,
    lineHeight: CAPTURE_HEADER_DATE_LINE_HEIGHT,
    color: THEME.textPrimary,
    letterSpacing: -0.3,
    flexShrink: 1,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  capturePageHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(10),
    flexShrink: 0,
  },
  captureHeaderMenuHit: {
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.06)',
  },
  capturePhotoBleed: {
    width: SCREEN_W,
    marginLeft: -CAPTURE_CONTENT_PADDING_H,
    paddingHorizontal: CAPTURE_PHOTO_EDGE_PADDING_H,
    marginBottom: verticalScale(22),
  },
  capturePhotoBleedCompact: {
    marginBottom: verticalScale(16),
  },
  capturePhotoCard: {
    width: '100%',
    aspectRatio: CAPTURE_PHOTO_CARD_ASPECT,
    borderRadius: CAPTURE_PHOTO_CARD_RADIUS,
    overflow: 'hidden',
    backgroundColor: '#000',
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
  capturePhotoTaglineGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '46%',
    zIndex: 2,
  },
  capturePhotoTaglineWrap: {
    position: 'absolute',
    left: scale(16),
    right: scale(16),
    bottom: verticalScale(18),
    zIndex: 3,
  },
  capturePhotoTagline: {
    fontSize: CAPTURE_PHOTO_TAGLINE_FONT_SIZE,
    lineHeight: CAPTURE_PHOTO_TAGLINE_LINE_HEIGHT,
    color: '#FFFFFF',
    textAlign: 'left',
    letterSpacing: 0.1,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  capturePhotoTaglineCompact: {
    fontSize: CAPTURE_PHOTO_TAGLINE_FONT_SIZE,
    lineHeight: CAPTURE_PHOTO_TAGLINE_LINE_HEIGHT,
  },
  captureContentSection: {
    width: '100%',
    alignItems: 'flex-start',
    marginBottom: verticalScale(20),
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
    marginBottom: verticalScale(6),
  },
  captureTitleHeart: {
    marginHorizontal: scale(4),
    marginBottom: scale(1),
  },
  captureSubtitle: {
    marginTop: verticalScale(6),
    fontSize: CAPTURE_SUBTITLE_FONT_SIZE,
    lineHeight: CAPTURE_SUBTITLE_LINE_HEIGHT,
    color: THEME.textSecondary,
    textAlign: 'left',
    alignSelf: 'stretch',
    letterSpacing: 0,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  captureSubtitleCompact: {
    marginTop: verticalScale(5),
  },
  captureCtaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: scale(24),
    width: '100%',
    paddingBottom: verticalScale(8),
  },
  captureCtaRowCompact: {
    gap: scale(18),
  },
  captureCtaTouch: {
    alignItems: 'center',
    gap: verticalScale(8),
    maxWidth: CAPTURE_CTA_SIZE + scale(16),
    paddingHorizontal: scale(6),
    paddingTop: verticalScale(8),
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
    fontSize: scale(11),
    lineHeight: scale(13),
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
          <ColorMatrix matrix={CAPTURE_HERO_COLOR_MATRIX} style={StyleSheet.absoluteFillObject}>
            <ExpoImage
              source={{ uri: photoUri }}
              style={[StyleSheet.absoluteFillObject, styles.heroImageCover]}
              contentFit="cover"
              contentPosition={CAPTURE_HERO_IMAGE_CONTENT_POSITION}
              cachePolicy="memory-disk"
              recyclingKey={`${reactKey}-${imageRevision}`}
              accessibilityIgnoresInvertColors
            />
          </ColorMatrix>
        )}
      </Animated.View>
    </View>
  );
}
