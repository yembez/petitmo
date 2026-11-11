import type { SupabaseClient } from '@supabase/supabase-js';

export const QR_MEDIA_BUCKET = 'qr-media';

export type QrMediaKind = 'audio' | 'video';

export function readyPathForToken(token: string, kind: QrMediaKind): string {
  const ext = kind === 'video' ? 'mp4' : 'm4a';
  return `ready/${token.trim()}.${ext}`;
}

/** Copie immuable de secours — jamais écrasée après première écriture. */
export function archivePathForToken(token: string, kind: QrMediaKind): string {
  const ext = kind === 'video' ? 'mp4' : 'm4a';
  return `archive/${token.trim()}.${ext}`;
}

export async function logPublicMediaTokenEvent(
  supabase: SupabaseClient,
  params: {
    token: string;
    mediaId?: string | null;
    kind?: QrMediaKind | null;
    event: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from('public_media_token_events').insert({
    token: params.token.trim(),
    media_id: params.mediaId?.trim() || null,
    kind: params.kind ?? null,
    event: params.event,
    detail: params.detail ?? null,
  });
  if (error) {
    console.warn('[qr-permanence] audit insert', params.token, error.message);
  }
}

async function downloadStorageObject(
  supabase: SupabaseClient,
  bucket: string,
  objectPath: string,
): Promise<Blob | null> {
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
  if (error || !data) return null;
  return data;
}

async function uploadArchiveCopy(
  supabase: SupabaseClient,
  token: string,
  kind: QrMediaKind,
  bytes: Buffer,
): Promise<void> {
  const archivePath = archivePathForToken(token, kind);
  const { error } = await supabase.storage.from(QR_MEDIA_BUCKET).upload(archivePath, bytes, {
    contentType: kind === 'video' ? 'video/mp4' : 'audio/mp4',
    upsert: false,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) {
    console.warn('[qr-permanence] archive upload', token, error.message);
  }
}

/**
 * Restaure `status=ready` si le fichier existe en Storage (`ready/` puis `archive/`).
 */
export async function tryHealReadyTokenFromStorage(
  supabase: SupabaseClient,
  token: string,
  kind: QrMediaKind,
  source = 'heal',
): Promise<boolean> {
  const trimmed = token.trim();
  if (!trimmed) return false;

  const readyPath = readyPathForToken(trimmed, kind);
  let fromPath = readyPath;
  let blob = await downloadStorageObject(supabase, QR_MEDIA_BUCKET, readyPath);

  if (!blob) {
    const archivePath = archivePathForToken(trimmed, kind);
    blob = await downloadStorageObject(supabase, QR_MEDIA_BUCKET, archivePath);
    if (!blob) {
      // Filet R2 (même ready_path) via media-worker — silent premium heal.
      const healedFromR2 = await restoreQrReadyFromR2BestEffort(readyPath);
      if (!healedFromR2) return false;
      blob = await downloadStorageObject(supabase, QR_MEDIA_BUCKET, readyPath);
      if (!blob) return false;
      fromPath = `r2:${readyPath}`;
    } else {
      fromPath = archivePath;
      const buf = Buffer.from(await blob.arrayBuffer());
      const { error: restoreErr } = await supabase.storage.from(QR_MEDIA_BUCKET).upload(readyPath, buf, {
        contentType: kind === 'video' ? 'video/mp4' : 'audio/mp4',
        upsert: true,
      });
      if (restoreErr) {
        console.warn('[qr-permanence] restore ready from archive', trimmed, restoreErr.message);
      }
    }
  }

  const { data: row } = await supabase
    .from('public_media_tokens')
    .select('media_id, status, ready_path')
    .eq('token', trimmed)
    .maybeSingle();

  if (
    (row as { status?: string } | null)?.status === 'ready' &&
    (row as { ready_path?: string | null } | null)?.ready_path?.trim() === readyPath
  ) {
    return true;
  }

  const { error: upErr } = await supabase
    .from('public_media_tokens')
    .update({
      status: 'ready',
      ready_bucket: QR_MEDIA_BUCKET,
      ready_path: readyPath,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('token', trimmed);

  if (upErr) {
    console.warn('[qr-permanence] heal db', trimmed, upErr.message);
    return false;
  }

  await logPublicMediaTokenEvent(supabase, {
    token: trimmed,
    mediaId: (row as { media_id?: string } | null)?.media_id,
    kind,
    event: 'healed_from_storage',
    detail: { source, fromPath, readyPath },
  });
  console.log('[qr-permanence] healed', trimmed, 'from', fromPath);
  return true;
}

/** Marque un token prêt + copie archive immuable. */
export async function markPublicMediaTokenReady(
  supabase: SupabaseClient,
  params: {
    token: string;
    mediaId: string;
    kind: QrMediaKind;
    readyBytes: Buffer;
  },
): Promise<void> {
  const readyPath = readyPathForToken(params.token, params.kind);
  const { error: upErr } = await supabase.storage.from(QR_MEDIA_BUCKET).upload(readyPath, params.readyBytes, {
    contentType: params.kind === 'video' ? 'video/mp4' : 'audio/mp4',
    upsert: true,
  });
  if (upErr) throw new Error(`upload ready failed: ${upErr.message}`);

  await uploadArchiveCopy(supabase, params.token, params.kind, params.readyBytes);

  const { error: upRowErr } = await supabase
    .from('public_media_tokens')
    .update({
      status: 'ready',
      ready_bucket: QR_MEDIA_BUCKET,
      ready_path: readyPath,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('token', params.token);

  if (upRowErr) throw new Error(upRowErr.message);

  await logPublicMediaTokenEvent(supabase, {
    token: params.token,
    mediaId: params.mediaId,
    kind: params.kind,
    event: 'marked_ready',
    detail: { readyPath, archivePath: archivePathForToken(params.token, params.kind) },
  });

  // Miroir R2 immédiat (silencieux) — filet cron si MEDIA_WORKER_* absent sur ce service.
  void mirrorQrPathsToR2BestEffort([readyPath, archivePathForToken(params.token, params.kind)]);
}

function mediaWorkerConfig(): { url: string; secret: string } | null {
  const url = (process.env.MEDIA_WORKER_URL ?? '').replace(/\/+$/, '');
  const secret = (process.env.MEDIA_WORKER_SECRET ?? '').trim();
  if (!url || !secret) return null;
  return { url, secret };
}

/** Fire-and-forget : copie ready/archive vers R2 via media-worker. */
async function mirrorQrPathsToR2BestEffort(paths: string[]): Promise<void> {
  const cfg = mediaWorkerConfig();
  if (!cfg) return;

  for (const raw of paths) {
    const path = String(raw || '').replace(/^\/+/, '').replace(/^qr-media\//, '');
    if (!path) continue;
    try {
      await fetch(`${cfg.url}/backup-mirror-qr-object`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worker-Secret': cfg.secret,
        },
        body: JSON.stringify({ path }),
      });
    } catch (e) {
      console.warn('[qr-permanence] mirror r2', path, e instanceof Error ? e.message : e);
    }
  }
}

/** Restore `ready/{token}.ext` depuis R2 (même path) — sans changer le token. */
async function restoreQrReadyFromR2BestEffort(readyPath: string): Promise<boolean> {
  const cfg = mediaWorkerConfig();
  if (!cfg) return false;
  const path = readyPath.replace(/^\/+/, '').replace(/^qr-media\//, '');
  try {
    const resp = await fetch(`${cfg.url}/backup-restore-qr-object`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worker-Secret': cfg.secret,
      },
      body: JSON.stringify({ path }),
    });
    const json = (await resp.json().catch(() => ({}))) as { restored?: boolean };
    return resp.ok && json.restored === true;
  } catch (e) {
    console.warn('[qr-permanence] restore r2', path, e instanceof Error ? e.message : e);
    return false;
  }
}
