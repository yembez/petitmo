import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { setCloudAccountKind } from '@/lib/userMode';
import { setUserTier, type UserTier } from '@/lib/userTier';
import { getGoogleIosClientId, getGoogleWebClientId } from '@/lib/googleAuthConfig';
import {
  prepareLocalWorkspaceForRealUser,
  setLastRealAuthUserId,
} from '@/services/accountLocalReset';
import { claimLocalDataForCloudUser } from '@/services/claimLocalDataForCloud';
import { ensureSupabaseSession } from '@/lib/ensureSupabaseSession';
import { clearSelectedChildAndCaptureSnapshot } from '@/services/children';

WebBrowser.maybeCompleteAuthSession();

/**
 * Redirect e-mail Auth (reset MDP) → scheme natif uniquement.
 * `Linking.createURL('auth')` seul renvoie souvent `exp://IP:8081/--/auth` avec Metro :
 * Safari ouvre ça en page blanche. Allow-list Supabase : `petitmo://auth`.
 */
export function getPasswordResetRedirectUrl(): string {
  return Linking.createURL('auth', { scheme: 'petitmo' });
}

const DEVICE_EMAIL_SUFFIX = '@petitmo.local';

/** Cache sync pour UI paramètres (évite pop différé de « Se déconnecter »). */
let realAuthEmailMemory: string | null = null;
let hasRealAuthMemory = false;

export function peekHasRealAuthAccount(): boolean {
  return hasRealAuthMemory;
}

export function peekRealAuthEmail(): string {
  return realAuthEmailMemory ?? '';
}

function rememberRealAuthUser(user: User | null | undefined): void {
  if (!user || isDeviceUserEmail(user.email)) {
    hasRealAuthMemory = false;
    realAuthEmailMemory = null;
    return;
  }
  hasRealAuthMemory = true;
  const raw =
    user.email ??
    (typeof user.user_metadata?.email === 'string' ? user.user_metadata.email : '') ??
    '';
  realAuthEmailMemory = raw.trim() || null;
}

export type AuthAccountResult =
  | {
      ok: true;
      user: User;
      session: Session | null;
      needsEmailConfirmation?: boolean;
      /** Compte déjà existant reconduit via signup → traiter comme login. */
      reconnectedExisting?: boolean;
    }
  | { ok: false; error: string; alreadyRegistered?: boolean };

export function isDeviceUserEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(DEVICE_EMAIL_SUFFIX);
}

/**
 * Compte produit (Google / Apple / email), pas le device-user technique.
 * Lit la session **locale** (`getSession`) — jamais `getUser()` (réseau) sur un chemin UI.
 */
export async function getRealAuthUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (error || !user) {
    rememberRealAuthUser(null);
    return null;
  }
  if (isDeviceUserEmail(user.email)) {
    rememberRealAuthUser(null);
    return null;
  }
  rememberRealAuthUser(user);
  return user;
}

export async function hasRealAuthAccount(): Promise<boolean> {
  return (await getRealAuthUser()) != null;
}

export function tierFromUserAppMetadata(user: User | null | undefined): UserTier {
  const raw = user?.app_metadata?.subscriptionTier;
  return raw === 'paid' ? 'paid' : 'free';
}

/** Applique le cache UX tier depuis `app_metadata` (source de vérité serveur). */
export async function syncUserTierFromSessionUser(user: User | null | undefined): Promise<UserTier> {
  const tier = tierFromUserAppMetadata(user);
  await setUserTier(tier);
  try {
    const { syncBillingIssueFromUser } = await import('@/lib/billingIssue');
    await syncBillingIssueFromUser(user);
  } catch (e) {
    console.warn('[auth] syncBillingIssueFromUser', e);
  }
  try {
    const { syncCaptureLockedFromUser } = await import('@/lib/captureLock');
    await syncCaptureLockedFromUser(user);
    const { invalidateMemoryLimitCache } = await import('@/lib/limits');
    invalidateMemoryLimitCache();
  } catch (e) {
    console.warn('[auth] syncCaptureLockedFromUser', e);
  }
  // V1 : archives downgrade legacy → visibles (plus d’archivage à l’expiration).
  try {
    const { restoreLocalDowngradeArchivedMemories } = await import('@/services/memoryArchiveLocal');
    restoreLocalDowngradeArchivedMemories();
  } catch (e) {
    console.warn('[auth] restoreLocalDowngradeArchivedMemories', e);
  }
  return tier;
}

