import { useCallback, useEffect, useRef } from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { MOTION_EASE } from '@/constants/motion';
import { THEME } from '@/constants/theme';
import { hapticFavorite } from '@/lib/haptics';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Path cœur (viewBox 24) — même silhouette que la fiche mouvement. */
const HEART_D =
  'M12 20.4s-7.2-4.7-7.2-9.6A4 4 0 0 1 12 8.1a4 4 0 0 1 7.2 2.7c0 4.9-7.2 9.6-7.2 9.6z';

const FILL_MS = 180;
/** Halo : expansion courte ; l’opacité tombe plus vite pour qu’il se « referme » net. */
const HALO_SCALE_MS = 320;
const HALO_FADE_MS = 240;
const UNFAVORITE_MS = 160;
/** Peak du pop (effet plus ample). */
const POP_PEAK = 1.38;
/** Taille finale du cœur rempli (plus grand que le trait vide). */
const FAVORED_REST = 1.18;
/** Référence Lucide fil (crayon etc.) pour caler l’épaisseur du trait. */
const STROKE_REF_SIZE = 20;
const STROKE_REF_WIDTH = 2.05;
const POP_UP_MS = 110;
/**
 * Retour peak → repos en **timing** (pas spring) : un spring en fin de
 * séquence rebondit / corrige → micro-saccade au dernier pixel.
 */
const POP_SETTLE_MS = 260;
const POP_SETTLE_EASE = Easing.bezier(0.22, 1, 0.36, 1);
/** Durée totale add (halo scale borne le busy). */
const ADD_MOTION_BUSY_MS = Math.max(POP_UP_MS + POP_SETTLE_MS, HALO_SCALE_MS) + 40;

type Props = {
  favored: boolean;
  onPress: () => void;
  size?: number;
  /** Trait au repos (blanc sur média, encre sur disque clair). */
  strokeColor?: string;
  /**
   * Épaisseur Lucide (viewBox 24), calée comme crayon/share à 20 px.
   * Recalée si `size` ≠ 20 pour garder le même poids visuel.
   */
  strokeWidth?: number;
  fillColor?: string;
  /**
   * Halo blanc sur photo ; terracotta soft sur fond clair
   * (un halo blanc sur disque blanc est invisible).
   */
  halo?: 'white' | 'terracotta' | 'none';
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  hitSlop?: number | { top?: number; bottom?: number; left?: number; right?: number };
};

/**
 * ♡ Petitmo (fiche mouvement) — pas un scale Lucide.
 *
 * Ajout : remplissage 180 ms + scale → peak → repos agrandi + halo radial.
 * Retrait : fondu couleur 160 ms, sans rebond.
 */
