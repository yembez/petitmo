/**
 * Webhook RevenueCat → auth.users.app_metadata.subscriptionTier
 * (paid | free). Source de vérité serveur pour Petitmo+.
 *
 * Dashboard RC → Integrations → Webhooks :
 *   URL : https://<project>.supabase.co/functions/v1/revenuecat-webhook
 *   Authorization : Bearer <REVENUECAT_WEBHOOK_SECRET>
 *
 * Secrets Supabase :
 *   REVENUECAT_WEBHOOK_SECRET
 *   (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY déjà présents)
 *
 * Stripe n’a aucun rôle dans les abonnements.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

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

const FREE_EVENT_TYPES = new Set([
  'EXPIRATION',
  'REFUND',
  /** Accès encore actif jusqu’à EXPIRATION — on ne downgrade pas ici. */
]);

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
  if (!ids || ids.length === 0) return true; // RC peut omettre la liste ; on se fie au type
  const want = entitlementId();
  return ids.includes(want);
}

function resolveTier(event: RcEvent): 'paid' | 'free' | null {
  const type = typeof event.type === 'string' ? event.type : '';
  if (type === 'TRANSFER') {
    // Les ids cibles sont traités à part.
    return null;
  }
  if (FREE_EVENT_TYPES.has(type)) {
    return isOurEntitlement(event.entitlement_ids) ? 'free' : null;
  }
  if (type === 'CANCELLATION') {
    // Annulation ≠ expiration : accès jusqu’à la fin de période.
    return null;
  }
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
    const { error: updErr } = await supabase.auth.admin.updateUserById(userId, {
      app_metadata: { ...prev, subscriptionTier: tier },
    });
    if (updErr) {
      console.error('[revenuecat-webhook] updateUserById', userId, updErr.message);
      return jsonRes({ error: 'Failed to update user' }, 500);
    }
    console.log('[revenuecat-webhook]', type, userId.slice(0, 8), '→', tier);
  }

  return jsonRes({ received: true, updated: updates.length }, 200);
});
