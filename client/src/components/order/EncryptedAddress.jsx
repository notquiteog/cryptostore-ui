import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Copy, Eye, EyeOff, KeyRound, Lock, MonitorCheck, ShieldCheck } from 'lucide-react';
import { api } from '../../utils/api';
import DecryptControls from '../pgp/DecryptControls';
import useStoreDecryptKey from '../../hooks/useStoreDecryptKey';
import { decryptWith } from '../../utils/pgpClient';

/**
 * An address the customer had encrypted, and the controlled way to read it.
 *
 * Two kinds of encrypted address land here and they are not the same thing:
 *
 *   `auto`    the store encrypted it, to its own key and the buyer's. Staff
 *             holding `orders.decrypt_address` can unwrap it, and every
 *             attempt — successful or not — is written to the audit log.
 *   `manual`  the buyer pasted a block they encrypted themselves. The store
 *             was very likely not a recipient and there is nothing to try;
 *             saying so plainly beats a Decrypt button that always fails.
 *
 * The plaintext lives in this component's state and nowhere else. It is never
 * written back to the order, and it is dropped as soon as the panel is closed
 * — an address that stays on screen after the person needed it is a shoulder
 * -surfing surface for no benefit.
 *
 * `onDecrypted` (optional) mirrors that state outward for the one caller with
 * a legitimate need: the Ship desk's label sheet, which prints what this
 * component decrypted. It receives the plaintext on success and null on Hide,
 * so the caller's copy lives exactly as long as this one — no longer.
 *
 * ── Two ways in, and the one this prefers ───────────────────────────────────
 *
 * When the store key needs no passphrase and `address_auto_decrypt` is on, the
 * block is opened HERE, in the browser, with a key fetched once per tab — so
 * the address is never produced on the server, never crosses the wire, and
 * never lands in a proxy buffer or a heap dump. The panel says so, because a
 * staff member reading an address should be able to tell which of the two
 * happened.
 *
 * Everything else falls back to the audited server route exactly as before: a
 * passphrase-protected key (which is never released to a browser), an operator
 * who turned the setting off, a viewer whose grant the release refused, or a
 * browser where `openpgp` failed to load. The fallback is not a degraded mode —
 * it is the original feature, and it stays correct.
 */
