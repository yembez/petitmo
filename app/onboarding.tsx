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
  type ImageSourcePropType,
  type ListRenderItemInfo,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import PetitCoeurWordmark from '@/components/PetitCoeurWordmark';
import { SPACING } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { LinearGradient } from 'expo-linear-gradient';
import { getChildren, refreshChildrenFromCloudInBackground } from '@/services/children';
import { hasRealAuthAccount } from '@/lib/authAccount';
import { listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { useAppTranslation } from '@/hooks/useAppTranslation';

/**
 * Règle d'or V2 (AGENTS.md) :
 * - Soft gate : présentation (carrousel) → compte gratuit → profil enfant.
 * - « J'ai déjà un compte » → login / restore.
 * - Promesse : souvenirs privés et sauvegardés.
 *
 * Stable OTA : FlatList RN + Image (pas de Reanimated / BlurView / MaskedView).
 * Typo : police système (SF Pro iOS), comme Capturer.
 */

type OnboardingSlide = {
  key: string;
  image: ImageSourcePropType;
  titleKey: string;
  subtitleKey: string;
};

const SLIDES: OnboardingSlide[] = [
  {
    key: 'bond',
    image: require('@/assets/images/onboarding_01_mom_child.jpg'),
    titleKey: 'onboarding.slides.bondTitle',
    subtitleKey: 'onboarding.slides.bondSubtitle',
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

/** Zoom cover des photos onboarding. */
const PHOTO_ZOOM = 1.14;

export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { t } = useAppTranslation('common');
  const listRef = useRef<FlatList<OnboardingSlide>>(null);
  const [index, setIndex] = useState(0);
  const isLast = index >= SLIDES.length - 1;

  const logoW = Math.min(windowWidth * 0.2, scale(78));
  const topFadeH = insets.top + verticalScale(100);
  const bottomFadeH = Math.min(windowHeight * 0.42, verticalScale(340));

  useEffect(() => {
    const checkExisting = async () => {
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
        await replaceToOnboardingPermissionsOrCreateChild(router);
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
    ({ item }: ListRenderItemInfo<OnboardingSlide>) => (
      <View
        style={{
          width: windowWidth,
          height: windowHeight,
          backgroundColor: '#2A1A14',
          overflow: 'hidden',
        }}
      >
        <Image
          source={item.image}
          style={{
            position: 'absolute',
            width: windowWidth,
            height: windowHeight,
            top: 0,
            left: 0,
            transform: [{ scale: PHOTO_ZOOM }],
          }}
          resizeMode="cover"
        />
        <LinearGradient
          colors={['rgba(40, 22, 18, 0.38)', 'transparent']}
          locations={[0, 1]}
          style={[styles.topOverlay, { height: topFadeH }]}
          pointerEvents="none"
        />
        <LinearGradient
          colors={['transparent', 'rgba(40, 22, 18, 0.5)', 'rgba(40, 22, 18, 0.78)']}
          locations={[0, 0.48, 1]}
          style={[styles.bottomOverlay, { height: bottomFadeH }]}
          pointerEvents="none"
        />
      </View>
    ),
    [bottomFadeH, topFadeH, windowHeight, windowWidth],
  );

  const current = SLIDES[index] ?? SLIDES[0];
  const title = t(current.titleKey);
  const subtitle = t(current.subtitleKey);

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
        <View style={styles.logoContainer}>
          <PetitCoeurWordmark width={logoW} variant="white" opacity={0.92} />
        </View>

        <View
          style={[
            styles.footer,
            { paddingBottom: insets.bottom + verticalScale(12) },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.copySlot}>
            <View style={styles.copyBlock}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
          </View>

          <PetitmoPrimaryPressable
            style={styles.ctaButton}
            onPress={onContinue}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={
              isLast ? t('onboarding.ctaStartA11y') : t('onboarding.ctaContinue')
            }
          >
            <Text style={styles.ctaButtonText}>
              {isLast ? t('onboarding.ctaStart') : t('onboarding.ctaContinue')}
            </Text>
          </PetitmoPrimaryPressable>

          <View style={styles.afterCtaSlot}>
            {isLast ? (
              <TouchableOpacity
                style={styles.linkTertiaryWrap}
                onPress={handleExistingAccount}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('onboarding.alreadyAccount')}
              >
                <Text style={styles.linkTertiary}>{t('onboarding.alreadyAccount')}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.linkTertiarySpacer} />
            )}
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
            <View style={styles.privacyBadge}>
              <Lock size={scale(15)} color="rgba(255, 255, 255, 0.65)" strokeWidth={2} />
              <Text style={styles.privacyText}>{t('onboarding.privacy')}</Text>
            </View>
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
  chrome: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'space-between',
  },
  logoContainer: {
    alignItems: 'center',
    paddingTop: verticalScale(6),
    paddingHorizontal: SPACING.lg,
  },
  footer: {
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  copySlot: {
    minHeight: verticalScale(110),
    width: '100%',
    justifyContent: 'flex-end',
    marginBottom: verticalScale(4),
  },
  copyBlock: {
    alignItems: 'center',
    width: '100%',
  },
  title: {
    fontSize: scale(28),
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: scale(34),
    letterSpacing: -0.2,
    marginBottom: verticalScale(12),
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
    marginBottom: verticalScale(20),
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
  afterCtaSlot: {
    minHeight: verticalScale(46),
    justifyContent: 'center',
  },
  linkTertiaryWrap: {
    marginTop: verticalScale(10),
    paddingVertical: verticalScale(8),
    paddingHorizontal: SPACING.md,
  },
  linkTertiarySpacer: {
    height: verticalScale(36),
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
    marginTop: verticalScale(8),
    marginBottom: verticalScale(6),
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
