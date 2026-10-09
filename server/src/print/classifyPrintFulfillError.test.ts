import assert from 'node:assert/strict';
import {
  classifyPrintFulfillError,
  isAwaitingStashError,
  nextPrintFulfillRetryAt,
  PRINT_FULFILL_BACKOFF_SECONDS,
  shouldEscalateAwaitingStash,
  PRINT_AWAITING_STASH_ESCALATE_ATTEMPTS,
} from './classifyPrintFulfillError';

assert.equal(classifyPrintFulfillError('ECONNRESET boom'), 'retryable');
assert.equal(classifyPrintFulfillError('PDF_CROP_IMAGE_LOAD_FAILED https://…'), 'retryable');
assert.equal(
  classifyPrintFulfillError('PAYLOAD_LOCAL: pdf_payload contains local URL (file:///x) — re-stash'),
  'retryable',
);
assert.equal(classifyPrintFulfillError('PAYLOAD_MISSING'), 'retryable');
assert.ok(isAwaitingStashError('PAYLOAD_MISSING: stash before checkout'));
assert.equal(classifyPrintFulfillError('gelato 400 bad address'), 'permanent');
assert.equal(classifyPrintFulfillError('gelato 503 upstream'), 'retryable');

const t0 = new Date('2026-01-01T00:00:00.000Z');
const t1 = nextPrintFulfillRetryAt(1, t0);
assert.equal(t1.getTime() - t0.getTime(), PRINT_FULFILL_BACKOFF_SECONDS[0]! * 1000);

const stashRetry = nextPrintFulfillRetryAt(1, t0, 'PAYLOAD_MISSING');
assert.equal(stashRetry.getTime() - t0.getTime(), 30 * 1000);

assert.equal(shouldEscalateAwaitingStash(null, 1), false);
assert.equal(shouldEscalateAwaitingStash(new Date().toISOString(), 1), false);
assert.equal(shouldEscalateAwaitingStash(new Date().toISOString(), PRINT_AWAITING_STASH_ESCALATE_ATTEMPTS), true);
const oldPaid = new Date(Date.now() - 50 * 60 * 1000).toISOString();
assert.equal(shouldEscalateAwaitingStash(oldPaid, 2), true);

console.log('classifyPrintFulfillError.test.ts OK');
