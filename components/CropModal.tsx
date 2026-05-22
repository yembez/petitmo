import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Camera } from 'lucide-react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'expo-image';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import { useSafeAreaInsets, useSafeAreaFrame } from 'react-native-safe-area-context';
import { scale as s, verticalScale } from '@/utils/responsive';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import {
  computeCaptureHeroPhotoViewport,
  insetCropRectForCaptureHeroViewport,
} from '@/utils/captureHeroMetrics';

type CropModalProps = {
  visible: boolean;
  imageUri: string;
  onCancel: () => void;
  onConfirm: (croppedUri: string) => void;
  onChangePhoto: () => void;
};

type ImgSize = { width: number; height: number };

const SPRING = { damping: 22, stiffness: 220, mass: 0.7 } as const;

function clamp(v: number, min: number, max: number): number {
  'worklet';
  return Math.max(min, Math.min(max, v));
}

export function CropModal({ visible, imageUri, onCancel, onConfirm, onChangePhoto }: CropModalProps) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const headerH = 52;
  const footerH = 80;
  const bodyPadV = verticalScale(18);
  const headerTotalH = headerH + insets.top;
  const footerTotalH = footerH + insets.bottom;
  const stageH = Math.max(200, Math.round(screenH - headerTotalH - footerTotalH));
  const stageW = screenW;
  const maxCropH = Math.max(180, Math.round(stageH - bodyPadV * 2));

  /** Même ratio que le hero photo de l’onglet Capturer (plein cadre, sans bandes après export). */
  const captureHeroViewport = useMemo(
    () => computeCaptureHeroPhotoViewport(frame.height, screenH, screenW, insets.top),
    [frame.height, insets.top, screenH, screenW],
  );

  const cropRect = useMemo(() => {
    const maxW = Math.max(180, Math.round(screenW - 40));
    return insetCropRectForCaptureHeroViewport(maxW, maxCropH, captureHeroViewport);
  }, [captureHeroViewport, maxCropH, screenW]);

  const cropRectLeft = useMemo(() => (stageW - cropRect.width) / 2, [cropRect.width, stageW]);
  const cropRectTop = useMemo(() => (stageH - cropRect.height) / 2, [cropRect.height, stageH]);

  const [imgSize, setImgSize] = useState<ImgSize | null>(null);
  const [busy, setBusy] = useState(false);

  const imgW = useSharedValue(0);
  const imgH = useSharedValue(0);
  const baseScaleSv = useSharedValue(1);

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const panStartX = useSharedValue(0);
  const panStartY = useSharedValue(0);
  const pinchStartScale = useSharedValue(1);

  const maxScale = 5;

  useEffect(() => {
    if (!visible) return;
    if (!imageUri) return;
    setImgSize(null);
    scale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    // `expo-image` gère mieux certains URIs (file://, cache, etc.) via onLoad.
  }, [imageUri, scale, translateX, translateY, visible]);

  useEffect(() => {
    if (!visible) return;
    if (!imgSize) return;
    imgW.value = imgSize.width;
    imgH.value = imgSize.height;
    /** « Contain » : toute la photo visible au zoom 1 (pas de crop imposé comme avec Math.max / cover). */
    baseScaleSv.value = Math.min(cropRect.width / imgSize.width, cropRect.height / imgSize.height);
  }, [baseScaleSv, cropRect.height, cropRect.width, imgH, imgSize, imgW, visible]);

  const clampTranslate = () => {
    'worklet';
    const dispScale = baseScaleSv.value * scale.value;
    const dispW = imgW.value * dispScale;
    const dispH = imgH.value * dispScale;
    const maxTx = Math.abs(dispW - cropRect.width) / 2;
    const maxTy = Math.abs(dispH - cropRect.height) / 2;
    translateX.value = clamp(translateX.value, -maxTx, maxTx);
    translateY.value = clamp(translateY.value, -maxTy, maxTy);
  };

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!!imgSize)
        .onBegin(() => {
          panStartX.value = translateX.value;
          panStartY.value = translateY.value;
        })
        .onUpdate(e => {
          translateX.value = panStartX.value + e.translationX;
          translateY.value = panStartY.value + e.translationY;
          clampTranslate();
        })
        .onEnd(() => {
          const dispScale = baseScaleSv.value * scale.value;
          const dispW = imgW.value * dispScale;
          const dispH = imgH.value * dispScale;
          const maxTx = Math.abs(dispW - cropRect.width) / 2;
          const maxTy = Math.abs(dispH - cropRect.height) / 2;
          translateX.value = withSpring(clamp(translateX.value, -maxTx, maxTx), SPRING);
          translateY.value = withSpring(clamp(translateY.value, -maxTy, maxTy), SPRING);
        }),
    [baseScaleSv, cropRect.height, cropRect.width, imgH, imgSize, imgW, panStartX, panStartY, scale, translateX, translateY]
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(!!imgSize)
        .onBegin(() => {
          pinchStartScale.value = scale.value;
        })
        .onUpdate(e => {
          scale.value = clamp(pinchStartScale.value * e.scale, 1, maxScale);
          clampTranslate();
        })
        .onEnd(() => {
          if (scale.value < 1) scale.value = withSpring(1, SPRING);
          clampTranslate();
        }),
    [imgSize, pinchStartScale, scale]
  );

  const composedGesture = useMemo(
    () => Gesture.Simultaneous(panGesture, pinchGesture),
    [panGesture, pinchGesture]
  );

  const imageAnimatedStyle = useAnimatedStyle(() => {
    const dispScale = baseScaleSv.value * scale.value;
    return {
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value },
        { scale: dispScale },
      ],
    };
  }, [baseScaleSv]);

  const confirmCrop = useCallback(async () => {
    if (!imgSize) return;
    if (!imageUri) return;
    if (busy) return;
    setBusy(true);
    try {
      const dispScale = baseScaleSv.value * scale.value;
      const dispW = imgSize.width * dispScale;
      const dispH = imgSize.height * dispScale;

      // Image centrée dans le stage quand translate = 0.
      const imgLeft = (stageW - dispW) / 2 + translateX.value;
      const imgTop = (stageH - dispH) / 2 + translateY.value;

      const originX = (cropRectLeft - imgLeft) / dispScale;
      const originY = (cropRectTop - imgTop) / dispScale;
      const cropWpx = cropRect.width / dispScale;
      const cropHpx = cropRect.height / dispScale;

      const safeOriginX = Math.max(0, Math.min(imgSize.width - cropWpx, originX));
      const safeOriginY = Math.max(0, Math.min(imgSize.height - cropHpx, originY));
      const safeW = Math.max(1, Math.min(imgSize.width - safeOriginX, cropWpx));
      const safeH = Math.max(1, Math.min(imgSize.height - safeOriginY, cropHpx));

      const result = await ImageManipulator.manipulateAsync(
        imageUri,
        [
          {
            crop: {
              originX: Math.round(safeOriginX),
              originY: Math.round(safeOriginY),
              width: Math.round(safeW),
              height: Math.round(safeH),
            },
          },
          /** Largeur max seulement : conserve le ratio du crop (celui du hero Capturer). */
          { resize: { width: 800 } },
        ],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
      );
      onConfirm(result.uri);
    } finally {
      setBusy(false);
    }
  }, [
    baseScaleSv,
    busy,
    cropRect.height,
    cropRect.width,
    cropRectLeft,
    cropRectTop,
    imageUri,
    imgSize,
    onConfirm,
    scale,
    stageH,
    stageW,
    translateX,
    translateY,
  ]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onCancel}>
      <View style={styles.root}>
        <View style={[styles.header, { height: headerTotalH, paddingTop: insets.top }]}>
          <TouchableOpacity onPress={onCancel} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Annuler">
            <Text style={styles.headerCancel}>Annuler</Text>
          </TouchableOpacity>
          <View />
          <View style={{ width: s(44) }} />
        </View>

        <View style={styles.body}>
          <View style={[styles.stage, { width: stageW, height: stageH }]}>
            <GestureDetector gesture={composedGesture}>
              <Animated.View style={StyleSheet.absoluteFillObject}>
                {!imgSize ? (
                  <Image
                    source={{ uri: imageUri }}
                    style={StyleSheet.absoluteFillObject}
                    contentFit="cover"
                    onLoad={e => {
                      const w = e.source.width ?? 0;
                      const h = e.source.height ?? 0;
                      if (w > 0 && h > 0) setImgSize({ width: w, height: h });
                    }}
                  />
                ) : (
                  // Image à taille native, centrée dans le stage, puis transformée (zoom/pan)
                  <Animated.View
                    style={[
                      styles.imageNativeWrap,
                      {
                        left: (stageW - imgSize.width) / 2,
                        top: (stageH - imgSize.height) / 2,
                        width: imgSize.width,
                        height: imgSize.height,
                      },
                      imageAnimatedStyle,
                    ]}
                  >
                    <Image
                      source={{ uri: imageUri }}
                      style={StyleSheet.absoluteFillObject}
                      contentFit="fill"
                    />
                  </Animated.View>
                )}
              </Animated.View>
            </GestureDetector>

            {/* Assombrir l’extérieur de la zone de crop, tout en laissant voir l’image entière */}
            <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
              <Svg width="100%" height="100%">
                <Defs>
                  <Mask id="cropHole">
                    <Rect x="0" y="0" width="100%" height="100%" fill="#fff" />
                    <Rect
                      x={cropRectLeft}
                      y={cropRectTop}
                      width={cropRect.width}
                      height={cropRect.height}
                      fill="#000"
                    />
                  </Mask>
                </Defs>
                <Rect
                  x="0"
                  y="0"
                  width="100%"
                  height="100%"
                  fill="rgba(0,0,0,0.5)"
                  mask="url(#cropHole)"
                />
              </Svg>
              <View
                style={[
                  styles.cropFrame,
                  {
                    left: cropRectLeft,
                    top: cropRectTop,
                    width: cropRect.width,
                    height: cropRect.height,
                  },
                ]}
              />
            </View>
          </View>
        </View>

        <View style={[styles.footer, { height: footerTotalH, paddingBottom: insets.bottom }]}>
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={styles.changeBtn}
              activeOpacity={0.85}
              onPress={onChangePhoto}
              accessibilityRole="button"
              accessibilityLabel="Changer"
            >
              <Camera size={s(18)} color="#FFFFFF" strokeWidth={2.2} />
              <Text style={styles.changeBtnText}>Changer</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                petitmoCtaStyles.primary,
                styles.validateBtn,
                (!imgSize || busy) && petitmoCtaStyles.primaryDisabled,
              ]}
              activeOpacity={0.85}
              disabled={!imgSize || busy}
              onPress={() => void confirmCrop()}
              accessibilityRole="button"
              accessibilityLabel="Valider"
            >
              <Text style={[petitmoCtaStyles.primaryText, styles.validateBtnText]}>Valider</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  header: {
    paddingHorizontal: s(14),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerCancel: {
    color: '#FFFFFF',
    fontSize: s(15),
    fontWeight: '600',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: s(16),
    fontWeight: '600',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    backgroundColor: '#000',
  },
  imageNativeWrap: {
    position: 'absolute',
  },
  cropFrame: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.9)',
  },
  footer: {
    backgroundColor: '#111',
    paddingHorizontal: s(16),
    justifyContent: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    justifyContent: 'center',
  },
  changeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(18),
    paddingVertical: verticalScale(12),
    borderRadius: s(20),
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  changeBtnText: {
    color: '#FFFFFF',
    fontSize: s(14),
    fontWeight: '600',
  },
  validateBtn: {
    paddingHorizontal: s(18),
    paddingVertical: verticalScale(12),
  },
  validateBtnText: {
    fontSize: s(14),
    fontWeight: '700',
  },
});

