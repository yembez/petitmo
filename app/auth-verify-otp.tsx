/**
 * Confirmation e-mail in-app après signup (code OTP 6 chiffres).
 * Règle d’or V2 : compte obligatoire ; local-first après session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { FONT_SIZES, ICON_SIZES, SPACING } from '@/constants/sizes';
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import { scale, verticalScale } from '@/utils/responsive';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import {
  resendSignupEmailOtp,
  verifySignupEmailOtp,
} from '@/lib/authAccount';
import { listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';

const OTP_LENGTH = 6;

function parseIntent(raw: string | string[] | undefined): 'free' | 'subscribe' {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'subscribe' ? 'subscribe' : 'free';
}

export default function AuthVerifyOtpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string; intent?: string }>();
  const { t } = useAppTranslation('common');
  const { loaded: fontsLoaded, dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();

  const email = useMemo(() => {
    const raw = Array.isArray(params.email) ? params.email[0] : params.email;
    return (raw ?? '').trim().toLowerCase();
  }, [params.email]);
  const intent = parseIntent(params.intent);
  const isSubscribe = intent === 'subscribe';

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const verifyingRef = useRef(false);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!email) {
      router.replace({ pathname: '/auth', params: { mode: 'signup', intent } });
    }
  }, [email, intent, router]);

  useEffect(() => {
    const tmr = setTimeout(() => inputRef.current?.focus(), 400);
    return () => clearTimeout(tmr);
  }, []);

  const finishAfterAuth = useCallback(async () => {
    const uid = peekLastRealAuthUserId();
    const localCount = uid ? listLocalChildrenForUser(uid).length : 0;

    if (isSubscribe) {
      hydrateTabScreensFromSqliteSync();
      router.replace({
        pathname: '/paywall',
        params: { context: 'GENERAL', returnTo: 'fil', from: 'subscribe' },
      });
      return;
    }

    if (localCount === 0) {
      const { replaceToOnboardingPermissionsOrCreateChild } = await import(
        '@/utils/onboardingPermissionsRoute'
      );
      await replaceToOnboardingPermissionsOrCreateChild(router);
      return;
    }
    hydrateTabScreensFromSqliteSync();
    router.replace('/(tabs)');
  }, [isSubscribe, router]);

  const onVerify = useCallback(
    async (rawCode: string) => {
      const digits = rawCode.replace(/\D/g, '').slice(0, OTP_LENGTH);
      if (digits.length !== OTP_LENGTH) {
        Alert.alert(t('error'), t('auth.otpInvalid'));
        return;
      }
      if (verifyingRef.current || busy) return;
      verifyingRef.current = true;
      setBusy(true);
      try {
        const result = await verifySignupEmailOtp(email, digits);
        if (!result.ok) {
          Alert.alert(t('error'), result.error);
          setBusy(false);
          verifyingRef.current = false;
          return;
        }
        await finishAfterAuth();
      } catch (e) {
        console.warn('[auth-otp] verify', e);
        Alert.alert(t('error'), t('error'));
        setBusy(false);
        verifyingRef.current = false;
      }
    },
    [busy, email, finishAfterAuth, t],
  );

  const onChangeCode = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(digits);
    if (digits.length === OTP_LENGTH) {
      void onVerify(digits);
    }
  };

  const onResend = () => {
    if (busy) return;
    void (async () => {
      setBusy(true);
      try {
        const result = await resendSignupEmailOtp(email);
        if (!result.ok) {
          Alert.alert(t('error'), result.error);
          return;
        }
        setCode('');
        Alert.alert(t('ok'), t('auth.otpResent'));
      } finally {
        setBusy(false);
      }
    })();
  };

  const onChangeEmail = () => {
    router.replace({
      pathname: '/auth',
      params: { mode: 'signup', intent },
    });
  };

  if (!fontsLoaded || !email) {
    return (
      <View style={[styles.shell, styles.center]}>
        <ActivityIndicator color={THEME.brandCtaOrange} size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.shell, { paddingTop: insets.top + verticalScale(8) }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity
          onPress={() =>
            router.replace({ pathname: '/auth', params: { mode: 'signup', intent } })
          }
          style={styles.backBtn}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={t('back')}
        >
          <ChevronLeft size={ICON_SIZES.lg} color={THEME.textPrimary} strokeWidth={2} />
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={[styles.title, dm700 && { fontFamily: dm700 }]}>{t('auth.otpTitle')}</Text>
          <Text style={[styles.subtitle, dm500 && { fontFamily: dm500 }]}>
            {t('auth.otpSubtitle', { email })}
          </Text>

          <TextInput
            ref={inputRef}
            style={[styles.codeInput, dm600 && { fontFamily: dm600 }]}
            value={code}
            onChangeText={onChangeCode}
            placeholder={t('auth.otpPlaceholder')}
            placeholderTextColor="rgba(0,0,0,0.28)"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            importantForAutofill="yes"
            maxLength={OTP_LENGTH}
            editable={!busy}
            accessibilityLabel={t('auth.otpTitle')}
          />

          <TouchableOpacity
            style={[
              petitmoCtaStyles.primary,
              petitmoCtaStyles.primaryFullWidth,
              styles.cta,
              (busy || code.length !== OTP_LENGTH) && petitmoCtaStyles.primaryDisabled,
            ]}
            disabled={busy || code.length !== OTP_LENGTH}
            onPress={() => void onVerify(code)}
            activeOpacity={0.9}
          >
            {busy ? (
              <ActivityIndicator color={PETITMO_CTA_SPINNER_COLOR} />
            ) : (
              <Text style={[petitmoCtaStyles.primaryText, dm600 && { fontFamily: dm600 }]}>
                {t('auth.otpVerifyCta')}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onResend}
            disabled={busy}
            style={styles.linkBtn}
            hitSlop={8}
          >
            <Text
              style={[
                styles.link,
                busy && styles.linkDisabled,
                dm500 && { fontFamily: dm500 },
              ]}
            >
              {t('auth.otpResend')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity onPress={onChangeEmail} disabled={busy} style={styles.linkBtn} hitSlop={8}>
            <Text style={[styles.link, dm500 && { fontFamily: dm500 }]}>
              {t('auth.otpChangeEmail')}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: THEME.bgScreen,
  },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  backBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  content: {
    flex: 1,
    paddingHorizontal: scale(24),
    paddingTop: verticalScale(24),
  },
  title: {
    fontSize: FONT_SIZES['2xl'],
    fontWeight: '700',
    color: THEME.textPrimary,
    marginBottom: verticalScale(8),
  },
  subtitle: {
    fontSize: FONT_SIZES.base,
    color: THEME.textMuted,
    lineHeight: scale(22),
    marginBottom: verticalScale(28),
  },
  codeInput: {
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
    borderRadius: scale(12),
    backgroundColor: '#FFFFFF',
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(16),
    fontSize: scale(28),
    // Pas de letterSpacing : sur iOS ça fuit vers les TextInput des écrans suivants.
    letterSpacing: 0,
    textAlign: 'center',
    color: THEME.textPrimary,
    marginBottom: verticalScale(20),
  },
  cta: {
    marginBottom: verticalScale(16),
  },
  linkBtn: {
    alignSelf: 'center',
    paddingVertical: verticalScale(10),
  },
  link: {
    fontSize: FONT_SIZES.base,
    color: THEME.brandPrimary,
    fontWeight: '600',
    textAlign: 'center',
  },
  linkDisabled: {
    color: THEME.textMuted,
    fontWeight: '500',
  },
});
