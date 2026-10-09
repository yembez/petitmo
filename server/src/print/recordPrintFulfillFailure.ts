import type { SupabaseClient } from '@supabase/supabase-js';
import {
  classifyPrintFulfillError,
  isAwaitingStashError,
  nextPrintFulfillRetryAt,
  PRINT_FULFILL_MAX_ATTEMPTS,
  shouldEscalateAwaitingStash,
  type PrintFulfillFailureKind,
} from './classifyPrintFulfillError';
import { triggerPrintFulfillOpsAlert } from '../email/triggerPrintFulfillOpsAlert';

export type RecordPrintFulfillFailureResult = {
  kind: PrintFulfillFailureKind;
  attemptCount: number;
  nextRetryAt: string | null;
  opsAlertTriggered: boolean;
};

/**
 * Marque failed + schedule retry ou permanent + mail support (une fois).
 */
export async function recordPrintFulfillFailure(params: {
  supabase: SupabaseClient;
  projectOrigin: string;
  exportRequestId: string;
  error: string;
  /** Force kind (ex. watchdog rendering stuck → retryable). */
  forceKind?: PrintFulfillFailureKind;
}): Promise<RecordPrintFulfillFailureResult> {
  const { supabase, projectOrigin, exportRequestId } = params;
  const err = (params.error ?? '').trim().slice(0, 2000) || 'unknown fulfill error';

  const { data: row } = await supabase
    .from('export_requests')
    .select('fulfill_attempt_count, print_ops_alert_sent_at, paid_at')
    .eq('id', exportRequestId)
    .maybeSingle();

  const prevAttempts =
    typeof (row as { fulfill_attempt_count?: unknown } | null)?.fulfill_attempt_count === 'number'
      ? Math.max(0, (row as { fulfill_attempt_count: number }).fulfill_attempt_count)
      : 0;
  const attemptCount = prevAttempts + 1;
  const paidAt =
    typeof (row as { paid_at?: unknown } | null)?.paid_at === 'string'
      ? (row as { paid_at: string }).paid_at
      : null;

  let kind: PrintFulfillFailureKind = params.forceKind ?? classifyPrintFulfillError(err);
  if (attemptCount >= PRINT_FULFILL_MAX_ATTEMPTS) {
    kind = 'permanent';
  } else if (kind === 'retryable' && isAwaitingStashError(err) && shouldEscalateAwaitingStash(paidAt, attemptCount)) {
    // Course stash trop longue → mail ops (soft UI garde « En préparation » jusqu’ici).
    kind = 'permanent';
  }

  const nextRetryAt =
    kind === 'retryable' ? nextPrintFulfillRetryAt(attemptCount, new Date(), err).toISOString() : null;

  const { error: upErr } = await supabase
    .from('export_requests')
    .update({
      status: 'failed',
      last_error: err,
      fulfill_attempt_count: attemptCount,
      fulfill_failed_kind: kind,
      fulfill_next_retry_at: nextRetryAt,
    })
    .eq('id', exportRequestId);

  if (upErr) {
    console.error('[recordPrintFulfillFailure] update', exportRequestId, upErr.message);
  } else {
    console.log(
      '[recordPrintFulfillFailure]',
      exportRequestId,
      kind,
      `attempt=${attemptCount}`,
      nextRetryAt ? `next=${nextRetryAt}` : 'no-retry',
    );
  }

  let opsAlertTriggered = false;
  if (kind === 'permanent') {
    const already =
      typeof (row as { print_ops_alert_sent_at?: unknown } | null)?.print_ops_alert_sent_at === 'string' &&
      !!(row as { print_ops_alert_sent_at: string }).print_ops_alert_sent_at;
    if (!already) {
      opsAlertTriggered = true;
      triggerPrintFulfillOpsAlert({
        projectOrigin,
        exportRequestId,
        lastError: err,
        attemptCount,
      });
    }
  }

  return { kind, attemptCount, nextRetryAt, opsAlertTriggered };
}

/** Succès Gelato : nettoyer la machine d’état retry. */
export async function clearPrintFulfillRetryState(
  supabase: SupabaseClient,
  exportRequestId: string,
): Promise<void> {
  await supabase
    .from('export_requests')
    .update({
      fulfill_failed_kind: null,
      fulfill_next_retry_at: null,
      last_error: null,
    })
    .eq('id', exportRequestId);
}
