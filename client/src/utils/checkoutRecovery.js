/**
 * What the checkout may remember between page loads, and how.
 *
 * ── The failure this closes ─────────────────────────────────────────────────
 *
 * The checkout minted an idempotency key per attempt and held it in a ref.
 * That stopped a double-tap placing two orders, and it stopped exactly there:
 * a connection that dropped between pressing Place Order and seeing the
 * receipt left the buyer on a page that knew nothing. Reloading minted a
 * fresh key, so pressing the button again placed a SECOND order, and the
 * cautious buyer who did not press it again had an unpaid order they did not
 * know existed. "Your order was created — continue payment" is the sentence
 * that replaces that uncertainty, and it needs the key to survive the reload.
 *
 * ── What is kept, and what deliberately is not ──────────────────────────────
 *
 * Three things, each with its own key and its own lifetime:
 *
 *   prefs    the payment rail and the address mode they chose last time,
 *            whether they seal in the browser, whether to spend store credit.
 *            Nothing here identifies anybody; a stranger reading it learns
 *            that somebody on this machine prefers Monero.
 *   attempt  the idempotency key of the last attempt, for a day. Not a
 *            secret — see Checkout.jsx's note on the key — and scoped to the
 *            account by the server's (user_id, key) index, so it can only
 *            ever find that account's own order.
 *   address  the shipping fields, ONLY when the buyer ticks the box, for one
 *            hour, encrypted. This is the one that holds identity, and it is
 *            the one `CLAUDE.md` is about: hold less, and hold it for less
 *            time. The default is not to keep it at all.
 *
 * ── How the address is kept ─────────────────────────────────────────────────
 *
 * AES-GCM under a key that WebCrypto generates as non-extractable and that
 * lives in IndexedDB as a CryptoKey object. The browser will use that key for
 * this origin's scripts and will never hand its bytes to anything — not to
 * this page, not to an extension, not to a script that reads storage. So the
 * ciphertext in localStorage is unreadable to anything that only gets to read
 * storage, which is most of what reads storage.
 *
 * It is worth being exact about what that does NOT protect against, because
 * the wrong claim would be worse than no feature. Same-origin script running
 * in this browser can call decrypt: an injected script on this site could,
 * for the hour, read the address back. Somebody with the browser profile on
 * disk has the key material too. What it protects against is the plaintext
 * address sitting in localStorage for any storage reader, and for longer
 * than an hour, which is the version everybody else ships. The checkbox says
 * as much in plain words.
 *
 * Every read and write is wrapped, because storage can be absent or throw —
 * a private window, a hardened browser, a thumbnail renderer — and a checkout
 * that fails because it could not remember a preference has its priorities
 * backwards.
 *
 * The key provider is injectable so the pure parts are testable in Node,
 * which has WebCrypto and no IndexedDB. `memoryKeys()` is the test double.
 */

const VERSION = 'v1';
const keyFor = (kind, userId) => `cs.checkout.${kind}.${VERSION}:${String(userId)}`;

export const ATTEMPT_TTL_MS = 24 * 60 * 60 * 1000;
export const ADDRESS_TTL_MS = 60 * 60 * 1000;
export const PREF_FIELDS = ['paymentMethod', 'addrMode', 'sealInBrowser', 'useStoreCredit'];
export const ADDRESS_FIELDS = ['name', 'company', 'street', 'city', 'state', 'zip', 'country'];

/** Matches `chk_orders_idempotency_key_shape` on the server. */
const ATTEMPT_KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

