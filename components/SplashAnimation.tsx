/**
 * SplashAnimation — logo PETIT CŒUR sur dégradé marque.
 *
 * Timing :
 *   0.0 → 0.55s  — fade + scale-in doux
 *   0.55 → 1.35s — tenue
 *   1.35 → 1.75s — fondu vers l’app
 */

import React, { useEffect } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_ACTION_GRADIENT } from '@/constants/captureScreenPalette';
import PetitCoeurLogo, { PETIT_COEUR_LOGO_VIEWBOX } from '@/components/PetitCoeurLogo';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  withSpring,
  Easing,
  runOnJS,
} from 'react-native-reanimated';

interface Props {
  onFinished: () => void;
}

export default function SplashAnimation({ onFinished }: Props) {
  const { width: screenW } = useWindowDimensions();
  const logoW = Math.min(screenW * 0.78, 340);
  const logoH = logoW * (PETIT_COEUR_LOGO_VIEWBOX.height / PETIT_COEUR_LOGO_VIEWBOX.width);

  const globalOpacity = useSharedValue(1);
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.92);

  useEffect(() => {
    logoOpacity.value = withTiming(1, {
      duration: 420,
      easing: Easing.out(Easing.cubic),
    });
    logoScale.value = withSpring(1, {
      damping: 16,
      stiffness: 140,
      mass: 0.75,
    });

    globalOpacity.value = withDelay(
      1350,
      withTiming(
        0,
        {
          duration: 400,
          easing: Easing.out(Easing.quad),
        },
        (finished) => {
          if (finished) runOnJS(onFinished)();
        }
      )
    );
  }, [globalOpacity, logoOpacity, logoScale, onFinished]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: globalOpacity.value,
  }));

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  return (
    <Animated.View style={[styles.container, containerStyle]}>
      <LinearGradient
        colors={[...BRAND_ACTION_GRADIENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <Animated.View style={logoStyle}>
        <PetitCoeurLogo width={logoW} height={logoH} color="#FEFBFD" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
