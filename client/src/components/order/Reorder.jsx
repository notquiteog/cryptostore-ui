import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  RotateCcw, ArrowRight, CheckCircle, AlertTriangle, X, TrendingUp, TrendingDown,
} from 'lucide-react';
import { api } from '../../utils/api';
import { useCart } from '../../context/CartContext';

// ─── Reorder ("buy it again") ─────────────────────────────────────────────────
//
// Used by both the order list and the order page. Written once because a
// reorder result is a small contract with the server — status codes, skip
// reasons, whether a price moved — and two renderings of it drift the moment
// one page is touched and the other is not. That is this repository's named
// failure mode, and it does not stop at the server boundary.
//
// These used to live in pages/Orders.jsx, whose own header said they belonged
// in a shared file "if one is added later". This is that file, and the move
// bought something beyond tidiness: `OrderDetail` statically imported them from
// `Orders`, and `Checkout` statically imports `OrderDetail`, so the whole chain
// was pinned into the entry chunk and rolldown reported both pages as
// INEFFECTIVE_DYNAMIC_IMPORT — declared lazy in App.jsx and not actually
// splittable. A page importing a value out of another page is what did that.

/**
 * The button. Owns nothing but its own in-flight state: the result goes back to
 * the page, which renders one summary sheet for the whole view.
 */
export function ReorderButton({ orderRef, onResult, label = 'Buy it again', block = false }) {
  const [busy, setBusy] = useState(false);
  const { fetchCart } = useCart();

  const run = async (e) => {
    // The order cards in the list are wrapped in a <Link>. Without these two
    // the same click reorders AND navigates to the order page, so the buyer
    // never sees the summary that says what could not be added.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.post(`/orders/${orderRef}/reorder`, { preview: true });
      // The navbar's cart badge is fed by the cart context, not by this
      // response. Refreshed here so the count moves at the same moment the
      // summary appears, rather than on the next page load.
      await fetchCart();
      onResult?.(result);
    } catch (err) {
      toast.error(err.message || 'Could not add those items to your cart');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className={`orderx-reorder-btn${block ? ' is-block' : ''}${busy ? ' is-busy' : ''}`}
      aria-label={`${label} — add this order's items to your cart`}
    >
      <RotateCcw size={13} className="orderx-reorder-icon" aria-hidden="true" />
      {busy ? 'Comparing…' : label}
    </button>
  );
}

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/** A running total wants thousands separators; a line price does not. */
const grouped = (n) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * The honest summary.
 *
 * Three groups, and the middle one is the reason this is a panel rather than a
 * toast: "added", "already in your cart", and "could not be added" — each line
 * with the reason the server gave. A reorder that silently dropped a withdrawn
 * variant would send the buyer to checkout with a cart they believe matches an
 * order they remember, and they would find out at the door.
 *
 * Price movement is called out for the same reason: a repeat buyer is repeating
 * a number, and a flash sale that has since ended is an honest price change
 * that still reads as a bait-and-switch when it is discovered at checkout.
 */