/**
 * Marque immédiatement la session produit en mémoire (UI / peekLastRealAuthUserId)
 * puis lance la sync en fond — **ne jamais await** depuis un chemin login/signup.
 */
export function scheduleCloudSyncAfterRealAuth(user: User): void {
  if (isDeviceUserEmail(user.email)) return;
  rememberRealAuthUser(user);
  // Mémoire sync tout de suite (AsyncStorage en fond) — finishAfterAuth lit peek*.
  void setLastRealAuthUserId(user.id);
  void activateCloudSyncAfterRealAuth(user).catch(e =>
    console.warn('[auth] activateCloudSyncAfterRealAuth', e),
  );
}

/**
 * Après auth produit réussie : isole l’espace local au compte, active sync,
 * claim orphelins seulement, flush en arrière-plan — sans bloquer l’UI.
 */
export async function activateCloudSyncAfterRealAuth(user: User): Promise<void> {
  if (isDeviceUserEmail(user.email)) return;

  rememberRealAuthUser(user);
  // Idempotent si déjà posé par scheduleCloudSyncAfterRealAuth.
  void setLastRealAuthUserId(user.id);

  try {
    await prepareLocalWorkspaceForRealUser(user.id);
  } catch (e) {
    console.warn('[auth] prepareLocalWorkspaceForRealUser', e);
  }

  try {
    await setCloudAccountKind('real');
  } catch (e) {
    console.warn('[auth] setCloudAccountKind', e);
  }
  try {
    await syncUserTierFromSessionUser(user);
  } catch (e) {
    console.warn('[auth] syncUserTierFromSessionUser', e);
  }

  // RevenueCat / claim / flush : fond uniquement — ne jamais bloquer l’UI (timeouts RC fréquents).
  void import('@/lib/revenueCat')
    .then(m => m.logInRevenueCat(user.id))
    .catch(e => console.warn('[auth] logInRevenueCat', e));

  void import('@/services/touchAccountActivity').then(m => m.touchAccountActivityInBackground());

  void claimLocalDataForCloudUser(user.id).catch(e =>
    console.warn('[auth] claimLocalDataForCloudUser', e),
  );

  void import('@/services/pendingCloudFlush')
    .then(m => m.flushPendingCloudUploadsOnce())
    .catch(e => console.warn('[auth] flushPendingCloudUploadsOnce', e));

  // Livres + commandes : restore cloud en fond après login (pas seulement au cold start).
  void (async () => {
    try {
      const {
        flushPendingBookDeletesToSupabase,
        restoreBooksFromSupabaseIfPremium,
        backupBooksToSupabaseIfPremium,
        pruneOrphanEmptyBookDuplicates,
      } = await import('@/services/books');
      const { hydrateTabScreensFromSqliteSync } = await import('@/services/tabScreensHydrate');
      await flushPendingBookDeletesToSupabase();
      await restoreBooksFromSupabaseIfPremium();
      if (pruneOrphanEmptyBookDuplicates() > 0) {
        hydrateTabScreensFromSqliteSync();
      }
      await backupBooksToSupabaseIfPremium();
      hydrateTabScreensFromSqliteSync();
    } catch (e) {
      console.warn('[auth] restoreBooksAfterRealAuth', e);
    }
  })();

  void (async () => {
    try {
      const { fetchPrintOrdersForAccount } = await import('@/services/printOrders');
      await fetchPrintOrdersForAccount();
    } catch (e) {
      console.warn('[auth] fetchPrintOrdersAfterRealAuth', e);
    }
  })();
}

/**
 * Au boot : aligne `cloudAccountKind` sur la session (vrai compte vs device-user).
 * Ne flush pas ici — `_layout` le fait déjà si mode cloud.
 */
export async function syncCloudAccountKindFromSession(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user || isDeviceUserEmail(user.email)) {
    rememberRealAuthUser(null);
    await setCloudAccountKind('none');
    return;
  }

  rememberRealAuthUser(user);

  try {
    await prepareLocalWorkspaceForRealUser(user.id);
  } catch (e) {
    console.warn('[auth] prepareLocalWorkspaceForRealUser (boot)', e);
  }

  await setCloudAccountKind('real');
  await syncUserTierFromSessionUser(user);
  try {
    await claimLocalDataForCloudUser(user.id);
  } catch (e) {
    console.warn('[auth] claimLocalDataForCloudUser (boot)', e);
  }
}

