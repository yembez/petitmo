import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import BookPhotoDpiBadge from '@/components/BookPhotoDpiBadge';
import { defaultPhotoCrop, type PhotoCrop } from '@/src/book/photoCrop';
import { bookPhotoCoverBaseSize, clampBookPhotoCropPan } from '@/utils/bookPhotoCropLayout';
import {
  effectiveBlurScoreForCropScale,
  estimatePhotoBlurScore,
} from '@/utils/photoBlurScore';

const SPRING = { damping: 22, stiffness: 220, mass: 0.7 } as const;

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, v));
}

/** Bornes de pan max selon le mode (couverture au ratio réel vs page intérieure historique). */
function panMaxWorklet(
  useAspect: boolean,
  baseW: number,
  baseH: number,
  frameW: number,
  frameH: number,
  scale: number,
): { maxTx: number; maxTy: number } {
  'worklet';
  const ss = Math.max(1, scale);
  if (useAspect) {
    return {
      maxTx: Math.max(0, (baseW * ss - frameW) / 2),
      maxTy: Math.max(0, (baseH * ss - frameH) / 2),
    };
  }
  return {
    maxTx: Math.max(0, ((ss - 1) * frameW) / 2),
    maxTy: Math.max(0, ((ss - 1) * frameH) / 2),
  };
}

type Props = {
  uri: string;
  frameW: number;
  frameH: number;
  crop?: PhotoCrop;
  /** Pixels du fichier affiché (recadrage). */
  imgPxW: number;
  imgPxH: number;
  /** Pixels print pour le badge DPI (si absent = `imgPxW` / `imgPxH`). */
  dpiPxW?: number;
  dpiPxH?: number;
  printMmW: number;
  printMmH: number;
  /** Score netteté (Laplacien) pour le badge qualité. */
  blurScore?: number | null;
  onChange: (crop: PhotoCrop) => void;
  /**
   * Couverture : cale l'image sur son ratio réel dans le cadre (au lieu de `contentFit="cover"`),
   * pour pouvoir atteindre toute la photo en zoomant / glissant. `false` = comportement page intérieure.
   */
  coverMode?: boolean;
};

function cropFromShared(tx: number, ty: number, scale: number, frameW: number, frameH: number): PhotoCrop {
  return {
    xPct: (tx / frameW) * 100,
    yPct: (ty / frameH) * 100,
    scale,
  };
}

