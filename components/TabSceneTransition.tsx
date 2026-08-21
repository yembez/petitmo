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
  TAB_TRANSITION_OPACITY_FROM,
} from '@/constants/tabTransition';

type Props = {
  children: ReactNode;
  /** Fond sous l’animation — matcher l’écran (évite flash de couleur). */
  backgroundColor?: string;
};

const TAB_ENTER_EASING = Easing.out(Easing.quad);

/**
 * Entrée d’onglet : cross-fade court uniquement (pas de slide — pattern tab bar classique).
 */
export default function TabSceneTransition({
  children,
  backgroundColor = TAB_TRANSITION_FADE_BG,
}: Props) {
  const isFocused = useIsFocused();
  const opacity = useSharedValue(1);
  const hasEnteredOnceRef = useRef(false);

  useEffect(() => {
    if (!isFocused) return;

    if (!hasEnteredOnceRef.current) {
      hasEnteredOnceRef.current = true;
      opacity.value = 1;
      return;
    }

    opacity.value = TAB_TRANSITION_OPACITY_FROM;
    opacity.value = withTiming(1, {
      duration: TAB_TRANSITION_DURATION_MS,
      easing: TAB_ENTER_EASING,
    });
  }, [isFocused, opacity]);

  const sceneStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <View style={[styles.root, { backgroundColor }]}>
      <Reanimated.View style={[styles.scene, sceneStyle]}>{children}</Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scene: {
    flex: 1,
  },
});
