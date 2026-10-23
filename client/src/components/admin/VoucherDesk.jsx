import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Ticket, Plus, Ban, Printer, Copy, Check, Gift, CalendarClock, X } from 'lucide-react';
import { api } from '../../utils/api';
import { money } from '../../utils/adminFormat';
import { gradientStops } from '../../utils/code128';

/**
 * Bearer store-credit vouchers: issue them, print them, void them.
 *
 * ── The one rule the screen is built around ─────────────────────────────────
 *
 * The code is shown ONCE. The server keeps only its HMAC, so nothing in the
 * list below can display a code again; the moment of issue is the moment to
 * print it or copy it, and the panel says so before the button is pressed.
 * The list shows hints (`…7K2Q`), values and states, which is enough to void
 * one or to answer "was that voucher used" — and not enough to redeem it.
 *
 * ── The ticket ──────────────────────────────────────────────────────────────
 *
 * Printed through the coupon ticket's own design (33-coupon-vouchers.css):
 * the same tear-off stub, the same Code 128 on it, because a voucher IS a
 * ticket and inventing a second paper shape for a second kind of code is how
 * a store ends up with two printers' worth of CSS.
 */

function VoucherTicket({ code, voucher, storeName }) {
  const bars = useMemo(() => {
    try { return { '--cpn-bars': gradientStops(code).stops }; } catch { return {}; }
  }, [code]);
  return (
    <article className="coupon coupon-flat coupon-gift">
      <div className="coupon-body">
        <div className="coupon-row">
          <span className="coupon-kind"><Gift size={11} /> Store credit</span>
          {storeName && <span className="coupon-state">{storeName}</span>}
        </div>
        <div className="coupon-amount">
          <span className="coupon-amount-num">{money(voucher.face_value)}</span>
          <span className="coupon-amount-unit">credit</span>
        </div>
        <div className="coupon-terms">
          <span className="coupon-term"><Ticket size={12} aria-hidden="true" /> Redeem at checkout or on your profile</span>
          <span className="coupon-term">
            <CalendarClock size={12} aria-hidden="true" />
            {voucher.expires_at ? `Expires ${new Date(voucher.expires_at).toLocaleDateString()}` : 'No expiry'}
          </span>
          {voucher.note && <span className="coupon-term">{voucher.note}</span>}
        </div>
        <div className="coupon-code-row">
          <span className="coupon-code">{code}</span>
        </div>
      </div>
      <div className="coupon-stub">
        <div className="coupon-barcode" style={bars} aria-hidden="true" />
        <div className="coupon-stub-code">{code}</div>
      </div>
    </article>
  );
}

const STATE = {
  open: { label: 'Open', cls: 'is-open' },
  redeemed: { label: 'Redeemed', cls: 'is-redeemed' },
  expired: { label: 'Expired', cls: 'is-expired' },
  void: { label: 'Cancelled', cls: 'is-void' },
};

