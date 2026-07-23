import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { setUserTier, type UserTier } from '@/lib/userTier';
import { getGoogleIosClientId, getGoogleWebClientId } from '@/lib/googleAuthConfig';

WebBrowser.maybeCompleteAuthSession();

const DEVICE_EMAIL_SUFFIX = '@petitmo.local';

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
  if (error || !data.user) return null;
  if (isDeviceUserEmail(data.user.email)) return null;
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
    return 'Le mot de passe doit contenir au moins 6 caractères.';
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
  if (password.length < 6) {
    return { ok: false, error: 'Le mot de passe doit contenir au moins 6 caractères.' };
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
    await syncUserTierFromSessionUser(data.session.user);
  }

  return {
    ok: true,
    user: data.user,
    session: data.session,
    needsEmailConfirmation,
  };
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

  await syncUserTierFromSessionUser(data.user);
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

  await syncUserTierFromSessionUser(data.user);
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

    await syncUserTierFromSessionUser(data.user);
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

  await syncUserTierFromSessionUser(sessionData.user);
  return { ok: true, user: sessionData.user, session: sessionData.session };
}

export async function signOutRealAccount(): Promise<void> {
  await supabase.auth.signOut();
  await setUserTier('free');
}
