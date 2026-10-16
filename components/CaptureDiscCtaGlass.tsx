/**
 * Essai Capturer V9 — disques verre dépoli neutre (pas de corail).
 * Repli Android : fond semi-transparent sans BlurView si besoin.
 */
import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Pressable } from 'react-native-gesture-handler';
import { BlurView } from 'expo-blur';
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
  MOTION_CAPTURE_PRESS_SHADOW,
  MOTION_CTA_MORPH_HIT_SLOP,
  MOTION_SPRING,
  MOTION_SPRING_PHYS,
} from '@/constants/motion';
import {
  CAPTURE_CTA_SIZE,
  CAPTURE_CTA_SIZE_COMPACT,
} from '@/constants/captureCtaVariant';
import { loadedFontStyle } from '@/utils/loadedFontStyle';
import { scale, verticalScale } from '@/utils/responsive';

const SH = MOTION_CAPTURE_PRESS_SHADOW;

type Props = {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  labelFontFamily?: string;
  compact?: boolean;
  accessibilityLabel?: string;
};

export default function CaptureDiscCtaGlass({
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

  /** Même stack d’ombres au press que `CaptureDiscCtaGradient` (sensations tap). */
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
              styles.discShell,
              {
                width: ctaSize,
                height: ctaSize,
                borderRadius: radius,
              },
            ]}
          >
            {isIOS ? (
              <BlurView
                intensity={48}
                tint="light"
                style={[StyleSheet.absoluteFillObject, { borderRadius: radius }]}
              />
            ) : (
              <View style={[StyleSheet.absoluteFillObject, styles.androidGlass]} />
            )}
            <View pointerEvents="none" style={styles.discBorder} />
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
  discShell: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  androidGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.38)',
  },
  discBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.55)',
  },
  discIcon: {
    zIndex: 1,
  },
  label: {
    fontSize: scale(12),
    lineHeight: scale(14),
    color: '#FFFFFF',
    letterSpacing: 0.15,
    textAlign: 'center',
    maxWidth: '100%',
    paddingHorizontal: scale(2),
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  labelCompact: {
    fontSize: scale(12),
    lineHeight: scale(15),
  },
});
