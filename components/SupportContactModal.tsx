import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname } from 'expo-router';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import { THEME } from '@/constants/theme';
import { FONT_SIZES } from '@/constants/sizes';
import { petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { scale, verticalScale } from '@/utils/responsive';
import {
  collectBugReportContext,
  formatBugReportTechBlock,
} from '@/lib/bugReportContext';
import { isSentryEnabled } from '@/lib/sentry';
import { sendSupportMessage, type SupportMessageKind } from '@/services/supportContact';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_MESSAGE = 8;

type Props = {
  visible: boolean;
  kind: SupportMessageKind;
  defaultEmail: string;
  onClose: () => void;
};

function sanitizeDefaultEmail(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—') return '';
  return trimmed;
}

export default function SupportContactModal({ visible, kind, defaultEmail, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { t } = useAppTranslation('common');
  const [email, setEmail] = useState(sanitizeDefaultEmail(defaultEmail));
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setEmail(sanitizeDefaultEmail(defaultEmail));
    setMessage('');
    setSending(false);
  }, [visible, defaultEmail]);

  const handleSend = async () => {
    if (sending) return;
    const nextEmail = email.trim().toLowerCase();
    const nextMessage = message.trim();
    if (!EMAIL_RE.test(nextEmail)) {
      Alert.alert(t('error'), t('parent.support.errorEmail'));
      return;
    }
    if (nextMessage.length < MIN_MESSAGE) {
      Alert.alert(t('error'), t('parent.support.errorMessage'));
      return;
    }

    setSending(true);
    try {
      const ctx = await collectBugReportContext({
        pathname,
        sentryEnabled: isSentryEnabled(),
      });
      await sendSupportMessage({
        email: nextEmail,
        message: nextMessage,
        kind,
        techContext: formatBugReportTechBlock(ctx),
      });
      onClose();
      Alert.alert(t('parent.support.successTitle'), t('parent.support.successBody', { email: nextEmail }));
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      if (code === 'rate_limited') {
        Alert.alert(t('error'), t('parent.support.errorRateLimit'));
      } else {
        Alert.alert(t('error'), t('parent.support.errorSend'));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={[styles.backdrop, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}
      >
        <Pressable style={{ flex: 1 }} onPress={sending ? undefined : onClose}>
          <Pressable style={styles.card} onPress={e => e.stopPropagation()}>
            <Text style={styles.title}>
              {kind === 'report' ? t('parent.support.reportTitle') : t('parent.support.contactTitle')}
            </Text>
            <Text style={styles.sub}>{t('parent.support.subtitle')}</Text>

            <Text style={styles.label}>{t('parent.support.emailLabel')}</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              placeholder={t('parent.support.emailPlaceholder')}
              placeholderTextColor={THEME.textMuted}
              editable={!sending}
              style={styles.input}
            />

            <Text style={styles.label}>{t('parent.support.messageLabel')}</Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              multiline
              textAlignVertical="top"
              placeholder={
                kind === 'report'
                  ? t('parent.support.reportPlaceholder')
                  : t('parent.support.messagePlaceholder')
              }
              placeholderTextColor={THEME.textMuted}
              editable={!sending}
              style={[styles.input, styles.messageInput]}
            />
            <Text style={styles.techNote}>{t('parent.support.techNote')}</Text>

            <View style={styles.btns}>
              <TouchableOpacity
                style={styles.btnGhost}
                onPress={onClose}
                disabled={sending}
                activeOpacity={0.9}
              >
                <Text style={styles.btnGhostText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <PetitmoPrimaryPressable
                style={styles.btnCta}
                onPress={() => void handleSend()}
                disabled={sending}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel={t('parent.support.send')}
              >
                {sending ? (
                  <ActivityIndicator color={THEME.captureScreenCtaForeground} />
                ) : (
                  <Text style={petitmoCtaStyles.primaryText}>{t('parent.support.send')}</Text>
                )}
              </PetitmoPrimaryPressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    paddingHorizontal: scale(16),
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: THEME.bg,
    borderRadius: scale(16),
    padding: scale(16),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: THEME.familyFlowLine,
  },
  title: {
    color: THEME.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  sub: {
    color: THEME.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: verticalScale(12),
  },
  label: {
    color: THEME.textPrimary,
    fontSize: FONT_SIZES.sm,
    fontWeight: '600',
    marginBottom: verticalScale(6),
  },
  input: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: THEME.bg,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.10)',
    color: THEME.textPrimary,
    marginBottom: verticalScale(12),
  },
  messageInput: {
    minHeight: verticalScale(120),
    paddingTop: 12,
    paddingBottom: 12,
  },
  techNote: {
    color: THEME.textMuted,
    fontSize: FONT_SIZES.sm,
    lineHeight: 18,
    marginBottom: verticalScale(14),
  },
  btns: {
    flexDirection: 'row',
    gap: 10,
  },
  btnGhost: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: THEME.bg,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  btnGhostText: {
    color: THEME.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  btnCta: {
    flex: 1,
    height: 44,
    paddingVertical: 0,
  },
});