export default function VoucherDesk({ storeName, onChanged }) {
  const [list, setList] = useState(null);
  const [totals, setTotals] = useState(null);
  const [form, setForm] = useState({ face_value: '', count: 1, expires_at: '', note: '' });
  const [issuing, setIssuing] = useState(false);
  // The codes just minted — the only time they exist on screen.
  const [fresh, setFresh] = useState([]);
  const [copied, setCopied] = useState(null);
  const [printing, setPrinting] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api.get('/admin/vouchers');
      setList(d.vouchers || []);
      setTotals(d.totals || null);
    } catch (err) {
      toast.error(err.message || 'Could not load vouchers');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const issue = async (e) => {
    e.preventDefault();
    setIssuing(true);
    try {
      const d = await api.post('/admin/vouchers', {
        face_value: Number(form.face_value),
        count: Number(form.count) || 1,
        expires_at: form.expires_at ? new Date(form.expires_at).toISOString() : null,
        note: form.note || null,
      });
      setFresh(d.vouchers || []);
      setTotals(d.totals || null);
      toast.success(`${d.vouchers.length} voucher${d.vouchers.length === 1 ? '' : 's'} issued — print or copy the code now`);
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message || 'Could not issue');
    } finally {
      setIssuing(false);
    }
  };

  const voidOne = async (v) => {
    if (!window.confirm(`Cancel voucher ${v.hint} worth ${money(v.face_value)}? It can no longer be redeemed.`)) return;
    try {
      await api.post(`/admin/vouchers/${v.id}/void`);
      toast.success(`Voucher ${v.hint} cancelled`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not cancel');
    }
  };

  const copy = async (code) => {
    try { await navigator.clipboard.writeText(code); setCopied(code); setTimeout(() => setCopied(null), 1500); } catch { toast.error('Could not copy'); }
  };

  const print = () => {
    setPrinting(true);
    requestAnimationFrame(() => requestAnimationFrame(() => { window.print(); setTimeout(() => setPrinting(false), 500); }));
  };

  return (
    <section className={`glass-card vdesk${printing ? ' is-printing' : ''}`} aria-label="Store credit vouchers">
      <header className="vdesk-head">
        <h3><Ticket size={15} aria-hidden="true" /> Credit vouchers</h3>
        {totals && (
          <span className="vdesk-totals">
            <b>{totals.open_count}</b> open worth <b>{money(totals.open_value)}</b> · <b>{totals.redeemed_count}</b> redeemed
          </span>
        )}
      </header>
      <p className="vdesk-lede">
        A code worth a fixed amount of store credit to whoever redeems it first — at checkout, on their
        profile, or with <code>/redeem</code> on a bot. The code is shown <strong>once</strong>: the store
        keeps only a hash of it. Print or copy it before you leave this panel.
      </p>

      <form className="vdesk-form" onSubmit={issue}>
        <label>
          <span>Value</span>
          <input className="glass-input" type="number" min="0.01" max="100000" step="0.01" required value={form.face_value}
            onChange={(e) => setForm({ ...form, face_value: e.target.value })} placeholder="25.00" />
        </label>
        <label>
          <span>How many</span>
          <input className="glass-input" type="number" min="1" max="25" value={form.count}
            onChange={(e) => setForm({ ...form, count: e.target.value })} />
        </label>
        <label>
          <span>Expires</span>
          <input className="glass-input" type="date" value={form.expires_at}
            onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
        </label>
        <label className="vdesk-note">
          <span>Note on the ticket</span>
          <input className="glass-input" type="text" maxLength={140} value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="e.g. Sorry about the delay" />
        </label>
        <button type="submit" className="glass-btn glass-btn-sm glass-btn-primary" disabled={issuing || !(Number(form.face_value) > 0)}>
          <Plus size={13} aria-hidden="true" /> {issuing ? 'Issuing…' : 'Issue'}
        </button>
      </form>

      {fresh.length > 0 && (
        <div className="vdesk-fresh" role="region" aria-label="Just issued">
          <div className="vdesk-fresh-head">
            <strong>Just issued — these codes will not be shown again.</strong>
            <span className="vdesk-fresh-actions">
              <button type="button" className="glass-btn glass-btn-sm" onClick={print}><Printer size={13} aria-hidden="true" /> Print tickets</button>
              <button type="button" className="glass-btn glass-btn-sm" onClick={() => setFresh([])}><X size={13} aria-hidden="true" /> Done</button>
            </span>
          </div>
          <div className="vdesk-tickets">
            {fresh.map((v) => (
              <div key={v.id} className="vdesk-ticket">
                <VoucherTicket code={v.code} voucher={v} storeName={storeName} />
                <button type="button" className="glass-btn glass-btn-sm vdesk-copy" onClick={() => copy(v.code)}>
                  {copied === v.code ? <Check size={13} /> : <Copy size={13} />} {copied === v.code ? 'Copied' : 'Copy code'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {list === null ? null : list.length === 0 ? (
        <p className="vdesk-empty">No vouchers issued yet.</p>
      ) : (
        <ul className="vdesk-list">
          {list.map((v) => {
            const st = STATE[v.state] || STATE.open;
            return (
              <li key={v.id} className={`vdesk-row ${st.cls}`}>
                <span className="vdesk-hint" title="The last four characters — the full code was never stored">{v.hint}</span>
                <span className="vdesk-value">{money(v.face_value)}</span>
                <span className={`vdesk-state ${st.cls}`}>{st.label}</span>
                <span className="vdesk-when">
                  {v.state === 'redeemed'
                    ? <>by {v.redeemed_by_username || 'someone'} · {new Date(v.redeemed_at).toLocaleDateString()}{v.redeemed_order_uuid && <> · <Link to={`/orders/${v.redeemed_order_uuid}`}>order</Link></>}</>
                    : <>issued {new Date(v.issued_at).toLocaleDateString()}{v.issued_by_username ? ` by ${v.issued_by_username}` : ''}{v.expires_at ? ` · expires ${new Date(v.expires_at).toLocaleDateString()}` : ''}</>}
                </span>
                <span className="vdesk-note-text" title={v.note || undefined}>{v.note || ''}</span>
                {v.state === 'open' && (
                  <button type="button" className="glass-btn glass-btn-sm vdesk-void" onClick={() => voidOne(v)} title="Cancel this voucher — it can no longer be redeemed">
                    <Ban size={12} aria-hidden="true" /> Cancel
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
