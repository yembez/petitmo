import { useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import Reanimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import {
  TAB_TRANSITION_DURATION_MS,
  TAB_TRANSITION_FADE_BG,
  TAB_TRANSITION_FLASH_OPACITY,
  TAB_TRANSITION_SLIDE_Y_PX,
} from '@/constants/tabTransition';

type Props = {
  children: ReactNode;
};

/**
 * Fondu blanc cassé charte + montée verticale légère à l’entrée sur un onglet.
 */
export default function TabSceneTransition({ children }: Props) {
  const isFocused = useIsFocused();
  const opacity = useSharedValue(1);
  const translateY = useSharedValue(0);
  const flashOpacity = useSharedValue(0);
  const hasEnteredOnceRef = useRef(false);

  useEffect(() => {
    if (!isFocused) return;

    if (!hasEnteredOnceRef.current) {
      hasEnteredOnceRef.current = true;
      opacity.value = 1;
      translateY.value = 0;
      flashOpacity.value = 0;
      return;
    }

    opacity.value = 0;
    translateY.value = TAB_TRANSITION_SLIDE_Y_PX;
    flashOpacity.value = TAB_TRANSITION_FLASH_OPACITY;

    const easing = Easing.out(Easing.cubic);
    const timing = { duration: TAB_TRANSITION_DURATION_MS, easing };

    opacity.value = withTiming(1, timing);
    translateY.value = withTiming(0, timing);
    flashOpacity.value = withTiming(0, timing);
  }, [flashOpacity, isFocused, opacity, translateY]);

  const sceneStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
  }));

  return (
    <View style={styles.root}>
      <Reanimated.View style={[styles.scene, sceneStyle]}>{children}</Reanimated.View>
      <Reanimated.View pointerEvents="none" style={[styles.flash, flashStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: TAB_TRANSITION_FADE_BG,
  },
  scene: {
    flex: 1,
  },
  flash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: TAB_TRANSITION_FADE_BG,
  },
});
