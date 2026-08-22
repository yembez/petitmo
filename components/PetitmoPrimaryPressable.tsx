import type { ReactNode } from 'react';
import {
  TouchableOpacity,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type TouchableOpacityProps,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BRAND_ACTION_GRADIENT } from '@/constants/captureScreenPalette';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';

type Props = TouchableOpacityProps & {
  children: ReactNode;
  /** Styles sur le conteneur (coins, padding, disabled…). */
  style?: StyleProp<ViewStyle>;
};

/**
 * CTA primaire — dégradé `#FD6F9F` → `#FD7D4D`, texte blanc attendu via `petitmoCtaStyles.primaryText`.
 */
export default function PetitmoPrimaryPressable({
  children,
  style,
  disabled,
  activeOpacity = 0.88,
  ...rest
}: Props) {
  return (
    <TouchableOpacity
      {...rest}
      disabled={disabled}
      activeOpacity={activeOpacity}
      style={[petitmoCtaStyles.primary, style, disabled ? petitmoCtaStyles.primaryDisabled : null]}
    >
      <LinearGradient
        colors={[...BRAND_ACTION_GRADIENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {children}
    </TouchableOpacity>
  );
}
