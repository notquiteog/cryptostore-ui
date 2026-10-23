/**
 * When a failed session check is waited out — `src/utils/sessionRetry.js`.
 *
 *   node --test client/test/sessionRetry.test.mjs
 *
 * ── Why this test exists ────────────────────────────────────────────────────
 *
 * `AuthContext` used to keep the token on a transient failure and still leave
 * `user` null, so every route guard sent a signed-in person to /login the first
 * time the rate limiter, a Tor circuit or a restart got in the way. The fix
 * turns on one question — was that failure about the session or not? — and on
 * how long to wait before asking again. Get the first wrong in one direction
 * and people are bounced again; in the other, a deactivated account spins on a
 * retry card forever. Get the second wrong and a store that stays down is asked
 * in a tight loop by every tab that was open when it fell.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyFailure, formatWait, LONGEST_HONOURED_WAIT_MS, nextRetryDelay, parseRetryAfter,
  RETRY_CEILING_MS, RETRY_FLOOR_MS,
} from '../src/utils/sessionRetry.js';

const failure = (status, data = {}) => Object.assign(new Error('x'), { status, data });

test('failures that say nothing about the session are transient', () => {
  assert.equal(classifyFailure(new TypeError('Failed to fetch')), 'network');
  assert.equal(classifyFailure(failure(429)), 'rate');
  assert.equal(classifyFailure(failure(503, { offline: true })), 'offline');
  assert.equal(classifyFailure(failure(503)), 'server');
  assert.equal(classifyFailure(failure(502)), 'server');
  assert.equal(classifyFailure(failure(500)), 'server');
  assert.equal(classifyFailure(failure(408)), 'server');
});

test('answers about the account are not waited out', () => {
  // 401 is api.js's to handle — it clears the token and goes to /login.
  assert.equal(classifyFailure(failure(401)), null);
  // authenticate's "Account is deactivated". Retrying it would spin forever.
  assert.equal(classifyFailure(failure(403)), null);
  assert.equal(classifyFailure(failure(404)), null);
  assert.equal(classifyFailure(failure(400)), null);
  assert.equal(classifyFailure(null), null);
});

test('Retry-After is read in both of its forms', () => {
  assert.equal(parseRetryAfter('6'), 6000);
  assert.equal(parseRetryAfter(' 120 '), 120_000);
  const now = Date.UTC(2026, 8, 11, 12, 0, 0);
  assert.equal(parseRetryAfter('Fri, 11 Sep 2026 12:00:30 GMT', now), 30_000);
  // A date already past means "now", never a negative wait.
  assert.equal(parseRetryAfter('Fri, 11 Sep 2026 11:00:00 GMT', now), 0);
});

test('an unreadable Retry-After is null, never a guess', () => {
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter(''), null);
  assert.equal(parseRetryAfter('soon'), null);
  // Date.parse reads this as 5 January 2001 — in the past, so "retry now".
  assert.equal(parseRetryAfter('1.5'), null);
  assert.equal(parseRetryAfter('-3'), null);
});

test('the backoff doubles from the floor and stops at the ceiling', () => {
  const mid = () => 0.5; // no jitter
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 9].map((n) => nextRetryDelay(n, null, mid)),
    [2000, 4000, 8000, 16000, RETRY_CEILING_MS, RETRY_CEILING_MS, RETRY_CEILING_MS],
  );
  assert.equal(nextRetryDelay(0, null, mid), RETRY_FLOOR_MS);
});

test('the backoff is jittered within ten percent', () => {
  assert.equal(nextRetryDelay(2, null, () => 0), 7200);
  assert.equal(nextRetryDelay(2, null, () => 1), 8800);
});

test('the server\'s wait wins over the backoff, within bounds', () => {
  assert.equal(nextRetryDelay(0, 6000), 6000);
  assert.equal(nextRetryDelay(7, 6000), 6000);
  // Retry-After: 0 must not become a tight loop.
  assert.equal(nextRetryDelay(0, 0), RETRY_FLOOR_MS);
  // A day-long window is not a promise anyone waits out on a card.
  assert.equal(nextRetryDelay(0, 24 * 3600_000), LONGEST_HONOURED_WAIT_MS);
});

test('the countdown reads as seconds, then minutes', () => {
  assert.equal(formatWait(6000), '6s');
  assert.equal(formatWait(5400), '6s');
  assert.equal(formatWait(0), '0s');
  assert.equal(formatWait(-50), '0s');
  assert.equal(formatWait(245_000), '4:05');
});
