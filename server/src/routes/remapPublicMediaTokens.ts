import type { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { remapPublicMediaTokenMediaIds } from '../publicMediaTokenRemap';

const remapLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
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

function parseRemaps(body: unknown): Array<{ from: string; to: string }> | null {
  if (!body || typeof body !== 'object') return null;
  const remaps = (body as { remaps?: unknown }).remaps;
  if (!Array.isArray(remaps)) return null;
  const out: Array<{ from: string; to: string }> = [];
  for (const item of remaps) {
    if (!item || typeof item !== 'object') return null;
    const from = (item as { from?: unknown }).from;
    const to = (item as { to?: unknown }).to;
    if (typeof from !== 'string' || typeof to !== 'string') return null;
    out.push({ from, to });
  }
  return out;
}

/** Remappe `public_media_tokens.media_id` après upgrade gratuit → Petitmo+ (ids legacy). */
export function registerRemapPublicMediaTokensRoute(app: Express, supabase: SupabaseClient): void {
  app.post('/v1/public-media/remap-media-ids', remapLimiter, async (req: Request, res: Response) => {
    const remaps = parseRemaps(req.body);
    if (!remaps || remaps.length === 0) {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }
    if (remaps.length > 200) {
      res.status(400).json({ error: 'Too many remaps' });
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

    try {
      const result = await remapPublicMediaTokenMediaIds(supabase, remaps);
      res.status(200).json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[remap-media-ids]', msg);
      res.status(500).json({ error: 'Remap failed', detail: msg });
    }
  });
}
