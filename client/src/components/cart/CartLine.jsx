import CartRecovery from './CartRecovery';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2, Minus, Plus, Package, AlertTriangle, TrendingDown, Layers } from 'lucide-react';
import toast from 'react-hot-toast';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/**
 * One line of the cart, as a `.lrow` line item.
 *
 * DESIGN §6 asks every list to say which of the three answers it took. This one
 * is the shared line item from `74-list-views.css` with its own column tracks —
 * not a purpose-built pair and not a toggle. The reasoning is in Cart.jsx.
 *
 * What this row draws that its predecessor did not, all of it already in the
 * `GET /orders/cart` payload and all of it previously discarded:
 *
 * - `available: false`. The server sets this when the variant or its group has
 *   been deactivated, or when the group is a drop this buyer may not see yet.
 *   `createOrder` REFUSES an order containing such a line, naming the product
 *   in a 400. The cart drew the line as ordinary, so the buyer filled in the
 *   whole checkout form, was turned away by a message naming a product, and had
 *   no way to tell which of their rows it meant. It is now the loudest thing on
 *   the row.
 * - `stock`. The `+` button posted a quantity the server refuses with
 *   "Not enough stock" — and unlike MiniCart, this page had no catch on the
 *   promise, so the rejection went to the console and the button appeared
 *   simply not to work. The step is capped, and every write is caught.
 * - `base_price` vs `price`. `price` is what the pricing engine actually
 *   charges after volume tiers, flash sales, VIP tier and sub-user markup;
 *   `base_price` is the catalogue figure. The cart is the one screen where a
 *   discount is the reason someone is about to spend money, and it showed
 *   neither the old figure nor the saving.
 *
 * `change` is handed down by Cart.jsx after a quantity write lands: it is how a
 * unit price that MOVED gets said out loud rather than the buyer being left to
 * work out why a total went up by more than one unit's worth.
 */
