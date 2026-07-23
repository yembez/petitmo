import {
  ImageBackground,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import { Lock } from 'lucide-react-native';
import { scale, verticalScale } from '@/utils/responsive';
import PetitmoLogoManuscrit from '@/components/PetitmoLogoManuscrit';
import { SPACING, FONT_SIZES } from '@/constants/sizes';
import { THEME } from '@/constants/theme';
import { LinearGradient } from 'expo-linear-gradient';
import { getChildren } from '@/services/children';
import { hasRealAuthAccount } from '@/lib/authAccount';

/**
 * Règle d'or V2 (AGENTS.md) :
 * - Soft gate : présentation → compte gratuit → profil enfant.
 * - « J'ai déjà un compte » → login / restore.
 * - Promesse : souvenirs privés et sauvegardés (pas « sans compte »).
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  /**
   * Début du bloc « Capturez… » + CTA : plus `top` est grand, plus le texte descend.
   * Plafond pour garder assez de place aux boutons sur très petits écrans.
   */
  const captureFooterReserve = verticalScale(274) + insets.bottom;
  const captureBlockTop = Math.min(
    Math.max(insets.top + verticalScale(618), windowHeight * 0.69),
    windowHeight - captureFooterReserve,
  );

  useEffect(() => {
    const checkExisting = async () => {
      const hasAccount = await hasRealAuthAccount();
      if (!hasAccount) return;
      const children = await getChildren();
      if (children.length > 0) {
        router.replace('/(tabs)');
      } else {
        router.replace('/create-child');
      }
    };

    void checkExisting();
  }, [router]);

  const handleExistingAccount = () => {
    router.push({ pathname: '/auth', params: { mode: 'login' } });
  };

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require('@/assets/images/onboarding_mother_child_3.jpg')}
        style={styles.backgroundImage}
        imageStyle={styles.backgroundImageStyle}
      >
        <LinearGradient
          colors={[THEME.brandPrimaryTopOverlay, 'transparent']}
          locations={[0, 1]}
          style={[styles.topOverlay, { height: insets.top + verticalScale(140) }]}
          pointerEvents="none"
        />

        <LinearGradient
          colors={['transparent', THEME.brandPrimaryTopOverlay]}
          locations={[0, 1]}
          style={[styles.bottomOverlay, { height: insets.bottom + verticalScale(140) }]}
          pointerEvents="none"
        />

        <View style={[styles.contentContainer, { paddingTop: insets.top + verticalScale(12) }]}>
          <View style={styles.logoContainer}>
            <PetitmoLogoManuscrit width={scale(150)} height={scale(45)} color="#FFFFFF" />
          </View>

          <View style={styles.topTaglineBlock}>
            <Text style={styles.taglineTop}>
              Les souvenirs qui comptent{'\n'}ne se perdent plus.
            </Text>
          </View>
        </View>

        <View
          style={[
            styles.captureBlock,
            {
              top: captureBlockTop,
              paddingBottom: insets.bottom + verticalScale(14),
            },
          ]}
        >
          <Text style={styles.subtitle}>
            Capturez, gardez et retrouvez{'\n'}les moments avec votre enfant.
          </Text>

          <TouchableOpacity
            style={styles.ctaButton}
            onPress={() => router.push({ pathname: '/auth', params: { mode: 'signup' } })}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel="Commencer — créer un compte Petitmo"
          >
            <Text style={styles.ctaButtonText}>Commencer</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.ctaButtonSecondary}
            onPress={() =>
              router.push({ pathname: '/paywall', params: { context: 'GENERAL' } })
            }
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="S’abonner à Petitmo Plus"
          >
            <Text style={styles.ctaButtonSecondaryText}>S&apos;abonner maintenant</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkTertiaryWrap}
            onPress={handleExistingAccount}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="J’ai déjà un compte Petitmo"
          >
            <Text style={styles.linkTertiary}>J&apos;ai déjà un compte</Text>
          </TouchableOpacity>

          <View style={styles.privacyBadge}>
            <Lock size={scale(19)} color="rgba(255, 255, 255, 0.6)" strokeWidth={2} />
            <Text style={styles.privacyText}>
              Souvenirs privés et sauvegardés.
            </Text>
          </View>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: THEME.bg,
  },
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  backgroundImageStyle: {
    resizeMode: 'cover',
    transform: [{ scale: 1.08 }, { translateY: verticalScale(-10) }],
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
  contentContainer: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingBottom: verticalScale(12),
    pointerEvents: 'box-none',
  },
  logoContainer: {
    alignItems: 'center',
    paddingTop: verticalScale(0),
  },
  topTaglineBlock: {
    marginTop: verticalScale(6),
    alignItems: 'center',
  },
  captureBlock: {
    position: 'absolute',
    left: SPACING.lg,
    right: SPACING.lg,
    bottom: 0,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  tagline: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: verticalScale(12),
    // Ombre plus diffuse + un peu plus foncée : contraste lisible sans “tache” visible.
    textShadowColor: 'rgba(0, 0, 0, 0.34)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 22,
    lineHeight: scale(26),
  },
  taglineTop: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '500',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: verticalScale(10),
    lineHeight: scale(24),
  },
  subtitle: {
    fontSize: FONT_SIZES.lg,
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: verticalScale(14),
    maxWidth: scale(300),
    // Ombre marron foncé, très diffuse (halo autour des lettres, sans “tache”).
    textShadowColor: 'rgba(52, 24, 12, 0.46)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 22,
    lineHeight: scale(26),
  },
  ctaButton: {
    width: '100%',
    maxWidth: scale(320),
    backgroundColor: THEME.brandCtaOrange,
    borderRadius: scale(100),
    borderWidth: 0,
    borderColor: 'transparent',
    paddingVertical: verticalScale(16),
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaButtonText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  ctaButtonSecondary: {
    marginTop: verticalScale(12),
    width: '100%',
    maxWidth: scale(320),
    backgroundColor: '#FFFFFF',
    borderRadius: scale(100),
    paddingVertical: verticalScale(16),
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    borderWidth: 0,
    borderColor: 'transparent',
  },
  ctaButtonSecondaryText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: THEME.brandCtaOrange,
    textAlign: 'center',
  },
  linkTertiaryWrap: {
    marginTop: verticalScale(18),
    marginBottom: verticalScale(10),
    paddingVertical: verticalScale(8),
    paddingHorizontal: SPACING.md,
  },
  linkTertiary: {
    fontSize: FONT_SIZES.sm,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.72)',
    textAlign: 'center',
    textDecorationLine: 'underline',
    textDecorationColor: 'rgba(255, 255, 255, 0.35)',
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(8),
    paddingHorizontal: SPACING.md,
    alignSelf: 'stretch',
  },
  privacyText: {
    fontSize: scale(12),
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500',
    textAlign: 'center',
    flexShrink: 1,
  },
});
