import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { SignJWT } from 'npm:jose@5.9.6';
import { calculateBookPriceCents, type DiscountPercent } from './calculateBookPrice.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const FREE_AV_MAX_CUMULATIVE = 10;
const MAX_EXPORTS_PER_EMAIL_24H = 3;
const MAX_INIT_PER_IP_1H = 10;

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

function clientIp(req: Request): string {
  const xf = req.headers.get('x-forwarded-for');
  if (xf) {
    const first = xf.split(',')[0]?.trim();
    if (first) return first;
  }
  const cf = req.headers.get('cf-connecting-ip');
  if (cf?.trim()) return cf.trim();
  return 'unknown';
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

type InitBody = {
  type?: string;
  export_mode?: string;
  book_id?: string;
  child_local_id?: string | null;
  subscription_tier?: string;
  audio_video_page_count?: number;
  email?: string;
  gdpr_consent_at?: string;
  full_name?: string | null;
  marketing_opt_in?: boolean;
  /** print_order */
  shipping_name?: string;
  shipping_address_json?: Record<string, unknown>;
  billable_pages?: number;
  discount_percent?: number;
  printer_name?: string | null;
};

function parseShippingAddress(raw: unknown): { ok: true; value: Record<string, string> } | { ok: false; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, message: 'shipping_address_json must be an object' };
  }
  const o = raw as Record<string, unknown>;
  const line1 = typeof o.line1 === 'string' ? o.line1.trim() : '';
  const city = typeof o.city === 'string' ? o.city.trim() : '';
  const zip = typeof o.zip === 'string' ? o.zip.trim() : '';
  const country = typeof o.country === 'string' ? o.country.trim() : '';
  if (!line1 || !city || !zip || !country) {
    return { ok: false, message: 'shipping_address_json requires line1, city, zip, country' };
  }
  const line2 = typeof o.line2 === 'string' ? o.line2.trim() : '';
  const value: Record<string, string> = { line1, city, zip, country };
  if (line2) value.line2 = line2;
  return { ok: true, value };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  const jwtSecret = Deno.env.get('EXPORT_PDF_JWT_SECRET');
  if (!jwtSecret || jwtSecret.length < 32) {
    console.error('[init-export] EXPORT_PDF_JWT_SECRET manquant ou trop court (min 32 car.)');
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  let body: InitBody;
  try {
    body = (await req.json()) as InitBody;
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const requestType = body.type;
  if (requestType !== 'pdf_export' && requestType !== 'print_order') {
    return jsonRes({ error: 'Unsupported type', supported: ['pdf_export', 'print_order'] }, 400);
  }

  const exportMode = body.export_mode;
  if (exportMode !== 'digital' && exportMode !== 'print') {
    return jsonRes({ error: 'Invalid export_mode' }, 400);
  }

  if (requestType === 'print_order' && exportMode !== 'print') {
    return jsonRes({ error: 'print_order requires export_mode "print"' }, 400);
  }

  const bookId = typeof body.book_id === 'string' ? body.book_id.trim() : '';
  if (!bookId) {
    return jsonRes({ error: 'book_id required' }, 400);
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return jsonRes({ error: 'Invalid email' }, 400);
  }

  const gdprRaw = body.gdpr_consent_at;
  if (typeof gdprRaw !== 'string' || !gdprRaw.trim()) {
    return jsonRes({ error: 'gdpr_consent_at required (ISO-8601)' }, 400);
  }
  const gdprConsentAt = new Date(gdprRaw);
  if (!Number.isFinite(gdprConsentAt.getTime())) {
    return jsonRes({ error: 'gdpr_consent_at invalid' }, 400);
  }

  const tier = body.subscription_tier;
  if (tier !== 'free' && tier !== 'paid') {
    return jsonRes({ error: 'Invalid subscription_tier' }, 400);
  }

  const avRaw = body.audio_video_page_count;
  const avCount =
    typeof avRaw === 'number' && Number.isInteger(avRaw) && avRaw >= 0 && avRaw <= 200 ? avRaw : null;
  if (avCount === null) {
    return jsonRes({ error: 'audio_video_page_count invalid' }, 400);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const ip = clientIp(req);
  const ipHash = await sha256Hex(`${ip}:${jwtSecret}`);

  const { count: ipCount, error: ipErr } = await supabase
    .from('export_requests')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .eq('client_ip_hash', ipHash);

  if (ipErr) {
    console.error('[init-export] ip rate', ipErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }
  if ((ipCount ?? 0) >= MAX_INIT_PER_IP_1H) {
    return jsonRes({ error: 'Too many requests from this network', code: 'RATE_LIMIT_IP' }, 429);
  }

  const { data: existingContact, error: findErr } = await supabase
    .from('crm_contacts')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (findErr) {
    console.error('[init-export] crm find', findErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  let crmContactId: string;
  const nowIso = new Date().toISOString();
  const nameTrim = typeof body.full_name === 'string' ? body.full_name.trim() : '';

  if (existingContact?.id) {
    crmContactId = existingContact.id as string;
    const patch: Record<string, unknown> = {
      gdpr_consent_at: gdprConsentAt.toISOString(),
      last_seen_at: nowIso,
    };
    if (typeof body.marketing_opt_in === 'boolean') {
      patch.marketing_opt_in = body.marketing_opt_in;
    }
    if (nameTrim) patch.full_name = nameTrim;
    const { error: upErr } = await supabase.from('crm_contacts').update(patch).eq('id', crmContactId);
    if (upErr) {
      console.error('[init-export] crm update', upErr.message);
      return jsonRes({ error: 'Database error' }, 500);
    }
  } else {
    const { data: insC, error: insCErr } = await supabase
      .from('crm_contacts')
      .insert({
        email,
        full_name: nameTrim || null,
        gdpr_consent_at: gdprConsentAt.toISOString(),
        marketing_opt_in: typeof body.marketing_opt_in === 'boolean' ? body.marketing_opt_in : false,
        last_seen_at: nowIso,
      })
      .select('id')
      .single();
    if (insCErr || !insC?.id) {
      console.error('[init-export] crm insert', insCErr?.message);
      return jsonRes({ error: 'Database error' }, 500);
    }
    crmContactId = insC.id as string;
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: emailCount, error: emailErr } = await supabase
    .from('export_requests')
    .select('id', { count: 'exact', head: true })
    .eq('crm_contact_id', crmContactId)
    .gte('created_at', since24h);

  if (emailErr) {
    console.error('[init-export] email rate', emailErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }
  if ((emailCount ?? 0) >= MAX_EXPORTS_PER_EMAIL_24H) {
    return jsonRes({ error: 'Export limit reached for this email (24h)', code: 'RATE_LIMIT_EMAIL' }, 429);
  }

  if (requestType === 'pdf_export' && tier === 'free') {
    const { data: sumRows, error: sumErr } = await supabase
      .from('export_requests')
      .select('audio_video_page_count')
      .eq('crm_contact_id', crmContactId)
      .eq('subscription_tier', 'free')
      .eq('type', 'pdf_export')
      .eq('status', 'done');

    if (sumErr) {
      console.error('[init-export] av sum', sumErr.message);
      return jsonRes({ error: 'Database error' }, 500);
    }

    let current = 0;
    for (const r of sumRows ?? []) {
      const n = (r as { audio_video_page_count: number | null }).audio_video_page_count;
      if (typeof n === 'number' && n > 0) current += n;
    }
    if (current + avCount > FREE_AV_MAX_CUMULATIVE) {
      return jsonRes(
        {
          error: 'BOOK_AV_LIMIT_EXCEEDED',
          maxAllowed: FREE_AV_MAX_CUMULATIVE,
          current,
          requested: avCount,
        },
        400
      );
    }
  }

  const childLocalId =
    typeof body.child_local_id === 'string' && body.child_local_id.trim() ? body.child_local_id.trim() : null;

  if (requestType === 'print_order') {
    const shipName = typeof body.shipping_name === 'string' ? body.shipping_name.trim() : '';
    if (!shipName) {
      return jsonRes({ error: 'shipping_name required' }, 400);
    }
    const addrParsed = parseShippingAddress(body.shipping_address_json);
    if (!addrParsed.ok) {
      return jsonRes({ error: addrParsed.message }, 400);
    }
    const bpRaw = body.billable_pages;
    if (typeof bpRaw !== 'number' || !Number.isInteger(bpRaw) || bpRaw < 1 || bpRaw > 200) {
      return jsonRes({ error: 'billable_pages invalid (1–200)' }, 400);
    }
    const discRaw = body.discount_percent;
    if (discRaw != null && discRaw !== 0 && discRaw !== 20) {
      return jsonRes({ error: 'discount_percent must be 0, 20 or omitted' }, 400);
    }
    let discountPercent: DiscountPercent = 0;
    if (tier === 'free') {
      if (discRaw === 20) {
        return jsonRes({ error: 'discount_percent 20 requires paid subscription' }, 400);
      }
      discountPercent = 0;
    } else {
      discountPercent = discRaw === 20 ? 20 : 0;
    }

    const priceCents = calculateBookPriceCents(bpRaw, discountPercent);
    const printerName =
      typeof body.printer_name === 'string' && body.printer_name.trim() ? body.printer_name.trim() : null;

    const { data: inserted, error: insErr } = await supabase
      .from('export_requests')
      .insert({
        crm_contact_id: crmContactId,
        user_id: null,
        type: 'print_order',
        export_mode: 'print',
        status: 'created',
        book_id: bookId,
        child_local_id: childLocalId,
        subscription_tier: tier,
        audio_video_page_count: avCount,
        client_ip_hash: ipHash,
        shipping_name: shipName,
        shipping_address_json: addrParsed.value,
        billable_pages: bpRaw,
        price_cents: priceCents,
        discount_percent: discountPercent,
        printer_name: printerName,
      })
      .select('id')
      .single();

    if (insErr || !inserted?.id) {
      console.error('[init-export] insert print_order', insErr?.message);
      return jsonRes({ error: 'Database error' }, 500);
    }

    const exportRequestId = inserted.id as string;
    const secret = new TextEncoder().encode(jwtSecret);
    const exportTicket = await new SignJWT({
      petitmo_ticket: 'export_print',
      export_request_id: exportRequestId,
      crm_contact_id: crmContactId,
      book_id: bookId,
      subscription_tier: tier,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('20m')
      .setIssuer('petitmo-init-export')
      .sign(secret);

    return jsonRes(
      {
        exportRequestId,
        crmContactId,
        exportTicket,
        priceCents,
        billablePages: bpRaw,
        discountPercent,
        expiresInSeconds: 20 * 60,
        flow: 'print_order',
      },
      200
    );
  }

  const { data: inserted, error: insErr } = await supabase
    .from('export_requests')
    .insert({
      crm_contact_id: crmContactId,
      user_id: null,
      type: 'pdf_export',
      export_mode: exportMode,
      status: 'created',
      book_id: bookId,
      child_local_id: childLocalId,
      subscription_tier: tier,
      audio_video_page_count: avCount,
      client_ip_hash: ipHash,
    })
    .select('id')
    .single();

  if (insErr || !inserted?.id) {
    console.error('[init-export] insert export', insErr?.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  const exportRequestId = inserted.id as string;

  const secret = new TextEncoder().encode(jwtSecret);
  const pdfTicket = await new SignJWT({
    petitmo_ticket: 'export_pdf',
    export_request_id: exportRequestId,
    crm_contact_id: crmContactId,
    book_id: bookId,
    subscription_tier: tier,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('20m')
    .setIssuer('petitmo-init-export')
    .sign(secret);

  return jsonRes(
    {
      exportRequestId,
      crmContactId,
      pdfTicket,
      expiresInSeconds: 20 * 60,
      flow: 'pdf_export',
    },
    200
  );
});
