export type PrintFulfillFailureKind = 'retryable' | 'permanent';

/** Plafond retries fond (≈ 24–48 h selon backoff). */
export const PRINT_FULFILL_MAX_ATTEMPTS = 12;

/** Backoff en secondes indexé par attempt après échec (1-based → index attempt-1). */
export const PRINT_FULFILL_BACKOFF_SECONDS = [
  60, // 1 min
  5 * 60,
  15 * 60,
  30 * 60,
  60 * 60,
  60 * 60,
  2 * 60 * 60,
  2 * 60 * 60,
  3 * 60 * 60,
  3 * 60 * 60,
  6 * 60 * 60,
  6 * 60 * 60,
] as const;

/** `rendering` sans Gelato plus longtemps que ça → traité comme échec retryable. */
export const PRINT_FULFILL_RENDERING_STUCK_MS = 15 * 60 * 1000;

/**
 * Course webhook vs stash : PAYLOAD_MISSING est **normal** quelques minutes.
 * Escalade permanent seulement après cette fenêtre (ou N tentatives).
 */
export const PRINT_AWAITING_STASH_MAX_MS = 45 * 60 * 1000;
export const PRINT_AWAITING_STASH_ESCALATE_ATTEMPTS = 8;

/** Backoff court tant que le stash peut encore arriver. */
const AWAITING_STASH_BACKOFF_SECONDS = [
  30, 60, 2 * 60, 5 * 60, 10 * 60, 15 * 60, 15 * 60, 30 * 60,
] as const;

/** Erreur de course stash (webhook trop tôt / re-upload client attendu). */
export function isAwaitingStashError(raw: string): boolean {
  return /PAYLOAD_MISSING|PAYLOAD_LOCAL|local URL|stash before checkout|PRINT_PAYLOAD_LOCAL|re-stash|file:\/\//i.test(
    (raw ?? '').trim(),
  );
}

export function shouldEscalateAwaitingStash(
  paidAt: string | null | undefined,
  attemptCount: number,
): boolean {
  if (attemptCount >= PRINT_AWAITING_STASH_ESCALATE_ATTEMPTS) return true;
  if (!paidAt) return false;
  const t = Date.parse(paidAt);
  return Number.isFinite(t) && Date.now() - t >= PRINT_AWAITING_STASH_MAX_MS;
}

/**
 * Permanent = pas la peine de rejouer sans action humaine.
 * Retryable = 5xx, réseau, Chromium flaky, course stash…
 */
export function classifyPrintFulfillError(raw: string): PrintFulfillFailureKind {
  const msg = (raw ?? '').trim();
  if (!msg) return 'retryable';

  // Course stash / file:// : retryable d’abord (escalade dans recordPrintFulfillFailure).
  if (isAwaitingStashError(msg)) {
    return 'retryable';
  }
  if (
    /shipping address incomplete|crm contact email missing|bookId does not match|subscriptionTier does not match/i.test(
      msg,
    )
  ) {
    return 'permanent';
  }
  if (/guestMemories missing|Aucune page livre|GELATO_.*pageCount|pageCount catalogue|impair/i.test(msg)) {
    return 'permanent';
  }
  if (/ProductUid .* is not supported|gelato skip: pageCount/i.test(msg)) {
    return 'permanent';
  }
  // 4xx Gelato (sauf 429) souvent métier / adresse.
  if (/\bgelato\b.*\b(400|401|403|404|422)\b/i.test(msg) || /\b(400|401|403|404|422)\b.*\bgelato\b/i.test(msg)) {
    return 'permanent';
  }

  // Transitoire.
  if (
    /ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|fetch failed|aborted|429|502|503|504|Too many connections|SIGSEGV|browser has been closed|Target page|Protocol error|Connection closed|PDF_CROP|STORAGE|timeout/i.test(
      msg,
    )
  ) {
    return 'retryable';
  }

  // Défaut : retry (mieux que silence permanent sur erreur inconnue).
  return 'retryable';
}

export function nextPrintFulfillRetryAt(
  attemptCountAfterFailure: number,
  from = new Date(),
  errorMsg?: string,
): Date {
  const awaiting = errorMsg ? isAwaitingStashError(errorMsg) : false;
  const table = awaiting ? AWAITING_STASH_BACKOFF_SECONDS : PRINT_FULFILL_BACKOFF_SECONDS;
  const idx = Math.max(0, Math.min(table.length - 1, attemptCountAfterFailure - 1));
  const sec = table[idx] ?? 3600;
  return new Date(from.getTime() + sec * 1000);
}
