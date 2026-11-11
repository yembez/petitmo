import { createClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const body = await req.json().catch(() => ({}));
    const memoryId = typeof body?.memoryId === 'string' ? body.memoryId : '';
    const paths = Array.isArray(body?.paths)
      ? body.paths.filter((p: unknown) => typeof p === 'string' && p.trim())
      : [];
    const userId = typeof body?.userId === 'string' ? body.userId.trim() : '';
    const childId = typeof body?.childId === 'string' ? body.childId.trim() : '';

    if (!memoryId) return json(400, { error: 'memoryId requis' });
    if (!authHeader.toLowerCase().startsWith('bearer ')) return json(401, { error: 'Unauthorized' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return json(401, { error: 'Unauthorized' });

    const workerUrl = (Deno.env.get('MEDIA_WORKER_URL') ?? '').replace(/\/+$/, '');
    const workerSecret = Deno.env.get('MEDIA_WORKER_SECRET') ?? '';
    if (!workerUrl || !workerSecret) return json(500, { error: 'Worker not configured' });

    /**
     * Chemins snapshot côté app (après DELETE row) — ne jamais demander au worker
     * d’effacer le Storage en se basant uniquement sur une row encore vivante.
     */
    const resp = await fetch(`${workerUrl}/delete-memory-assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': workerSecret },
      body: JSON.stringify({
        memoryId,
        paths,
        userId: userId || undefined,
        childId: childId || undefined,
        requestedBy: auth.user.id,
      }),
    });

    const text = await resp.text();
    return new Response(text || JSON.stringify({ ok: resp.ok }), {
      status: resp.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[delete-memory-assets] error', e);
    return json(500, { error: String(e) });
  }
});
