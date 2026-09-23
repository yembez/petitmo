/**
 * Suppression du compte Auth (Apple App Store P0).
 * Body JSON optionnel : `{ "mode": "voluntary" | "inactivity" }` (défaut voluntary).
 *
 * - voluntary : purge souvenirs + QR (ready/raw/archive) + tokens + deleteUser
 * - inactivity : purge compte / media / souvenirs ; conserve QR non expirés (15 ans)
 *
 * Spec : docs/specs/subscription-lifecycle-retention.md
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

type DeleteMode = 'voluntary' | 'inactivity';

function jsonRes(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function listStoragePathsRecursive(
  admin: SupabaseClient,
  bucket: string,
  folder: string,
): Promise<string[]> {
  const paths: string[] = [];
  const prefix = folder.replace(/^\/+|\/+$/g, '');
  const { data, error } = await admin.storage.from(bucket).list(prefix || undefined, {
    limit: 1000,
  });
  if (error) {
    console.warn('[delete-account] list', bucket, prefix, error.message);
    return paths;
  }
  for (const item of data ?? []) {
    const childPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id == null) {
      const nested = await listStoragePathsRecursive(admin, bucket, childPath);
      paths.push(...nested);
    } else {
      paths.push(childPath);
    }
  }
  return paths;
}

async function removeStoragePaths(
  admin: SupabaseClient,
  bucket: string,
  paths: string[],
): Promise<void> {
  const unique = [...new Set(paths.map(p => p.trim()).filter(Boolean))];
  const chunkSize = 100;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const { error } = await admin.storage.from(bucket).remove(chunk);
    if (error) {
      console.warn('[delete-account] remove', bucket, chunk.length, error.message);
    }
  }
}

function isExpiredIso(expiresAt: string | null | undefined): boolean {
  if (!expiresAt || typeof expiresAt !== 'string') return false;
  const t = Date.parse(expiresAt);
  return Number.isFinite(t) && t <= Date.now();
}

async function purgeUserStorage(
  admin: SupabaseClient,
  userId: string,
  mode: DeleteMode,
): Promise<void> {
  const mediaPaths = await listStoragePathsRecursive(admin, 'media', userId);
  await removeStoragePaths(admin, 'media', mediaPaths);

  const booksPaths = [
    ...(await listStoragePathsRecursive(admin, 'books-pdf', `books/${userId}`)),
    ...(await listStoragePathsRecursive(admin, 'books-pdf', `_tmp/${userId}`)),
  ];
  await removeStoragePaths(admin, 'books-pdf', booksPaths);

  const { data: memories, error: memErr } = await admin
    .from('memories')
    .select('id, media_path')
    .eq('user_id', userId);
  if (memErr) {
    console.warn('[delete-account] memories select', memErr.message);
  }

  const memoryIds = (memories ?? []).map(m => m.id as string).filter(Boolean);
  const qrPaths: string[] = [];
  const tokenIdsToDelete: string[] = [];

  for (const row of memories ?? []) {
    const p = typeof row.media_path === 'string' ? row.media_path.trim() : '';
    if (p && !p.startsWith('http')) qrPaths.push(p);
  }

  if (memoryIds.length > 0) {
    const { data: tokens, error: tokErr } = await admin
      .from('public_media_tokens')
      .select('token, raw_path, ready_path, expires_at')
      .in('media_id', memoryIds);
    if (tokErr) {
      console.warn('[delete-account] public_media_tokens', tokErr.message);
    } else {
      for (const t of tokens ?? []) {
        const keepForBook =
          mode === 'inactivity' && !isExpiredIso(t.expires_at as string | null);
        if (keepForBook) continue;

        if (typeof t.raw_path === 'string' && t.raw_path.trim()) qrPaths.push(t.raw_path.trim());
        if (typeof t.ready_path === 'string' && t.ready_path.trim()) {
          qrPaths.push(t.ready_path.trim());
        }
        const tok = typeof t.token === 'string' ? t.token.trim() : '';
        if (tok) {
          qrPaths.push(`archive/${tok}.m4a`);
          qrPaths.push(`archive/${tok}.mp4`);
          tokenIdsToDelete.push(tok);
        }
      }
    }

    const { data: links, error: linkErr } = await admin
      .from('qr_links')
      .select('media_path')
      .in('memory_id', memoryIds);
    if (linkErr) {
      console.warn('[delete-account] qr_links', linkErr.message);
    } else if (mode === 'voluntary') {
      for (const l of links ?? []) {
        if (typeof l.media_path === 'string' && l.media_path.trim()) {
          qrPaths.push(l.media_path.trim());
        }
      }
    }
  }

  await removeStoragePaths(admin, 'qr-media', qrPaths);

  if (mode === 'voluntary' && tokenIdsToDelete.length > 0) {
    const chunk = 100;
    for (let i = 0; i < tokenIdsToDelete.length; i += chunk) {
      const slice = tokenIdsToDelete.slice(i, i + chunk);
      const { error } = await admin.from('public_media_tokens').delete().in('token', slice);
      if (error) console.warn('[delete-account] delete tokens', error.message);
    }
  }

  console.log('[delete-account] storage purged', {
    userId,
    mode,
    media: mediaPaths.length,
    booksPdf: booksPaths.length,
    qrMedia: qrPaths.length,
    tokensDeleted: mode === 'voluntary' ? tokenIdsToDelete.length : 0,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonRes({ error: 'Method not allowed' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!jwt) {
      return jsonRes({ error: 'Unauthorized' }, 401);
    }

    let mode: DeleteMode = 'voluntary';
    let cronUserId: string | null = null;
    try {
      const body = (await req.json()) as { mode?: string; userId?: string };
      if (body?.mode === 'inactivity') mode = 'inactivity';
      if (typeof body?.userId === 'string' && body.userId.trim()) {
        cronUserId = body.userId.trim();
      }
    } catch {
      // body vide = voluntary
    }

    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !serviceKey || !anonKey) {
      return jsonRes({ error: 'Server misconfigured' }, 500);
    }

    const cronSecret =
      (Deno.env.get('INACTIVITY_CRON_SECRET') ?? '').trim() ||
      (Deno.env.get('REVENUECAT_WEBHOOK_SECRET') ?? '').trim();

    let userId: string;
    let email = '';

    if (cronUserId && cronSecret && jwt === cronSecret && mode === 'inactivity') {
      // Appel cron service (inactivity-sweep) — pas de JWT utilisateur.
      userId = cronUserId;
      const adminProbe = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: u } = await adminProbe.auth.admin.getUserById(userId);
      email = (u.user?.email ?? '').toLowerCase();
      if (!u.user) {
        return jsonRes({ error: 'User not found' }, 404);
      }
    } else {
      const userClient = createClient(url, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const { data: userData, error: userError } = await userClient.auth.getUser();
      if (userError || !userData.user?.id) {
        return jsonRes({ error: 'Unauthorized' }, 401);
      }

      email = (userData.user.email ?? '').toLowerCase();
      userId = userData.user.id;
    }

    if (email.endsWith('@petitmo.local')) {
      return jsonRes({ error: 'Device user cannot be deleted' }, 400);
    }

    const admin = createClient(url, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
      await purgeUserStorage(admin, userId, mode);
    } catch (e) {
      console.error('[delete-account] storage purge failed', e);
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error('[delete-account]', deleteError);
      return jsonRes({ error: deleteError.message }, 400);
    }

    return jsonRes({ ok: true, mode }, 200);
  } catch (e) {
    console.error('[delete-account]', e);
    return jsonRes(
      { error: e instanceof Error ? e.message : 'Delete failed' },
      500,
    );
  }
});
