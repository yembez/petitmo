/**
 * Plein écran pendant la génération PDF serveur (+ téléchargement / ouverture du partage).
 */
import { useEffect } from 'react';
import { Keyboard, Modal, StyleSheet, Text, View } from 'react-native';
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

export const BOOK_PDF_GENERATING_TITLE = 'Ton livre prend vie';

export const BOOK_PDF_GENERATING_SUBTITLE =
  'Quelques instants pour préparer ton livre…';

type ViewProps = {
  active?: boolean;
  title?: string;
  subtitle?: string;
  /** Consigne discrète sous le texte (ex. « Ne ferme pas l’app ni cette fenêtre »). */
  note?: string;
};

/** Écran cœur (plein écran) — attente print / génération PDF. */
export function BookPdfGeneratingView({ active = true, title, subtitle, note }: ViewProps) {
  const insets = useSafeAreaInsets();
  const pulse = useSharedValue(1);
  const breathe = useSharedValue(0.35);
  const fadeIn = useSharedValue(0);

  useEffect(() => {
    if (!active) {
      pulse.value = withTiming(1, { duration: 200 });
      breathe.value = withTiming(0.35, { duration: 200 });
      fadeIn.value = withTiming(0, { duration: 160 });
      return;
    }
    // Formulaire commande : le clavier reste parfois ouvert sous l’overlay.
    Keyboard.dismiss();
    fadeIn.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
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
  }, [active, pulse, breathe, fadeIn]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: breathe.value,
    transform: [{ scale: pulse.value * 1.35 }],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: fadeIn.value,
    transform: [{ translateY: (1 - fadeIn.value) * 10 }],
  }));

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + scale(28),
          paddingBottom: insets.bottom + scale(28),
        },
      ]}
    >
      <Animated.View style={[styles.content, contentStyle]}>
        <View style={styles.visualBlock}>
          <Animated.View style={[styles.halo, haloStyle]} />
          <Animated.View style={[styles.iconRing, iconStyle]}>
            <Heart
              size={scale(46)}
              color={THEME.brandPrimary}
              fill={THEME.brandPrimary}
              strokeWidth={1.8}
            />
          </Animated.View>
        </View>
        <Text style={styles.title}>{title ?? BOOK_PDF_GENERATING_TITLE}</Text>
        <Text style={styles.subtitle}>{subtitle ?? BOOK_PDF_GENERATING_SUBTITLE}</Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </Animated.View>
    </View>
  );
}

type Props = {
  visible: boolean;
  title?: string;
  subtitle?: string;
  note?: string;
};

/**
 * Overlay plein écran **sans** `Modal` natif : un UIViewController modal RN en cours de
 * dismiss empêche iOS de présenter SFSafariViewController (Stripe Checkout) — la promesse
 * `openBrowserAsync` reste alors suspendue sans erreur. Une `View` absolue n’a pas ce problème.
 * À placer en dernier enfant de la racine d’écran (header expo-router masqué).
 */
export function BookPdfGeneratingOverlay({ visible, title, subtitle, note }: Props) {
  if (!visible) return null;
  return (
    <View style={styles.overlay} pointerEvents="auto">
      <BookPdfGeneratingView active title={title} subtitle={subtitle} note={note} />
    </View>
  );
}

/**
 * Variante `Modal` natif : passe **au-dessus** d’autres `Modal` RN déjà ouverts
 * (ex. aperçu livre + modal export PDF). Ne pas utiliser juste avant un `openBrowserAsync`.
 */
export function BookPdfGeneratingModalOverlay({ visible, title, subtitle, note }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <BookPdfGeneratingView active={visible} title={title} subtitle={subtitle} note={note} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    elevation: 1000,
  },
  root: {
    flex: 1,
    backgroundColor: 'rgba(28, 28, 30, 0.94)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(28),
  },
  content: {
    alignItems: 'center',
    width: '100%',
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
    backgroundColor: THEME.brandCtaOrange,
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
  note: {
    marginTop: scale(28),
    fontSize: scale(13),
    fontWeight: '500',
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
    lineHeight: scale(18),
    maxWidth: scale(300),
  },
});
