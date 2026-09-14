import type { ReactNode } from 'react';
import {
  Pressable,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {
  MOTION_PRESS_IN_MS,
  MOTION_PRESS_OPACITY_DIP,
  MOTION_PRESS_SCALE,
  MOTION_SPRING_PRESS,
} from '@/constants/motion';
import { hapticPress, petitmoHaptic } from '@/lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type MotionPressHaptic = boolean | 'light' | 'medium';

type PressScaleOptions = {
  haptic?: MotionPressHaptic;
  pressScale?: number;
  pressOpacityDip?: number;
  pressInMs?: number;
  /** Couleur de repos du fond (requis si `pressFill` est défini). */
  pressFillFrom?: string;
  /** Fond au press — flash gris franc (ex. crayon annotation). */
  pressFill?: string;
};

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /**
   * Haptic au pressIn — **opt-in** (défaut false).
   * `medium` pour les gestes prioritaires (annotation fil).
   */
  haptic?: MotionPressHaptic;
  /** Compression sous le doigt (défaut `MOTION_PRESS_SCALE`). */
  pressScale?: number;
  pressOpacityDip?: number;
  pressInMs?: number;
  pressFillFrom?: string;
  pressFill?: string;
};

function firePressHaptic(haptic: MotionPressHaptic) {
  if (!haptic) return;
  if (haptic === 'medium') {
    void petitmoHaptic('favorite'); // Medium impact
    return;
  }
  hapticPress();
}

/**
 * Handlers + style press — pour `GestureTouchableOpacity` (RNGH / Swipeable)
 * où `MotionPressable` (RN Pressable) entrerait en conflit de geste.
 */
export function useMotionPressScale(options?: PressScaleOptions) {
  const haptic = options?.haptic ?? false;
  const pressScale = options?.pressScale ?? MOTION_PRESS_SCALE;
  const pressOpacityDip = options?.pressOpacityDip ?? MOTION_PRESS_OPACITY_DIP;
  const pressInMs = options?.pressInMs ?? MOTION_PRESS_IN_MS;
  const pressFillFrom = options?.pressFillFrom;
  const pressFill = options?.pressFill;
  const pressed = useSharedValue(0);

  const animStyle = useAnimatedStyle(() => {
    const base = {
      transform: [{ scale: 1 - pressed.value * (1 - pressScale) }],
      opacity: 1 - pressed.value * pressOpacityDip,
    };
    if (pressFill && pressFillFrom) {
      return {
        ...base,
        backgroundColor: interpolateColor(
          pressed.value,
          [0, 1],
          [pressFillFrom, pressFill],
        ),
      };
    }
    return base;
  });

  const onPressIn = (event?: GestureResponderEvent) => {
    firePressHaptic(haptic);
    pressed.value = withTiming(1, { duration: pressInMs });
    void event;
  };

  const onPressOut = (event?: GestureResponderEvent) => {
    pressed.value = withSpring(0, MOTION_SPRING_PRESS);
    void event;
  };

  return { animStyle, onPressIn, onPressOut };
}

/**
 * Appui tactile : compression immédiate sous le doigt, retour spring au relâchement.
 * Réservé aux **contrôles** (boutons) — jamais une photo / carte contenu.
 */
export default function MotionPressable({
  children,
  style,
  haptic = false,
  pressScale = MOTION_PRESS_SCALE,
  pressOpacityDip,
  pressInMs,
  pressFillFrom,
  pressFill,
  ...pressableProps
}: Props) {
  const { animStyle, onPressIn, onPressOut } = useMotionPressScale({
    haptic,
    pressScale,
    pressOpacityDip,
    pressInMs,
    pressFillFrom,
    pressFill,
  });

  return (
    <AnimatedPressable
      {...pressableProps}
      onPressIn={event => {
        onPressIn(event);
        pressableProps.onPressIn?.(event);
      }}
      onPressOut={event => {
        onPressOut(event);
        pressableProps.onPressOut?.(event);
      }}
      style={[style, animStyle]}
    >
      {children}
    </AnimatedPressable>
  );
}
