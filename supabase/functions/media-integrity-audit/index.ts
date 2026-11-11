/**
 * Cron santé Storage : détecte + heal silencieux depuis R2.
 * Auth : Bearer MEDIA_INTEGRITY_CRON_SECRET (ou MEDIA_WORKER_SECRET).
 * Délègue au media-worker : audit/heal media, mirror, meta, QR, purge trash.
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

async function postWorker(
  workerUrl: string,
  workerSecret: string,
  path: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const resp = await fetch(`${workerUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Worker-Secret': workerSecret,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: resp.ok, status: resp.status, raw: text.slice(0, 500) };
  }
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
  const runMeta = body?.meta === true || runMirror;
  const runQr = body?.qr === true || runMirror;
  const runPurge = body?.purgeTrash === true;
  const healFromR2 = body?.heal !== false;

  try {
    const auditJson = (await postWorker(workerUrl, workerSecret, '/media-integrity-audit', {
      limit: typeof body?.limit === 'number' ? body.limit : 100,
      offset: typeof body?.offset === 'number' ? body.offset : 0,
      types: body?.types,
      healFromR2,
    })) as Record<string, unknown>;

    const missingCount = Number(auditJson.missingCount ?? 0);
    const r2AlsoMissing = Number(auditJson.r2AlsoMissingCount ?? 0);
    if (missingCount > 0 || r2AlsoMissing > 0) {
      console.error(
        '[media-integrity-audit] CRITICAL',
        { missingCount, r2AlsoMissing, restored: auditJson.restoredCount },
        JSON.stringify(auditJson.missing ?? []).slice(0, 2000),
      );
    }

    let mirrorJson: unknown = null;
    if (runMirror) {
      mirrorJson = await postWorker(workerUrl, workerSecret, '/backup-mirror-sync', {
        limit: typeof body?.mirrorLimit === 'number' ? body.mirrorLimit : 40,
        offset: typeof body?.mirrorOffset === 'number' ? body.mirrorOffset : 0,
      });
    }

    let metaJson: unknown = null;
    if (runMeta) {
      metaJson = await postWorker(workerUrl, workerSecret, '/backup-memories-meta-sync', {
        limit: typeof body?.metaLimit === 'number' ? body.metaLimit : 100,
        offset: typeof body?.metaOffset === 'number' ? body.metaOffset : 0,
        types: body?.metaTypes,
      });
    }

    let qrJson: unknown = null;
    if (runQr) {
      qrJson = await postWorker(workerUrl, workerSecret, '/backup-qr-sync', {
        limit: typeof body?.qrLimit === 'number' ? body.qrLimit : 40,
        offset: typeof body?.qrOffset === 'number' ? body.qrOffset : 0,
        healFromR2,
      });
    }

    let purgeJson: unknown = null;
    if (runPurge) {
      purgeJson = await postWorker(workerUrl, workerSecret, '/backup-purge-trash', {
        days: typeof body?.trashDays === 'number' ? body.trashDays : 90,
        bucket: 'media',
      });
    }

    return json(200, {
      ok: true,
      audit: auditJson,
      mirror: mirrorJson,
      meta: metaJson,
      qr: qrJson,
      purgeTrash: purgeJson,
      critical: missingCount > 0 || r2AlsoMissing > 0,
    });
  } catch (e) {
    console.error('[media-integrity-audit]', e);
    return json(500, { error: String(e) });
  }
});
