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
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FontAwesome } from '@expo/vector-icons';
import {
  ChevronLeft,
  Eye,
  EyeOff,
} from 'lucide-react-native';
import { THEME } from '@/constants/theme';
import { FONT_SIZES, SPACING } from '@/constants/sizes';
import { PETITMO_CTA_SPINNER_COLOR } from '@/constants/petitmoCtaStyles';
import PetitmoPrimaryPressable from '@/components/PetitmoPrimaryPressable';
import { scale, verticalScale } from '@/utils/responsive';
import { useDmSansFamilyFlowFonts } from '@/hooks/useDmSansFamilyFlowFonts';
import { useAppTranslation } from '@/hooks/useAppTranslation';
import {
  completeAuthCallbackFromUrl,
  ensureCloudSyncAfterRealAuth,
  hasRealAuthAccount,
  isAppleSignInNativeAvailable,
  isPasswordRecoveryCallback,
  requestPasswordReset,
  signInWithAppleNative,
  signInWithEmailPassword,
  signInWithGoogleOAuth,
  signUpWithEmailPassword,
  updatePasswordAfterRecovery,
  canResumeLastAccountOffline,
  resumeLastAccountOffline,
} from '@/lib/authAccount';
import { supabase } from '@/lib/supabase';
import { getChildren } from '@/services/children';
import { listLocalChildrenForUser } from '@/lib/localDb';
import {
  getLastRealAuthEmail,
  peekLastRealAuthUserId,
} from '@/services/accountLocalReset';
import type { User } from '@supabase/supabase-js';
import { hydrateTabScreensFromSqliteSync } from '@/services/tabScreensHydrate';
import { safeRouterBack } from '@/utils/safeRouterBack';
import { LEGAL_PRIVACY_URL, LEGAL_TERMS_URL } from '@/lib/legalUrls';
import { looksLikeNetworkAuthError, probeNetworkReachable } from '@/utils/networkProbe';

function normalizeAuthEmail(value: string): string {
  return value.trim().toLowerCase();
}

type AuthMode = 'signup' | 'login';
type AuthIntent = 'free' | 'subscribe';
/** `reset` = deep link recovery — nouveau MDP avant d’entrer dans l’app. */
type AuthUiPhase = 'boot' | 'auth' | 'reset';

const AUTH_BG = require('@/assets/images/auth_mother_child.jpg');

/** Part de l’écran réservée aux visages + titre (carte démarre en dessous). */
const HERO_RATIO = 0.44;
/** Décale le fond vers le haut pour placer les deux visages dans la zone hero. */
const BG_SHIFT_UP_RATIO = 0.1;
const AUTH_CARD_RADIUS = scale(28);
const AUTH_CARD_SIDE_MARGIN = scale(12);
/** Noir uni sous le dégradé titre (marges autour de la carte). */
const AUTH_SCRIM = 'rgba(0, 0, 0, 0.55)';
/** Hauteur du fade transparent → noir au-dessus du haut de carte. */
const AUTH_SCRIM_FADE_HEIGHT = verticalScale(150);

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

/**
 * Réinstall / login : restore soft **avant** d’ouvrir Capturer (évite flash vide/plein).
 * Overlay racine pendant le pull ; tabs seulement après.
 */
