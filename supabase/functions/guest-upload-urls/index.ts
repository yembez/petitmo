import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { jwtVerify } from 'npm:jose@5.9.6';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const ISSUER = 'petitmo-init-export';

type TicketPayload = {
  petitmo_ticket: 'export_pdf' | 'export_print';
  export_request_id: string;
  crm_contact_id: string;
  book_id: string;
  subscription_tier: 'free' | 'paid';
};

async function verifyPdfTicket(raw: unknown, jwtSecret: string): Promise<TicketPayload | null> {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const { payload } = await jwtVerify(raw.trim(), new TextEncoder().encode(jwtSecret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
    });
    const p = payload as Record<string, unknown>;
    const petitmo_ticket = p.petitmo_ticket;
    if (petitmo_ticket !== 'export_pdf' && petitmo_ticket !== 'export_print') return null;
    const export_request_id = typeof p.export_request_id === 'string' ? p.export_request_id : '';
    const crm_contact_id = typeof p.crm_contact_id === 'string' ? p.crm_contact_id : '';
    const book_id = typeof p.book_id === 'string' ? p.book_id : '';
    const subscription_tier = p.subscription_tier === 'free' || p.subscription_tier === 'paid' ? p.subscription_tier : null;
    if (!export_request_id || !crm_contact_id || !book_id || !subscription_tier) return null;
    return { petitmo_ticket, export_request_id, crm_contact_id, book_id, subscription_tier };
  } catch {
    return null;
  }
}

function base64Url(bytes: Uint8Array): string {
  // btoa expects binary string
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function newPublicToken(): string {
  const bytes = new Uint8Array(27);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function ensurePublicMediaToken(supabase: ReturnType<typeof createClient>, params: { mediaId: string; kind: 'audio' | 'video' }): Promise<string> {
  const { mediaId, kind } = params;
  const { data: existing, error: selErr } = await supabase
    .from('public_media_tokens')
    .select('token')
    .eq('media_id', mediaId)
    .eq('kind', kind)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  const tok = (existing as { token?: unknown } | null)?.token;
  if (typeof tok === 'string' && tok.trim()) return tok;

  const token = newPublicToken();
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
  });
  if (!insErr) return token;

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

type AssetKind = 'cover' | 'photo' | 'voice_cover' | 'audio' | 'video' | 'video_thumb';
type AssetReq = {
  kind: AssetKind;
  /** Requis pour photo/voice_cover/audio/video/video_thumb. */
  memoryId?: string;
};

type Body = {
  pdfTicket?: string;
  assets?: AssetReq[];
};

function normalizeAssets(raw: unknown): AssetReq[] | null {
  if (!Array.isArray(raw)) return null;
  const out: AssetReq[] = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') return null;
    const o = it as Record<string, unknown>;
    const kind = o.kind;
    if (
      kind !== 'cover' &&
      kind !== 'photo' &&
      kind !== 'voice_cover' &&
      kind !== 'audio' &&
      kind !== 'video' &&
      kind !== 'video_thumb'
    )
      return null;
    const memoryId = typeof o.memoryId === 'string' ? o.memoryId.trim() : '';
    if (kind !== 'cover' && !memoryId) return null;
    out.push({ kind, memoryId: memoryId || undefined });
  }
  return out;
}

function safeIdSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return jsonRes({ error: 'Method not allowed' }, 405);

  const jwtSecret = Deno.env.get('EXPORT_PDF_JWT_SECRET');
  if (!jwtSecret || jwtSecret.length < 32) {
    console.error('[guest-upload-urls] EXPORT_PDF_JWT_SECRET manquant ou trop court (min 32 car.)');
    return jsonRes({ error: 'Server misconfiguration' }, 500);
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return jsonRes({ error: 'Invalid JSON' }, 400);
  }

  const ticket = await verifyPdfTicket(body.pdfTicket, jwtSecret);
  if (!ticket || ticket.petitmo_ticket !== 'export_pdf') {
    return jsonRes({ error: 'Invalid pdfTicket' }, 401);
  }

  const assets = normalizeAssets(body.assets);
  if (!assets || assets.length < 1 || assets.length > 200) {
    return jsonRes({ error: 'assets invalid' }, 400);
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const exportRequestId = ticket.export_request_id;
  const results: Array<{
    kind: AssetKind;
    memoryId: string | null;
    bucket: string;
    path: string;
    signedUrl: string;
    token?: string;
    publicUrl?: string;
  }> = [];

  for (const a of assets) {
    const memoryId = (a.memoryId ?? '').trim();
    if (a.kind === 'cover' || a.kind === 'photo' || a.kind === 'voice_cover' || a.kind === 'video_thumb') {
      const bucket = 'media';
      const idSeg = a.kind === 'cover' ? 'cover' : safeIdSegment(memoryId);
      const path = `guest/exports/${exportRequestId}/${a.kind}/${idSeg}.jpg`;
      // Second appel après PUT : sans upsert, l’API répond « The resource already exists ».
      const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
      if (error || !data?.signedUrl) {
        console.error('[guest-upload-urls] sign upload', error?.message);
        return jsonRes({ error: 'Storage error' }, 500);
      }
      // `createSignedUrl` (lecture) échoue tant que l’objet n’existe pas (avant le PUT) → normal.
      // L’app refait un appel après upload pour obtenir `publicUrl`.
      const readTtl = 60 * 60 * 24 * 7;
      const { data: readSigned, error: readErr } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, readTtl);
      const publicUrl =
        !readErr && readSigned?.signedUrl ? readSigned.signedUrl : undefined;
      if (!publicUrl && readErr?.message) {
        console.log('[guest-upload-urls] sign read skipped (before upload)', readErr.message);
      }
      results.push({
        kind: a.kind,
        memoryId: a.kind === 'cover' ? null : memoryId,
        bucket,
        path,
        signedUrl: data.signedUrl,
        ...(publicUrl ? { publicUrl } : {}),
      });
      continue;
    }

    if (a.kind === 'audio' || a.kind === 'video') {
      const bucket = 'qr-media';
      const ext = a.kind === 'audio' ? 'm4a' : 'mp4';
      const path = `raw/${exportRequestId}/${a.kind}/${safeIdSegment(memoryId)}.${ext}`;
      const token = await ensurePublicMediaToken(supabase, { mediaId: memoryId, kind: a.kind });

      // On pré-enregistre où sera l’upload raw (le worker pourra vérifier/relancer).
      await supabase
        .from('public_media_tokens')
        .update({ raw_bucket: bucket, raw_path: path, status: 'pending_upload', updated_at: new Date().toISOString() })
        .eq('media_id', memoryId)
        .eq('kind', a.kind);

      const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
      if (error || !data?.signedUrl) {
        console.error('[guest-upload-urls] sign upload', error?.message);
        return jsonRes({ error: 'Storage error' }, 500);
      }
      results.push({
        kind: a.kind,
        memoryId,
        bucket,
        path,
        signedUrl: data.signedUrl,
        token,
      });
      continue;
    }

    return jsonRes({ error: 'Unsupported kind' }, 400);
  }

  return jsonRes(
    {
      ok: true,
      exportRequestId,
      uploads: results,
    },
    200
  );
});

