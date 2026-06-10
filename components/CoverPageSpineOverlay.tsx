import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { scale } from '@/utils/responsive';

/** Trait de pli à ~5 px du bord gauche de la couverture. */
const SPINE_LINE_INSET = scale(5);
/** Fondu court à droite du trait (vers la face). */
const SPINE_GRAD_RIGHT = scale(6);

/**
 * Tranche de couverture sur toute la hauteur de la page (photo + bande titre) :
 * trait de pli légèrement en retrait du bord, courts dégradés de chaque côté.
 */
export default function CoverPageSpineOverlay() {
  const hairline = Math.max(StyleSheet.hairlineWidth, 1);

  return (
    <View pointerEvents="none" style={styles.root}>
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.11)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ width: SPINE_LINE_INSET, height: '100%' }}
      />
      <View style={[styles.line, { width: hairline }]} />
      <LinearGradient
        colors={['rgba(0,0,0,0.06)', 'rgba(0,0,0,0)']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ width: SPINE_GRAD_RIGHT, height: '100%' }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  line: {
    height: '100%',
    backgroundColor: 'rgba(0,0,0,0.17)',
  },
});
