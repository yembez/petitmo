import type { Express, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { QrLinkExportRow, QrLinkRow } from '../types/contracts';

/** Token base64url (spec : long, non devinable). */
const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/;

const qrLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests',
});

function isExpired(iso: string): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return true;
  return t < Date.now();
}

type QrResolveRow = {
  storage_bucket: string;
  media_path: string;
  expires_at: string;
  revoked_at: string | null;
};

async function redirectQrSignedUrl(
  supabase: SupabaseClient,
  res: Response,
  row: QrResolveRow
): Promise<void> {
  if (row.revoked_at != null) {
    res.status(410).type('text/plain').send('Gone');
    return;
  }

  if (isExpired(row.expires_at)) {
    res.status(410).type('text/plain').send('Expired');
    return;
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(row.storage_bucket)
    .createSignedUrl(row.media_path, 120);

  if (signErr || !signed?.signedUrl) {
    console.error('[qr] sign error', signErr?.message);
    res.status(500).type('text/plain').send('Signing failed');
    return;
  }

  res.redirect(302, signed.signedUrl);
}

export function registerQrRoutes(app: Express, supabase: SupabaseClient): void {
  app.get('/q/:token', qrLimiter, async (req: Request, res: Response) => {
    const token = req.params.token ?? '';
    if (!TOKEN_RE.test(token)) {
      res.status(400).type('text/plain').send('Invalid token');
      return;
    }

    const { data: dataBook, error: errBook } = await supabase
      .from('qr_links')
      .select(
        'id, token, child_id, memory_id, book_id, storage_bucket, media_path, kind, expires_at, revoked_at, created_at'
      )
      .eq('token', token)
      .maybeSingle();

    if (errBook) {
      console.error('[qr] qr_links select', errBook.message);
      res.status(500).type('text/plain').send('Server error');
      return;
    }

    const rowBook = dataBook as QrLinkRow | null;
    if (rowBook) {
      await redirectQrSignedUrl(supabase, res, rowBook);
      return;
    }

    const { data: dataExport, error: errExport } = await supabase
      .from('qr_links_exports')
      .select(
        'id, token, export_request_id, book_id, memory_client_id, storage_bucket, media_path, kind, expires_at, revoked_at, created_at'
      )
      .eq('token', token)
      .maybeSingle();

    if (errExport) {
      console.error('[qr] qr_links_exports select', errExport.message);
      res.status(500).type('text/plain').send('Server error');
      return;
    }

    const rowExport = dataExport as QrLinkExportRow | null;
    if (!rowExport) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }

    await redirectQrSignedUrl(supabase, res, rowExport);
  });
}
