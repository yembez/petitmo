import type { Express, Request, Response } from 'express';
import multer from 'multer';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyExportTicket } from '../auth/exportPdfTicket';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 110 * 1024 * 1024 }, // 110MB
});

function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  const t = h.replace(/^Bearer\s+/i, '').trim();
  return t || null;
}

type AssetKind = 'photo' | 'cover' | 'audio' | 'video' | 'video_thumb';

function isKind(x: unknown): x is AssetKind {
  return x === 'photo' || x === 'cover' || x === 'audio' || x === 'video' || x === 'video_thumb';
}

function extFor(kind: AssetKind, originalName: string): { ext: string; contentType: string } {
  const lower = (originalName || '').toLowerCase();
  if (kind === 'photo' || kind === 'cover' || kind === 'video_thumb') {
    return { ext: 'jpg', contentType: 'image/jpeg' };
  }
  if (kind === 'audio') {
    if (lower.endsWith('.mp3')) return { ext: 'mp3', contentType: 'audio/mpeg' };
    return { ext: 'm4a', contentType: 'audio/mp4' };
  }
  // video
  if (lower.endsWith('.mov')) return { ext: 'mov', contentType: 'video/quicktime' };
  return { ext: 'mp4', contentType: 'video/mp4' };
}

export function registerUploadGuestAssetRoute(app: Express, supabase: SupabaseClient): void {
  app.post('/v1/books/upload-guest-asset', upload.single('file'), async (req: Request, res: Response) => {
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

    const kind = req.body?.kind;
    const memoryId = String(req.body?.memoryId ?? '').trim();
    if (!isKind(kind)) {
      res.status(400).json({ error: 'Invalid kind' });
      return;
    }
    if (!memoryId) {
      res.status(400).json({ error: 'memoryId required' });
      return;
    }
    const f = req.file;
    if (!f?.buffer?.length) {
      res.status(400).json({ error: 'file required' });
      return;
    }

    const { ext, contentType } = extFor(kind, f.originalname || '');
    const dir =
      kind === 'cover'
        ? 'cover'
        : kind === 'photo'
          ? 'photo'
          : kind === 'audio'
            ? 'audio'
            : kind === 'video'
              ? 'video'
              : 'video_thumb';
    const objectPath = `exports/${ticket.export_request_id}/${dir}/${memoryId}.${ext}`;

    try {
      console.log('[upload-guest-asset] start', {
        exportRequestId: ticket.export_request_id,
        kind,
        memoryId,
        bytes: f.buffer.length,
        contentType,
      });
      const { error } = await supabase.storage.from('media').upload(objectPath, f.buffer, {
        contentType,
        upsert: true,
      });
      if (error) {
        console.error('[upload-guest-asset] storage error', error.message);
        res.status(500).json({ error: 'Upload failed' });
        return;
      }
      const { data } = supabase.storage.from('media').getPublicUrl(objectPath);
      res.status(200).json({ url: data.publicUrl, path: objectPath, contentType });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Upload failed';
      res.status(500).json({ error: msg });
    }
  });
}

