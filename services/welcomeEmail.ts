/**
 * E-mail bienvenue compte gratuit — fire-and-forget après auth réelle.
 * Edge `send-welcome-email` : dédupe SQL + fenêtre created_at 72 h.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';
import { isDeviceUserEmail } from '@/lib/authAccount';

const LOCAL_FLAG_PREFIX = 'petitmo:welcomeEmailDone:';

function welcomeUrl(): string | null {
  const base = (supabaseUrl ?? '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/functions/v1/send-welcome-email`;
}

/** À appeler en fond après login / signup — jamais bloquer l’UI. */
export async function scheduleWelcomeEmailInBackground(): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user?.id || isDeviceUserEmail(user.email)) return;

    const localKey = `${LOCAL_FLAG_PREFIX}${user.id}`;
    try {
      const done = await AsyncStorage.getItem(localKey);
      if (done === '1') return;
    } catch {
      /* */
    }

    const createdAtMs = Date.parse(user.created_at ?? '');
    if (Number.isFinite(createdAtMs) && Date.now() - createdAtMs > 72 * 60 * 60 * 1000) {
      try {
        await AsyncStorage.setItem(localKey, '1');
      } catch {
        /* */
      }
      return;
    }

    const url = welcomeUrl();
    const token = session.access_token?.trim();
    if (!url || !token || !supabaseAnonKey) return;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    if (!res.ok) {
      if (__DEV__) console.warn('[welcomeEmail] http', res.status);
      return;
    }

    // Marquer local même si skipped/deduped — évite de rejouer à chaque login.
    try {
      await AsyncStorage.setItem(localKey, '1');
    } catch {
      /* */
    }
  } catch (e) {
    if (__DEV__) console.warn('[welcomeEmail]', e);
  }
}