export function BookInlinePhotoCrop({
  uri,
  frameW,
  frameH,
  crop,
  imgPxW,
  imgPxH,
  dpiPxW,
  dpiPxH,
  printMmW,
  printMmH,
  blurScore,
  onChange,
  coverMode = false,
}: Props) {
  const badgePxW = dpiPxW && dpiPxW > 0 ? dpiPxW : imgPxW;
  const badgePxH = dpiPxH && dpiPxH > 0 ? dpiPxH : imgPxH;
  /** Mesure sur l’URI affichée (pas l’original bruyant du prefetch). */
  const [measuredBlur, setMeasuredBlur] = useState<number | null>(
    typeof blurScore === 'number' ? blurScore : null,
  );

  useEffect(() => {
    let cancelled = false;
    const u = uri.trim();
    if (!u) {
      setMeasuredBlur(null);
      return;
    }
    void estimatePhotoBlurScore(u).then(score => {
      if (!cancelled) setMeasuredBlur(score);
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  /**
   * En `coverMode`, l'image est calée à sa taille « cover » réelle (déborde le cadre sur un axe)
   * et déplaçable : on peut atteindre toute la photo. Sinon, comportement page intérieure
   * historique (`contentFit="cover"` + transform).
   */
  const useAspect = coverMode && imgPxW > 0 && imgPxH > 0;
  const { baseW, baseH } = useMemo(
    () =>
      useAspect
        ? bookPhotoCoverBaseSize(frameW, frameH, imgPxW, imgPxH)
        : { baseW: frameW, baseH: frameH },
    [useAspect, frameW, frameH, imgPxW, imgPxH]
  );

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);

  const commitCrop = useCallback(() => {
    onChange(cropFromShared(tx.value, ty.value, scale.value, frameW, frameH));
  }, [frameH, frameW, onChange, scale, tx, ty]);

  useEffect(() => {
    const ic = crop ?? defaultPhotoCrop();
    const s = Math.max(1, ic.scale);
    const rawTx = (ic.xPct / 100) * frameW;
    const rawTy = (ic.yPct / 100) * frameH;
    const { maxTx, maxTy } = panMaxWorklet(useAspect, baseW, baseH, frameW, frameH, s);
    scale.value = s;
    tx.value = Math.max(-maxTx, Math.min(maxTx, rawTx));
    ty.value = Math.max(-maxTy, Math.min(maxTy, rawTy));
  }, [crop, useAspect, baseW, baseH, frameH, frameW, scale, tx, ty, uri]);

  const [liveScale, setLiveScale] = useState(1);
  useAnimatedReaction(
    () => scale.value,
    (next, prev) => {
      if (next === prev) return;
      runOnJS(setLiveScale)(next);
    },
    [scale]
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .failOffsetX([-14, 14])
        .onBegin(() => {
          panStartX.value = tx.value;
          panStartY.value = ty.value;
        })
        .onUpdate(e => {
          const { maxTx, maxTy } = panMaxWorklet(useAspect, baseW, baseH, frameW, frameH, scale.value);
          tx.value = clamp(panStartX.value + e.translationX, -maxTx, maxTx);
          ty.value = clamp(panStartY.value + e.translationY, -maxTy, maxTy);
        })
        .onEnd(() => {
          const { maxTx, maxTy } = panMaxWorklet(useAspect, baseW, baseH, frameW, frameH, scale.value);
          tx.value = withSpring(clamp(tx.value, -maxTx, maxTx), SPRING);
          ty.value = withSpring(clamp(ty.value, -maxTy, maxTy), SPRING);
          runOnJS(commitCrop)();
        }),
    [commitCrop, useAspect, baseW, baseH, frameW, frameH, panStartX, panStartY, scale, tx, ty]
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          pinchStartScale.value = scale.value;
        })
        .onUpdate(e => {
          scale.value = clamp(pinchStartScale.value * e.scale, 1, 4);
          const { maxTx, maxTy } = panMaxWorklet(useAspect, baseW, baseH, frameW, frameH, scale.value);
          tx.value = clamp(tx.value, -maxTx, maxTx);
          ty.value = clamp(ty.value, -maxTy, maxTy);
        })
        .onEnd(() => {
          scale.value = withSpring(scale.value, SPRING);
          runOnJS(commitCrop)();
        }),
    [commitCrop, useAspect, baseW, baseH, frameW, frameH, pinchStartScale, scale, tx, ty]
  );

  const doubleTap = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(() => {
          scale.value = withSpring(1, SPRING);
          tx.value = withSpring(0, SPRING);
          ty.value = withSpring(0, SPRING);
          runOnJS(commitCrop)();
        }),
    [commitCrop, scale, tx, ty]
  );

  const composed = useMemo(
    () => Gesture.Exclusive(Gesture.Simultaneous(panGesture, pinchGesture), doubleTap),
    [doubleTap, panGesture, pinchGesture]
  );

  /**
   * Pan + zoom : en `coverMode` + ratio connu, position absolue identique à `bookPhotoCropImageRect`
   * (parité éditeur ↔ spread). Sinon transform historique page intérieure.
   */
  const coverRectStyle = useAnimatedStyle(() => {
    'worklet';
    const s = Math.max(1, scale.value);
    const width = baseW * s;
    const height = baseH * s;
    const { tx: clampedTx, ty: clampedTy } = clampBookPhotoCropPan(
      frameW,
      frameH,
      imgPxW,
      imgPxH,
      s,
      tx.value,
      ty.value,
    );
    return {
      position: 'absolute' as const,
      width,
      height,
      left: (frameW - width) / 2 + clampedTx,
      top: (frameH - height) / 2 + clampedTy,
    };
  }, [baseW, baseH, frameH, frameW, imgPxH, imgPxW]);

  const transformStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
    }),
    []
  );

  return (
    <View style={{ width: frameW, height: frameH }}>
      <GestureDetector gesture={composed}>
        <View style={[StyleSheet.absoluteFill, styles.frame]}>
          <Animated.View
            style={useAspect ? coverRectStyle : [StyleSheet.absoluteFill, transformStyle]}
          >
            <ExpoImage
              source={{ uri }}
              style={StyleSheet.absoluteFillObject}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={0}
            />
          </Animated.View>
        </View>
      </GestureDetector>

      <View style={styles.dpiDetailWrap} pointerEvents="none">
        <BookPhotoDpiBadge
          imgPxW={badgePxW}
          imgPxH={badgePxH}
          printMmW={printMmW}
          printMmH={printMmH}
          scale={liveScale}
          blurScore={effectiveBlurScoreForCropScale(
            measuredBlur ?? blurScore,
            liveScale,
          )}
        />
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: '#F2F2F7',
  },
  dpiDetailWrap: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    alignItems: 'flex-start',
  },
});
