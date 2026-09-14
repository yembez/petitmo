import { createContext, useContext, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';

const ImmersiveMediaRevealContext = createContext<SharedValue<number> | null>(null);

/** 1 = média affiché ; 0 tant que le clone de la vignette porte le zoom. */
export function ImmersiveMediaRevealProvider({
  reveal,
  children,
}: {
  reveal: SharedValue<number>;
  children: ReactNode;
}) {
  return (
    <ImmersiveMediaRevealContext.Provider value={reveal}>
      {children}
    </ImmersiveMediaRevealContext.Provider>
  );
}

/**
 * Masque le **seul** média pendant le zoom.
 *
 * Le chrome et le dégradé restent hors de ce masque : sans ça leurs animations
 * se jouent sous une couche invisible et l’interface semble apparaître d’un bloc
 * une fois le zoom terminé.
 */
export function ImmersiveMediaReveal({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reveal = useContext(ImmersiveMediaRevealContext);
  const animStyle = useAnimatedStyle(() => ({
    opacity: reveal ? reveal.value : 1,
  }));

  return (
    <Animated.View style={[style, animStyle]} pointerEvents="box-none">
      {children}
    </Animated.View>
  );
}
