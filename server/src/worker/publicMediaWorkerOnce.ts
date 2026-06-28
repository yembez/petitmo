import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const execFileAsync = promisify(execFile);

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

async function transcodeVideo(tmpDir: string, inputBuf: Buffer): Promise<Buffer> {
  const inPath = path.join(tmpDir, 'in_vid');
  const outPath = path.join(tmpDir, 'out.mp4');
  await writeFile(inPath, inputBuf);
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inPath,
    '-vf',
    'scale=-2:720:force_original_aspect_ratio=decrease',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outPath,
  ]);
  return readFile(outPath);
}

async function transcodeAudio(tmpDir: string, inputBuf: Buffer): Promise<Buffer> {
  const inPath = path.join(tmpDir, 'in_aud');
  const outPath = path.join(tmpDir, 'out.m4a');
  await writeFile(inPath, inputBuf);
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inPath,
    '-ac',
    '1',
    '-c:a',
    'aac',
    '-ar',
    '44100',
    '-b:a',
    '96k',
    '-movflags',
    '+faststart',
    outPath,
  ]);
  return readFile(outPath);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing env ${name}`);
  return v.trim();
}

export async function runPublicMediaWorkerOnce(): Promise<{ ok: boolean; processed: boolean }> {
  const url = requireEnv('SUPABASE_URL');
  const key = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

  const { data: row, error: selErr } = await supabase
    .from('public_media_tokens')
    .select('token,media_id,kind,status,raw_bucket,raw_path,ready_bucket,ready_path,last_error,updated_at')
    .in('status', ['pending_upload', 'uploaded'])
    .not('raw_bucket', 'is', null)
    .not('raw_path', 'is', null)
    .order('updated_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selErr) throw new Error(selErr.message);
  if (!row) return { ok: true, processed: false };

  const r = row as PublicMediaTokenRow;
  const tmp = await mkdtemp(path.join(tmpdir(), 'petitmo-qr-'));
  try {
    const { error: lockErr } = await supabase
      .from('public_media_tokens')
      .update({ status: 'processing', last_error: null, updated_at: new Date().toISOString() })
      .eq('token', r.token)
      .in('status', ['pending_upload', 'uploaded']);
    if (lockErr) throw new Error(lockErr.message);

    const { data: dl, error: dlErr } = await supabase.storage.from(r.raw_bucket!).download(r.raw_path!);
    if (dlErr || !dl) throw new Error(`download raw failed: ${dlErr?.message ?? 'no data'}`);
    const inputBuf = Buffer.from(await dl.arrayBuffer());

    const outBytes = r.kind === 'video' ? await transcodeVideo(tmp, inputBuf) : await transcodeAudio(tmp, inputBuf);

    const readyBucket = 'qr-media';
    const readyPath = `ready/${r.token}.${r.kind === 'video' ? 'mp4' : 'm4a'}`;
    const { error: upErr } = await supabase.storage.from(readyBucket).upload(readyPath, outBytes, {
      contentType: r.kind === 'video' ? 'video/mp4' : 'audio/mp4',
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
      .eq('token', r.token);
    if (upRowErr) throw new Error(upRowErr.message);

    return { ok: true, processed: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from('public_media_tokens')
      .update({ status: 'failed', last_error: msg.slice(0, 2000), updated_at: new Date().toISOString() })
      .eq('token', (row as PublicMediaTokenRow).token);
    throw e;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Traite jusqu’à `maxJobs` fichiers en attente (best-effort, ex. pendant le rendu PDF). */
export async function runPublicMediaWorkerBatch(params?: { maxJobs?: number }): Promise<number> {
  const maxJobs = Math.max(1, Math.min(params?.maxJobs ?? 8, 32));
  let done = 0;
  for (let i = 0; i < maxJobs; i++) {
    const r = await runPublicMediaWorkerOnce();
    if (!r.processed) break;
    done += 1;
  }
  return done;
}

