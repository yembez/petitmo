import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { THEME } from '@/constants/theme';
import { scale, verticalScale } from '@/utils/responsive';

/**
 * Voyant d’attente pour une opération **média utilisateur** (trim, copie, poster, placement fil).
 * Pas pour la sync cloud (local-first UX).
 */
export function FeedMediaPrepOverlay({
  label,
  compact = false,
  /** Roue plus visible (ex. attente play vidéo sur poster). */
  prominent = false,
  /** Bloque les taps sous l’overlay (carte pending non cliquable). */
  blockTouches = false,
}: {
  label: string;
  /** Overlay sur une carte média (pas plein écran). */
  compact?: boolean;
  prominent?: boolean;
  blockTouches?: boolean;
}) {
  const spinnerColor = compact ? '#FFFFFF' : THEME.accent;
  const labelColor = compact ? '#FFFFFF' : THEME.textPrimary;
  return (
    <View
      style={[
        styles.base,
        compact ? styles.compact : styles.full,
        prominent && styles.prominent,
      ]}
      pointerEvents={blockTouches ? 'auto' : 'none'}
      accessibilityRole="progressbar"
      accessibilityLabel={label.trim() || 'Chargement'}
    >
      <ActivityIndicator size={prominent || !compact ? 'large' : 'small'} color={spinnerColor} />
      {label.trim() ? (
        <Text style={[styles.label, compact && styles.labelCompact, { color: labelColor }]}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
    elevation: 40,
  },
  full: {
    backgroundColor: THEME.bgScreen,
  },
  compact: {
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  prominent: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  label: {
    marginTop: verticalScale(12),
    fontSize: scale(15),
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: scale(24),
  },
  labelCompact: {
    marginTop: verticalScale(8),
    fontSize: scale(13),
    fontWeight: '500',
  },
});
