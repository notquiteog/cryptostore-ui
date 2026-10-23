/**
 * Proof of work, solved off the interface thread.
 *
 * The server hands out `{ bits, nonce }` for a surface — the list lives in
 * `config/limits.js` POW_SURFACES and nowhere else; this finds a counter such
 * that SHA-256(nonce + ':' + counter)
 * has `bits` leading zero bits, and returns the `nonce:counter` string the
 * request carries in `X-PoW`. `bits: 0` means the store has it switched off
 * and this returns null without spawning anything.
 *
 * ── Why a file, not a Blob ──────────────────────────────────────────────────
 *
 * The worker used to be built from a Blob so it shipped inside the bundle
 * with no extra request, on the belief that `script-src 'self'` covered a
 * blob: URL made by same-origin script. It does not: `'self'` is the
 * origin, and blob: is its own scheme. `worker-src` falls back to
 * `script-src`, so under the production policy (server/index.js) the
 * constructor threw a SecurityError, the throw was swallowed, and the login
 * went out with no proof — answered by the gate's 428, "the app computes
 * it; retry", which is the message the operator saw. Vite serves this file
 * as a same-origin module in dev and emits it as a same-origin chunk in the
 * build, which `'self'` does cover. Same class of bug as the manifest (see
 * the manifestSrc comment in server/index.js); the fix here is to stop
 * needing blob: rather than to allow it.
 *
 * ── Why the hash is our own ────────────────────────────────────────────────
 *
 * powHash.js, not `crypto.subtle` — see its header. Short version: subtle
 * does not exist outside a secure context, and a store on plain HTTP is
 * not one.
 *
 * ── The fallback ───────────────────────────────────────────────────────────
 *
 * If the worker cannot be started at all, the same search runs on the main
 * thread in short slices with a yield between them, so the page keeps
 * painting. Slower, and it competes with the interface — but a login that
 * takes longer beats one that cannot happen. Both paths run the very same
 * `searchCounter`, so a proof from either verifies the same way.
 *
 * ── Failing loudly ─────────────────────────────────────────────────────────
 *
 * When work is needed and cannot be done, this throws with the reason.
 * Returning null there was the original sin: the request went out bare, the
 * gate refused it, and the person saw a message about the app from the app
 * with the actual cause already discarded.
 *
 * Every error raised here carries `err.pow = true`, and that flag has one job:
 * to stop a caller reporting a proof-of-work failure as a failure of the thing
 * behind the gate. The buddy is the case that matters — it is a status light
 * for whether the model is reachable, and an unsolvable puzzle would have set
 * it to "asleep", which is the one thing its own design says it must never lie
 * about. Distinguishing them needs a mark on the error, because by the time it
 * reaches a `catch` there is nothing else left to tell them apart.
 */
import { searchCounter } from './powHash.js';

/**
 * Say out loud that this browser has started grinding, and when it stops.
 *
 * A proof of work is the one delay in the store that nothing on the page
 * explains. The request has not been sent yet, so no spinner is spinning; the
 * thing the person clicked simply takes a second longer than it did an hour
 * ago, because the ladder moved. The companion can say so — `work` in
 * sprites.js is a real state bound to a real event — and this is how it hears
 * about it.
 *
 * A window event rather than a callback threaded through `powHeader`,
 * `powFetch` and `request`, for two reasons. The plumbing would touch four
 * files to serve one listener; and the honest scope is wider than the
 * assistant — a proof taken out for a catalogue search or a coupon check is
 * the same delay and deserves the same explanation.
 *
 * Counted, not a flag: autocomplete and a page load can be grinding at once,
 * and the first one to finish would otherwise call the whole thing off.
 */
let solving = 0;

function announce(active) {
  try {
    window.dispatchEvent(new CustomEvent('cs:pow', { detail: { active } }));
  } catch { /* no window: a test, or a worker. Nothing is listening either. */ }
}

/** An Error this file raised, marked so a caller can tell it from its own. */
function powError(message) {
  const err = new Error(message);
  err.pow = true;
  return err;
}

/** Main-thread slice: about a millisecond or two of hashing between yields. */
const SLICE = 2048;

/**
 * ── Not asking, when the answer was just "nothing" ──────────────────────────
 *
 * Every gated request used to fetch a challenge first, which was fine while the
 * gated surfaces were three POSTs a person makes a handful of times. It stopped
 * being fine when the ladder made it worth gating *browsing*: a challenge
 * request before every catalogue page and every autocomplete keystroke would
 * double the store's request count to be told "no work needed" over and over.
 *
 * So a surface that answers 0 is taken at its word for a minute. The window is
 * short because the ladder can move underneath it — the caller's own volume is
 * what raises it — and being wrong costs exactly one 428 and one retry, which
 * `utils/api.js` already handles. `forgetNoWork` drops the entry the moment the
 * gate says otherwise, so the wrong answer is never used twice.
 *
 * Per tab, in memory, and never persisted: this is a latency cache, and writing
 * "this store asked me for proof of work" to disk would be writing down which
 * store the browser visited.
 */
