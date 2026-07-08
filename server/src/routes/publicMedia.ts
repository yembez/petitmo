import type { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  petitmoLogoHtml,
  publicMediaPageHeaderHtml,
  resolvePublicMediaDisplayContext,
  type PublicMediaDisplayContext,
} from '../publicMediaDisplayContext';
import { tryProcessPublicMediaTokenOnVisit } from '../worker/publicMediaWorkerOnce';

const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;
const PLAYER_SIGN_SEC = 120;

const publicLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests',
});

type TokenRow = {
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
  memory_created_at: string | null;
  memory_location: string | null;
  child_birthdate: string | null;
};

function isTokenExpired(iso: string | null | undefined): boolean {
  if (iso == null || typeof iso !== 'string' || !iso.trim()) return false;
  const t = Date.parse(iso.trim());
  if (!Number.isFinite(t)) return false;
  return t < Date.now();
}

function downloadFilename(kind: TokenRow['kind']): string {
  return kind === 'video' ? 'petitmo-souvenir.mp4' : 'petitmo-souvenir.m4a';
}

function htmlPage(
  title: string,
  mainBody: string,
  extraScript = '',
  pageHeaderText = '',
  flatLayout = false,
): string {
  const mainBlock = flatLayout
    ? `<div class="page-main">${mainBody}</div>`
    : `<div class="card">${mainBody}</div>`;
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${title}</title>
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,"Helvetica Neue",Arial,sans-serif;background:#F6F4F1;margin:0;padding:0;color:#1C1C1E}
    .wrap{max-width:560px;margin:0 auto;padding:28px 18px}
    .page-top{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:14px}
    .page-top-logo{flex:0 0 auto;overflow:visible}
    .logo-svg{height:38px;width:auto;max-width:min(160px,42vw);display:block;overflow:visible}
    .page-header-text{flex:1;min-width:0;padding-top:2px;text-align:right}
    .page-header-kind{font-size:14px;font-weight:500;line-height:1.3;color:#1C1C1E}
    .page-header-date{margin-top:3px;font-size:12px;font-weight:400;line-height:1.35;color:#6B7280}
    .page-header-age{margin-top:1px;font-size:12px;font-weight:400;line-height:1.35;color:#6B7280}
    .page-header-loc{margin-top:3px;font-size:12px;font-weight:400;line-height:1.35;color:#9CA3AF}
    .page-main{margin-top:0}
    .card{background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:16px;padding:18px 18px;box-shadow:0 6px 20px rgba(0,0,0,.06)}
    .muted{color:#6B7280;font-size:14px;line-height:1.45}
    .btn{display:inline-block;margin-top:14px;margin-right:8px;padding:10px 14px;border-radius:12px;background:#C4784A;color:#fff;text-decoration:none;font-weight:600;border:none;font-size:15px;cursor:pointer;font-family:inherit}
    .btn-secondary{background:#fff;color:#C4784A;border:1.5px solid #C4784A}
    .player{width:100%;margin-top:0;border-radius:10px}
    .player-video{display:block;width:100%;border-radius:16px;box-shadow:0 6px 20px rgba(0,0,0,.08);background:#111827;vertical-align:top}
    .save-block{margin-top:16px}
    .save-hint{margin-top:10px;font-size:12px;line-height:1.45;color:#6B7280}
    .save-status{margin-top:8px;font-size:12px;line-height:1.45;color:#6B7280;display:none}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="page-top">
      <div class="page-top-logo">${petitmoLogoHtml()}</div>
      ${pageHeaderText}
    </div>
    ${mainBlock}
    <div class="muted" style="margin-top:14px;font-size:12px">Si ce souvenir ne se lance pas, réessaie dans quelques instants.</div>
  </div>
  ${extraScript}
</body>
</html>`;
}

function saveControlsHtml(token: string, kind: TokenRow['kind']): string {
  const primaryLabel = kind === 'video' ? 'Télécharger' : 'Télécharger l’audio';
  const againLabel = 'Télécharger à nouveau';
  const iosHint =
    kind === 'video'
      ? `<div id="save-hint" class="save-hint">Sur iPhone : touchez le bouton, faites défiler le menu vers le bas, puis « Enregistrer la vidéo ».</div>`
      : `<div id="save-hint" class="save-hint">Le fichier s’enregistre via le menu qui s’ouvre en bas de l’écran.</div>`;
  const safeToken = token.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const safeKind = kind === 'video' ? 'video' : 'audio';
  const filename = downloadFilename(kind);

  return `<div class="save-block">
      <button type="button" id="save-btn" class="btn btn-secondary">${primaryLabel}</button>
      <div id="save-status" class="save-status"></div>
      ${iosHint}
    </div>
    <script>
    (function () {
      var token = '${safeToken}';
      var kind = '${safeKind}';
      var filename = '${filename}';
      var storageKey = 'petitmo_saved_' + token;
      var btn = document.getElementById('save-btn');
      var status = document.getElementById('save-status');
      var downloadUrl = '/m/' + encodeURIComponent(token) + '/download';
      var primaryLabel = ${JSON.stringify(primaryLabel)};
      var againLabel = ${JSON.stringify(againLabel)};
      var statusAgain =
        kind === 'video'
          ? 'Déjà téléchargé ici. Pas dans Photos ? Touchez à nouveau.'
          : 'Déjà téléchargé ici. Touchez à nouveau si besoin.';

      function applySavedUi() {
        if (btn) btn.textContent = againLabel;
        if (status) {
          status.textContent = statusAgain;
          status.style.display = 'block';
        }
      }

      function markSaved() {
        try { localStorage.setItem(storageKey, String(Date.now())); } catch (e) {}
        applySavedUi();
      }

      function alreadySaved() {
        try { return !!localStorage.getItem(storageKey); } catch (e) { return false; }
      }

      if (alreadySaved()) applySavedUi();

      async function saveMedia() {
        if (!btn) return;
        btn.disabled = true;
        var prev = btn.textContent;
        btn.textContent = 'Préparation…';

        try {
          var res = await fetch(downloadUrl);
          if (!res.ok) throw new Error('download failed');
          var blob = await res.blob();

          if (kind === 'video' && navigator.share && navigator.canShare) {
            try {
              var file = new File([blob], filename, { type: blob.type || 'video/mp4' });
              if (navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: 'Souvenir Petitmo' });
                markSaved();
                return;
              }
            } catch (shareErr) {
              if (shareErr && shareErr.name === 'AbortError') {
                btn.disabled = false;
                btn.textContent = prev;
                return;
              }
            }
          }

          var objectUrl = URL.createObjectURL(blob);
          var a = document.createElement('a');
          a.href = objectUrl;
          a.download = filename;
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 4000);
          markSaved();
        } catch (err) {
          btn.textContent = prev;
          window.location.href = downloadUrl;
        } finally {
          btn.disabled = false;
        }
      }

      if (btn) btn.addEventListener('click', saveMedia);
    })();
    </script>`;
}

function playerHtml(
  token: string,
  kind: TokenRow['kind'],
  src: string,
  display: PublicMediaDisplayContext,
): { mainBody: string; pageHeaderText: string; flatLayout: boolean } {
  const saveBlock = saveControlsHtml(token, kind);
  const pageHeaderText = publicMediaPageHeaderHtml(kind, display);
  const playerClass = kind === 'video' ? 'player player-video' : 'player';
  const playerTag =
    kind === 'video'
      ? `<video class="${playerClass}" controls playsinline src="${src}"></video>`
      : `<audio class="${playerClass}" controls src="${src}"></audio>`;

  return {
    pageHeaderText,
    mainBody: `${playerTag}${saveBlock}`,
    flatLayout: kind === 'video',
  };
}

function failedHtml(lastError: string | null, token?: string): string {
  const msg = lastError ? `Détail: ${lastError}` : '';
  const refresh = token
    ? `<a class="btn" href="/m/${encodeURIComponent(token)}">Actualiser</a>`
    : '';
  return `<div style="font-weight:700;font-size:18px">Ce souvenir n’a pas pu être préparé</div>
          <div class="muted" style="margin-top:6px">${msg || 'Réessaie plus tard.'}</div>
          ${refresh}`;
}

async function fetchTokenRow(
  supabase: SupabaseClient,
  token: string,
): Promise<{ row: TokenRow | null; error?: string }> {
  const { data, error } = await supabase
    .from('public_media_tokens')
    .select(
      'token, media_id, kind, status, raw_bucket, raw_path, ready_bucket, ready_path, last_error, expires_at, memory_created_at, memory_location, child_birthdate',
    )
    .eq('token', token)
    .maybeSingle();
  if (error) return { row: null, error: error.message };
  return { row: (data as TokenRow | null) ?? null };
}

async function resolveReadyRow(
  supabase: SupabaseClient,
  token: string,
  initial: TokenRow,
): Promise<TokenRow | null> {
  if (initial.status === 'ready' && initial.ready_bucket && initial.ready_path) {
    return initial;
  }
  if (!initial.raw_bucket || !initial.raw_path) return null;

  await tryProcessPublicMediaTokenOnVisit(token);
  const { row } = await fetchTokenRow(supabase, token);
  if (row?.status === 'ready' && row.ready_bucket && row.ready_path) return row;
  return null;
}

async function createSignedMediaUrl(
  supabase: SupabaseClient,
  row: TokenRow,
  expiresSec: number,
): Promise<string | null> {
  if (!row.ready_bucket || !row.ready_path) return null;
  const { data, error } = await supabase.storage
    .from(row.ready_bucket)
    .createSignedUrl(row.ready_path, expiresSec);
  if (error || !data?.signedUrl) {
    console.error('[m] sign', error?.message);
    return null;
  }
  return data.signedUrl;
}

async function streamReadyDownload(
  supabase: SupabaseClient,
  row: TokenRow,
  res: Response,
): Promise<boolean> {
  if (!row.ready_bucket || !row.ready_path) return false;

  const { data, error } = await supabase.storage.from(row.ready_bucket).download(row.ready_path);
  if (error || !data) {
    console.error('[m] download', error?.message);
    res.status(500).type('text/plain').send('Download failed');
    return true;
  }

  const buf = Buffer.from(await data.arrayBuffer());
  const filename = downloadFilename(row.kind);
  const contentType = row.kind === 'video' ? 'video/mp4' : 'audio/mp4';

  res
    .status(200)
    .set('Cache-Control', 'private, no-store')
    .set('Content-Type', contentType)
    .set('Content-Disposition', `attachment; filename="${filename}"`)
    .set('Content-Length', String(buf.length))
    .send(buf);
  return true;
}

async function signedPlayerResponse(
  supabase: SupabaseClient,
  row: TokenRow,
  res: Response,
): Promise<boolean> {
  if (row.status !== 'ready' || !row.ready_bucket || !row.ready_path) return false;

  const signedUrl = await createSignedMediaUrl(supabase, row, PLAYER_SIGN_SEC);
  if (!signedUrl) {
    res.status(500).type('text/plain').send('Signing failed');
    return true;
  }

  const display = await resolvePublicMediaDisplayContext(supabase, row);

  const { mainBody, pageHeaderText, flatLayout } = playerHtml(row.token, row.kind, signedUrl, display);

  res
    .status(200)
    .set('Cache-Control', 'no-store')
    .type('text/html')
    .send(htmlPage('Petitmo · Souvenir', mainBody, '', pageHeaderText, flatLayout));
  return true;
}

export function registerPublicMediaRoutes(app: Express, supabase: SupabaseClient): void {
  app.get('/m/:token/download', publicLimiter, async (req: Request, res: Response) => {
    const token = req.params.token ?? '';
    if (!TOKEN_RE.test(token)) {
      res.status(400).type('text/plain').send('Invalid token');
      return;
    }

    const { row, error } = await fetchTokenRow(supabase, token);
    if (error) {
      console.error('[m/download] select', error);
      res.status(500).type('text/plain').send('Server error');
      return;
    }
    if (!row) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    if (isTokenExpired(row.expires_at)) {
      res.status(410).type('text/plain').send('Expired');
      return;
    }

    const ready = await resolveReadyRow(supabase, token, row);
    if (!ready) {
      res.status(409).type('text/plain').send('Media not ready');
      return;
    }

    await streamReadyDownload(supabase, ready, res);
  });

  app.get('/m/:token', publicLimiter, async (req: Request, res: Response) => {
    const token = req.params.token ?? '';
    if (!TOKEN_RE.test(token)) {
      res.status(400).type('text/plain').send('Invalid token');
      return;
    }

    const { row, error } = await fetchTokenRow(supabase, token);
    if (error) {
      console.error('[m] select', error);
      res.status(500).type('text/plain').send('Server error');
      return;
    }
    if (!row) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }

    if (isTokenExpired(row.expires_at)) {
      res.status(410).type('text/plain').send('Expired');
      return;
    }

    if (await signedPlayerResponse(supabase, row, res)) return;

    if (row.raw_bucket && row.raw_path) {
      await tryProcessPublicMediaTokenOnVisit(token);
      const refreshed = await fetchTokenRow(supabase, token);
      if (refreshed.row) {
        const fresh = refreshed.row;
        if (await signedPlayerResponse(supabase, fresh, res)) return;
        if (fresh.status === 'failed') {
          res
            .status(200)
            .set('Cache-Control', 'no-store')
            .type('text/html')
            .send(htmlPage('Petitmo · Souvenir', failedHtml(fresh.last_error, token)));
          return;
        }
      }
    } else if (row.status === 'failed') {
      res
        .status(200)
        .set('Cache-Control', 'no-store')
        .type('text/html')
        .send(htmlPage('Petitmo · Souvenir', failedHtml(row.last_error, token)));
      return;
    }

    res
      .status(200)
      .set('Cache-Control', 'no-store')
      .type('text/html')
      .send(
        htmlPage(
          'Petitmo · Souvenir',
          `<div style="font-weight:700;font-size:18px">Ce souvenir prend vie…</div>
           <div class="muted" style="margin-top:6px">Revenez dans quelques instants ❤️</div>
           <a class="btn" href="/m/${encodeURIComponent(token)}">Actualiser</a>`,
        ),
      );
  });
}
