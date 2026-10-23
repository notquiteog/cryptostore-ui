/**
 * A stable identifier for a palette corpus, computed the same way here and in
 * `server/services/ai/paletteSearch.js`.
 *
 * ── Why not SHA-256 ─────────────────────────────────────────────────────────
 *
 * The obvious choice is `crypto.subtle.digest`, and it is the wrong one here:
 * `crypto.subtle` exists only in a SECURE CONTEXT. An operator running this
 * store over plain http on a LAN — which CLAUDE.md's whole range of
 * deployments explicitly includes — has no `window.crypto.subtle` at all, so
 * the palette's meaning search would silently be unavailable on exactly the
 * installs least able to work out why. (`.onion` over http is fine, because
 * browsers treat onion origins as potentially trustworthy; plain http on a
 * private address is not.)
 *
 * Nothing here needs a cryptographic hash. This value is a CACHE KEY for
 * content that is shipped source, not a signature over anything: it answers
 * "is the corpus the server indexed the corpus I am asking about". The
 * consequence of a collision is a search scored against a stale index, and the
 * caller already drops any id that does not resolve to an entry it knows — so
 * a stale index costs recall and can never produce a wrong destination.
 *
 * ── Why it is written out rather than pulled in ─────────────────────────────
 *
 * Two FNV-1a passes over the same text with different offsets, concatenated to
 * sixteen hex characters. `Math.imul` keeps every multiply in int32 in both
 * runtimes, which is the whole reason this agrees across V8 in a browser and
 * V8 in Node — a plain `*` would go through float64 and diverge above 2^53.
 * A dependency for this would be a dependency to check on every audit.
 */

const OFFSET_A = 0x811c9dc5;
const OFFSET_B = 0x01000193;

function fnv1a(text, seed) {
  let h = seed | 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // >>> 0 once at the end: the intermediate value is deliberately signed so
  // the arithmetic matches Node's exactly, and only the printed form is
  // unsigned.
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * @param {{id: string, text: string}[]} entries in the order they are sent
 * @returns {string} sixteen hex characters
 */
export function paletteFingerprint(entries) {
  // Unit separator between the id and the text, record separator between
  // entries — control characters, so neither can occur inside either field.
  // A space would make the recipe AMBIGUOUS: {id:'a', text:'b c'} and
  // {id:'a b', text:'c'} both join to "a b c", so two genuinely different
  // corpora would share a fingerprint and one of them would be served the
  // other's vectors. Caught by server/test/paletteSearch.test.js, which is
  // why that test exists.
  let joined = '';
  for (const e of entries) joined += `${e.id}\u001f${e.text}\u001e`;
  return fnv1a(joined, OFFSET_A) + fnv1a(joined, OFFSET_B);
}

export default paletteFingerprint;
