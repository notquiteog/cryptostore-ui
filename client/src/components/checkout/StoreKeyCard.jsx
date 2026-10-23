import { useEffect, useState } from 'react';
import { Copy, Check, FileText, KeyRound, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';

/** Armored fingerprints are 40 hex characters; grouped in fours to be read aloud. */
const spaced = (fp) => String(fp || '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();

/**
 * The store's public key, on the screen where it is needed.
 *
 * The checkout's own copy told the buyer to encrypt to "the store's public key"
 * and said it was "published on the store's PGP page". There is no such page.
 * The key is served by the API at `/api/store-pgp/public` and linked from the
 * footer if the operator happened to add that link — so the instruction pointed
 * at nothing, and following it meant leaving a half-filled checkout form to go
 * looking. DESIGN §9: if a screen names the thing you need next, it links to it;
 * this one carries it.
 *
 * The failure underneath is worse than the inconvenience. A block encrypted to
 * the wrong key, or pasted by someone whose store has no key at all, is stored
 * verbatim and CANNOT be read by anyone — including staff, who then cannot ship
 * it. So the panel answers the only two questions that decide whether pasting a
 * block is safe: is there a key, and is it still usable.
 */
export default function StoreKeyCard() {
  // `undefined` is "not asked yet" and `null` is "asked and it failed" — two
  // states that must not both render as "no key", because one of them is a
  // network blip and the other is a store that genuinely cannot receive an
  // encrypted address.
  const [key, setKey] = useState(undefined);
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get('/store-pgp/public')
      .then((d) => { if (alive) setKey(d); })
      .catch(() => { if (alive) setKey(null); });
    return () => { alive = false; };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(key.public_key || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // `navigator.clipboard` is a secure-context API, and a store reached over
      // a plain-HTTP .onion is not a secure context — exactly the deployment
      // most likely to have a buyer encrypting their own address. "Show block"
      // never needed the clipboard, so point at it rather than failing flat.
      setShown(true);
      toast.error('Clipboard is unavailable here — select the block below and copy it');
    }
  };

  if (key === undefined) {
    return <p className="skey is-loading">Looking up the store's key…</p>;
  }

  if (key === null || key.configured === false) {
    return (
      <p className="skey is-missing">
        <AlertTriangle size={14} aria-hidden="true" />
        <span>
          {key === null
            ? 'The store\'s key could not be fetched just now. Do not paste a block until you have it — one encrypted to the wrong key cannot be read by anyone, including the staff who would ship it.'
            : 'This store has no published PGP key, so there is nothing to encrypt an address to. Use the address form instead, or ask support before pasting a block.'}
        </span>
      </p>
    );
  }

  return (
    <div className="skey">
      <div className="skey-head">
        <span className="skey-badge">
          <KeyRound size={12} aria-hidden="true" />
          Store key
        </span>
        {key.address_encryption_ready === false && (
          <span className="skey-warn">
            <AlertTriangle size={12} aria-hidden="true" /> Expired
          </span>
        )}
      </div>

      <dl className="skey-facts">
        <div>
          <dt>Fingerprint</dt>
          <dd>{spaced(key.fingerprint)}</dd>
        </div>
        {key.user_ids?.length > 0 && (
          <div>
            <dt>Identity</dt>
            <dd>{key.user_ids.join(', ')}</dd>
          </div>
        )}
        <div>
          <dt>Algorithm</dt>
          <dd>{[key.algorithm, key.curve || (key.bits ? `${key.bits}-bit` : null)].filter(Boolean).join(' · ') || '—'}</dd>
        </div>
      </dl>

      <div className="skey-actions">
        <button type="button" className="glass-btn glass-btn-sm" onClick={copy}>
          {copied
            ? <><Check size={13} strokeWidth={3} aria-hidden="true" /> Copied</>
            : <><Copy size={13} aria-hidden="true" /> Copy key</>}
        </button>
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => setShown((s) => !s)}
          aria-expanded={shown}
        >
          <FileText size={13} aria-hidden="true" /> {shown ? 'Hide block' : 'Show block'}
        </button>
      </div>

      {/* The armored block itself, selectable. Not a nicety: the copy button
          above needs `navigator.clipboard`, which does not exist outside a
          secure context, and select-all-and-copy is the path that survives on
          a plain-HTTP .onion. */}
      {shown && (
        <textarea
          className="glass-input skey-block"
          value={key.public_key || ''}
          readOnly
          rows={7}
          spellCheck="false"
          aria-label="The store's armored public key"
          onFocus={(e) => e.target.select()}
        />
      )}

      <p className="skey-note">
        Check this fingerprint against the one you already trust before you encrypt to it.
      </p>
    </div>
  );
}
