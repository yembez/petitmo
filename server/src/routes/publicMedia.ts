import type { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { SupabaseClient } from '@supabase/supabase-js';
import { tryProcessPublicMediaTokenOnVisit } from '../worker/publicMediaWorkerOnce';

const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests',
});

type TokenRow = {
  token: string;
  kind: 'audio' | 'video';
  status: 'pending_upload' | 'uploaded' | 'processing' | 'ready' | 'failed';
  raw_bucket: string | null;
  raw_path: string | null;
  ready_bucket: string | null;
  ready_path: string | null;
  last_error: string | null;
  expires_at: string | null;
};

function isTokenExpired(iso: string | null | undefined): boolean {
  if (iso == null || typeof iso !== 'string' || !iso.trim()) return false;
  const t = Date.parse(iso.trim());
  if (!Number.isFinite(t)) return false;
  return t < Date.now();
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;background:#F6F4F1;margin:0;padding:0;color:#1C1C1E}
    .wrap{max-width:560px;margin:0 auto;padding:28px 18px}
    .card{background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:16px;padding:18px 18px;box-shadow:0 6px 20px rgba(0,0,0,.06)}
    .logo{font-weight:700;letter-spacing:.2px}
    .muted{color:#6B7280}
    .btn{display:inline-block;margin-top:14px;padding:10px 14px;border-radius:12px;background:#C4784A;color:#fff;text-decoration:none;font-weight:600}
    .player{width:100%;margin-top:12px}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">petitmo</div>
    <div class="card" style="margin-top:14px">
      ${body}
    </div>
    <div class="muted" style="margin-top:14px;font-size:12px">Si ce souvenir ne se lance pas, réessaie dans quelques instants.</div>
  </div>
</body>
</html>`;
}

export function registerPublicMediaRoutes(app: Express, supabase: SupabaseClient): void {
  app.get('/m/:token', publicLimiter, async (req: Request, res: Response) => {
    const token = req.params.token ?? '';
    if (!TOKEN_RE.test(token)) {
      res.status(400).type('text/plain').send('Invalid token');
      return;
    }

    const { data, error } = await supabase
      .from('public_media_tokens')
      .select('token, kind, status, raw_bucket, raw_path, ready_bucket, ready_path, last_error, expires_at')
      .eq('token', token)
      .maybeSingle();

    if (error) {
      console.error('[m] select', error.message);
      res.status(500).type('text/plain').send('Server error');
      return;
    }

    const row = data as TokenRow | null;
    if (!row) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }

    if (isTokenExpired(row.expires_at)) {
      res.status(410).type('text/plain').send('Expired');
      return;
    }

    if (row.status === 'ready' && row.ready_bucket && row.ready_path) {
      const { data: signed, error: signErr } = await supabase.storage
        .from(row.ready_bucket)
        .createSignedUrl(row.ready_path, 120);
      if (signErr || !signed?.signedUrl) {
        console.error('[m] sign', signErr?.message);
        res.status(500).type('text/plain').send('Signing failed');
        return;
      }

      // Option 1: redirect direct vers la signed URL (lecteur natif du navigateur)
      // Option 2: page HTML avec <audio>/<video>. On choisit 2 pour un rendu plus "Petitmo".
      const src = signed.signedUrl;
      const player =
        row.kind === 'video'
          ? `<div style="font-weight:700;font-size:18px">Souvenir vidéo</div>
             <div class="muted" style="margin-top:6px">Bon visionnage.</div>
             <video class="player" controls playsinline src="${src}"></video>`
          : `<div style="font-weight:700;font-size:18px">Souvenir audio</div>
             <div class="muted" style="margin-top:6px">Bonne écoute.</div>
             <audio class="player" controls src="${src}"></audio>`;
      res.status(200).type('text/html').send(htmlPage('Petitmo · Souvenir', player));
      return;
    }

    if (row.status === 'failed') {
      const msg = row.last_error ? `Détail: ${row.last_error}` : '';
      res
        .status(200)
        .type('text/html')
        .send(
          htmlPage(
            'Petitmo · Souvenir',
            `<div style="font-weight:700;font-size:18px">Ce souvenir n’a pas pu être préparé</div>
             <div class="muted" style="margin-top:6px">${msg || 'Réessaie plus tard.'}</div>`
          )
        );
      return;
    }

    if (row.raw_bucket && row.raw_path) {
      await tryProcessPublicMediaTokenOnVisit(token);
      const { data: refreshed, error: refreshErr } = await supabase
        .from('public_media_tokens')
        .select('token, kind, status, raw_bucket, raw_path, ready_bucket, ready_path, last_error, expires_at')
        .eq('token', token)
        .maybeSingle();
      if (!refreshErr && refreshed) {
        const fresh = refreshed as TokenRow;
        if (fresh.status === 'ready' && fresh.ready_bucket && fresh.ready_path) {
          const { data: signed, error: signErr } = await supabase.storage
            .from(fresh.ready_bucket)
            .createSignedUrl(fresh.ready_path, 120);
          if (!signErr && signed?.signedUrl) {
            const src = signed.signedUrl;
            const player =
              fresh.kind === 'video'
                ? `<div style="font-weight:700;font-size:18px">Souvenir vidéo</div>
                   <div class="muted" style="margin-top:6px">Bon visionnage.</div>
                   <video class="player" controls playsinline src="${src}"></video>`
                : `<div style="font-weight:700;font-size:18px">Souvenir audio</div>
                   <div class="muted" style="margin-top:6px">Bonne écoute.</div>
                   <audio class="player" controls src="${src}"></audio>`;
            res.status(200).type('text/html').send(htmlPage('Petitmo · Souvenir', player));
            return;
          }
        }
        if (fresh.status === 'failed') {
          const msg = fresh.last_error ? `Détail: ${fresh.last_error}` : '';
          res
            .status(200)
            .type('text/html')
            .send(
              htmlPage(
                'Petitmo · Souvenir',
                `<div style="font-weight:700;font-size:18px">Ce souvenir n’a pas pu être préparé</div>
                 <div class="muted" style="margin-top:6px">${msg || 'Réessaie plus tard.'}</div>`
              )
            );
          return;
        }
      }
    }

    // pending_upload / uploaded / processing
    res
      .status(200)
      .type('text/html')
      .send(
        htmlPage(
          'Petitmo · Souvenir',
          `<div style="font-weight:700;font-size:18px">Ce souvenir prend vie…</div>
           <div class="muted" style="margin-top:6px">Revenez dans quelques instants ❤️</div>
           <a class="btn" href="/m/${encodeURIComponent(token)}">Actualiser</a>`
        )
      );
  });
}

