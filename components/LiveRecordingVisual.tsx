import React, { useEffect, type ReactNode } from 'react';
import { View, StyleSheet, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { scale } from '@/utils/responsive';
/** Needles live — enveloppe qui pousse (metering réel). */
export const LIVE_RECORD_BAR_COUNT = 48;

const WAVE_H = scale(112);
const NEEDLE_ACTIVE = '#1C1C1E';
const NEEDLE_SOFT = '#AEAEB2';
const RING = 'rgba(28, 28, 30, 0.28)';

export function emptyLiveMeterBars(): number[] {
  return Array.from({ length: LIVE_RECORD_BAR_COUNT }, () => 0.06);
}

/** dBFS expo-av (~−160…0) → 0…1 pour l’UI. */
export function normalizeRecordingMeterDb(db: number): number {
  return Math.min(1, Math.max(0, (db + 55) / 55));
}

type EnvelopeProps = {
  bars: number[];
};

/** Enveloppe needles centrée — historique metering de gauche à droite. */
export function LiveRecordingEnvelope({ bars }: EnvelopeProps) {
  return (
    <View style={styles.envelope} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {bars.map((amp, i) => {
        const h = Math.max(scale(2.5), amp * (WAVE_H - scale(10)));
        const hot = amp > 0.14;
        return (
          <View
            key={i}
            style={[
              styles.needle,
              {
                height: h,
                backgroundColor: hot ? NEEDLE_ACTIVE : NEEDLE_SOFT,
                opacity: 0.4 + amp * 0.6,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

type PulseProps = {
  level: number;
  onPress: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/** Anneaux pulse autour du bouton stop — rythme + niveau micro. */
export function RecordingPulseControl({
  level,
  onPress,
  children,
  style,
  accessibilityLabel,
}: PulseProps) {
  const pulse = useSharedValue(0);
  const levelSv = useSharedValue(0);

  useEffect(() => {
    levelSv.value = withTiming(Math.min(1, Math.max(0, level)), { duration: 90 });
  }, [level, levelSv]);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 850, easing: Easing.out(Easing.quad) }),
        withTiming(0, { duration: 850, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [pulse]);

  const ringOuter = useAnimatedStyle(() => {
    const boost = levelSv.value * 0.28;
    return {
      transform: [{ scale: 1 + pulse.value * 0.42 + boost }],
      opacity: (1 - pulse.value) * (0.22 + levelSv.value * 0.28),
    };
  });

  const ringInner = useAnimatedStyle(() => {
    const boost = levelSv.value * 0.18;
    return {
      transform: [{ scale: 1 + pulse.value * 0.24 + boost }],
      opacity: (1 - pulse.value) * (0.32 + levelSv.value * 0.3),
    };
  });

  return (
    <View style={styles.pulseWrap}>
      <Animated.View pointerEvents="none" style={[styles.ring, ringOuter]} />
      <Animated.View pointerEvents="none" style={[styles.ring, ringInner]} />
      <TouchableOpacity
        style={style}
        onPress={onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        {children}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  envelope: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: WAVE_H,
    width: '100%',
    maxWidth: scale(320),
    gap: scale(0.5),
    paddingHorizontal: scale(4),
  },
  needle: {
    flex: 1,
    minWidth: 1,
    borderRadius: 999,
    alignSelf: 'center',
  },
  pulseWrap: {
    width: scale(132),
    height: scale(132),
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: scale(100),
    height: scale(100),
    borderRadius: scale(50),
    borderWidth: scale(2),
    borderColor: RING,
    backgroundColor: 'rgba(28, 28, 30, 0.05)',
  },
});
