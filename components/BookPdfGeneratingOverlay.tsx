/**
 * Plein écran pendant la génération PDF serveur (+ téléchargement / ouverture du partage).
 */
import { useEffect } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Heart } from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { scale } from '@/utils/responsive';

export const BOOK_PDF_GENERATING_TITLE = 'Votre livre prend vie ❤️';

export const BOOK_PDF_GENERATING_SUBTITLE =
  'Merci de garder Petitmo ouvert pendant la préparation.';

type Props = {
  visible: boolean;
};

export function BookPdfGeneratingOverlay({ visible }: Props) {
  const insets = useSafeAreaInsets();
  const pulse = useSharedValue(1);
  const breathe = useSharedValue(0.35);

  useEffect(() => {
    if (!visible) {
      pulse.value = withTiming(1, { duration: 200 });
      breathe.value = withTiming(0.35, { duration: 200 });
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
    breathe.value = withRepeat(
      withSequence(
        withTiming(0.65, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.28, { duration: 1200, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );
  }, [visible, pulse, breathe]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: breathe.value,
    transform: [{ scale: pulse.value * 1.35 }],
  }));

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top + scale(28),
            paddingBottom: insets.bottom + scale(28),
          },
        ]}
      >
        <View style={styles.visualBlock}>
          <Animated.View style={[styles.halo, haloStyle]} />
          <Animated.View style={[styles.iconRing, iconStyle]}>
            <Heart
              size={scale(46)}
              color={THEME.brandTerracotta}
              fill={THEME.brandTerracotta}
              strokeWidth={1.8}
            />
          </Animated.View>
        </View>
        <Text style={styles.title}>{BOOK_PDF_GENERATING_TITLE}</Text>
        <Text style={styles.subtitle}>{BOOK_PDF_GENERATING_SUBTITLE}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(28, 28, 30, 0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(28),
  },
  visualBlock: {
    width: scale(120),
    height: scale(120),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: scale(28),
  },
  halo: {
    position: 'absolute',
    width: scale(96),
    height: scale(96),
    borderRadius: scale(48),
    backgroundColor: THEME.brandTerracotta,
  },
  iconRing: {
    alignItems: 'center',
    justifyContent: 'center',
    width: scale(88),
    height: scale(88),
    borderRadius: scale(44),
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: scale(22),
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: scale(30),
    marginBottom: scale(14),
  },
  subtitle: {
    fontSize: scale(16),
    fontWeight: '400',
    color: 'rgba(255,255,255,0.78)',
    textAlign: 'center',
    lineHeight: scale(24),
    maxWidth: scale(320),
  },
});
