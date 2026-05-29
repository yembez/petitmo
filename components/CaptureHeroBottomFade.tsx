import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  CAPTURE_TITLE_FADE_GRADIENT,
  CAPTURE_TITLE_FADE_GRADIENT_LOCATIONS,
} from '@/constants/captureHeroFade';

type CaptureHeroBottomFadeProps = {
  style?: StyleProp<ViewStyle>;
};

/**
 * Dégradé couleur chaud sous titre + CTA (sans BlurView / glass).
 */
export function CaptureHeroBottomFade({ style }: CaptureHeroBottomFadeProps) {
  return (
    <LinearGradient
      colors={[...CAPTURE_TITLE_FADE_GRADIENT]}
      locations={[...CAPTURE_TITLE_FADE_GRADIENT_LOCATIONS]}
      pointerEvents="none"
      style={[styles.fill, style]}
    />
  );
}

const styles = StyleSheet.create({
  fill: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
});
