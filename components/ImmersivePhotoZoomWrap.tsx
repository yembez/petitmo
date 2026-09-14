import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const SPRING = { damping: 22, stiffness: 220, mass: 0.7 } as const;
const MAX_SCALE = 3.5;
/** Au-dessus : pan photo actif + pager / dismiss bloqués. */
const PAN_SCALE_THRESHOLD = 1.02;

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, v));
}

type Props = {
  width: number;
  height: number;
  /** Page visible : reset du zoom en quittant. */
  isActive: boolean;
  /** true dès que scale > seuil — pour couper pager + drag-to-dismiss. */
  onZoomActiveChange?: (active: boolean) => void;
  children: ReactNode;
};

/**
 * Pinch + pan (quand zoomé) + double-tap reset pour une photo immersif.
 * Transform uniquement (pas de layout) — fluide sur le UI thread.
 */
export function ImmersivePhotoZoomWrap({
  width,
  height,
  isActive,
  onZoomActiveChange,
  children,
}: Props) {
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);
  const zoomActiveSV = useSharedValue(0);
  const onZoomRef = useRef(onZoomActiveChange);
  onZoomRef.current = onZoomActiveChange;

  const notifyZoomActive = useCallback((active: boolean) => {
    onZoomRef.current?.(active);
  }, []);

  useEffect(() => {
    if (isActive) return;
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
    if (zoomActiveSV.value === 1) {
      zoomActiveSV.value = 0;
      notifyZoomActive(false);
    }
  }, [isActive, notifyZoomActive, scale, tx, ty, zoomActiveSV]);

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
    [height, panStartX, panStartY, scale, tx, ty, width],
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
          const active = scale.value > PAN_SCALE_THRESHOLD ? 1 : 0;
          if (active !== zoomActiveSV.value) {
            zoomActiveSV.value = active;
            runOnJS(notifyZoomActive)(active === 1);
          }
        })
        .onEnd(() => {
          scale.value = withSpring(scale.value, SPRING);
          const active = scale.value > PAN_SCALE_THRESHOLD ? 1 : 0;
          if (active !== zoomActiveSV.value) {
            zoomActiveSV.value = active;
            runOnJS(notifyZoomActive)(active === 1);
          }
        }),
    [height, notifyZoomActive, pinchStartScale, scale, tx, ty, width, zoomActiveSV],
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
          scale.value = withSpring(1, SPRING);
          tx.value = withSpring(0, SPRING);
          ty.value = withSpring(0, SPRING);
          if (zoomActiveSV.value === 1) {
            zoomActiveSV.value = 0;
            runOnJS(notifyZoomActive)(false);
          }
        }),
    [notifyZoomActive, scale, tx, ty, zoomActiveSV],
  );

  const composed = useMemo(
    () => Gesture.Exclusive(Gesture.Simultaneous(panGesture, pinchGesture), doubleTap),
    [doubleTap, panGesture, pinchGesture],
  );

  const animStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
    }),
    [],
  );

  if (width <= 0 || height <= 0) {
    return <View style={styles.fill}>{children}</View>;
  }

  return (
    <GestureDetector gesture={composed}>
      <View style={[styles.clip, { width, height }]} collapsable={false}>
        <Animated.View
          style={[styles.inner, { width, height }, animStyle]}
          collapsable={false}
        >
          {children}
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  clip: {
    overflow: 'hidden',
  },
  inner: {
    overflow: 'hidden',
  },
});
