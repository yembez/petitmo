/**
 * Touch activité compte (inactivité 24 mois).
 * Auth utilisateur → upsert account_activity.last_active_at (throttle serveur 12 h).
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

const THROTTLE_MS = 12 * 60 * 60 * 1000;

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt || jwt === anonKey) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user?.id) {
    return jsonRes({ error: 'Unauthorized' }, 401);
  }

  const email = (userData.user.email ?? '').toLowerCase();
  if (email.endsWith('@petitmo.local')) {
    return jsonRes({ ok: true, skipped: 'device_user' }, 200);
  }

  const userId = userData.user.id;
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: existing } = await admin
    .from('account_activity')
    .select('last_active_at')
    .eq('user_id', userId)
    .maybeSingle();

  const now = Date.now();
  if (existing?.last_active_at) {
    const prev = Date.parse(existing.last_active_at as string);
    if (Number.isFinite(prev) && now - prev < THROTTLE_MS) {
      return jsonRes({ ok: true, throttled: true }, 200);
    }
  }

  const iso = new Date(now).toISOString();
  const { error: upsertErr } = await admin.from('account_activity').upsert(
    {
      user_id: userId,
      last_active_at: iso,
      updated_at: iso,
    },
    { onConflict: 'user_id' },
  );
  if (upsertErr) {
    console.error('[touch-activity]', upsertErr.message);
    return jsonRes({ error: 'Database error' }, 500);
  }

  return jsonRes({ ok: true, last_active_at: iso }, 200);
});