export function FavoriteHeartButton({
  favored,
  onPress,
  size = 28,
  strokeColor = '#FFFFFF',
  strokeWidth = STROKE_REF_WIDTH,
  fillColor = THEME.feedFavoriteTerracotta,
  halo = 'white',
  style,
  accessibilityLabel,
  hitSlop = 8,
}: Props) {
  const fillProgress = useSharedValue(favored ? 1 : 0);
  const heartScale = useSharedValue(favored ? FAVORED_REST : 1);
  /** Contour : découplé du fill — disparaît dès le pop (évite outline noir géant + rouge dedans). */
  const strokeVisible = useSharedValue(favored ? 0 : 1);
  const haloOpacity = useSharedValue(0);
  const haloScale = useSharedValue(0.6);
  const busyRef = useRef(false);
  const motionGen = useRef(0);

  /** Même poids de trait que crayon/share à 20 px, même si le cœur est plus grand. */
  const strokeW = strokeWidth * (STROKE_REF_SIZE / size);

  /** Sync si l’état change hors tap (rollback sync, hydrate) — ne pas écraser un pop en cours. */
  useEffect(() => {
    if (busyRef.current) return;
    fillProgress.value = withTiming(favored ? 1 : 0, {
      duration: favored ? FILL_MS : UNFAVORITE_MS,
      easing: Easing.linear,
    });
    strokeVisible.value = withTiming(favored ? 0 : 1, {
      duration: favored ? POP_UP_MS : UNFAVORITE_MS,
      easing: Easing.out(Easing.cubic),
    });
    /** Timing court : pas d’assignation brute (évite un pop net si sync arrive tard). */
    heartScale.value = withTiming(favored ? FAVORED_REST : 1, {
      duration: 120,
      easing: POP_SETTLE_EASE,
    });
    if (!favored) {
      haloOpacity.value = 0;
      haloScale.value = 0.6;
    }
  }, [favored, fillProgress, heartScale, strokeVisible, haloOpacity, haloScale]);

  const runAddMotion = useCallback(() => {
    fillProgress.value = withTiming(1, { duration: FILL_MS, easing: Easing.linear });
    /** Outline off dès le 1er grossissement — pas attendre la fin du fill. */
    strokeVisible.value = withTiming(0, {
      duration: POP_UP_MS,
      easing: Easing.out(Easing.cubic),
    });
    heartScale.value = withSequence(
      withTiming(POP_PEAK, {
        duration: POP_UP_MS,
        easing: Easing.out(Easing.cubic),
      }),
      withTiming(FAVORED_REST, {
        duration: POP_SETTLE_MS,
        easing: POP_SETTLE_EASE,
      }),
    );
    if (halo === 'none') return;
    haloOpacity.value = 0.9;
    haloScale.value = 0.6;
    /** Fade plus court que l’expansion : le halo ne reste pas « ouvert » en fin de course. */
    haloOpacity.value = withTiming(0, {
      duration: HALO_FADE_MS,
      easing: MOTION_EASE.exit,
    });
    haloScale.value = withTiming(1.7, {
      duration: HALO_SCALE_MS,
      easing: MOTION_EASE.enter,
    });
  }, [fillProgress, heartScale, strokeVisible, halo, haloOpacity, haloScale]);

  const runRemoveMotion = useCallback(() => {
    fillProgress.value = withTiming(0, {
      duration: UNFAVORITE_MS,
      easing: Easing.linear,
    });
    strokeVisible.value = withTiming(1, {
      duration: UNFAVORITE_MS,
      easing: Easing.linear,
    });
    heartScale.value = withTiming(1, { duration: UNFAVORITE_MS });
    haloOpacity.value = 0;
    haloScale.value = 0.6;
  }, [fillProgress, heartScale, strokeVisible, haloOpacity, haloScale]);

  const handlePress = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const gen = ++motionGen.current;
    const adding = !favored;
    hapticFavorite(adding);
    if (adding) runAddMotion();
    else runRemoveMotion();
    onPress();
    setTimeout(
      () => {
        if (motionGen.current === gen) busyRef.current = false;
      },
      adding ? ADD_MOTION_BUSY_MS : UNFAVORITE_MS,
    );
  }, [favored, onPress, runAddMotion, runRemoveMotion]);

  const heartWrapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: heartScale.value }],
  }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: haloOpacity.value,
    transform: [{ scale: haloScale.value }],
  }));

  const fillProps = useAnimatedProps(() => ({
    fillOpacity: fillProgress.value,
  }));

  /** Contour disparaît dès le pop d’ajout (plus lié au fill lent). */
  const strokeProps = useAnimatedProps(() => ({
    strokeOpacity: strokeVisible.value,
  }));

  const haloSize = Math.round(size * 2.2);
  const haloColor = halo === 'terracotta' ? fillColor : '#FFFFFF';

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ??
        (favored ? 'Retirer des favoris' : 'Mettre en favori')
      }
      hitSlop={hitSlop}
      style={[styles.hit, style]}
    >
      {halo !== 'none' ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.halo,
            {
              width: haloSize,
              height: haloSize,
              marginLeft: -haloSize / 2,
              marginTop: -haloSize / 2,
            },
            haloStyle,
          ]}
        >
          <Svg width={haloSize} height={haloSize}>
            <Defs>
              <RadialGradient id="favHalo" cx="50%" cy="50%" r="50%">
                <Stop offset="0%" stopColor={haloColor} stopOpacity={0.85} />
                <Stop offset="68%" stopColor={haloColor} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle
              cx={haloSize / 2}
              cy={haloSize / 2}
              r={haloSize / 2}
              fill="url(#favHalo)"
            />
          </Svg>
        </Animated.View>
      ) : null}

      <Animated.View style={heartWrapStyle}>
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <AnimatedPath
            d={HEART_D}
            fill={fillColor}
            animatedProps={fillProps}
            stroke="none"
          />
          <AnimatedPath
            d={HEART_D}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeW}
            strokeLinejoin="round"
            animatedProps={strokeProps}
          />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  halo: {
    position: 'absolute',
    left: '50%',
    top: '50%',
  },
});
