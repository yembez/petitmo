import type { ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_ACTION_GRADIENT } from '@/constants/captureScreenPalette';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Fond dégradé rose→orangé pour CTA primaires. */
export default function PetitmoPrimaryGradient({ children, style }: Props) {
  return (
    <LinearGradient
      colors={[...BRAND_ACTION_GRADIENT]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={style}
    >
      {children}
    </LinearGradient>
  );
}
