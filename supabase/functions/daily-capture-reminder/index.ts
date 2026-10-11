/**
 * Cron rappel capture quotidien (opt-in).
 * Auth : Authorization Bearer PUSH_CRON_SECRET (ou INACTIVITY_CRON_SECRET).
 *
 * À brancher : pg_cron toutes les 15 min → POST …/daily-capture-reminder
 *
 * Copy V1 (FR) : « Un mot ? Un souvenir à garder aujourd'hui ? »
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { isExpoPushToken, sendExpoPushMessages } from '../_shared/expoPush.ts';

const KIND = 'capture_reminder';
const TITLE = 'Petit Cœur';
const BODY = "Un mot ? Un souvenir à garder aujourd'hui ?";

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cronSecret(): string {
  return (
    (Deno.env.get('PUSH_CRON_SECRET') ?? '').trim() ||
    (Deno.env.get('INACTIVITY_CRON_SECRET') ?? '').trim() ||
    (Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '').trim()
  );
}

/** HH:mm → minutes depuis minuit */
function hmToMinutes(hm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function floorToSlot(minutes: number, slotMin: number): number {
  return Math.floor(minutes / slotMin) * slotMin;
}

/** Heure / date locale IANA via Intl (Deno). */
function localParts(timeZone: string, now: Date): { hm: string; dayKey: string; minutes: number } | null {
  try {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = fmt.formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const day = get('day');
    const month = get('month');
    const year = get('year');
    const hour = get('hour');
    const minute = get('minute');
    if (!year || !month || !day || hour === '' || minute === '') return null;
    const hm = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
    const mins = hmToMinutes(hm);
    if (mins == null) return null;
    return { hm, dayKey: `${year}-${month}-${day}`, minutes: mins };
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  const secret = cronSecret();
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !serviceKey) {
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || token !== secret) return jsonRes({ error: 'Unauthorized' }, 401);

  let forceUserId: string | null = null;
  try {
    const body = (await req.json()) as { forceUserId?: string };
    if (typeof body.forceUserId === 'string' && body.forceUserId.length > 10) {
      forceUserId = body.forceUserId.trim();
    }
  } catch {
    /* body optionnel */
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  type PrefRow = {
    user_id: string;
    capture_reminder_local_time: string;
    timezone: string;
  };

  let prefs: PrefRow[] = [];

  if (forceUserId) {
    // Smoke : envoie même sans ligne prefs / sans opt-in (ignore l’heure).
    const { data, error: prefsErr } = await admin
      .from('notification_prefs')
      .select('user_id, capture_reminder_local_time, timezone')
      .eq('user_id', forceUserId)
      .maybeSingle();
    if (prefsErr) {
      console.error('[daily-capture-reminder] prefs', prefsErr.message);
      return jsonRes({ error: prefsErr.message }, 500);
    }
    prefs = [
      {
        user_id: forceUserId,
        capture_reminder_local_time: data?.capture_reminder_local_time || '20:00',
        timezone: data?.timezone || 'Europe/Paris',
      },
    ];
  } else {
    const { data, error: prefsErr } = await admin
      .from('notification_prefs')
      .select('user_id, capture_reminder_local_time, timezone')
      .eq('capture_reminder_enabled', true)
      .limit(2000);
    if (prefsErr) {
      console.error('[daily-capture-reminder] prefs', prefsErr.message);
      return jsonRes({ error: prefsErr.message }, 500);
    }
    prefs = (data ?? []) as PrefRow[];
  }

  const now = new Date();
  const dueUserIds: string[] = [];
  const dayKeyByUser = new Map<string, string>();
  let skippedAlreadySent = 0;

  for (const row of prefs) {
    const userId = String(row.user_id ?? '');
    const tz = String(row.timezone || 'Europe/Paris').trim() || 'Europe/Paris';
    const preferred = String(row.capture_reminder_local_time || '20:00').trim();
    const prefMins = hmToMinutes(preferred);
    if (!userId || prefMins == null) continue;

    const local = localParts(tz, now);
    if (!local) continue;

    // Fenêtre 15 min : cron */15 → un seul match par créneau.
    // forceUserId : toujours due (smoke).
    const due = forceUserId === userId ||
      floorToSlot(local.minutes, 15) === floorToSlot(prefMins, 15);

    if (!due) continue;

    // Anti-doublon : tenter insert avant envoi.
    // Smoke forceUserId : day_key unique (≤32) pour pouvoir retester le même jour.
    const dayKey = forceUserId === userId
      ? `f-${Date.now().toString(36)}`
      : local.dayKey;

    const { error: logErr } = await admin.from('push_send_log').insert({
      user_id: userId,
      kind: KIND,
      day_key: dayKey,
    });
    if (logErr) {
      if (logErr.code === '23505') {
        skippedAlreadySent += 1;
        continue;
      }
      console.warn('[daily-capture-reminder] log', userId.slice(0, 8), logErr.message);
      continue;
    }

    dueUserIds.push(userId);
    dayKeyByUser.set(userId, dayKey);
  }

  if (dueUserIds.length === 0) {
    return jsonRes({
      ok: true,
      matched: 0,
      sent: 0,
      skippedAlreadySent,
      reason: skippedAlreadySent > 0 ? 'already_sent_today' : 'no_match',
    }, 200);
  }

  const { data: tokenRows, error: tokErr } = await admin
    .from('push_tokens')
    .select('user_id, expo_push_token')
    .in('user_id', dueUserIds);
  if (tokErr) {
    console.error('[daily-capture-reminder] tokens', tokErr.message);
    return jsonRes({ error: tokErr.message }, 500);
  }

  const messages: { to: string; title: string; body: string; sound: 'default'; priority: 'high'; data: Record<string, unknown> }[] = [];
  const usersWithToken = new Set<string>();
  for (const row of tokenRows ?? []) {
    const t = String(row.expo_push_token ?? '').trim();
    const uid = String(row.user_id ?? '');
    if (!isExpoPushToken(t) || !uid) continue;
    usersWithToken.add(uid);
    messages.push({
      to: t,
      title: TITLE,
      body: BODY,
      sound: 'default',
      priority: 'high',
      data: { screen: '/(tabs)', kind: KIND },
    });
  }

  // Users sans token : retirer le log pour permettre un retry plus tard dans la journée.
  for (const uid of dueUserIds) {
    if (usersWithToken.has(uid)) continue;
    const dayKey = dayKeyByUser.get(uid);
    if (!dayKey) continue;
    await admin.from('push_send_log').delete().eq('user_id', uid).eq('kind', KIND).eq('day_key', dayKey);
  }

  if (messages.length === 0) {
    return jsonRes({ ok: true, matched: dueUserIds.length, sent: 0, reason: 'no_tokens' }, 200);
  }

  const { tickets, deadTokens } = await sendExpoPushMessages(
    messages,
    Deno.env.get('EXPO_ACCESS_TOKEN') ?? undefined,
  );

  if (deadTokens.length > 0) {
    const { error: delErr } = await admin
      .from('push_tokens')
      .delete()
      .in('expo_push_token', deadTokens);
    if (delErr) console.warn('[daily-capture-reminder] purge', delErr.message);
  }

  const summary = {
    matched: dueUserIds.length,
    sent: messages.length,
    ticketsOk: tickets.filter((t) => t.status === 'ok').length,
    ticketsError: tickets.filter((t) => t.status === 'error').length,
    purged: deadTokens.length,
  };
  console.log('[daily-capture-reminder]', summary);
  return jsonRes({ ok: true, ...summary }, 200);
});
