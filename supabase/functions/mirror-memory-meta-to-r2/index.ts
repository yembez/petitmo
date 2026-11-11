/**
 * Snapshot JSON d’un souvenir (texte + méta) → Cloudflare R2.
 * Appelée après insert/update cloud réussi — pas de secret worker côté client.
 *
 * Auth : Bearer JWT utilisatrice. La ligne memories doit appartenir à user.id.
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
  const memoryId = typeof body?.memoryId === 'string' ? body.memoryId.trim() : '';
  if (!memoryId || !/^[0-9a-f-]{36}$/i.test(memoryId)) {
    return json(400, { error: 'memoryId requis' });
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user?.id) return json(401, { error: 'Unauthorized' });

  const { data: row, error: rowErr } = await supabase
    .from('memories')
    .select('id,user_id')
    .eq('id', memoryId)
    .eq('user_id', auth.user.id)
    .maybeSingle();
  if (rowErr) return json(500, { error: rowErr.message });
  if (!row) return json(404, { error: 'memory_not_found' });

  try {
    const resp = await fetch(`${workerUrl}/backup-memory-meta`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': workerSecret,
      },
      body: JSON.stringify({ memoryId }),
    });
    const text = await resp.text();
    return new Response(text || JSON.stringify({ ok: resp.ok }), {
      status: resp.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[mirror-memory-meta-to-r2]', e);
    return json(500, { error: String(e) });
  }
});
