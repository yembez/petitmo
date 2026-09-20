import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scale } from '@/utils/responsive';

const DOT = scale(7);
const GAP = scale(6);
const CYCLE_MS = 420;

type Props = {
  color: string;
  /** Accessibilité : le parent porte déjà le label. */
  accessibilityElementsHidden?: boolean;
};

function Dot({ color, delayMs }: { color: string; delayMs: number }) {
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    pulse.value = withDelay(
      delayMs,
      withRepeat(
        withSequence(
          withTiming(1, { duration: CYCLE_MS, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.35, { duration: CYCLE_MS, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );
  }, [delayMs, pulse]);

  const style = useAnimatedStyle(() => ({
    opacity: pulse.value,
    transform: [{ scale: 0.85 + pulse.value * 0.2 }],
  }));

  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

/** Trois points qui pulsent en décalage — attente média dans le fil. */
export function FeedLoadingDots({ color, accessibilityElementsHidden = true }: Props) {
  return (
    <View
      style={styles.row}
      accessibilityElementsHidden={accessibilityElementsHidden}
      importantForAccessibility="no-hide-descendants"
    >
      <Dot color={color} delayMs={0} />
      <Dot color={color} delayMs={CYCLE_MS / 2} />
      <Dot color={color} delayMs={CYCLE_MS} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: GAP,
    height: DOT * 1.4,
  },
  dot: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
  },
});
