import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_ACTION_GRADIENT } from '@/constants/captureScreenPalette';
import {
  MOTION_CTA_MORPH_CHECK_MS,
  MOTION_CTA_MORPH_DISK_PT,
  MOTION_CTA_MORPH_ERROR_SHAKE_MS,
  MOTION_CTA_MORPH_ERROR_SHAKE_PX,
  MOTION_CTA_MORPH_HIT_SLOP,
  MOTION_CTA_MORPH_IDLE_RADIUS,
  MOTION_CTA_MORPH_LABEL_EXIT_MS,
  MOTION_CTA_MORPH_SHADOW,
  MOTION_CTA_MORPH_SHEEN,
  MOTION_CTA_MORPH_SUCCESS_HOLD_MS,
  MOTION_EASE,
  MOTION_EXIT_MS,
  MOTION_PRESS_OPACITY_DIP,
  MOTION_PRESS_SCALE,
  MOTION_SPRING,
  MOTION_SPRING_PHYS,
} from '@/constants/motion';
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import { hapticPress, hapticSuccess } from '@/lib/haptics';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Path coche (viewBox 26) — fiche mouvement. */
const CHECK_D = 'M6 13.4l4.6 4.4L20 7.8';
const CHECK_PATH_LEN = 28;

const SH = MOTION_CTA_MORPH_SHADOW;

export type PetitmoMorphPhase = 'idle' | 'busy' | 'success' | 'error';

type Props = {
  children: ReactNode;
  phase: PetitmoMorphPhase;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Hauteur CTA = diamètre du disque busy. */
  height?: number;
  accessibilityLabel?: string;
  testID?: string;
  /** Après check + hold — enchaîner (fermer feuille, naviguer…). */
  onSuccessHoldEnd?: () => void;
  /** Après secousse d’échec — remonter `phase` à `idle` côté parent. */
  onErrorShakeEnd?: () => void;
};

/**
 * CTA primaire morph : idle → disque spinner → check (ou secousse échec).
 * Press : scale 0.965 snap + opacité 0.94 + ombre qui se rétracte + liseré haut.
 */
