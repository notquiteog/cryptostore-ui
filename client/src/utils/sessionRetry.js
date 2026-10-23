/**
 * Whether a failed session check is worth waiting out, and for how long.
 *
 * The pure half of the "not confirmed yet" state in `context/AuthContext.jsx`,
 * kept apart so `client/test/sessionRetry.test.mjs` can pin it without a
 * browser. Every rule here is one comparison that looks safe to tidy, and each
 * one fails quietly: a person bounced to the sign-in form, a deactivated
 * account left on a page that spins forever, or a store asked twice a second
 * by every tab that was open when it fell over.
 *
 * ── Which failures are transient ────────────────────────────────────────────
 *
 * Only the ones that say nothing about the session:
 *
 *   no status at all   fetch rejected — the connection dropped, a Tor circuit
 *                      collapsed, a resolver failed. Nothing reached the store.
 *   429                the rate limiter answered. The token was never looked at.
 *   503 + `offline`    the service worker's own reply when the network is gone
 *                      (public/sw-push.js): offline, not signed out.
 *   408, 5xx           a proxy timing out, a restart in progress, a crash.
 *
 * Everything else is an answer ABOUT the account. A 401 belongs to `api.js`,
 * which clears the token and goes to /login — that path is the one way a
 * session ends, and nothing here touches it. A 403 from `authenticate` is
 * "Account is deactivated"; treating that as transient would turn a
 * deactivated account into a retry card that never resolves, so it keeps the
 * signed-out treatment it always had.
 */

/** The first wait, and the shortest any wait may be. */
export const RETRY_FLOOR_MS = 2_000;

/** Where the doubling backoff stops doubling. */
export const RETRY_CEILING_MS = 30_000;

/**
 * The longest server-requested wait honoured before trying anyway. The global
 * limiter's window can be set to a day (config/limits.js); a card promising to
 * try again tomorrow is a card nobody believes, and a check at fifteen minutes
 * that meets another 429 simply learns the new wait.
 */
export const LONGEST_HONOURED_WAIT_MS = 15 * 60_000;

/**
 * 'network' | 'rate' | 'offline' | 'server' for a failure worth waiting out,
 * or null for one that is an answer about the session.
 *
 * Takes the Error `api.js` throws, which carries `status` and the parsed body
 * as `data` — or whatever `fetch` itself rejected with, which carries neither.
 */
export function classifyFailure(err) {
  if (!err) return null;
  const status = Number(err.status);
  if (!status) return 'network';
  if (status === 429) return 'rate';
  if (status === 503 && err.data?.offline) return 'offline';
  if (status === 408 || (status >= 500 && status <= 599)) return 'server';
  return null;
}

/**
 * A `Retry-After` header as milliseconds from now, or null.
 *
 * Both of the header's forms (RFC 9110 §10.2.3): delta-seconds, which is what
 * express-rate-limit sends from `server/middleware/rateLimiters.js`, and an
 * HTTP-date, which a reverse proxy in front of the store may send instead. A
 * date already past reads as zero; anything else is null, so the caller falls
 * back to its own backoff rather than waiting on a number it made up.
 *
 * The date form must contain a letter, because `Date.parse` is generous in
 * ways that matter here: it reads "1.5" as the fifth of January 2001, which is
 * in the past and would have become "retry immediately".
 */
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  if (!/[a-z]/i.test(s)) return null;
  const at = Date.parse(s);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * How long to wait before the next check, given how many have failed so far.
 *
 * The server's word when it gave one — retrying a 429 early is not faster, it
 * is another 429 counted against the same window — and otherwise a doubling
 * backoff from two seconds: 2, 4, 8, 16, then about every 30. The ceiling keeps
 * a store that stays down from being asked twice a minute forever by every tab
 * that was open when it fell; the floor keeps a `Retry-After: 0` from becoming
 * a tight loop.
 *
 * The backoff is jittered by ±10% so a hundred buyers who lost the store in the
 * same restart do not all come back in the same second. The server's own wait
 * is not jittered: it is a statement about when the window reopens.
 */
export function nextRetryDelay(attempt, retryAfterMs = null, random = Math.random) {
  if (retryAfterMs != null && Number.isFinite(retryAfterMs)) {
    return Math.min(Math.max(retryAfterMs, RETRY_FLOOR_MS), LONGEST_HONOURED_WAIT_MS);
  }
  const n = Math.max(0, Math.floor(Number(attempt) || 0));
  const base = Math.min(RETRY_CEILING_MS, RETRY_FLOOR_MS * 2 ** n);
  return Math.round(base * (0.9 + 0.2 * random()));
}

/** "7s" under a minute, "4:05" above it — the countdown on the retry card. */
export function formatWait(ms) {
  const s = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
