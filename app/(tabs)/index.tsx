import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ImageBackground,
  Animated,
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
import { LinearGradient } from 'expo-linear-gradient';
import { Heart, Image as ImageLandscapeIcon, Menu, Mic, PenLine } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import { useFonts, DMSans_400Regular, DMSans_600SemiBold, DMSans_700Bold } from '@expo-google-fonts/dm-sans';
import { scale, verticalScale } from '@/utils/responsive';
import { THEME } from '@/constants/theme';
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
import { useCaptureHeroLogoColor } from '@/hooks/useCaptureHeroLogoColor';
import { checkMemoryLimit } from '@/lib/limits';
import { useSignedMediaUrl } from '@/lib/mediaSignedUrl';
import { resolveChildProfileImageDisplayUri } from '@/utils/childPhotoUri';

const { width: SCREEN_W } = Dimensions.get('window');

const CHARTE = {
  bg: '#FBFAF7',
  eyebrow: '#C4784A',
  textPrimary: '#1C1C1E',
  textMuted: '#8E8E93',
  terracotta: '#D4784A',
} as const;

/** Fondu bas de la photo → fond crème (dissimule la jonction avec le bloc titres / CTA). */
const HERO_FADE_TO_BG = [
  'rgba(251,250,247,0)',
  'rgba(251,250,247,0.22)',
  'rgba(251,250,247,0.58)',
  'rgba(251,250,247,0.88)',
  'rgba(251,250,247,0.98)',
  CHARTE.bg,
] as const;

type CaptureRoute = '/write' | '/record-voice' | '/import-media';

