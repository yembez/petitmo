/**
 * Essai Capturer — disques outline (Favoris empty) + mêmes ombres / press
 * que `CaptureDiscCtaGradient`.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import Reanimated, {
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { petitmoHaptic } from '@/lib/haptics';
import {
  MOTION_CAPTURE_PRESS_OPACITY_DIP,
  MOTION_CAPTURE_PRESS_SCALE,
  MOTION_CTA_MORPH_HIT_SLOP,
  MOTION_SPRING,
  MOTION_SPRING_PHYS,
} from '@/constants/motion';
import { CAPTURE_SCREEN_BG } from '@/constants/captureScreenPalette';
import { PETITMO_CTA_BORDER_WIDTH } from '@/constants/petitmoCtaStyles';
import {
  CAPTURE_CTA_SIZE,
  CAPTURE_CTA_SIZE_COMPACT,
} from '@/constants/captureCtaVariant';
import { THEME } from '@/constants/theme';
import { loadedFontStyle } from '@/utils/loadedFontStyle';
import { scale, verticalScale } from '@/utils/responsive';

/**
 * Même structure que `MOTION_CAPTURE_PRESS_SHADOW`, mais plus discrète
 * (outline clair — les ombres fortes des disques dégradés étaient trop marquées).
 */
const SH = {
  color: '#1C1C1E',
  ambient: { offsetY: 3, radius: 8, opacity: 0.08 },
  ambientPressed: { offsetY: 1, radius: 3, opacity: 0.04 },
  contact: { offsetY: 1, radius: 2, opacity: 0.06 },
  contactPressed: { offsetY: 0, radius: 1, opacity: 0.03 },
  elevation: 2,
  elevationPressed: 0,
} as const;

/**
 * Contour encore plus doux que le gris encre — lisible sans peser sur le beige Capturer.
 */
const CAPTURE_OUTLINE_BORDER = '#9A9AA0';

type Props = {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  labelFontFamily?: string;
  compact?: boolean;
  accessibilityLabel?: string;
};

export default function CaptureDiscCtaOutline({
  label,
  icon,
  onPress,
  labelFontFamily,
  compact = false,
  accessibilityLabel,
}: Props) {
  const ctaSize = compact ? CAPTURE_CTA_SIZE_COMPACT : CAPTURE_CTA_SIZE;
  const radius = ctaSize / 2;
  const pressed = useSharedValue(0);
  const isIOS = Platform.OS === 'ios';

  /** Nav / picker peuvent couper `onPressOut` → reset à chaque mount. */
  useEffect(() => {
    pressed.value = 0;
  }, [pressed]);

  const pressShellStyle = useAnimatedStyle(() => {
    const p = pressed.value;
    return {
      width: ctaSize,
      height: ctaSize,
      borderRadius: radius,
      transform: [{ scale: 1 - p * (1 - MOTION_CAPTURE_PRESS_SCALE) }],
      opacity: 1 - p * MOTION_CAPTURE_PRESS_OPACITY_DIP,
    };
  });

  const ambientShadowStyle = useAnimatedStyle(() => {
    const p = pressed.value;
    if (!isIOS) {
      return {
        elevation: interpolate(p, [0, 1], [SH.elevation, SH.elevationPressed]),
        borderRadius: radius,
      };
    }
    return {
      borderRadius: radius,
      shadowColor: SH.color,
      shadowOffset: {
        width: 0,
        height: interpolate(p, [0, 1], [SH.ambient.offsetY, SH.ambientPressed.offsetY]),
      },
      shadowOpacity: interpolate(p, [0, 1], [SH.ambient.opacity, SH.ambientPressed.opacity]),
      shadowRadius: interpolate(p, [0, 1], [SH.ambient.radius, SH.ambientPressed.radius]),
    };
  });

  const contactShadowStyle = useAnimatedStyle(() => {
    const p = pressed.value;
    if (!isIOS) {
      return { borderRadius: radius };
    }
    return {
      borderRadius: radius,
      shadowColor: SH.color,
      shadowOffset: {
        width: 0,
        height: interpolate(p, [0, 1], [SH.contact.offsetY, SH.contactPressed.offsetY]),
      },
      shadowOpacity: interpolate(p, [0, 1], [SH.contact.opacity, SH.contactPressed.opacity]),
      shadowRadius: interpolate(p, [0, 1], [SH.contact.radius, SH.contactPressed.radius]),
    };
  });

  return (
    <Pressable
      onPress={() => {
        pressed.value = 0;
        onPress();
      }}
      onPressIn={() => {
        void petitmoHaptic('favorite');
        pressed.value = withSpring(1, MOTION_SPRING_PHYS.snap);
      }}
      onPressOut={() => {
        pressed.value = withSpring(0, MOTION_SPRING.standard);
      }}
      hitSlop={MOTION_CTA_MORPH_HIT_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={styles.touch}
    >
      <Reanimated.View style={[ambientShadowStyle, pressShellStyle]}>
        <Reanimated.View
          style={[
            styles.contact,
            { width: ctaSize, height: ctaSize, borderRadius: radius },
            contactShadowStyle,
          ]}
        >
          <View
            style={[
              styles.disc,
              {
                width: ctaSize,
                height: ctaSize,
                borderRadius: radius,
              },
            ]}
          >
            {icon}
          </View>
        </Reanimated.View>
      </Reanimated.View>
      <Text
        style={[
          styles.label,
          compact && styles.labelCompact,
          loadedFontStyle(labelFontFamily),
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touch: {
    alignItems: 'center',
    gap: verticalScale(10),
    maxWidth: CAPTURE_CTA_SIZE + scale(16),
    paddingHorizontal: scale(6),
  },
  contact: {
    backgroundColor: 'transparent',
  },
  /**
   * Contour Favoris empty (1 px). Fond = beige Capturer pour que l’ombre iOS
   * s’accroche (un vrai transparent n’en projette pas).
   */
  disc: {
    borderWidth: PETITMO_CTA_BORDER_WIDTH,
    borderColor: CAPTURE_OUTLINE_BORDER,
    backgroundColor: CAPTURE_SCREEN_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: scale(12),
    lineHeight: scale(14),
    color: THEME.captureCtaLabelColor,
    letterSpacing: 0.15,
    textAlign: 'center',
    maxWidth: '100%',
    paddingHorizontal: scale(2),
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  labelCompact: {
    fontSize: scale(12),
    lineHeight: scale(15),
  },
});
