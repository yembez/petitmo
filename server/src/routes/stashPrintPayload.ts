import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyExportTicket } from '../auth/exportPdfTicket';
import { isGenerateBookPdfPayload } from '../print/isGenerateBookPdfPayload';
import { fulfillPrintOrderFromStoredPayload, stashPrintPayload } from '../print/fulfillPrintOrder';

function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  const t = h.replace(/^Bearer\s+/i, '').trim();
  return t || null;
}

/**
 * POST /v1/books/stash-print-payload — ticket export_print.
 * Le Checkout Stripe s’ouvre **en parallèle** de l’upload : si le paiement est déjà
 * encaissé quand le payload arrive, on lance PDF + Gelato en fond ici même
 * (le webhook a répondu PAYLOAD_MISSING plus tôt).
 */
export function registerStashPrintPayloadRoute(
  app: Express,
  supabase: SupabaseClient,
  supabaseProjectUrl: string,
): void {
  const projectOrigin = supabaseProjectUrl.replace(/\/$/, '');

  app.post('/v1/books/stash-print-payload', async (req: Request, res: Response) => {
    const body = req.body;
    if (!isGenerateBookPdfPayload(body)) {
      res.status(400).json({ error: 'Invalid payload' });
      return;
    }
    const bearer = getBearerToken(req);
    if (!bearer) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }
    const ticket = await verifyExportTicket(bearer);
    if (!ticket || ticket.kind !== 'print') {
      res.status(401).json({ error: 'Invalid print ticket' });
      return;
    }

    const exportRequestId = ticket.export_request_id;
    const result = await stashPrintPayload({
      supabase,
      exportRequestId,
      bookId: ticket.book_id,
      crmContactId: ticket.crm_contact_id,
      body,
    });
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.status(200).json({ ok: true, exportRequestId, alreadyPaid: result.alreadyPaid });

    if (result.alreadyPaid) {
      void fulfillPrintOrderFromStoredPayload({ supabase, projectOrigin, exportRequestId }).then(r => {
        if (!r.ok) {
          console.error('[stash-print-payload] fulfill after paid failed', exportRequestId, r.status, r.error);
        } else {
          console.log('[stash-print-payload] fulfill after paid ok', exportRequestId, r.already ? '(already)' : '');
        }
      });
    }
  });
}