/**
 * Quitte une éventuelle session device-user avant un vrai login/signup,
 * pour ne pas coller le nouveau compte à l’ancien user technique.
 *
 * **scope: 'local' uniquement** — `signOut()` global (défaut) appelle le serveur Auth
 * et peut rester pendu → spinner infini après MDP / Apple / Google.
 */
export async function clearDeviceUserSessionIfNeeded(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const email = data.session?.user?.email;
    if (!isDeviceUserEmail(email)) return;

    const localSignOut = supabase.auth.signOut({ scope: 'local' });
    await Promise.race([
      localSignOut,
      new Promise<void>(resolve => setTimeout(resolve, 1500)),
    ]);
  } catch (e) {
    console.warn('[auth] clearDeviceUserSessionIfNeeded', e);
  }
}

function mapAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) {
    return 'E-mail ou mot de passe incorrect.';
  }
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'Un compte existe déjà avec cet e-mail. Connecte-toi ou réinitialise ton mot de passe.';
  }
  if (m.includes('password should be at least') || m.includes('password')) {
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  }
  if (m.includes('email')) {
    return message;
  }
  return message;
}

export async function signUpWithEmailPassword(
  email: string,
  password: string
): Promise<AuthAccountResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !password) {
    return { ok: false, error: 'E-mail et mot de passe requis.' };
  }
  if (password.length < 8) {
    return { ok: false, error: 'Le mot de passe doit contenir au moins 8 caractères.' };
  }

  await clearDeviceUserSessionIfNeeded();

  const { data, error } = await supabase.auth.signUp({
    email: trimmed,
    password,
  });

  if (error) {
    const already =
      error.message.toLowerCase().includes('user already registered') ||
      error.message.toLowerCase().includes('already been registered');
    return {
      ok: false,
      error: mapAuthError(error.message),
      alreadyRegistered: already || undefined,
    };
  }
  if (!data.user) {
    return { ok: false, error: 'Création de compte impossible pour le moment.' };
  }

  /**
   * Compte déjà existant (confirmé) : Supabase renvoie souvent un user « fantôme »
   * sans session et sans identities, pour éviter l’énumération d’e-mails.
   * → tenter une connexion avec le même mot de passe (parcours « Commencer »).
   */
  const identities = data.user.identities ?? [];
  if (!data.session && identities.length === 0) {
    const signedIn = await signInWithEmailPassword(trimmed, password);
    if (signedIn.ok) {
      return { ...signedIn, reconnectedExisting: true };
    }
    return {
      ok: false,
      error:
        'Un compte existe déjà avec cet e-mail. Vérifie ton mot de passe, ou utilise « J’ai déjà un compte ».',
      alreadyRegistered: true,
    };
  }

  const needsEmailConfirmation = !data.session;
  if (data.session?.user) {
    scheduleCloudSyncAfterRealAuth(data.session.user);
  }

  return {
    ok: true,
    user: data.user,
    session: data.session,
    needsEmailConfirmation,
  };
}

/**
 * Vérifie le code e-mail 6 chiffres après `signUp` (confirmation in-app).
 * Prérequis dashboard : template « Confirm signup » avec `{{ .Token }}`.
 */
export async function verifySignupEmailOtp(
  email: string,
  token: string,
): Promise<AuthAccountResult> {
  const trimmed = email.trim().toLowerCase();
  const code = token.replace(/\s+/g, '').trim();
  if (!trimmed || !code) {
    return { ok: false, error: 'E-mail et code requis.' };
  }
  if (!/^\d{6}$/.test(code)) {
    return { ok: false, error: 'Le code doit contenir 6 chiffres.' };
  }

  await clearDeviceUserSessionIfNeeded();

  const { data, error } = await supabase.auth.verifyOtp({
    email: trimmed,
    token: code,
    type: 'signup',
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('expired') || msg.includes('otp_expired')) {
      return { ok: false, error: 'Code expiré. Demande un nouveau code.' };
    }
    if (msg.includes('invalid') || msg.includes('token')) {
      return { ok: false, error: 'Code incorrect. Vérifie-le ou renvoie un nouveau code.' };
    }
    return { ok: false, error: mapAuthError(error.message) };
  }
  if (!data.user || !data.session) {
    return { ok: false, error: 'Vérification impossible pour le moment.' };
  }

  scheduleCloudSyncAfterRealAuth(data.user);
  return { ok: true, user: data.user, session: data.session };
}

