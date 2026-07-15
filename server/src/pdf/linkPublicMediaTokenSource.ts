import type { SupabaseClient } from '@supabase/supabase-js';
import type { MemoryRow } from './memoryRow';

type TokenRow = {
  status: string;
  raw_bucket: string | null;
  raw_path: string | null;
  ready_path: string | null;
};

/** Chemin Storage `media` utilisable par le worker QR (service role). */
function memoryCloudMediaStoragePath(m: MemoryRow): string | null {
  const p = (m.media_path ?? '').trim();
  if (!p) return null;
  if (p.startsWith('http://') || p.startsWith('https://')) return null;
  return p.replace(/^\/?media\//, '');
}

/**
 * Rattache un token `public_media_tokens` à la source cloud du souvenir (`memories.media_path`
 * dans le bucket `media`) pour que le worker puisse transcodifier vers `qr-media/ready/`.
 *
 * Ne remplace pas un upload guest déjà planifié (`qr-media/raw/…`).
 * Ne modifie jamais un token `ready` — voir `docs/specs/qr-media-permanence.md` et trigger SQL.
 */
export async function linkPublicMediaTokenToMemorySource(
  supabase: SupabaseClient,
  token: string,
  memory: MemoryRow,
): Promise<void> {
  const storagePath = memoryCloudMediaStoragePath(memory);
  if (!storagePath) return;

  const { data, error } = await supabase
    .from('public_media_tokens')
    .select('status, raw_bucket, raw_path, ready_path')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const row = data as TokenRow | null;
  if (!row) return;

  if (row.status === 'ready' && (row.ready_path ?? '').trim()) {
    return;
  }

  const existingRaw = (row.raw_path ?? '').trim();
  if (row.raw_bucket === 'qr-media' && existingRaw.startsWith('raw/')) {
    return;
  }

  if (row.raw_bucket === 'media' && row.raw_path === storagePath && row.status !== 'failed') {
    return;
  }

  const nextStatus =
    row.status === 'processing' ? 'processing' : row.status === 'ready' ? 'ready' : 'pending_upload';

  const { error: upErr } = await supabase
    .from('public_media_tokens')
    .update({
      raw_bucket: 'media',
      raw_path: storagePath,
      status: nextStatus === 'ready' ? 'pending_upload' : nextStatus,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('token', token);

  if (upErr) {
    throw new Error(upErr.message);
  }
}
