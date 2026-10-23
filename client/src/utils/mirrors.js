/**
 * Which address a visitor is on, and whether the store says it is one of its
 * own.
 *
 * The logic behind the footer's mirror strip and the sign-in page's address
 * check, in one place: two copies of "is this host in the signed list" would
 * be the phishing check disagreeing with itself, and the sign-in page is
 * exactly where a disagreement costs a password.
 *
 * Everything here is pure and runs in the browser. The address a visitor
 * types into the check box is compared against a list the page already
 * holds; it is never sent anywhere, so the store never learns which link
 * someone was handed in a chat. Node-testable for the same reason
 * (client/test/mirrorCheck.test.mjs) — the trick cases below are the ones a
 * phishing kit relies on, and each one is pinned.
 */

/** Addresses that are somebody's own machine or LAN, never a published mirror. */
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?$/i;
const LOCAL_TAIL_RE = /\.(local|localhost|lan|home|internal)(:\d+)?$/i;
const PRIVATE_RANGE_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

export function isLocalAddress(host) {
  const h = String(host || '').toLowerCase();
  return LOCAL_HOST_RE.test(h) || LOCAL_TAIL_RE.test(h) || PRIVATE_RANGE_RE.test(h);
}

/**
 * Reduce whatever somebody pasted — a full URL, a bare host, a host with a
 * path — to the host the browser would actually connect to.
 *
 * The order of the strips is the point. `https://shop.example@evil.test/` is
 * a URL whose host is `evil.test`: the part before the `@` is userinfo the
 * browser discards, and it is put there so a glance reads the real name.
 * Userinfo goes before the path strip, because a `/` in the userinfo is
 * impossible but a `/` right after it is where the path begins. Default
 * ports are dropped because `window.location.host` drops them, and a list
 * entry never carries one.
 */
export function normaliseAddress(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  s = s.replace(/^[^/?#@]*@/, '');
  s = s.replace(/[/?#].*$/, '');
  s = s.replace(/\.+$/, '');
  s = s.replace(/:(443|80)$/, '');
  return s;
}

/** The registrable-looking part of a host: the labels before the TLD, no port. */
function stem(host) {
  const bare = String(host || '').replace(/:\d+$/, '');
  const labels = bare.split('.');
  if (labels.length <= 1) return bare;
  return labels.slice(0, -1).join('.');
}

/** Edit distance, for "one letter off" clones. Small inputs only. */
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The listed mirror an unlisted host is dressed up as, if any.
 *
 * Three shapes of clone, all seen in the wild: a listed host with something
 * bolted on (`shop.example.evil.test`, `login-shop.example`), a listed host
 * with a letter changed or dropped (`shopp.example`, `sh0p.example`), and the
 * listed host's name under a different TLD (`shop.exampIe`, `shop-example.net`).
 * None of these is proof of anything — the verdict is still just "not
 * listed" — but naming the resemblance is what turns "unknown address" into
 * "this is pretending to be the real one".
 */
export function lookalikeOf(host, mirrors) {
  const h = String(host || '').toLowerCase();
  if (!h) return null;
  const hStem = stem(h).replace(/[^a-z0-9]/g, '');
  for (const m of mirrors || []) {
    const mh = String(m?.host || '').toLowerCase();
    if (!mh || mh === h) continue;
    if (h.endsWith(`.${mh}`) || h.includes(mh)) return m;
    if (mh.endsWith(`.${h}`)) return m;
    const mStem = stem(mh).replace(/[^a-z0-9]/g, '');
    if (mStem.length >= 4 && (hStem.includes(mStem) || mStem.includes(hStem))) return m;
    if (mh.length >= 8 && editDistance(h.replace(/:\d+$/, ''), mh) <= 2) return m;
  }
  return null;
}

/**
 * The verdict for one address against the store's list.
 *
 *   listed    it is in the list — `mirror` says which entry.
 *   local     a development or LAN address; never in a published list, and
 *             saying "not a listed mirror" about localhost is true and useless.
 *   unlisted  the list exists and this is not on it. `lookalike` names the
 *             listed host it resembles, when one does.
 *   unknown   the store has published no list, so nothing can be said.
 *   empty     nothing to check.
 */
export function classifyAddress(raw, mirrors) {
  const host = normaliseAddress(raw);
  const list = Array.isArray(mirrors) ? mirrors : [];
  if (!host) return { host, status: 'empty', mirror: null, lookalike: null };
  const mirror = list.find((m) => String(m?.host || '').toLowerCase() === host) || null;
  if (mirror) return { host, status: 'listed', mirror, lookalike: null };
  if (isLocalAddress(host)) return { host, status: 'local', mirror: null, lookalike: null };
  if (list.length === 0) return { host, status: 'unknown', mirror: null, lookalike: null };
  return { host, status: 'unlisted', mirror: null, lookalike: lookalikeOf(host, list) };
}

/** Where a listed mirror is reached. Onion and i2p are plain http inside their own encryption. */
export function mirrorHref(mirror) {
  const scheme = mirror?.kind === 'onion' || mirror?.kind === 'i2p' ? 'http' : 'https';
  return `${scheme}://${mirror?.host || ''}/`;
}

export const KIND_LABEL = { onion: 'Tor', i2p: 'I2P', clearnet: 'Web' };

/** A fingerprint in the fours it is read aloud in. */
export function fingerprintGroups(fingerprint) {
  return String(fingerprint || '').toUpperCase().match(/.{1,4}/g) || [];
}
