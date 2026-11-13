/**
 * Modal centrée — rappel du soir après le 1er import (1 ou N souvenirs).
 * Low Friction : pas d’Alert native ; notifs seulement si « Activer » ; Pas maintenant = dismiss.
 */
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Modal,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { THEME } from '@/constants/theme';
import { FONT_SIZES, SPACING } from '@/constants/sizes';
import { scale, verticalScale } from '@/utils/responsive';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';

type Props = {
  visible: boolean;
  timeLabel: string;
  onActivate: () => void;
  onDismiss: () => void;
  /** Ouvre le sheet d’heure (créneaux existants). */
  onPressTime: () => void;
};

export default function EveningReminderCard({
  visible,
  timeLabel,
  onActivate,
  onDismiss,
  onPressTime,
}: Props) {
  const { t } = useAppTranslation('common');
  const { width } = useWindowDimensions();
  const { dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  const cardWidth = Math.min(width - scale(48), scale(360));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.root} accessibilityViewIsModal>
        <BlurView intensity={48} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View style={[styles.scrim, StyleSheet.absoluteFillObject]} />
        <View style={[styles.card, { width: cardWidth }]} accessibilityRole="summary">
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(24),
  },
  scrim: {
    backgroundColor: 'rgba(20, 22, 28, 0.45)',
  },
  card: {
    padding: SPACING.lg,
    borderRadius: scale(20),
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(81,84,94,0.12)',
  },
  title: {
    fontSize: FONT_SIZES.lg,
    color: THEME.textPrimary,
    marginBottom: verticalScale(8),
    textAlign: 'center',
  },
  body: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    lineHeight: scale(21),
    marginBottom: SPACING.md,
    textAlign: 'center',
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
