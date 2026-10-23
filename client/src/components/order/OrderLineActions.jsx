import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import toast from 'react-hot-toast';
import {
  ArrowLeftRight, Check, Clock, Info, Repeat, Undo2, Wallet, X,
} from 'lucide-react';
import { api } from '../../utils/api';
import RouteFallback from '../RouteFallback';
// The last admin component that was reaching a buyer's bundle.
//
// This file is a storefront component, and the picker is only mounted inside
// the swap composer — a panel a buyer opens deliberately, and usually never.
// Static, it put the whole catalogue picker into the chunk of everyone who
// merely opened an order. Same argument as the route split in App.jsx.
const CatalogPicker = lazy(() => import('../admin/CatalogPicker'));

/**
 * The two things staff can do to the lines of an order that is already paid,
 * and the buyer's side of one of them.
 *
 * Both exist for the same moment: the warehouse opens the order and one of the
 * things in it is not there. Before this, the only answer was to cancel the
 * whole order — throwing away the payment, the coupon, the buyer's place in the
 * queue and the three items that WERE in stock — and ask a customer who had
 * already paid to go and do it again.
 *
 * A swap is an OFFER. The buyer paid for a specific thing, and substituting it
 * because the warehouse would rather ship something else is not a decision the
 * store gets to make alone, so it renders as a proposal the buyer accepts or
 * declines. Staff may record that answer on the buyer's behalf when it arrives
 * in a ticket instead of through the UI; the server stamps who did.
 *
 * Every rule shown here is decided by the server — what may be swapped and
 * when, what the replacement is charged at, what credit is owed. This file
 * shows those answers; it does not compute them. `order.item_actions` is the
 * server saying which controls to render at all, so the page never offers a
 * button whose request would 403.
 */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/* ── The offer, as the buyer and staff both see it ────────────────────────── */

/**
 * One swap offer.
 *
 * Rendered to both audiences from one component, because the fact being
 * communicated is identical and only the buttons differ: the buyer answers, and
 * staff withdraw. Two components would be two places to get the price wording
 * wrong.
 */