export function ReorderSummary({ result, onClose }) {
  const navigate = useNavigate();
  const [leaving, setLeaving] = useState(false);
  const [revision, setRevision] = useState(null);
  const [choices, setChoices] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { fetchCart } = useCart();
  useEffect(() => { setRevision(null); setChoices({}); setError(null); }, [result]);
  const shown = revision || result;
  const compare = async (nextChoices) => {
    setBusy(true); setError(null);
    try { const next = await api.post(`/orders/${result.order_uuid}/reorder`, { preview: true, replacements: nextChoices }); setRevision(next); setChoices(nextChoices); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try { const next = await api.post(`/orders/${result.order_uuid}/reorder`, { replacements: choices, fingerprint: shown.fingerprint }); setRevision(next); await fetchCart(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  const primaryRef = useRef(null);
  const sheetRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const exitTimer = useRef(null);
  const busyRef = useRef(false);
  busyRef.current = busy;
  // Both pages pass a fresh arrow function on every render. Kept in a ref so
  // `close` can have an empty dependency list: with `onClose` in the list, the
  // effect below re-ran on every render and re-focused the sheet, yanking focus
  // back from whatever the reader had just tabbed to.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = useCallback(() => {
    if (busyRef.current) return;
    setLeaving(true);
    // Matches the exit animation in orders.css. Reduced-motion users get the
    // same delay with no movement, which is harmless; what matters is that the
    // panel is never yanked away mid-read.
    exitTimer.current = setTimeout(() => {
      setLeaving(false);
      onCloseRef.current?.();
      // Back where it came from — the reorder button on the card or the header.
      // Without this, dismissing the sheet drops focus to the document body and
      // a keyboard user restarts their tab journey from the top of the page.
      restoreFocusRef.current?.focus?.();
    }, 200);
  }, []);

  useEffect(() => {
    if (!result) return undefined;
    restoreFocusRef.current = document.activeElement;
    // The CTA is disabled when nothing was added, and focusing a disabled
    // element is a no-op that would leave focus outside the dialog entirely.
    // The sheet itself is focusable (tabIndex -1) so there is always somewhere
    // for focus to land.
    if (primaryRef.current && !primaryRef.current.disabled) primaryRef.current.focus();
    else sheetRef.current?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      if (e.key !== 'Tab') return;
      const controls = [...sheetRef.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (!first) { e.preventDefault(); sheetRef.current.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = previousOverflow; };
  }, [result, close]);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  if (!result) return null;

  const items = shown.items || [];
  const added = items.filter((i) => i.status === 'added');
  const unchanged = items.filter((i) => i.status === 'unchanged');
  const skipped = items.filter((i) => i.status === 'skipped');
  const nothingHappened = added.length === 0 && unchanged.length === 0;

  const goToCart = () => {
    setLeaving(true);
    // A beat before the route changes, so the cart arrives as the end of a
    // movement rather than as an unexplained jump. No focus restore here: the
    // element that opened this is about to be unmounted by the navigation.
    exitTimer.current = setTimeout(() => { onCloseRef.current?.(); navigate('/cart'); }, 200);
  };

  const headline = shown.preview ? 'Review your repeat order' : nothingHappened
    ? 'Nothing could be added'
    : added.length === 0
      ? 'Already in your cart'
      : `${shown.added_units} item${shown.added_units === 1 ? '' : 's'} added to your cart`;

  return (
    <div
      className={`orderx-sheet-backdrop${leaving ? ' is-leaving' : ''}`}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div
        className={`orderx-sheet${leaving ? ' is-leaving' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="orderx-sheet-title"
        ref={sheetRef}
        tabIndex={-1}
      >
        <div className={`orderx-sheet-head${nothingHappened ? ' is-empty' : ''}`}>
          <span className="orderx-sheet-mark" aria-hidden="true">
            {nothingHappened ? <AlertTriangle size={17} /> : <CheckCircle size={17} />}
          </span>
          <div className="orderx-sheet-heading">
            <h3 id="orderx-sheet-title" className="orderx-sheet-title">{headline}</h3>
            <p className="orderx-sheet-sub">
              From order {String(result.order_uuid || '').split('-')[0].toUpperCase()} · priced at today's rates
            </p>
          </div>
          <button type="button" className="orderx-sheet-close" disabled={busy} onClick={close} aria-label="Close">
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <div className="orderx-sheet-body">
          {error && <p className="flow-error" role="alert">{error} <button className="glass-btn glass-btn-sm" disabled={busy} onClick={() => compare({})}>Refresh comparison</button></p>}
          {shown.preview && <p className="flow-note">Nothing has been added yet. Prices include your existing cart; coupons, credit and payment-method adjustments are applied at checkout.</p>}
          {shown.preview && (shown.alternatives || []).map(a => <label className="flow-field" key={a.variant_id}><span>{a.product_name} · pack options</span><select className="glass-input" disabled={busy} value={JSON.stringify(choices[a.variant_id] || [])} onChange={e => { const next = { ...choices }; const parts = JSON.parse(e.target.value); if (parts.length) next[a.variant_id] = parts; else delete next[a.variant_id]; compare(next); }}><option value="[]">Keep original pack size</option>{a.proposals.map((parts, i) => <option key={i} value={JSON.stringify(parts.map(p => [p.variant_id, p.quantity]))}>{parts.map(p => `${p.quantity} × ${p.name}`).join(' + ')} · same total units</option>)}</select></label>)}
          <dl className="ledger"><div className="ledger-row"><dt>Cart subtotal</dt><dd>{money(shown.subtotal)}</dd></div><div className="ledger-row"><dt>Shipping</dt><dd>{money(shown.shipping)}</dd></div><div className="ledger-row"><dt>Cart total</dt><dd>{money(shown.total)}</dd></div></dl>
          {added.length > 0 && (
            <section className="orderx-group">
              <h4 className="orderx-group-title">{shown.preview ? "Ready to add" : "Added"}</h4>
              <ul className="orderx-list">
                {added.map((i) => <ReorderLine key={`a-${i.variant_id}`} item={i} tone="ok" preview={shown.preview} />)}
              </ul>
            </section>
          )}

          {unchanged.length > 0 && (
            <section className="orderx-group">
              <h4 className="orderx-group-title">Already in your cart</h4>
              <ul className="orderx-list">
                {unchanged.map((i) => <ReorderLine key={`u-${i.variant_id}`} item={i} tone="muted" />)}
              </ul>
            </section>
          )}

          {skipped.length > 0 && (
            <section className="orderx-group">
              <h4 className="orderx-group-title is-warn">Could not be added</h4>
              <ul className="orderx-list">
                {skipped.map((i, n) => <ReorderLine key={`s-${i.variant_id ?? n}`} item={i} tone="warn" />)}
              </ul>
            </section>
          )}
        </div>

        <div className="orderx-sheet-foot">
          <button
            type="button"
            ref={primaryRef}
            className="orderx-cta"
            onClick={shown.preview ? apply : goToCart}
            disabled={nothingHappened || busy}
          >
            {busy ? 'Updating…' : shown.preview ? 'Add reviewed items' : 'Go to cart'}
            <ArrowRight size={14} aria-hidden="true" />
          </button>
          <button type="button" className="orderx-ghost" onClick={close}>
            Keep browsing
          </button>
        </div>
      </div>
    </div>
  );
}

function ReorderLine({ item, tone, preview = false }) {
  const cheaper = item.price_changed && item.unit_price < item.previous_unit_price;
  return (
    <li className={`orderx-line is-${tone}`}>
      <div className="orderx-line-main">
        <span className="orderx-line-name">{item.product_name}</span>
        <span className="orderx-line-variant">{item.variant_name}</span>
      </div>
      <div className="orderx-line-meta">
        {item.status === 'skipped' ? (
          <span className="orderx-reason">{item.reason_text}</span>
        ) : (
          <>
            <span className="orderx-qty">×{item.cart_quantity}</span>
            {item.unit_price !== null && item.unit_price !== undefined && (
              <span className="orderx-price">{money(item.unit_price)}</span>
            )}
          </>
        )}
      </div>
      {item.limited_by_stock && item.status !== 'skipped' && (
        <p className="orderx-note is-warn">
          You ordered {item.ordered_quantity} — only {item.available_stock} in stock, so {item.cart_quantity} {preview ? "can be added" : "was added"}.
        </p>
      )}
      {item.price_changed && item.status !== 'skipped' && (
        <p className={`orderx-note${cheaper ? ' is-good' : ' is-warn'}`}>
          {cheaper
            ? <TrendingDown size={11} aria-hidden="true" />
            : <TrendingUp size={11} aria-hidden="true" />}
          Price is now {money(item.unit_price)}; you paid {money(item.previous_unit_price)} last time.
        </p>
      )}
    </li>
  );
}

/*
 * One vocabulary for order state, used by every part of this page.
 *
 * The old card said the same thing three times — a badge in the header, a
 * second badge inside the progress track for terminal orders, and a sentence
 * in the footer ("Cancelled", "On its way"). Three statements of one fact is
 * not emphasis, it is a card that never decided which element owned the
 * status. Now one table owns it: the badge tone, the accent stripe, the step
 * the tracker lights, and the words a buyer reads.
 */
