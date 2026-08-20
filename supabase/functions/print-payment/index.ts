/**
 * Paiement livre imprimé (Checkout Stripe, PaymentSheet plus tard).
 * Body JSON : { action: 'create' | 'status', exportTicket, returnUrl? }
 *
 * Secrets : STRIPE_SECRET_KEY, EXPORT_PDF_JWT_SECRET
 * QA Gelato sans Stripe : STRIPE_PRINT_BYPASS=1 (jamais en prod).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { verifyExportPrintTicket } from '../_shared/verifyExportPrintTicket.ts';
import {
  isStripePrintBypass,
  nestedString,
  stripeErrorOrNull,
  stripeGet,
  stripeId,
  stripePost,
  stripeSecretKey,
} from '../_shared/stripeApi.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

type PaymentStatus = 'unpaid' | 'paid' | 'failed' | 'refunded';

type PrintRow = {
  id: string;
  type: string;
  book_id: string;
  crm_contact_id: string;
  payment_status: PaymentStatus;
  price_cents: number | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function stripeCheckoutReturnUrl(): string {
  const fromEnv = (Deno.env.get('PRINT_CHECKOUT_RETURN_URL') ?? '').trim().replace(/\/$/, '');
  return fromEnv || 'https://petitmo-production.up.railway.app/v1/print-checkout-return';
}

function withQuery(base: string, params: Record<string, string>): string {
  const u = base.trim();
  const q = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return `${u}${u.includes('?') ? '&' : '?'}${q}`;
}

function asPaymentStatus(raw: unknown): PaymentStatus {
  if (raw === 'paid' || raw === 'failed' || raw === 'refunded') return raw;
  return 'unpaid';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  let body: { action?: string; exportTicket?: string; returnUrl?: string; customerEmail?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const action = body.action === 'status' ? 'status' : 'create';
  const ticket = await verifyExportPrintTicket(
    typeof body.exportTicket === 'string' ? body.exportTicket : '',
  );
  if (!ticket) {
    return jsonRes({ error: 'Invalid export ticket' }, 401);
  }

  const supabase = createClient(url, serviceKey);
  const { data: erow, error: exErr } = await supabase
    .from('export_requests')
    .select(
      'id, type, book_id, crm_contact_id, payment_status, price_cents, stripe_checkout_session_id, stripe_payment_intent_id',
    )
    .eq('id', ticket.export_request_id)
    .maybeSingle();

  if (exErr) {
    console.error('[print-payment] select', exErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  const row = erow as PrintRow | null;
  if (!row || row.type !== 'print_order') {
    return jsonRes({ error: 'Export request not found' }, 404);
  }
  if (row.book_id !== ticket.book_id || row.crm_contact_id !== ticket.crm_contact_id) {
    return jsonRes({ error: 'Ticket does not match export request' }, 403);
  }

  const paymentStatus = asPaymentStatus(row.payment_status);
  if (action === 'status') {
    return jsonRes({ paymentStatus }, 200);
  }

  if (paymentStatus === 'paid') {
    return jsonRes({ paymentStatus: 'paid' }, 200);
  }
  if (paymentStatus === 'refunded') {
    return jsonRes({ error: 'Order refunded', paymentStatus: 'refunded' }, 409);
  }

  if (isStripePrintBypass()) {
    const now = new Date().toISOString();
    const { error: upErr } = await supabase
      .from('export_requests')
      .update({ payment_status: 'paid', paid_at: now, last_error: null })
      .eq('id', row.id)
      .neq('payment_status', 'refunded');
    if (upErr) {
      console.error('[print-payment] bypass', upErr.message);
      return jsonRes({ error: 'Database error' }, 500);
    }
    return jsonRes({ paymentStatus: 'paid', bypassed: true }, 200);
  }

  if (!stripeSecretKey()) {
    return jsonRes({ error: 'Payment not configured', code: 'STRIPE_UNCONFIGURED' }, 503);
  }

  const priceCents =
    typeof row.price_cents === 'number' && Number.isInteger(row.price_cents) ? row.price_cents : 0;
  if (priceCents < 50) {
    return jsonRes({ error: 'Invalid print price' }, 400);
  }

  const existingSessionId = (row.stripe_checkout_session_id ?? '').trim();
  if (existingSessionId) {
    const existing = await stripeGet(`checkout/sessions/${existingSessionId}`);
    if (!stripeErrorOrNull(existing.status, existing.json)) {
      const sessPay = existing.json.payment_status;
      const sessStatus = existing.json.status;
      if (sessPay === 'paid') {
        const piId = nestedString(existing.json, 'payment_intent') || row.stripe_payment_intent_id;
        await supabase
          .from('export_requests')
          .update({
            payment_status: 'paid',
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: piId || row.stripe_payment_intent_id,
            last_error: null,
          })
          .eq('id', row.id)
          .neq('payment_status', 'refunded');
        return jsonRes({ paymentStatus: 'paid' }, 200);
      }
      const checkoutUrl = typeof existing.json.url === 'string' ? existing.json.url : '';
      if (sessStatus === 'open' && checkoutUrl) {
        return jsonRes({ paymentStatus: 'unpaid', checkoutUrl }, 200);
      }
    }
  }

  const checkoutReturn = stripeCheckoutReturnUrl();
  const successUrl = withQuery(checkoutReturn, { paid: '1', eid: row.id });
  const cancelUrl = withQuery(checkoutReturn, { canceled: '1', eid: row.id });

  const customerEmail =
    typeof body.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : '';
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail);

  const created = await stripePost(
    'checkout/sessions',
    {
      mode: 'payment',
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: row.id,
      ...(emailOk ? { customer_email: customerEmail } : {}),
      'metadata[export_request_id]': row.id,
      'metadata[book_id]': row.book_id,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'eur',
      'line_items[0][price_data][unit_amount]': String(priceCents),
      'line_items[0][price_data][product_data][name]': 'Livre imprimé Petitmo',
      'payment_intent_data[metadata][export_request_id]': row.id,
      'payment_intent_data[metadata][book_id]': row.book_id,
      'expand[0]': 'payment_intent',
      locale: 'fr',
    },
    `print_cs_${row.id}_${Date.now()}`,
  );

  const createErr = stripeErrorOrNull(created.status, created.json);
  if (createErr) {
    console.error('[print-payment] checkout create', created.status, createErr);
    return jsonRes({ error: 'Unable to start payment', detail: createErr }, 502);
  }

  const sessionId = stripeId(created.json);
  const checkoutUrl = typeof created.json.url === 'string' ? created.json.url : '';
  const piId = nestedString(created.json, 'payment_intent');
  if (!sessionId || !checkoutUrl) {
    return jsonRes({ error: 'Unable to start payment' }, 502);
  }

  const { error: saveErr } = await supabase
    .from('export_requests')
    .update({
      stripe_checkout_session_id: sessionId,
      ...(piId ? { stripe_payment_intent_id: piId } : {}),
      payment_status: 'unpaid',
    })
    .eq('id', row.id);

  if (saveErr) {
    console.error('[print-payment] save session', saveErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  return jsonRes({ paymentStatus: 'unpaid', checkoutUrl }, 200);
});
