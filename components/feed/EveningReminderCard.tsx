/**
 * Carte soft sous le 1er souvenir — rappel du soir (non bloquante).
 * Blanc + CTA corail charte ; heure 21:00 par défaut, tappable → sheet.
 */
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { THEME } from '@/constants/theme';
import { FONT_SIZES, SPACING } from '@/constants/sizes';
import { scale, verticalScale } from '@/utils/responsive';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';

type Props = {
  timeLabel: string;
  onActivate: () => void;
  onDismiss: () => void;
  /** Ouvre le sheet d’heure (créneaux existants). */
  onPressTime: () => void;
};

export default function EveningReminderCard({
  timeLabel,
  onActivate,
  onDismiss,
  onPressTime,
}: Props) {
  const { t } = useAppTranslation('common');
  const { dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();

  return (
    <View style={styles.card} accessibilityRole="summary">
      <Text style={[styles.title, { fontFamily: dm700 }]}>
        {t('fil.eveningReminder.title')}
      </Text>
      <Text style={[styles.body, { fontFamily: dm500 }]}>
        {t('fil.eveningReminder.bodyBefore')}
        <Text
          onPress={onPressTime}
          style={[styles.timeInline, { fontFamily: dm700 }]}
          accessibilityRole="button"
          accessibilityLabel={t('fil.eveningReminder.timeA11y', { time: timeLabel })}
        >
          {timeLabel}
        </Text>
        {t('fil.eveningReminder.bodyAfter')}
      </Text>
      <PetitmoPrimaryPressable onPress={onActivate} style={styles.cta}>
        <Text style={petitmoCtaStyles.primaryText}>{t('fil.eveningReminder.activate')}</Text>
      </PetitmoPrimaryPressable>
      <Pressable
        onPress={onDismiss}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('fil.eveningReminder.notNow')}
        style={styles.secondary}
      >
        <Text style={[styles.secondaryText, { fontFamily: dm600 }]}>
          {t('fil.eveningReminder.notNow')}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: SPACING.lg,
    marginTop: verticalScale(8),
    marginBottom: verticalScale(4),
    padding: SPACING.md,
    borderRadius: scale(16),
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(81,84,94,0.12)',
  },
  title: {
    fontSize: FONT_SIZES.md,
    color: THEME.textPrimary,
    marginBottom: verticalScale(6),
  },
  body: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    lineHeight: scale(20),
    marginBottom: SPACING.md,
  },
  timeInline: {
    color: THEME.captureScreenCtaBackground,
    textDecorationLine: 'underline',
  },
  cta: {
    alignSelf: 'stretch',
  },
  secondary: {
    alignSelf: 'center',
    marginTop: SPACING.sm,
    paddingVertical: verticalScale(6),
  },
  secondaryText: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
  },
});
