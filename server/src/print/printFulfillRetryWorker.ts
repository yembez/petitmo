import type { SupabaseClient } from '@supabase/supabase-js';
import { triggerPrintFulfillOpsAlert } from '../email/triggerPrintFulfillOpsAlert';
import { triggerPrintOrderConfirmationEmail } from '../email/triggerPrintOrderConfirmation';
import {
  PRINT_FULFILL_MAX_ATTEMPTS,
  PRINT_FULFILL_RENDERING_STUCK_MS,
} from './classifyPrintFulfillError';
import { fulfillPrintOrderFromStoredPayload } from './fulfillPrintOrder';
import { recordPrintFulfillFailure } from './recordPrintFulfillFailure';

const SWEEP_LIMIT = 5;
/** Fenêtre pour rejouer l’e-mail confirmation cliente (Resend flaky / race). */
const CONFIRMATION_EMAIL_RETRY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isRetryableConfirmationEmailError(err: string | null | undefined): boolean {
  if (err == null || !String(err).trim()) return true; // jamais tenté / fetch avant claim
  const e = String(err).trim();
  if (/^abandoned:/i.test(e)) return false;
  if (/^resend\b/i.test(e)) return true;
  if (/no_resend_key/i.test(e)) return true;
  return false; // no_email / no_address → ops manuel
}

/**
 * Une passe : watchdog rendering stuck + retries `failed`/`retryable` dus
 * + retry e-mail confirmation cliente (Gelato OK, mail pas parti)
 * + re-sweep ops alert permanent sans mail.
 * Idempotent ; à appeler périodiquement depuis le process Railway.
 */
