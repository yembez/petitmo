/**
 * Préférences notifications (rappel capture).
 * Local-first : cache AsyncStorage pour l’UI ; sync cloud en fond.
 * Low Friction : timezone détectée en silence ; rappel OFF par défaut (App Store).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { peekLastRealAuthUserId } from '@/services/accountLocalReset';

const CACHE_KEY = 'petitmo:notificationPrefs';

export type NotificationPrefs = {
  captureReminderEnabled: boolean;
  captureReminderLocalTime: string; // HH:mm
  timezone: string;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  captureReminderEnabled: false,
  captureReminderLocalTime: '20:00',
  timezone: 'Europe/Paris',
};

/** Valide HH:mm (00:00–23:59), y compris minuit. */
export function parseCaptureReminderTime(raw: string | null | undefined): string | null {
  const t = (raw ?? '').trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function detectDeviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
    if (tz && tz.length >= 3) return tz;
  } catch {
    /* ignore */
  }
  return 'Europe/Paris';
}

function normalizeTime(raw: string | null | undefined): string {
  return parseCaptureReminderTime(raw) ?? DEFAULT_NOTIFICATION_PREFS.captureReminderLocalTime;
}

export async function peekCachedNotificationPrefs(): Promise<NotificationPrefs> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) {
      return { ...DEFAULT_NOTIFICATION_PREFS, timezone: detectDeviceTimezone() };
    }
    const parsed = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      captureReminderEnabled: !!parsed.captureReminderEnabled,
      captureReminderLocalTime: normalizeTime(parsed.captureReminderLocalTime),
      timezone: (parsed.timezone ?? '').trim() || detectDeviceTimezone(),
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS, timezone: detectDeviceTimezone() };
  }
}

async function writeCache(prefs: NotificationPrefs): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(prefs));
  } catch {
    /* cache UX */
  }
}

function rowToPrefs(row: {
  capture_reminder_enabled?: boolean | null;
  capture_reminder_local_time?: string | null;
  timezone?: string | null;
}): NotificationPrefs {
  return {
    captureReminderEnabled: !!row.capture_reminder_enabled,
    captureReminderLocalTime: normalizeTime(row.capture_reminder_local_time),
    timezone: (row.timezone ?? '').trim() || detectDeviceTimezone(),
  };
}

/**
 * Charge prefs (cache puis cloud). Met à jour la timezone appareil en silence si besoin.
 */
export async function loadNotificationPrefs(): Promise<NotificationPrefs> {
  const cached = await peekCachedNotificationPrefs();
  const userId = peekLastRealAuthUserId();
  if (!userId) return cached;

  const deviceTz = detectDeviceTimezone();

  try {
    const { data, error } = await supabase
      .from('notification_prefs')
      .select('capture_reminder_enabled, capture_reminder_local_time, timezone')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.warn('[notificationPrefs] load', error.message);
      return cached;
    }

    if (!data) {
      const seed: NotificationPrefs = {
        ...DEFAULT_NOTIFICATION_PREFS,
        timezone: deviceTz,
      };
      await writeCache(seed);
      void supabase.from('notification_prefs').upsert({
        user_id: userId,
        capture_reminder_enabled: false,
        capture_reminder_local_time: seed.captureReminderLocalTime,
        timezone: deviceTz,
        updated_at: new Date().toISOString(),
      });
      return seed;
    }

    let prefs = rowToPrefs(data);
    if (prefs.timezone !== deviceTz) {
      prefs = { ...prefs, timezone: deviceTz };
      void supabase
        .from('notification_prefs')
        .update({ timezone: deviceTz, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
    }
    await writeCache(prefs);
    return prefs;
  } catch (e) {
    console.warn('[notificationPrefs] load', e);
    return cached;
  }
}

export async function saveNotificationPrefs(
  patch: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  const prev = await peekCachedNotificationPrefs();
  const next: NotificationPrefs = {
    captureReminderEnabled:
      patch.captureReminderEnabled ?? prev.captureReminderEnabled,
    captureReminderLocalTime: normalizeTime(
      patch.captureReminderLocalTime ?? prev.captureReminderLocalTime,
    ),
    timezone: (patch.timezone ?? prev.timezone ?? detectDeviceTimezone()).trim() || detectDeviceTimezone(),
  };
  await writeCache(next);

  const userId = peekLastRealAuthUserId();
  if (!userId) return next;

  const { error } = await supabase.from('notification_prefs').upsert(
    {
      user_id: userId,
      capture_reminder_enabled: next.captureReminderEnabled,
      capture_reminder_local_time: next.captureReminderLocalTime,
      timezone: next.timezone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );
  if (error) {
    console.warn('[notificationPrefs] save', error.message);
  }
  return next;
}

/** Sync timezone seule (appel silencieux au register push / focus). */
export async function syncNotificationTimezoneInBackground(): Promise<void> {
  const userId = peekLastRealAuthUserId();
  if (!userId) return;
  const tz = detectDeviceTimezone();
  const cached = await peekCachedNotificationPrefs();
  if (cached.timezone === tz) return;
  await saveNotificationPrefs({ timezone: tz });
}
