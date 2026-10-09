/**
 * Après paiement print : stash (si besoin) + kick 202 — **sans** attendre Gelato.
 * Retries / échecs permanents = serveur (scheduler + mail support).
 *
 * Règle d’or V2 + Low Friction : UI confirme dès paid ; PDF/Gelato en fond.
 */
import { getUserTier } from '@/lib/userTier';
import {
  clearPendingBookOrderPdfPayload,
  getPendingBookOrderPdfPayload,
} from '@/lib/pendingBookOrderPdf';
import {
  clearPendingPrintPayment,
  clearPendingPrintPaymentStashed,
  getPendingPrintPayment,
  markPendingPrintPaymentStashed,
} from '@/lib/pendingPrintPayment';
import { printBreadcrumb, printCaptureError, printCaptureMessage } from '@/lib/printFlowSentry';
import {
  fetchPrintFulfillStatusWithExportTicket,
  kickPrintFulfillAcceptedOnly,
  stashPrintBookPayloadWithExportTicket,
} from '@/services/bookPdfServer';
import { fetchPrintPaymentStatus } from '@/services/printPayment';

export type FinishPrintResult = 'done' | 'noop' | 'error' | 'missing_payload';

let inFlight: Promise<FinishPrintResult> | null = null;

/** Promesse stash book-order (prefetch / pendant Checkout) — le helper s’y joint au lieu de relancer. */
let trackedStash: Promise<unknown> | null = null;

export function trackPrintStashPromise<T>(p: Promise<T>): Promise<T> {
  trackedStash = p;
  return p.finally(() => {
    if (trackedStash === p) trackedStash = null;
  });
}

function fulfillNeedsFreshStash(status: {
  phase: string;
  status: string;
  lastError: string | null;
  gelatoReady: boolean;
}): boolean {
  if (status.gelatoReady) return false;
  if (status.phase === 'failed' || status.status === 'failed') {
    const err = (status.lastError ?? '').trim();
    // Permanent métier hors payload : pas de re-stash client utile.
    if (/shipping address|crm contact|subscriptionTier|pageCount|ProductUid/i.test(err)) {
      return false;
    }
    return /local URL|PAYLOAD_|re-stash|PDF_CROP|file:\/\//i.test(err) || !err;
  }
  const err = (status.lastError ?? '').trim();
  return /local URL|PAYLOAD_|re-stash|PDF_CROP|file:\/\//i.test(err);
}

async function stashPendingForTicket(
  exportTicket: string,
  exportRequestId: string,
): Promise<'ok' | 'missing_payload'> {
  const pendingPayload = await getPendingBookOrderPdfPayload();
  if (!pendingPayload || pendingPayload.exportMode !== 'print') {
    printCaptureMessage(
      'print.stashAfterPaid',
      'print: paid but no local payload to stash',
      'error',
      { exportRequestId },
    );
    return 'missing_payload';
  }
  printBreadcrumb('print.finish.stash_start', {
    exportRequestId,
    pages: pendingPayload.pages?.length ?? 0,
  });
  const tier = await getUserTier();
  await stashPrintBookPayloadWithExportTicket({
    ...pendingPayload,
    exportMode: 'print',
    exportTicket,
    subscriptionTier: tier === 'paid' ? 'premium' : 'free',
  });
  await markPendingPrintPaymentStashed(exportTicket);
  printBreadcrumb('print.finish.stash_ok', { exportRequestId });
  return 'ok';
}

/**
 * Stash manquant + kick 202. Ne bloque **pas** sur Chromium/Gelato.
 * `done` = filet client OK (serveur a accepté le travail) ou déjà chez Gelato.
 */
export async function finishPrintStashAndKickIfNeeded(): Promise<FinishPrintResult> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const pending = await getPendingPrintPayment();
      if (!pending) {
        printBreadcrumb('print.finish.noop_no_pending');
        return 'noop';
      }

      printBreadcrumb('print.finish.start', {
        exportRequestId: pending.exportRequestId,
        stashed: pending.stashed === true,
        bookId: pending.bookId,
      });

      let st: 'unpaid' | 'paid' | 'failed' | 'refunded' = 'unpaid';
      try {
        st = await fetchPrintPaymentStatus(pending.exportTicket);
      } catch (e) {
        printCaptureError('print.finish.status', e, {
          exportRequestId: pending.exportRequestId,
        });
        return 'error';
      }
      if (st !== 'paid') {
        printBreadcrumb('print.finish.noop_not_paid', { status: st });
        return 'noop';
      }

      if (trackedStash) {
        printBreadcrumb('print.finish.join_tracked_stash');
        await trackedStash.catch(() => undefined);
      }

      const pendingAfter = await getPendingPrintPayment();
      const stillPending = pendingAfter ?? pending;

      let forceRestash = !stillPending.stashed;
      try {
        const fulfill = await fetchPrintFulfillStatusWithExportTicket(stillPending.exportTicket);
        if (fulfill.gelatoReady && fulfill.printerOrderId) {
          await clearPendingPrintPayment();
          await clearPendingBookOrderPdfPayload();
          printBreadcrumb('print.finish.already_gelato', {
            exportRequestId: stillPending.exportRequestId,
            printerOrderId: fulfill.printerOrderId,
          });
          return 'done';
        }
        if (fulfillNeedsFreshStash(fulfill)) {
          forceRestash = true;
          printBreadcrumb('print.finish.force_restash', {
            exportRequestId: stillPending.exportRequestId,
            phase: fulfill.phase,
            status: fulfill.status,
            lastError: (fulfill.lastError ?? '').slice(0, 120),
          });
        }
      } catch (e) {
        printBreadcrumb('print.finish.fulfill_status_skip', {
          exportRequestId: stillPending.exportRequestId,
          err: e instanceof Error ? e.message.slice(0, 80) : 'unknown',
        });
      }

      if (forceRestash) {
        await clearPendingPrintPaymentStashed(stillPending.exportTicket);
        const stashResult = await stashPendingForTicket(
          stillPending.exportTicket,
          stillPending.exportRequestId,
        );
        if (stashResult === 'missing_payload') return 'missing_payload';
      }

      printBreadcrumb('print.finish.kick_start', {
        exportRequestId: stillPending.exportRequestId,
      });
      await kickPrintFulfillAcceptedOnly(stillPending.exportTicket);
      await clearPendingPrintPayment();
      await clearPendingBookOrderPdfPayload();
      printBreadcrumb('print.finish.kick_accepted', {
        exportRequestId: stillPending.exportRequestId,
      });
      return 'done';
    } catch (e) {
      printCaptureError('print.stashAfterPaid', e);
      return 'error';
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
