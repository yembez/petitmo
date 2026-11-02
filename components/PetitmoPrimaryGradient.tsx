import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { THEME } from '@/constants/theme';

type Props = {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Fond CTA primaire — corail Capturer uni (`#FC5757`). Nom historique « Gradient ». */
export default function PetitmoPrimaryGradient({ children, style }: Props) {
  return (
    <View style={[{ backgroundColor: THEME.brandPrimary }, style]}>
      {children}
    </View>
  );
}
