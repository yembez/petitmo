/**
 * Touch activité compte (fond, local-first).
 * Throttle client 12 h + serveur 12 h.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, supabaseAnonKey, supabaseUrl } from '@/lib/supabase';
import { isDeviceUserEmail } from '@/lib/authAccount';

const LOCAL_TOUCH_KEY = 'petitmo:lastActivityTouchAt';
const CLIENT_THROTTLE_MS = 12 * 60 * 60 * 1000;

function touchUrl(): string | null {
  const base = (supabaseUrl ?? '').replace(/\/$/, '');
  if (!base) return null;
  return `${base}/functions/v1/touch-activity`;
}

/** À appeler en fond (AppState active) — jamais bloquer l’UI. */
export async function touchAccountActivityInBackground(): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user?.id || isDeviceUserEmail(user.email)) return;

    const now = Date.now();
    try {
      const raw = await AsyncStorage.getItem(LOCAL_TOUCH_KEY);
      const prev = raw ? Number(raw) : 0;
      if (Number.isFinite(prev) && now - prev < CLIENT_THROTTLE_MS) return;
    } catch {
      /* */
    }

    const url = touchUrl();
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
    if (res.ok) {
      try {
        await AsyncStorage.setItem(LOCAL_TOUCH_KEY, String(now));
      } catch {
        /* */
      }
    }
  } catch (e) {
    if (__DEV__) console.warn('[touchAccountActivity]', e);
  }
}
