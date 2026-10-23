import { useEffect, useState } from 'react';
import { api } from '../utils/api';

/**
 * The store's private key, fetched once per tab, shared by every block on the
 * page that needs opening.
 *
 * ── Why the state is module-scoped and not in the component ─────────────────
 *
 * An order page can draw several encrypted blocks at once — the address, the
 * buyer's notes, whatever a support thread pasted — and the Ship desk draws one
 * per order on a queue. A hook that fetched per mount would issue that many
 * requests for one answer, and, worse, would write that many `store_pgp.key_released`
 * rows into the audit log for a single person opening a single page. The audit
 * trail has to read as what happened: one release, once, to this person's
 * browser.
 *
 * So the promise is the cache. Every caller in the tab awaits the same one, and
 * a second mount while the first is still in flight joins it rather than
 * starting another.
 *
 * ── Why it is not in a context provider ─────────────────────────────────────
 *
 * It would have to wrap the admin tree, and the whole design of this feature is
 * that the `openpgp` chunk and the key are pulled only by the small number of
 * people who open an encrypted order. A provider mounted at the root is a
 * promise that something at the root cares, and nothing there does.
 *
 * ── What the states mean ────────────────────────────────────────────────────
 *
 *   loading     the fetch is in flight; draw nothing rather than the button,
 *               so the panel does not flash a control it is about to replace
 *   keys        an array — browser decryption is on and these can open blocks
 *   reason      why it is not available, when it is not:
 *                 `server_side`          the operator turned it off
 *                 `passphrase_protected` the key wants a passphrase, which is
 *                                        never sent to a browser
 *                 `no_private_key`       the store holds only a public half
 *                 `denied`               this viewer may not decrypt at all
 *
 * The caller falls back to the server-side button for every one of those, so a
 * failure here costs nobody the ability to read an address — it costs them the
 * convenience of not pressing a button.
 */

let cached = null;

/** Drop the cache — called on sign-out so a key never outlives its session. */
export function forgetStoreDecryptKey() {
  cached = null;
}

function fetchOnce() {
  if (!cached) {
    cached = api.get('/store-pgp/decrypt-key')
      .then((res) => (res?.available && Array.isArray(res.keys) && res.keys.length
        ? { keys: res.keys, reason: null }
        : { keys: null, reason: res?.reason || 'no_private_key' }))
      .catch((err) => {
        // A 403 is the ordinary answer for a manager without the grant, and it
        // is not an error worth a console line on every order they open.
        cached = null;
        return { keys: null, reason: err?.status === 403 ? 'denied' : 'unavailable' };
      });
  }
  return cached;
}

/**
 * @param {boolean} enabled  false for a viewer who could not decrypt anyway —
 *   the buyer on their own order, or a staff member without the grant. Passing
 *   it in rather than checking permissions here keeps the one rule about who
 *   may read an address where the callers already state it, and means this hook
 *   never fires a request whose answer is a foregone 403.
 */
export default function useStoreDecryptKey(enabled = true) {
  const [state, setState] = useState(() => (enabled
    ? { loading: true, keys: null, reason: null }
    : { loading: false, keys: null, reason: 'disabled' }));

  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, keys: null, reason: 'disabled' });
      return undefined;
    }
    let alive = true;
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    fetchOnce().then((res) => {
      if (alive) setState({ loading: false, keys: res.keys, reason: res.reason });
    });
    return () => { alive = false; };
  }, [enabled]);

  return state;
}
