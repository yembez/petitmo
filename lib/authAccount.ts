import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { setCloudAccountKind } from '@/lib/userMode';
import { setUserTier, type UserTier } from '@/lib/userTier';
import { getGoogleIosClientId, getGoogleWebClientId } from '@/lib/googleAuthConfig';
import { prepareLocalWorkspaceForRealUser } from '@/services/accountLocalReset';
import { claimLocalDataForCloudUser } from '@/services/claimLocalDataForCloud';
import { ensureSupabaseSession } from '@/lib/ensureSupabaseSession';
import { clearSelectedChildAndCaptureSnapshot } from '@/services/children';

WebBrowser.maybeCompleteAuthSession();

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
  | { ok: true; user: User; session: Session | null; needsEmailConfirmation?: boolean }
  | { ok: false; error: string };

export function isDeviceUserEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase().endsWith(DEVICE_EMAIL_SUFFIX);
}

/** Compte produit (Google / Apple / email), pas le device-user technique. */
export async function getRealAuthUser(): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    rememberRealAuthUser(null);
    return null;
  }
  if (isDeviceUserEmail(data.user.email)) {
    rememberRealAuthUser(null);
    return null;
  }
  rememberRealAuthUser(data.user);
  return data.user;
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
  return tier;
}

/**
 * Après auth produit réussie : isole l’espace local au compte, active sync,
 * claim orphelins seulement, flush en arrière-plan — sans bloquer l’UI.
 */
export async function activateCloudSyncAfterRealAuth(user: User): Promise<void> {
  if (isDeviceUserEmail(user.email)) return;

  rememberRealAuthUser(user);

  try {
    await prepareLocalWorkspaceForRealUser(user.id);
  } catch (e) {
    console.warn('[auth] prepareLocalWorkspaceForRealUser', e);
  }

  await setCloudAccountKind('real');
  await syncUserTierFromSessionUser(user);

  try {
    await claimLocalDataForCloudUser(user.id);
  } catch (e) {
    console.warn('[auth] claimLocalDataForCloudUser', e);
  }

  try {
    const { flushPendingCloudUploadsOnce } = await import('@/services/pendingCloudFlush');
    void flushPendingCloudUploadsOnce();
  } catch (e) {
    console.warn('[auth] flushPendingCloudUploadsOnce', e);
  }

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
 */
export async function clearDeviceUserSessionIfNeeded(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const email = data.session?.user?.email;
  if (isDeviceUserEmail(email)) {
    await supabase.auth.signOut();
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
    return { ok: false, error: mapAuthError(error.message) };
  }
  if (!data.user) {
    return { ok: false, error: 'Création de compte impossible pour le moment.' };
  }

  const needsEmailConfirmation = !data.session;
  if (data.session?.user) {
    await activateCloudSyncAfterRealAuth(data.session.user);
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

  await activateCloudSyncAfterRealAuth(data.user);
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

  await activateCloudSyncAfterRealAuth(data.user);
  return { ok: true, user: data.user, session: data.session };
}

export async function requestPasswordReset(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, error: 'Indique ton adresse e-mail.' };
  }

  const redirectTo = Linking.createURL('auth');
  const { error } = await supabase.auth.resetPasswordForEmail(trimmed, { redirectTo });
  if (error) {
    return { ok: false, error: mapAuthError(error.message) };
  }
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

  // Apple ne renvoie le nom qu’au premier consentement — le garder en metadata.
  if (credential.fullName) {
    const parts = [
      credential.fullName.givenName,
      credential.fullName.middleName,
      credential.fullName.familyName,
    ].filter((p): p is string => Boolean(p && p.trim()));
    if (parts.length > 0) {
      await supabase.auth.updateUser({
        data: {
          full_name: parts.join(' '),
          given_name: credential.fullName.givenName ?? undefined,
          family_name: credential.fullName.familyName ?? undefined,
        },
      });
    }
  }

  await activateCloudSyncAfterRealAuth(data.user);
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

    await activateCloudSyncAfterRealAuth(data.user);
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

  await activateCloudSyncAfterRealAuth(sessionData.user);
  return { ok: true, user: sessionData.user, session: sessionData.session };
}

export async function signOutRealAccount(): Promise<void> {
  await supabase.auth.signOut();
  rememberRealAuthUser(null);
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
  });

  if (error) {
    console.warn('[auth] delete-account', error);
    return {
      ok: false,
      error: 'Impossible de supprimer le compte pour le moment. Réessaie ou écris à contact@petitmo.app.',
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
    await clearLocalAccountWorkspace('delete-account');
    await clearOnboardingPermissionsSeen(user.id);
    await setLastRealAuthUserId(null);
  } catch (e) {
    console.warn('[auth] clearLocalAccountWorkspace after delete', e);
  }

  rememberRealAuthUser(null);
  try {
    await supabase.auth.signOut();
  } catch (e) {
    console.warn('[auth] signOut after delete', e);
  }
  await Promise.all([
    setCloudAccountKind('none'),
    setUserTier('free'),
    clearSelectedChildAndCaptureSnapshot(),
  ]);
  void ensureSupabaseSession();
  return { ok: true };
}
