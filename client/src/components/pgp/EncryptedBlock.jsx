import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Copy, Eye, EyeOff, Lock, MonitorCheck, ShieldCheck } from 'lucide-react';
import { api } from '../../utils/api';
import DecryptControls from './DecryptControls';
import useStoreDecryptKey from '../../hooks/useStoreDecryptKey';
import { decryptWith } from '../../utils/pgpClient';

/**
 * One armored PGP MESSAGE found in free text, drawn as the panel the order
 * page draws for an encrypted address: a badge, the block behind a
 * show/copy toggle, and — for a viewer holding `orders.decrypt_address` —
 * the audited decrypt.
 *
 * Decryption happens in the browser when the store key needs no passphrase and
 * the operator has left `address_auto_decrypt` on — the block never moves and
 * the plaintext is never produced on the server. Everything else falls back to
 * the generic store-key route, which matches the block to whichever store key
 * it was encrypted for and refuses, by key id, a block encrypted to somebody
 * else. `context` names where the block was found for the audit row ("support
 * ticket 41"); the plaintext lives in this component's state only, is never
 * written back, and is dropped on Hide.
 *
 * ── Why a block in a THREAD is still opened automatically ───────────────────
 *
 * It is the same decision as the order page's address and deliberately not a
 * more cautious one. A block pasted into a support ticket is there because the
 * customer wanted the agent reading the ticket to read it; making them press a
 * button first protects nobody, and the shoulder-surfing argument is answered
 * by the same Hide control the address panel has. What differs between the two
 * surfaces is only which route owns the fallback.
 */
export default function EncryptedBlock({ armored, canDecrypt, context, compact = false }) {
  const [plain, setPlain] = useState(null);
  const [inBrowser, setInBrowser] = useState(false);
  const [showBlock, setShowBlock] = useState(false);
  const [copied, setCopied] = useState(false);

  const { keys: browserKeys, loading: keyLoading } = useStoreDecryptKey(canDecrypt && !!armored);

  useEffect(() => {
    if (!canDecrypt || !browserKeys || !armored || plain) return undefined;
    let alive = true;
    decryptWith(browserKeys, armored)
      .then((text) => {
        if (!alive || !text) return;
        setPlain(text);
        setInBrowser(true);
      })
      // No store key opens it — the case this component's own copy describes,
      // "a block encrypted to somebody else". The server button stays, and it
      // answers with the key ids so an agent can tell the customer who they
      // actually encrypted to.
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDecrypt, browserKeys, armored]);

  const decrypt = async (passphrase) => {
    const res = await api.post('/store-pgp/decrypt', { message: armored, passphrase, context });
    setPlain(res.text);
    setInBrowser(false);
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
    <div className={`oenc oenc-inline${compact ? ' is-compact' : ''}`}>
      <div className="oenc-head">
        <span className="oenc-badge"><Lock size={11} aria-hidden="true" /> PGP encrypted</span>
      </div>

      {!compact && (
        <p className="oenc-note">
          {/* As on the order page: the browser path audits the key release
              once, not each block, so it gets its own sentence rather than
              inheriting a promise about the log that would not be true. */}
          {!canDecrypt
            ? 'An encrypted block. Reading it needs the permission to decrypt addresses.'
            : inBrowser
              ? 'Encrypted to the store key. It was opened here, in your browser; the store key was released to this session and that release is in the audit log.'
              : 'Encrypted to the store key, if the sender addressed it there. Reading it unlocks the store private key and is recorded in the audit log.'}
        </p>
      )}

      {plain && (
        <figure className="oenc-plain" data-reveal>
          <figcaption className="oenc-plain-head">
            {inBrowser
              ? <><MonitorCheck size={12} aria-hidden="true" /> Decrypted in this browser — the server never saw it</>
              : <><ShieldCheck size={12} aria-hidden="true" /> Decrypted — not stored anywhere</>}
            <button
              type="button"
              className="glass-btn glass-btn-sm oenc-hide"
              onClick={() => { setPlain(null); setInBrowser(false); }}
            >
              <EyeOff size={12} aria-hidden="true" /> Hide
            </button>
          </figcaption>
          <pre className="oenc-plain-body">{plain}</pre>
        </figure>
      )}

      {!plain && canDecrypt && !keyLoading && (
        <div className="oenc-actions">
          <DecryptControls decrypt={decrypt} label="Decrypt" />
        </div>
      )}

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
              rows={6}
              aria-label="Encrypted block"
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
    </div>
  );
}