function CaptureActionCard({
  Icon,
  title,
  iconBackground,
  onPress,
}: {
  Icon: LucideIcon;
  title: string;
  iconBackground: string;
  onPress: () => void;
}) {
  const press = useRef(new Animated.Value(1)).current;
  return (
    <Animated.View style={[styles.actionCardWrap, { transform: [{ scale: press }] }]}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        onPressIn={() => Animated.spring(press, { toValue: 0.97, useNativeDriver: true, friction: 6 }).start()}
        onPressOut={() => Animated.spring(press, { toValue: 1, useNativeDriver: true, friction: 5 }).start()}
        style={[styles.actionCard, { backgroundColor: iconBackground }]}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <Icon color="#FFFFFF" size={scale(22)} strokeWidth={2} />
        <Text style={styles.actionCardTitle}>{title}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function CapturerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const { height: windowH } = useWindowDimensions();

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
  const heroH = Math.min(layoutH * (compact ? 0.56 : 0.64), verticalScale(520));

  const [child, setChild] = useState<Child | null>(() => getCaptureTabChildSnapshot());
  const [isLoading, setIsLoading] = useState(() => getCaptureTabChildSnapshot() === null);
  const heroLogo = useCaptureHeroLogoColor(child?.photo_url?.trim() || null);
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
      };
    }, [router])
  );

  if (isLoading) {
    return (
      <View style={[styles.root, styles.loadingContainer]}>
        <ActivityIndicator size="large" color={CHARTE.eyebrow} />
      </View>
    );
  }

  if (!child) {
    return (
      <View style={[styles.root, styles.loadingContainer]}>
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

  const captureLogoH = scale(38);
  const captureLogoW = captureLogoH * (PETITMO_LOGO_VIEWBOX.width / PETITMO_LOGO_VIEWBOX.height);
  const captureTopScrimH = insets.top + verticalScale(120);
  /** Sous la barre de statut / encoche — évite le chevauchement avec l’heure, etc. */
  const heroChromeTop = insets.top + verticalScale(36);
  const heroMenuBtnSize = scale(36);
  const heroMenuIconSize = scale(18);
  const ctaBottomOffset = verticalScale(compact ? 8 : 12);

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
        <View
          style={[
            styles.heroSection,
            {
              marginTop: -insets.top,
              height: heroH + insets.top,
            },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.92}
            onPress={openEditChild}
            style={StyleSheet.absoluteFillObject}
            accessibilityRole="button"
            accessibilityLabel="Modifier le profil de l'enfant"
          >
            {photoUri ? (
              <ImageBackground
                key={`capture-hero-${child.id}-${child.updated_at}`}
                source={{ uri: photoUri }}
                style={StyleSheet.absoluteFillObject}
                imageStyle={styles.heroImageCover}
                resizeMode="cover"
              >
                <LinearGradient
                  colors={[...HERO_FADE_TO_BG]}
                  locations={[0, 0.12, 0.38, 0.62, 0.82, 1]}
                  pointerEvents="none"
                  style={styles.heroBottomFade}
                />
              </ImageBackground>
            ) : (
              <View style={[StyleSheet.absoluteFillObject, styles.heroPlaceholder]}>
                <Text style={styles.heroPlaceholderText}>{child.name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
          </TouchableOpacity>

          <LinearGradient
            colors={[
              'rgba(42, 26, 20, 0.88)',
              'rgba(42, 26, 20, 0.48)',
              'transparent',
            ]}
            locations={[0, 0.5, 1]}
            pointerEvents="none"
            style={[styles.heroTopScrim, { height: captureTopScrimH }]}
          />

          <View
            style={[
              styles.heroLogoRow,
              {
                top: heroChromeTop,
                left: scale(16),
              },
            ]}
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <PetitmoLogoManuscrit
              width={captureLogoW}
              height={captureLogoH}
              color={heroLogo.color}
              shadow={heroLogo.shadow}
            />
          </View>
          <TouchableOpacity
            style={[
              styles.heroMenuBtn,
              {
                top: heroChromeTop,
                right: scale(16),
                width: heroMenuBtnSize,
                height: heroMenuBtnSize,
                borderRadius: heroMenuBtnSize / 2,
              },
            ]}
            onPress={() => router.push('/parent-space')}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Menu"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Menu size={heroMenuIconSize} color="#2C2C2E" strokeWidth={2} />
          </TouchableOpacity>

          <View style={styles.heroCopyOverlay} pointerEvents="none">
            <Text
              style={[
                styles.tagTodayOverlay,
                dmSans600 ? { fontFamily: dmSans600 } : { fontWeight: '600' },
              ]}
              accessibilityRole="text"
            >
              AUJOURD&apos;HUI
            </Text>
            <Text
              style={[
                styles.panelTitle,
                compact && styles.panelTitleCompact,
                dmSans700 ? { fontFamily: dmSans700 } : { fontWeight: '700' },
              ]}
              accessibilityRole="header"
            >
              Quel souvenir tu lui laisses ?
            </Text>
            <View style={styles.subtitleRow}>
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
                color={THEME.brandTerracotta}
                fill={THEME.brandTerracotta}
                strokeWidth={1.8}
              />
            </View>
          </View>
        </View>

        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={[
            styles.contentScrollInner,
            {
              paddingBottom: ctaBottomOffset + Math.max(insets.bottom, verticalScale(6)),
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={Platform.OS === 'ios'}
        >
          <View style={styles.cardsRow}>
            <CaptureActionCard
              Icon={Mic}
              title="Enregistrer"
              iconBackground={THEME.captureRecordIconBackground}
              onPress={() => handleCaptureCtaPress('/record-voice')}
            />
            <CaptureActionCard
              Icon={PenLine}
              title="Écrire"
              iconBackground={THEME.brandTerracotta}
              onPress={() => handleCaptureCtaPress('/write')}
            />
            <CaptureActionCard
              Icon={ImageLandscapeIcon}
              title="Importer"
              iconBackground={THEME.captureRecordIconBackground}
              onPress={() => handleCaptureCtaPress('/import-media')}
            />
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
    backgroundColor: CHARTE.bg,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: CHARTE.bg,
  },
  mainColumn: {
    flex: 1,
    width: SCREEN_W,
    minHeight: 0,
    backgroundColor: CHARTE.bg,
  },
  heroSection: {
    width: SCREEN_W,
    backgroundColor: '#D8D0C8',
    overflow: 'hidden',
  },
  heroImageCover: {
    width: '100%',
    height: '100%',
  },
  heroBottomFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: verticalScale(240),
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
  heroTopScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 14,
  },
  heroLogoRow: {
    position: 'absolute',
    zIndex: 30,
    maxWidth: SCREEN_W - scale(16) - scale(16) - scale(36) - scale(14),
  },
  heroMenuBtn: {
    position: 'absolute',
    zIndex: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: verticalScale(2) },
        shadowOpacity: 0.12,
        shadowRadius: scale(6),
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  contentScroll: {
    flex: 1,
    minHeight: 0,
    backgroundColor: CHARTE.bg,
  },
  contentScrollInner: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: scale(20),
    paddingTop: verticalScale(4),
  },
  heroCopyOverlay: {
    position: 'absolute',
    left: scale(20),
    right: scale(20),
    bottom: verticalScale(14),
    zIndex: 25,
  },
  tagTodayOverlay: {
    fontSize: scale(11),
    letterSpacing: scale(1.2),
    color: THEME.brandTerracotta,
    textTransform: 'uppercase',
    marginBottom: verticalScale(8),
  },
  panelTitle: {
    fontSize: scale(26),
    lineHeight: scale(32),
    color: CHARTE.textPrimary,
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
    color: CHARTE.textMuted,
  },
  panelSubtitleCompact: {
    fontSize: scale(14),
    lineHeight: scale(20),
  },
  cardsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: scale(10),
    width: '100%',
  },
  actionCardWrap: {
    flex: 1,
    minWidth: 0,
  },
  actionCard: {
    flex: 1,
    /** Plus large que haut, moins aplati qu’un 1.5+. */
    aspectRatio: 1.22,
    borderRadius: scale(10),
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(6),
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow,
  },
  actionCardTitle: {
    marginTop: verticalScale(6),
    fontSize: scale(13),
    lineHeight: scale(17),
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.15,
    textAlign: 'center',
  },
  ctaGhostText: {
    fontSize: scale(16),
    fontWeight: '600',
    color: CHARTE.eyebrow,
  },
});
