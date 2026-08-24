/**
 * Cadre dégradé de la photo hero (Capturer), avec les couleurs qui tournent lentement
 * dans le contour. Purement décoratif : aucune donnée, aucun réseau.
 *
 * Le dégradé reste linéaire ; c'est un carré assez grand pour couvrir la diagonale
 * du cadre qui pivote derrière un calque rogné aux bords arrondis.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

/** Un tour complet — assez lent pour rester élégant et ne pas capter le regard. */
const TURN_DURATION_MS = 9000;

type Props = {
  children: ReactNode;
  colors: readonly [string, string, ...string[]];
  /** Rayon du cadre : le calque en rotation est rogné à cette forme. */
  borderRadius: number;
  /** Rotation en pause hors focus (onglet caché = zéro frame inutile). */
  animating?: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function CapturePhotoGradientFrame({
  children,
  colors,
  borderRadius,
  animating = true,
  style,
}: Props) {
  const spin = useRef(new Animated.Value(0)).current;
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(on => {
      if (alive) setReduceMotion(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const spinning = animating && !reduceMotion && frame.w > 0;

  useEffect(() => {
    if (!spinning) return;
    /** Reprise à l'angle d'origine : c'est l'orientation de la maquette, pas un saut visible. */
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: TURN_DURATION_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [spin, spinning]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setFrame(prev =>
      Math.abs(prev.w - width) < 1 && Math.abs(prev.h - height) < 1
        ? prev
        : { w: width, h: height }
    );
  };

  const side = Math.ceil(Math.hypot(frame.w, frame.h));

  return (
    <View
      onLayout={onLayout}
      style={[{ backgroundColor: colors[0], borderRadius }, style]}
    >
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { borderRadius, overflow: 'hidden' }]}
      >
        {side > 0 ? (
          <Animated.View
            style={{
              position: 'absolute',
              width: side,
              height: side,
              left: (frame.w - side) / 2,
              top: (frame.h - side) / 2,
              transform: [
                {
                  rotate: spin.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0deg', '360deg'],
                  }),
                },
              ],
            }}
          >
            <LinearGradient
              colors={[...colors] as readonly [string, string, ...string[]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          </Animated.View>
        ) : null}
      </View>
      {children}
    </View>
  );
}
