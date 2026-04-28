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

    const { data: memory, error } = await supabase
      .from('memories')
      .select('id,user_id')
      .eq('id', memoryId)
      .maybeSingle();
    if (error || !memory) return json(404, { error: 'Memory not found' });
    if (memory.user_id !== auth.user.id) return json(403, { error: 'Forbidden' });

    const workerUrl = (Deno.env.get('MEDIA_WORKER_URL') ?? '').replace(/\/+$/, '');
    const workerSecret = Deno.env.get('MEDIA_WORKER_SECRET') ?? '';
    if (!workerUrl || !workerSecret) return json(500, { error: 'Worker not configured' });

    const resp = await fetch(`${workerUrl}/process-memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': workerSecret },
      body: JSON.stringify({ memoryId }),
    });

    const text = await resp.text();
    return new Response(text || JSON.stringify({ ok: resp.ok }), {
      status: resp.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[process-memory] error', e);
    return json(500, { error: String(e) });
  }
});

