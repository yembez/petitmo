import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { transcodeAudioForQr, transcodeVideoForQr } from './ffmpegTranscode';

export type WorkerOnceResult = { ok: boolean; processed: boolean };

type PublicMediaTokenRow = {
  token: string;
  media_id: string;
  kind: 'audio' | 'video';
  status: 'pending_upload' | 'uploaded' | 'processing' | 'ready' | 'failed';
  raw_bucket: string | null;
  raw_path: string | null;
  ready_bucket: string | null;
  ready_path: string | null;
  last_error: string | null;
  updated_at: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing env ${name}`);
  return v.trim();
}

function createServiceClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function fetchPendingRow(
  supabase: SupabaseClient,
  token?: string,
): Promise<PublicMediaTokenRow | null> {
  const statuses = token
    ? (['pending_upload', 'uploaded', 'failed'] as const)
    : (['pending_upload', 'uploaded'] as const);

  let query = supabase
    .from('public_media_tokens')
    .select('token,media_id,kind,status,raw_bucket,raw_path,ready_bucket,ready_path,last_error,updated_at')
    .in('status', [...statuses])
    .not('raw_bucket', 'is', null)
    .not('raw_path', 'is', null);

  if (token) {
    const { data, error } = await query.eq('token', token).maybeSingle();
    if (error) throw new Error(error.message);
    return (data as PublicMediaTokenRow | null) ?? null;
  }

  const { data, error } = await query.order('updated_at', { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PublicMediaTokenRow | null) ?? null;
}

async function processTokenRow(
  supabase: SupabaseClient,
  row: PublicMediaTokenRow,
): Promise<WorkerOnceResult> {
  const tmp = await mkdtemp(path.join(tmpdir(), 'petitmo-qr-'));
  try {
    const { error: lockErr } = await supabase
      .from('public_media_tokens')
      .update({ status: 'processing', last_error: null, updated_at: new Date().toISOString() })
      .eq('token', row.token)
      .in('status', ['pending_upload', 'uploaded', 'failed']);
    if (lockErr) throw new Error(lockErr.message);

    const { data: dl, error: dlErr } = await supabase.storage.from(row.raw_bucket!).download(row.raw_path!);
    if (dlErr || !dl) throw new Error(`download raw failed: ${dlErr?.message ?? 'no data'}`);
    const inputBuf = Buffer.from(await dl.arrayBuffer());

    const outBytes =
      row.kind === 'video'
        ? await transcodeVideoForQr(tmp, inputBuf, row.raw_path)
        : await transcodeAudioForQr(tmp, inputBuf, row.raw_path);

    const readyBucket = 'qr-media';
    const readyPath = `ready/${row.token}.${row.kind === 'video' ? 'mp4' : 'm4a'}`;
    const { error: upErr } = await supabase.storage.from(readyBucket).upload(readyPath, outBytes, {
      contentType: row.kind === 'video' ? 'video/mp4' : 'audio/mp4',
      upsert: true,
    });
    if (upErr) throw new Error(`upload ready failed: ${upErr.message}`);

    const { error: upRowErr } = await supabase
      .from('public_media_tokens')
      .update({
        status: 'ready',
        ready_bucket: readyBucket,
        ready_path: readyPath,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('token', row.token);
    if (upRowErr) throw new Error(upRowErr.message);

    return { ok: true, processed: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[public media worker] job failed', row.token, msg);
    await supabase
      .from('public_media_tokens')
      .update({ status: 'failed', last_error: msg.slice(0, 2000), updated_at: new Date().toISOString() })
      .eq('token', row.token);
    return { ok: false, processed: true };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Traite un job QR (token ciblé ou le plus ancien en attente).
 * Ne lève pas : une erreur marque le token `failed` et la file peut continuer.
 */
export async function runPublicMediaWorkerOnce(opts?: { token?: string }): Promise<WorkerOnceResult> {
  const supabase = createServiceClient();
  const row = await fetchPendingRow(supabase, opts?.token?.trim() || undefined);
  if (!row) return { ok: true, processed: false };
  return processTokenRow(supabase, row);
}

/** Traite d’abord les tokens du livre courant, puis la file globale (best-effort). */
export async function runPublicMediaWorkerBatch(params?: {
  maxJobs?: number;
  priorityTokens?: string[];
}): Promise<number> {
  const priorityTokens = [...new Set((params?.priorityTokens ?? []).map(t => t.trim()).filter(Boolean))];
  const maxJobs = Math.max(1, Math.min(params?.maxJobs ?? 8, 32));
  let done = 0;

  for (const token of priorityTokens) {
    if (done >= maxJobs) break;
    const r = await runPublicMediaWorkerOnce({ token });
    if (r.processed) done += 1;
  }

  while (done < maxJobs) {
    const r = await runPublicMediaWorkerOnce();
    if (!r.processed) break;
    done += 1;
  }

  return done;
}

/** Attend que les tokens du livre passent `ready` (ou `failed`) avant de renvoyer le PDF. */
export async function ensureQrTokensReady(params: {
  supabase: SupabaseClient;
  tokens: string[];
  timeoutMs?: number;
}): Promise<void> {
  const tokens = [...new Set(params.tokens.map(t => t.trim()).filter(Boolean))];
  if (tokens.length === 0) return;

  const timeoutMs = Math.max(5_000, Math.min(params.timeoutMs ?? 120_000, 300_000));
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(tokens);

  while (pending.size > 0 && Date.now() < deadline) {
    for (const token of [...pending]) {
      const { data, error } = await params.supabase
        .from('public_media_tokens')
        .select('status')
        .eq('token', token)
        .maybeSingle();
      if (error) {
        console.warn('[ensureQrTokensReady] select', token, error.message);
        pending.delete(token);
        continue;
      }
      const status = (data as { status?: string } | null)?.status;
      if (status === 'ready') {
        pending.delete(token);
        continue;
      }
      if (status === 'failed') {
        await params.supabase
          .from('public_media_tokens')
          .update({ status: 'pending_upload', last_error: null, updated_at: new Date().toISOString() })
          .eq('token', token);
      }
      await runPublicMediaWorkerOnce({ token });
    }
    if (pending.size > 0) await sleep(400);
  }

  if (pending.size > 0) {
    console.warn('[ensureQrTokensReady] timeout', [...pending]);
  }
}

/** Déclenche le transcodage lors d’une visite `/m/{token}` (page « prend vie… »). */
export async function tryProcessPublicMediaTokenOnVisit(token: string): Promise<void> {
  const trimmed = token.trim();
  if (!trimmed) return;
  const supabase = createServiceClient();
  await supabase
    .from('public_media_tokens')
    .update({ status: 'pending_upload', last_error: null, updated_at: new Date().toISOString() })
    .eq('token', trimmed)
    .eq('status', 'failed');
  await runPublicMediaWorkerOnce({ token: trimmed });
}
