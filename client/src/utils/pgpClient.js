/**
 * PGP in the browser — loaded on opt-in, never before.
 *
 * `openpgp` is the largest dependency this client has ever taken, and it is
 * a dependency most buyers never use. So it arrives as its own chunk through
 * a dynamic `import()` fired the first time somebody chooses to seal an
 * address in the browser, and a buyer who never chooses it never downloads
 * it. On a Tor-fronted store that split is the difference between a feature
 * and a tax on everyone.
 *
 * ── Two directions, two audiences ───────────────────────────────────────────
 *
 * `encryptTo` is the BUYER's half: it produces the same multi-recipient block
 * the server's `encryptToKeys` produces — one session key wrapped for each
 * recipient — so the store opens it with its key and the buyer with theirs,
 * and `addressCrypto` recognises the store as a recipient at intake. Keys that
 * fail to parse are skipped and reported by omission from `fingerprints`,
 * exactly as the server does; the caller refuses only when the STORE key is
 * missing, because a block the store cannot read is an order the store cannot
 * ship.
 *
 * `decryptWith` is the STAFF half, and it is the more interesting one. The
 * point of doing it here is that a customer's delivery address is then never
 * produced on the server: the ciphertext stays in the database, the key comes
 * to the browser once (`storePgpController.releaseDecryptKey`), and the
 * plaintext exists only in the tab of the person who may read it. See that
 * controller for the trade the key release makes.
 *
 * The same lazy chunk serves both. A manager who never opens an encrypted
 * order never downloads it either.
 */

let mod = null;

async function load() {
  if (!mod) mod = await import('openpgp');
  return mod;
}

/** Warm the chunk without encrypting — called when the toggle turns on. */
export function preloadPgp() {
  load().catch(() => {});
}

/**
 * @param {string[]} armoredKeys   the store key first, then the buyer's own
 * @param {string}   text
 * @returns {Promise<{ armored: string, fingerprints: string[] }>}
 */
export async function encryptTo(armoredKeys, text) {
  const openpgp = await load();
  const keys = [];
  const fingerprints = [];
  for (const armoredKey of armoredKeys) {
    if (!armoredKey) continue;
    try {
      const key = await openpgp.readKey({ armoredKey });
      const expiry = await key.getExpirationTime();
      if (expiry instanceof Date && expiry.getTime() <= Date.now()) continue;
      keys.push(key);
      fingerprints.push(key.getFingerprint().toUpperCase());
    } catch {
      // unparseable — reported by omission
    }
  }
  if (keys.length === 0) throw new Error('No usable key to encrypt to');
  const armored = await openpgp.encrypt({
    message: await openpgp.createMessage({ text: String(text) }),
    encryptionKeys: keys,
    format: 'armored',
  });
  return { armored, fingerprints };
}

/**
 * Open one armored message with whichever of the store's private keys can.
 *
 * ── Why it tries every key rather than being told which ─────────────────────
 *
 * `storePgpController.decryptMessage` matches a block to a key by comparing
 * every key id the key answers to against the ids in the block, because
 * encryption is almost always to a SUBKEY and the fingerprint is not what the
 * block names. Reproducing that matching here would be a second implementation
 * of a rule that has already been got wrong once; trying each key in turn and
 * keeping the one that works reaches the same answer with no second opinion to
 * drift. The list is short — a store has one key, occasionally two after a
 * rotation — and the server sends it newest-first, so the common case succeeds
 * on the first attempt.
 *
 * ── Why a failure is not an error worth shouting about ──────────────────────
 *
 * Returns `null` rather than throwing when no key fits. A block the store was
 * never a recipient of is a real and expected state — it is the whole `manual`
 * case in `EncryptedAddress` — and the panel says so in a sentence rather than
 * a red toast. The caller distinguishes "could not" from "did not try".
 *
 * Keys are parsed once and cached for the life of the tab: `readPrivateKey` is
 * the expensive part, and re-parsing it per order on a list of forty would be
 * the whole reason somebody turns this feature off.
 */
const parsedKeys = new WeakMap();

export async function decryptWith(keyList, armoredMessage) {
  if (!Array.isArray(keyList) || !keyList.length) return null;
  if (typeof armoredMessage !== 'string' || !armoredMessage.trim()) return null;
  const openpgp = await load();

  let keys = parsedKeys.get(keyList);
  if (!keys) {
    keys = [];
    for (const entry of keyList) {
      if (!entry?.private_key) continue;
      try {
        keys.push(await openpgp.readPrivateKey({ armoredKey: entry.private_key }));
      } catch {
        // Unparseable — skipped, exactly as encryptTo skips a bad public key.
        // A store with one good key and one corrupt row still decrypts.
      }
    }
    parsedKeys.set(keyList, keys);
  }
  if (!keys.length) return null;

  const message = await openpgp.readMessage({ armoredMessage });
  for (const key of keys) {
    try {
      const { data } = await openpgp.decrypt({ message, decryptionKeys: key });
      return typeof data === 'string' ? data : String(data);
    } catch {
      // Wrong key for this block. Try the next one.
    }
  }
  return null;
}
