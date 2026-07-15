import express, { type Express, type Request, type Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyExportTicket } from '../auth/exportPdfTicket';

function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  const t = h.replace(/^Bearer\s+/i, '').trim();
  return t || null;
}

function isPayload(body: unknown): body is { memoryId: string; base64Jpeg: string } {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return typeof b.memoryId === 'string' && typeof b.base64Jpeg === 'string';
}

export function registerUploadGuestAssetsRoutes(app: Express, supabase: SupabaseClient): void {
  // JPEG 3200 px en base64 — marge au-dessus de l’ancien plafond 25 mb.
  app.post(
    '/v1/books/upload-guest-photo',
    express.json({ limit: '40mb' }),
    async (req: Request, res: Response) => {
      const body = req.body;
      if (!isPayload(body)) {
        res.status(400).json({ error: 'Invalid payload' });
        return;
      }
      const bearer = getBearerToken(req);
      if (!bearer) {
        res.status(401).json({ error: 'Missing or invalid Authorization header' });
        return;
      }

      const ticket = await verifyExportTicket(bearer);
      if (!ticket || ticket.kind !== 'pdf') {
        res.status(401).json({ error: 'Invalid ticket' });
        return;
      }

      const memoryId = body.memoryId.trim();
      if (!memoryId) {
        res.status(400).json({ error: 'memoryId required' });
        return;
      }

      const b64 = body.base64Jpeg.trim();
      if (!b64) {
        res.status(400).json({ error: 'base64Jpeg required' });
        return;
      }

      let bytes: Uint8Array;
      try {
        bytes = Buffer.from(b64, 'base64');
      } catch {
        res.status(400).json({ error: 'Invalid base64' });
        return;
      }

      const objectPath = `exports/${ticket.export_request_id}/photo/${memoryId}.jpg`;
      try {
        console.log('[upload-guest-photo] start', {
          exportRequestId: ticket.export_request_id,
          memoryId,
          bytes: bytes.length,
        });
        const { error } = await supabase.storage.from('media').upload(objectPath, bytes, {
          contentType: 'image/jpeg',
          upsert: true,
        });
        if (error) {
          console.error('[upload-guest-photo] storage error', error.message);
          res.status(500).json({ error: 'Upload failed' });
          return;
        }
        const { data: signed, error: signErr } = await supabase.storage
          .from('media')
          .createSignedUrl(objectPath, 60 * 60 * 24 * 7);
        if (signErr || !signed?.signedUrl) {
          console.error('[upload-guest-photo] sign', signErr?.message);
          res.status(500).json({ error: 'Sign failed' });
          return;
        }
        res.status(200).json({ url: signed.signedUrl, path: objectPath });
      } catch {
        res.status(500).json({ error: 'Upload failed' });
      }
    }
  );
}

