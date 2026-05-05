import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type PublicMediaTokenRow = {
  token: string;
  media_id: string;
  kind: 'audio' | 'video';
  status: 'pending_upload' | 'uploaded' | 'processing' | 'ready' | 'failed';
  raw_bucket: string | null;
  raw_path: string | null;
  ready_bucket: string | null;
  ready_path: string | null;
  last_error: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Token base64url non devinable. */
export function newPublicToken(): string {
  return randomBytes(27).toString('base64url');
}

/**
 * Récupère (ou crée) un token stable pour un media (audio/vidéo).
 * MVP: `media_id` peut être un id "local" (guest) ou un id Supabase.
 */
export async function ensurePublicMediaToken(params: {
  supabase: SupabaseClient;
  mediaId: string;
  kind: 'audio' | 'video';
  /** Nouveaux tokens : fin d’accès QR (spec 10 ans). */
  expiresAtIso?: string | null;
}): Promise<string> {
  const { supabase, mediaId, kind, expiresAtIso } = params;
  const { data: existing, error: selErr } = await supabase
    .from('public_media_tokens')
    .select('token')
    .eq('media_id', mediaId)
    .eq('kind', kind)
    .maybeSingle();
  if (selErr) {
    throw new Error(selErr.message);
  }
  const tok = (existing as { token?: unknown } | null)?.token;
  if (typeof tok === 'string' && tok.trim()) return tok;

  const token = newPublicToken();
  const exp =
    typeof expiresAtIso === 'string' && expiresAtIso.trim() ? expiresAtIso.trim() : null;
  const { error: insErr } = await supabase.from('public_media_tokens').insert({
    token,
    media_id: mediaId,
    kind,
    status: 'pending_upload',
    raw_bucket: null,
    raw_path: null,
    ready_bucket: null,
    ready_path: null,
    last_error: null,
    ...(exp ? { expires_at: exp } : {}),
  });
  if (insErr) {
    // Conflit concurrent: relire
    const { data: again } = await supabase
      .from('public_media_tokens')
      .select('token')
      .eq('media_id', mediaId)
      .eq('kind', kind)
      .maybeSingle();
    const tok2 = (again as { token?: unknown } | null)?.token;
    if (typeof tok2 === 'string' && tok2.trim()) return tok2;
    throw new Error(insErr.message);
  }
  return token;
}

