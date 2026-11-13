/**
 * Modal centrée — rappel du soir après le 1er import (1 ou N souvenirs).
 * Low Friction : pas d’Alert native ; notifs seulement si « Activer » ; Pas maintenant = dismiss.
 */
import { useState } from 'react';
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
import { SPACING } from '@/constants/sizes';
import { scale, verticalScale } from '@/utils/responsive';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import CaptureReminderTimeSheet from '@/components/parentSpace/CaptureReminderTimeSheet';
import { snapCaptureReminderTimeToSlot } from '@/lib/notificationPrefs';

type Props = {
  visible: boolean;
  timeLabel: string;
  onActivate: () => void;
  onDismiss: () => void;
  /** Persiste l’heure choisie (sheet ouvert depuis ce modal). */
  onTimeChange: (time: string) => void;
};

export default function EveningReminderCard({
  visible,
  timeLabel,
  onActivate,
  onDismiss,
  onTimeChange,
}: Props) {
  const { t } = useAppTranslation('common');
  const { width } = useWindowDimensions();
  const { dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();
  const [timeSheetOpen, setTimeSheetOpen] = useState(false);
  const cardWidth = Math.min(width - scale(40), scale(380));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        if (timeSheetOpen) {
          setTimeSheetOpen(false);
          return;
        }
        onDismiss();
      }}
    >
      <View style={styles.root} accessibilityViewIsModal>
        <BlurView
          intensity={48}
          tint="dark"
          style={StyleSheet.absoluteFillObject}
          pointerEvents="none"
        />
        <View
          style={[styles.scrim, StyleSheet.absoluteFillObject]}
          pointerEvents="none"
        />
        <View style={[styles.card, { width: cardWidth }]} accessibilityRole="summary">
          <Text style={[styles.title, dm700 ? { fontFamily: dm700 } : null]}>
            {t('fil.eveningReminder.title')}
          </Text>

          <View style={styles.bodyBlock}>
            <Text style={[styles.body, dm500 ? { fontFamily: dm500 } : null]}>
              {t('fil.eveningReminder.bodyBefore')}
            </Text>
            <Pressable
              onPress={() => setTimeSheetOpen(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t('fil.eveningReminder.timeA11y', { time: timeLabel })}
              style={({ pressed }) => [styles.timeChip, pressed && styles.timeChipPressed]}
            >
              <Text style={[styles.timeChipText, dm700 ? { fontFamily: dm700 } : null]}>
                {timeLabel}
              </Text>
            </Pressable>
            <Text style={[styles.body, dm500 ? { fontFamily: dm500 } : null]}>
              {t('fil.eveningReminder.bodyAfter')}
            </Text>
          </View>

          <PetitmoPrimaryPressable
            onPress={onActivate}
            style={styles.cta}
            accessibilityLabel={t('fil.eveningReminder.activate')}
          >
            <Text style={[petitmoCtaStyles.primaryText, styles.ctaText]}>
              {t('fil.eveningReminder.activate')}
            </Text>
          </PetitmoPrimaryPressable>
          <Pressable
            onPress={onDismiss}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('fil.eveningReminder.notNow')}
            style={styles.secondary}
          >
            <Text style={[styles.secondaryText, dm600 ? { fontFamily: dm600 } : null]}>
              {t('fil.eveningReminder.notNow')}
            </Text>
          </Pressable>
        </View>

        {/* Même Modal RN — pas de 2ᵉ Modal (sinon sheet invisible / tap mort sur iOS). */}
        <CaptureReminderTimeSheet
          presentation="overlay"
          visible={timeSheetOpen}
          selectedTime={timeLabel}
          onSelect={time => {
            onTimeChange(snapCaptureReminderTimeToSlot(time));
          }}
          onClose={() => setTimeSheetOpen(false)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: scale(20),
  },
  scrim: {
    backgroundColor: 'rgba(20, 22, 28, 0.45)',
  },
  card: {
    paddingHorizontal: SPACING.lg,
    paddingTop: verticalScale(28),
    paddingBottom: verticalScale(22),
    borderRadius: scale(22),
    backgroundColor: '#FFFFFF',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(81,84,94,0.12)',
    zIndex: 1,
  },
  title: {
    fontSize: scale(22),
    color: THEME.textPrimary,
    marginBottom: verticalScale(14),
    textAlign: 'center',
    lineHeight: scale(28),
  },
  bodyBlock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: verticalScale(22),
    columnGap: scale(4),
    rowGap: verticalScale(4),
  },
  body: {
    fontSize: scale(16),
    color: THEME.textMuted,
    lineHeight: scale(24),
    textAlign: 'center',
  },
  timeChip: {
    paddingHorizontal: scale(10),
    paddingVertical: verticalScale(4),
    borderRadius: scale(10),
    backgroundColor: 'rgba(252, 87, 87, 0.12)',
  },
  timeChipPressed: {
    opacity: 0.75,
  },
  timeChipText: {
    fontSize: scale(16),
    color: THEME.captureScreenCtaBackground,
    textDecorationLine: 'underline',
  },
  cta: {
    alignSelf: 'stretch',
    minHeight: verticalScale(56),
    paddingVertical: verticalScale(16),
    borderRadius: scale(28),
  },
  ctaText: {
    fontSize: scale(17),
  },
  secondary: {
    alignSelf: 'center',
    marginTop: verticalScale(14),
    paddingVertical: verticalScale(8),
  },
  secondaryText: {
    fontSize: scale(16),
    color: THEME.textMuted,
  },
});
