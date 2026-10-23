/**
 * When the media-slot editor may poll for encoding progress, and how soon it
 * may ask again.
 *
 * ── The storm this exists to prevent ────────────────────────────────────────
 *
 * `MediaSlots` polls `/products/media/{scope}/{ownerId}/jobs` so an upload
 * that is still encoding can show its progress. The first version rescheduled
 * that poll after EVERY outcome, at a fixed 2.5 s, including a 403. A manager
 * holding `products.edit` but not `products.media` therefore opened a product
 * with 268 variants and their browser sent one refused request per variant
 * every 2.5 s, for as long as the page was open — about twenty thousand in a
 * few minutes. That volume tripped the store's per-device global rate limiter
 * (`limit:global`, see server/config/limits.js), so every other page on that
 * device started answering "Too many requests", including the button they
 * had actually come to press.
 *
 * Two rules close it, and both are here rather than in the component so they
 * can be tested without a DOM:
 *
 *  1. A viewer who cannot manage media never starts the poll. The grant that
 *     lets a person upload is the grant that lets them read progress
 *     (`products.media` gates the jobs route too), so asking is pointless and
 *     the slot renders read-only instead.
 *  2. A poll that IS running stops on 401 and 403 — the answer will not change
 *     by asking again — and backs off exponentially on any other failure, so
 *     a media worker that is briefly down is asked every 2.5, 5, 10, 20, 40
 *     seconds and then once a minute, not 24 times a minute per variant.
 */

/** The grant that gates both uploading and reading encoding progress. */
export const MEDIA_JOBS_PERMISSION = 'products.media';

/** Between polls while something is queued or running. */
export const POLL_ACTIVE_MS = 2500;
/** Between polls while nothing is in flight — a cheap "still nothing". */
export const POLL_IDLE_MS = 10000;
/** The back-off ceiling after repeated failures. */
export const POLL_BACKOFF_CAP_MS = 60000;

/** Answers the server gives that will not change by asking again. */
const STOP_ON = new Set([401, 403]);

/**
 * Should this slot poll at all?
 *
 * @param {{ ownerId?: number|string|null, disabled?: boolean, canManage?: boolean }} view
 */
export function shouldPollMediaJobs({ ownerId, disabled = false, canManage = false } = {}) {
  if (!ownerId) return false;
  if (disabled) return false;
  return canManage === true;
}

/**
 * How long to wait before the next poll, or `null` to stop polling.
 *
 * @param {{ ok: boolean, status?: number|null, previousDelay?: number, hasActiveJobs?: boolean }} outcome
 *   `ok` — the request succeeded. `status` — the HTTP status on failure, when
 *   the transport reported one (a network drop reports none). `previousDelay`
 *   — what the last wait was, so a failure can double it. `hasActiveJobs` —
 *   whether the successful answer listed anything queued or running.
 * @returns {number|null} milliseconds, or null when polling must end.
 */
export function nextPollDelay({ ok, status = null, previousDelay = POLL_ACTIVE_MS, hasActiveJobs = false } = {}) {
  if (ok) return hasActiveJobs ? POLL_ACTIVE_MS : POLL_IDLE_MS;
  if (status != null && STOP_ON.has(Number(status))) return null;
  // Double the last wait, from the active interval upwards, and never above
  // the cap. `previousDelay` may be the idle interval or a value from an
  // earlier back-off; both are valid starting points.
  const base = Math.max(POLL_ACTIVE_MS, Number(previousDelay) || POLL_ACTIVE_MS);
  return Math.min(base * 2, POLL_BACKOFF_CAP_MS);
}

/** The key one owner's entry sits under in a product feed. */
export function feedKey(scope, ownerId) {
  return `${scope}:${ownerId}`;
}

/**
 * Does any owner in a product feed have a job still queued or running? This
 * is what decides the page-level cadence: active while anything encodes,
 * idle otherwise — the same rule a lone slot applies to its own list.
 */
export function feedHasActiveJobs(owners) {
  if (!owners || typeof owners !== 'object') return false;
  return Object.values(owners).some((o) => (o?.jobs || []).some((j) => j && ['queued', 'running'].includes(j.state)));
}

/**
 * Are two media lists the same list? Compared by id, order and the fields a
 * slot draws, so a feed that says nothing new does not hand the editor a new
 * array — which, multiplied by every slot on every poll, was a full re-render
 * of a 268-variant page every ten seconds for no change at all.
 */
export function sameMediaList(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] || {}, y = b[i] || {};
    if (x.id !== y.id || x.sort_order !== y.sort_order || x.url !== y.url || x.media_type !== y.media_type
      || x.poster_url !== y.poster_url || x.image_url !== y.image_url) return false;
  }
  return true;
}
