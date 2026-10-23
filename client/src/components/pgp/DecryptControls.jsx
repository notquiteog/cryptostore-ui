import { useId, useState } from 'react';
import toast from 'react-hot-toast';
import { KeyRound, Unlock } from 'lucide-react';

/**
 * The decrypt button and the passphrase step behind it — one implementation
 * for every place the store key is unlocked from a page.
 *
 * `decrypt(passphrase)` is the caller's: it posts to whichever endpoint owns
 * the block (an order's own address route, or the generic decrypt route for
 * a block found in a ticket) and resolves with the plaintext. What lives
 * here is the part that was about to be written a third time: press once
 * with no passphrase; if the server says the key wants one, open the field
 * rather than showing a red toast — "this key is passphrase-protected" is
 * the next step, not a failure — and send it once, never storing it.
 *
 * The passphrase field is single-use by construction: it is cleared on
 * success and on cancel, and it is never written anywhere but the one
 * request body.
 */
export default function DecryptControls({ decrypt, label = 'Decrypt', disabled = false }) {
  const [passphrase, setPassphrase] = useState('');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const run = async (withPassphrase) => {
    setBusy(true);
    try {
      await decrypt(withPassphrase || undefined);
      setAsking(false);
      setPassphrase('');
    } catch (err) {
      if (/passphrase/i.test(err?.message || '') && !withPassphrase) {
        setAsking(true);
      } else {
        toast.error(err?.message || 'Could not decrypt this block');
      }
    } finally {
      setBusy(false);
    }
  };

  if (asking) {
    return (
      <form
        className="oenc-pass"
        onSubmit={(e) => { e.preventDefault(); run(passphrase); }}
      >
        <label htmlFor={id} className="oenc-pass-label">
          <KeyRound size={12} aria-hidden="true" /> Store key passphrase
        </label>
        <div className="oenc-pass-row">
          <input
            id={id}
            type="password"
            className="glass-input"
            value={passphrase}
            autoComplete="off"
            placeholder="Used for this request only"
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <button type="submit" className="glass-btn glass-btn-primary glass-btn-sm" disabled={busy || !passphrase || disabled}>
            {busy ? <span className="spinner spinner-inline" /> : <Unlock size={13} aria-hidden="true" />}
            {label}
          </button>
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => { setAsking(false); setPassphrase(''); }}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
        <p className="oenc-pass-hint">
          Never stored. It unlocks the key in memory for this one decryption.
        </p>
      </form>
    );
  }

  return (
    <button
      type="button"
      className="glass-btn glass-btn-primary glass-btn-sm"
      onClick={() => run('')}
      disabled={busy || disabled}
    >
      {busy ? <span className="spinner spinner-inline" /> : <Unlock size={13} aria-hidden="true" />}
      {label}
    </button>
  );
}
