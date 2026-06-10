import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getLastGuestExportEmail } from '@/lib/guestExportPrefs';
import { getPrivacyPolicyUrl } from '@/lib/privacyPolicyUrl';
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import { THEME } from '@/constants/theme';

export type GuestPdfExportSubmit = {
  email: string;
  marketingOptIn: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: GuestPdfExportSubmit) => void | Promise<void>;
  loading?: boolean;
};

export function GuestPdfExportModal({ visible, onClose, onSubmit, loading }: Props) {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [gdprChecked, setGdprChecked] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const privacyUrl = getPrivacyPolicyUrl();

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void (async () => {
      const last = await getLastGuestExportEmail();
      if (!cancelled && last) setEmail(last);
    })();
    return () => {
      cancelled = true;
    };
  }, [visible]);

  const reset = useCallback(() => {
    setEmail('');
    setGdprChecked(false);
    setMarketing(false);
  }, []);

  const handleClose = useCallback(() => {
    if (loading) return;
    reset();
    onClose();
  }, [loading, onClose, reset]);

  const handleConfirm = useCallback(async () => {
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return;
    }
    if (!gdprChecked) return;
    await onSubmit({ email: trimmed, marketingOptIn: marketing });
  }, [email, gdprChecked, marketing, onSubmit]);

  const openPrivacy = useCallback(() => {
    if (privacyUrl) void Linking.openURL(privacyUrl);
  }, [privacyUrl]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={handleClose} />
        <View style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]}>
          <Text style={styles.title}>Exporter sans compte</Text>
          <Text style={styles.sub}>
            Ton e-mail sert au suivi de l’export et à te recontacter si besoin. Tu peux retirer ton
            consentement en nous écrivant (voir politique de confidentialité).
          </Text>
          {privacyUrl ? (
            <Pressable onPress={openPrivacy} style={styles.privacyLinkWrap} disabled={loading}>
              <Text style={styles.privacyLink}>Politique de confidentialité</Text>
            </Pressable>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={styles.label}>E-mail</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="toi@exemple.com"
              editable={!loading}
            />
            <Pressable
              style={styles.row}
              onPress={() => !loading && setGdprChecked(v => !v)}
              disabled={loading}
            >
              <View style={[styles.checkbox, gdprChecked && styles.checkboxOn]} />
              <Text style={styles.rowText}>
                Je confirme avoir au moins 16 ans (ou l’autorisation d’un titulaire de l’autorité
                parentale) et j’accepte le traitement de mes données pour cet export conformément à
                la politique de confidentialité{privacyUrl ? '' : ' applicable'}.
              </Text>
            </Pressable>
            <View style={styles.rowBetween}>
              <Text style={styles.rowText}>Recevoir des nouvelles Petitmo (optionnel)</Text>
              <Switch value={marketing} onValueChange={setMarketing} disabled={loading} />
            </View>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable style={styles.btnGhost} onPress={handleClose} disabled={loading}>
              <Text style={styles.btnGhostText}>Annuler</Text>
            </Pressable>
            <Pressable
              style={[
                petitmoCtaStyles.primary,
                styles.btnPrimary,
                (!gdprChecked || loading || !email.trim()) && petitmoCtaStyles.primaryDisabled,
              ]}
              onPress={() => void handleConfirm()}
              disabled={!gdprChecked || loading || !email.trim()}
            >
              {loading ? (
                <ActivityIndicator color={PETITMO_CTA_SPINNER_COLOR} />
              ) : (
                <Text style={[petitmoCtaStyles.primaryText, styles.btnPrimaryText]}>Continuer</Text>
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: THEME.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 20,
    maxHeight: '88%',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1C1C1E',
    marginBottom: 8,
  },
  sub: {
    fontSize: 14,
    color: '#636366',
    lineHeight: 20,
    marginBottom: 8,
  },
  privacyLinkWrap: {
    marginBottom: 14,
  },
  privacyLink: {
    fontSize: 14,
    color: '#2D6A4F',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3A3A3C',
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: '#C7C7CC',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 16,
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 8,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#8E8E93',
    marginTop: 2,
  },
  checkboxOn: {
    backgroundColor: '#2D6A4F',
    borderColor: '#2D6A4F',
  },
  rowText: {
    flex: 1,
    fontSize: 14,
    color: '#3A3A3C',
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  btnGhost: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  btnGhostText: {
    fontSize: 16,
    color: '#636366',
  },
  btnPrimary: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    minWidth: 120,
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontSize: 16,
  },
});