export default function PetitmoPrimaryMorphButton({
  children,
  phase,
  onPress,
  disabled,
  style,
  height = MOTION_CTA_MORPH_DISK_PT,
  accessibilityLabel,
  testID,
  onSuccessHoldEnd,
  onErrorShakeEnd,
}: Props) {
  const [fullWidth, setFullWidth] = useState(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const widthSv = useSharedValue(0);
  const labelProgress = useSharedValue(1);
  const spinOpacity = useSharedValue(0);
  const checkProgress = useSharedValue(0);
  const shakeX = useSharedValue(0);
  const radiusSv = useSharedValue(height / 2);
  /** 0 repos → 1 pressé. */
  const pressed = useSharedValue(0);

  const idleRadius = Math.min(height / 2, MOTION_CTA_MORPH_IDLE_RADIUS);

  const onSlotLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w <= 0) return;
    setFullWidth(w);
    if (phaseRef.current === 'idle') {
      widthSv.value = w;
      radiusSv.value = idleRadius;
    }
  };

  useEffect(() => {
    if (fullWidth <= 0) return;

    if (phase === 'idle') {
      labelProgress.value = withTiming(1, {
        duration: MOTION_CTA_MORPH_LABEL_EXIT_MS,
        easing: MOTION_EASE.enter,
      });
      spinOpacity.value = withTiming(0, { duration: MOTION_EXIT_MS });
      checkProgress.value = 0;
      widthSv.value = withSpring(fullWidth, MOTION_SPRING.standard);
      radiusSv.value = withSpring(idleRadius, MOTION_SPRING.standard);
      return;
    }

    if (phase === 'busy') {
      pressed.value = withSpring(0, MOTION_SPRING.standard);
      labelProgress.value = withTiming(0, {
        duration: MOTION_CTA_MORPH_LABEL_EXIT_MS,
        easing: MOTION_EASE.exit,
      });
      widthSv.value = withSpring(height, MOTION_SPRING.standard);
      radiusSv.value = withSpring(height / 2, MOTION_SPRING.standard);
      spinOpacity.value = withTiming(1, {
        duration: MOTION_CTA_MORPH_LABEL_EXIT_MS,
        easing: MOTION_EASE.enter,
      });
      checkProgress.value = 0;
      return;
    }

    if (phase === 'success') {
      spinOpacity.value = withTiming(0, { duration: MOTION_EXIT_MS });
      checkProgress.value = withTiming(1, {
        duration: MOTION_CTA_MORPH_CHECK_MS,
        easing: Easing.out(Easing.cubic),
      });
      hapticSuccess();
      const t = setTimeout(() => {
        onSuccessHoldEnd?.();
      }, MOTION_CTA_MORPH_CHECK_MS + MOTION_CTA_MORPH_SUCCESS_HOLD_MS);
      return () => clearTimeout(t);
    }

    if (phase === 'error') {
      spinOpacity.value = withTiming(0, { duration: MOTION_EXIT_MS });
      const amp = MOTION_CTA_MORPH_ERROR_SHAKE_PX;
      const half = MOTION_CTA_MORPH_ERROR_SHAKE_MS / 4;
      shakeX.value = withSequence(
        withTiming(amp, { duration: half, easing: Easing.linear }),
        withTiming(-amp, { duration: half, easing: Easing.linear }),
        withTiming(amp, { duration: half, easing: Easing.linear }),
        withTiming(0, { duration: half, easing: Easing.linear }),
      );
      const t = setTimeout(() => {
        onErrorShakeEnd?.();
      }, MOTION_CTA_MORPH_ERROR_SHAKE_MS + 40);
      return () => clearTimeout(t);
    }
  }, [
    phase,
    fullWidth,
    height,
    idleRadius,
    checkProgress,
    labelProgress,
    onErrorShakeEnd,
    onSuccessHoldEnd,
    pressed,
    radiusSv,
    shakeX,
    spinOpacity,
    widthSv,
  ]);

  const pressShellStyle = useAnimatedStyle(() => {
    const p = pressed.value;
    return {
      width: widthSv.value > 0 ? widthSv.value : undefined,
      height,
      borderRadius: radiusSv.value,
      transform: [
        { translateX: shakeX.value },
        { scale: 1 - p * (1 - MOTION_PRESS_SCALE) },
      ],
      opacity: 1 - p * MOTION_PRESS_OPACITY_DIP,
      alignSelf: 'center' as const,
      maxWidth: '100%' as const,
    };
  });

  const isIOS = Platform.OS === 'ios';

  /** Couche ambiante — se rétracte au press (y 8→2, flou 20→6). */
  const ambientShadowStyle = useAnimatedStyle(() => {
    const p = pressed.value;
    if (!isIOS) {
      return {
        elevation: interpolate(p, [0, 1], [SH.elevation, SH.elevationPressed]),
        borderRadius: radiusSv.value,
      };
    }
    return {
      borderRadius: radiusSv.value,
      shadowColor: SH.color,
      shadowOffset: {
        width: 0,
        height: interpolate(p, [0, 1], [SH.ambient.offsetY, SH.ambientPressed.offsetY]),
      },
      shadowOpacity: interpolate(p, [0, 1], [SH.ambient.opacity, SH.ambientPressed.opacity]),
      shadowRadius: interpolate(p, [0, 1], [SH.ambient.radius, SH.ambientPressed.radius]),
    };
  });

  /** Couche contact — ombre courte sous le pill. */
  const contactShadowStyle = useAnimatedStyle(() => {
    const p = pressed.value;
    if (!isIOS) {
      return { borderRadius: radiusSv.value };
    }
    return {
      borderRadius: radiusSv.value,
      shadowColor: SH.color,
      shadowOffset: {
        width: 0,
        height: interpolate(p, [0, 1], [SH.contact.offsetY, SH.contactPressed.offsetY]),
      },
      shadowOpacity: interpolate(p, [0, 1], [SH.contact.opacity, SH.contactPressed.opacity]),
      shadowRadius: interpolate(p, [0, 1], [SH.contact.radius, SH.contactPressed.radius]),
    };
  });

  const faceStyle = useAnimatedStyle(() => ({
    borderRadius: radiusSv.value,
    overflow: 'hidden' as const,
    flex: 1,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: labelProgress.value,
    transform: [{ translateY: interpolate(labelProgress.value, [0, 1], [-10, 0]) }],
  }));

  const spinStyle = useAnimatedStyle(() => ({
    opacity: spinOpacity.value,
  }));

  const checkStyle = useAnimatedStyle(() => ({
    opacity: checkProgress.value,
  }));

  const checkPathProps = useAnimatedProps(() => ({
    strokeDashoffset: interpolate(checkProgress.value, [0, 1], [CHECK_PATH_LEN, 0]),
  }));

  const busy = phase === 'busy' || phase === 'success';
  const pressDisabled = disabled || busy || phase === 'error';

  return (
    <View style={[{ height, alignSelf: 'stretch', alignItems: 'center' }, style]} onLayout={onSlotLayout}>
      <Animated.View
        style={[
          fullWidth <= 0 ? styles.morphShellFill : null,
          pressDisabled && phase === 'idle' ? petitmoCtaStyles.primaryDisabled : null,
          ambientShadowStyle,
          pressShellStyle,
        ]}
      >
        <Animated.View style={[styles.contactHost, contactShadowStyle]}>
          <Animated.View style={[styles.face, faceStyle]}>
            <AnimatedPressable
              disabled={pressDisabled}
              onPress={onPress}
              hitSlop={MOTION_CTA_MORPH_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={accessibilityLabel}
              accessibilityState={{ busy: phase === 'busy', disabled: pressDisabled }}
              testID={testID}
              style={styles.hit}
              onPressIn={() => {
                if (pressDisabled) return;
                hapticPress();
                pressed.value = withSpring(1, MOTION_SPRING_PHYS.snap);
              }}
              onPressOut={() => {
                pressed.value = withSpring(0, MOTION_SPRING.standard);
              }}
            >
              <LinearGradient
                colors={[...BRAND_ACTION_GRADIENT]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
              {/* Liseré haut — matière, pas un aplat mort. */}
              <View pointerEvents="none" style={styles.sheen} />
              <Animated.View style={[styles.layer, labelStyle]} pointerEvents="none">
                {children}
              </Animated.View>
              <Animated.View style={[styles.layer, spinStyle]} pointerEvents="none">
                <ActivityIndicator size="small" color={PETITMO_CTA_SPINNER_COLOR} />
              </Animated.View>
              <Animated.View style={[styles.layer, checkStyle]} pointerEvents="none">
                <Svg width={22} height={22} viewBox="0 0 26 26">
                  <AnimatedPath
                    d={CHECK_D}
                    stroke="#FFFFFF"
                    strokeWidth={2.2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    fill="none"
                    strokeDasharray={`${CHECK_PATH_LEN} ${CHECK_PATH_LEN}`}
                    animatedProps={checkPathProps}
                  />
                </Svg>
              </Animated.View>
            </AnimatedPressable>
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  morphShellFill: {
    width: '100%',
  },
  contactHost: {
    flex: 1,
    backgroundColor: BRAND_ACTION_GRADIENT[0],
  },
  face: {
    backgroundColor: BRAND_ACTION_GRADIENT[0],
  },
  hit: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: MOTION_CTA_MORPH_SHEEN,
    zIndex: 3,
  },
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
