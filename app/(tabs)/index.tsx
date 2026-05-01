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
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets, useSafeAreaFrame } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { LinearGradient } from 'expo-linear-gradient';
import { Import as ImportIcon, Menu, Mic, PenLine, Video } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import { scale, verticalScale } from '@/utils/responsive';
import {
  getChildren,
  getOrSelectFirstChild,
  getCaptureTabChildSnapshot,
  setCaptureTabChildSnapshot,
} from '@/services/children';
import type { Child } from '@/types/local';
import PetitmoLogoManuscrit, { PETITMO_LOGO_VIEWBOX } from '@/components/PetitmoLogoManuscrit';
import { useCaptureHeroLogoColor } from '@/hooks/useCaptureHeroLogoColor';
import { useCaptureHeroTopFillColor } from '@/hooks/useCaptureHeroTopFillColor';
import { checkMemoryLimit } from '@/lib/limits';
import { resolveChildProfileImageUri } from '@/utils/childPhotoUri';

const { width: SCREEN_W } = Dimensions.get('window');

const CHARTE = {
  // Blanc cassé très léger (uniquement écran Capturer)
  bg: '#FBFAF7',
  eyebrow: '#D4784A',
  textPrimary: '#1C1C1E',
  textMuted: '#8E8E93',
  terracotta: '#D4784A',
  ardoise: '#5C8FA6',
  sauge: '#7CA68C',
  moutarde: '#C9963E',
} as const;

/**
 * Dégradé photo → fond : d’abord un voile très léger (effet baisse d’opacité de la photo),
 * puis rampe vers la couleur de fond. Une zone plus haute évite un trait net.
 */
const FADE = {
  // CHARTE.bg (#FBFAF7) en RGBA pour éviter un fondu "blanc" en bas de photo.
  p0: 'rgba(251,250,247,0)',
  p1: 'rgba(251,250,247,0.012)',
  p2: 'rgba(251,250,247,0.035)',
  p3: 'rgba(251,250,247,0.07)',
  p4: 'rgba(251,250,247,0.12)',
  p5: 'rgba(251,250,247,0.2)',
  p6: 'rgba(251,250,247,0.32)',
  p7: 'rgba(251,250,247,0.48)',
  p8: 'rgba(251,250,247,0.66)',
  p9: 'rgba(251,250,247,0.84)',
  p10: 'rgba(251,250,247,0.96)',
} as const;

const FADE_COLORS = [
  FADE.p0,
  FADE.p1,
  FADE.p2,
  FADE.p3,
  FADE.p4,
  FADE.p5,
  FADE.p6,
  FADE.p7,
  FADE.p8,
  FADE.p9,
  FADE.p10,
  CHARTE.bg,
] as const;

/**
 * Même longueur que FADE_COLORS.
 * Début très étalé = voile léger sur la photo ; fin vers blanc plein.
 */
const FADE_LOCATIONS = [
  0, 0.05, 0.11, 0.19, 0.28, 0.38, 0.5, 0.62, 0.73, 0.84, 0.92, 1,
] as const;

type ActionDef = {
  bg: string;
  Icon: LucideIcon;
  label: string;
  subLines: string[];
  route: '/write' | '/record-voice' | '/camera' | '/import-media';
};

/** Hauteur mini des cartes CTA (titres parfois sur deux lignes) */
const ACTION_CARD_MIN_HEIGHT = verticalScale(86);
/**
 * Sous la safe area : réserve pour heure / batterie / îlot (évite le burger sous les icônes système).
 * S’ajoute à `insets.top` comme sur une barre de contenu type header.
 */
const MENU_BELOW_SAFE_TOP = verticalScale(44);

const ACTIONS: ActionDef[] = [
  {
    bg: CHARTE.terracotta,
    Icon: PenLine,
    label: 'Écrire',
    subLines: ['un petit', 'mot'],
    route: '/write',
  },
  {
    bg: CHARTE.ardoise,
    Icon: Mic,
    label: 'Enregistrer',
    subLines: ['sa voix ou', 'la vôtre'],
    route: '/record-voice',
  },
  {
    bg: CHARTE.moutarde,
    Icon: Video,
    label: 'Caméra',
    subLines: ['photos ou', 'vidéos'],
    route: '/camera',
  },
  {
    bg: CHARTE.sauge,
    Icon: ImportIcon,
    label: 'Importer',
    subLines: ['photos ou', 'vidéos'],
    route: '/import-media',
  },
];

