/**
 * Copie immédiate d’un objet Storage `media` → Cloudflare R2.
 * Appelée après upload réussi (app) — pas de secret worker côté client.
 *
 * Auth : Bearer JWT utilisatrice. Le path doit commencer par `${user.id}/`.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return json(401, { error: 'Unauthorized' });

  const workerUrl = (Deno.env.get('MEDIA_WORKER_URL') ?? '').replace(/\/+$/, '');
  const workerSecret = (Deno.env.get('MEDIA_WORKER_SECRET') ?? '').trim();
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!workerUrl || !workerSecret || !supabaseUrl || !anonKey) {
    return json(500, { error: 'Server misconfiguration' });
  }

  const body = await req.json().catch(() => ({}));
  const rawPath = typeof body?.path === 'string' ? body.path.trim() : '';
  const path = rawPath.replace(/^\/+/, '').replace(/^media\//, '');
  if (!path || path.includes('..')) return json(400, { error: 'path requis' });

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user?.id) return json(401, { error: 'Unauthorized' });

  const uid = auth.user.id;
  if (!path.startsWith(`${uid}/`)) {
    return json(403, { error: 'path_not_owned' });
  }

  try {
    const resp = await fetch(`${workerUrl}/backup-mirror-object`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': workerSecret,
      },
      body: JSON.stringify({ path }),
    });
    const text = await resp.text();
    return new Response(text || JSON.stringify({ ok: resp.ok }), {
      status: resp.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[mirror-media-to-r2]', e);
    return json(500, { error: String(e) });
  }
});
