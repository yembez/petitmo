import { Alert, Dimensions, ImageBackground, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * Règle d'or (cf. AGENTS.md / docs/specs/architecture-locale-cloud.md) :
 * - Plan gratuit = local pur, AUCUN compte → CTA "Commencer".
 * - Plan Petitmo+ uniquement = un vrai compte cloud → CTA "Restaurer mon compte Petitmo+"
 *   (libellé explicite pour qu'aucune utilisatrice gratuite ne le clique par erreur).
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const checkExistingChild = async () => {
      const children = await getChildren();
      if (children.length > 0) {
        router.replace('/(tabs)');
      }
    };

    checkExistingChild();
  }, []);

  /** TODO(plan dédié) : modale login Google / Apple / email + mot de passe pour Petitmo+. */
  const handleRestoreAccount = () => {
    Alert.alert(
      'Restaurer mon compte Petitmo+',
      "La connexion à un compte Petitmo+ arrive bientôt. Si tu n'es pas encore abonnée, commence simplement avec « Commencer » : tes souvenirs restent sur ton téléphone, sans création de compte.",
      [{ text: 'OK', style: 'default' }]
    );
  };

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require('@/assets/images/onboarding_mother_child_3.jpg')}
        style={styles.backgroundImage}
        imageStyle={styles.backgroundImageStyle}
      >
        <LinearGradient
          colors={[THEME.brandTerracottaTopOverlay, 'transparent']}
          locations={[0, 1]}
          style={[styles.topOverlay, { height: insets.top + verticalScale(140) }]}
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

          <View style={styles.bottomContent}>
            <Text style={styles.subtitle}>
              Capturez, gardez et retrouvez{'\n'}les moments avec votre enfant.
            </Text>

            <TouchableOpacity
              style={styles.ctaButton}
              onPress={() => router.push('/create-child')}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Commencer à créer mes souvenirs sans compte"
            >
              <Text style={styles.ctaButtonText}>Commencer</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.ctaButtonSecondary}
              onPress={handleRestoreAccount}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Restaurer mon compte Petitmo Plus"
            >
              <Text style={styles.ctaButtonSecondaryText}>J&apos;ai déjà un compte</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.privacyBadge, { bottom: insets.bottom + verticalScale(16) }]}>
          <Lock size={scale(19)} color="rgba(255, 255, 255, 0.6)" strokeWidth={2} />
          <Text style={styles.privacyText}>
            Confidentialité 100% préservée, jamais exploitée.
          </Text>
        </View>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fffffc',
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
  contentContainer: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingBottom: verticalScale(60),
  },
  logoContainer: {
    alignItems: 'center',
    paddingTop: verticalScale(0),
  },
  topTaglineBlock: {
    marginTop: verticalScale(6),
    alignItems: 'center',
  },
  bottomContent: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: verticalScale(36),
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
    marginBottom: verticalScale(32),
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
    backgroundColor: THEME.brandTerracotta,
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
    color: THEME.brandTerracotta,
    textAlign: 'center',
  },
  privacyBadge: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(8),
    paddingHorizontal: SPACING.md,
  },
  privacyText: {
    fontSize: scale(12),
    color: 'rgba(255, 255, 255, 0.6)',
    fontWeight: '500',
    textAlign: 'center',
    flexShrink: 1,
  },
});
