import {
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
  BackHandler,
  type ListRenderItemInfo,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, ChevronRight } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useSharedValue } from 'react-native-reanimated';
import { scale, verticalScale } from '@/utils/responsive';
import { SPACING } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import MotionPressable from '@/components/MotionPressable';
import { MotionReveal } from '@/components/MotionReveal';
import PetitCoeurWordmark from '@/components/PetitCoeurWordmark';
import { LinearGradient } from 'expo-linear-gradient';
import { getChildren, refreshChildrenFromCloudInBackground } from '@/services/children';
import { hasRealAuthAccount, peekIntentionalSignedOut } from '@/lib/authAccount';
import { listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import {
  imageSourceWithLocalUri,
  localUriForImageModule,
  prefetchAuthOnboardingAssets,
} from '@/utils/prefetchAuthOnboardingAssets';

/**
 * Règle d'or V2 (AGENTS.md) :
 * - Soft gate : présentation (carrousel) → compte gratuit → profil enfant.
 * - « J'ai déjà un compte » → login / restore.
 * - Promesse : souvenirs privés et sauvegardés.
 *
 * Titre / sous-titre / logo (1ʳᵉ) : **dans** chaque slide (swipe avec la photo → zéro retard).
 * CTA / privacy : chrome fixe, entrée soft seulement sur la dernière page.
 */

type OnboardingSlide = {
  key: string;
  /** Module Metro (`require`) — prefetch → URI locale hors ligne. */
  image: number;
  titleKey: string;
  subtitleKey: string;
  /**
   * Cadrage cover : fraction de la largeur écran.
   * Négatif = décale l’image à gauche (sujet trop à droite → recentré).
   */
  imageOffsetX?: number;
  /**
   * `cover` (défaut) = plein écran croppé + zoom.
   * `contain` = image entière visible (bandes haut/bas OK) — pour un duo paysage.
   */
  photoFit?: 'cover' | 'contain';
  /** Zoom cover uniquement (ignoré si `contain`). */
  photoZoom?: number;
};

const SLIDES: OnboardingSlide[] = [
  {
    key: 'bond',
    image: require('@/assets/images/onboarding_01_mom_child.jpg'),
    titleKey: 'onboarding.slides.bondTitle',
    subtitleKey: 'onboarding.slides.bondSubtitle',
    /** Légèrement plus à gauche. */
    imageOffsetX: -0.06,
  },
  {
    key: 'capture',
    image: require('@/assets/images/onboarding_02_siblings_beach.jpg'),
    titleKey: 'onboarding.slides.captureTitle',
    subtitleKey: 'onboarding.slides.captureSubtitle',
  },
  {
    key: 'anywhere',
    image: require('@/assets/images/onboarding_03_mom_tram.jpg'),
    titleKey: 'onboarding.slides.anywhereTitle',
    subtitleKey: 'onboarding.slides.anywhereSubtitle',
  },
  {
    key: 'book',
    image: require('@/assets/images/onboarding_04_book_qr.jpg'),
    titleKey: 'onboarding.slides.bookTitle',
    subtitleKey: 'onboarding.slides.bookSubtitle',
  },
];

/** Zoom cover des photos onboarding (slides `cover` seulement). */
const PHOTO_ZOOM = 1.14;

export default function OnboardingScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { t } = useAppTranslation('common');
  const listRef = useRef<FlatList<OnboardingSlide>>(null);
  const [index, setIndex] = useState(0);
  const [slideLocalUris, setSlideLocalUris] = useState<Record<string, string>>({});
  const isLast = index >= SLIDES.length - 1;
  /** Plus petit que l’ancien wordmark (~20 % / 78) — 1ʳᵉ slide seulement. */
  const logoW = Math.min(windowWidth * 0.14, scale(54));

  /** CTA / privacy : soft enter seulement quand on arrive sur (ou quitte) la dernière page. */
  const ctaGate = useSharedValue(1);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await prefetchAuthOnboardingAssets();
      const next: Record<string, string> = {};
      for (const slide of SLIDES) {
        const uri = await localUriForImageModule(slide.image);
        if (uri) next[slide.key] = uri;
      }
      if (!cancelled) setSlideLocalUris(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    ctaGate.value = 0;
    const t = setTimeout(() => {
      ctaGate.value = 1;
    }, 40);
    return () => clearTimeout(t);
  }, [ctaGate, isLast]);

  const topFadeH = insets.top + verticalScale(100);
  const bottomFadeH = Math.min(windowHeight * 0.42, verticalScale(340));
  /** Dernière slide : CTA + lien + privacy — dégradé plus haut pour lisibilité. */
  const bottomFadeHLast = Math.min(windowHeight * 0.58, verticalScale(470));

  /** Hauteur du chrome fixe sous le texte (CTA + lien + dots + privacy + safe area). */
  const footerChromeH = useCallback(
    (lastSlide: boolean) =>
      Math.max(insets.bottom, verticalScale(8)) +
      verticalScale(8) +
      scale(6) +
      verticalScale(8) +
      verticalScale(36) +
      verticalScale(lastSlide ? 56 : 52) +
      (lastSlide ? verticalScale(30) : 0),
    [insets.bottom],
  );

  /**
   * Bloque le retour système / gesture vers `(tabs)` laissés sous la pile après logout.
   * (gestureEnabled:false sur le Stack + filet Android Back.)
   */
  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', e => {
      if (e.data.action.type !== 'GO_BACK' && e.data.action.type !== 'POP') return;
      e.preventDefault();
    });
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      // S’il y a une entrée sous onboarding (souvent les tabs post-logout), bloquer.
      if (navigation.canGoBack()) return true;
      return false;
    });
    return () => {
      unsub();
      backSub.remove();
    };
  }, [navigation]);

  useEffect(() => {
    const checkExisting = async () => {
      // Déconnexion volontaire : rester sur onboarding (pas de rebond session fantôme).
      if (peekIntentionalSignedOut()) return;

      const hasAccount = await hasRealAuthAccount();
      if (!hasAccount) return;

      const uid = peekLastRealAuthUserId();
      const localKids = uid ? listLocalChildrenForUser(uid) : [];
      if (localKids.length > 0) {
        refreshChildrenFromCloudInBackground();
        router.replace('/(tabs)');
        return;
      }

      const children = await getChildren();
      if (children.length > 0) {
        router.replace('/(tabs)');
      } else {
        const { replaceToOnboardingPermissionsOrCreateChild } = await import(
          '@/utils/onboardingPermissionsRoute'
        );
        // Session déjà là sans enfants locaux : souvent restore / login → copy returning.
        await replaceToOnboardingPermissionsOrCreateChild(router, { returning: true });
      }
    };

    void checkExisting();
  }, [router]);

  const handleExistingAccount = useCallback(() => {
    router.push({ pathname: '/auth', params: { mode: 'login' } });
  }, [router]);

  const goSignup = useCallback(() => {
    router.push({ pathname: '/auth', params: { mode: 'signup' } });
  }, [router]);

  const onContinue = useCallback(() => {
    if (!isLast) {
      const next = Math.min(index + 1, SLIDES.length - 1);
      listRef.current?.scrollToIndex({ index: next, animated: true });
      setIndex(next);
      return;
    }
    goSignup();
  }, [goSignup, index, isLast]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const x = e.nativeEvent.contentOffset.x;
      const i = Math.round(x / Math.max(windowWidth, 1));
      setIndex(Math.max(0, Math.min(i, SLIDES.length - 1)));
    },
    [windowWidth],
  );

  const renderItem = useCallback(
    ({ item, index: slideIndex }: ListRenderItemInfo<OnboardingSlide>) => {
      const isLastSlide = slideIndex === SLIDES.length - 1;
      const isFirstSlide = slideIndex === 0;
      const fadeH = isLastSlide ? bottomFadeHLast : bottomFadeH;
      const copyBottom = footerChromeH(isLastSlide);
      return (
        <View
          style={{
            width: windowWidth,
            height: windowHeight,
            backgroundColor: '#2A1A14',
            overflow: 'hidden',
          }}
        >
          <Image
            source={imageSourceWithLocalUri(item.image, slideLocalUris[item.key])}
            style={
              item.photoFit === 'contain'
                ? {
                    position: 'absolute',
                    width: windowWidth,
                    height: windowHeight,
                    top: 0,
                    left: 0,
                  }
                : {
                    position: 'absolute',
                    width: windowWidth,
                    height: windowHeight,
                    top: 0,
                    left: 0,
                    transform: [
                      { scale: item.photoZoom ?? PHOTO_ZOOM },
                      { translateX: (item.imageOffsetX ?? 0) * windowWidth },
                    ],
                  }
            }
            resizeMode={item.photoFit === 'contain' ? 'contain' : 'cover'}
          />
          <LinearGradient
            colors={['rgba(40, 22, 18, 0.38)', 'transparent']}
            locations={[0, 1]}
            style={[styles.topOverlay, { height: topFadeH }]}
            pointerEvents="none"
          />
          <LinearGradient
            colors={
              isLastSlide
                ? [
                    'transparent',
                    'rgba(40, 22, 18, 0.35)',
                    'rgba(40, 22, 18, 0.62)',
                    'rgba(40, 22, 18, 0.82)',
                  ]
                : ['transparent', 'rgba(40, 22, 18, 0.5)', 'rgba(40, 22, 18, 0.78)']
            }
            locations={isLastSlide ? [0, 0.28, 0.62, 1] : [0, 0.48, 1]}
            style={[styles.bottomOverlay, { height: fadeH }]}
            pointerEvents="none"
          />
          {isFirstSlide ? (
            <View
              style={[styles.logoContainer, { top: insets.top + verticalScale(8) }]}
              pointerEvents="none"
            >
              <PetitCoeurWordmark width={logoW} variant="white" opacity={0.92} />
            </View>
          ) : null}
          <View
            style={[styles.slideCopy, { bottom: copyBottom, paddingHorizontal: SPACING.lg }]}
            pointerEvents="none"
          >
            <Text style={styles.title}>{t(item.titleKey)}</Text>
            <Text style={styles.subtitle}>{t(item.subtitleKey)}</Text>
          </View>
        </View>
      );
    },
    [
      bottomFadeH,
      bottomFadeHLast,
      footerChromeH,
      insets.top,
      logoW,
      slideLocalUris,
      t,
      topFadeH,
      windowHeight,
      windowWidth,
    ],
  );

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={item => item.key}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        bounces={false}
        decelerationRate="fast"
        disableIntervalMomentum
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_data, i) => ({
          length: windowWidth,
          offset: windowWidth * i,
          index: i,
        })}
        style={StyleSheet.absoluteFill}
      />

      <View
        style={[styles.chrome, { paddingTop: insets.top + verticalScale(8) }]}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.footer,
            { paddingBottom: Math.max(insets.bottom, verticalScale(8)) },
          ]}
          pointerEvents="box-none"
        >
          <MotionReveal gate={ctaGate} order={0} from="bottom" feel="soft">
            {isLast ? (
              <PetitmoPrimaryPressable
                style={styles.ctaButton}
                onPress={onContinue}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel={t('onboarding.ctaStartA11y')}
              >
                <Text style={styles.ctaButtonText}>{t('onboarding.ctaStart')}</Text>
              </PetitmoPrimaryPressable>
            ) : (
              <MotionPressable
                onPress={onContinue}
                haptic
                accessibilityRole="button"
                accessibilityLabel={t('onboarding.ctaContinue')}
                style={styles.continueArrowHit}
                hitSlop={16}
              >
                <ChevronRight
                  size={scale(40)}
                  color="#FFFFFF"
                  strokeWidth={2.4}
                />
              </MotionPressable>
            )}
          </MotionReveal>

          <View style={styles.afterCtaSlot}>
            <TouchableOpacity
              style={styles.linkTertiaryWrap}
              onPress={handleExistingAccount}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('onboarding.alreadyAccount')}
            >
              <Text style={styles.linkTertiary}>{t('onboarding.alreadyAccount')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.dotsRow}>
            {SLIDES.map((s, i) => (
              <View
                key={s.key}
                style={[
                  styles.dot,
                  {
                    width: i === index ? scale(16) : scale(6),
                    opacity: i === index ? 1 : 0.35,
                  },
                ]}
              />
            ))}
          </View>

          {isLast ? (
            <MotionReveal gate={ctaGate} order={1} from="bottom" withScale={false} feel="soft">
              <View style={styles.privacyBadge}>
                <Lock size={scale(15)} color="rgba(255, 255, 255, 0.65)" strokeWidth={2} />
                <Text style={styles.privacyText}>{t('onboarding.privacy')}</Text>
              </View>
            </MotionReveal>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#2A1A14',
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  slideCopy: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  chrome: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },
  logoContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  footer: {
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  title: {
    fontSize: scale(32),
    fontWeight: '500',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: scale(38),
    letterSpacing: -0.3,
    marginBottom: verticalScale(10),
    maxWidth: scale(340),
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 14,
  },
  subtitle: {
    fontSize: scale(18),
    fontWeight: '500',
    color: 'rgba(255,255,255,0.95)',
    textAlign: 'center',
    lineHeight: scale(26),
    letterSpacing: -0.1,
    marginBottom: verticalScale(4),
    maxWidth: scale(320),
    textShadowColor: 'rgba(40, 22, 18, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  ctaButton: {
    width: '100%',
    maxWidth: scale(320),
    borderRadius: scale(100),
    paddingVertical: verticalScale(18),
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  ctaButtonText: {
    fontSize: scale(19),
    fontWeight: '600',
    letterSpacing: -0.2,
    color: THEME.captureScreenCtaForeground,
  },
  continueArrowHit: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: verticalScale(8),
    paddingHorizontal: scale(12),
  },
  afterCtaSlot: {
    minHeight: verticalScale(36),
    justifyContent: 'center',
  },
  linkTertiaryWrap: {
    marginTop: verticalScale(6),
    paddingVertical: verticalScale(6),
    paddingHorizontal: SPACING.md,
  },
  linkTertiary: {
    fontSize: scale(18),
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    textDecorationLine: 'underline',
    textDecorationColor: 'rgba(255, 255, 255, 0.85)',
    textShadowColor: 'rgba(0, 0, 0, 0.28)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 8,
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(7),
    marginTop: verticalScale(4),
    marginBottom: verticalScale(2),
  },
  dot: {
    height: scale(6),
    borderRadius: scale(3),
    backgroundColor: '#FFFFFF',
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(7),
    paddingHorizontal: SPACING.md,
    marginTop: verticalScale(2),
  },
  privacyText: {
    fontSize: scale(13),
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
  },
});
