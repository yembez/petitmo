/**
 * Cron santé Storage : détecte les fiches memories dont media_path n’existe plus.
 * Auth : Bearer MEDIA_INTEGRITY_CRON_SECRET (ou MEDIA_WORKER_SECRET).
 * Délègue au media-worker `/media-integrity-audit` (+ optionnel `/backup-mirror-sync`).
 */
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function cronSecret(): string {
  return (
    (Deno.env.get('MEDIA_INTEGRITY_CRON_SECRET') ?? '').trim() ||
    (Deno.env.get('MEDIA_WORKER_SECRET') ?? '').trim()
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const secret = cronSecret();
  const workerUrl = (Deno.env.get('MEDIA_WORKER_URL') ?? '').replace(/\/+$/, '');
  const workerSecret = (Deno.env.get('MEDIA_WORKER_SECRET') ?? '').trim();
  if (!secret || !workerUrl || !workerSecret) {
    return json(500, { error: 'Server misconfiguration' });
  }

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token || token !== secret) return json(401, { error: 'Unauthorized' });

  const body = await req.json().catch(() => ({}));
  const runMirror = body?.mirror === true;

  try {
    const auditResp = await fetch(`${workerUrl}/media-integrity-audit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': workerSecret,
      },
      body: JSON.stringify({
        limit: typeof body?.limit === 'number' ? body.limit : 100,
        offset: typeof body?.offset === 'number' ? body.offset : 0,
        types: body?.types,
      }),
    });
    const auditText = await auditResp.text();
    let auditJson: Record<string, unknown> = {};
    try {
      auditJson = JSON.parse(auditText) as Record<string, unknown>;
    } catch {
      auditJson = { raw: auditText };
    }

    if (!auditResp.ok) {
      console.error('[media-integrity-audit] worker', auditResp.status, auditText.slice(0, 500));
      return json(auditResp.status, auditJson);
    }

    const missingCount = Number(auditJson.missingCount ?? 0);
    if (missingCount > 0) {
      console.error(
        '[media-integrity-audit] CRITICAL missing objects',
        missingCount,
        JSON.stringify(auditJson.missing ?? []).slice(0, 2000),
      );
    }

    let mirrorJson: unknown = null;
    if (runMirror) {
      const mirrorResp = await fetch(`${workerUrl}/backup-mirror-sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worker-Secret': workerSecret,
        },
        body: JSON.stringify({
          limit: typeof body?.mirrorLimit === 'number' ? body.mirrorLimit : 40,
          offset: typeof body?.mirrorOffset === 'number' ? body.mirrorOffset : 0,
        }),
      });
      mirrorJson = await mirrorResp.json().catch(() => ({ ok: false }));
    }

    return json(200, {
      ok: true,
      audit: auditJson,
      mirror: mirrorJson,
      critical: missingCount > 0,
    });
  } catch (e) {
    console.error('[media-integrity-audit]', e);
    return json(500, { error: String(e) });
  }
});
