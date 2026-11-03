/**
 * Overlay bienvenue Petit Cœur + (Design A — carte claire, minimal Apple).
 * Affiché une fois après abonnement / restore réussi.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  DeviceEventEmitter,
  Modal,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  useFonts,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { THEME } from '@/constants/theme';
import { MOTION_PRESS_SCALE_EMPHATIC } from '@/constants/motion';
import { scale } from '@/utils/responsive';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import MotionPressable from '@/components/MotionPressable';
import {
  PETITMO_PLUS_WELCOME_EVENT,
  clearPetitmoPlusWelcomePending,
  hydratePetitmoPlusWelcomePending,
  peekPetitmoPlusWelcomePending,
} from '@/lib/petitmoPlusWelcome';

/** Smiley outline minimal (cercle + 2 points + sourire) — corail charte. */
function WelcomeOutlineSmile({ size = 22 }: { size?: number }) {
  const stroke = THEME.brandPrimary;
  const s = size;
  return (
    <Svg width={s} height={s} viewBox="0 0 24 24" accessibilityElementsHidden>
      <Circle
        cx="12"
        cy="12"
        r="9.25"
        stroke={stroke}
        strokeWidth="1.6"
        fill="none"
      />
      <Circle cx="9" cy="10" r="1.15" fill={stroke} />
      <Circle cx="15" cy="10" r="1.15" fill={stroke} />
      <Path
        d="M8.2 14.2c1.1 1.35 2.55 2.05 3.8 2.05s2.7-.7 3.8-2.05"
        stroke={stroke}
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}

export default function PetitmoPlusWelcomeModal() {
  const { t } = useAppTranslation('common');
  const { width } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [fontsLoaded] = useFonts({
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  const dm500 = fontsLoaded ? 'DMSans_500Medium' : undefined;
  const dm600 = fontsLoaded ? 'DMSans_600SemiBold' : undefined;
  const dm700 = fontsLoaded ? 'DMSans_700Bold' : undefined;

  const tryShow = useCallback(async () => {
    const pending = peekPetitmoPlusWelcomePending() || (await hydratePetitmoPlusWelcomePending());
    if (pending) setVisible(true);
  }, []);

  useEffect(() => {
    void tryShow();
    const sub = DeviceEventEmitter.addListener(PETITMO_PLUS_WELCOME_EVENT, () => {
      setVisible(true);
    });
    return () => sub.remove();
  }, [tryShow]);

  const onContinue = useCallback(() => {
    setVisible(false);
    void clearPetitmoPlusWelcomePending();
  }, []);

  const cardWidth = Math.min(width - scale(48), scale(360));
  const smileSize = scale(24);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onContinue}
    >
      <View style={styles.root}>
        <BlurView intensity={48} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View style={[styles.scrim, StyleSheet.absoluteFillObject]} />
        <View style={[styles.card, { width: cardWidth }]}>
          <Text
            style={[styles.congrats, dm500 ? { fontFamily: dm500 } : null]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.88}
          >
            {t('paywall.welcome.congrats')}
          </Text>
          <View style={styles.brandRow}>
            <Text style={styles.brandHeart} accessibilityElementsHidden>
              ♥
            </Text>
            <Text style={[styles.brandName, dm500 ? { fontFamily: dm500 } : null]}>
              {t('paywall.welcome.brand')}
            </Text>
          </View>

          <Text style={[styles.title, dm700 ? { fontFamily: dm700 } : null]}>
            {t('paywall.welcome.title')}
            {'\u00A0'}
            <View style={[styles.smileInline, { width: smileSize, height: smileSize }]}>
              <WelcomeOutlineSmile size={smileSize} />
            </View>
          </Text>
          <Text style={[styles.body, dm500 ? { fontFamily: dm500 } : null]}>
            {t('paywall.welcome.body')}
          </Text>

          <View style={styles.divider} />

          <Text style={[styles.benefitsLead, dm600 ? { fontFamily: dm600 } : null]}>
            {t('paywall.welcome.benefitsLead')}
          </Text>
          <View style={styles.benefitRow}>
            <View style={styles.dot} />
            <Text style={[styles.benefitText, dm500 ? { fontFamily: dm500 } : null]}>
              {t('paywall.welcome.benefitMemories')}
            </Text>
          </View>
          <View style={styles.benefitRow}>
            <View style={styles.dot} />
            <Text style={[styles.benefitText, dm500 ? { fontFamily: dm500 } : null]}>
              {t('paywall.welcome.benefitBooks')}
            </Text>
          </View>

          <MotionPressable
            onPress={onContinue}
            style={styles.cta}
            haptic="medium"
            pressScale={MOTION_PRESS_SCALE_EMPHATIC}
            accessibilityRole="button"
            accessibilityLabel={t('paywall.welcome.cta')}
          >
            <Text style={[styles.ctaText, dm600 ? { fontFamily: dm600 } : null]}>
              {t('paywall.welcome.cta')}
            </Text>
          </MotionPressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(24),
  },
  scrim: {
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: scale(28),
    paddingHorizontal: scale(26),
    paddingTop: scale(28),
    paddingBottom: scale(22),
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  congrats: {
    color: THEME.textSecondary,
    fontSize: scale(14.5),
    fontWeight: '500',
    lineHeight: scale(20),
    textAlign: 'center',
    marginBottom: scale(10),
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(6),
    marginBottom: scale(16),
  },
  brandHeart: {
    color: THEME.brandPrimary,
    fontSize: scale(14),
    lineHeight: scale(18),
  },
  brandName: {
    color: THEME.brandPrimary,
    fontSize: scale(15),
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  title: {
    color: THEME.textPrimary,
    fontSize: scale(28),
    fontWeight: '700',
    lineHeight: scale(35),
    letterSpacing: -0.4,
    marginBottom: scale(14),
  },
  smileInline: {
    transform: [{ translateY: scale(4) }],
  },
  body: {
    color: THEME.textPrimary,
    fontSize: scale(17.5),
    fontWeight: '500',
    lineHeight: scale(25),
    marginBottom: scale(18),
    opacity: 0.88,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.10)',
    marginBottom: scale(16),
  },
  benefitsLead: {
    color: THEME.textSecondary,
    fontSize: scale(14),
    fontWeight: '500',
    lineHeight: scale(20),
    marginBottom: scale(8),
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: scale(8),
    marginBottom: scale(6),
  },
  dot: {
    width: scale(5),
    height: scale(5),
    borderRadius: scale(3),
    backgroundColor: THEME.brandPrimary,
    marginTop: scale(7),
    opacity: 0.75,
  },
  benefitText: {
    flex: 1,
    color: THEME.textSecondary,
    fontSize: scale(14.5),
    fontWeight: '500',
    lineHeight: scale(20),
  },
  cta: {
    marginTop: scale(18),
    backgroundColor: THEME.brandPrimary,
    borderRadius: scale(999),
    paddingVertical: scale(16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: scale(18),
    fontWeight: '600',
    letterSpacing: 0.1,
  },
});
