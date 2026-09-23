/**
 * Règle d’or V2 : compte gratuit obligatoire (Google / Apple / email+mdp).
 * Modes : signup | login. Intent : free (défaut) | subscribe (depuis « S’abonner »).
 * Compte d’abord ; si intent=subscribe → paywall, puis profil enfant si besoin.
 * UI maquette : zone photo + carte frosted ; un seul scroll d’écran.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome } from '@expo/vector-icons';
import {
  BookOpen,
  Cloud,
  ChevronLeft,
  Eye,
  EyeOff,
  Images,
  Infinity as InfinityIcon,
  Lock,
} from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { FONT_SIZES, SPACING } from '@/constants/sizes';
import { PETITMO_CTA_SPINNER_COLOR, petitmoCtaStyles } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { FREE_TIER_LIMIT } from '@/lib/limits';
import { scale, verticalScale } from '@/utils/responsive';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import {
  completeAuthCallbackFromUrl,
  hasRealAuthAccount,
  isAppleSignInNativeAvailable,
  isPasswordRecoveryCallback,
  requestPasswordReset,
  signInWithAppleNative,
  signInWithEmailPassword,
  signInWithGoogleOAuth,
  signUpWithEmailPassword,
  updatePasswordAfterRecovery,
} from '@/lib/authAccount';
import { supabase } from '@/lib/supabase';
import { getChildren } from '@/services/children';
import { listLocalChildrenForUser } from '@/lib/localDb';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';
import { safeRouterBack } from '@/utils/safeRouterBack';
import { LEGAL_PRIVACY_URL, LEGAL_TERMS_URL } from '@/lib/legalUrls';

type AuthMode = 'signup' | 'login';
type AuthIntent = 'free' | 'subscribe';
/** `reset` = deep link recovery — nouveau MDP avant d’entrer dans l’app. */
type AuthUiPhase = 'boot' | 'auth' | 'reset';

const AUTH_BG = require('@/assets/images/auth_mother_child.jpg');

/** Part de l’écran réservée aux visages + titre (carte démarre en dessous). */
const HERO_RATIO = 0.44;
/** Décale le fond vers le haut pour placer les deux visages dans la zone hero. */
const BG_SHIFT_UP_RATIO = 0.1;

function parseMode(raw: string | string[] | undefined): AuthMode {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'login' ? 'login' : 'signup';
}

function parseIntent(raw: string | string[] | undefined): AuthIntent {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'subscribe' ? 'subscribe' : 'free';
}

async function openUrl(url: string) {
  try {
    await Linking.openURL(url);
  } catch (e) {
    console.warn('[auth] openUrl', e);
  }
}

