import React, { useCallback, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import {
  Blur,
  Canvas,
  Image as SkiaImage,
  Mask,
  RadialGradient,
  Rect,
  vec,
  useImage,
} from '@shopify/react-native-skia';
import {
  CAPTURE_HERO_EDGE_BLUR,
  CAPTURE_HERO_EDGE_MASK_INNER,
  CAPTURE_HERO_EDGE_MASK_RADIUS_RATIO,
} from '@/constants/captureHeroSkia';

type CaptureHeroSkiaPhotoInnerProps = {
  photoUri: string;
};

/** Calque Skia : flou sur les bords (nécessite `RNSkiaModule` dans le binaire). */
export function CaptureHeroSkiaPhotoInner({ photoUri }: CaptureHeroSkiaPhotoInnerProps) {
  const image = useImage(photoUri);
  const [layout, setLayout] = useState({ width: 0, height: 0 });

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setLayout(prev =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    }
  }, []);

  const { width, height } = layout;
  const ready = image != null && width > 0 && height > 0;
  const blurPad = CAPTURE_HERO_EDGE_BLUR * 2;
  const maskRadius = Math.max(width, height) * CAPTURE_HERO_EDGE_MASK_RADIUS_RATIO;

  return (
    <View style={StyleSheet.absoluteFill} onLayout={onLayout} pointerEvents="none">
      {ready ? (
        <Canvas style={{ width, height }}>
          <Mask
            mode="alpha"
            mask={
              <Rect x={0} y={0} width={width} height={height}>
                <RadialGradient
                  c={vec(width / 2, height / 2)}
                  r={maskRadius}
                  colors={['transparent', '#000000']}
                  positions={[CAPTURE_HERO_EDGE_MASK_INNER, 1]}
                />
              </Rect>
            }
          >
            <Blur blur={CAPTURE_HERO_EDGE_BLUR}>
              <SkiaImage
                image={image}
                x={-blurPad}
                y={-blurPad}
                width={width + blurPad * 2}
                height={height + blurPad * 2}
                fit="cover"
              />
            </Blur>
          </Mask>
        </Canvas>
      ) : null}
    </View>
  );
}