/** Renvoie l’e-mail de confirmation (nouveau code 6 chiffres). */
export async function resendSignupEmailOtp(
  email: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, error: 'Indique ton adresse e-mail.' };
  }

  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: trimmed,
  });
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('security') || msg.includes('60') || msg.includes('rate')) {
      return { ok: false, error: 'Patiente quelques secondes avant de renvoyer un code.' };
    }
    return { ok: false, error: mapAuthError(error.message) };
  }
  return { ok: true };
}

export async function signInWithEmailPassword(
  email: string,
  password: string
): Promise<AuthAccountResult> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !password) {
    return { ok: false, error: 'E-mail et mot de passe requis.' };
  }

  await clearDeviceUserSessionIfNeeded();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: trimmed,
    password,
  });

  if (error) {
    return { ok: false, error: mapAuthError(error.message) };
  }
  if (!data.user) {
    return { ok: false, error: 'Connexion impossible pour le moment.' };
  }

  scheduleCloudSyncAfterRealAuth(data.user);
  return { ok: true, user: data.user, session: data.session };
}

export async function requestPasswordReset(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, error: 'Indique ton adresse e-mail.' };
  }

  const redirectTo = getPasswordResetRedirectUrl();
  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, { redirectTo });
  if (error) {
    return { ok: false, error: mapAuthError(error.message) };
  }
  return { ok: true };
}

/** Tokens + `type` / `code` (PKCE) / `token_hash` depuis un deep link `petitmo://auth#…` ou `?…`. */
export function parseAuthCallbackParams(url: string): {
  access_token: string | null;
  refresh_token: string | null;
  type: string | null;
  code: string | null;
  token_hash: string | null;
} {
  try {
    // Expo Router / iOS peuvent déjà avoir converti `#` → `?` ; on parse les deux.
    const normalized = url.includes('#') && !url.includes('?')
      ? url.replace('#', '?')
      : url.includes('#') && url.includes('?')
        ? url.replace('#', '&')
        : url;
    const parsed = new URL(normalized);
    const query = new URLSearchParams(parsed.search.replace(/^\?/, ''));
    const hash = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    const pick = (key: string) => query.get(key) ?? hash.get(key);
    return {
      access_token: pick('access_token'),
      refresh_token: pick('refresh_token'),
      type: pick('type'),
      code: pick('code'),
      token_hash: pick('token_hash'),
    };
  } catch {
    return {
      access_token: null,
      refresh_token: null,
      type: null,
      code: null,
      token_hash: null,
    };
  }
}

