/**
 * The visitor's half of a tracking link.
 *
 * ── The job ─────────────────────────────────────────────────────────────────
 *
 * Somebody clicks `https://store/products?ref=alice`. They browse for ten
 * minutes, put two things in a basket, and only then hit the signup form —
 * three navigations after the query string that named who sent them. Something
 * has to remember. This is that something, and it is deliberately the smallest
 * thing that can do the job.
 *
 * ── Why localStorage and not a cookie ───────────────────────────────────────
 *
 * A cookie is sent to the server on every single request, which means the
 * store's access log — and any proxy in front of it — sees who referred each
 * visitor on every page view, forever. A value in localStorage is sent exactly
 * when this app decides to send it, which is twice: once to count the arrival
 * and once to resolve the tag on the signup page. The store learns strictly
 * less and the feature works identically. It is also why there is no consent
 * banner anywhere near this: nothing here is a third party, and nothing here
 * follows anybody off this origin.
 *
 * ── Why the query string is stripped ────────────────────────────────────────
 *
 * Once captured, `?ref=` is removed from the address bar with `replaceState`.
 * Three reasons, in order of how much they matter:
 *
 *   1. A visitor who copies the URL out of their address bar to send to a
 *      friend would otherwise be passing on somebody else's affiliate tag,
 *      silently attributing their friend's signup to a stranger.
 *   2. A screenshot of the page — which is how people share things — carries
 *      the tag otherwise.
 *   3. A refresh would count as a second arrival.
 *
 * Because stripping happens before React's router has necessarily rendered the
 * page that wants the value, the capture writes to a module-level variable as
 * well as to storage, and readers ask THIS module rather than reading
 * `location.search`. A reader that went to the URL would find it already gone.
 *
 * ── Everything here survives storage being unavailable ──────────────────────
 *
 * Private windows, hardened browsers and "block all cookies" all throw on
 * `localStorage` access rather than returning null, and this app is aimed
 * squarely at people who run browsers configured that way. Every access is
 * wrapped, the in-memory value carries the session on its own, and the
 * registration form keeps a manual invite box for the case where even that is
 * lost — a link cleaner that strips the query string before the page ever
 * loads leaves nothing for any of this to capture.
 */

/** The query parameter. Must match `REF_PARAM` in server/utils/refLinks.js. */
export const REF_PARAM = 'ref';

const STORAGE_KEY = 'cs_ref';

/**
 * How long a captured tag is honoured.
 *
 * Thirty days is the ordinary affiliate window and is long enough that
 * "clicked the link, came back at the weekend, signed up" is attributed. It is
 * also a limit rather than a convenience: a tag with no expiry is a fact about
 * where somebody came from that sits in their browser until they clear it, and
 * attributing a signup to a poster somebody glanced at last year is not
 * information, it is noise that happens to be retained.
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The tag for this page load, held outside storage.
 *
 * The authority for the current session: `capture()` strips the query string,
 * so by the time the signup page renders the URL no longer has it, and a
 * browser that refuses storage has nowhere else to have put it.
 */
let live = null;

/** Same shape as the server's tag rule, so a malformed value never travels. */
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { tag, at } = JSON.parse(raw);
    if (!tag || !TAG_RE.test(tag)) return null;
    if (!at || Date.now() - at > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return tag;
  } catch {
    // Unparseable, or storage refused. Either way there is no tag.
    return null;
  }
}

function writeStored(tag) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tag, at: Date.now() }));
  } catch {
    // Quota, private mode, or storage disabled. `live` still carries the tag
    // for this session, which covers the visitor who lands and signs up in one
    // sitting — the common case for somebody following a link.
  }
}

/**
 * Take the tag out of a query string, if there is one.
 *
 * Returns the captured tag, or null. The caller is responsible for stripping
 * the URL; that is not done here so this function stays testable without a
 * `history` object.
 *
 * A tag in the URL always wins over a stored one: the visitor has just
 * followed a link, and the person whose link they just followed is who sent
 * them, whatever a month-old value says.
 */
export function captureFromSearch(search) {
  let tag = null;
  try {
    tag = new URLSearchParams(search || '').get(REF_PARAM);
  } catch {
    return null;
  }
  if (!tag) return null;
  tag = tag.trim();
  if (!TAG_RE.test(tag)) return null;

  live = tag;
  writeStored(tag);
  return tag;
}

/**
 * The tag this visitor arrived with — this page load, or within the window.
 *
 * Three sources, in this order: memory, storage, and the URL as it stands
 * right now.
 *
 * ── Why the third one is not redundant ──────────────────────────────────────
 *
 * `RefCapture` is mounted below `<Routes>` in App.jsx, and React runs effects
 * child-before-parent and siblings in order — so on a direct landing at
 * `/register?ref=alice`, the registration page's own effect runs BEFORE
 * RefCapture has captured anything. Without this fallback it would find
 * nothing, draw the plain invite box, and quietly fail to attribute a signup
 * that arrived on a perfectly good link.
 *
 * It passed testing anyway, which is the part worth recording. `main.jsx`
 * wraps the app in `React.StrictMode`, which double-invokes effects in
 * development: the first pass found no tag, RefCapture then stored one, and
 * the second pass found it. The dev server showed the vouched card every
 * time. StrictMode does not double-invoke in a production build, so the
 * deployed bundle would have run the first pass only — the failure would have
 * appeared only after deploy, only for visitors landing straight on the signup
 * page, and would have looked like the referral programme silently not
 * working.
 *
 * Reading the URL here rather than reordering the components is deliberate:
 * ordering is a property two files have to agree about, and one of them is a
 * router. This makes the question "is there a tag" answerable from anywhere,
 * at any point in the lifecycle, which is a property one file can keep on its
 * own.
 */
export function getRefTag() {
  if (live) return live;

  const stored = readStored();
  if (stored) {
    live = stored;
    return live;
  }

  // The URL, if RefCapture has not got to it yet. Captured rather than merely
  // read, so the value survives the navigation to another page — and so this
  // stays the only place that decides what a valid tag looks like.
  if (typeof window !== 'undefined') {
    const fromUrl = captureFromSearch(window.location.search);
    if (fromUrl) return fromUrl;
  }

  return null;
}

/**
 * Forget the tag.
 *
 * Called once the account has been created and the attribution is recorded
 * server-side on `users.invited_by_link_id`, where it belongs. Leaving it in
 * the browser afterwards would attribute the NEXT person to sign up on this
 * machine to the same referrer — a shared computer, a family tablet, a library
 * — which is both wrong and the sort of wrong that pays somebody money.
 */
export function clearRefTag() {
  live = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* nothing to clear */ }
}

/**
 * Has this session already been counted for this stage?
 *
 * `sessionStorage`, not `localStorage`: a returning visitor on a new day is a
 * new arrival and should count, while a refresh, a back button and a
 * client-side navigation within one sitting are the same arrival and should
 * not. The server rate-limits this endpoint as well — a guard that lives in
 * the caller's own browser is a courtesy, never the enforcement.
 */
export function markCounted(stage) {
  const key = `cs_ref_${stage}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
    return true;
  } catch {
    // Storage refused. Count it: an uncounted real arrival is a worse error
    // than a double count, and the rate limiter bounds the damage either way.
    return true;
  }
}
