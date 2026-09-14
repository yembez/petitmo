import { createContext, useContext, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { MotionReveal, type MotionRevealFrom } from '@/components/MotionReveal';

const ImmersiveChromeGateContext = createContext<SharedValue<number> | null>(null);

/** 1 = chrome en place. Le viewer bascule la valeur, chaque élément joue son spring. */
export function ImmersiveChromeGateProvider({
  gate,
  children,
}: {
  gate: SharedValue<number>;
  children: ReactNode;
}) {
  return (
    <ImmersiveChromeGateContext.Provider value={gate}>
      {children}
    </ImmersiveChromeGateContext.Provider>
  );
}

/**
 * Chrome du viewer immersif (fermer, pastilles, crayon, légende, cœur).
 * `pointerEvents` reste piloté par le parent (box-none / auto).
 * `gate` optionnel : légende bas sur son propre rythme (pas la vague chrome du zoom).
 */
export function ImmersiveChromeReveal({
  children,
  style,
  order = 0,
  from = 'bottom',
  withScale = true,
  gate: gateOverride,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  order?: number;
  from?: MotionRevealFrom;
  withScale?: boolean;
  gate?: SharedValue<number> | null;
}) {
  const gateCtx = useContext(ImmersiveChromeGateContext);
  const gate = gateOverride !== undefined ? gateOverride : gateCtx;
  return (
    <MotionReveal
      gate={gate}
      order={order}
      from={from}
      withScale={withScale}
      style={style}
    >
      {children}
    </MotionReveal>
  );
}