function ActionCard({
  item,
  width,
  onPress,
}: {
  item: ActionDef;
  width: number;
  onPress: () => void;
}) {
  const pressScale = useRef(new Animated.Value(1)).current;
  const { Icon } = item;

  return (
    <Animated.View style={[{ width, alignSelf: 'stretch', transform: [{ scale: pressScale }] }]}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={onPress}
        onPressIn={() =>
          Animated.spring(pressScale, { toValue: 0.97, useNativeDriver: true }).start()
        }
        onPressOut={() =>
          Animated.spring(pressScale, { toValue: 1, friction: 4, useNativeDriver: true }).start()
        }
        style={[styles.actionBtn, { width: '100%', minHeight: ACTION_CARD_MIN_HEIGHT }]}
      >
        <View style={[styles.actionIcon, { backgroundColor: item.bg }]}>
          <Icon color="#FFFFFF" size={scale(21)} strokeWidth={2} />
        </View>
        <View style={styles.actionTexts}>
          <Text style={styles.actionTitle}>{item.label}</Text>
          <Text style={styles.actionSub}>
            {item.subLines[0]}
            {'\n'}
            {item.subLines[1]}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const shadowCard = Platform.select({
  web: { boxShadow: '0 2px 10px rgba(0,0,0,0.06)' },
  default: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: verticalScale(2) },
    shadowOpacity: 0.06,
    shadowRadius: scale(10),
    elevation: 2,
  },
});

