/**
 * Formulaire support in-app → e-mail contact@petitmo.app + archivage SQL.
 * Secrets : RESEND_API_KEY (envoi), optionnel SUPPORT_TO_EMAIL / SUPPORT_FROM_EMAIL.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const DEFAULT_TO = 'contact@petitmo.app';
const DEFAULT_FROM = 'Petitmo <contact@petitmo.app>';
const MIN_MESSAGE = 8;
const MAX_MESSAGE = 8000;
const RATE_LIMIT_MS = 30_000;

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (!e || e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
  return e;
}

function normalizeKind(raw: unknown): 'contact' | 'report' {
  return raw === 'report' ? 'report' : 'contact';
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
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) {
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  let body: {
    email?: string;
    message?: string;
    kind?: string;
    techContext?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const email = normalizeEmail(body.email);
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const kind = normalizeKind(body.kind);
  const techContext =
    typeof body.techContext === 'string' ? body.techContext.trim().slice(0, 4000) : '';

  if (!email) {
    return jsonRes({ error: 'Invalid email' }, 400);
  }
  if (message.length < MIN_MESSAGE || message.length > MAX_MESSAGE) {
    return jsonRes({ error: 'Invalid message' }, 400);
  }

  let userId: string | null = null;
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (jwt && jwt !== anonKey) {
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    userId = userData.user?.id ?? null;
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (userId) {
    const since = new Date(Date.now() - RATE_LIMIT_MS).toISOString();
    const { count } = await admin
      .from('support_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since);
    if ((count ?? 0) > 0) {
      return jsonRes({ error: 'Too many requests' }, 429);
    }
  }

  const { error: insertErr } = await admin.from('support_messages').insert({
    user_id: userId,
    email,
    kind,
    message,
    tech_context: techContext || null,
  });
  if (insertErr) {
    console.error('[support-contact] insert', insertErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  const toEmail = (Deno.env.get('SUPPORT_TO_EMAIL') ?? DEFAULT_TO).trim() || DEFAULT_TO;
  const fromEmail = (Deno.env.get('SUPPORT_FROM_EMAIL') ?? DEFAULT_FROM).trim() || DEFAULT_FROM;
  const resendKey = (Deno.env.get('RESEND_API_KEY') ?? '').trim();

  const subject =
    kind === 'report'
      ? `[Petitmo] Signalement — ${email}`
      : `[Petitmo] Contact — ${email}`;
  const text = [
    `De : ${email}`,
    userId ? `Compte : ${userId}` : 'Compte : (session absente)',
    `Type : ${kind}`,
    '',
    message,
    '',
    techContext || '(pas d’infos techniques)',
  ].join('\n');

  if (!resendKey) {
    console.warn('[support-contact] RESEND_API_KEY absent — message stocké, e-mail non envoyé');
    return jsonRes({ ok: true, emailed: false }, 200);
  }

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      reply_to: email,
      subject,
      text,
    }),
  });

  if (!resendRes.ok) {
    const detail = await resendRes.text().catch(() => '');
    console.error('[support-contact] resend', resendRes.status, detail.slice(0, 400));
    return jsonRes({ error: 'Email delivery failed' }, 502);
  }

  return jsonRes({ ok: true, emailed: true }, 200);
});
