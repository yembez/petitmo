/**
 * E-mail de confirmation commande livre imprimé (Resend).
 *
 * Appelé par le serveur PDF (Railway) **après** la commande Gelato
 * (`export_requests.status = sent_to_printer`).
 * Auth : header `x-print-order-email-secret` = PRINT_ORDER_EMAIL_SECRET (partagé avec Railway),
 * ou Bearer = SUPABASE_SERVICE_ROLE_KEY en secours.
 * Un seul envoi par commande (claim atomique sur `confirmation_email_sent_at`).
 *
 * Secrets : RESEND_API_KEY (déjà utilisé par lifecycle), PRINT_ORDER_EMAIL_SECRET, optionnels
 * LIFECYCLE_FROM_EMAIL / SUPPORT_FROM_EMAIL, PRINT_SUPPORT_EMAIL (défaut support@petitcoeur.app).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const DEFAULT_FROM = 'Petit Cœur <contact@petitcoeur.app>';
const DEFAULT_SUPPORT = 'support@petitcoeur.app';

const COUNTRY_LABELS: Record<string, string> = {
  FR: 'France',
  BE: 'Belgique',
  CH: 'Suisse',
  LU: 'Luxembourg',
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatEuros(cents: number): string {
  try {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2).replace('.', ',')} €`;
  }
}

function shortOrderRef(id: string): string {
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

type Address = { line1: string; line2?: string; city: string; zip: string; country: string };

function parseAddress(raw: unknown): Address | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const line1 = typeof o.line1 === 'string' ? o.line1.trim() : '';
  const city = typeof o.city === 'string' ? o.city.trim() : '';
  const zip = typeof o.zip === 'string' ? o.zip.trim() : '';
  const country = typeof o.country === 'string' ? o.country.trim().toUpperCase() : '';
  if (!line1 || !city || !zip || !country) return null;
  const line2 = typeof o.line2 === 'string' ? o.line2.trim() : '';
  return { line1, ...(line2 ? { line2 } : {}), city, zip, country };
}

function buildEmail(params: {
  orderRef: string;
  email: string;
  shippingName: string;
  address: Address;
  bookTitle: string;
  pages: number | null;
  priceCents: number;
  supportEmail: string;
}): { subject: string; text: string; html: string } {
  const { orderRef, email, shippingName, address, bookTitle, pages, priceCents, supportEmail } = params;
  const countryLabel = COUNTRY_LABELS[address.country] ?? address.country;
  const priceLabel = priceCents > 0 ? formatEuros(priceCents) : 'Offert';
  const titleLabel = bookTitle.trim() || 'Ton livre Petit Cœur';
  const pagesLabel = pages && pages > 0 ? `${pages} pages` : null;

  const addressLines = [
    shippingName,
    address.line1,
    ...(address.line2 ? [address.line2] : []),
    `${address.zip} ${address.city}`,
    countryLabel,
  ];

  const mailtoSubject = encodeURIComponent(`Commande ${orderRef} — correction`);
  const supportHref = `mailto:${supportEmail}?subject=${mailtoSubject}`;

  const subject = `Petit Cœur — ta commande ${orderRef} est confirmée`;

  const text = [
    'Bonjour,',
    '',
    `Ta commande est confirmée : « ${titleLabel} » est parti à l’impression.`,
    '',
    'Récapitulatif',
    `• Commande : ${orderRef}`,
    `• Livre : ${titleLabel}${pagesLabel ? ` — ${pagesLabel}` : ''}`,
    `• Prix payé : ${priceLabel}`,
    `• E-mail de contact : ${email}`,
    '',
    'Adresse de livraison',
    ...addressLines,
    '',
    'Délai indicatif : compte environ 1 à 2 semaines pour l’impression et la livraison.',
    '',
    'Une erreur dans l’adresse ou l’e-mail ?',
    `Réponds à cet e-mail au plus vite (idéalement dans les 2 heures, avant le départ en impression) ou écris à ${supportEmail} en rappelant le numéro ${orderRef} : on corrige directement avec l’imprimeur.`,
    '',
    '— L’équipe Petit Cœur',
  ].join('\n');

  const html = `<!doctype html>
<html lang="fr"><body style="margin:0;padding:0;background:#faf7f4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf7f4;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;padding:32px 28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c1c1e;">
<tr><td>
<p style="margin:0 0 16px;font-size:16px;line-height:24px;">Bonjour,</p>
<p style="margin:0 0 20px;font-size:16px;line-height:24px;">Ta commande est confirmée : <strong>« ${escapeHtml(titleLabel)} »</strong> est parti à l’impression.</p>

<p style="margin:0 0 8px;font-size:13px;line-height:18px;letter-spacing:.4px;text-transform:uppercase;color:#8a8a8e;">Récapitulatif</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:22px;margin-bottom:20px;">
<tr><td style="color:#8a8a8e;padding-right:12px;">Commande</td><td><strong>${escapeHtml(orderRef)}</strong></td></tr>
<tr><td style="color:#8a8a8e;padding-right:12px;">Livre</td><td>${escapeHtml(titleLabel)}${pagesLabel ? ` — ${escapeHtml(pagesLabel)}` : ''}</td></tr>
<tr><td style="color:#8a8a8e;padding-right:12px;">Prix payé</td><td>${escapeHtml(priceLabel)}</td></tr>
<tr><td style="color:#8a8a8e;padding-right:12px;">E-mail</td><td>${escapeHtml(email)}</td></tr>
</table>

<p style="margin:0 0 8px;font-size:13px;line-height:18px;letter-spacing:.4px;text-transform:uppercase;color:#8a8a8e;">Adresse de livraison</p>
<p style="margin:0 0 20px;font-size:15px;line-height:22px;">${addressLines.map(escapeHtml).join('<br/>')}</p>

<p style="margin:0 0 20px;font-size:14px;line-height:21px;color:#5c5c61;">Délai indicatif : compte environ <strong>1 à 2 semaines</strong> pour l’impression et la livraison.</p>

<div style="background:#fff4ee;border-radius:12px;padding:14px 16px;margin:0 0 24px;">
<p style="margin:0 0 6px;font-size:15px;line-height:22px;"><strong>Une erreur dans l’adresse ou l’e-mail ?</strong></p>
<p style="margin:0;font-size:14px;line-height:21px;">Réponds à cet e-mail au plus vite (idéalement dans les 2 heures, avant le départ en impression) ou <a href="${supportHref}" style="color:#d9693b;">écris au support</a> en rappelant le numéro <strong>${escapeHtml(orderRef)}</strong> : on corrige directement avec l’imprimeur.</p>
</div>

<p style="margin:0;font-size:15px;line-height:22px;color:#5c5c61;">— L’équipe Petit Cœur</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  return { subject, text, html };
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

  let body: { exportRequestId?: unknown };
  try {
    body = (await req.json()) as { exportRequestId?: unknown };
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }
  const exportRequestId = typeof body.exportRequestId === 'string' ? body.exportRequestId.trim() : '';
  if (!exportRequestId) {
    return jsonRes({ error: 'exportRequestId required' }, 400);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: row, error: rowErr } = await admin
    .from('export_requests')
    .select(
      'id, type, status, payment_status, crm_contact_id, shipping_name, shipping_address_json, price_cents, billable_pages, printer_order_id, pdf_payload_json, confirmation_email_sent_at',
    )
    .eq('id', exportRequestId)
    .maybeSingle();
  if (rowErr) {
    console.error('[print-order-confirmation] select', rowErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }
  if (!row || row.type !== 'print_order') {
    return jsonRes({ error: 'Export request not found' }, 404);
  }
  if (row.status !== 'sent_to_printer' || !row.printer_order_id) {
    return jsonRes({ sent: false, reason: 'not_sent_to_printer' }, 409);
  }
  if (row.confirmation_email_sent_at) {
    return jsonRes({ sent: false, reason: 'already_sent' });
  }

  const { data: contact, error: cErr } = await admin
    .from('crm_contacts')
    .select('email')
    .eq('id', row.crm_contact_id as string)
    .maybeSingle();
  if (cErr) {
    console.error('[print-order-confirmation] contact', cErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }
  const email = typeof contact?.email === 'string' ? contact.email.trim().toLowerCase() : '';
  const address = parseAddress(row.shipping_address_json);
  const shippingName = typeof row.shipping_name === 'string' ? row.shipping_name.trim() : '';

  const fail = async (reason: string, status = 422) => {
    await admin
      .from('export_requests')
      .update({ confirmation_email_error: reason.slice(0, 500) })
      .eq('id', exportRequestId);
    return jsonRes({ sent: false, reason }, status);
  };

  if (!email || !email.includes('@')) return fail('no_email');
  if (!address || !shippingName) return fail('no_address');

  const resendKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim();
  if (!resendKey) return fail('no_resend_key', 503);

  // Claim atomique : un seul envoi même si le serveur rappelle deux fois.
  const { data: claimed, error: claimErr } = await admin
    .from('export_requests')
    .update({ confirmation_email_sent_at: new Date().toISOString(), confirmation_email_error: null })
    .eq('id', exportRequestId)
    .is('confirmation_email_sent_at', null)
    .select('id');
  if (claimErr) {
    console.error('[print-order-confirmation] claim', claimErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }
  if (!claimed?.length) {
    return jsonRes({ sent: false, reason: 'already_sent' });
  }

  const payload = (row.pdf_payload_json ?? null) as { coverTitle?: unknown } | null;
  const bookTitle = typeof payload?.coverTitle === 'string' ? payload.coverTitle : '';
  const pages = typeof row.billable_pages === 'number' ? row.billable_pages : null;
  const priceCents = typeof row.price_cents === 'number' ? row.price_cents : 0;
  const supportEmail = (Deno.env.get('PRINT_SUPPORT_EMAIL') ?? DEFAULT_SUPPORT).trim() || DEFAULT_SUPPORT;
  const fromEmail =
    (Deno.env.get('LIFECYCLE_FROM_EMAIL') ?? Deno.env.get('SUPPORT_FROM_EMAIL') ?? DEFAULT_FROM).trim() ||
    DEFAULT_FROM;

  const content = buildEmail({
    orderRef: shortOrderRef(exportRequestId),
    email,
    shippingName,
    address,
    bookTitle,
    pages,
    priceCents,
    supportEmail,
  });

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromEmail,
      to: [email],
      reply_to: supportEmail,
      subject: content.subject,
      text: content.text,
      html: content.html,
      tags: [{ name: 'template', value: 'print_order_confirmation' }],
    }),
  });

  if (!resendRes.ok) {
    const detail = await resendRes.text().catch(() => '');
    console.error('[print-order-confirmation] resend', resendRes.status, detail.slice(0, 400));
    // Libérer le claim pour permettre un nouvel essai.
    await admin
      .from('export_requests')
      .update({
        confirmation_email_sent_at: null,
        confirmation_email_error: `resend ${resendRes.status}: ${detail.slice(0, 300)}`,
      })
      .eq('id', exportRequestId);
    return jsonRes({ sent: false, reason: 'resend_failed' }, 502);
  }

  console.log('[print-order-confirmation] sent', exportRequestId.slice(0, 8), email.replace(/^(.).*(@.*)$/, '$1***$2'));
  return jsonRes({ sent: true });
});