export function isPasswordRecoveryCallback(url: string): boolean {
  const { type, code, token_hash } = parseAuthCallbackParams(url);
  if (type === 'recovery') return true;
  // Lien reset PKCE : souvent `petitmo://auth?code=…` sans `type` explicite.
  if (code && /(?:^|[/?#])auth(?:[/?#]|$)/i.test(url) && !type) return true;
  return Boolean(token_hash && /(?:^|[/?#])auth(?:[/?#]|$)/i.test(url));
}

/**
 * Installe la session depuis un callback deep link (recovery ou OAuth).
 * Pour `type=recovery`, n’active pas encore la sync cloud — attendre `updatePasswordAfterRecovery`.
 */
export async function completeAuthCallbackFromUrl(
  url: string,
): Promise<
  | { ok: true; passwordRecovery: boolean; user: User; session: Session | null }
  | { ok: false; error: string }
> {
  const { access_token, refresh_token, type, code, token_hash } = parseAuthCallbackParams(url);

  await clearDeviceUserSessionIfNeeded();

  // PKCE (défaut supabase-js v2) : e-mail → ?code=…
  if (code && !access_token) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user) {
      return {
        ok: false,
        error: error ? mapAuthError(error.message) : 'Session impossible.',
      };
    }
    const passwordRecovery = type === 'recovery' || isPasswordRecoveryCallback(url);
    if (passwordRecovery) {
      rememberRealAuthUser(data.user);
      await syncUserTierFromSessionUser(data.user);
    } else {
      scheduleCloudSyncAfterRealAuth(data.user);
    }
    return {
      ok: true,
      passwordRecovery,
      user: data.user,
      session: data.session,
    };
  }

  // Template e-mail avec `{{ .TokenHash }}` → deep link sans passage Safari verify.
  if (token_hash && !access_token) {
    const otpType =
      type === 'signup' || type === 'magiclink' || type === 'email'
        ? type
        : 'recovery';
    const { data, error } = await supabase.auth.verifyOtp({
      type: otpType,
      token_hash,
    });
    if (error || !data.user) {
      return {
        ok: false,
        error: error ? mapAuthError(error.message) : 'Session impossible.',
      };
    }
    const passwordRecovery = otpType === 'recovery' || type === 'recovery';
    if (passwordRecovery) {
      rememberRealAuthUser(data.user);
      await syncUserTierFromSessionUser(data.user);
    } else {
      scheduleCloudSyncAfterRealAuth(data.user);
    }
    return {
      ok: true,
      passwordRecovery,
      user: data.user,
      session: data.session,
    };
  }

  if (!access_token || !refresh_token) {
    return {
      ok: false,
      error:
        'Lien incomplet ou expiré. Redemande un e-mail depuis l’app (ignore les anciens liens).',
    };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });

  if (error || !data.user) {
    return {
      ok: false,
      error: error ? mapAuthError(error.message) : 'Session impossible.',
    };
  }

  const passwordRecovery = type === 'recovery';
  if (passwordRecovery) {
    rememberRealAuthUser(data.user);
    await syncUserTierFromSessionUser(data.user);
  } else {
    scheduleCloudSyncAfterRealAuth(data.user);
  }

  return {
    ok: true,
    passwordRecovery,
    user: data.user,
    session: data.session,
  };
}

/** Après deep link recovery : définit le nouveau mot de passe puis active la sync. */
export async function updatePasswordAfterRecovery(
  password: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!password) {
    return { ok: false, error: 'Mot de passe requis.' };
  }
  if (password.length < 8) {
    return { ok: false, error: 'Le mot de passe doit contenir au moins 8 caractères.' };
  }

  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { ok: false, error: mapAuthError(error.message) };
  }
  if (!data.user || isDeviceUserEmail(data.user.email)) {
    return { ok: false, error: 'Session de récupération invalide. Redemande un e-mail.' };
  }

  scheduleCloudSyncAfterRealAuth(data.user);
  return { ok: true };
}

/** true seulement si le binaire natif inclut expo-apple-authentication. */
export async function isAppleSignInNativeAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    const AppleAuthentication = await import('expo-apple-authentication');
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Sign in with Apple — nécessite un rebuild natif (`expo-apple-authentication`).
 * Import dynamique pour ne pas planter Metro sur un ancien build (email / Google OK).
 *
 * Pas de nonce client : doc Supabase Expo officielle (sinon erreur
 * « Passed nonce and nonce in id_token should either both exist or not »
 * / mismatch hex vs base64url côté GoTrue).
 */
export async function signInWithAppleNative(): Promise<AuthAccountResult> {
  if (Platform.OS !== 'ios') {
    return { ok: false, error: 'Continuer avec Apple est disponible sur iPhone.' };
  }

  let AppleAuthentication: typeof import('expo-apple-authentication');
  try {
    AppleAuthentication = await import('expo-apple-authentication');
  } catch {
    return {
      ok: false,
      error:
        'Apple Sign-In nécessite un nouveau build natif (modules manquants). Utilise Google ou e-mail pour l’instant.',
    };
  }

  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    return { ok: false, error: 'Sign in with Apple n’est pas disponible sur cet appareil.' };
  }

  await clearDeviceUserSessionIfNeeded();

  let credential: Awaited<ReturnType<typeof AppleAuthentication.signInAsync>>;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (e: unknown) {
    const code = typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
    if (code === 'ERR_REQUEST_CANCELED') {
      return { ok: false, error: 'Connexion Apple annulée.' };
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Connexion Apple impossible.',
    };
  }

  if (!credential.identityToken) {
    return { ok: false, error: 'Jeton Apple manquant.' };
  }

  const { data, error } = await supabase.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });

  if (error) {
    return { ok: false, error: mapAuthError(error.message) };
  }
  if (!data.user) {
    return { ok: false, error: 'Connexion Apple impossible.' };
  }

  // Apple ne renvoie le nom qu’au premier consentement — le garder en metadata (fond).
  if (credential.fullName) {
    const parts = [
      credential.fullName.givenName,
      credential.fullName.middleName,
      credential.fullName.familyName,
    ].filter((p): p is string => Boolean(p && p.trim()));
    if (parts.length > 0) {
      void supabase.auth
        .updateUser({
          data: {
            full_name: parts.join(' '),
            given_name: credential.fullName.givenName ?? undefined,
            family_name: credential.fullName.familyName ?? undefined,
          },
        })
        .catch(e => console.warn('[auth] apple updateUser name', e));
    }
  }

  scheduleCloudSyncAfterRealAuth(data.user);
  return { ok: true, user: data.user, session: data.session };
}

