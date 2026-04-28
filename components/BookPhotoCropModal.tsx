import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { defaultPhotoCrop, type PhotoCrop } from '@/src/book/photoCrop';

const SPRING = { damping: 22, stiffness: 220, mass: 0.7 } as const;

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, v));
}

type Props = {
  visible: boolean;
  uri: string;
  /** Même logique que la zone photo dans la maquette (pour garder les % cohérents). */
  frameW: number;
  frameH: number;
  /** Taille réelle du fichier image (en pixels). */
  imgPxW: number;
  imgPxH: number;
  /** Taille imprimée visée (en mm) pour calcul DPI. */
  printMmW: number;
  printMmH: number;
  /** Optionnel (couverture) : ouvrir le picker pour changer de photo. */
  onChangePhoto?: () => void;
  initialCrop?: PhotoCrop;
  onCancel: () => void;
  onConfirm: (crop: PhotoCrop) => void;
};

function mmToIn(mm: number): number {
  return mm / 25.4;
}

function effectiveDpi(args: {
  imgPxW: number;
  imgPxH: number;
  printMmW: number;
  printMmH: number;
  scale: number;
}): number {
  const { imgPxW, imgPxH, printMmW, printMmH } = args;
  if (!imgPxW || !imgPxH) return 0;
  const s = Math.max(1, args.scale);
  const wIn = mmToIn(Math.max(1, printMmW));
  const hIn = mmToIn(Math.max(1, printMmH));
  const dpiX = (imgPxW / s) / wIn;
  const dpiY = (imgPxH / s) / hIn;
  return Math.floor(Math.min(dpiX, dpiY));
}

type DpiStatus = 'ok' | 'warn' | 'block';

function dpiStatus(dpi: number): DpiStatus {
  if (dpi < 200) return 'block';
  if (dpi < 240) return 'warn';
  return 'ok';
}

