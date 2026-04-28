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
    const { memoryId } = await req.json().catch(() => ({}));

    if (!memoryId || typeof memoryId !== 'string') return json(400, { error: 'memoryId requis' });
    if (!authHeader.toLowerCase().startsWith('bearer ')) return json(401, { error: 'Unauthorized' });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return json(401, { error: 'Unauthorized' });

    // Memory is already deleted in DB when this is called from the app, so we can't verify ownership via DB.
    // We still require a valid authenticated session, and delegate deletion to the worker by memoryId.
    const workerUrl = (Deno.env.get('MEDIA_WORKER_URL') ?? '').replace(/\/+$/, '');
    const workerSecret = Deno.env.get('MEDIA_WORKER_SECRET') ?? '';
    if (!workerUrl || !workerSecret) return json(500, { error: 'Worker not configured' });

    const resp = await fetch(`${workerUrl}/delete-memory-assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': workerSecret },
      body: JSON.stringify({ memoryId, requestedBy: auth.user.id }),
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