async function restoreThenEnterTabs(router: {
  replace: (href: '/(tabs)') => void;
}): Promise<void> {
  const { getAllLocalMemories } = await import('@/lib/localDb');
  if (getAllLocalMemories().length > 0) {
    hydrateTabScreensFromSqliteSync();
    router.replace('/(tabs)');
    return;
  }
  const { restoreFamilyMemoriesFromCloudWithSoftWait } = await import(
    '@/services/runCloudMemoriesRestore'
  );
  const { endCloudRestoreUi, peekCloudRestoreUi } = await import('@/lib/cloudRestoreUi');
  await restoreFamilyMemoriesFromCloudWithSoftWait({ softUi: true, holdUi: true });
  hydrateTabScreensFromSqliteSync();
  router.replace('/(tabs)');
  if (peekCloudRestoreUi().active) {
    setTimeout(() => endCloudRestoreUi(), 220);
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
  /** Formulaire e-mail replié derrière « Continuer avec e-mail » (carte type maquette). */
  const [showEmailForm, setShowEmailForm] = useState(false);
  /** iOS : afficher Apple tout de suite (évite le jump Google-only → Apple+Google). */
  const [appleAvailable, setAppleAvailable] = useState(Platform.OS === 'ios');
  /** True seulement quand on quitte déjà l’écran (session existante / post-submit) — pas au 1er paint. */
  const [leavingShell, setLeavingShell] = useState(false);
  /** Y fenêtre où commence le noir uni (≈ haut de carte + inset coins). */
  const [scrimSolidTop, setScrimSolidTop] = useState(() => windowHeight * 0.52);
  const cardOuterRef = useRef<View>(null);

  const syncScrimSolidTop = useCallback(() => {
    cardOuterRef.current?.measureInWindow((_x, y) => {
      if (typeof y !== 'number' || Number.isNaN(y)) return;
      const next = y + AUTH_CARD_RADIUS * 0.45;
      setScrimSolidTop(prev => (Math.abs(prev - next) < 1 ? prev : next));
    });
  }, []);

  const heroHeight = useMemo(() => {
    const target = windowHeight * HERO_RATIO;
    const minForCopy = insets.top + verticalScale(120);
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
    const next = parseMode(params.mode);
    setMode(next);
    // Login : le préremplissage e-mail rouvre le formulaire ; signup reste replié.
    if (next !== 'login') setShowEmailForm(false);
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
  const showHeroSubtitle = subtitle.trim().length > 0;
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

  /**
   * Après auth : isolation + mode cloud **déjà** awaités via
   * `ensureCloudSyncAfterRealAuth` (sinon race purge / mode local).
   */
  const finishAfterAuth = useCallback(
    async (opts?: { assumeNewAccount?: boolean; user?: User | null }) => {
      if (opts?.user) {
        await ensureCloudSyncAfterRealAuth(opts.user);
      }

      const uid = peekLastRealAuthUserId() || opts?.user?.id?.trim() || null;
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
            await restoreThenEnterTabs(router);
            return;
          }
        }
        const { replaceToOnboardingPermissionsOrCreateChild } = await import(
          '@/utils/onboardingPermissionsRoute'
        );
        await replaceToOnboardingPermissionsOrCreateChild(router, {
          // Login / restore : copy « réautoriser après install » (pas 1ʳᵉ création).
          returning: opts?.assumeNewAccount !== true,
        });
        return;
      }

      // Enfants déjà en local → Capturer / fil immédiat (sauf restore soft si SQLite souvenirs vide).
      if (!opts?.assumeNewAccount) {
        const { getAllLocalMemories } = await import('@/lib/localDb');
        if (getAllLocalMemories().length === 0) {
          await restoreThenEnterTabs(router);
          return;
        }
        hydrateTabScreensFromSqliteSync();
        router.replace('/(tabs)');
        void getChildren().then(() => {
          hydrateTabScreensFromSqliteSync();
        });
        return;
      }

      hydrateTabScreensFromSqliteSync();
      router.replace('/(tabs)');
    },
    [goPaywall, isSubscribe, router]
  );

  const finishAfterAuthRef = useRef(finishAfterAuth);
  finishAfterAuthRef.current = finishAfterAuth;
  const passwordRecoveryActiveRef = useRef(false);

  /** Dernier e-mail + MDP Keychain : préremplir (mdp = SecureStore, jamais AsyncStorage). */
  useEffect(() => {
    if (uiPhase !== 'auth' || mode !== 'login') return;
    let cancelled = false;
    void (async () => {
      const last = normalizeAuthEmail((await getLastRealAuthEmail()) ?? '');
      if (cancelled || !last) return;
      setEmail(prev => (normalizeAuthEmail(prev) ? prev : last));
      setShowEmailForm(true);
      try {
        const { getLastEmailPasswordFor } = await import('@/lib/lastEmailPasswordSecure');
        const savedPassword = await getLastEmailPasswordFor(last);
        if (cancelled || !savedPassword) return;
        setPassword(prev => (prev ? prev : savedPassword));
      } catch {
        /* binaire sans SecureStore → e-mail seul */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, uiPhase]);

  /**
   * Local-first : si le SQLite du dernier compte est là et l’e-mail correspond
   * (ou champ vide / OAuth), déverrouille sans demander « continuer hors ligne ? ».
   */
  const trySilentOfflineResume = useCallback(
    async (candidateEmail?: string): Promise<boolean> => {
      const can = await canResumeLastAccountOffline();
      if (!can.ok) return false;
      const typed = normalizeAuthEmail(candidateEmail ?? email);
      if (typed && typed !== can.email) return false;
      const result = await resumeLastAccountOffline();
      if (!result.ok) return false;
      setLeavingShell(true);
      hydrateTabScreensFromSqliteSync();
      router.replace('/(tabs)');
      return true;
    },
    [email, router]
  );

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
      await finishAfterAuthRef.current({
        assumeNewAccount: false,
        user: result.user,
      });
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
          const { data: sess } = await supabase.auth.getSession();
          await finishAfterAuthRef.current({
            assumeNewAccount: false,
            user: sess.session?.user ?? null,
          });
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
        | {
            ok: true;
            needsEmailConfirmation?: boolean;
            user?: User;
            reconnectedExisting?: boolean;
          }
        | { ok: false; error: string; alreadyRegistered?: boolean }
      >,
      runOpts?: { oauth?: boolean },
    ) => {
      if (busy || leavingShell) return;
      setBusy(true);
      try {
        const result = await fn();
        if (!result.ok) {
          if (result.alreadyRegistered && mode === 'signup') {
            setMode('login');
            Alert.alert(t('auth.loginTitle'), result.error);
          } else if (looksLikeNetworkAuthError(result.error)) {
            // Pas d’Alert « continuer hors ligne ? » : reprise SQLite silencieuse si possible.
            if (await trySilentOfflineResume(email)) {
              return;
            }
            Alert.alert(t('error'), t('auth.offlineContinueNeedNetwork'));
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
        // Apple / Google : toujours pull cloud si SQLite vide (compte existant fréquent).
        const assumeNewAccount =
          !runOpts?.oauth && mode === 'signup' && !reconnected;
        await finishAfterAuth({
          assumeNewAccount,
          user: 'user' in result ? result.user : null,
        });
      } catch (e) {
        console.warn('[auth] run', e);
        Alert.alert(t('error'), t('error'));
        setBusy(false);
        setLeavingShell(false);
      }
    },
    [busy, email, finishAfterAuth, intent, leavingShell, mode, router, t, trySilentOfflineResume]
  );

  const onEmailSubmit = () => {
    void (async () => {
      if (mode === 'login') {
        // Hors réseau : pas d’appel Auth ni de décision UX — ouvrir SQLite du dernier compte.
        const online = await probeNetworkReachable();
        if (!online) {
          if (busy || leavingShell) return;
          setBusy(true);
          try {
            if (await trySilentOfflineResume(email)) return;
            Alert.alert(t('error'), t('auth.offlineContinueNeedNetwork'));
          } catch (e) {
            console.warn('[auth] offline email submit', e);
            Alert.alert(t('error'), t('error'));
          } finally {
            setBusy(false);
          }
          return;
        }
      }
      void run(async () => {
        if (mode === 'signup') {
          return signUpWithEmailPassword(email, password);
        }
        return signInWithEmailPassword(email, password);
      });
    })();
  };

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
        const { data: sess } = await supabase.auth.getSession();
        await finishAfterAuth({
          assumeNewAccount: false,
          user: sess.session?.user ?? null,
        });
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

      {/* Noir uni bas → quasi-haut carte ; dégradé au-dessus (titre). */}
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <LinearGradient
          colors={['transparent', AUTH_SCRIM]}
          locations={[0, 1]}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: Math.max(0, scrimSolidTop - AUTH_SCRIM_FADE_HEIGHT),
            height: AUTH_SCRIM_FADE_HEIGHT,
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: scrimSolidTop - 1,
            bottom: 0,
            backgroundColor: AUTH_SCRIM,
          }}
        />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.screenScroll,
            {
              paddingBottom: Math.max(insets.bottom, verticalScale(10)),
              flexGrow: 1,
              justifyContent: 'flex-end',
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces
          onScroll={syncScrimSolidTop}
          scrollEventThrottle={64}
        >
          <View
            style={[
              styles.heroZone,
              {
                flexGrow: 1,
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

            <View style={styles.heroCopyWrap}>
              <View style={styles.heroCopy}>
                <Text style={styles.title}>{title}</Text>
                {showHeroSubtitle ? (
                  <Text style={styles.subtitle}>{subtitle}</Text>
                ) : null}
              </View>
            </View>
          </View>

          <View
            ref={cardOuterRef}
            style={styles.cardOuter}
            onLayout={syncScrimSolidTop}
          >
            <View style={styles.cardWrap}>
              <View
                style={[
                  styles.cardInner,
                  { paddingBottom: verticalScale(20) },
                ]}
              >
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
                          <EyeOff size={scale(20)} color={THEME.textSecondary} />
                        ) : (
                          <Eye size={scale(20)} color={THEME.textSecondary} />
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
                        <Text style={styles.primaryCtaText}>
                          {primaryCta}
                        </Text>
                      )}
                    </PetitmoPrimaryPressable>
                  </>
                ) : (
                  <>
                {appleAvailable ? (
                  <TouchableOpacity
                    style={styles.appleBtn}
                    onPress={() => void run(signInWithAppleNative, { oauth: true })}
                    disabled={busy}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={t('auth.continueApple')}
                  >
                    <FontAwesome name="apple" size={scale(18)} color="#FFFFFF" />
                    <Text style={styles.appleBtnText}>
                      {t('auth.continueApple')}
                    </Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.googleBtn}
                  onPress={() => void run(signInWithGoogleOAuth, { oauth: true })}
                  disabled={busy}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={t('auth.continueGoogle')}
                >
                  <FontAwesome name="google" size={scale(16)} color="#4285F4" />
                  <Text style={styles.googleBtnText}>
                    {t('auth.continueGoogle')}
                  </Text>
                </TouchableOpacity>

                {!showEmailForm ? (
                  <TouchableOpacity
                    style={styles.emailGateBtn}
                    onPress={() => setShowEmailForm(true)}
                    disabled={busy}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={t('auth.continueEmail')}
                  >
                    <Text style={styles.emailGateBtnText}>
                      {t('auth.continueEmail')}
                    </Text>
                  </TouchableOpacity>
                ) : (
                  <>
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
                      textContentType={mode === 'login' ? 'username' : 'emailAddress'}
                      autoComplete={mode === 'login' ? 'username' : 'email'}
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
                          <EyeOff size={scale(20)} color={THEME.textSecondary} />
                        ) : (
                          <Eye size={scale(20)} color={THEME.textSecondary} />
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
                        <Text style={styles.primaryCtaText}>
                          {primaryCta}
                        </Text>
                      )}
                    </PetitmoPrimaryPressable>
                  </>
                )}

                <TouchableOpacity
                  onPress={() => {
                    setMode(mode === 'signup' ? 'login' : 'signup');
                    setShowEmailForm(false);
                  }}
                  disabled={busy}
                  style={styles.switchWrap}
                  accessibilityRole="button"
                >
                  <Text style={styles.switchText}>
                    {mode === 'signup'
                      ? t('auth.switchToLoginPrefix')
                      : t('auth.switchToSignupPrefix')}
                    <Text style={styles.switchAction}>
                      {mode === 'signup'
                        ? t('auth.switchToLoginAction')
                        : t('auth.switchToSignupAction')}
                    </Text>
                  </Text>
                </TouchableOpacity>

                <Text style={styles.legal}>
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
  heroZone: {
    paddingHorizontal: 0,
    justifyContent: 'flex-start',
  },
  heroCopyWrap: {
    marginTop: 'auto',
    width: '100%',
    zIndex: 1,
  },
  heroCopy: {
    paddingHorizontal: SPACING.md,
    paddingTop: verticalScale(36),
    paddingBottom: verticalScale(18),
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginLeft: SPACING.md,
    marginBottom: verticalScale(4),
  },
  title: {
    fontSize: scale(32),
    fontWeight: '500',
    color: '#FFFFFF',
    textAlign: 'center',
    alignSelf: 'center',
    lineHeight: scale(38),
    letterSpacing: -0.3,
    marginBottom: verticalScale(10),
    maxWidth: scale(340),
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 14,
  },
  subtitle: {
    fontSize: scale(18),
    fontWeight: '500',
    color: 'rgba(255,255,255,0.95)',
    textAlign: 'center',
    alignSelf: 'center',
    lineHeight: scale(26),
    letterSpacing: -0.1,
    maxWidth: scale(320),
    textShadowColor: 'rgba(40, 22, 18, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 10,
  },
  cardOuter: {
    paddingHorizontal: AUTH_CARD_SIDE_MARGIN,
    paddingBottom: 0,
    zIndex: 2,
  },
  cardWrap: {
    borderRadius: AUTH_CARD_RADIUS,
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  cardInner: {
    paddingHorizontal: scale(20),
    paddingTop: verticalScale(20),
  },
  appleBtn: {
    width: '100%',
    minHeight: verticalScale(52),
    borderRadius: scale(18),
    backgroundColor: '#000000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(10),
    marginBottom: verticalScale(10),
    paddingVertical: verticalScale(14),
  },
  appleBtnText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '400',
    color: '#FFFFFF',
  },
  googleBtn: {
    width: '100%',
    minHeight: verticalScale(52),
    borderRadius: scale(18),
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(10),
    marginBottom: verticalScale(10),
    paddingVertical: verticalScale(14),
  },
  googleBtnText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '400',
    color: THEME.textPrimary,
  },
  emailGateBtn: {
    width: '100%',
    minHeight: verticalScale(52),
    borderRadius: scale(18),
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: verticalScale(4),
    paddingVertical: verticalScale(14),
  },
  emailGateBtnText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '400',
    color: THEME.brandPrimary,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: scale(10),
    marginTop: verticalScale(4),
    marginBottom: verticalScale(10),
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: THEME.textTertiary,
  },
  dividerText: {
    fontSize: FONT_SIZES.base,
    color: THEME.textSecondary,
  },
  label: {
    fontSize: FONT_SIZES.base,
    color: THEME.textPrimary,
    marginBottom: verticalScale(6),
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E5EA',
    backgroundColor: '#FFFFFF',
    borderRadius: scale(18),
    paddingHorizontal: scale(16),
    paddingVertical: verticalScale(14),
    minHeight: verticalScale(52),
    fontSize: FONT_SIZES.lg,
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
    fontSize: FONT_SIZES.base,
    marginTop: verticalScale(8),
    marginBottom: verticalScale(10),
  },
  forgotSpacer: {
    height: verticalScale(10),
  },
  primaryCta: {
    minHeight: verticalScale(52),
    paddingVertical: verticalScale(14),
    width: '100%',
  },
  primaryCtaText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '500',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  switchWrap: {
    marginTop: verticalScale(14),
    alignItems: 'center',
  },
  switchText: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '400',
    color: THEME.textMuted,
    textAlign: 'center',
  },
  switchAction: {
    fontWeight: '400',
    color: THEME.brandPrimary,
    textDecorationLine: 'underline',
  },
  legal: {
    marginTop: verticalScale(12),
    fontSize: FONT_SIZES.base,
    fontWeight: '400',
    color: THEME.textSecondary,
    textAlign: 'center',
    lineHeight: scale(22),
  },
  legalLink: {
    textDecorationLine: 'underline',
    color: THEME.textMuted,
  },
});
