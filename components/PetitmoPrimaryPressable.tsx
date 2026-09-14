import type { ReactNode } from 'react';
import {
  StyleSheet,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import MotionPressable from '@/components/MotionPressable';
import { BRAND_ACTION_GRADIENT } from '@/constants/captureScreenPalette';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';

type Props = {
  children: ReactNode;
  /** Styles sur le conteneur (coins, padding, disabled…). */
  style?: StyleProp<ViewStyle>;
  onPress?: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  accessibilityRole?: 'button';
  accessibilityLabel?: string;
  testID?: string;
  /** Conservé pour compat call-sites ; l’appui utilise le scale MotionPressable. */
  activeOpacity?: number;
  haptic?: boolean;
};

/**
 * CTA primaire — dégradé rose→orangé, texte blanc attendu via `petitmoCtaStyles.primaryText`.
 * Appui = scale (pas d’activeOpacity translucide).
 */
export default function PetitmoPrimaryPressable({
  children,
  style,
  disabled,
  onPress,
  accessibilityRole = 'button',
  accessibilityLabel,
  testID,
  haptic = true,
}: Props) {
  return (
    <MotionPressable
      disabled={disabled}
      onPress={onPress}
      haptic={haptic && !disabled}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[petitmoCtaStyles.primary, style, disabled ? petitmoCtaStyles.primaryDisabled : null]}
    >
      <LinearGradient
        colors={[...BRAND_ACTION_GRADIENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      {children}
    </MotionPressable>
  );
}
