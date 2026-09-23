/**
 * Cron inactivité 24 mois.
 * Auth : Authorization Bearer INACTIVITY_CRON_SECRET (ou REVENUECAT_WEBHOOK_SECRET en secours).
 *
 * Jalon depuis last_active_at (sinon auth.users.created_at) :
 * - +21 mois → inactive.j90
 * - +23 mois → inactive.j30
 * - +24 mois − 7 j → inactive.j7
 * - +24 mois → mail inactive.deleted + delete mode=inactivity
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import {
  sendLifecycleEmail,
  type LifecycleTemplateId,
} from '../_shared/lifecycleEmail.ts';

const MS_DAY = 24 * 60 * 60 * 1000;
const MONTH_MS = 30.4375 * MS_DAY; // moyenne calendaire
const INACTIVE_MS = 24 * MONTH_MS;
const J90_MS = INACTIVE_MS - 90 * MS_DAY;
const J30_MS = INACTIVE_MS - 30 * MS_DAY;
const J7_MS = INACTIVE_MS - 7 * MS_DAY;

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cronSecret(): string {
  return (
    (Deno.env.get('INACTIVITY_CRON_SECRET') ?? '').trim() ||
    (Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '').trim()
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  const secret = cronSecret();
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !serviceKey) {
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || token !== secret) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const now = Date.now();
  const cutoffJ90 = new Date(now - J90_MS).toISOString();

  // Candidats : activité ancienne OU jamais touchés (créés il y a ≥ 21 mois).
  const { data: activityRows, error: actErr } = await admin
    .from('account_activity')
    .select('user_id, last_active_at')
    .lte('last_active_at', cutoffJ90)
    .limit(500);
  if (actErr) {
    console.error('[inactivity-sweep] activity', actErr.message);
    return jsonRes({ error: actErr.message }, 500);
  }

  type Cand = { userId: string; lastActiveAt: string; email: string | null };
  const candidates = new Map<string, Cand>();

  for (const row of activityRows ?? []) {
    const id = row.user_id as string;
    candidates.set(id, {
      userId: id,
      lastActiveAt: row.last_active_at as string,
      email: null,
    });
  }

  // Users sans ligne activity, créés avant cutoff J90
  const { data: listData, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) {
    console.warn('[inactivity-sweep] listUsers', listErr.message);
  } else {
    for (const u of listData.users ?? []) {
      if (candidates.has(u.id)) {
        const c = candidates.get(u.id)!;
        c.email = u.email ?? null;
        continue;
      }
      const email = (u.email ?? '').toLowerCase();
      if (!email || email.endsWith('@petitmo.local')) continue;
      const created = Date.parse(u.created_at);
      if (!Number.isFinite(created) || created > now - J90_MS) continue;
      // Pas de touch → created_at comme proxy
      const { data: existing } = await admin
        .from('account_activity')
        .select('user_id')
        .eq('user_id', u.id)
        .maybeSingle();
      if (existing) continue;
      candidates.set(u.id, {
        userId: u.id,
        lastActiveAt: u.created_at,
        email: u.email ?? null,
      });
    }
  }

  // Compléter emails manquants
  for (const c of candidates.values()) {
    if (c.email) continue;
    const { data } = await admin.auth.admin.getUserById(c.userId);
    c.email = data.user?.email ?? null;
  }

  const summary = {
    scanned: candidates.size,
    j90: 0,
    j30: 0,
    j7: 0,
    deleted: 0,
    errors: 0,
  };

  for (const c of candidates.values()) {
    const email = (c.email ?? '').toLowerCase();
    if (!email || email.endsWith('@petitmo.local')) continue;

    const last = Date.parse(c.lastActiveAt);
    if (!Number.isFinite(last)) continue;
    const idle = now - last;
    const cycleKey = c.lastActiveAt.slice(0, 10);

    try {
      if (idle >= INACTIVE_MS) {
        await sendLifecycleEmail({
          admin,
          userId: c.userId,
          email,
          templateId: 'inactive.deleted',
          dedupeKey: cycleKey,
        });
        // Purge via delete-account service path
        const delRes = await fetch(`${url}/functions/v1/delete-account`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ mode: 'inactivity', userId: c.userId }),
        });
        if (!delRes.ok) {
          const detail = await delRes.text().catch(() => '');
          console.error('[inactivity-sweep] delete', c.userId.slice(0, 8), delRes.status, detail.slice(0, 200));
          summary.errors += 1;
        } else {
          summary.deleted += 1;
        }
        continue;
      }

      let templateId: LifecycleTemplateId | null = null;
      if (idle >= J7_MS) templateId = 'inactive.j7';
      else if (idle >= J30_MS) templateId = 'inactive.j30';
      else if (idle >= J90_MS) templateId = 'inactive.j90';
      if (!templateId) continue;

      const mail = await sendLifecycleEmail({
        admin,
        userId: c.userId,
        email,
        templateId,
        dedupeKey: cycleKey,
      });
      if (mail.sent) {
        if (templateId === 'inactive.j90') summary.j90 += 1;
        if (templateId === 'inactive.j30') summary.j30 += 1;
        if (templateId === 'inactive.j7') summary.j7 += 1;
      }
    } catch (e) {
      summary.errors += 1;
      console.error('[inactivity-sweep] user', c.userId.slice(0, 8), e);
    }
  }

  console.log('[inactivity-sweep]', summary);
  return jsonRes({ ok: true, ...summary }, 200);
});
