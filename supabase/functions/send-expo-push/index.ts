/**
 * Envoi push générique (ops / test / futurs transactionnels).
 * Auth : Authorization Bearer PUSH_CRON_SECRET (ou INACTIVITY_CRON_SECRET).
 *
 * Body JSON :
 * {
 *   "userIds"?: string[],
 *   "tokens"?: string[],
 *   "title": string,
 *   "body": string,
 *   "data"?: object,
 *   "kind"?: string,       // si set + userIds → anti-doublon push_send_log (day_key = UTC date)
 *   "dryRun"?: boolean
 * }
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { isExpoPushToken, sendExpoPushMessages } from '../_shared/expoPush.ts';

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

  let body: {
    userIds?: string[];
    tokens?: string[];
    title?: string;
    body?: string;
    data?: Record<string, unknown>;
    kind?: string;
    dryRun?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const pushBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!title || !pushBody) return jsonRes({ error: 'title and body required' }, 400);

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const tokens = new Set<string>();
  const userIds = (body.userIds ?? []).filter((id) => typeof id === 'string' && id.length > 10);
  const directTokens = (body.tokens ?? []).filter((t) => typeof t === 'string' && isExpoPushToken(t));

  for (const t of directTokens) tokens.add(t.trim());

  if (userIds.length > 0) {
    const { data, error } = await admin
      .from('push_tokens')
      .select('expo_push_token')
      .in('user_id', userIds);
    if (error) {
      console.error('[send-expo-push] tokens', error.message);
      return jsonRes({ error: error.message }, 500);
    }
    for (const row of data ?? []) {
      const t = String(row.expo_push_token ?? '').trim();
      if (isExpoPushToken(t)) tokens.add(t);
    }
  }

  if (tokens.size === 0) {
    return jsonRes({ ok: true, sent: 0, reason: 'no_tokens' }, 200);
  }

  const kind = typeof body.kind === 'string' ? body.kind.trim() : '';
  const dayKey = new Date().toISOString().slice(0, 10);
  if (kind && userIds.length > 0 && !body.dryRun) {
    for (const userId of userIds) {
      const { error: logErr } = await admin.from('push_send_log').insert({
        user_id: userId,
        kind,
        day_key: dayKey,
      });
      if (logErr) {
        // unique violation → déjà envoyé aujourd’hui
        if (logErr.code === '23505') {
          return jsonRes({ ok: true, sent: 0, reason: 'already_sent', kind, dayKey }, 200);
        }
        console.error('[send-expo-push] log', logErr.message);
      }
    }
  }

  const messages = [...tokens].map((to) => ({
    to,
    title,
    body: pushBody,
    sound: 'default' as const,
    priority: 'high' as const,
    data: body.data ?? { screen: '/(tabs)' },
  }));

  if (body.dryRun) {
    return jsonRes({ ok: true, dryRun: true, wouldSend: messages.length }, 200);
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
    if (delErr) console.warn('[send-expo-push] purge', delErr.message);
  }

  const ok = tickets.filter((t) => t.status === 'ok').length;
  const err = tickets.filter((t) => t.status === 'error').length;
  console.log('[send-expo-push]', { sent: messages.length, ok, err, purged: deadTokens.length });
  return jsonRes({ ok: true, sent: messages.length, ticketsOk: ok, ticketsError: err, purged: deadTokens.length }, 200);
});
