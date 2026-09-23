/**
 * Webhook RevenueCat → subscriptionTier + e-mails lifecycle.
 *
 * BILLING_ISSUE → mail + flag app_metadata.billingIssue (pas de downgrade)
 * CANCELLATION → mail sub.cancelled uniquement (reste paid jusqu’à EXPIRATION)
 * EXPIRATION/REFUND → free + captureLocked + restore archives legacy + mail sub.downgraded
 *   (V1 : plus d’archivage >50 — ex-paid = lecture totale, 0 ajout)
 * RENEWAL/… → paid + clear captureLocked/billingIssue + restore + mail sub.reactivated (si venait de free)
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { restoreDowngradeArchivedMemories } from '../_shared/memoryArchive.ts';
import { formatAccessEndsOn, sendLifecycleEmail } from '../_shared/lifecycleEmail.ts';

type RcEvent = {
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  entitlement_ids?: string[] | null;
  expiration_at_ms?: number | null;
  transferred_from?: string[] | null;
  transferred_to?: string[] | null;
};

type RcPayload = {
  api_version?: string;
  event?: RcEvent;
};

const PAID_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'PRODUCT_CHANGE',
  'TEMPORARY_ENTITLEMENT_GRANT',
]);

const FREE_EVENT_TYPES = new Set(['EXPIRATION', 'REFUND']);

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function entitlementId(): string {
  const raw = (Deno.env.get('RC_ENTITLEMENT_ID') ?? 'petitmo_plus').trim();
  return raw || 'petitmo_plus';
}

function isOurEntitlement(ids: string[] | null | undefined): boolean {
  if (!ids || ids.length === 0) return true;
  return ids.includes(entitlementId());
}

function resolveTier(event: RcEvent): 'paid' | 'free' | null {
  const type = typeof event.type === 'string' ? event.type : '';
  if (type === 'TRANSFER' || type === 'BILLING_ISSUE') return null;
  if (FREE_EVENT_TYPES.has(type)) {
    return isOurEntitlement(event.entitlement_ids) ? 'free' : null;
  }
  if (type === 'CANCELLATION') return null;
  if (PAID_EVENT_TYPES.has(type)) {
    if (!isOurEntitlement(event.entitlement_ids)) return null;
    const exp = event.expiration_at_ms;
    if (typeof exp === 'number' && Number.isFinite(exp) && exp > 0 && exp < Date.now()) {
      return 'free';
    }
    return 'paid';
  }
  return null;
}

function collectUserIds(event: RcEvent): string[] {
  const out = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || id.startsWith('$RCAnonymousID:')) return;
    out.add(id);
  };
  add(event.app_user_id);
  add(event.original_app_user_id);
  if (Array.isArray(event.transferred_to)) {
    for (const id of event.transferred_to) add(id);
  }
  return [...out];
}

function tierFromMeta(meta: Record<string, unknown>): 'paid' | 'free' {
  return meta.subscriptionTier === 'paid' ? 'paid' : 'free';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  const secret = (Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '').trim();
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !serviceKey) {
    console.error('[revenuecat-webhook] missing secrets');
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || token !== secret) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  let payload: RcPayload;
  try {
    payload = (await req.json()) as RcPayload;
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const event = payload.event && typeof payload.event === 'object' ? payload.event : null;
  if (!event) {
    return jsonRes({ received: true }, 200);
  }

  const type = typeof event.type === 'string' ? event.type : '';
  const supabase = createClient(url, serviceKey);

  // --- BILLING_ISSUE : flag + mail, pas de downgrade ---
  if (type === 'BILLING_ISSUE' && isOurEntitlement(event.entitlement_ids)) {
    for (const userId of collectUserIds(event)) {
      const { data: existing, error: getErr } = await supabase.auth.admin.getUserById(userId);
      if (getErr || !existing?.user) {
        console.warn('[revenuecat-webhook] user not found', userId, getErr?.message);
        continue;
      }
      const prev = (existing.user.app_metadata ?? {}) as Record<string, unknown>;
      const { error: updErr } = await supabase.auth.admin.updateUserById(userId, {
        app_metadata: {
          ...prev,
          billingIssue: true,
          billingIssueAt: new Date().toISOString(),
        },
      });
      if (updErr) {
        console.error('[revenuecat-webhook] billingIssue meta', updErr.message);
        continue;
      }
      const mail = await sendLifecycleEmail({
        admin: supabase,
        userId,
        email: existing.user.email,
        templateId: 'sub.billing_issue',
      });
      console.log('[revenuecat-webhook] BILLING_ISSUE', userId.slice(0, 8), mail);
    }
    return jsonRes({ received: true, billingIssue: true }, 200);
  }

  // --- CANCELLATION : mail info uniquement (accès paid jusqu’à EXPIRATION) ---
  if (type === 'CANCELLATION' && isOurEntitlement(event.entitlement_ids)) {
    const accessEndsOn = formatAccessEndsOn(event.expiration_at_ms);
    for (const userId of collectUserIds(event)) {
      const { data: existing, error: getErr } = await supabase.auth.admin.getUserById(userId);
      if (getErr || !existing?.user) {
        console.warn('[revenuecat-webhook] user not found', userId, getErr?.message);
        continue;
      }
      const mail = await sendLifecycleEmail({
        admin: supabase,
        userId,
        email: existing.user.email,
        templateId: 'sub.cancelled',
        vars: { accessEndsOn },
      });
      console.log('[revenuecat-webhook] CANCELLATION', userId.slice(0, 8), mail, accessEndsOn);
    }
    return jsonRes({ received: true, cancelled: true }, 200);
  }

  const updates: { userId: string; tier: 'paid' | 'free' }[] = [];

  if (type === 'TRANSFER') {
    if (Array.isArray(event.transferred_from)) {
      for (const raw of event.transferred_from) {
        const id = typeof raw === 'string' ? raw.trim() : '';
        if (id && !id.startsWith('$RCAnonymousID:')) {
          updates.push({ userId: id, tier: 'free' });
        }
      }
    }
    if (Array.isArray(event.transferred_to)) {
      for (const raw of event.transferred_to) {
        const id = typeof raw === 'string' ? raw.trim() : '';
        if (id && !id.startsWith('$RCAnonymousID:')) {
          updates.push({ userId: id, tier: 'paid' });
        }
      }
    }
  } else {
    const tier = resolveTier(event);
    if (tier) {
      for (const userId of collectUserIds(event)) {
        updates.push({ userId, tier });
      }
    }
  }

  for (const { userId, tier } of updates) {
    const { data: existing, error: getErr } = await supabase.auth.admin.getUserById(userId);
    if (getErr || !existing?.user) {
      console.warn('[revenuecat-webhook] user not found', userId, getErr?.message);
      continue;
    }
    const prev = (existing.user.app_metadata ?? {}) as Record<string, unknown>;
    const prevTier = tierFromMeta(prev);

    const nextMeta: Record<string, unknown> = {
      ...prev,
      subscriptionTier: tier,
    };
    // Plus d’abo actif → le flag « billing issue » n’a plus de sens (downgrade / restore).
    nextMeta.billingIssue = false;
    nextMeta.billingIssueAt = null;
    if (tier === 'paid') {
      nextMeta.captureLocked = false;
      nextMeta.captureLockedAt = null;
    } else {
      // Ex-paid lecture seule (V1) — never-paid n’arrive pas ici via FREE_EVENT_TYPES sans avoir été paid.
      nextMeta.captureLocked = true;
      nextMeta.captureLockedAt = new Date().toISOString();
    }

    const { error: updErr } = await supabase.auth.admin.updateUserById(userId, {
      app_metadata: nextMeta,
    });
    if (updErr) {
      console.error('[revenuecat-webhook] updateUserById', userId, updErr.message);
      return jsonRes({ error: 'Failed to update user' }, 500);
    }
    console.log('[revenuecat-webhook]', type, userId.slice(0, 8), prevTier, '→', tier);

    try {
      // V1 : toujours restaurer d’éventuelles archives downgrade legacy (plus d’archivage à l’expiration).
      const r = await restoreDowngradeArchivedMemories(supabase, userId);
      console.log('[revenuecat-webhook] restore', userId.slice(0, 8), r);
      if (tier === 'free' && prevTier === 'paid') {
        const mail = await sendLifecycleEmail({
          admin: supabase,
          userId,
          email: existing.user.email,
          templateId: 'sub.downgraded',
        });
        console.log('[revenuecat-webhook] mail downgraded', mail);
      } else if (tier === 'paid' && prevTier === 'free') {
        const mail = await sendLifecycleEmail({
          admin: supabase,
          userId,
          email: existing.user.email,
          templateId: 'sub.reactivated',
        });
        console.log('[revenuecat-webhook] mail reactivated', mail);
      }
    } catch (e) {
      console.error('[revenuecat-webhook] restore/mail', userId, e);
    }
  }

  return jsonRes({ received: true, updated: updates.length }, 200);
});