const noWorkUntil = new Map();
const NO_WORK_TTL_MS = 60_000;

/** Drop the "no work needed" note for a surface — the gate has said otherwise. */
export function forgetNoWork(surface) {
  noWorkUntil.delete(surface);
}

/**
 * The bearer token, when there is one.
 *
 * The challenge endpoint runs `optionalAuth` and this is why. The ladder for
 * checkout and the assistant is keyed on the ACCOUNT, and those gates run after
 * `authenticate`. A challenge fetched without the token would be bound to the
 * device instead, the gate would recompute the account key, and the MAC would
 * refuse every proof this file ever produced — a 428 loop no retry escapes.
 */
function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const token = localStorage.getItem('token');
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch { /* storage disabled: the device ladder is the honest fallback */ }
  return headers;
}

function solveInWorker(nonce, bits, onProgress) {
  const worker = new Worker(new URL('./powWorker.js', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      if (e.data.progress != null) { onProgress?.(e.data.progress); return; }
      resolve(e.data.counter);
    };
    worker.onerror = (err) => reject(new Error(err.message || 'the worker failed'));
    worker.postMessage({ nonce, bits });
  }).finally(() => worker.terminate());
}

async function solveInSlices(nonce, bits, onProgress) {
  for (let from = 0; ; from += SLICE) {
    const hit = searchCounter(nonce, bits, from, from + SLICE);
    if (hit != null) return hit;
    onProgress?.(from + SLICE);
    await new Promise((r) => setTimeout(r, 0));
  }
}

export async function solveChallenge({ nonce, bits }, { onProgress } = {}) {
  if (!bits || bits <= 0) return null;
  let counter;
  try {
    counter = await solveInWorker(nonce, bits, onProgress);
  } catch (workerErr) {
    try {
      counter = await solveInSlices(nonce, bits, onProgress);
    } catch (err) {
      throw powError(`Couldn't compute the proof of work this store asks for (${err.message}; worker: ${workerErr.message}).`);
    }
  }
  return `${nonce}:${counter}`;
}

/**
 * Fetch the surface's challenge and solve it. Returns the header value, or
 * null when the surface needs no work. `onWork(bits)` fires when work is
 * actually about to happen, so a page can say so.
 *
 * `strict` is about the challenge failing to arrive. Not strict, that is not
 * an error here: the request goes out bare and the gate decides — the
 * difficulty may well be zero. Strict is the resend after a 428 (utils/api.js),
 * where the gate has already said it wants a proof, and a challenge that
 * still cannot be fetched is the thing to report.
 */
export async function proofFor(surface, { onWork, strict = false, subject } = {}) {
  if (!strict && (noWorkUntil.get(surface) ?? 0) > Date.now()) return null;

  let res;
  try {
    res = await fetch('/api/auth/pow', {
      method: 'POST',
      credentials: 'same-origin',
      headers: authHeaders(),
      // POST, not a query string. The ladder for login and the PGP challenge is
      // keyed on the account the request NAMES, so `subject` carries a username
      // — and a username in a query string is a username in the reverse proxy's
      // access log, the browser's history and any referrer that leaks.
      body: JSON.stringify(subject ? { surface, subject } : { surface }),
    });
  } catch {
    if (strict) throw powError("Couldn't reach the store for its proof-of-work challenge. Check the connection and retry.");
    return null;
  }
  if (!res.ok) {
    // The challenge endpoint has a ladder of its own (`pow_challenge`) and
    // refuses rather than handing out a puzzle to obtain a puzzle. Say that,
    // rather than "HTTP 429", because it is the one refusal here that waiting
    // actually fixes.
    if (res.status === 429) {
      forgetNoWork(surface);
      throw powError('The store is issuing challenges faster than it will allow. Wait a moment and try again.');
    }
    if (strict) throw powError(`The store could not issue a proof-of-work challenge (HTTP ${res.status}). Retry in a moment.`);
    return null;
  }
  const ch = await res.json();
  if (!ch.bits) {
    noWorkUntil.set(surface, Date.now() + NO_WORK_TTL_MS);
    return null;
  }
  noWorkUntil.delete(surface);
  onWork?.(ch.bits);
  solving += 1;
  if (solving === 1) announce(true);
  try {
    return await solveChallenge(ch);
  } finally {
    solving -= 1;
    // `finally`, so a puzzle that throws still puts the page back. A companion
    // left grinding forever because one solve failed would be a status light
    // that lies in the direction that costs the most trust.
    if (solving === 0) announce(false);
  }
}
