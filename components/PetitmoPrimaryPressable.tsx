import type { ReactNode } from 'react';
import {
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import MotionPressable from '@/components/MotionPressable';
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
 * CTA primaire — corail Capturer uni (`THEME.brandPrimary` / `#FC5757`), texte blanc.
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
      {children}
    </MotionPressable>
  );
}
