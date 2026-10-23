import { useState } from 'react';
import toast from 'react-hot-toast';
import { Wallet, Send, AlertTriangle, RefreshCw } from 'lucide-react';
import { api } from '../../utils/api';

// ─── Pay a refund from the store wallet ───────────────────────────────────────
//
// The refund desk on the order page had one door: an operator paid the buyer
// from some wallet of their own and pasted the txid as proof. This is the
// second door — the store's own wallet pays, and the txid is recorded by the
// server in the same act — and it is drawn only for a viewer holding both
// `orders.refund` and `nodes.send`, because the server refuses anyone else and
// a button that 403s reads worse than no button.
//
// Two steps on purpose, quote then send. The quote is a read that shows the
// coin figure, the rate it came from, and — when the wallet cannot pay — the
// reason, in the server's words: node off, wallet locked, balance short. The
// send carries the figure the operator read back to the server as
// `expected_coin_amount`; if the rate has moved more than a percent since, the
// server answers 409 with a fresh quote instead of paying, and this component
// puts the new number on screen with a warning rather than the old one. The
// person confirms what they see, never what they saw.
//
// The address is not fetched here. The page already prints it, under
// `orders.view_payment`, from the order itself.

const COIN_NAMES = { btc: 'Bitcoin', ltc: 'Litecoin', xmr: 'Monero' };
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const fmtRate = (r) => Number(r).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

/**
 * @param orderRef  the order's uuid (or id) for the two endpoints
 * @param onSent    called with (txid, { unrecorded }) — `unrecorded` is the one
 *                  outcome the page must act on: money left the wallet and the
 *                  row was not written, so the txid has to go in by hand.
 */
export default function WalletRefund({ orderRef, onSent }) {
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(null); // 'quote' | 'send' | null
  // True when the figure on screen is the server's replacement for the one
  // the operator pressed on — the 409 — so the warning names it.
  const [moved, setMoved] = useState(false);

  const fetchQuote = async () => {
    setBusy('quote');
    setMoved(false);
    try {
      setQuote(await api.get(`/orders/${orderRef}/refund-quote`));
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(null);
  };

  const send = async () => {
    if (!quote?.can_send || busy) return;
    setBusy('send');
    try {
      const r = await api.post(`/orders/${orderRef}/send-refund`, { expected_coin_amount: quote.coin_amount });
      toast.success(`Sent ${r.coin_amount} ${String(r.coin).toUpperCase()} to the buyer`);
      setQuote(null);
      onSent?.(r.refund_txid, { unrecorded: false });
    } catch (err) {
      const code = err.data?.code;
      if (err.status === 409 && code === 'quote_moved' && err.data.quote) {
        setQuote(err.data.quote);
        setMoved(true);
      } else if (code === 'refund_send_unrecorded' && err.data?.refund_txid) {
        // Loud and long: this is the one error the operator must not dismiss
        // without acting on it.
        toast.error(err.message, { duration: 30000 });
        setQuote(null);
        onSent?.(err.data.refund_txid, { unrecorded: true });
      } else {
        // A refusal that carries the re-read row ("already sent", "refunded
        // to credit") replaces the quote so the screen agrees with the server.
        if (err.data?.quote) setQuote(err.data.quote);
        toast.error(err.message);
      }
    }
    setBusy(null);
  };

  if (!quote) {
    return (
      <div className="od-confirm-actions">
        <button type="button" className="glass-btn glass-btn-sm" onClick={fetchQuote} disabled={busy === 'quote'}>
          <Wallet size={13} aria-hidden="true" /> {busy === 'quote' ? 'Quoting…' : 'Send from the store wallet'}
        </button>
      </div>
    );
  }

  const COIN = quote.coin ? quote.coin.toUpperCase() : null;
  // Tokens inline rather than a rule: this component may not add a stylesheet
  // of its own, and 82-order-detail-panels.css owns the refund desk. When that
  // file is next touched, `.od-wallet-refund { display:grid; gap:var(--sp-2);
  // margin-top:var(--sp-3) }` replaces this.
  return (
    <div className="od-wallet-refund" style={{ display: 'grid', gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
      {quote.coin && quote.coin_amount != null && (
        <dl className="od-kv">
          <div className="od-kv-row">
            <dt>From</dt>
            <dd>{COIN_NAMES[quote.coin] || COIN} wallet</dd>
          </div>
          <div className={`od-kv-row is-num${moved ? ' is-warn' : ''}`}>
            <dt>Sends</dt>
            <dd>{quote.coin_amount} {COIN}</dd>
          </div>
          <div className="od-kv-row is-num" title={quote.rate_at ? `Rate as of ${fmtTime(quote.rate_at)}` : undefined}>
            <dt>For</dt>
            <dd>{money(quote.fiat_amount)} at {fmtRate(quote.rate)} / {COIN}</dd>
          </div>
        </dl>
      )}
      {moved && (
        <div className="od-note is-warn">
          <AlertTriangle size={14} aria-hidden="true" />
          <div>The rate moved since the last quote, so nothing was sent. This is the new figure — send it if it is still right.</div>
        </div>
      )}
      {!quote.can_send && quote.reason && (
        <div className="od-note is-warn">
          <AlertTriangle size={14} aria-hidden="true" />
          <div>{quote.reason}</div>
        </div>
      )}
      <div className="od-confirm-actions">
        {quote.can_send && (
          <button type="button" className="glass-btn glass-btn-success glass-btn-sm" onClick={send} disabled={busy != null}>
            <Send size={13} aria-hidden="true" /> {busy === 'send' ? 'Sending…' : `Send ${quote.coin_amount} ${COIN}`}
          </button>
        )}
        <button type="button" className="glass-btn glass-btn-sm" onClick={fetchQuote} disabled={busy != null} title="Fresh rate, fresh wallet check">
          <RefreshCw size={13} aria-hidden="true" /> {busy === 'quote' ? 'Quoting…' : 'Quote again'}
        </button>
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => { setQuote(null); setMoved(false); }} disabled={busy === 'send'}>
          Not now
        </button>
      </div>
    </div>
  );
}
