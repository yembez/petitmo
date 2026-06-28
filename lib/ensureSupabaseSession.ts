import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';

export type EnsureSupabaseSessionResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; error: string };

const DEVICE_ID_KEY = '@petitmo_device_id';

/**
 * Garantit une session Supabase (device-user technique en gratuit, compte réel après login Petitmo+).
 * Idempotent : réutilise la session persistée si elle existe.
 */
export async function ensureSupabaseSession(): Promise<EnsureSupabaseSessionResult> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      ok: false,
      error:
        'Supabase non configuré (EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY manquants).',
    };
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.id) {
      return {
        ok: true,
        userId: session.user.id,
        email: session.user.email ?? '',
      };
    }

    let deviceId = await AsyncStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = `device_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      await AsyncStorage.setItem(DEVICE_ID_KEY, deviceId);
    }

    const apiUrl = `${supabaseUrl}/functions/v1/create-device-user`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseAnonKey}`,
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({ deviceId }),
    });

    const result: { error?: string } = await response.json().catch(() => ({}));

    if (!response.ok) {
      const detail =
        typeof result?.error === 'string' ? result.error : `HTTP ${response.status}`;
      return {
        ok: false,
        error: `Edge function create-device-user : ${detail}`,
      };
    }

    const email = `${deviceId}@petitmo.local`;
    const password = deviceId;

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      return { ok: false, error: `Connexion device-user : ${signInError.message}` };
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.id) {
      return { ok: false, error: 'Session absente après connexion device-user.' };
    }

    return { ok: true, userId: user.id, email: user.email ?? email };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
