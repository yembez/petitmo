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
  TAB_TRANSITION_SLIDE_Y_PX,
} from '@/constants/tabTransition';

type Props = {
  children: ReactNode;
};

/**
 * Montée verticale légère à l’entrée sur un onglet — une seule piste d’animation
 * (pas de voile blanc par-dessus) pour garder le slide et le fondu synchrones.
 */
export default function TabSceneTransition({ children }: Props) {
  const isFocused = useIsFocused();
  const translateY = useSharedValue(0);
  const hasEnteredOnceRef = useRef(false);

  useEffect(() => {
    if (!isFocused) return;

    if (!hasEnteredOnceRef.current) {
      hasEnteredOnceRef.current = true;
      translateY.value = 0;
      return;
    }

    translateY.value = TAB_TRANSITION_SLIDE_Y_PX;
    translateY.value = withTiming(0, {
      duration: TAB_TRANSITION_DURATION_MS,
      easing: Easing.out(Easing.cubic),
    });
  }, [isFocused, translateY]);

  const sceneStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <View style={styles.root}>
      <Reanimated.View style={[styles.scene, sceneStyle]}>{children}</Reanimated.View>
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
});
