import { useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

const SPRING = { damping: 22, stiffness: 220, mass: 0.7 } as const;
const MAX_SCALE = 3.5;
/** Seuil au-dessus duquel le pan est autorisé (évite de bloquer le swipe du pager à zoom 1). */
const PAN_SCALE_THRESHOLD = 1.02;

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, v));
}

type Props = {
  width: number;
  height: number;
  /** Page / spread actuellement visible dans le FlatList horizontal. */
  isPagerActive: boolean;
  children: ReactNode;
};

/**
 * Zoom pincement + léger déplacement quand zoomé ; double tap remet le zoom.
 * Le pan ne s’active que si le zoom dépasse un seuil, pour laisser le swipe du pager à zoom 1.
 */
export function BookPreviewZoomWrap({ width, height, isPagerActive, children }: Props) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);

  useEffect(() => {
    if (!isPagerActive) {
      scale.value = 1;
      tx.value = 0;
      ty.value = 0;
    }
  }, [isPagerActive, scale, tx, ty]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesMove((_e, sm) => {
          if (scale.value > PAN_SCALE_THRESHOLD) {
            sm.activate();
          } else {
            sm.fail();
          }
        })
        .onBegin(() => {
          panStartX.value = tx.value;
          panStartY.value = ty.value;
        })
        .onUpdate(e => {
          tx.value = panStartX.value + e.translationX;
          ty.value = panStartY.value + e.translationY;
          const maxTx = Math.max(0, ((scale.value - 1) * width) / 2);
          const maxTy = Math.max(0, ((scale.value - 1) * height) / 2);
          tx.value = clamp(tx.value, -maxTx, maxTx);
          ty.value = clamp(ty.value, -maxTy, maxTy);
        })
        .onEnd(() => {
          const maxTx = Math.max(0, ((scale.value - 1) * width) / 2);
          const maxTy = Math.max(0, ((scale.value - 1) * height) / 2);
          tx.value = withSpring(clamp(tx.value, -maxTx, maxTx), SPRING);
          ty.value = withSpring(clamp(ty.value, -maxTy, maxTy), SPRING);
        }),
    [height, width, panStartX, panStartY, scale, tx, ty]
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          pinchStartScale.value = scale.value;
        })
        .onUpdate(e => {
          scale.value = clamp(pinchStartScale.value * e.scale, 1, MAX_SCALE);
          const maxTx = Math.max(0, ((scale.value - 1) * width) / 2);
          const maxTy = Math.max(0, ((scale.value - 1) * height) / 2);
          tx.value = clamp(tx.value, -maxTx, maxTx);
          ty.value = clamp(ty.value, -maxTy, maxTy);
        })
        .onEnd(() => {
          scale.value = withSpring(scale.value, SPRING);
        }),
    [height, pinchStartScale, scale, tx, ty, width]
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
          scale.value = withSpring(1, SPRING);
          tx.value = withSpring(0, SPRING);
          ty.value = withSpring(0, SPRING);
        }),
    [scale, tx, ty]
  );

  const composed = useMemo(
    () => Gesture.Exclusive(Gesture.Simultaneous(panGesture, pinchGesture), doubleTap),
    [doubleTap, panGesture, pinchGesture]
  );

  const animStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
    }),
    []
  );

  return (
    <GestureDetector gesture={composed}>
      <View style={[styles.clip, { width, height }]} collapsable={false}>
        <Animated.View style={[styles.inner, { width, height }, animStyle]} collapsable={false}>
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  inner: {
    overflow: 'hidden',
  },
});
