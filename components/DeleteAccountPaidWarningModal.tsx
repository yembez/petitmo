/**
 * Carte avertissement suppression compte (abonné) — Design A.
 * Rappel : résilier via Espace parent → Mon abonnement avant de supprimer.
 */
import {
  Modal,
  StyleSheet,
  Text,
  View,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import {
  useFonts,
  DMSans_500Medium,
  DMSans_600SemiBold,
  DMSans_700Bold,
} from '@expo-google-fonts/dm-sans';
import { THEME } from '@/constants/theme';
import { scale } from '@/utils/responsive';
import { useAppTranslation } from '@/hooks/useAppTranslation';

type Props = {
  visible: boolean;
  onManageSubscription: () => void;
  onDeleteAccount: () => void;
  onCancel: () => void;
};

export default function DeleteAccountPaidWarningModal({
  visible,
  onManageSubscription,
  onDeleteAccount,
  onCancel,
}: Props) {
  const { t } = useAppTranslation('common');
  const { width } = useWindowDimensions();
  const [fontsLoaded] = useFonts({
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
  });

  const dm500 = fontsLoaded ? 'DMSans_500Medium' : undefined;
  const dm600 = fontsLoaded ? 'DMSans_600SemiBold' : undefined;
  const dm700 = fontsLoaded ? 'DMSans_700Bold' : undefined;

  const cardWidth = Math.min(width - scale(48), scale(360));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.root}>
        <BlurView intensity={48} tint="dark" style={StyleSheet.absoluteFillObject} />
        <View style={[styles.scrim, StyleSheet.absoluteFillObject]} />
        <View style={[styles.card, { width: cardWidth }]}>
          <Text style={[styles.eyebrow, dm700 ? { fontFamily: dm700 } : null]}>
            {t('parent.account.deletePaidEyebrow')}
          </Text>
          <Text style={[styles.title, dm700 ? { fontFamily: dm700 } : null]}>
            {t('parent.account.deletePaidTitle')}
          </Text>
          <Text style={[styles.path, dm500 ? { fontFamily: dm500 } : null]}>
            {t('parent.account.deletePaidPath')}
          </Text>

          <View style={styles.divider} />

          <View style={styles.pointRow}>
            <View style={styles.dot} />
            <Text style={[styles.pointText, dm500 ? { fontFamily: dm500 } : null]}>
              {t('parent.account.deletePaidPointMemories')}
            </Text>
          </View>
          <View style={styles.pointRow}>
            <View style={styles.dot} />
            <Text style={[styles.pointText, dm500 ? { fontFamily: dm500 } : null]}>
              {t('parent.account.deletePaidPointRestore')}
            </Text>
          </View>
          <View style={[styles.pointRow, styles.pointRowLast]}>
            <View style={styles.dot} />
            <Text style={[styles.pointText, dm500 ? { fontFamily: dm500 } : null]}>
              {t('parent.account.deletePaidPointOrder')}
            </Text>
          </View>

          <Pressable
            onPress={onManageSubscription}
            style={({ pressed }) => [styles.ctaPrimary, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('parent.subscription.manage')}
          >
            <Text style={[styles.ctaPrimaryText, dm600 ? { fontFamily: dm600 } : null]}>
              {t('parent.subscription.manage')}
            </Text>
          </Pressable>

          <Pressable
            onPress={onDeleteAccount}
            style={({ pressed }) => [styles.ctaDanger, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('parent.account.deletePaidDeleteCta')}
          >
            <Text style={[styles.ctaDangerText, dm600 ? { fontFamily: dm600 } : null]}>
              {t('parent.account.deletePaidDeleteCta')}
            </Text>
          </Pressable>

          <Pressable
            onPress={onCancel}
            style={({ pressed }) => [styles.ctaGhost, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t('cancel')}
          >
            <Text style={[styles.ctaGhostText, dm500 ? { fontFamily: dm500 } : null]}>
              {t('cancel')}
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
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: scale(28),
    paddingHorizontal: scale(22),
    paddingTop: scale(24),
    paddingBottom: scale(14),
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  eyebrow: {
    color: THEME.brandPrimary,
    fontSize: scale(15),
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: scale(8),
  },
  title: {
    color: THEME.textPrimary,
    fontSize: scale(20),
    fontWeight: '700',
    lineHeight: scale(26),
    letterSpacing: -0.3,
    marginBottom: scale(12),
  },
  path: {
    color: THEME.textSecondary,
    fontSize: scale(14),
    fontWeight: '500',
    lineHeight: scale(20),
    marginBottom: scale(14),
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(0,0,0,0.10)',
    marginBottom: scale(14),
  },
  pointRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: scale(10),
    marginBottom: scale(10),
  },
  pointRowLast: {
    marginBottom: scale(18),
  },
  dot: {
    width: scale(6),
    height: scale(6),
    borderRadius: scale(3),
    backgroundColor: THEME.brandPrimary,
    marginTop: scale(7),
  },
  pointText: {
    flex: 1,
    color: THEME.textPrimary,
    fontSize: scale(14),
    fontWeight: '500',
    lineHeight: scale(20),
  },
  ctaPrimary: {
    backgroundColor: THEME.brandPrimary,
    borderRadius: scale(14),
    paddingVertical: scale(14),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: scale(8),
  },
  ctaPrimaryText: {
    color: '#FFFFFF',
    fontSize: scale(16),
    fontWeight: '600',
  },
  ctaDanger: {
    borderRadius: scale(14),
    paddingVertical: scale(13),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(252,87,87,0.35)',
    marginBottom: scale(4),
  },
  ctaDangerText: {
    color: THEME.brandPrimary,
    fontSize: scale(16),
    fontWeight: '600',
  },
  ctaGhost: {
    paddingVertical: scale(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaGhostText: {
    color: THEME.textSecondary,
    fontSize: scale(15),
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.88,
  },
});
