import type { SupabaseClient } from '@supabase/supabase-js';
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
  if (/^resend\b/i.test(e)) return true;
  if (/no_resend_key/i.test(e)) return true;
  return false; // no_email / no_address → ops
}

/**
 * Une passe : watchdog rendering stuck + retries `failed`/`retryable` dus
 * + retry e-mail confirmation cliente (Gelato OK, mail pas parti).
 * Idempotent ; à appeler périodiquement depuis le process Railway.
 */
export async function sweepPrintFulfillRetries(params: {
  supabase: SupabaseClient;
  projectOrigin: string;
}): Promise<{ retried: number; watchdog: number; confirmationEmails: number }> {
  const { supabase, projectOrigin } = params;
  let watchdog = 0;
  let retried = 0;
  let confirmationEmails = 0;

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
      // fulfillPrintOrderFromStoredPayload reset failed→created puis rejoue.
      const result = await fulfillPrintOrderFromStoredPayload({
        supabase,
        projectOrigin,
        exportRequestId: id,
      });
      retried += 1;
      if (!result.ok && result.code !== 'IN_PROGRESS') {
        // recordPrintFulfillFailure déjà appelé dans fulfill si chemin run/catch ;
        // pour early returns (PAYLOAD_*) on a déjà recordé. No-op ici.
        console.warn('[printFulfillRetry] result', id, result.status, result.error);
      }
    }
  }

  // P1.2 — Gelato OK mais mail confirmation jamais envoyé (Resend / réseau).
  const paidSince = new Date(Date.now() - CONFIRMATION_EMAIL_RETRY_MAX_AGE_MS).toISOString();
  const { data: emailRows, error: emailErr } = await supabase
    .from('export_requests')
    .select('id, confirmation_email_error')
    .eq('type', 'print_order')
    .eq('payment_status', 'paid')
    .eq('status', 'sent_to_printer')
    .not('printer_order_id', 'is', null)
    .is('confirmation_email_sent_at', null)
    .gte('paid_at', paidSince)
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
      if (!isRetryableConfirmationEmailError(err)) continue;
      console.log('[printFulfillRetry] confirmation email', id);
      triggerPrintOrderConfirmationEmail({ projectOrigin, exportRequestId: id });
      confirmationEmails += 1;
    }
  }

  return { retried, watchdog, confirmationEmails };
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
        if (r.retried > 0 || r.watchdog > 0 || r.confirmationEmails > 0) {
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
