import toast from 'react-hot-toast';
import { uploadWithProgress } from './uploadProgress';
import { clearConversation } from './aiConversation';
import { proofFor, forgetNoWork } from './pow';
import { parseRetryAfter } from './sessionRetry';

import { recordCatalogResponse } from './offlineCatalog';

const BASE = '/api';

/**
 * Every door that may carry a proof-of-work gate, by method and exact path.
 * Kept here rather than at each call site so the surfaces cannot drift from
 * the server's list (config/limits.js POW_SURFACES) — a login form that forgot
 * to attach the proof would be a login form that stopped working the day the
 * operator turned the puzzle on.
 *
 * Keyed by METHOD too, because the ladder made it worth gating reads. Search is
 * a GET, and the old `if (method !== 'POST') return null` would have skipped it
 * silently: the request would go out bare, the gate would refuse it the moment
 * a scraper pushed that browser up the ladder, and the catalogue would stop
 * loading with no indication why.
 */
const POW_SURFACES = {
  'POST /auth/login': 'login',
  'POST /auth/register': 'register',
  // Answering every username with a well-formed decoy block is what makes this
  // safe against enumeration and also what makes it expensive: an RSA operation
  // per request, for a caller with no account.
  'POST /auth/pgp-challenge': 'pgp_challenge',
  'POST /orders': 'checkout',
  // The assistant is the door that costs the shop real GPU time for a request
  // that costs the asker nothing, so it is the one most worth a puzzle if
  // signed-out visitors are allowed to use it (docs/AI.md §8). It streams, so
  // it does not go through `request()` below — `powHeaderFor` is exported for
  // the one caller that has to build its own fetch.
  'POST /ai/ask': 'assistant',
  // A spoken turn costs a transcription on top of a generation, so it carries
  // its own surface and its own (tighter) difficulty.
  'POST /ai/voice/transcribe': 'converse',
  'POST /ai/voice/speak': 'converse',
  'POST /ai/memory': 'assistant',
  // Two guessing oracles for things that are worth money. The puzzle shapes the
  // traffic; the rate limit is what actually bounds the guesses.
  'POST /coupons/validate': 'coupon_validate',
  'POST /subusers/credit/redeem-voucher': 'voucher_redeem',
  'POST /support': 'support_ticket',
  'POST /reviews': 'review_write',
  // Full-text and trigram queries — the most expensive thing an anonymous
  // visitor can ask Postgres to do. The free run is large enough that ordinary
  // browsing never meets a puzzle; scraping does.
  'GET /products': 'search',
  'GET /products/search/autocomplete': 'search',
};

/**
 * The account a request NAMES, for the surfaces whose ladder is keyed on it.
 *
 * Login and the PGP challenge escalate per username rather than per caller,
 * because naming the target is the attack and the attacker cannot shed it by
 * changing circuits. The username therefore has to reach the challenge endpoint,
 * which is why that endpoint is a POST — see utils/pow.js.
 *
 * Note what this does NOT do: it does not check whether the account exists, and
 * the server escalates on attempts against a NAME whether or not one is behind
 * it. Escalating only for real accounts would turn the difficulty into an
 * account-existence oracle, which is the one thing `authController` is arranged
 * to never leak (CLAUDE.md, "auth answers must not enumerate").
 */
function powSubject(body) {
  const name = body && typeof body.username === 'string' ? body.username : '';
  return name.trim() ? name : undefined;
}

/**
 * Null when the door needs no work; the header value when it does; a throw
 * when it does and the work cannot be done. There used to be a `catch` here
 * that turned that last case into null, and the request then went out bare
 * — which the gate answered with a 428 reading "the app computes it; retry",
 * a message about the app, shown by the app, with the real reason (a CSP
 * that refused the worker; no SHA-256 outside a secure context) discarded
 * in the catch. utils/pow.js explains each; the error now carries it.
 */
async function powHeader(method, path, { strict = false, body } = {}) {
  const surface = method === 'POST' && path.split('?')[0] === '/orders/cart/quote' && (body?.coupon_code || body?.voucher_code)
    ? 'coupon_validate' : POW_SURFACES[`${method} ${path.split('?')[0]}`];
  if (!surface) return null;
  // The gate has already refused once, so whatever this file last cached about
  // the surface needing no work is wrong. Drop it before asking again.
  if (strict) forgetNoWork(surface);
  try {
    return await proofFor(surface, {
      strict,
      subject: powSubject(body),
      onWork: (bits) => toast.loading(`Proving this is a person, not a script (${bits}-bit puzzle)…`, { id: 'pow' }),
    });
  } finally {
    toast.dismiss('pow');
  }
}