export default function CartLine({ item, change, onQuantity, onRemove }) {
  const [busy, setBusy] = useState(false);
  // The quantity as typed. A cart line for 24 units cost 23 presses of `+`,
  // which is the sort of thing that only looks acceptable in a mockup with two
  // rows in it — §7, every control must justify its pixels, and a stepper that
  // cannot be typed into does not for a wholesale line.
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);

  const qty = item.quantity;
  const unit = Number(item.price);
  const base = Number(item.base_price ?? item.price);
  // Only ever a REDUCTION. A sub-user markup makes `price` exceed `base_price`,
  // and printing that as a struck-through "was" would advertise a discount that
  // is really a surcharge — the wrong way round in the one place it matters.
  const savedEach = base > unit ? base - unit : 0;
  const lineTotal = unit * qty;
  const atStockCeiling = Number.isFinite(Number(item.stock)) && qty >= Number(item.stock);
  const unavailable = item.available === false || Number(item.stock) < qty;

  // Reset the draft whenever the row's own figure moves under it — a write
  // landing from the mini-cart in another tab, or the refetch after this row's
  // own commit. Without this the input keeps showing what was typed after the
  // server has already answered with something else.
  useEffect(() => { setDraft(null); }, [qty]);

  const write = async (next) => {
    if (next === qty) return;
    setBusy(true);
    try {
      await onQuantity(next);
    } catch (err) {
      // The API refuses impossible edits with a 400 whose message is the
      // useful part ("Not enough stock"). Swallowing it is what made the
      // button look broken; MiniCart has always toasted and this page never
      // did, which is the same one-path fix twice.
      toast.error(err?.message || 'Could not update that line');
    }
    setBusy(false);
  };

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = parseInt(draft, 10);
    setDraft(null);
    if (Number.isNaN(parsed) || parsed === qty) return;
    // Clamped here rather than sent and refused: the ceiling is on screen, so
    // typing 500 into a line with 12 in stock should land on 12 and say so,
    // not bounce back with an error and the old number.
    const ceiling = Number.isFinite(Number(item.stock)) ? Number(item.stock) : parsed;
    const next = Math.max(1, Math.min(parsed, ceiling));
    if (next !== parsed) toast(`Only ${ceiling} in stock — set to ${ceiling}.`);
    write(next);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await onRemove();
    } catch (err) {
      toast.error(err?.message || 'Could not remove that line');
      setBusy(false);
    }
    // No `setBusy(false)` on success: the row is about to unmount, and dropping
    // the flag first flashes the controls back to life on the way out.
  };

  return (
    <li
      className={`lrow cart-line${unavailable ? ' is-urgent' : ''}${busy ? ' is-busy' : ''}`}
      style={unavailable ? { '--lrow-tone': 'var(--danger)' } : undefined}
    >
      <Link
        to={`/products/${item.group_id}`}
        className="cart-line-media"
        tabIndex={-1}
        aria-hidden="true"
      >
        {item.image
          ? <img src={item.image} alt="" className="cart-line-img" loading="lazy" />
          : <span className="cart-line-img is-empty"><Package size={16} /></span>}
      </Link>

      <div className="lrow-stack cart-line-id">
        <Link to={`/products/${item.group_id}`} className="cart-line-name">
          {item.product_name}
        </Link>
        <small>{item.variant_name}</small>

        {/* Everything the row has to say about itself, in one strip below the
            name rather than spread across columns that would be empty on most
            rows. Order is by consequence: what blocks checkout first. */}
        {(unavailable || atStockCeiling || savedEach > 0 || item.tier_quantity > qty || change?.unitWas) && (
          <div className="cart-line-notes">
            {unavailable && (
              <span className="cart-note is-blocking">
                <AlertTriangle size={11} aria-hidden="true" />
                {item.available === false ? 'Off sale' : 'Out of stock'} · choose an option below
              </span>
            )}
            {savedEach > 0 && (
              <span className="cart-note is-saving">
                <TrendingDown size={11} aria-hidden="true" />
                {money(savedEach * qty)} off — was {money(base)} each
              </span>
            )}
            {/* Shown only while the break was won by pooling with same-priced
                siblings of the same product, so a two-unit line priced at a
                five-unit break does not look like it has miscounted. */}
            {item.tier_quantity > qty && (
              <span className="cart-note">
                <Layers size={11} aria-hidden="true" />
                priced at {item.tier_quantity} across this product
              </span>
            )}
            {atStockCeiling && !unavailable && (
              <span className="cart-note is-ceiling">
                All {item.stock} in stock are in your cart
              </span>
            )}
            {/* The unit price moved on the last write. Said out loud because
                the subtotal then changed by something other than one unit's
                worth, and a figure that moves by an unexplained amount on a
                money screen reads as a fault. */}
            {change?.unitWas != null && (
              <span className={`cart-note is-shift ${change.dir === 'down' ? 'is-saving' : ''}`}>
                {change.dir === 'down' ? 'Volume break' : 'Price step'} — now {money(unit)} each,
                {' '}was {money(change.unitWas)}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="lrow-num cart-line-unit">
        {savedEach > 0 && <s className="cart-line-was">{money(base)}</s>}
        <span>{money(unit)}</span>
        <small>each</small>
      </div>

      {/* Not a `.lrow-actions`: the stepper is the reason this page exists, so
          it is never hover-revealed. Only the bin is (below). */}
      <div className="cart-line-qty">
        <div className="qty-stepper is-editable">
          <button
            type="button"
            onClick={() => write(qty - 1)}
            disabled={busy || qty <= 1}
            aria-label={`One fewer ${item.product_name}`}
          >
            <Minus size={13} />
          </button>
          <input
            ref={inputRef}
            className="qty-value"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={draft ?? String(qty)}
            disabled={busy}
            aria-label={`Quantity of ${item.product_name}`}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
            onFocus={(e) => e.target.select()}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); inputRef.current?.blur(); }
              // Escape abandons the edit rather than committing it — the same
              // contract every other text field on the site keeps.
              if (e.key === 'Escape') { setDraft(null); inputRef.current?.blur(); }
            }}
          />
          <button
            type="button"
            onClick={() => write(qty + 1)}
            disabled={busy || atStockCeiling}
            aria-label={
              atStockCeiling
                ? `No more ${item.product_name} in stock`
                : `One more ${item.product_name}`
            }
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className={`lrow-num cart-line-total${change ? ' is-reckoned' : ''}`}>
        {money(lineTotal)}
      </div>

      {/* The one secondary control, so it is the one thing on hover — and an
          unavailable line keeps its bin visible at all times, because removing
          it is the only way that buyer reaches checkout at all (§4: never hide
          the only path to an action). */}
      <div className={`lrow-actions cart-line-actions${unavailable ? ' is-pinned' : ''}`}>
        <button
          type="button"
          className="cart-line-remove"
          onClick={remove}
          disabled={busy}
          aria-label={`Remove ${item.product_name} — ${item.variant_name} from your cart`}
        >
          <Trash2 size={14} />
        </button>
      </div>
      {unavailable && <CartRecovery item={item} />}
    </li>
  );
}