/**
 * OAuth Google : natif d’abord (pas de popup « supabase.co »), sinon repli navigateur.
 * Natif = rebuild avec `@react-native-google-signin/google-signin` + env Client IDs.
 */
export async function signInWithGoogleOAuth(): Promise<AuthAccountResult> {
  const native = await signInWithGoogleNative();
  if (native) return native;
  return signInWithGoogleWebOAuth();
}

async function signInWithGoogleNative(): Promise<AuthAccountResult | null> {
  const webClientId = getGoogleWebClientId();
  const iosClientId = getGoogleIosClientId();
  if (!webClientId) {
    return null;
  }

  let GoogleSignin: typeof import('@react-native-google-signin/google-signin').GoogleSignin;
  try {
    ({ GoogleSignin } = await import('@react-native-google-signin/google-signin'));
  } catch {
    return null;
  }

  try {
    GoogleSignin.configure({
      webClientId,
      ...(Platform.OS === 'ios' && iosClientId ? { iosClientId } : {}),
    });

    if (Platform.OS === 'android') {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    }

    await clearDeviceUserSessionIfNeeded();

    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') {
      return { ok: false, error: 'Connexion Google annulée.' };
    }

    let idToken = response.data.idToken;
    if (!idToken) {
      const tokens = await GoogleSignin.getTokens();
      idToken = tokens.idToken;
    }
    if (!idToken) {
      return { ok: false, error: 'Jeton Google manquant. Vérifie webClientId (client Web) dans la config.' };
    }

    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });

    if (error) {
      return { ok: false, error: mapAuthError(error.message) };
    }
    if (!data.user) {
      return { ok: false, error: 'Connexion Google impossible.' };
    }

    scheduleCloudSyncAfterRealAuth(data.user);
    return { ok: true, user: data.user, session: data.session };
  } catch (e: unknown) {
    const code =
      typeof e === 'object' && e && 'code' in e ? String((e as { code: string }).code) : '';
    if (code === 'SIGN_IN_CANCELLED' || code === 'ERR_REQUEST_CANCELED') {
      return { ok: false, error: 'Connexion Google annulée.' };
    }
    // Module natif absent / pas encore rebuild → repli web
    const msg = e instanceof Error ? e.message : String(e);
    if (/native module|ExpoGoogleSignin|RNGoogleSignin|Cannot find/i.test(msg)) {
      return null;
    }
    return { ok: false, error: mapAuthError(msg) };
  }
}

async function signInWithGoogleWebOAuth(): Promise<AuthAccountResult> {
  await clearDeviceUserSessionIfNeeded();

  const redirectTo = Linking.createURL('auth');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) {
    return { ok: false, error: mapAuthError(error.message) };
  }
  if (!data.url) {
    return { ok: false, error: 'URL Google manquante. Vérifie la config Supabase OAuth.' };
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success' || !('url' in result) || !result.url) {
    return { ok: false, error: 'Connexion Google annulée.' };
  }

  const url = new URL(result.url);
  const params = new URLSearchParams(url.hash.replace(/^#/, '') || url.search.replace(/^\?/, ''));
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');

  if (!access_token || !refresh_token) {
    return {
      ok: false,
      error:
        'Retour Google incomplet. Vérifie les URL de redirection Supabase (scheme petitmo://auth).',
    };
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
    access_token,
    refresh_token,
  });

  if (sessionError || !sessionData.user) {
    return {
      ok: false,
      error: sessionError ? mapAuthError(sessionError.message) : 'Session Google impossible.',
    };
  }

  scheduleCloudSyncAfterRealAuth(sessionData.user);
  return { ok: true, user: sessionData.user, session: sessionData.session };
}