async function request(method, path, body, opts = {}) {
  // `powRetried` is ours, not fetch's: set on the one resend a 428 earns
  // (below), and kept out of the options the request is made with.
  const { powRetried = false, ...fetchOpts } = opts;
  const token = localStorage.getItem('token');
  const headers = {};

  if (token) headers['Authorization'] = `Bearer ${token}`;
  const pow = await powHeader(method, path, { strict: powRetried, body });
  if (pow) headers['X-PoW'] = pow;

  let options = { method, headers, ...fetchOpts };

  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  } else if (body instanceof FormData) {
    options.body = body;
  }

  const res = await fetch(`${BASE}${path}`, options);
  if (method === 'GET') recordCatalogResponse(path, res);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));

    // 428 is the proof-of-work gate (middleware/proofOfWork.js) saying it did
    // not get a proof it could accept: none at all, one that expired while
    // the form sat open, one already spent, or one minted before the
    // operator raised the difficulty. Every one of its messages ends in
    // "retry", and this is that retry — one fresh proof, then the same
    // request once more, and once only. Strict, so that if the challenge
    // cannot be fetched now the message is that, not the gate's generic one.
    if (res.status === 428 && err.code === 'pow_required' && !powRetried) {
      return request(method, path, body, { ...fetchOpts, powRetried: true });
    }

    // Only an expired/invalid session (401) should log the user out. A 403 means
    // authenticated-but-not-allowed (a business rule, e.g. reviewing an
    // undelivered item) and must NOT clear the token or redirect.
    if (res.status === 401) {
      clearConversation();
      localStorage.removeItem('token');
      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }

    // Keep the whole parsed body on the error. Several endpoints already
    // return structured detail alongside `error` — the settings controller
    // sends `invalid: [{key, error}]` and `forbidden: [{key, permission}]` —
    // and callers could not reach any of it while only the message survived.
    const error = new Error(err.error || `HTTP ${res.status}`);
    error.status = res.status;
    error.data = err;
    // How long the server asked us to wait, when it said. The rate limiter
    // sends `Retry-After` on every 429 (server/middleware/rateLimiters.js), and
    // `AuthContext` waits exactly that long before asking who the session
    // belongs to again — asking sooner is only another 429 in the same window.
    // Null when absent or unreadable; see utils/sessionRetry.js.
    error.retryAfterMs = parseRetryAfter(res.headers.get('Retry-After'));
    throw error;
  }

  return res.json();
}

/**
 * The proof-of-work header for a path, for a caller that cannot use
 * `request()`.
 *
 * The assistant reads a streaming response body, which `request()` cannot
 * return — it parses JSON and hands back a value. So the buddy builds its own
 * fetch, and this is how it still gets past the gate. Exported rather than
 * duplicated for the reason POW_SURFACES is centralised at all: a surface that
 * knows how to mint its own proof is a surface that will mint it differently.
 */
export async function powHeaderFor(path, { strict = false, body } = {}) {
  return powHeader('POST', path, { strict, body });
}

/**
 * `fetch` for a gated path that cannot use `request()`, with the proof attached
 * and the 428 retried once.
 *
 * The retry is the part worth having in one place. `request()` has always had
 * it, and the hand-rolled fetches did not: they read a 428 as "not available
 * right now" and stopped. That was survivable while difficulty was one number
 * an operator set deliberately, because a client that had it switched on always
 * attached a proof. It stopped being survivable with the ladder, where the
 * FIRST request past a free run is refused by design — the client could not
 * have known, and the honest answer is to fetch a fresh challenge and send it
 * again, not to tell somebody the assistant is down.
 *
 * Returns the Response, so a streaming caller still owns its own body.
 */
export async function powFetch(path, init = {}, { body } = {}) {
  const send = async (strict) => {
    const pow = await powHeaderFor(path, { strict, body });
    const headers = { ...(init.headers || {}) };
    if (pow) headers['X-PoW'] = pow;
    return fetch(`${BASE}${path}`, { ...init, headers });
  };

  const first = await send(false);
  if (first.status !== 428) return first;

  // Peek at the body to be sure this is the gate and not some other 428. The
  // response is being discarded either way, so consuming it costs nothing.
  const err = await first.clone().json().catch(() => ({}));
  if (err.code !== 'pow_required') return first;
  return send(true);
}

export const api = {
  get: (path, opts) => request('GET', path, null, opts),
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  delete: (path, body, opts) => request('DELETE', path, body || null, opts),
  upload: async (path, formData, opts = {}) => {
    if (!opts.onProgress) return request('POST', path, formData);
    const token = localStorage.getItem('token');
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const pow = await powHeader('POST', path);
    if (pow) headers['X-PoW'] = pow;
    try {
      return await uploadWithProgress(`${BASE}${path}`, formData, { ...opts, headers });
    } catch (err) {
      if (err.status === 401) {
        clearConversation();
        localStorage.removeItem('token');
        if (window.location.pathname !== '/login') window.location.assign('/login');
      }
      throw err;
    }
  }
};