function storageOr(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
function readJson(storage, k) {
  try {
    const raw = storage?.getItem(k);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeJson(storage, k, value) {
  try { storage?.setItem(k, JSON.stringify(value)); return true; } catch { return false; }
}
function remove(storage, k) {
  try { storage?.removeItem(k); } catch { /* nothing to forget */ }
}

/* ── Preferences ───────────────────────────────────────────────────────────── */

/** The shape check, so a tampered or stale record cannot set state to junk. */
function cleanPrefs(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  if (typeof raw.paymentMethod === 'string' && /^[a-z_]{1,32}$/.test(raw.paymentMethod)) out.paymentMethod = raw.paymentMethod;
  if (raw.addrMode === 'form' || raw.addrMode === 'pgp') out.addrMode = raw.addrMode;
  if (typeof raw.sealInBrowser === 'boolean') out.sealInBrowser = raw.sealInBrowser;
  if (typeof raw.useStoreCredit === 'boolean') out.useStoreCredit = raw.useStoreCredit;
  return out;
}

export function loadPrefs(userId, storage) {
  const s = storageOr(storage);
  if (!s || userId == null) return {};
  return cleanPrefs(readJson(s, keyFor('prefs', userId)));
}

/** Merge, never replace: a caller saving one field keeps the others. */
export function savePrefs(userId, prefs, storage) {
  const s = storageOr(storage);
  if (!s || userId == null) return false;
  const next = cleanPrefs({ ...loadPrefs(userId, s), ...cleanPrefs(prefs) });
  return writeJson(s, keyFor('prefs', userId), next);
}

/* ── The attempt ───────────────────────────────────────────────────────────── */

export function loadAttempt(userId, { now = Date.now(), storage } = {}) {
  const s = storageOr(storage);
  if (!s || userId == null) return null;
  const k = keyFor('attempt', userId);
  const rec = readJson(s, k);
  if (!rec || typeof rec.key !== 'string' || !ATTEMPT_KEY_RE.test(rec.key) || !(Number(rec.at) > 0)) {
    if (rec) remove(s, k);
    return null;
  }
  // A day is generous: an unpaid order is cancelled by the stale sweep well
  // inside it, and a key older than that is a key for nothing.
  if (now - Number(rec.at) > ATTEMPT_TTL_MS) { remove(s, k); return null; }
  return { key: rec.key, at: Number(rec.at) };
}

export function saveAttempt(userId, attemptKey, { now = Date.now(), storage } = {}) {
  const s = storageOr(storage);
  if (!s || userId == null || !ATTEMPT_KEY_RE.test(String(attemptKey ?? ''))) return false;
  return writeJson(s, keyFor('attempt', userId), { key: String(attemptKey), at: now });
}

export function clearAttempt(userId, storage) {
  const s = storageOr(storage);
  if (!s || userId == null) return;
  remove(s, keyFor('attempt', userId));
}

/* ── The address, sealed ───────────────────────────────────────────────────── */

const subtle = () => {
  try { return globalThis.crypto?.subtle || null; } catch { return null; }
};
const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += String.fromCharCode(bytes[i]);
  return btoa(s);
};
const unb64 = (text) => Uint8Array.from(atob(String(text)), (c) => c.charCodeAt(0));
const pickAddress = (fields) => Object.fromEntries(
  ADDRESS_FIELDS.map((f) => [f, typeof fields?.[f] === 'string' ? fields[f].slice(0, 200) : '']),
);

/**
 * The key store: a non-extractable AES-GCM key kept in IndexedDB.
 *
 * `get(create)` returns the key, minting one when `create` is set and none
 * exists; `forget()` deletes it, which makes every stash sealed under it
 * unreadable at once — the shortest path to "and now nothing is kept".
 */
export function indexedDbKeys({ dbName = 'cs-checkout', storeName = 'keys', id = 'address-v1' } = {}) {
  const open = () => new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let req;
    try { req = indexedDB.open(dbName, 1); } catch (err) { reject(err); return; }
    req.onupgradeneeded = () => { req.result.createObjectStore(storeName); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve(null);
  });
  const tx = (db, mode, fn) => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return {
    async get(create) {
      const s = subtle();
      if (!s) return null;
      let db = null;
      try { db = await open(); } catch { return null; }
      if (!db) return null;
      try {
        const existing = await tx(db, 'readonly', (st) => st.get(id));
        if (existing) return existing;
        if (!create) return null;
        const key = await s.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
        await tx(db, 'readwrite', (st) => st.put(key, id));
        return key;
      } catch { return null; } finally { try { db.close(); } catch { /* closed */ } }
    },
    async forget() {
      let db = null;
      try { db = await open(); } catch { return; }
      if (!db) return;
      try { await tx(db, 'readwrite', (st) => st.delete(id)); } catch { /* nothing kept */ } finally { try { db.close(); } catch { /* closed */ } }
    },
  };
}

/** The test double: the same contract, held in a variable. */
export function memoryKeys() {
  let key = null;
  return {
    async get(create) {
      const s = subtle();
      if (!s) return null;
      if (!key && create) key = await s.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
      return key;
    },
    async forget() { key = null; },
  };
}

/**
 * Seal the address fields for an hour. Returns false — and keeps nothing —
 * whenever any part of the machinery is missing, which a checkout must
 * survive without comment.
 */
export async function stashAddress(userId, fields, { now = Date.now(), storage, keys } = {}) {
  const s = storageOr(storage);
  const sub = subtle();
  if (!s || !sub || userId == null) return false;
  const key = await (keys || indexedDbKeys()).get(true).catch(() => null);
  if (!key) return false;
  try {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(pickAddress(fields)));
    const cipher = await sub.encrypt({ name: 'AES-GCM', iv }, key, plain);
    return writeJson(s, keyFor('address', userId), {
      iv: b64(iv), data: b64(new Uint8Array(cipher)), at: now, exp: now + ADDRESS_TTL_MS,
    });
  } catch { return false; }
}

/**
 * The stashed fields, or null. Anything that cannot be opened — expired,
 * tampered, sealed under a key that is gone — is removed on the way out, so
 * a stash is never offered twice and never lingers past its hour.
 */
export async function unstashAddress(userId, { now = Date.now(), storage, keys } = {}) {
  const s = storageOr(storage);
  const sub = subtle();
  if (!s || userId == null) return null;
  const k = keyFor('address', userId);
  const rec = readJson(s, k);
  if (!rec) return null;
  if (!sub || !(Number(rec.exp) > now) || typeof rec.iv !== 'string' || typeof rec.data !== 'string') { remove(s, k); return null; }
  const key = await (keys || indexedDbKeys()).get(false).catch(() => null);
  if (!key) { remove(s, k); return null; }
  try {
    const plain = await sub.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, key, unb64(rec.data));
    const fields = JSON.parse(new TextDecoder().decode(plain));
    return { fields: pickAddress(fields), at: Number(rec.at) || null, exp: Number(rec.exp) };
  } catch { remove(s, k); return null; }
}

export function forgetAddress(userId, storage) {
  const s = storageOr(storage);
  if (!s || userId == null) return;
  remove(s, keyFor('address', userId));
}
