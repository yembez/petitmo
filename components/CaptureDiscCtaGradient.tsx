/**
 * Design exact des 3 CTA Capturer (disques dégradés + ombres + sheen).
 * Backup — basculer `CAPTURE_CTA_VARIANT` → `'gradient'` dans `captureCtaVariant.ts`.
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
import { LinearGradient } from 'expo-linear-gradient';
import { petitmoHaptic } from '@/lib/haptics';
import {
  MOTION_CAPTURE_PRESS_OPACITY_DIP,
  MOTION_CAPTURE_PRESS_SCALE,
  MOTION_CAPTURE_PRESS_SHADOW,
  MOTION_CTA_MORPH_HIT_SLOP,
  MOTION_CTA_MORPH_SHEEN,
  MOTION_SPRING,
  MOTION_SPRING_PHYS,
} from '@/constants/motion';
import { CAPTURE_CTA_GRADIENT_LOCATIONS } from '@/constants/captureScreenPalette';
import {
  CAPTURE_CTA_SIZE,
  CAPTURE_CTA_SIZE_COMPACT,
} from '@/constants/captureCtaVariant';
import { PETITMO_CTA_BORDER_RADIUS } from '@/constants/petitmoCtaStyles';
import { THEME } from '@/constants/theme';
import { loadedFontStyle } from '@/utils/loadedFontStyle';
import { scale, verticalScale } from '@/utils/responsive';

const SH = MOTION_CAPTURE_PRESS_SHADOW;

type Props = {
  label: string;
  icon: React.ReactNode;
  discColor?: string;
  /** Dégradé TL → BR (prioritaire sur `discColor`) — 2 ou 3 stops charte. */
  discGradient?: readonly [string, string] | readonly [string, string, string];
  discBorderColor?: string;
  discBorderWidth?: number;
  /** `square` = coins continuous (essai S6) ; défaut disque. */
  shape?: 'disc' | 'square';
  onPress: () => void;
  labelFontFamily?: string;
  compact?: boolean;
  accessibilityLabel?: string;
};

export default function CaptureDiscCtaGradient({
  label,
  icon,
  discColor,
  discGradient,
  discBorderColor,
  discBorderWidth = 0,
  shape = 'disc',
  onPress,
  labelFontFamily,
  compact = false,
  accessibilityLabel,
}: Props) {
  const ctaSize = compact ? CAPTURE_CTA_SIZE_COMPACT : CAPTURE_CTA_SIZE;
  const radius =
    shape === 'square'
      ? compact
        ? scale(17)
        : PETITMO_CTA_BORDER_RADIUS
      : ctaSize / 2;
  const continuous = shape === 'square' ? ('continuous' as const) : undefined;
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
                backgroundColor: discGradient ? 'transparent' : discColor,
                borderWidth: discBorderWidth,
                borderColor: discBorderColor ?? 'transparent',
                overflow: 'hidden',
                ...(continuous ? { borderCurve: continuous } : null),
              },
            ]}
          >
            {discGradient ? (
              <LinearGradient
                colors={[
                  discGradient[0],
                  discGradient[0],
                  discGradient[discGradient.length - 1],
                  discGradient[discGradient.length - 1],
                ]}
                locations={[...CAPTURE_CTA_GRADIENT_LOCATIONS]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
            ) : null}
            <View pointerEvents="none" style={styles.sheen} />
            <View style={styles.discIcon}>{icon}</View>
          </View>
        </Reanimated.View>
      </Reanimated.View>
      <Text
        style={[
          styles.label,
          compact && styles.labelCompact,
          loadedFontStyle(labelFontFamily) ?? { fontWeight: '500' },
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
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: MOTION_CTA_MORPH_SHEEN,
    zIndex: 2,
  },
  discIcon: {
    zIndex: 1,
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
