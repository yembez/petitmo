/**
 * Webhook Stripe → export_requests.payment_status = paid (livre imprimé).
 * Corps brut obligatoire (signature). Pas de JWT.
 *
 * URL dashboard Stripe :
 *   https://<project>.supabase.co/functions/v1/stripe-webhook?apikey=<ANON_KEY>
 * Secret : STRIPE_WEBHOOK_SECRET
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import {
  nestedString,
  stripeWebhookSecret,
  verifyStripeWebhookSignature,
} from '../_shared/stripeApi.ts';

type StripeEvent = {
  id?: string;
  type?: string;
  data?: { object?: Record<string, unknown> };
};

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function asInt(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : NaN;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }
  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  const secret = stripeWebhookSecret();
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret || !url || !serviceKey) {
    console.error('[stripe-webhook] missing secrets');
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  const payload = await req.text();
  const header = req.headers.get('stripe-signature') ?? '';
  const okSig = await verifyStripeWebhookSignature(payload, header, secret);
  if (!okSig) {
    return jsonRes({ error: 'Invalid signature' }, 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const type = typeof event.type === 'string' ? event.type : '';
  const obj = event.data?.object && typeof event.data.object === 'object' ? event.data.object : null;
  if (!obj) {
    return jsonRes({ received: true }, 200);
  }

  if (type !== 'checkout.session.completed' && type !== 'payment_intent.succeeded') {
    return jsonRes({ received: true }, 200);
  }

  const supabase = createClient(url, serviceKey);

  const meta =
    obj.metadata && typeof obj.metadata === 'object' && !Array.isArray(obj.metadata)
      ? (obj.metadata as Record<string, unknown>)
      : {};
  const metaExportId = typeof meta.export_request_id === 'string' ? meta.export_request_id.trim() : '';
  const clientRef = typeof obj.client_reference_id === 'string' ? obj.client_reference_id.trim() : '';
  const sessionId = type === 'checkout.session.completed' && typeof obj.id === 'string' ? obj.id : '';
  const piFromSession = nestedString(obj, 'payment_intent');
  const piId =
    type === 'payment_intent.succeeded' && typeof obj.id === 'string' ? obj.id : piFromSession;

  let row: {
    id: string;
    type: string;
    payment_status: string;
    price_cents: number | null;
    stripe_checkout_session_id: string | null;
    stripe_payment_intent_id: string | null;
  } | null = null;

  if (sessionId) {
    const { data } = await supabase
      .from('export_requests')
      .select('id, type, payment_status, price_cents, stripe_checkout_session_id, stripe_payment_intent_id')
      .eq('stripe_checkout_session_id', sessionId)
      .maybeSingle();
    row = data;
  }
  if (!row && piId) {
    const { data } = await supabase
      .from('export_requests')
      .select('id, type, payment_status, price_cents, stripe_checkout_session_id, stripe_payment_intent_id')
      .eq('stripe_payment_intent_id', piId)
      .maybeSingle();
    row = data;
  }
  if (!row && (metaExportId || clientRef)) {
    const { data } = await supabase
      .from('export_requests')
      .select('id, type, payment_status, price_cents, stripe_checkout_session_id, stripe_payment_intent_id')
      .eq('id', metaExportId || clientRef)
      .maybeSingle();
    row = data;
  }

  if (!row || row.type !== 'print_order') {
    console.warn('[stripe-webhook] no print_order for', type, event.id);
    return jsonRes({ received: true }, 200);
  }

  if (row.payment_status === 'refunded') {
    return jsonRes({ received: true, skipped: 'refunded' }, 200);
  }
  if (row.payment_status === 'paid') {
    const patch: Record<string, unknown> = {};
    if (sessionId && !row.stripe_checkout_session_id) patch.stripe_checkout_session_id = sessionId;
    if (piId && !row.stripe_payment_intent_id) patch.stripe_payment_intent_id = piId;
    if (Object.keys(patch).length > 0) {
      await supabase.from('export_requests').update(patch).eq('id', row.id);
    }
    return jsonRes({ received: true, already: 'paid' }, 200);
  }

  const expected = typeof row.price_cents === 'number' ? row.price_cents : NaN;
  const amount =
    type === 'checkout.session.completed' ? asInt(obj.amount_total) : asInt(obj.amount);
  const currency = typeof obj.currency === 'string' ? obj.currency.toLowerCase() : '';
  const paidOk =
    type === 'checkout.session.completed'
      ? obj.payment_status === 'paid' || obj.status === 'complete'
      : true;

  if (!paidOk || currency !== 'eur' || !Number.isFinite(expected) || amount !== expected) {
    console.error('[stripe-webhook] amount mismatch', {
      exportRequestId: row.id,
      type,
      amount,
      expected,
      currency,
      paidOk,
    });
    await supabase
      .from('export_requests')
      .update({ last_error: 'stripe amount mismatch' })
      .eq('id', row.id);
    return jsonRes({ received: true, skipped: 'amount_mismatch' }, 200);
  }

  const { error: upErr } = await supabase
    .from('export_requests')
    .update({
      payment_status: 'paid',
      paid_at: new Date().toISOString(),
      last_error: null,
      ...(sessionId ? { stripe_checkout_session_id: sessionId } : {}),
      ...(piId ? { stripe_payment_intent_id: piId } : {}),
    })
    .eq('id', row.id)
    .neq('payment_status', 'refunded');

  if (upErr) {
    console.error('[stripe-webhook] update', upErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  return jsonRes({ received: true, paid: row.id }, 200);
});