export default function AuthScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const params = useLocalSearchParams<{ mode?: string; intent?: string }>();
  const { t } = useAppTranslation('common');
  const { loaded: fontsLoaded, dm500, dm600, dm700 } = useDmSansFamilyFlowFonts();

  const intent = parseIntent(params.intent);
  const isSubscribe = intent === 'subscribe';

  const [mode, setMode] = useState<AuthMode>(() => parseMode(params.mode));
  const [uiPhase, setUiPhase] = useState<AuthUiPhase>('boot');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  /** iOS : afficher Apple tout de suite (évite le jump Google-only → Apple+Google). */
  const [appleAvailable, setAppleAvailable] = useState(Platform.OS === 'ios');
  /** True seulement quand on quitte déjà l’écran (session existante / post-submit) — pas au 1er paint. */
  const [leavingShell, setLeavingShell] = useState(false);

  const heroHeight = useMemo(() => {
    const target = windowHeight * HERO_RATIO;
    const minForCopy = insets.top + verticalScale(152);
    return Math.max(target, minForCopy);
  }, [insets.top, windowHeight]);

  const bgStyle = useMemo(() => {
    const shift = windowHeight * BG_SHIFT_UP_RATIO;
    return {
      width: windowWidth,
      height: windowHeight + shift,
      top: -shift,
      left: 0,
      position: 'absolute' as const,
    };
  }, [windowHeight, windowWidth]);

  useEffect(() => {
    setMode(parseMode(params.mode));
  }, [params.mode]);

  useEffect(() => {
    if (Platform.OS !== 'ios') {
      setAppleAvailable(false);
      return;
    }
    let cancelled = false;
    void isAppleSignInNativeAvailable().then(ok => {
      if (!cancelled) setAppleAvailable(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const title =
    uiPhase === 'reset'
      ? t('auth.resetTitle')
      : isSubscribe
        ? mode === 'signup'
          ? t('auth.plus.signupTitle')
          : t('auth.plus.loginTitle')
        : mode === 'signup'
          ? t('auth.signupTitle')
          : t('auth.loginTitle');
  const subtitle =
    uiPhase === 'reset'
      ? t('auth.resetSubtitle')
      : isSubscribe
        ? mode === 'signup'
          ? t('auth.plus.signupSubtitle')
          : t('auth.plus.loginSubtitle')
        : mode === 'signup'
          ? t('auth.signupSubtitle')
          : t('auth.loginSubtitle');
  const primaryCta =
    uiPhase === 'reset'
      ? t('auth.resetCta')
      : mode === 'signup'
        ? isSubscribe
          ? t('auth.plus.signupCta')
          : t('auth.signupCta')
        : t('auth.loginCta');

  const goPaywall = useCallback(() => {
    router.replace({
      pathname: '/paywall',
      params: { context: 'GENERAL', returnTo: 'fil', from: 'subscribe' },
    });
  }, [router]);

  const finishAfterAuth = useCallback(
    async (opts?: { assumeNewAccount?: boolean }) => {
      const uid = peekLastRealAuthUserId();
      const localCount = uid ? listLocalChildrenForUser(uid).length : 0;

      // Intent abonnement : compte → paywall tout de suite (profil enfant après).
      if (isSubscribe) {
        hydrateTabScreensFromSqliteSync();
        goPaywall();
        return;
      }

      // Login / reconnexion : SQLite vide → pull enfants avant de router
      // (sinon écran permissions rejoué alors que le compte a déjà un fil).
      if (localCount === 0) {
        if (!opts?.assumeNewAccount) {
          const children = await getChildren();
          if (children.length > 0) {
            hydrateTabScreensFromSqliteSync();
            const { markOnboardingPermissionsSeen } = await import(
              '@/lib/onboardingPermissionsSeen'
            );
            await markOnboardingPermissionsSeen(uid);
            router.replace('/(tabs)');
            return;
          }
        }
        const { replaceToOnboardingPermissionsOrCreateChild } = await import(
          '@/utils/onboardingPermissionsRoute'
        );
        await replaceToOnboardingPermissionsOrCreateChild(router);
        return;
      }

      // Enfants déjà en local → fil.
      hydrateTabScreensFromSqliteSync();
      router.replace('/(tabs)');
      if (!opts?.assumeNewAccount) {
        void getChildren().then(() => {
          hydrateTabScreensFromSqliteSync();
        });
      }
    },
    [goPaywall, isSubscribe, mode, router]
  );

  const finishAfterAuthRef = useRef(finishAfterAuth);
  finishAfterAuthRef.current = finishAfterAuth;
  const passwordRecoveryActiveRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const enterReset = () => {
      if (cancelled) return;
      passwordRecoveryActiveRef.current = true;
      setPassword('');
      setPasswordConfirm('');
      setUiPhase('reset');
      setLeavingShell(false);
    };

    const handleCallbackUrl = async (url: string | null): Promise<boolean> => {
      if (!url) return false;
      // Même garde-fou que +native-intent : tokens souvent en `#…` (Supabase).
      const normalized =
        url.includes('#') && !url.includes('?')
          ? url.replace('#', '?')
          : url.includes('#') && url.includes('?')
            ? url.replace('#', '&')
            : url;
      const looksRecovery = isPasswordRecoveryCallback(normalized);
      const hasTokens =
        normalized.includes('access_token') ||
        normalized.includes('refresh_token') ||
        normalized.includes('type=') ||
        normalized.includes('code=') ||
        normalized.includes('token_hash=');
      if (!looksRecovery && !hasTokens) return false;

      const result = await completeAuthCallbackFromUrl(normalized);
      if (!result.ok) {
        if (looksRecovery || url.includes('code=')) {
          Alert.alert(t('error'), result.error || t('auth.resetLinkInvalid'));
        }
        return false;
      }
      if (result.passwordRecovery || looksRecovery) {
        enterReset();
        return true;
      }
      // OAuth / confirm e-mail via deep link : entrer dans l’app.
      if (cancelled) return true;
      setLeavingShell(true);
      await finishAfterAuthRef.current();
      return true;
    };

    void (async () => {
      try {
        const initialUrl = await Linking.getInitialURL();
        if (await handleCallbackUrl(initialUrl)) return;

        if (passwordRecoveryActiveRef.current) return;

        // getSession local — timeout court pour ne jamais rester sur uiPhase boot.
        const accountOk = await Promise.race([
          hasRealAuthAccount(),
          new Promise<boolean>(resolve => setTimeout(() => resolve(false), 2000)),
        ]);
        if (accountOk) {
          if (cancelled || passwordRecoveryActiveRef.current) return;
          setLeavingShell(true);
          await finishAfterAuthRef.current();
          return;
        }
      } catch (e) {
        console.warn('[auth] boot', e);
      }
      if (!cancelled && !passwordRecoveryActiveRef.current) setUiPhase('auth');
    })();

    const linkSub = Linking.addEventListener('url', ({ url }) => {
      void handleCallbackUrl(url);
    });

    const {
      data: { subscription: authSub },
    } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY') {
        enterReset();
      }
    });

    return () => {
      cancelled = true;
      linkSub.remove();
      authSub.unsubscribe();
    };
    // Boot une seule fois — finishAfterAuth via ref (évite de quitter l’UI reset).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only
  }, [t]);

  const run = useCallback(
    async (
      fn: () => Promise<
        | { ok: true; needsEmailConfirmation?: boolean }
        | { ok: false; error: string; alreadyRegistered?: boolean }
      >
    ) => {
      if (busy || leavingShell) return;
      setBusy(true);
      try {
        const result = await fn();
        if (!result.ok) {
          if (result.alreadyRegistered && mode === 'signup') {
            setMode('login');
            Alert.alert(t('auth.loginTitle'), result.error);
          } else {
            Alert.alert(t('error'), result.error);
          }
          setBusy(false);
          return;
        }
        if ('needsEmailConfirmation' in result && result.needsEmailConfirmation) {
          setBusy(false);
          router.push({
            pathname: '/auth-verify-otp',
            params: {
              email: email.trim().toLowerCase(),
              intent,
            },
          });
          return;
        }
        setLeavingShell(true);
        const reconnected =
          'reconnectedExisting' in result && Boolean(result.reconnectedExisting);
        await finishAfterAuth({
          assumeNewAccount: mode === 'signup' && !reconnected,
        });
      } catch (e) {
        console.warn('[auth] run', e);
        Alert.alert(t('error'), t('error'));
        setBusy(false);
        setLeavingShell(false);
      }
    },
    [busy, email, finishAfterAuth, intent, leavingShell, mode, router, t]
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

  const onResetPasswordSubmit = () => {
    void (async () => {
      if (busy || leavingShell) return;
      if (password !== passwordConfirm) {
        Alert.alert(t('error'), t('auth.resetMismatch'));
        return;
      }
      setBusy(true);
      try {
        const result = await updatePasswordAfterRecovery(password);
        if (!result.ok) {
          Alert.alert(t('error'), result.error);
          setBusy(false);
          return;
        }
        Alert.alert(t('auth.resetSuccessTitle'), t('auth.resetSuccessBody'));
        setLeavingShell(true);
        await finishAfterAuth({ assumeNewAccount: false });
      } catch (e) {
        console.warn('[auth] reset password', e);
        Alert.alert(t('error'), t('error'));
        setBusy(false);
        setLeavingShell(false);
      }
    })();
  };

  // Shell plein : boot / navigation sortante seulement.
  // Pendant saisie MDP (`busy`), garder le formulaire + spinner bouton — sinon hang réseau = écran mort.
  if (!fontsLoaded || leavingShell || uiPhase === 'boot') {
    return (
      <View style={styles.shell}>
        <Image source={AUTH_BG} style={bgStyle} resizeMode="cover" />
        <View style={styles.loadingOverlay}>
          <ActivityIndicator color={THEME.brandCtaOrange} size="large" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <Image source={AUTH_BG} style={bgStyle} resizeMode="cover" />

      <LinearGradient
        colors={['rgba(40, 22, 18, 0.18)', 'rgba(40, 22, 18, 0.08)', 'rgba(40, 22, 18, 0.28)']}
        locations={[0, 0.45, 1]}
        style={[styles.heroFade, { height: heroHeight }]}
        pointerEvents="none"
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.screenScroll,
            { paddingBottom: Math.max(insets.bottom, verticalScale(12)) },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces
        >
          <View
            style={[
              styles.heroZone,
              {
                minHeight: heroHeight,
                paddingTop: insets.top + verticalScale(2),
              },
            ]}
          >
            <TouchableOpacity
              onPress={() => safeRouterBack(router, '/onboarding')}
              style={styles.backBtn}
              accessibilityRole="button"
              accessibilityLabel={t('back')}
              hitSlop={12}
            >
              <ChevronLeft size={scale(28)} color="#FFFFFF" />
            </TouchableOpacity>

            <View style={styles.heroCopy}>
              <Text
                style={[
                  styles.title,
                  isSubscribe && styles.titleCentered,
                  { fontFamily: dm700 },
                ]}
              >
                {title}
              </Text>

              {mode === 'signup' && !isSubscribe && uiPhase !== 'reset' ? (
                <View style={styles.badge}>
                  <Text style={[styles.badgeText, { fontFamily: dm600 }]}>
                    {t('auth.freeBadge')}
                  </Text>
                </View>
              ) : null}

              <Text
                style={[
                  styles.subtitle,
                  isSubscribe && styles.subtitleCentered,
                  { fontFamily: dm500 },
                ]}
              >
                {subtitle}
              </Text>
            </View>
          </View>

          <View style={styles.cardOuter}>
            <View style={styles.cardWrap}>
              {Platform.OS === 'ios' ? (
                <BlurView intensity={42} tint="light" style={StyleSheet.absoluteFillObject} />
              ) : null}
              <View style={styles.cardInner}>
                {uiPhase === 'reset' ? (
                  <>
                    <Text style={[styles.label, { fontFamily: dm700 }]}>{t('auth.password')}</Text>
                    <View style={styles.passwordRow}>
                      <TextInput
                        style={[styles.input, styles.passwordInput, { fontFamily: dm500 }]}
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry={!showPassword}
                        textContentType="newPassword"
                        autoComplete="password-new"
                        placeholder={t('auth.passwordPlaceholder')}
                        placeholderTextColor={THEME.textTertiary}
                        editable={!busy}
                      />
                      <TouchableOpacity
                        style={styles.eyeBtn}
                        onPress={() => setShowPassword(v => !v)}
                        accessibilityRole="button"
                        accessibilityLabel={
                          showPassword ? t('auth.hidePassword') : t('auth.showPassword')
                        }
                        hitSlop={8}
                      >
                        {showPassword ? (
                          <EyeOff size={scale(18)} color={THEME.textSecondary} />
                        ) : (
                          <Eye size={scale(18)} color={THEME.textSecondary} />
                        )}
                      </TouchableOpacity>
                    </View>

                    <Text style={[styles.label, { fontFamily: dm700 }]}>
                      {t('auth.resetPasswordConfirm')}
                    </Text>
                    <TextInput
                      style={[styles.input, { fontFamily: dm500 }]}
                      value={passwordConfirm}
                      onChangeText={setPasswordConfirm}
                      secureTextEntry={!showPassword}
                      textContentType="newPassword"
                      autoComplete="password-new"
                      placeholder={t('auth.passwordPlaceholder')}
                      placeholderTextColor={THEME.textTertiary}
                      editable={!busy}
                    />
                    <View style={styles.forgotSpacer} />

                    <PetitmoPrimaryPressable
                      style={styles.primaryCta}
                      onPress={onResetPasswordSubmit}
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
                    </PetitmoPrimaryPressable>
                  </>
                ) : (
                  <>
                <View style={styles.benefitsRow}>
                  {isSubscribe ? (
                    <>
                      <View style={styles.benefitCol}>
                        <View style={styles.benefitIconWrap}>
                          <InfinityIcon
                            size={scale(20)}
                            color={THEME.brandCtaOrange}
                            strokeWidth={2}
                          />
                        </View>
                        <Text style={[styles.benefitTitle, { fontFamily: dm700 }]}>
                          {t('auth.plus.benefitUnlimitedTitle')}
                        </Text>
                        <Text style={[styles.benefitBody, { fontFamily: dm500 }]}>
                          {t('auth.plus.benefitUnlimitedBody')}
                        </Text>
                      </View>
                      <View style={styles.benefitCol}>
                        <View style={styles.benefitIconWrap}>
                          <View style={styles.cloudLockIcon}>
                            <Cloud size={scale(18)} color={THEME.brandCtaOrange} strokeWidth={2} />
                            <View style={styles.miniLockBadge}>
                              <Lock
                                size={scale(8)}
                                color={THEME.brandCtaOrange}
                                strokeWidth={2.5}
                              />
                            </View>
                          </View>
                        </View>
                        <Text style={[styles.benefitTitle, { fontFamily: dm700 }]}>
                          {t('auth.plus.benefitCloudTitle')}
                        </Text>
                        <Text style={[styles.benefitBody, { fontFamily: dm500 }]}>
                          {t('auth.plus.benefitCloudBody')}
                        </Text>
                      </View>
                      <View style={styles.benefitCol}>
                        <View style={styles.benefitIconWrap}>
                          <BookOpen size={scale(20)} color={THEME.brandCtaOrange} strokeWidth={2} />
                        </View>
                        <Text style={[styles.benefitTitle, { fontFamily: dm700 }]}>
                          {t('auth.plus.benefitBookTitle')}
                        </Text>
                        <Text style={[styles.benefitBody, { fontFamily: dm500 }]}>
                          {t('auth.plus.benefitBookBody')}
                        </Text>
                      </View>
                    </>
                  ) : (
                    <>
                      <View style={styles.benefitCol}>
                        <View style={styles.benefitIconWrap}>
                          <Images size={scale(20)} color={THEME.brandCtaOrange} strokeWidth={2} />
                        </View>
                        <Text style={[styles.benefitTitle, { fontFamily: dm700 }]}>
                          {t('auth.benefitMemoriesTitle', { count: FREE_TIER_LIMIT })}
                        </Text>
                        <Text style={[styles.benefitBody, { fontFamily: dm500 }]}>
                          {t('auth.benefitMemoriesBody')}
                        </Text>
                      </View>
                      <View style={styles.benefitCol}>
                        <View style={styles.benefitIconWrap}>
                          <Lock size={scale(20)} color={THEME.brandCtaOrange} strokeWidth={2} />
                        </View>
                        <Text style={[styles.benefitTitle, { fontFamily: dm700 }]}>
                          {t('auth.benefitSavedTitle')}
                        </Text>
                        <Text style={[styles.benefitBody, { fontFamily: dm500 }]}>
                          {t('auth.benefitSavedBody')}
                        </Text>
                      </View>
                      <View style={styles.benefitCol}>
                        <View style={styles.benefitIconWrap}>
                          <BookOpen size={scale(20)} color={THEME.brandCtaOrange} strokeWidth={2} />
                        </View>
                        <Text style={[styles.benefitTitle, { fontFamily: dm700 }]}>
                          {t('auth.benefitBookTitle')}
                        </Text>
                        <Text style={[styles.benefitBody, { fontFamily: dm500 }]}>
                          {t('auth.benefitBookBody')}
                        </Text>
                      </View>
                    </>
                  )}
                </View>

                {appleAvailable ? (
                  <TouchableOpacity
                    style={styles.appleBtn}
                    onPress={() => void run(signInWithAppleNative)}
                    disabled={busy}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={t('auth.continueApple')}
                  >
                    <FontAwesome name="apple" size={scale(17)} color="#FFFFFF" />
                    <Text style={[styles.appleBtnText, { fontFamily: dm600 }]}>
                      {t('auth.continueApple')}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.googleBtn}
                  onPress={() => void run(signInWithGoogleOAuth)}
                  disabled={busy}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t('auth.continueGoogle')}
                >
                  <FontAwesome name="google" size={scale(15)} color="#4285F4" />
                  <Text style={[styles.googleBtnText, { fontFamily: dm600 }]}>
                    {t('auth.continueGoogle')}
                  </Text>
                </TouchableOpacity>

                <View style={styles.dividerRow}>
                  <View style={styles.dividerLine} />
                  <Text style={[styles.dividerText, { fontFamily: dm500 }]}>
                    {t('auth.orEmail')}
                  </Text>
                  <View style={styles.dividerLine} />
                </View>

                <Text style={[styles.label, { fontFamily: dm700 }]}>{t('auth.email')}</Text>
                <TextInput
                  style={[styles.input, { fontFamily: dm500 }]}
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  autoComplete="email"
                  placeholder={t('auth.emailPlaceholder')}
                  placeholderTextColor={THEME.textTertiary}
                  editable={!busy}
                />

                <Text style={[styles.label, { fontFamily: dm700 }]}>{t('auth.password')}</Text>
                <View style={styles.passwordRow}>
                  <TextInput
                    style={[styles.input, styles.passwordInput, { fontFamily: dm500 }]}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPassword}
                    textContentType={mode === 'signup' ? 'newPassword' : 'password'}
                    autoComplete={mode === 'signup' ? 'password-new' : 'password'}
                    placeholder={t('auth.passwordPlaceholder')}
                    placeholderTextColor={THEME.textTertiary}
                    editable={!busy}
                  />
                  <TouchableOpacity
                    style={styles.eyeBtn}
                    onPress={() => setShowPassword(v => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={
                      showPassword ? t('auth.hidePassword') : t('auth.showPassword')
                    }
                    hitSlop={8}
                  >
                    {showPassword ? (
                      <EyeOff size={scale(18)} color={THEME.textSecondary} />
                    ) : (
                      <Eye size={scale(18)} color={THEME.textSecondary} />
                    )}
                  </TouchableOpacity>
                </View>

                {mode === 'login' ? (
                  <TouchableOpacity onPress={onForgotPassword} disabled={busy} hitSlop={8}>
                    <Text style={[styles.forgot, { fontFamily: dm500 }]}>
                      {t('auth.forgotPassword')}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.forgotSpacer} />
                )}

                <PetitmoPrimaryPressable
                  style={styles.primaryCta}
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
                </PetitmoPrimaryPressable>

                <TouchableOpacity
                  onPress={() => setMode(mode === 'signup' ? 'login' : 'signup')}
                  disabled={busy}
                  style={styles.switchWrap}
                  accessibilityRole="button"
                >
                  <Text style={[styles.switchText, { fontFamily: dm500 }]}>
                    {mode === 'signup'
                      ? t('auth.switchToLoginPrefix')
                      : t('auth.switchToSignupPrefix')}
                    <Text style={[styles.switchAction, { fontFamily: dm700 }]}>
                      {mode === 'signup'
                        ? t('auth.switchToLoginAction')
                        : t('auth.switchToSignupAction')}
                    </Text>
                  </Text>
                </TouchableOpacity>

                <Text style={[styles.legal, { fontFamily: dm500 }]}>
                  {t('auth.legalBefore')}
                  <Text style={styles.legalLink} onPress={() => void openUrl(LEGAL_TERMS_URL)}>
                    {t('auth.legalTerms')}
                  </Text>
                  {t('auth.legalAnd')}
                  <Text style={styles.legalLink} onPress={() => void openUrl(LEGAL_PRIVACY_URL)}>
                    {t('auth.legalPrivacy')}
                  </Text>
                  {t('auth.legalAfter')}
                </Text>
                  </>
                )}
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: '#2A1A14',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(42, 26, 20, 0.35)',
  },
  flex: { flex: 1 },
  screenScroll: {
    flexGrow: 1,
  },
  heroFade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  heroZone: {
    paddingHorizontal: SPACING.md,
    justifyContent: 'flex-start',
  },
  heroCopy: {
    marginTop: 'auto',
    marginBottom: verticalScale(10),
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: verticalScale(4),
  },
  title: {
    fontSize: FONT_SIZES.xxl,
    color: '#FFFFFF',
    marginBottom: verticalScale(8),
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  titleCentered: {
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  badge: {
    alignSelf: 'center',
    backgroundColor: 'rgba(255, 214, 196, 0.95)',
    paddingHorizontal: scale(12),
    paddingVertical: verticalScale(3),
    borderRadius: scale(999),
    marginBottom: verticalScale(8),
  },
  badgeText: {
    fontSize: FONT_SIZES.sm,
    color: THEME.brandCtaOrange,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: 'rgba(255,255,255,0.92)',
    lineHeight: scale(22),
    textShadowColor: 'rgba(0,0,0,0.2)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  subtitleCentered: {
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  cardOuter: {
    paddingHorizontal: scale(14),
  },
  cardWrap: {
    borderRadius: scale(28),
    overflow: 'hidden',
    backgroundColor: Platform.OS === 'ios' ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.96)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  cardInner: {
    paddingHorizontal: scale(12),
    paddingTop: verticalScale(12),
    paddingBottom: verticalScale(14),
  },
  benefitsRow: {
    flexDirection: 'row',
    gap: scale(4),
    marginBottom: verticalScale(10),
  },
  benefitCol: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: scale(2),
  },
  benefitIconWrap: {
    width: scale(40),
    height: scale(40),
    borderRadius: scale(20),
    backgroundColor: 'rgba(253, 119, 100, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(4),
  },
  cloudLockIcon: {
    width: scale(22),
    height: scale(22),
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniLockBadge: {
    position: 'absolute',
    right: -2,
    bottom: -1,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: scale(6),
    padding: 1,
  },
  benefitTitle: {
    fontSize: FONT_SIZES.xs,
    color: THEME.textPrimary,
    textAlign: 'center',
    marginBottom: verticalScale(2),
    lineHeight: scale(15),
  },
  benefitBody: {
    fontSize: scale(10),
    color: THEME.textMuted,
    textAlign: 'center',
    lineHeight: scale(13),
  },
  appleBtn: {
    width: '100%',
    minHeight: verticalScale(46),
    borderRadius: scale(18),
    backgroundColor: '#000000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(10),
    marginBottom: verticalScale(8),
    paddingVertical: verticalScale(10),
  },
  appleBtnText: {
    fontSize: FONT_SIZES.md,
    color: '#FFFFFF',
  },
  googleBtn: {
    width: '100%',
    minHeight: verticalScale(46),
    borderRadius: scale(18),
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(10),
    marginBottom: verticalScale(12),
    paddingVertical: verticalScale(10),
  },
  googleBtnText: {
    fontSize: FONT_SIZES.md,
    color: THEME.textPrimary,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(10),
    marginBottom: verticalScale(10),
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
    marginBottom: verticalScale(5),
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    borderRadius: scale(14),
    paddingHorizontal: scale(14),
    paddingVertical: verticalScale(11),
    fontSize: FONT_SIZES.md,
    color: THEME.textPrimary,
    marginBottom: verticalScale(10),
    letterSpacing: 0,
  },
  passwordRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  passwordInput: {
    paddingRight: scale(44),
    marginBottom: 0,
  },
  eyeBtn: {
    position: 'absolute',
    right: scale(12),
    height: '100%',
    justifyContent: 'center',
  },
  forgot: {
    alignSelf: 'flex-end',
    color: THEME.brandPrimary,
    fontSize: FONT_SIZES.sm,
    marginTop: verticalScale(8),
    marginBottom: verticalScale(10),
  },
  forgotSpacer: {
    height: verticalScale(10),
  },
  primaryCta: {
    minHeight: verticalScale(50),
    paddingVertical: verticalScale(12),
    width: '100%',
  },
  switchWrap: {
    marginTop: verticalScale(12),
    alignItems: 'center',
  },
  switchText: {
    fontSize: FONT_SIZES.sm,
    color: THEME.textMuted,
    textAlign: 'center',
  },
  switchAction: {
    color: THEME.textPrimary,
    textDecorationLine: 'underline',
  },
  legal: {
    marginTop: verticalScale(12),
    fontSize: FONT_SIZES.xs,
    color: THEME.textSecondary,
    textAlign: 'center',
    lineHeight: scale(16),
  },
  legalLink: {
    textDecorationLine: 'underline',
    color: THEME.textMuted,
  },
});
