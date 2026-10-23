import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../utils/api';

/**
 * The signed download: one `.asc` that is both the receipt and its proof.
 *
 * The button is drawn only after the server has said it can sign unattended
 * (`?probe=1`) — a store whose key is passphrase-protected gets a one-line
 * reason instead of a button that fails, following StoreKeyCard's rule of
 * answering the question that decides whether the thing is safe rather than
 * half-offering it. The file is fetched with the session's own header and
 * handed to the browser as a download; a bare link would carry no token.
 */
function SignedReceiptLink({ uuid }) {
  const [probe, setProbe] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get(`/orders/${uuid}/receipt.asc?probe=1`)
      .then((d) => { if (alive) setProbe(d); })
      .catch((err) => { if (alive) setProbe({ ok: false, reason: err.message }); });
    return () => { alive = false; };
  }, [uuid]);

  const download = async () => {
    setBusy(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`/api/orders/${uuid}/receipt.asc`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Could not sign the receipt (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `receipt-${probe?.ref || String(uuid).slice(0, 8).toUpperCase()}.asc`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!probe) return null;
  if (!probe.ok) {
    return (
      <p className="no-print" style={{ margin: '0.75rem 0 0', fontSize: 'var(--fs-xs)', color: '#555' }}>
        No signed copy: {probe.reason}
      </p>
    );
  }
  return (
    <div className="no-print" style={{ marginTop: 'var(--sp-3)', display: 'flex', gap: 'var(--sp-3)', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 'var(--fs-xs)', color: '#555' }}>
        Signed by store key …{String(probe.fingerprint || '').slice(-16)} · <code>gpg --verify receipt-{probe.ref}.asc</code>
      </span>
      <button type="button" onClick={download} disabled={busy} style={{ background: '#fff', color: '#000', border: '1px solid #000', padding: 'var(--sp-2) var(--sp-4)', cursor: 'pointer', borderRadius: 4 }}>
        {busy ? 'Signing…' : 'Download signed (.asc)'}
      </button>
    </div>
  );
}

export default function OrderReceipt() {
  const { uuid } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/orders/${uuid}`)
      .then(data => setOrder(data))
      .catch(err => setError(err?.message || 'Order not found or access denied'))
      .finally(() => setLoading(false));
  }, [uuid]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: '#fff' }}>
        <span>Loading receipt...</span>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div style={{ maxWidth: 600, margin: '4rem auto', padding: 'var(--sp-8)', fontFamily: 'monospace', textAlign: 'center' }}>
        <p style={{ color: '#c00', fontSize: 'var(--fs-md)' }}>{error || 'Order not found.'}</p>
      </div>
    );
  }

  const items = order.items || [];

  /**
   * A receipt is an assertion about money, so it may only be printed by a
   * viewer who is allowed to see the money.
   *
   * `orderVisibility` nulls `price_at_purchase` on every item, and `total`,
   * `shipping_cost` and `discount_amount` on the order, for a staff viewer who
   * lacks `orders.view_totals` — the buyer themselves is never redacted. That
   * viewer could still open this route, and the sheet rendered every line as
   * `$NaN` under `Subtotal $0.00` and `TOTAL $0.00`: a printable financial
   * document stating the order was free, which is worse than no document at
   * all. Refuse instead, and say which permission is missing so the reader
   * knows this is a permissions boundary and not a broken order.
   *
   * Both signals are checked because either one alone is fooled by an odd
   * order: a genuinely zero-total order is not redacted, and an order that
   * came back without items has nothing to inspect.
   */
  const totalsWithheld = order.redacted === true && (
    order.total == null || items.some(i => i.redacted === true || i.price_at_purchase == null)
  );

  if (totalsWithheld) {
    return (
      <div style={{ maxWidth: 600, margin: '4rem auto', padding: 'var(--sp-8)', fontFamily: 'monospace' }}>
        <h1 style={{ fontSize: 'var(--fs-lg)', letterSpacing: '0.1em' }}>RECEIPT UNAVAILABLE</h1>
        <p style={{ fontSize: 'var(--fs-base)', lineHeight: 1.6 }}>
          Order #{order.uuid} exists, but its prices and totals are withheld from your
          account, so no receipt can be produced for it. Printing one would state a
          total of $0.00, which is not what this order was charged.
        </p>
        <p style={{ fontSize: 'var(--fs-base)', color: '#555' }}>
          Viewing order totals requires the <strong>orders.view_totals</strong> permission.
          Ask an administrator if you need it.
        </p>
      </div>
    );
  }

  /**
   * What the goods came to, before shipping and before the discount.
   *
   * This printed `total + discount_amount`. The server stores
   * `total = subtotal + shipping - discount`, so that expression is
   * `subtotal + shipping` — and the sheet then prints Shipping again on its own
   * line. A $50 item with $8 shipping and a $5 coupon printed 58 + 8 - 5 = $61
   * against a TOTAL of $53, billing shipping twice on a document a customer may
   * hand to an accountant. c2fbd76 fixed the in-checkout receipt and left this
   * one, so the arithmetic has to be restated here rather than assumed.
   *
   * The lines are the authority: they are what was actually charged and cannot
   * drift from it. Checkout's `ledgerOf` arithmetic is the fallback for an
   * order that somehow came back without its items.
   */
  const subtotal = items.length
    ? items.reduce((sum, i) => sum + parseFloat(i.price_at_purchase || 0) * i.quantity, 0)
    : parseFloat(order.total || 0) + parseFloat(order.discount_amount || 0) - parseFloat(order.shipping_cost || 0);

  return (
    <>
      <style>{`@media print { .no-print { display: none !important; } body { background: white; } }`}</style>
      <div style={{ maxWidth: 600, margin: '0 auto', padding: 'var(--sp-8)', fontFamily: 'monospace', color: '#111', background: '#fff', minHeight: '100vh' }}>
        {/* Print button - hidden when printing */}
        <div style={{ textAlign: 'right', marginBottom: 'var(--sp-4)' }} className="no-print">
          <button onClick={() => window.print()} style={{ background: '#000', color: '#fff', border: 'none', padding: 'var(--sp-2) var(--sp-4)', cursor: 'pointer', borderRadius: 4 }}>
            Print Receipt
          </button>
        </div>

        {/* Header */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid #111', paddingBottom: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
          <h1 style={{ margin: 0, fontSize: 'var(--fs-xl)', letterSpacing: '0.1em' }}>ORDER RECEIPT</h1>
          <p style={{ margin: '0.5rem 0 0', fontSize: 'var(--fs-base)' }}>Order #{order.uuid}</p>
          <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: '#555' }}>{new Date(order.created_at).toLocaleString()}</p>
        </div>

        {/* Order details */}
        <div style={{ marginBottom: 'var(--sp-4)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Status:</span><span style={{ fontWeight: 700 }}>{order.status?.replace(/_/g, ' ').toUpperCase()}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Payment:</span><span>{order.payment_method?.replace(/_/g, ' ').toUpperCase()}</span>
          </div>
          {order.paid_at && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Paid:</span><span>{new Date(order.paid_at).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Items */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 'var(--sp-4)' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #111' }}>
              <th style={{ textAlign: 'left', padding: '0.25rem 0', fontSize: 'var(--fs-sm)' }}>Item</th>
              <th style={{ textAlign: 'center', padding: 'var(--sp-1)', fontSize: 'var(--fs-sm)' }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '0.25rem 0', fontSize: 'var(--fs-sm)' }}>Price</th>
              <th style={{ textAlign: 'right', padding: '0.25rem 0', fontSize: 'var(--fs-sm)' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} style={{ borderBottom: '1px dashed #ccc' }}>
                <td style={{ padding: '0.35rem 0', fontSize: 'var(--fs-base)' }}>{item.product_name} — {item.variant_name}</td>
                <td style={{ textAlign: 'center', padding: 'var(--sp-15)', fontSize: 'var(--fs-base)' }}>{item.quantity}</td>
                <td style={{ textAlign: 'right', padding: '0.35rem 0', fontSize: 'var(--fs-base)' }}>${parseFloat(item.price_at_purchase).toFixed(2)}</td>
                <td style={{ textAlign: 'right', padding: '0.35rem 0', fontSize: 'var(--fs-base)' }}>${(parseFloat(item.price_at_purchase) * item.quantity).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ borderTop: '1px solid #111', paddingTop: 'var(--sp-2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--sp-1)' }}>
            <span>Subtotal:</span><span>${subtotal.toFixed(2)}</span>
          </div>
          {parseFloat(order.shipping_cost || 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--sp-1)' }}>
              <span>Shipping:</span><span>${parseFloat(order.shipping_cost).toFixed(2)}</span>
            </div>
          )}
          {parseFloat(order.discount_amount || 0) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--sp-1)', color: '#197a3a' }}>
              <span>Discount:</span><span>-${parseFloat(order.discount_amount).toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 'var(--fs-lg)', borderTop: '2px solid #111', paddingTop: 'var(--sp-2)' }}>
            <span>TOTAL:</span><span>${parseFloat(order.total || 0).toFixed(2)}</span>
          </div>
        </div>

        <div style={{ marginTop: 'var(--sp-8)', textAlign: 'center', fontSize: 'var(--fs-xs)', color: '#555', borderTop: '1px dashed #ccc', paddingTop: 'var(--sp-4)' }}>
          Thank you for your order.
        </div>

        {/* The signed copy, at the foot beside the print control. Absent with
            a reason when the store cannot sign unattended — never a dead link.
            No shipping address is in it, by design (utils/receiptText). */}
        <SignedReceiptLink uuid={order.uuid} />
      </div>
    </>
  );
}
