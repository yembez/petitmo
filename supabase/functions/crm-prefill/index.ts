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

  const { data, error } = await supabase
    .from('crm_contacts')
    .select('full_name, address_json')
    .eq('email', email)
    .maybeSingle();

  if (error) {
    console.error('[crm-prefill]', error.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  if (!data) {
    return jsonRes({ full_name: null, address_json: null }, 200);
  }

  return jsonRes(
    {
      full_name: typeof data.full_name === 'string' ? data.full_name : null,
      address_json: data.address_json ?? null,
    },
    200
  );
});
