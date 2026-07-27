/**
 * Suppression du compte Auth de l’utilisatrice connectée (Apple App Store P0).
 * JWT utilisateur requis ; admin.deleteUser via service role.
 */
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return jsonRes({ error: 'Unauthorized' }, 401);
    }

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !serviceKey || !anonKey) {
      return jsonRes({ error: 'Server misconfigured' }, 500);
    }

    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData.user?.id) {
      return jsonRes({ error: 'Unauthorized' }, 401);
    }

    const email = (userData.user.email ?? '').toLowerCase();
    if (email.endsWith('@petitmo.local')) {
      return jsonRes({ error: 'Device user cannot be deleted' }, 400);
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: deleteError } = await admin.auth.admin.deleteUser(userData.user.id);
    if (deleteError) {
      console.error('[delete-account]', deleteError);
      return jsonRes({ error: deleteError.message }, 400);
    }

    return jsonRes({ ok: true }, 200);
  } catch (e) {
    console.error('[delete-account]', e);
    return jsonRes(
      { error: e instanceof Error ? e.message : 'Delete failed' },
      500,
    );
  }
});
