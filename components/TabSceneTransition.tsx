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
 * Les onglets utilisent `animation: 'none'` (cut) — le fade RN Screens
 * pouvait laisser l’écran entrant à opacity 0 (blanc figé, sans Sentry).
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
