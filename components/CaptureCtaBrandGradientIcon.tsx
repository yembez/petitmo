/**
 * Icône Lucide masquée avec le dégradé splash / icône d’app
 * (`BRAND_SPLASH_GRADIENT` rose → corail).
 */
import { View, StyleSheet } from 'react-native';
import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import type { LucideIcon } from 'lucide-react-native';
import { BRAND_SPLASH_GRADIENT } from '@/constants/captureScreenPalette';

type Props = {
  Icon: LucideIcon;
  size: number;
  strokeWidth?: number;
};

export default function CaptureCtaBrandGradientIcon({
  Icon,
  size,
  strokeWidth = 2.4,
}: Props) {
  return (
    <MaskedView
      style={{ width: size, height: size }}
      maskElement={
        <View style={styles.mask}>
          <Icon size={size} color="#000000" fill="none" strokeWidth={strokeWidth} />
        </View>
      }
    >
      <LinearGradient
        colors={[...BRAND_SPLASH_GRADIENT]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={{ width: size, height: size }}
      />
    </MaskedView>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
