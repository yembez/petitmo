import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
  type WithSpringConfig,
} from 'react-native-reanimated';
import {
  MOTION_ENTER_SCALE,
  MOTION_ENTER_SCALE_SOFT,
  MOTION_ENTER_TRANSLATE_PX,
  MOTION_ENTER_TRANSLATE_SOFT_PX,
  MOTION_EXIT_MS,
  MOTION_EXIT_STAGGER_MS,
  MOTION_SPRING_SETTLE,
  MOTION_SPRING_SOFT,
  MOTION_STAGGER_MS,
} from '@/constants/motion';

/** Bord d’où l’élément vient se placer ; `none` = échelle et opacité seules. */
export type MotionRevealFrom = 'top' | 'bottom' | 'none';

/** `settle` = un rebond lisible ; `soft` = pose Apple (quasi sans overshoot). */
export type MotionRevealFeel = 'settle' | 'soft';

/**
 * Apparition « qui se pose » : échelle + translation + opacité sur un spring amorti.
 *
 * `gate` pilote l’état (1 = visible) ; chaque élément joue son propre spring,
 * décalé par `order`, ce qui donne une vague plutôt qu’un fondu simultané.
 */
export function MotionReveal({
  gate,
  order = 0,
  from = 'bottom',
  withScale = true,
  feel = 'settle',
  style,
  children,
}: {
  gate: SharedValue<number> | null;
  /** Rang dans la vague (0 = premier). */
  order?: number;
  from?: MotionRevealFrom;
  /** Bloc pleine largeur : couper l’échelle, sinon le contenu dérive latéralement. */
  withScale?: boolean;
  feel?: MotionRevealFeel;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const progress = useSharedValue(gate ? 0 : 1);
  /**
   * Un élément monté alors que le gate est déjà ouvert (page suivante du pager,
   * recyclage de liste) doit être **déjà** en place : rejouer l’apparition le fait
   * surgir en retard sur un écran pourtant stabilisé.
   */
  const settled = useSharedValue(false);
  const soft = feel === 'soft';
  const spring: WithSpringConfig = soft ? MOTION_SPRING_SOFT : MOTION_SPRING_SETTLE;
  const enterScale = soft ? MOTION_ENTER_SCALE_SOFT : MOTION_ENTER_SCALE;
  const enterTy = soft ? MOTION_ENTER_TRANSLATE_SOFT_PX : MOTION_ENTER_TRANSLATE_PX;
  const stagger = soft ? 55 : MOTION_STAGGER_MS;

  useAnimatedReaction(
    () => (gate ? gate.value : 1),
    (open, previous) => {
      if (!settled.value) {
        settled.value = true;
        progress.value = open;
        return;
      }
      if (open === previous) return;
      progress.value = open
        ? withDelay(order * stagger, withSpring(1, spring))
        : withDelay(
            order * MOTION_EXIT_STAGGER_MS,
            withTiming(0, { duration: MOTION_EXIT_MS }),
          );
    },
  );

  const animStyle = useAnimatedStyle(() => {
    const p = progress.value;
    const direction = from === 'top' ? -1 : from === 'bottom' ? 1 : 0;
    return {
      opacity: Math.min(1, Math.max(0, p)),
      transform: [
        { translateY: (1 - p) * enterTy * direction },
        { scale: withScale ? enterScale + p * (1 - enterScale) : 1 },
      ],
    };
  });

  return (
    <Animated.View style={[style, animStyle]} pointerEvents="box-none">
      {children}
    </Animated.View>
  );
}
