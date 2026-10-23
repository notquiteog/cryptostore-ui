import useCartQuote from '../hooks/useCartQuote';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useCart } from '../context/CartContext';
import CompanionSpot from '../components/ai/CompanionSpot';
import { useTheme } from '../context/ThemeContext';
import { shippingCostFor, nextShippingBreak } from '../utils/shipping';
import CheckoutSteps from '../components/CheckoutSteps';
import CartLine from '../components/cart/CartLine';
import { pausedMessage, storePaused } from '../components/StorePausedBar';
import {
  ShoppingBag, ArrowRight, ArrowLeft, ShieldCheck, Bookmark,
  AlertTriangle, RefreshCw, Heart, Truck, TrendingDown, PackageX, PauseCircle,
} from 'lucide-react';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const signed = (n) => `${n < 0 ? '−' : '+'}${money(Math.abs(n))}`;

/* How long the re-reckoning stays on screen after a write. Long enough to read
   a figure and match it against the row that moved, short enough that it is
   gone before the next press. */
const RECKON_MS = 4200;

/**
 * A snapshot of what the cart cost, keyed by line, for diffing against the next
 * one. Only the two numbers that can move on their own: the engine re-prices
 * the WHOLE cart on every write, so a unit price can change on a line the buyer
 * did not touch.
 */
const snapshot = (items) => {
  const m = new Map();
  for (const i of items) m.set(i.id, { unit: Number(i.price), qty: i.quantity });
  return m;
};