export function BookPhotoCropModal({
  visible,
  uri,
  frameW,
  frameH,
  imgPxW,
  imgPxH,
  printMmW,
  printMmH,
  onChangePhoto,
  initialCrop,
  onCancel,
  onConfirm,
}: Props) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const headerH = 52;
  const footerPad = 8;
  const usableH = Math.max(160, screenH - insets.top - insets.bottom - headerH - 80 - footerPad);
  const usableW = Math.max(160, screenW - 24);

  const k = useMemo(() => {
    const kw = usableW / Math.max(1, frameW);
    const kh = usableH / Math.max(1, frameH);
    return Math.min(1, kw, kh);
  }, [frameH, frameW, usableH, usableW]);

  const displayW = frameW * k;
  const displayH = frameH * k;

  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);

  useEffect(() => {
    if (!visible || !uri) return;
    const ic = initialCrop ?? defaultPhotoCrop();
    scale.value = Math.max(1, ic.scale);
    tx.value = (ic.xPct / 100) * frameW;
    ty.value = (ic.yPct / 100) * frameH;
  }, [visible, uri, initialCrop, frameW, frameH, scale, tx, ty]);

  const [liveScale, setLiveScale] = useState(1);
  useAnimatedReaction(
    () => scale.value,
    (next, prev) => {
      if (next === prev) return;
      runOnJS(setLiveScale)(next);
    },
    [scale]
  );

  const dpi = useMemo(
    () =>
      effectiveDpi({
        imgPxW,
        imgPxH,
        printMmW,
        printMmH,
        scale: liveScale,
      }),
    [imgPxH, imgPxW, liveScale, printMmH, printMmW]
  );
  const status = useMemo(() => dpiStatus(dpi), [dpi]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .onBegin(() => {
          panStartX.value = tx.value;
          panStartY.value = ty.value;
        })
        .onUpdate(e => {
          const dx = e.translationX / k;
          const dy = e.translationY / k;
          tx.value = panStartX.value + dx;
          ty.value = panStartY.value + dy;
          const maxTx = Math.max(0, ((scale.value - 1) * frameW) / 2);
          const maxTy = Math.max(0, ((scale.value - 1) * frameH) / 2);
          tx.value = clamp(tx.value, -maxTx, maxTx);
          ty.value = clamp(ty.value, -maxTy, maxTy);
        })
        .onEnd(() => {
          const maxTx = Math.max(0, ((scale.value - 1) * frameW) / 2);
          const maxTy = Math.max(0, ((scale.value - 1) * frameH) / 2);
          tx.value = withSpring(clamp(tx.value, -maxTx, maxTx), SPRING);
          ty.value = withSpring(clamp(ty.value, -maxTy, maxTy), SPRING);
        }),
    [frameH, frameW, k, panStartX, panStartY, scale, tx, ty]
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onBegin(() => {
          pinchStartScale.value = scale.value;
        })
        .onUpdate(e => {
          scale.value = clamp(pinchStartScale.value * e.scale, 1, 4);
          const maxTx = Math.max(0, ((scale.value - 1) * frameW) / 2);
          const maxTy = Math.max(0, ((scale.value - 1) * frameH) / 2);
          tx.value = clamp(tx.value, -maxTx, maxTx);
          ty.value = clamp(ty.value, -maxTy, maxTy);
        })
        .onEnd(() => {
          scale.value = withSpring(scale.value, SPRING);
        }),
    [frameH, frameW, pinchStartScale, scale, tx, ty]
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

  // IMPORTANT: si le double-tap est "prioritaire" (Exclusive en 1er),
  // il retarde la reconnaissance du pinch/pan (latence perceptible).
  // On donne la priorité au pinch/pan, et le double-tap ne s'exécute que
  // quand il n'y a pas eu de pan/pinch.
  const composed = useMemo(
    () => Gesture.Exclusive(Gesture.Simultaneous(panGesture, pinchGesture), doubleTap),
    [doubleTap, panGesture, pinchGesture]
  );

  const imageAnimatedStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
    }),
    []
  );

  const [busy, setBusy] = useState(false);

  const handleConfirm = useCallback(() => {
    if (busy) return;
    setBusy(true);
    try {
      onConfirm({
        xPct: (tx.value / frameW) * 100,
        yPct: (ty.value / frameH) * 100,
        scale: scale.value,
      });
    } finally {
      setBusy(false);
    }
  }, [busy, frameH, frameW, onConfirm, scale, tx, ty]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel} transparent={false}>
      <GestureHandlerRootView style={styles.ghRoot}>
        <View style={[styles.root, { paddingTop: insets.top }]}>
          <View style={styles.header}>
            <Pressable onPress={onCancel} hitSlop={12} accessibilityRole="button">
              <Text style={styles.headerBtn}>Annuler</Text>
            </Pressable>
            <Text style={styles.headerTitle}>{onChangePhoto ? 'Couverture' : 'Recadrer'}</Text>
            <Pressable onPress={handleConfirm} hitSlop={12} disabled={busy} accessibilityRole="button">
              <Text style={[styles.headerBtn, styles.headerBtnPrimary]}>OK</Text>
            </Pressable>
          </View>

          <View style={styles.body}>
            <Text style={styles.hint}>Glisser, pincer pour zoomer · double tap pour réinitialiser</Text>
            <Text
              style={[
                styles.dpiLine,
                status === 'ok' ? styles.dpiOk : status === 'warn' ? styles.dpiWarn : styles.dpiBlock,
              ]}
            >
              Impression : {dpi} DPI {status === 'ok' ? '(OK ≥ 240)' : status === 'warn' ? '(Warning < 240)' : '(Bloquant < 200)'}
            </Text>
            <View style={[styles.stageClip, { width: displayW, height: displayH }]}>
              <GestureDetector gesture={composed}>
                <Animated.View
                  style={[styles.stageLogical, { width: frameW, height: frameH, transform: [{ scale: k }] }]}
                >
                  <Animated.View style={[StyleSheet.absoluteFill, imageAnimatedStyle]}>
                    <ExpoImage source={{ uri }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
                  </Animated.View>
                </Animated.View>
              </GestureDetector>
            </View>
          </View>

          {onChangePhoto ? (
            <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10 }]}>
              <Pressable onPress={onChangePhoto} style={styles.changeBtn} accessibilityRole="button">
                <Text style={styles.changeBtnText}>Changer la photo</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ height: insets.bottom + 8 }} />
          )}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  ghRoot: {
    flex: 1,
  },
  root: {
    flex: 1,
    backgroundColor: '#111',
  },
  header: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  headerBtn: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 16,
    paddingVertical: 8,
  },
  headerBtnPrimary: {
    color: '#fff',
    fontWeight: '600',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  hint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 14,
    paddingHorizontal: 8,
  },
  dpiLine: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: -6,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  dpiOk: { color: 'rgba(255,255,255,0.72)' },
  dpiWarn: { color: '#FFD166' },
  dpiBlock: { color: '#FF6B6B' },
  stageClip: {
    overflow: 'hidden',
    borderRadius: 4,
    backgroundColor: '#000',
  },
  stageLogical: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
  },
  bottomBar: {
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  changeBtn: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  changeBtnText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 16,
    fontWeight: '600',
  },
});
