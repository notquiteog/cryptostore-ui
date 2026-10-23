/**
 * `/api/ai/status`, read once and shared by everything that needs it.
 *
 * ── Why this is not just `api.get('/ai/status')` at each call site ──────────
 *
 * Every surface that offers an AI tool has to know whether the operator has
 * that capability switched on, because a button for something the shop does
 * not offer is a button that returns 409 when pressed. That check is a page
 * load away from being made a dozen times: the navbar mounts `Buddy` twice
 * (the desktop action row and the mobile icon row are both in the DOM, hidden
 * from each other by a media query rather than by unmounting), and the admin
 * copy tools want the same answer on the product editor, the ticket composer
 * and the dashboard.
 *
 * Twelve identical reads of a settings-backed endpoint is not a correctness
 * bug, but it is twelve requests on a store that may be reached over Tor,
 * where each one is a circuit's worth of latency. So: one in-flight promise,
 * shared by every caller that asks while it is out, and the answer cached for
 * a short while afterwards.
 *
 * ── Why the cache expires rather than living forever ───────────────────────
 *
 * An operator switching a capability on in AI Settings and then walking to the
 * product editor must find the button there. A permanent cache would make that
 * a page reload, and "reload the page and it works" is how a feature earns a
 * reputation for being broken. `invalidateAiStatus()` covers the case where we
 * KNOW it changed (the settings page saved); the TTL covers the case where
 * another admin changed it in another tab, which nothing local can observe.
 */
import { api } from './api';

/**
 * How long an answer is trusted.
 *
 * Short enough that a capability switched on elsewhere appears within a
 * minute, long enough that clicking through five admin pages costs one
 * request. The value is not load-bearing — the SERVER gate is what actually
 * decides, and it is re-read per request. This only decides how quickly a
 * button appears and disappears.
 */
const TTL_MS = 60_000;

let cached = null;
let cachedAt = 0;
let inFlight = null;

/**
 * The status as last read, or null if it has never been read.
 *
 * For callers that must render synchronously and cannot wait — they get the
 * cached answer if there is one and no request otherwise.
 */
export function peekAiStatus() {
  return cached;
}

/** Forget the cached answer, so the next read goes to the server. */
export function invalidateAiStatus() {
  cached = null;
  cachedAt = 0;
  inFlight = null;
}

/**
 * The status, from cache or from the server.
 *
 * Never rejects. A store with no AI configured, a model host that is down and
 * a network that dropped all produce the same thing here — a status that says
 * nothing is offered — because every caller's response to all three is
 * identical: render no button. Making callers each write their own `.catch`
 * is how one of them ends up rendering a broken button on a failed fetch.
 */
export async function getAiStatus() {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = api.get('/ai/status')
    .then((data) => {
      cached = data;
      cachedAt = Date.now();
      return data;
    })
    .catch(() => {
      // Deliberately not cached: a failed read must not pin "no AI here" for
      // the next minute when the cause was one dropped request.
      const empty = { enabled: false, capabilities: [], buddy: { sprite: 'none' } };
      return empty;
    })
    .finally(() => { inFlight = null; });

  return inFlight;
}

/**
 * Is one capability offered by this shop right now?
 *
 * `offered` is the OPERATOR's switch, which is the only half of the gate a
 * client can usefully know. The other half — this person's consent, the daily
 * budget, whether the model answers — is decided server-side per request and
 * surfaces as an error, because those are all things that can become true or
 * false between rendering a button and pressing it.
 */
export function capabilityOffered(status, id) {
  if (!status?.enabled) return false;
  return Boolean(status.capabilities?.find((c) => c.id === id)?.offered);
}