export function SwapOffer({ swap, isOwner, canManage, onDone }) {
  const [busy, setBusy] = useState(false);
  const open = swap.status === 'offered';

  const respond = async (accept) => {
    if (!isOwner && !confirm(
      accept
        ? `Record that the customer ACCEPTED this swap?\n\nThe line changes to ${swap.to_variant_name} and any difference is refunded to their store credit. Only do this if they actually told you so — it is logged against your account.`
        : 'Record that the customer DECLINED this swap?\n\nIt is logged against your account.'
    )) return;
    setBusy(true);
    try {
      const res = await api.post(`/orders/${swap.order_id}/swaps/${swap.id}/respond`, { accept });
      toast.success(res.credit_paid > 0
        ? `Swap accepted — ${money(res.credit_paid)} store credit issued`
        : res.message);
      onDone();
    } catch (err) {
      toast.error(err.message || 'Could not record that');
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async () => {
    if (!confirm('Withdraw this offer? The replacement goes back into stock.')) return;
    setBusy(true);
    try {
      await api.delete(`/orders/${swap.order_id}/swaps/${swap.id}`);
      toast.success('Offer withdrawn');
      onDone();
    } catch (err) {
      toast.error(err.message || 'Could not withdraw it');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`oswap${open ? ' is-open' : ' is-closed'}`}>
      <header className="oswap-head">
        <span className="oswap-icon" aria-hidden="true"><ArrowLeftRight size={14} /></span>
        <span className="oswap-title">
          {open ? 'Swap offered' : `Swap ${swap.status}`}
        </span>
        {swap.expires_at && open && (
          <span className="oswap-expiry">
            <Clock size={11} aria-hidden="true" /> answer by {new Date(swap.expires_at).toLocaleString()}
          </span>
        )}
      </header>

      <div className="oswap-body">
        <div className="oswap-side is-from">
          <span className="oswap-label">Instead of</span>
          <strong>{swap.from_product_name}</strong>
          <span className="oswap-variant">{swap.from_variant_name} ×{swap.quantity}</span>
        </div>
        <span className="oswap-arrow" aria-hidden="true">→</span>
        <div className="oswap-side is-to">
          <span className="oswap-label">You would get</span>
          <strong>{swap.to_product_name}</strong>
          <span className="oswap-variant">{swap.to_variant_name} ×{swap.quantity}</span>
        </div>
      </div>

      {/* The money line, always present. "Same price" is a fact the buyer needs
          as much as a refund is — an offer that said nothing about price reads
          as one that might cost more. A NULL price means the viewer is staff
          without `orders.view_totals`, and the redaction is stated rather than
          rendered as a confident "$0.00". */}
      <p className="oswap-money">
        {swap.credit_amount == null
          ? <span className="oitem-hidden">price hidden</span>
          : swap.credit_amount > 0
            ? <><Wallet size={12} aria-hidden="true" /> {money(swap.credit_amount)} comes back as store credit.</>
            : <><Check size={12} aria-hidden="true" /> Same price — nothing more to pay.</>}
      </p>

      {swap.note && <p className="oswap-note">{swap.note}</p>}

      {swap.offered_by_username && (
        <p className="oswap-by">Offered by {swap.offered_by_username}</p>
      )}

      {open && (
        <div className="oswap-actions">
          {isOwner ? (
            <>
              <button type="button" className="glass-btn glass-btn-primary glass-btn-sm"
                onClick={() => respond(true)} disabled={busy}>
                <Check size={13} aria-hidden="true" /> Accept the swap
              </button>
              <button type="button" className="glass-btn glass-btn-sm"
                onClick={() => respond(false)} disabled={busy}>
                <X size={13} aria-hidden="true" /> No thanks
              </button>
            </>
          ) : canManage && (
            <>
              <button type="button" className="glass-btn glass-btn-sm"
                onClick={() => respond(true)} disabled={busy}>
                <Check size={13} aria-hidden="true" /> They accepted
              </button>
              <button type="button" className="glass-btn glass-btn-sm"
                onClick={() => respond(false)} disabled={busy}>
                <X size={13} aria-hidden="true" /> They declined
              </button>
              <button type="button" className="glass-btn glass-btn-sm oswap-withdraw"
                onClick={withdraw} disabled={busy}>
                <Undo2 size={13} aria-hidden="true" /> Withdraw
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
}

/* ── Staff: offer a swap on one line ──────────────────────────────────────── */

/**
 * Offering a swap, in a dialog.
 *
 * Not inline like the review composer next to it, and the reason is the
 * catalogue picker: it is a search box over three hundred products, and the
 * items card it would have to live in is a ~300px sidebar on the order page.
 * In there the picker either overflows the card or becomes unusable, and
 * neither is a fair place to ask somebody to find the right variant.
 *
 * A native <dialog> rather than a hand-rolled overlay. It brings focus
 * trapping, Escape-to-close, inertness of the page behind it and the top layer
 * with it — all the things a div with a high z-index has to reimplement badly,
 * and none of them a dependency.
 */
export function SwapComposer({ order, item, onDone, onCancel, ticketId }) {
  const dialogRef = useRef(null);
  const [picked, setPicked] = useState(null);
  const remaining = item.swap_eligibility?.max_quantity ?? Math.max(0, item.quantity - (item.refunded_quantity || 0) - (item.picked_quantity || 0));
  const [quantity, setQuantity] = useState(remaining);
  const [note, setNote] = useState('');
  const [restock, setRestock] = useState(false);
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);

  // showModal() rather than the `open` attribute: only the modal form puts the
  // dialog in the top layer, and only the top layer escapes the stacking
  // context of the glass card this is rendered inside.
  useEffect(() => {
    const el = dialogRef.current;
    if (el && !el.open) el.showModal();
  }, []);

  // Esc fires `cancel`; without this the dialog closes itself while React goes
  // on believing it is open, and re-opening it then does nothing.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return undefined;
    const onCancelEvent = (e) => { e.preventDefault(); onCancel(); };
    el.addEventListener('cancel', onCancelEvent);
    return () => el.removeEventListener('cancel', onCancelEvent);
  }, [onCancel]);

  const submit = async (e) => {
    e.preventDefault();
    if (!picked) return toast.error('Pick the replacement first');
    setBusy(true);
    try {
      const body = {
        variant_id: picked.variant.id,
        quantity,
        restock_original: restock,
      };
      if (note.trim()) body.note = note.trim();
      if (expiry !== '') body.expires_in_hours = parseFloat(expiry);
      const swap = ticketId ? await api.post(`/support/${ticketId}/resolve-order`, { action: 'swap', item_id: item.id, fields: body }) : await api.post(`/orders/${order.id}/items/${item.id}/swap`, body);
      if (swap.note_warning) toast.error(swap.note_warning);
      toast.success(swap.credit_amount > 0
        ? `Offered — ${money(swap.credit_amount)} back to the buyer if they accept`
        : 'Offered — same price for the buyer');
      onDone();
    } catch (err) {
      toast.error(err.message || 'Could not offer that swap');
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="oswap-dialog" aria-label="Offer a swap">
    <form className="oitem-compose oswap-compose" onSubmit={submit}>
      <header className="oswap-dialog-head">
        <h3><ArrowLeftRight size={16} aria-hidden="true" /> Offer a swap</h3>
        <button type="button" className="glass-btn glass-btn-sm" onClick={onCancel} aria-label="Close">
          <X size={14} aria-hidden="true" />
        </button>
      </header>

      {/* The sentence is one flex item, not one per text run. Left bare, the
          <strong> inside became a sibling of the words around it and the
          layout tore the sentence into columns. */}
      <p className="oswap-compose-lead">
        <span>
          Offering a replacement for <strong>{item.product_name} — {item.variant_name}</strong>.
          The buyer decides. The order total can never go up: a dearer replacement is
          offered at the price they already paid, and a cheaper one refunds the difference
          as store credit.
        </span>
      </p>

      {picked ? (
        <div className="oswap-picked">
          <div>
            <span className="oswap-label">Replacement</span>
            <strong>{picked.group.name} — {picked.variant.name}</strong>
            <span className="oswap-variant">
              list {money(picked.variant.price)} · {picked.variant.stock > 0 ? `${picked.variant.stock} in stock` : 'out of stock'}
            </span>
          </div>
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => setPicked(null)}>
            <Repeat size={12} aria-hidden="true" /> Change
          </button>
        </div>
      ) : (
        <div className="oswap-picker">
          <Suspense fallback={<RouteFallback label="Loading the catalogue…" />}>
            <CatalogPicker
              excludeVariantId={item.variant_id}
              onSelect={(variant, group) => setPicked({ variant, group })}
            />
          </Suspense>
        </div>
      )}

      <div className="oswap-compose-grid">
        <div className="form-group">
          <label htmlFor={`swapqty-${item.id}`}>How many</label>
          <input
            id={`swapqty-${item.id}`}
            className="glass-input"
            type="number"
            min={1}
            max={remaining}
            value={quantity}
            onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
          />
          <span className="oswap-hint">{remaining} on this line</span>
        </div>

        <div className="form-group">
          <label htmlFor={`swapexp-${item.id}`}>Expires in <span className="field-opt">(hours)</span></label>
          <input
            id={`swapexp-${item.id}`}
            className="glass-input"
            type="number"
            min={1}
            placeholder="never"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
          <span className="oswap-hint">The replacement is reserved until then</span>
        </div>
      </div>

      <div className="form-group">
        <label htmlFor={`swapnote-${item.id}`}>Note to the buyer <span className="field-opt">(optional)</span></label>
        <input
          id={`swapnote-${item.id}`}
          className="glass-input"
          value={note}
          maxLength={500}
          placeholder="Why you're offering this"
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {/* Off by default, and the wording says why rather than leaving the
          operator to guess. The motivating case is an empty shelf: the recorded
          count was already wrong, and putting the unit back would sell the same
          missing item to the next buyer. */}
      <label className="oitem-compose-sign">
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        <span>
          Put the original back into stock
          <em>Leave this off when the swap is because the shelf is empty — adding it back
            would offer an item you do not have to the next buyer.</em>
        </span>
      </label>

      <div className="oitem-compose-actions">
        <button type="submit" className="glass-btn glass-btn-primary glass-btn-sm" disabled={busy || !picked}>
          {busy ? <span className="spinner spinner-inline" /> : <ArrowLeftRight size={13} aria-hidden="true" />}
          Offer this swap
        </button>
        <button type="button" className="glass-btn glass-btn-sm" onClick={onCancel} disabled={busy}>
          <X size={13} aria-hidden="true" /> Cancel
        </button>
      </div>
    </form>
    </dialog>
  );
}

/* ── Staff: refund lines to store credit ──────────────────────────────────── */

/**
 * Refund whole lines, part of a line, or the entire order — always to store
 * credit.
 *
 * Never to crypto. The store does not send coins automatically from anywhere;
 * an operator cancels the order and sends them by hand if that is what is
 * wanted. This form has no way to reach a wallet, which is also why it answers
 * to its own permission rather than to the one that unlocks a payout.
 */
export function RefundComposer({ order, onDone, onCancel, ticketId }) {
  const items = (order.items || []).filter((i) => i.quantity - (i.refunded_quantity || 0) > 0);
  const [picked, setPicked] = useState(() => Object.fromEntries(items.map((i) => [i.id, 0])));
  const [shipping, setShipping] = useState(false);
  const [restock, setRestock] = useState(!['shipped', 'delivered', 'disputed'].includes(order.status));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const shippingLeft = !order.shipping_refunded && Number(order.shipping_cost || 0) > 0;

  const chosen = items.filter((i) => picked[i.id] > 0);
  // A preview, not the authority. The server recomputes every figure in integer
  // cents and caps the whole thing at what the order actually took; this is
  // here so the operator is not clicking blind.
  const estimate = chosen.reduce((sum, i) => sum + Number(i.price_at_purchase || 0) * picked[i.id], 0)
    + (shipping && shippingLeft ? Number(order.shipping_cost || 0) : 0);

  const everything = () => {
    setPicked(Object.fromEntries(items.map((i) => [i.id, i.quantity - (i.refunded_quantity || 0)])));
    setShipping(shippingLeft);
  };

  const submit = async (e) => {
    e.preventDefault();
    if (chosen.length === 0 && !(shipping && shippingLeft)) {
      return toast.error('Pick at least one line, or the postage');
    }
    if (!confirm(
      `Refund about ${money(estimate)} to this customer's store credit?\n\n`
      + 'Store credit only — no coins are sent. This cannot be undone from here.'
    )) return;

    setBusy(true);
    try {
      const fields = {
        items: chosen.map((i) => ({ order_item_id: i.id, quantity: picked[i.id] })),
        shipping,
        restock,
        reason: reason.trim() || undefined,
      };
      const res = ticketId ? await api.post(`/support/${ticketId}/resolve-order`, { action: 'credit', fields }) : await api.post(`/orders/${order.id}/refund-items`, fields);
      if (res.note_warning) toast.error(res.note_warning);
      toast.success(res.message);
      onDone();
    } catch (err) {
      toast.error(err.message || 'Could not refund');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="oitem-compose orefund-compose" onSubmit={submit}>
      <p className="oswap-compose-lead">
        <Info size={13} aria-hidden="true" className="oswap-lead-icon" />
        <span>
          Refunds go to <strong>store credit</strong>, never to a wallet. To send coins
          back, cancel the order and pay it out by hand.
        </span>
      </p>

      <div className="orefund-lines">
        {items.length === 0 && <p className="oitems-empty">Every line has already been refunded.</p>}
        {items.map((item) => {
          const left = item.quantity - (item.refunded_quantity || 0);
          return (
            <div key={item.id} className="orefund-line">
              <div className="orefund-line-text">
                <strong>{item.product_name}</strong>
                <span className="oswap-variant">
                  {item.variant_name} · {left} of {item.quantity} refundable
                  {item.price_at_purchase != null && ` · ${money(item.price_at_purchase)} each`}
                </span>
              </div>
              <input
                className="glass-input orefund-qty"
                type="number"
                min={0}
                max={left}
                value={picked[item.id] ?? 0}
                aria-label={`Units of ${item.product_name} to refund`}
                onChange={(e) => {
                  const n = Math.max(0, Math.min(left, parseInt(e.target.value, 10) || 0));
                  setPicked((p) => ({ ...p, [item.id]: n }));
                }}
              />
            </div>
          );
        })}
      </div>

      {shippingLeft && (
        <label className="oitem-compose-sign">
          <input type="checkbox" checked={shipping} onChange={(e) => setShipping(e.target.checked)} />
          <span>
            Refund the postage too ({money(order.shipping_cost)})
            <em>A buyer who keeps some of the order was still sent a parcel.</em>
          </span>
        </label>
      )}

      <label className="oitem-compose-sign">
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
        <span>
          Put the refunded units back into stock
          <em>Off by default once an order has shipped — those goods are in the post, not on a shelf.</em>
        </span>
      </label>

      <div className="form-group">
        <label htmlFor="refund-reason">Reason <span className="field-opt">(recorded in the ledger)</span></label>
        <input
          id="refund-reason"
          className="glass-input"
          value={reason}
          maxLength={300}
          placeholder="Out of stock, damaged in transit…"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <div className="oitem-compose-actions">
        <button type="button" className="glass-btn glass-btn-sm" onClick={everything}>
          Select everything
        </button>
        <span className="orefund-estimate">
          ≈ <strong>{money(estimate)}</strong> to store credit
        </span>
        <button type="submit" className="glass-btn glass-btn-primary glass-btn-sm" disabled={busy}>
          {busy ? <span className="spinner spinner-inline" /> : <Wallet size={13} aria-hidden="true" />}
          Refund to credit
        </button>
        <button type="button" className="glass-btn glass-btn-sm" onClick={onCancel} disabled={busy}>
          <X size={13} aria-hidden="true" /> Cancel
        </button>
      </div>
    </form>
  );
}