export default function Cart() {
  const { items, error, hydrated, updateQuantity, removeItem, fetchCart, total } = useCart();
  const { settings } = useTheme();

  /**
   * The re-reckoning: what the last write actually did to the money.
   *
   * DESIGN §10 asks a flourish to do a job, and this one has a specific job in
   * this app. `pricingService` prices the cart as a whole — volume tiers pool
   * across same-priced variants of a product, flash sales have their own
   * thresholds — so pressing `+` once can change the UNIT price of the line,
   * and of its siblings, and move the subtotal by something that is not one
   * unit's worth. Before this, the number simply changed, and a total that
   * jumps by an unexplained amount on a money screen reads as a bug rather
   * than as the discount it is.
   *
   * `{ byId, delta }`: per-line the unit price it moved FROM, and the subtotal
   * step. Null whenever nothing has moved since the last look.
   */
  const [reckon, setReckon] = useState(null);
  const prevRef = useRef(null);
  const reckonTimer = useRef(null);

  useEffect(() => {
    const next = snapshot(items);
    const nextTotal = items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
    const prev = prevRef.current;
    prevRef.current = { lines: next, total: nextTotal };

    // First load has nothing to compare against, and a page that announced a
    // "change" the moment it opened would be describing the buyer's own cart
    // back at them as if something had just happened.
    //
    // Two snapshots count as "no baseline", not one. The provider mounts with
    // `items: []` and fills it when the fetch lands, so the first real cart
    // arrives as a diff against an empty one — which drew `+$286.93` beside
    // the total on a page nobody had touched yet, reporting the buyer's own
    // cart to them as if it had just changed.
    if (!prev || prev.lines.size === 0) return;

    const byId = {};
    for (const [id, now] of next) {
      const was = prev.lines.get(id);
      if (!was) continue;
      // Only a unit price that moved is worth saying. A quantity change on its
      // own is the thing the buyer just did — they do not need telling.
      if (Math.round(was.unit * 100) !== Math.round(now.unit * 100)) {
        byId[id] = { unitWas: was.unit, dir: now.unit < was.unit ? 'down' : 'up' };
      }
    }

    const delta = nextTotal - prev.total;
    if (Object.keys(byId).length === 0 && Math.abs(delta) < 0.005) return;

    setReckon({ byId, delta });
    clearTimeout(reckonTimer.current);
    reckonTimer.current = setTimeout(() => setReckon(null), RECKON_MS);
  }, [items]);

  useEffect(() => () => clearTimeout(reckonTimer.current), []);

  const units = items.reduce((sum, item) => sum + item.quantity, 0);

  // What the engine already took off, added up. The per-line figures are on the
  // rows; this is the one the buyer repeats to themselves.
  const saved = items.reduce((sum, i) => {
    const base = Number(i.base_price ?? i.price);
    const unit = Number(i.price);
    return sum + (base > unit ? (base - unit) * i.quantity : 0);
  }, 0);

  // Quoted from the shared ladder, not left as "at checkout". `orderController`
  // recomputes and is what charges; this is the same function the product page
  // quotes with, so the two cannot disagree about a store's own setting.
  const estimatedShipping = useMemo(
    () => shippingCostFor(settings.shipping_tiers, units),
    [settings.shipping_tiers, units],
  );
  const nextBreak = useMemo(
    () => nextShippingBreak(settings.shipping_tiers, units),
    [settings.shipping_tiers, units],
  );

  const quote = useCartQuote(items, { enabled: hydrated });
  const shipping = quote.data?.shipping ?? estimatedShipping;
  const blocked = items.filter((i) => i.available === false || Number(i.stock) < i.quantity);

  /* ── Loading ──────────────────────────────────────────────────────────────
     Rows, not a centred spinner on a blank page: the cart is a list whose
     shape is known before its contents are, and holding that shape is what
     stops the page jumping when the answer lands. */
  if (!hydrated && items.length === 0) {
    return (
      <div className="page container cart-page">
        <CartHead subtitle="Reading your cart…" />
        <CheckoutSteps current={0} />
        <div className="cart-layout">
          <ul className="lrows cart-lines" aria-busy="true" aria-label="Loading your cart">
            {[0, 1, 2].map((i) => <li key={i} className="lrow-skel cart-line-skel" />)}
          </ul>
          <aside className="glass-card summary-panel" aria-hidden="true">
            <h2 className="summary-title">Order summary</h2>
            <div className="summary-skel" />
          </aside>
        </div>
      </div>
    );
  }

  /* ── Failed to load ───────────────────────────────────────────────────────
     Distinct from empty, which it used to be indistinguishable from: someone
     whose lines had just failed to load was told their cart was empty and
     invited to go shopping. */
  if (error) {
    return (
      <div className="page container cart-page">
        <CartHead subtitle="Your cart could not be read." />
        <div className="glass-card empty-state is-error">
          <AlertTriangle aria-hidden="true" />
          <h3>Your cart did not load</h3>
          <p>{error}. Your lines are still on your account — this is the store failing to read them, not the cart emptying itself.</p>
          <div className="empty-state-links">
            <button type="button" className="glass-btn glass-btn-primary" onClick={fetchCart}>
              <RefreshCw size={15} aria-hidden="true" /> Try again
            </button>
            <Link to="/products" className="glass-btn">Browse products</Link>
            <Link to="/support" className="glass-btn">Ask support</Link>
          </div>
        </div>
      </div>
    );
  }

  /* ── Empty ────────────────────────────────────────────────────────────────
     §9: an empty state is navigation. Three real destinations, because the
     three reasons to arrive here with nothing in the cart are that you have
     not started, that you saved things for later, and that you want what you
     bought last time. */
  if (items.length === 0) {
    return (
      <div className="page container cart-page">
        <CartHead subtitle="Nothing in it yet." />
        <div className="glass-card empty-state">
          {/* The shop's companion stands here when it has one, in the same
              medallion the icon had. See CompanionSpot. */}
          <CompanionSpot fallback={<ShoppingBag aria-hidden="true" />} />
          <h3>Your cart is empty</h3>
          <p>
            Whatever you add stays here across visits and across devices — it lives on your
            account, not in this browser — so you can start a cart now and finish it later.
          </p>
          <div className="empty-state-links">
            <Link to="/products" className="glass-btn glass-btn-primary">Browse products</Link>
            <Link to="/wishlist" className="glass-btn"><Heart size={15} aria-hidden="true" /> Saved for later</Link>
            <Link to="/orders" className="glass-btn">Buy something again</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page container cart-page">
      <CartHead subtitle={`${plural(items.length, 'product')} · ${plural(units, 'item')}`} back />

      <CheckoutSteps current={0} />

      <div className="cart-layout">
        <div className="cart-list-col">
          {/* Blocking first. `createOrder` refuses the whole order over these
              lines with a 400 naming the product — so saying it here, with the
              count and the way out, is the difference between a buyer removing
              a row and a buyer filling in a checkout form for nothing. */}
          {blocked.length > 0 && (
            <div className="cart-blocked" role="alert">
              <PackageX size={16} aria-hidden="true" />
              <p>
                <strong>{plural(blocked.length, 'line')} needs an update.</strong>{' '}
                Choose another size, lower the quantity, or remove the marked {blocked.length === 1 ? 'line' : 'lines'} below.
              </p>
              <button
                type="button"
                className="glass-btn glass-btn-sm glass-btn-danger"
                /* Sequential, not `forEach`. Every `removeItem` refetches the
                   whole cart when its DELETE lands, so firing them together
                   races several reads against several writes and the last
                   answer back wins — which is not necessarily the last state.
                   Three lines removed one at a time is three round trips
                   nobody notices; a cart that comes back with a row still in
                   it is a bug somebody reports. */
                onClick={async () => {
                  for (const line of blocked) {
                    try {
                      await removeItem(line.id);
                    } catch (err) {
                      toast.error(`${line.product_name} could not be removed: ${err?.message || 'unknown error'}`);
                    }
                  }
                }}
              >
                <PackageX size={13} aria-hidden="true" />
                Remove {blocked.length === 1 ? 'it' : `all ${blocked.length}`}
              </button>
            </div>
          )}

          {/* DESIGN §6, answered: the shared line item, not a purpose-built
              pair and not a comfortable/compact toggle.
              · The responsive table is wrong — a cart line carries a
                thumbnail and a live stepper, and `.admin-rtable` reflows
                cells, not controls.
              · A toggle is wrong — it is a control nobody would press. A cart
                is one to forty lines and every one of them is already the
                densest shape that still holds a 44px stepper; there is no
                second view worth persisting a choice about.
              `.lrows` brings the hairline rhythm, the hover and focus-within
              pair, the truncation, and — the reason it beats hand-rolling —
              the CONTAINER query that turns each line into a card in a narrow
              box, so this list is correct inside the page and would still be
              correct in a sidebar. */}
          <ul className="lrows cart-lines">
            <li className="lrows-head cart-lines-head" aria-hidden="true">
              <span />
              <span>Product</span>
              <span className="lrow-num">Unit</span>
              <span className="cart-line-qty">Qty</span>
              <span className="lrow-num">Line</span>
              <span />
            </li>
            {items.map((item) => (
              <CartLine
                key={item.id}
                item={item}
                change={reckon?.byId[item.id]}
                onQuantity={(qty) => updateQuantity(item.id, qty)}
                onRemove={() => removeItem(item.id)}
              />
            ))}
          </ul>

          <p className="cart-list-foot">
            Prices are what you pay — volume breaks, sales and your tier are already in them.
            {' '}<Link to="/products">Keep shopping</Link> or <Link to="/wishlist">check what you saved</Link>.
          </p>
        </div>

        <aside className="glass-card summary-panel">
          <h2 className="summary-title">Order summary</h2>

          <dl className="ledger">
            <div className="ledger-row">
              <dt>{plural(units, 'item')}</dt>
              <dd>{money(total)}</dd>
            </div>
            {saved > 0 && (
              <div className="ledger-row is-credit">
                <dt><TrendingDown size={12} aria-hidden="true" /> Already discounted</dt>
                <dd>−{money(saved)}</dd>
              </div>
            )}
            <div className="ledger-row">
              <dt>Shipping</dt>
              {shipping === 0
                ? <dd className="is-free">Free</dd>
                : <dd>{money(shipping)}</dd>}
            </div>
          </dl>

          {nextBreak && (
            <p className="cart-ship-hint">
              <Truck size={13} aria-hidden="true" />
              <span>
                {plural(nextBreak.addUnits, 'more item')} and shipping{' '}
                {nextBreak.price === 0 ? 'is free' : `drops to ${money(nextBreak.price)}`}.
              </span>
            </p>
          )}

          <div className="summary-total">
            <span className="summary-total-label">Estimated total</span>
            <span className="summary-total-value">{quote.ready ? money(quote.data.total) : quote.error ? 'Unavailable' : 'Updating…'}</span>
            {/* The re-reckoning's other half: the step the last write took,
                beside the figure it moved. */}
            {reckon && Math.abs(reckon.delta) >= 0.005 && (
              <span
                key={`${reckon.delta}-${units}`}
                className={`summary-delta${reckon.delta < 0 ? ' is-down' : ' is-up'}`}
                aria-hidden="true"
              >
                {signed(reckon.delta)}
              </span>
            )}
          </div>

          {quote.error && <p className="flow-error" role="alert">{quote.error} <button type="button" className="glass-btn glass-btn-sm" onClick={quote.retry}>Refresh total</button></p>}
          <p className="summary-note">Coupons, store credit and payment-method adjustments are shown at checkout.</p>

          {blocked.length > 0 ? (
            <p className="summary-blocked" role="status">
              <AlertTriangle size={14} aria-hidden="true" />
              Update or remove the {plural(blocked.length, 'unavailable line')} above to continue.
            </p>
          ) : storePaused(settings) ? (
            /* The operator has paused new orders (components/StorePausedBar).
               The button stays, disabled, so the page still reads as a cart
               that leads somewhere — and the reason sits under it in the
               operator's own words, because a disabled button with no
               sentence is a bug report waiting to be filed. The cart itself
               is untouched: edits still save, and it is here when the till
               reopens. */
            <>
              <button type="button" className="glass-btn glass-btn-primary summary-cta" disabled title={pausedMessage(settings)}>
                <PauseCircle size={17} aria-hidden="true" /> Checkout paused
              </button>
              <p className="summary-blocked summary-paused" role="status">
                <PauseCircle size={14} aria-hidden="true" />
                <span>{pausedMessage(settings)} Your cart is kept until then.</span>
              </p>
            </>
          ) : (
            <Link to="/checkout" className="glass-btn glass-btn-primary summary-cta">
              Checkout <ArrowRight size={17} aria-hidden="true" />
            </Link>
          )}

          <ul className="summary-trust">
            <li>
              <ShieldCheck size={13} aria-hidden="true" />
              Crypto at checkout — no card number is asked for, so none can be taken from us later
            </li>
            <li>
              <Bookmark size={13} aria-hidden="true" />
              This cart is on your account, not in this browser
            </li>
          </ul>
        </aside>
      </div>
    </div>
  );
}

/* The head, once, so the five states above cannot drift apart on the title. */
function CartHead({ subtitle, back = false }) {
  return (
    <header className="cart-head">
      <div className="cart-head-text">
        <h1 className="page-title">Your cart</h1>
        <p className="cart-head-sub">{subtitle}</p>
      </div>
      {back && (
        <Link to="/products" className="glass-btn glass-btn-sm cart-head-back">
          <ArrowLeft size={15} aria-hidden="true" /> Keep shopping
        </Link>
      )}
    </header>
  );
}
