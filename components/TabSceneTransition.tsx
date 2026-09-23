import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { TAB_TRANSITION_FADE_BG } from '@/constants/tabTransition';

type Props = {
  children: ReactNode;
  /** Fond sous la scène — matcher l’écran (évite flash de couleur). */
  backgroundColor?: string;
};

/**
 * Conteneur d’onglet (fond stable).
 *
 * Le cross-fade entre onglets est géré par Bottom Tabs (`animation: 'fade'`
 * dans `(tabs)/_layout`). Pas de fondu opacity local ici (évite un 2ᵉ paint
 * après focus sous charge JS).
 */
export default function TabSceneTransition({
  children,
  backgroundColor = TAB_TRANSITION_FADE_BG,
}: Props) {
  return <View style={[styles.root, { backgroundColor }]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