export default function CapturerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const { height: windowH } = useWindowDimensions();
  const tabBarH = useBottomTabBarHeight();

  /**
   * Hauteur réellement dispo pour l’onglet Capturer (sans la tab bar).
   * On borne avec le safe frame pour s’adapter à toutes les tailles d’écran.
   */
  const usableH = Math.max(280, windowH - tabBarH);
  const layoutH = Math.min(frame.height > 1 ? frame.height : usableH, usableH);
  /** Très petit écran seulement (iPhone SE…) */
  const compact = layoutH < 600;
  /** Cœur du fondu (réf. taille) ; la hauteur réelle ajoute une extension pour le voile sur la photo */
  const heroFadeCoreH = Math.min(verticalScale(110), layoutH * 0.13);
  /** Pousse le dégradé plus haut dans l’image pour un fondu type « opacité photo » progressif */
  const heroFadePhotoBleed = verticalScale(40);
  const heroFadeH = heroFadeCoreH + heroFadePhotoBleed;
  /** Marge sous la grille : ombres des cartes + éviter le clip avec overflow hidden du panneau */
  const panelBottomPad = compact ? verticalScale(10) : verticalScale(14);
  /** Espace bas du scroll : marge cartes + safe area (évite le bandeau blanc qui mord sur les CTA) */
  const ctaScrollBottomPad =
    panelBottomPad + Math.max(insets.bottom, verticalScale(10)) + verticalScale(10);

  const [child, setChild] = useState<Child | null>(() => getCaptureTabChildSnapshot());
  const [isLoading, setIsLoading] = useState(() => getCaptureTabChildSnapshot() === null);
  /** Mode local : photo dans `local_photo_path`, pas dans `photo_url`. */
  const heroPhotoUri = child
    ? resolveChildProfileImageUri(child.local_photo_path, child.photo_url)
    : null;
  const heroLogo = useCaptureHeroLogoColor(heroPhotoUri);
  const heroTopFill = useCaptureHeroTopFillColor(heroPhotoUri);
  /** Pour savoir si on rafraîchit sans écran de chargement (évite une course avec les deps de useFocusEffect) */
  const childRef = useRef<Child | null>(null);
  childRef.current = child;

  useEffect(() => {
    setCaptureTabChildSnapshot(child);
  }, [child]);

  const activeOpacity = useRef(new Animated.Value(1)).current;
  const activeTranslateY = useRef(new Animated.Value(0)).current;

  const handleCaptureCtaPress = useCallback(
    (route: ActionDef['route']) => {
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
            setChild(selected);
          } else if (allChildren.length === 0) {
            setChild(null);
            router.push('/create-child');
          } else {
            setChild(allChildren[0]);
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

  const contentPad = scale(20);
  const gridGap = scale(10);
  const cardW = (SCREEN_W - contentPad * 2 - gridGap) / 2;

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

  const photoUri = heroPhotoUri ?? '';
  /** Même ratio que le viewBox du SVG — sinon le cadre est trop large (bandes vides dans le Svg) */
  const captureLogoH = scale(50);
  const captureLogoW = captureLogoH * (PETITMO_LOGO_VIEWBOX.width / PETITMO_LOGO_VIEWBOX.height);
  /** Dégradé sommet (lisibilité statut / chrome), comme l’onglet Favoris */
  const captureTopScrimH = insets.top + verticalScale(112);
  /** Bandeau uni supprimé : on garde uniquement le dégradé noir. */
  const topBandH = 0;
  /** Chrome (logo + menu) un peu plus haut que l’ancien réglage */
  const heroChromeTop = insets.top + verticalScale(20);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      {/*
        Photo / panneau 12/8 (sans chevauchement : le dégradé reste visible sur le hero).
      */}
      <View style={styles.mainColumn}>
        <Animated.View
          style={[
            styles.heroColumn,
            {
              flex: compact ? 1 : 12,
              opacity: activeOpacity,
              transform: [{ translateY: activeTranslateY }],
            },
          ]}
        >
          <View style={[styles.heroBleed, { top: 0 }]}>
            <TouchableOpacity
              activeOpacity={0.92}
              onPress={openEditChild}
              style={StyleSheet.absoluteFillObject}
              accessibilityRole="button"
              accessibilityLabel="Modifier le profil de l'enfant"
            >
              {photoUri ? (
                <>
                  <ImageBackground
                    key={photoUri}
                    source={{ uri: photoUri }}
                    style={[styles.heroPhotoCrop, { top: topBandH }]}
                    imageStyle={styles.heroImageTopAligned}
                    resizeMode="cover"
                  >
                    {/*
                      Dégradé en enfant du fond : même pile de rendu que l’image (comme onboarding),
                      évite que la couche photo native masque un LinearGradient frère.
                    */}
                    <LinearGradient
                      colors={[...FADE_COLORS]}
                      locations={[...FADE_LOCATIONS]}
                      style={[styles.heroFade, { height: heroFadeH }]}
                      pointerEvents="none"
                    />
                  </ImageBackground>
                </>
              ) : (
                <>
                  <View style={[styles.heroImage, styles.heroPlaceholder, { top: topBandH }]}>
                    <Text style={styles.heroPlaceholderText}>{child.name.charAt(0).toUpperCase()}</Text>
                  </View>
                </>
              )}
            </TouchableOpacity>
            <LinearGradient
              colors={['rgba(0,0,0,0.86)', 'rgba(0,0,0,0.50)', 'transparent']}
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
                },
              ]}
              onPress={() => router.push('/parent-space')}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Menu"
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Menu size={scale(20)} color="#2C2C2E" strokeWidth={2} />
            </TouchableOpacity>
          </View>
        </Animated.View>

        <View
          style={[
            styles.bottomHalf,
            {
              flex: compact ? 1 : 8,
              paddingHorizontal: contentPad,
            },
          ]}
        >
          <View style={styles.beigePanel}>
            <ScrollView
              style={styles.beigePanelScroll}
              contentContainerStyle={[
                styles.beigePanelScrollContent,
                compact && styles.beigePanelScrollContentCompact,
                { paddingBottom: ctaScrollBottomPad },
              ]}
              showsVerticalScrollIndicator={false}
              bounces={Platform.OS === 'ios'}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.promptBlock, compact && styles.promptBlockCompact]}>
                <Text style={[styles.promptBig, compact && styles.promptBigCompact]}>
                  Quel souvenir pour {child.name}
                  {'\n'}
                  <Text style={[styles.promptBigStrong, compact && styles.promptBigStrongCompact]}>
                    aujourd&apos;hui ? <Text style={styles.promptHeart}>♥</Text>
                  </Text>
                </Text>
              </View>

              <View style={styles.actionsAnchor}>
                <View style={[styles.actionsGrid, { gap: gridGap }]}>
                  {/*
                    Grille : haut gauche Caméra, haut droite Importer, bas gauche Enregistrer, bas droite Écrire
                  */}
                  <View style={[styles.gridRow, { gap: gridGap }]}>
                    <ActionCard item={ACTIONS[2]} width={cardW} onPress={() => handleCaptureCtaPress(ACTIONS[2].route)} />
                    <ActionCard item={ACTIONS[3]} width={cardW} onPress={() => handleCaptureCtaPress(ACTIONS[3].route)} />
                  </View>
                  <View style={[styles.gridRow, { gap: gridGap }]}>
                    <ActionCard item={ACTIONS[1]} width={cardW} onPress={() => handleCaptureCtaPress(ACTIONS[1].route)} />
                    <ActionCard item={ACTIONS[0]} width={cardW} onPress={() => handleCaptureCtaPress(ACTIONS[0].route)} />
                  </View>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: CHARTE.bg,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  mainColumn: {
    flex: 1,
    flexDirection: 'column',
    minHeight: 0,
    backgroundColor: CHARTE.bg,
    ...Platform.select({
      web: { minHeight: 0 } as object,
      default: {},
    }),
  },
  /** Photo + dégradé (flex 12/8 avec le panneau bas — un peu plus d’air pour texte + CTA) */
  heroColumn: {
    minHeight: 0,
    width: SCREEN_W,
    backgroundColor: '#D8D0C8',
    overflow: 'hidden',
  },
  /** Remplit la moitié haute en débordant sous la status bar */
  heroBleed: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#D8D0C8',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  /** Conteneur plein hero : on masque le bas pour garder le haut de la photo */
  heroPhotoCrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  /** Photo du héros : fidèle au cadrage profil (pas de rognage). */
  heroImageTopAligned: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    width: '100%',
    height: '100%',
  },
  heroPlaceholder: {
    /** Même brique que les CTA « terracotta » et le splash (#D4784A). */
    backgroundColor: CHARTE.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPlaceholderText: {
    fontSize: scale(72),
    fontWeight: '600',
    color: '#FFFFFF',
  },
  heroFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  heroTopBand: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 11,
  },
  heroTopBandFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 12,
  },
  /** Voile noir en haut (photo / placeholder) — cohérent avec Favoris */
  heroTopScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 14,
  },
  /** Haut gauche du hero, même ligne verticale que le menu burger */
  heroLogoRow: {
    position: 'absolute',
    zIndex: 30,
    maxWidth: SCREEN_W - scale(16) - scale(16) - scale(40) - scale(14),
  },
  /** Menu burger : au-dessus de la photo, sous la barre de statut */
  heroMenuBtn: {
    position: 'absolute',
    zIndex: 30,
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
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
  /**
   * Transparent : la zone qui chevauche le hero laisse voir photo + dégradé. Le blanc vient de `beigePanel` uniquement.
   */
  bottomHalf: {
    minHeight: 0,
    backgroundColor: 'transparent',
    zIndex: 2,
  },
  /**
   * Panneau bas : texte + boutons. Pas de coins arrondis ni chevauchement du hero :
   * le blanc commence sous la photo pour ne pas masquer le dégradé.
   */
  beigePanel: {
    flex: 1,
    minHeight: 0,
    marginTop: 0,
    paddingTop: 0,
    paddingHorizontal: 0,
    backgroundColor: CHARTE.bg,
    overflow: 'visible',
  },
  beigePanelScroll: {
    flex: 1,
    minHeight: 0,
  },
  beigePanelScrollContent: {
    flexGrow: 1,
    paddingTop: verticalScale(10),
  },
  beigePanelScrollContentCompact: {
    paddingTop: verticalScale(6),
  },
  /** Grille sous le titre — espacement resserré pour tout voir sans scroll sur la plupart des écrans */
  actionsAnchor: {
    paddingTop: verticalScale(6),
    flexGrow: 0,
  },
  promptBlock: {
    marginBottom: verticalScale(6),
    flexShrink: 0,
  },
  promptBlockCompact: {
    marginBottom: verticalScale(4),
  },
  promptBig: {
    fontSize: scale(28),
    fontWeight: '300',
    color: CHARTE.textPrimary,
    lineHeight: scale(36),
    letterSpacing: -0.6,
  },
  promptBigStrong: {
    fontWeight: '700',
    color: CHARTE.textPrimary,
  },
  promptHeart: {
    color: CHARTE.terracotta,
    fontWeight: '700',
  },
  promptBigCompact: {
    fontSize: scale(22),
    lineHeight: scale(28),
  },
  promptBigStrongCompact: {
    fontSize: scale(22),
    lineHeight: scale(28),
  },
  actionsGrid: {
    width: '100%',
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: scale(18),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#000000',
    paddingVertical: verticalScale(12),
    paddingHorizontal: scale(11),
    gap: scale(10),
    ...shadowCard,
  },
  actionIcon: {
    width: scale(44),
    height: scale(44),
    borderRadius: scale(13),
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionTexts: {
    flex: 1,
    minWidth: 0,
  },
  actionTitle: {
    fontSize: scale(14),
    fontWeight: '600',
    color: CHARTE.textPrimary,
    letterSpacing: -0.15,
  },
  actionSub: {
    fontSize: scale(11),
    fontWeight: '400',
    color: CHARTE.textMuted,
    lineHeight: scale(14),
    marginTop: verticalScale(2),
  },
  ctaGhostText: {
    fontSize: scale(16),
    fontWeight: '600',
    color: CHARTE.eyebrow,
  },
});
