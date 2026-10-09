import type { Express, Request, Response } from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { verifyExportTicket } from '../auth/exportPdfTicket';
import {
  findLocalFileUrlInPrintPayload,
  fulfillPrintOrderFromStoredPayload,
  isPrintSentToGelato,
} from '../print/fulfillPrintOrder';
import { isGenerateBookPdfPayload } from '../print/isGenerateBookPdfPayload';
import { sweepPrintFulfillRetries } from '../print/printFulfillRetryWorker';

function getBearerToken(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h || !/^Bearer\s+/i.test(h)) return null;
  const t = h.replace(/^Bearer\s+/i, '').trim();
  return t || null;
}

function internalAuthorized(req: Request, serviceRoleKey: string): boolean {
  const bearer = getBearerToken(req);
  if (bearer && bearer === serviceRoleKey) return true;
  const printSecret = (process.env.PRINT_FULFILL_SECRET ?? '').trim();
  if (printSecret) {
    const header =
      (typeof req.headers['x-print-fulfill-secret'] === 'string'
        ? req.headers['x-print-fulfill-secret']
        : '') || '';
    if (header === printSecret) return true;
    if (bearer === printSecret) return true;
  }
  return false;
}

/**
 * Kick async : 202 = travail accepté (pas encore Gelato).
 * UI confirme dès paid ; poll status = soft / Mes commandes, pas un gate confirmation.
 * - POST /v1/internal/print-fulfill  (service role / PRINT_FULFILL_SECRET)
 * - POST /v1/books/print-fulfill     (ticket export_print — filet client une fois)
 * - GET  /v1/books/print-fulfill-status (ticket — vérité Gelato)
 * - POST /v1/internal/print-fulfill-retry-sweep
 */
export function registerPrintFulfillRoutes(
  app: Express,
  supabase: SupabaseClient,
  supabaseProjectUrl: string,
  serviceRoleKey: string,
): void {
  const projectOrigin = supabaseProjectUrl.replace(/\/$/, '');

  const kick = (exportRequestId: string, res: Response) => {
    res.status(202).json({ accepted: true, exportRequestId, gelatoReady: false });
    void fulfillPrintOrderFromStoredPayload({
      supabase,
      projectOrigin,
      exportRequestId,
    }).then(result => {
      if (!result.ok) {
        if (result.code === 'IN_PROGRESS') {
          console.log('[print-fulfill] background already in progress', exportRequestId);
          return;
        }
        console.error('[print-fulfill] background failed', exportRequestId, result.status, result.error);
      } else {
        const gelatoOk = result.response.gelato?.ok === true && !result.response.gelato?.skipped
          ? true
          : Boolean(result.response.gelato?.orderId);
        console.log(
          '[print-fulfill] background ok',
          exportRequestId,
          result.already ? '(already)' : '',
          gelatoOk || result.response.gelato?.ok ? 'gelato-ok' : 'gelato-missing',
        );
      }
    });
  };

  app.post('/v1/internal/print-fulfill', (req: Request, res: Response) => {
    if (!internalAuthorized(req, serviceRoleKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const id =
      typeof req.body?.exportRequestId === 'string' ? req.body.exportRequestId.trim() : '';
    if (!id) {
      res.status(400).json({ error: 'exportRequestId required' });
      return;
    }
    kick(id, res);
  });

  /** Une passe retries + watchdog (QA / cron manuel). Auth = PRINT_FULFILL_SECRET. */
  app.post('/v1/internal/print-fulfill-retry-sweep', async (req: Request, res: Response) => {
    if (!internalAuthorized(req, serviceRoleKey)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const result = await sweepPrintFulfillRetries({ supabase, projectOrigin });
      res.status(200).json({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[print-fulfill-retry-sweep]', msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/v1/books/print-fulfill', async (req: Request, res: Response) => {
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
    kick(ticket.export_request_id, res);
  });

  /**
   * Vérité commande : gelatoReady seulement si status=sent_to_printer + printer_order_id.
   * L’app ne doit confirmer l’UI qu’avec gelatoReady=true.
   */
  app.get('/v1/books/print-fulfill-status', async (req: Request, res: Response) => {
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
    const { data, error } = await supabase
      .from('export_requests')
      .select('id, status, payment_status, printer_order_id, last_error, pdf_payload_json')
      .eq('id', ticket.export_request_id)
      .maybeSingle();
    if (error) {
      console.error('[print-fulfill-status] db', error.message);
      res.status(500).json({ error: 'Database error' });
      return;
    }
    if (!data) {
      res.status(404).json({ error: 'Export request not found' });
      return;
    }
    const row = data as {
      id: string;
      status: string;
      payment_status: string | null;
      printer_order_id: string | null;
      last_error: string | null;
      pdf_payload_json: unknown;
    };
    const gelatoReady = isPrintSentToGelato(row);
    let lastError = typeof row.last_error === 'string' ? row.last_error.slice(0, 400) : null;
    let effectiveStatus = row.status;

    // Commande payée bloquée sur payload file:// (sans last_error) → sortir du poll infini.
    if (
      row.payment_status === 'paid' &&
      row.status === 'created' &&
      !gelatoReady &&
      !lastError &&
      isGenerateBookPdfPayload(row.pdf_payload_json)
    ) {
      const leak = findLocalFileUrlInPrintPayload(row.pdf_payload_json);
      if (leak) {
        lastError = `pdf_payload contains local URL (${leak}) — re-stash after upload`;
        effectiveStatus = 'failed';
        void supabase
          .from('export_requests')
          .update({ status: 'failed', last_error: lastError.slice(0, 2000) })
          .eq('id', row.id)
          .eq('status', 'created');
      }
    }

    // last_error sans status failed (anciens ticks) → sortir du poll « paid_pending » infini.
    const fatalPending =
      row.payment_status === 'paid' &&
      effectiveStatus === 'created' &&
      !!lastError &&
      /local URL|PAYLOAD_|stash before checkout|re-stash/i.test(lastError);
    if (fatalPending) effectiveStatus = 'failed';

    const phase =
      gelatoReady
        ? 'sent_to_printer'
        : effectiveStatus === 'failed'
          ? 'failed'
          : effectiveStatus === 'rendering'
            ? 'rendering'
            : row.payment_status === 'paid'
              ? 'paid_pending'
              : 'waiting';
    res.status(200).json({
      exportRequestId: row.id,
      status: effectiveStatus,
      paymentStatus: row.payment_status,
      printerOrderId: gelatoReady ? row.printer_order_id : null,
      lastError,
      gelatoReady,
      phase,
    });
  });
}
