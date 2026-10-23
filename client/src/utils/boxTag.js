/**
 * The box tag, client side — one author, matching the server's.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 *
 * `server/utils/boxTags.js` opens by declaring itself the sole author of the
 * tag shape: *"One author for the shape, used by the web bench (prints it),
 * the ship desk (resolves it), and the bots (strip the suffix before resolving
 * the order)."* That was not true of the client. `PrintSheets.jsx` had its own
 * `boxTag` and its own `shortRef`, and `Manifest.jsx` spelled `shortRef` a
 * third time — three authors, all agreeing, none of them aware of the others.
 *
 * All three agreeing is exactly what makes it dangerous rather than harmless.
 * The client half is what **prints on the carton**; the server half is what
 * `parseTag` reads back **from the scanner**. Change one and the bench prints
 * tags the desk silently refuses to resolve — and the file somebody would open
 * to make that change is the one whose header says there is nothing to keep in
 * step.
 *
 * ── Why a copy and not an import ────────────────────────────────────────────
 *
 * The server module is CommonJS and lives outside the client's build root, and
 * this repository has no shared package — `client/src/utils/walkOrder.js`
 * carries a copy of a server rule for the same reason. What the repo does
 * instead is pin the copies together with a test that reads both:
 * `client/test/pageContext.test.mjs` checks its half against the server's
 * route list, and `client/test/adminSearch.test.mjs` checks its index in both
 * directions.
 *
 * `client/test/boxTag.test.mjs` does that here. It loads the server module and
 * asserts these functions agree with it on a table of cases, including that
 * the server's `parseTag` round-trips every tag this file produces — which is
 * the property that actually matters, because it is the scan.
 *
 * So: edit this file and the server one together, and the test will tell you
 * if you did not.
 */

/** `-<n>` at the end of a scanned or typed reference. Mirrors the server. */
export const BOX_TAG_SUFFIX_RE = /-(\d{1,3})$/;

/**
 * The short reference as every screen prints it: the first uuid segment,
 * uppercased.
 *
 * Takes the uuid alone, exactly as the server's does, so the two are
 * comparable function-for-function. `refOf` below is the display wrapper that
 * knows about the `#id` fallback, which is a CLIENT concern — the server never
 * renders a row that has no uuid.
 */
export function shortRef(uuid) {
  return String(uuid || '').split('-')[0].toUpperCase();
}

/** The tag for one box of one order: `<REF>-<n>`. */
export function boxTag(uuid, boxNumber) {
  return `${shortRef(uuid)}-${Number(boxNumber)}`;
}

/**
 * What a fulfilment screen prints for an order, including the fallback for a
 * row old enough to predate the uuid column.
 *
 * Kept separate from `shortRef` rather than folded into it: the fallback is a
 * display decision and the tag must never contain a `#`, because `parseTag`
 * strips exactly one leading `#` and would read `#412-2` as order `412`.
 */
export function refOf(uuid, id) {
  return uuid ? shortRef(uuid) : `#${id}`;
}

/**
 * Split a scanned or typed code into `{ ref, box }`.
 *
 * The client's half of the scan: `ScanBox` uses it to show what it is about to
 * look up before the answer comes back. The server re-parses the same code on
 * arrival and its answer is the authority — this is never a validation.
 */
export function parseTag(raw) {
  const code = String(raw == null ? '' : raw).trim().replace(/^#/, '').toUpperCase();
  if (!code) return { ref: '', box: null };
  const m = BOX_TAG_SUFFIX_RE.exec(code);
  if (!m) return { ref: code, box: null };
  return { ref: code.slice(0, m.index), box: parseInt(m[1], 10) };
}