export async function sweepPrintFulfillRetries(params: {
  supabase: SupabaseClient;
  projectOrigin: string;
}): Promise<{
  retried: number;
  watchdog: number;
  confirmationEmails: number;
  opsAlerts: number;
}> {
  const { supabase, projectOrigin } = params;
  let watchdog = 0;
  let retried = 0;
  let confirmationEmails = 0;
  let opsAlerts = 0;

  const stuckBefore = new Date(Date.now() - PRINT_FULFILL_RENDERING_STUCK_MS).toISOString();
  const { data: stuckRows, error: stuckErr } = await supabase
    .from('export_requests')
    .select('id, last_error')
    .eq('type', 'print_order')
    .eq('payment_status', 'paid')
    .eq('status', 'rendering')
    .is('printer_order_id', null)
    .lt('updated_at', stuckBefore)
    .limit(SWEEP_LIMIT);

  if (stuckErr) {
    console.error('[printFulfillRetry] watchdog query', stuckErr.message);
  } else {
    for (const row of stuckRows ?? []) {
      const id = typeof row.id === 'string' ? row.id : '';
      if (!id) continue;
      await recordPrintFulfillFailure({
        supabase,
        projectOrigin,
        exportRequestId: id,
        error:
          (typeof row.last_error === 'string' && row.last_error.trim()) ||
          'rendering stuck >15min without printer_order_id',
        forceKind: 'retryable',
      });
      watchdog += 1;
    }
  }

  const nowIso = new Date().toISOString();
  const { data: dueRows, error: dueErr } = await supabase
    .from('export_requests')
    .select('id, fulfill_attempt_count')
    .eq('type', 'print_order')
    .eq('payment_status', 'paid')
    .eq('status', 'failed')
    .eq('fulfill_failed_kind', 'retryable')
    .is('printer_order_id', null)
    .lte('fulfill_next_retry_at', nowIso)
    .lt('fulfill_attempt_count', PRINT_FULFILL_MAX_ATTEMPTS)
    .order('fulfill_next_retry_at', { ascending: true })
    .limit(SWEEP_LIMIT);

  if (dueErr) {
    console.error('[printFulfillRetry] due query', dueErr.message);
  } else {
    for (const row of dueRows ?? []) {
      const id = typeof row.id === 'string' ? row.id : '';
      if (!id) continue;
      console.log('[printFulfillRetry] kick', id);
      const result = await fulfillPrintOrderFromStoredPayload({
        supabase,
        projectOrigin,
        exportRequestId: id,
      });
      retried += 1;
      if (!result.ok && result.code !== 'IN_PROGRESS') {
        console.warn('[printFulfillRetry] result', id, result.status, result.error);
      }
    }
  }

  // Mail confirmation : dû (next_retry null ou passé) + pas abandoned.
  const paidSince = new Date(Date.now() - CONFIRMATION_EMAIL_RETRY_MAX_AGE_MS).toISOString();
  const { data: emailRows, error: emailErr } = await supabase
    .from('export_requests')
    .select(
      'id, confirmation_email_error, confirmation_email_attempt_count, confirmation_email_next_retry_at, print_ops_alert_sent_at',
    )
    .eq('type', 'print_order')
    .eq('payment_status', 'paid')
    .eq('status', 'sent_to_printer')
    .not('printer_order_id', 'is', null)
    .is('confirmation_email_sent_at', null)
    .gte('paid_at', paidSince)
    .or(`confirmation_email_next_retry_at.is.null,confirmation_email_next_retry_at.lte.${nowIso}`)
    .order('paid_at', { ascending: true })
    .limit(SWEEP_LIMIT);

  if (emailErr) {
    console.error('[printFulfillRetry] confirmation email query', emailErr.message);
  } else {
    for (const row of emailRows ?? []) {
      const id = typeof row.id === 'string' ? row.id : '';
      if (!id) continue;
      const err =
        typeof row.confirmation_email_error === 'string' ? row.confirmation_email_error : null;
      if (/^abandoned:/i.test(err ?? '')) {
        // Gelato OK, mail abandonné → un seul mail ops (claim print_ops_alert_sent_at).
        const already =
          typeof row.print_ops_alert_sent_at === 'string' && !!row.print_ops_alert_sent_at;
        if (!already) {
          const attempts =
            typeof row.confirmation_email_attempt_count === 'number'
              ? row.confirmation_email_attempt_count
              : 0;
          console.log('[printFulfillRetry] confirmation email abandoned → ops', id);
          triggerPrintFulfillOpsAlert({
            projectOrigin,
            exportRequestId: id,
            lastError: err || 'confirmation email abandoned',
            attemptCount: attempts,
            alertKind: 'confirmation_email',
          });
          opsAlerts += 1;
        }
        continue;
      }
      if (!isRetryableConfirmationEmailError(err)) continue;
      console.log('[printFulfillRetry] confirmation email', id);
      triggerPrintOrderConfirmationEmail({ projectOrigin, exportRequestId: id });
      confirmationEmails += 1;
    }
  }

  // Re-sweep ops : permanent fulfill sans mail support (Resend KO au 1er essai).
  const { data: opsRows, error: opsErr } = await supabase
    .from('export_requests')
    .select('id, last_error, fulfill_attempt_count')
    .eq('type', 'print_order')
    .eq('payment_status', 'paid')
    .eq('status', 'failed')
    .eq('fulfill_failed_kind', 'permanent')
    .is('printer_order_id', null)
    .is('print_ops_alert_sent_at', null)
    .gte('paid_at', paidSince)
    .order('paid_at', { ascending: true })
    .limit(SWEEP_LIMIT);

  if (opsErr) {
    console.error('[printFulfillRetry] ops alert query', opsErr.message);
  } else {
    for (const row of opsRows ?? []) {
      const id = typeof row.id === 'string' ? row.id : '';
      if (!id) continue;
      const attempts =
        typeof row.fulfill_attempt_count === 'number' ? row.fulfill_attempt_count : 0;
      console.log('[printFulfillRetry] ops alert', id);
      triggerPrintFulfillOpsAlert({
        projectOrigin,
        exportRequestId: id,
        lastError:
          (typeof row.last_error === 'string' && row.last_error.trim()) || 'permanent fulfill',
        attemptCount: attempts,
        alertKind: 'fulfill_permanent',
      });
      opsAlerts += 1;
    }
  }

  return { retried, watchdog, confirmationEmails, opsAlerts };
}

export function startPrintFulfillRetryScheduler(params: {
  supabase: SupabaseClient;
  projectOrigin: string;
  intervalMs?: number;
}): void {
  const intervalMs = params.intervalMs ?? 2 * 60 * 1000;
  const tick = () => {
    void sweepPrintFulfillRetries(params)
      .then(r => {
        if (r.retried > 0 || r.watchdog > 0 || r.confirmationEmails > 0 || r.opsAlerts > 0) {
          console.log('[printFulfillRetry] sweep', r);
        }
      })
      .catch(e => {
        console.error('[printFulfillRetry] sweep error', e instanceof Error ? e.message : e);
      });
  };
  // Premier sweep différé (laisser le boot / warm Chromium).
  setTimeout(tick, 45_000);
  setInterval(tick, intervalMs);
  console.log('[printFulfillRetry] scheduler every', intervalMs, 'ms');
}
