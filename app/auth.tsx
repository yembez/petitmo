/**
 * Règle d’or V2 : compte gratuit obligatoire (Google / Apple / email+mdp).
 * Modes : signup (Commencer) | login (« J’ai déjà un compte »).
 * Après auth réussie → profil enfant si besoin, sinon tabs.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
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
import { FONT_SIZES, SPACING } from '@/constants/sizes';
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import { scale, verticalScale } from '@/utils/responsive';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import {
  hasRealAuthAccount,
  isAppleSignInNativeAvailable,
  requestPasswordReset,
  signInWithAppleNative,
  signInWithEmailPassword,
  signInWithGoogleOAuth,
  signUpWithEmailPassword,
} from '@/lib/authAccount';
import { getChildren } from '@/services/children';

type AuthMode = 'signup' | 'login';

function parseMode(raw: string | string[] | undefined): AuthMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'login' ? 'login' : 'signup';
}

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string }>();
  const { t } = useAppTranslation('common');
  const { loaded: fontsLoaded, dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();

  const [mode, setMode] = useState<AuthMode>(() => parseMode(params.mode));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);
  const [gateChecking, setGateChecking] = useState(true);

  useEffect(() => {
    void isAppleSignInNativeAvailable().then(setAppleAvailable);
  }, []);

  const title = mode === 'signup' ? t('auth.signupTitle') : t('auth.loginTitle');
  const subtitle =
    mode === 'signup' ? t('auth.signupSubtitle') : t('auth.loginSubtitle');
  const primaryCta = mode === 'signup' ? t('auth.signupCta') : t('auth.loginCta');

  const finishAfterAuth = useCallback(async () => {
    const children = await getChildren();
    if (children.length > 0) {
      router.replace('/(tabs)');
    } else {
      router.replace('/create-child');
    }
  }, [router]);

  useEffect(() => {
    void (async () => {
      if (await hasRealAuthAccount()) {
        await finishAfterAuth();
        return;
      }
      setGateChecking(false);
    })();
  }, [finishAfterAuth]);

  const run = useCallback(
    async (fn: () => Promise<{ ok: true; needsEmailConfirmation?: boolean } | { ok: false; error: string }>) => {
      if (busy) return;
      setBusy(true);
      try {
        const result = await fn();
        if (!result.ok) {
          Alert.alert(t('error'), result.error);
          return;
        }
        if ('needsEmailConfirmation' in result && result.needsEmailConfirmation) {
          Alert.alert(t('auth.confirmEmailTitle'), t('auth.confirmEmailBody'), [
            { text: t('ok'), onPress: () => void finishAfterAuth() },
          ]);
          return;
        }
        await finishAfterAuth();
      } finally {
        setBusy(false);
      }
    },
    [busy, finishAfterAuth, t]
  );

  const onEmailSubmit = () =>
    void run(async () => {
      if (mode === 'signup') {
        return signUpWithEmailPassword(email, password);
      }
      return signInWithEmailPassword(email, password);
    });

  const onForgotPassword = () => {
    void (async () => {
      if (!email.trim()) {
        Alert.alert(t('error'), t('auth.forgotNeedEmail'));
        return;
      }
      setBusy(true);
      try {
        const result = await requestPasswordReset(email);
        if (!result.ok) {
          Alert.alert(t('error'), result.error);
          return;
        }
        Alert.alert(t('auth.forgotSentTitle'), t('auth.forgotSentBody'));
      } finally {
        setBusy(false);
      }
    })();
  };

  if (!fontsLoaded || gateChecking) {
    return <View style={styles.shell} />;
  }

  return (
    <View style={[styles.shell, { paddingTop: insets.top }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + verticalScale(28) },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={t('back')}
            hitSlop={12}
          >
            <ChevronLeft size={scale(28)} color={THEME.textPrimary} />
          </TouchableOpacity>

          <Text style={[styles.title, { fontFamily: dm700 }]}>{title}</Text>
          <Text style={[styles.subtitle, { fontFamily: dm500 }]}>{subtitle}</Text>

          {appleAvailable ? (
            <TouchableOpacity
              style={styles.appleBtnFallback}
              onPress={() => void run(signInWithAppleNative)}
              disabled={busy}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={t('auth.continueApple')}
            >
              <Text style={[styles.appleBtnText, { fontFamily: dm600 }]}>
                {t('auth.continueApple')}
              </Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={styles.oauthBtn}
            onPress={() => void run(signInWithGoogleOAuth)}
            disabled={busy}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('auth.continueGoogle')}
          >
            <Text style={[styles.oauthBtnText, { fontFamily: dm600 }]}>
              {t('auth.continueGoogle')}
            </Text>
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={[styles.dividerText, { fontFamily: dm500 }]}>{t('auth.orEmail')}</Text>
            <View style={styles.dividerLine} />
          </View>

          <Text style={[styles.label, { fontFamily: dm600 }]}>{t('auth.email')}</Text>
          <TextInput
            style={[styles.input, { fontFamily: dm500 }]}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            autoComplete="email"
            placeholder="toi@email.com"
            placeholderTextColor={THEME.textTertiary}
            editable={!busy}
          />

          <Text style={[styles.label, { fontFamily: dm600 }]}>{t('auth.password')}</Text>
          <TextInput
            style={[styles.input, { fontFamily: dm500 }]}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            textContentType={mode === 'signup' ? 'newPassword' : 'password'}
            autoComplete={mode === 'signup' ? 'password-new' : 'password'}
            placeholder="••••••••"
            placeholderTextColor={THEME.textTertiary}
            editable={!busy}
          />

          {mode === 'login' ? (
            <TouchableOpacity onPress={onForgotPassword} disabled={busy} hitSlop={8}>
              <Text style={[styles.forgot, { fontFamily: dm500 }]}>{t('auth.forgotPassword')}</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[petitmoCtaStyles.primary, styles.primaryCta, busy && styles.ctaDisabled]}
            onPress={onEmailSubmit}
            disabled={busy}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={primaryCta}
          >
            {busy ? (
              <ActivityIndicator color={PETITMO_CTA_SPINNER_COLOR} />
            ) : (
              <Text style={[petitmoCtaStyles.primaryText, { fontFamily: dm700 }]}>
                {primaryCta}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setMode(mode === 'signup' ? 'login' : 'signup')}
            disabled={busy}
            style={styles.switchWrap}
          >
            <Text style={[styles.switchText, { fontFamily: dm500 }]}>
              {mode === 'signup' ? t('auth.switchToLogin') : t('auth.switchToSignup')}
            </Text>
          </TouchableOpacity>
        </ScrollView>
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
  scroll: {
    paddingHorizontal: SPACING.lg,
    paddingTop: verticalScale(8),
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: verticalScale(12),
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    color: THEME.textPrimary,
    marginBottom: verticalScale(8),
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: THEME.textMuted,
    lineHeight: scale(22),
    marginBottom: verticalScale(24),
  },
  appleBtn: {
    width: '100%',
    height: verticalScale(52),
    marginBottom: verticalScale(12),
  },
  appleBtnFallback: {
    width: '100%',
    height: verticalScale(52),
    borderRadius: scale(20),
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(12),
  },
  appleBtnText: {
    fontSize: FONT_SIZES.md,
    color: '#FFFFFF',
  },
  oauthBtn: {
    width: '100%',
    height: verticalScale(52),
    borderRadius: scale(20),
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(20),
  },
  oauthBtnText: {
    fontSize: FONT_SIZES.md,
    color: THEME.textPrimary,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(10),
    marginBottom: verticalScale(18),
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: THEME.textTertiary,
  },
  dividerText: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textSecondary,
  },
  label: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textPrimary,
    marginBottom: verticalScale(6),
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    borderRadius: scale(14),
    paddingHorizontal: scale(14),
    paddingVertical: verticalScale(14),
    fontSize: FONT_SIZES.md,
    color: THEME.textPrimary,
    marginBottom: verticalScale(14),
  },
  forgot: {
    alignSelf: 'flex-end',
    color: THEME.brandPrimary,
    fontSize: FONT_SIZES.sm,
    marginBottom: verticalScale(18),
  },
  primaryCta: {
    minHeight: verticalScale(54),
    paddingVertical: verticalScale(14),
    marginTop: verticalScale(4),
  },
  ctaDisabled: { opacity: 0.7 },
  switchWrap: {
    marginTop: verticalScale(20),
    alignItems: 'center',
  },
  switchText: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    textAlign: 'center',
  },
});
