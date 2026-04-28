import { View, Text, StyleSheet, ImageBackground, TouchableOpacity, Dimensions } from 'react-native';
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

  return (
    <View style={styles.container}>
      <ImageBackground
        source={require('@/assets/images/1_photo_mere_enfant_2.png')}
        style={styles.backgroundImage}
        imageStyle={styles.backgroundImageStyle}
      >
        <LinearGradient
          colors={['rgba(255, 255, 255, 0.6)', 'rgba(255, 255, 255, 0)', 'rgba(0, 0, 0, 0.7)']}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFillObject}
        />

        <View style={[styles.contentContainer, { paddingTop: insets.top + verticalScale(20) }]}>
          <View style={styles.logoContainer}>
            <PetitmoLogoManuscrit width={scale(168)} height={scale(50)} color="#FFFFFF" />
          </View>

          <View style={styles.bottomContent}>
            <Text style={styles.tagline}>
              Les souvenirs qui comptent{'\n'}ne se perdent plus.
            </Text>

            <Text style={styles.subtitle}>
              Capturez, gardez et retrouvez les moments avec votre enfant.
            </Text>

            <TouchableOpacity
              style={styles.ctaButton}
              onPress={() => router.push('/create-child')}
              activeOpacity={0.9}
            >
              <Text style={styles.ctaButtonText}>Créer vos premiers souvenirs</Text>
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
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: SPACING.lg,
    paddingBottom: verticalScale(60),
  },
  logoContainer: {
    alignItems: 'center',
    paddingTop: verticalScale(16),
  },
  bottomContent: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: verticalScale(80),
  },
  tagline: {
    fontSize: FONT_SIZES.xl,
    fontWeight: '600',
    color: '#FFFFFF',
    textAlign: 'center',
    marginBottom: verticalScale(12),
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    lineHeight: scale(26),
  },
  subtitle: {
    fontSize: FONT_SIZES.sm,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    marginBottom: verticalScale(32),
    maxWidth: scale(300),
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
    lineHeight: scale(20),
  },
  ctaButton: {
    width: '100%',
    maxWidth: scale(320),
    backgroundColor: THEME.accent,
    borderRadius: scale(100),
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
