/**
 * Alerte ops : échec permanent fulfill print (PDF/Gelato).
 * Destinataire = support@ (jamais la cliente).
 * Auth : PRINT_ORDER_EMAIL_SECRET ou service role (comme print-order-confirmation).
 * Secrets : RESEND_API_KEY, PRINT_ORDER_EMAIL_SECRET, optionnel PRINT_SUPPORT_EMAIL / SUPPORT_FROM_EMAIL.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const DEFAULT_TO = 'support@petitcoeur.app';
const DEFAULT_FROM = 'Petit Cœur Ops <contact@petitcoeur.app>';

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  const serviceKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '').trim();
  const sharedSecret = (Deno.env.get('PRINT_ORDER_EMAIL_SECRET') ?? '').trim();
  const headerSecret = (req.headers.get('x-print-order-email-secret') ?? '').trim();
  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const authorized =
    (sharedSecret && (headerSecret === sharedSecret || bearer === sharedSecret)) ||
    (serviceKey && bearer === serviceKey);
  if (!authorized) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }
  if (!serviceKey) {
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  let body: { exportRequestId?: unknown; lastError?: unknown; attemptCount?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }
  const exportRequestId = typeof body.exportRequestId === 'string' ? body.exportRequestId.trim() : '';
  if (!exportRequestId) {
    return jsonRes({ error: 'exportRequestId required' }, 400);
  }
  const lastError =
    typeof body.lastError === 'string' ? body.lastError.trim().slice(0, 2000) : '';
  const attemptCount =
    typeof body.attemptCount === 'number' && Number.isFinite(body.attemptCount)
      ? Math.max(0, Math.round(body.attemptCount))
      : 0;

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: row, error: rowErr } = await admin
    .from('export_requests')
    .select(
      'id, type, status, payment_status, book_id, crm_contact_id, shipping_name, price_cents, printer_order_id, last_error, fulfill_attempt_count, fulfill_failed_kind, print_ops_alert_sent_at',
    )
    .eq('id', exportRequestId)
    .maybeSingle();
  if (rowErr) {
    console.error('[print-fulfill-ops-alert] select', rowErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }
  if (!row || row.type !== 'print_order') {
    return jsonRes({ error: 'Export request not found' }, 404);
  }
  if (row.payment_status !== 'paid') {
    return jsonRes({ sent: false, reason: 'not_paid' }, 409);
  }
  if (row.printer_order_id) {
    return jsonRes({ sent: false, reason: 'already_gelato' }, 409);
  }

  // Claim atomique — un seul mail même si retry concurrent.
  const { data: claimed, error: claimErr } = await admin
    .from('export_requests')
    .update({ print_ops_alert_sent_at: new Date().toISOString() })
    .eq('id', exportRequestId)
    .is('print_ops_alert_sent_at', null)
    .select('id');
  if (claimErr) {
    console.error('[print-fulfill-ops-alert] claim', claimErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }
  if (!claimed?.length) {
    return jsonRes({ sent: false, reason: 'already_sent' });
  }

  const { data: contact } = await admin
    .from('crm_contacts')
    .select('email')
    .eq('id', row.crm_contact_id as string)
    .maybeSingle();
  const customerEmail =
    typeof contact?.email === 'string' ? contact.email.trim().toLowerCase() : '';

  const errText = lastError || (typeof row.last_error === 'string' ? row.last_error : '') || '—';
  const attempts =
    attemptCount ||
    (typeof row.fulfill_attempt_count === 'number' ? row.fulfill_attempt_count : 0);

  const subject = `[Petitmo] Print fulfill permanent — ${exportRequestId.slice(0, 8)}`;
  const text = [
    'Échec permanent PDF / Gelato après paiement.',
    '',
    `export_request_id: ${exportRequestId}`,
    `book_id: ${row.book_id ?? '—'}`,
    `status: ${row.status}`,
    `fulfill_failed_kind: ${row.fulfill_failed_kind ?? 'permanent'}`,
    `attempts: ${attempts}`,
    `customer_email: ${customerEmail || '—'}`,
    `shipping_name: ${typeof row.shipping_name === 'string' ? row.shipping_name : '—'}`,
    `price_cents: ${row.price_cents ?? '—'}`,
    '',
    `last_error:`,
    errText,
    '',
    'Action: inspecter Railway logs + payload stash / Gelato dashboard. Ne pas re-débiter la cliente.',
  ].join('\n');

  const html = `<pre style="font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap">${text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</pre>`;

  const resendKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim();
  if (!resendKey) {
    console.error('[print-fulfill-ops-alert] RESEND_API_KEY missing');
    // Claim déjà posé — on laisse la trace pour éviter spam ; ops verra Sentry/logs.
    return jsonRes({ sent: false, reason: 'no_resend_key' }, 503);
  }

  const toEmail =
    (Deno.env.get('PRINT_SUPPORT_EMAIL') ?? Deno.env.get('SUPPORT_TO_EMAIL') ?? DEFAULT_TO).trim() ||
    DEFAULT_TO;
  const fromEmail =
    (Deno.env.get('LIFECYCLE_FROM_EMAIL') ?? Deno.env.get('SUPPORT_FROM_EMAIL') ?? DEFAULT_FROM).trim() ||
    DEFAULT_FROM;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject,
      text,
      html,
    }),
  });
  const resText = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('[print-fulfill-ops-alert] resend', res.status, resText.slice(0, 400));
    // Annuler le claim pour permettre un nouvel essai plus tard.
    await admin
      .from('export_requests')
      .update({ print_ops_alert_sent_at: null })
      .eq('id', exportRequestId);
    return jsonRes({ sent: false, reason: 'resend_failed' }, 502);
  }

  console.log(
    '[print-fulfill-ops-alert] sent',
    exportRequestId.slice(0, 8),
    toEmail.replace(/^(.).*(@.*)$/, '$1***$2'),
  );
  return jsonRes({ sent: true, to: toEmail });
});
