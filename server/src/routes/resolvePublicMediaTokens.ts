import type { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { preparePublicTokensForBook } from '../pdf/preparePublicTokens';
import type { MemoryRow } from '../pdf/memoryRow';
import type { BookPageServer } from '../types/contracts';

const resolveLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
});

function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  const t = h.replace(/^Bearer\s+/i, '').trim();
  return t || null;
}

function isBody(x: unknown): x is { childId: string; pages: BookPageServer[] } {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return typeof o.childId === 'string' && Array.isArray(o.pages);
}

/** Résout les tokens QR stables pour l’aperçu livre (session cloud). */
export function registerResolvePublicMediaTokensRoute(app: Express, supabase: SupabaseClient): void {
  app.post('/v1/public-media/resolve-tokens', resolveLimiter, async (req: Request, res: Response) => {
    const body = req.body;
    if (!isBody(body)) {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }

    const bearer = getBearerToken(req);
    if (!bearer) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const { data: userData, error: authErr } = await supabase.auth.getUser(bearer);
    if (authErr || !userData.user) {
      res.status(401).json({ error: 'Invalid session' });
      return;
    }
    const userId = userData.user.id;

    const { childId, pages } = body;
    const { data: child, error: childErr } = await supabase
      .from('children')
      .select('id, birthdate')
      .eq('id', childId)
      .eq('user_id', userId)
      .maybeSingle();
    if (childErr) {
      console.error('[resolve-tokens] child', childErr.message);
      res.status(500).json({ error: 'Database error' });
      return;
    }
    if (!child) {
      res.status(403).json({ error: 'Child not found or access denied' });
      return;
    }

    const memoryIds = [
      ...new Set(
        pages.flatMap((p): string[] => (typeof p.memoryId === 'string' && p.memoryId ? [p.memoryId] : []))
      ),
    ];

    let memoriesById = new Map<string, MemoryRow>();
    if (memoryIds.length > 0) {
      const { data: memories, error: memErr } = await supabase
        .from('memories')
        .select(
          'id, child_id, user_id, type, content, text_title, media_url, media_path, edited_media_url, duration, thumbnail_url, display_url, print_url, poster_url, poster_print_url, voice_cover_url, voice_cover_path, location, created_at'
        )
        .eq('child_id', childId)
        .in('id', memoryIds);
      if (memErr) {
        console.error('[resolve-tokens] memories', memErr.message);
        res.status(500).json({ error: 'Database error' });
        return;
      }
      const rows = (memories ?? []) as MemoryRow[];
      memoriesById = new Map(rows.map(m => [m.id, m]));
      for (const id of memoryIds) {
        const m = memoriesById.get(id);
        if (!m || m.user_id !== userId) {
          res.status(400).json({ error: 'Unknown or inaccessible memory', memoryId: id });
          return;
        }
      }
    }

    const qrResult = await preparePublicTokensForBook({
      supabase,
      userId,
      childId,
      bookId: 'preview',
      pages,
      memoriesById,
      subscriptionTier: 'premium',
      childBirthdate: (child as { birthdate?: string | null }).birthdate ?? null,
    });

    if (!qrResult.ok) {
      res.status(qrResult.status).json({ error: qrResult.message });
      return;
    }

    const tokens: Record<string, string> = {};
    for (const [memoryId, token] of qrResult.tokensByMemoryId.entries()) {
      tokens[memoryId] = token;
    }

    res.status(200).json({ tokens });
  });
}
