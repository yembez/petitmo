import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return jsonRes({ error: 'Invalid email' }, 400);
  }

  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const nowIso = new Date().toISOString();

  const { data: existing, error: findErr } = await supabase
    .from('crm_contacts')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (findErr) {
    console.error('[crm-marketing-opt-in] find', findErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  if (existing?.id) {
    const { error: upErr } = await supabase
      .from('crm_contacts')
      .update({ marketing_opt_in: true, gdpr_consent_at: nowIso, last_seen_at: nowIso })
      .eq('id', existing.id as string);
    if (upErr) {
      console.error('[crm-marketing-opt-in] update', upErr.message);
      return jsonRes({ error: 'Database error' }, 500);
    }
    return jsonRes({ ok: true }, 200);
  }

  const { error: insErr } = await supabase.from('crm_contacts').insert({
    email,
    full_name: null,
    address_json: null,
    marketing_opt_in: true,
    gdpr_consent_at: nowIso,
    last_seen_at: nowIso,
  });

  if (insErr) {
    console.error('[crm-marketing-opt-in] insert', insErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  return jsonRes({ ok: true }, 200);
});
