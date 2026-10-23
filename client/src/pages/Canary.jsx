import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bird, ShieldCheck, ShieldAlert, Shield, Copy } from 'lucide-react';
import { api } from '../utils/api';

/**
 * The store's warrant canary, as a visitor reads it.
 *
 * Public and outside every login gate — a canary that needs an account is a
 * diary. The page says three things in order: whether the statement is
 * still fresh (its dates are the fact; the banner is the summary), the
 * signed block itself, and how to verify it. Nothing here is drawn from
 * anywhere but the signed document: the banner reads `next_due_at` out of
 * the same row the signature covers, so the page cannot claim freshness the
 * signature does not.
 */

const fmt = (v) => (v ? new Date(v).toLocaleString() : '—');

export default function Canary() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get('/canary').then(setData).catch((err) => setError(err.message || 'Could not load the canary'));
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(data.signed);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard blocked: the block is selectable text */ }
  };

  if (error) return <div className="page container canary-page"><p className="canary-note">{error}</p></div>;
  if (!data) return <div className="page container canary-page"><p className="canary-note">Loading…</p></div>;

  if (!data.enabled || !data.issued) {
    return (
      <div className="page container canary-page">
        <h1 className="page-title"><Bird size={22} aria-hidden="true" /> Warrant canary</h1>
        <p className="canary-note">
          {data.enabled
            ? 'This store has enabled a warrant canary but has not issued one yet.'
            : 'This store does not publish a warrant canary.'}
        </p>
        <p className="canary-note"><Link to="/">Back to the store</Link></p>
      </div>
    );
  }

  const fresh = data.state === 'fresh';
  const due = data.state === 'due';
  const Icon = fresh ? ShieldCheck : due ? Shield : ShieldAlert;
  const tone = fresh ? 'is-ok' : due ? 'is-warn' : 'is-bad';

  return (
    <div className="page container canary-page">
      <h1 className="page-title"><Bird size={22} aria-hidden="true" /> Warrant canary</h1>

      <div className={`canary-banner ${tone}`} role="status">
        <Icon size={18} aria-hidden="true" />
        <div>
          <strong>
            {fresh ? 'Current.' : due ? 'Past due.' : 'Stale — treat the statement as withdrawn.'}
          </strong>{' '}
          Signed {fmt(data.issued_at)}, next due {fmt(data.next_due_at)}.
          {' '}The dates inside the signed block below are the fact; this line only reads them back.
        </div>
      </div>

      {data.chains?.length > 0 && (
        <p className="canary-chains">
          Stamped against{' '}
          {data.chains.filter((c) => c.reachable).map((c) => (
            <span key={c.coin} title={c.hash}>{c.coin.toUpperCase()} block {c.height}</span>
          ))}
          {data.chains.some((c) => !c.reachable) && <em> ({data.chains.filter((c) => !c.reachable).map((c) => c.coin.toUpperCase()).join(', ')} unreachable at signing)</em>}
          . A block hash cannot be known in advance, so the signature happened after it.
        </p>
      )}

      <div className="canary-block-head">
        <span>Signed statement</span>
        <span className="canary-block-actions">
          <button type="button" className="glass-btn glass-btn-sm" onClick={copy}><Copy size={12} aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}</button>
          <a className="glass-btn glass-btn-sm" href="/canary.txt" target="_blank" rel="noopener noreferrer">canary.txt</a>
        </span>
      </div>
      <pre className="canary-block">{data.signed}</pre>

      <div className="canary-verify">
        <h2>Verify it yourself</h2>
        <ol>
          <li>Save the block above as <code>canary.txt</code>, or fetch <a href="/canary.txt">/canary.txt</a>.</li>
          <li>Import the store key from the <Link to="/checkout">checkout page</Link> or <code>/api/store-pgp/public</code>; its fingerprint is <code>{data.fingerprint}</code>.</li>
          <li>Run <code>gpg --verify canary.txt</code>. A good signature, an issue time you trust, and a next-due time still ahead of you is the whole check.</li>
        </ol>
        {/* The freshness rule lives here, on the page that explains the canary,
            rather than inside the signed block — and nothing on this page says
            how {store} renews it. That is the operator's routine, not the
            reader's business. */}
        <p>A statement past its next-due time is withdrawn. If this one is stale, assume the worst.</p>
      </div>
    </div>
  );
}
