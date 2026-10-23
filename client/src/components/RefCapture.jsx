import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { captureFromSearch, getRefTag, markCounted, REF_PARAM } from '../utils/refTag';

/**
 * The one thing in the app that watches for `?ref=`.
 *
 * Renders nothing. Mounted once, above the router's outlet, so a tracking link
 * works no matter which page it points at — the whole reason a store campaign
 * can send people to a product rather than to a signup form.
 *
 * ── Three acts, in this order ───────────────────────────────────────────────
 *
 *   1. Capture. The tag comes out of the query string into `utils/refTag`,
 *      which holds it in memory and (where the browser allows) in
 *      localStorage for thirty days.
 *   2. Strip. `replaceState` takes `?ref=` back out of the address bar, so the
 *      visitor cannot pass somebody else's affiliate tag on by copying the URL
 *      or screenshotting the page. `replaceState`, not `pushState`: the back
 *      button must not walk them back onto the tagged URL and count them
 *      again.
 *   3. Count. One `POST /marketing/hit`, fire-and-forget.
 *
 * Order matters. Stripping before counting means the count is sent from the
 * captured value rather than re-read from a URL that is about to change, and a
 * failed count never leaves the tag in the address bar.
 *
 * ── Why it goes through `fetch` and not `api` ───────────────────────────────
 *
 * `utils/api` attaches the session token, parses errors into toasts and can
 * log the user out on a 401. None of that belongs on a counter: this request
 * is anonymous by design, its failure is not the visitor's problem, and a
 * marketing beacon must never be able to end somebody's session. `keepalive`
 * so it still goes out if the visitor clicks through before it lands.
 *
 * ── What is deliberately not here ───────────────────────────────────────────
 *
 * No third party, no beacon to anywhere but this store's own API, no page-view
 * tracking of any kind. This fires for a visitor arriving on a tagged link and
 * for nobody else, and the server keeps a per-day integer with no identity
 * beside it. A store on a filtered network loads exactly as fast as one that
 * is not, because there is nothing external to be blocked.
 */
export default function RefCapture() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    if (!search || !search.includes(`${REF_PARAM}=`)) return;

    const tag = captureFromSearch(search);
    if (!tag) return;

    // Take it back out of the address bar, keeping everything else in the
    // query string — a campaign may legitimately point at `/products?category=x`.
    try {
      const params = new URLSearchParams(search);
      params.delete(REF_PARAM);
      const rest = params.toString();
      window.history.replaceState(null, '', `${pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    } catch {
      // No history API, or a browser refusing it. The tag is captured either
      // way; the URL just keeps its query string, which is cosmetic.
    }

    if (!markCounted('hit')) return;
    fetch('/api/marketing/hit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [REF_PARAM]: tag, stage: 'hit' }),
      keepalive: true,
    }).catch(() => { /* a counter is not worth a console error on a shop page */ });
  }, [pathname, search]);

  return null;
}

/**
 * Count that somebody carrying a tag reached the signup form.
 *
 * The step between "arrived" and "signed up", and the one that tells an
 * operator whether a campaign has a landing-page problem or a signup-form
 * problem. Called by the registration page rather than fired from here,
 * because it is about that page specifically and because it must fire for a
 * visitor who arrived days ago and is only now signing up — by which point
 * `RefCapture` has long since run and seen no query string.
 */
export function countSignupView() {
  const tag = getRefTag();
  if (!tag) return;
  if (!markCounted('signup_view')) return;
  fetch('/api/marketing/hit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ [REF_PARAM]: tag, stage: 'signup_view' }),
    keepalive: true,
  }).catch(() => {});
}