export default function EncryptedAddress({ orderId, state, canDecrypt, armored, isOwner, onDecrypted }) {
  const [plain, setPlain] = useState(null);
  const [inBrowser, setInBrowser] = useState(false);
  const [showBlock, setShowBlock] = useState(false);
  const [copied, setCopied] = useState(false);

  const manual = state?.encryption === 'manual';

  // Only asked for by somebody who could actually use it. A `manual` block was
  // encrypted to recipients the buyer chose and the store is very likely not
  // among them — see the panel's own copy — so a store key would not open it
  // and fetching one would be an audit row for nothing.
  const canTryBrowser = canDecrypt && !manual && !!armored;
  const { keys: browserKeys, loading: keyLoading } = useStoreDecryptKey(canTryBrowser);

  // ── The automatic open ──
  //
  // Runs once the key has arrived, and only while nothing is on screen yet, so
  // pressing Hide is a decision this effect does not immediately undo. That
  // matters more than it sounds: an address that reappears the moment it is
  // dismissed is a shoulder-surfing surface the Hide button was added to close.
  useEffect(() => {
    if (!canTryBrowser || !browserKeys || plain) return undefined;
    let alive = true;
    decryptWith(browserKeys, armored)
      .then((text) => {
        if (!alive || !text) return;
        setPlain(text);
        setInBrowser(true);
        onDecrypted?.(text);
      })
      // A block none of the store's keys opens, or an openpgp chunk that did
      // not load. Both land on the server button below, which is the honest
      // next step rather than a toast about a failure the reader cannot fix.
      .catch(() => {});
    return () => { alive = false; };
    // `armored` and the key list identify the work; `plain` gates it and is
    // deliberately not a trigger for re-running it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canTryBrowser, browserKeys, armored]);

  const hide = () => { setPlain(null); setInBrowser(false); onDecrypted?.(null); };

  // The button, the passphrase step and the "that is the next step, not an
  // error" rule live in DecryptControls, shared with every other block the
  // admin panel can decrypt. This only knows which route owns the address.
  const decrypt = async (passphrase) => {
    const res = await api.post(`/orders/${orderId}/decrypt-address`, { passphrase });
    setPlain(res.shipping_address);
    setInBrowser(false);
    onDecrypted?.(res.shipping_address);
  };

  const copyBlock = async () => {
    try {
      await navigator.clipboard.writeText(armored || '');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy — select the block and copy it manually');
    }
  };

  return (
    <div className={`oenc${manual ? ' is-manual' : ''}`}>
      <div className="oenc-head">
        <span className="oenc-badge">
          <Lock size={11} aria-hidden="true" />
          {manual ? 'Encrypted by the customer' : 'PGP encrypted'}
        </span>
        {state?.encrypted_at && (
          <span className="oenc-when" title={new Date(state.encrypted_at).toLocaleString()}>
            {new Date(state.encrypted_at).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* The same panel serves the buyer looking at their own order and the
          staff member who has to ship it, and they need different sentences:
          "recorded in the audit log" is a warning to staff and a meaningless
          alarm to the person whose address it is. */}
      {manual ? (
        <p className="oenc-note">
          {isOwner
            ? 'You encrypted this yourself before sending it. The store keeps it exactly as you pasted it and cannot read it — make sure the store key was one of your recipients, or nobody can address your parcel.'
            : 'The customer encrypted this themselves, to recipients they chose. The store was not necessarily one of them, so it cannot be opened here — ask the customer for a copy encrypted to the store key if you need to ship it.'}
        </p>
      ) : (
        <p className="oenc-note">
          {isOwner
            ? `Your address is stored encrypted${state?.recipients?.length > 1 ? ' to your PGP key as well as the store\u2019s' : ' to the store\u2019s PGP key'}, so it is not readable from the database.`
            /* Two different true sentences, because the two paths do different
               things and the old one described only the server's. Browser
               decryption audits the key RELEASE, once per session, not each
               block \u2014 so telling a staff member every read is recorded would be
               a promise the log does not keep. */
            : `Stored encrypted to the store key${state?.recipients?.length > 1 ? " and the customer's own key" : ''}. ${
              inBrowser
                ? 'It was opened here, in your browser; the store key was released to this session and that release is in the audit log.'
                : 'Reading it unlocks the store private key and is recorded in the audit log.'}`}
        </p>
      )}

      {plain && (
        <figure className="oenc-plain" data-reveal>
          <figcaption className="oenc-plain-head">
            {/* Which of the two paths opened it. Not decoration: "the server
                unwrapped this and sent it to you" and "this was unwrapped in
                your tab and the server never saw it" are different facts about
                where the address has been, and the person reading it is
                entitled to know which. */}
            {inBrowser
              ? <><MonitorCheck size={12} aria-hidden="true" /> Decrypted in this browser — the server never saw it</>
              : <><ShieldCheck size={12} aria-hidden="true" /> Decrypted — not stored anywhere</>}
            <button type="button" className="glass-btn glass-btn-sm oenc-hide" onClick={hide}>
              <EyeOff size={12} aria-hidden="true" /> Hide
            </button>
          </figcaption>
          <pre className="oenc-plain-body">{plain}</pre>
        </figure>
      )}

      {/* The buyer holds their own copy — the server refuses to unlock the
          store key on their behalf, and offering a button that 403s would be
          worse than saying so. The block itself is below, ready to copy. */}
      {!plain && !canDecrypt && !manual && isOwner && state?.self_readable && (
        <p className="oenc-selfread">
          <KeyRound size={12} aria-hidden="true" />
          <span>
            This is encrypted to your own PGP key as well as the store's. Copy the block
            below and open it in your PGP client to read it back.
          </span>
        </p>
      )}

      {/* Nothing while the key is in flight. The alternative is drawing the
          button and replacing it a beat later with an open address, which
          invites a press that races the automatic open. */}
      {!plain && canDecrypt && !manual && !keyLoading && (
        <div className="oenc-actions">
          <DecryptControls decrypt={decrypt} label="Decrypt address" />
        </div>
      )}

      {armored && (
        <div className="oenc-raw">
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => setShowBlock((v) => !v)}
            aria-expanded={showBlock}
          >
            {showBlock ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
            {showBlock ? 'Hide block' : 'Show encrypted block'}
          </button>
          {showBlock && (
            <>
              <textarea
                className="glass-input oenc-block"
                value={armored}
                readOnly
                rows={8}
                aria-label="Encrypted address block"
                onFocus={(e) => e.target.select()}
              />
              <button type="button" className="glass-btn glass-btn-sm" onClick={copyBlock}>
                {copied
                  ? <><Check size={12} aria-hidden="true" /> Copied</>
                  : <><Copy size={12} aria-hidden="true" /> Copy block</>}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