export async function signOutRealAccount(): Promise<void> {
  try {
    const { logOutRevenueCat } = await import('@/lib/revenueCat');
    void logOutRevenueCat();
  } catch (e) {
    console.warn('[auth] logOutRevenueCat', e);
  }
  // Local d’abord (fiable hors-ligne) ; global en fond pour invalider refresh token serveur.
  try {
    await Promise.race([
      supabase.auth.signOut({ scope: 'local' }),
      new Promise<void>(resolve => setTimeout(resolve, 1500)),
    ]);
  } catch (e) {
    console.warn('[auth] signOut local', e);
  }
  void supabase.auth.signOut({ scope: 'global' }).catch(() => {});
  rememberRealAuthUser(null);
  try {
    const { setCaptureLockedLocal } = await import('@/lib/captureLock');
    await setCaptureLockedLocal(false);
  } catch {
    /* */
  }
  try {
    const { setBillingIssueLocal } = await import('@/lib/billingIssue');
    await setBillingIssueLocal(false);
  } catch {
    /* */
  }
  await Promise.all([
    setCloudAccountKind('none'),
    setUserTier('free'),
    clearSelectedChildAndCaptureSnapshot(),
  ]);
  // Device-user technique en arrière-plan — ne bloque pas le retour onboarding / auth.
  void ensureSupabaseSession();
}

/**
 * Suppression définitive du compte Auth (Edge Function) + purge locale.
 * Règle d’or V2 / Apple : P0 in-app.
 */
export async function deleteRealAccount(): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getRealAuthUser();
  if (!user) {
    return { ok: false, error: 'Aucun compte à supprimer.' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    return { ok: false, error: 'Session expirée. Reconnecte-toi puis réessaie.' };
  }

  const { data, error } = await supabase.functions.invoke('delete-account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: { mode: 'voluntary' },
  });

  if (error) {
    console.warn('[auth] delete-account', error);
    return {
      ok: false,
      error: 'Impossible de supprimer le compte pour le moment. Réessaie ou écris à support@petitcoeur.app.',
    };
  }
  if (data && typeof data === 'object' && 'error' in data && data.error) {
    return {
      ok: false,
      error: typeof data.error === 'string' ? data.error : 'Suppression impossible.',
    };
  }

  try {
    const { clearLocalAccountWorkspace, setLastRealAuthUserId } = await import(
      '@/services/accountLocalReset'
    );
    const { clearOnboardingPermissionsSeen } = await import('@/lib/onboardingPermissionsSeen');
    const { clearMediaLibraryOptIn } = await import('@/lib/mediaLibraryOptIn');
    const { clearLocationSoftPromptSeen } = await import('@/lib/memoryLocation');
    await clearLocalAccountWorkspace('delete-account');
    await clearOnboardingPermissionsSeen(user.id);
    await clearMediaLibraryOptIn(user.id);
    await clearLocationSoftPromptSeen(user.id);
    await setLastRealAuthUserId(null);
  } catch (e) {
    console.warn('[auth] clearLocalAccountWorkspace after delete', e);
  }

  rememberRealAuthUser(null);
  try {
    const { logOutRevenueCat } = await import('@/lib/revenueCat');
    await logOutRevenueCat();
  } catch (e) {
    console.warn('[auth] logOutRevenueCat after delete', e);
  }
  try {
    await Promise.race([
      supabase.auth.signOut({ scope: 'local' }),
      new Promise<void>(resolve => setTimeout(resolve, 1500)),
    ]);
  } catch (e) {
    console.warn('[auth] signOut after delete', e);
  }
  void supabase.auth.signOut({ scope: 'global' }).catch(() => {});
  await Promise.all([
    setCloudAccountKind('none'),
    setUserTier('free'),
    clearSelectedChildAndCaptureSnapshot(),
  ]);
  void ensureSupabaseSession();
  return { ok: true };
}
