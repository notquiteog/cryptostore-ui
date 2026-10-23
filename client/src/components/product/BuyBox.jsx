import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell, BellRing, Check, Flame, Heart, Layers, LogIn, Minus, Plus, ShoppingCart, Timer,
  TrendingDown, Truck,
} from 'lucide-react';
import { discountPct, effectiveUnitPrice, listUnitPrice, qualifyingTier } from '../../utils/pricing';
import { shippingCostFor } from '../../utils/shipping';
import useCountdown from '../../hooks/useCountdown';

const money = n => `$${Number(n || 0).toFixed(2)}`;
const pad = n => String(n).padStart(2, '0');

/** The volume-tier ladder, plus the break on either side of where the buyer is. */
function useTiers(variant, quantity, unit, list) {
  return useMemo(() => {
    // Labels are free text — this catalog holds both "3" and "3x" — so two rows
    // can describe the same break. Only the cheaper of them can ever be charged
    // (qualifyingTier breaks a tie that way), so the dearer one is collapsed
    // away rather than printed as a second, unreachable "3+" step. It also
    // keeps `minQty` usable as a React key, which a duplicate row breaks.
    const byQty = new Map();
    for (const t of variant?.tiers || []) {
      const minQty = parseInt(t.min_qty_label, 10);
      const price = Number(t.price);
      if (!Number.isFinite(minQty) || minQty < 1 || !Number.isFinite(price)) continue;
      const seen = byQty.get(minQty);
      if (!seen || price < seen.price) byQty.set(minQty, { minQty, price });
    }
    const rows = [...byQty.values()].sort((a, b) => a.minQty - b.minQty);

    // The band the buyer is in comes from the shared selector, so the rung that
    // lights up is by construction the rung being charged — the two cannot
    // drift the way they did when this file picked its own. It still has to
    // agree with `unit` before it is called applied: a flash sale can undercut
    // the band, and highlighting it then would claim a break the total does not
    // contain.
    const band = qualifyingTier(variant, quantity);
    const applied = band && band.price <= unit + 1e-9
      ? rows.find(t => t.minQty === band.minQty) || null
      : null;

    // A ladder may climb, so the next break is not automatically an upsell.
    // `next` is the one worth nudging toward; `dearer` is the one the buyer
    // should be warned about before the + button walks them into it.
    const upcoming = rows.find(t => t.minQty > quantity) || null;
    const next = upcoming && upcoming.price < unit ? upcoming : null;
    const dearer = upcoming && upcoming.price > unit + 1e-9 ? upcoming : null;

    // Whether this ladder is a discount ladder at all. One rung above the list
    // price makes "Volume pricing ↘" a claim the prices do not support.
    const discountsOnly = rows.every(t => t.price <= list + 1e-9);
    return { rows, applied, next, dearer, discountsOnly };
  }, [variant, quantity, unit, list]);
}

export default function BuyBox({
  variant,
  quantity,
  // Units counting toward the volume break, which is not the same number as
  // `quantity`: breaks pool across a product's same-priced variants, so three
  // of this one plus two of its sibling reach the 5+ band. `quantity` stays the
  // amount of THIS line — what gets multiplied, added and saved.
  tierQuantity = quantity,
  // What the cart already holds for this variant, so the button can say whether
  // pressing it adds a line or edits one.
  inCartQuantity = 0,
  // Takes a number or an updater, exactly as React's own setter does. The ±
  // buttons use the updater form so two clicks batched into one tick still
  // count twice, rather than both reading the same render's `quantity` and
  // landing on the same result.
  onQuantity,
  onAddToCart,
  adding,
  user,
  wishlisted,
  onToggleWishlist,
  restockAlerted,
  onToggleRestock,
  priceWatched = false,
  onTogglePriceWatch,
  settings = {},
  lowStockThreshold = 5,
}) {
  const list = listUnitPrice(variant);
  const pooled = Math.max(Number(tierQuantity) || 0, quantity);
  const unit = effectiveUnitPrice(variant, pooled);
  const off = discountPct(list, unit);
  const savedTotal = Math.max(0, (list - unit) * quantity);
  const soldOut = !variant || variant.quantity === 0;
  const low = !soldOut && variant.quantity <= lowStockThreshold;
  const { rows: tiers, applied, next, dearer, discountsOnly } = useTiers(variant, pooled, unit, list);
  // Units the rest of the cart brings to this variant's break. Named because
  // every "how many more" sum below has to be answered in units of THIS line
  // while the ladder is read in pooled units.
  const fromSiblings = Math.max(0, pooled - quantity);
  const inCart = Number(inCartQuantity) || 0;
  const dirty = inCart > 0 && quantity !== inCart;
  // A band above the list price is not a saving, and the price row has no way
  // to say so on its own: `off` is 0 and the struck-through "was" is suppressed,
  // so the buyer sees a number larger than the shelf price with no reason given.
  const raised = applied && unit > list + 0.004;
  const countdown = useCountdown(variant?.sale_ends_at);
  const shipping = shippingCostFor(settings.shipping_tiers, quantity);

  // Remounting the figure restarts its CSS animation. Toggling a class instead
  // does nothing on a second change within the animation's own duration, which
  // is exactly the case that matters here — holding down the + button.
  const [priceKey, setPriceKey] = useState(0);
  const lastUnit = useRef(unit);
  useEffect(() => {
    if (lastUnit.current !== unit) {
      lastUnit.current = unit;
      setPriceKey(k => k + 1);
    }
  }, [unit]);

  const coins = [
    settings.btc_enabled === 'true' && { key: 'btc', glyph: '₿', label: 'Bitcoin' },
    settings.xmr_enabled === 'true' && { key: 'xmr', glyph: 'ɱ', label: 'Monero' },
    settings.ltc_enabled === 'true' && { key: 'ltc', glyph: 'Ł', label: 'Litecoin' },
    settings.zelle_enabled === 'true' && { key: 'zelle', glyph: 'Z', label: 'Zelle' },
    settings.cash_in_mail_enabled === 'true' && { key: 'cash', glyph: '✉', label: 'Cash in mail' },
  ].filter(Boolean);

  if (!variant) return null;

  const max = Math.max(1, variant.quantity);
  const clamp = q => Math.max(1, Math.min(max, q));

  return (
    <div className={`pd-buybox${off > 0 ? ' on-sale' : ''}`} data-reveal>
      <div className="pd-buybox-glow" aria-hidden="true" />

      {countdown && !countdown.expired && (
        <div className="pd-flash">
          <Flame size={13} className="pd-flash-icon" aria-hidden="true" />
          <span className="pd-flash-label">{variant.sale_label || 'Flash sale'}</span>
          <span className="pd-flash-timer">
            <Timer size={12} aria-hidden="true" />
            {countdown.days > 0 && <b>{countdown.days}d</b>}
            <b>{pad(countdown.hours)}</b>:<b>{pad(countdown.minutes)}</b>:<b>{pad(countdown.seconds)}</b>
          </span>
        </div>
      )}

      <div className="pd-price-row">
        <span key={priceKey} className="pd-price">{money(unit)}</span>
        {off > 0 && (
          <span className="pd-price-aside">
            <span className="pd-price-was">{money(list)}</span>
            <span className="pd-price-off">−{off}%</span>
          </span>
        )}
        <span className={`pd-stock-pill${soldOut ? ' oos' : low ? ' low' : ''}`}>
          <span className="pd-stock-dot" aria-hidden="true" />
          {soldOut ? 'Sold out' : low ? `Only ${variant.quantity} left` : 'In stock'}
        </span>
      </div>

      <div className="pd-price-notes">
        {quantity > 1 && <span>{money(unit)} each × {quantity}</span>}
        {savedTotal > 0.004 && <span className="save">You save {money(savedTotal)}</span>}
        {raised && <span className="band">{applied.minQty}+ band price · {money(list)} for a single</span>}
        {fromSiblings > 0 && (
          <span className="pool" title="Same-priced options of this product share one volume break.">
            counts as {pooled} across this product
          </span>
        )}
      </div>

      {tiers.length > 0 && (
        <div className="pd-tiers">
          <div className="pd-tiers-head">
            {discountsOnly
              ? <TrendingDown size={12} aria-hidden="true" />
              : <Layers size={12} aria-hidden="true" />}
            Volume pricing
          </div>
          <div className="pd-tier-rail">
            {tiers.map(t => {
              const isApplied = applied?.minQty === t.minQty;
              const reached = pooled >= t.minQty;
              return (
                <button
                  type="button"
                  key={t.minQty}
                  className={`pd-tier${isApplied ? ' applied' : ''}${isApplied && raised ? ' raised' : ''}${reached && !isApplied ? ' reached' : ''}`}
                  onClick={() => onQuantity(clamp(t.minQty - fromSiblings))}
                  disabled={t.minQty - fromSiblings > max}
                  title={t.minQty - fromSiblings > max
                    ? `Needs ${t.minQty - fromSiblings} more — only ${max} in stock`
                    : `Buy ${t.minQty} at ${money(t.price)} each`}
                >
                  <span className="pd-tier-qty">{t.minQty}+</span>
                  <span className="pd-tier-price">{money(t.price)}</span>
                  {isApplied && <Check size={11} className="pd-tier-check" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          {next && next.minQty - fromSiblings <= max && (
            <button
              type="button"
              className="pd-tier-nudge"
              onClick={() => onQuantity(clamp(next.minQty - fromSiblings))}
            >
              Add {next.minQty - pooled} more → {money(next.price)} each,
              {' '}save {money((unit - next.price) * next.minQty)} on {next.minQty}
            </button>
          )}
          {/* Said plainly rather than as a button: walking the buyer into a
              dearer band is not something to invite them to click. */}
          {!next && dearer && dearer.minQty - fromSiblings <= max && (
            <p className="pd-tier-caution">
              At {dearer.minQty} or more the price is {money(dearer.price)} each.
            </p>
          )}
        </div>
      )}

      {soldOut ? (
        <div className="pd-cta">
          {user ? (
            <button
              type="button"
              className={`glass-btn pd-add-btn${restockAlerted ? ' glass-btn-active' : ''}`}
              onClick={() => onToggleRestock(variant.id)}
              /* Restock alerts go out over push, Telegram and Potato — the
                 channels buyerNotify.notifyBuyerRestock actually uses. Not
                 email; the account does not carry one.

                 Pressing this again after an alert has been sent re-arms the
                 subscription rather than duplicating it, so a product that
                 sells out repeatedly is announced every time it returns. The
                 whole list, with what each one is waiting on, is on the
                 wishlist page. */
              title={restockAlerted
                ? 'Click to cancel. Alerts arrive by push notification and, if linked, Telegram or Potato.'
                : 'Alerts arrive by push notification and, if linked, Telegram or Potato.'}
            >
              {restockAlerted
                ? <><BellRing size={16} aria-hidden="true" /> Restock alert is on</>
                : <><Bell size={16} aria-hidden="true" /> Notify me when it's back</>}
            </button>
          ) : (
            <Link to="/login" className="glass-btn pd-add-btn">
              <LogIn size={16} aria-hidden="true" /> Sign in for a restock alert
            </Link>
          )}
        </div>
      ) : (
        <div className="pd-cta">
          <div className="pd-qty" role="group" aria-label="Quantity">
            <button
              type="button"
              className="pd-qty-btn"
              onClick={() => onQuantity(q => clamp(q - 1))}
              disabled={quantity <= 1}
              aria-label="Decrease quantity"
            >
              <Minus size={14} aria-hidden="true" />
            </button>
            <input
              type="number"
              className="pd-qty-input"
              value={quantity}
              min={1}
              max={max}
              aria-label="Quantity"
              onChange={e => onQuantity(clamp(parseInt(e.target.value, 10) || 1))}
            />
            <button
              type="button"
              className="pd-qty-btn"
              onClick={() => onQuantity(q => clamp(q + 1))}
              disabled={quantity >= max}
              aria-label="Increase quantity"
            >
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>

          {/* A guest has no cart to add to. Offering the real action and then
              refusing it reads as a broken button, so send them where they can
              actually buy. */}
          {user ? (
            <button
              type="button"
              onClick={onAddToCart}
              disabled={adding || (inCart > 0 && !dirty)}
              className="glass-btn glass-btn-primary pd-add-btn"
              title={inCart > 0 && !dirty
                ? `${inCart} already in your cart — change the quantity to update it`
                : undefined}
            >
              {adding
                ? <span className="spinner" style={{ width: 15, height: 15 }} />
                : inCart > 0
                  ? <><Check size={16} aria-hidden="true" /> {dirty ? 'Update cart' : `${inCart} in cart`}</>
                  : <><ShoppingCart size={16} aria-hidden="true" /> Add to cart</>}
              <span className="pd-add-total">{money(unit * quantity)}</span>
            </button>
          ) : (
            <Link to="/login" className="glass-btn glass-btn-primary pd-add-btn">
              <LogIn size={16} aria-hidden="true" /> Sign in to buy
              <span className="pd-add-total">{money(unit * quantity)}</span>
            </Link>
          )}

          <button
            type="button"
            className={`pd-wish-btn${wishlisted ? ' on' : ''}`}
            onClick={() => onToggleWishlist(variant.id)}
            aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
            title={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
          >
            <Heart size={16} fill={wishlisted ? 'currentColor' : 'none'} aria-hidden="true" />
          </button>

          {/* The price watch: "tell me when this gets cheaper than it is for
              me today". Beside the heart because it is the heart's sibling —
              a wishlist remembers the thing, a watch remembers the price.
              Signed-out visitors get nothing here rather than a button that
              refuses: the heart already sends them to sign in. Alerts go the
              way restock alerts go — push, Telegram, Potato — never email. */}
          {user && onTogglePriceWatch && (
            <button
              type="button"
              className={`pd-wish-btn pd-watch-btn${priceWatched ? ' on' : ''}`}
              onClick={() => onTogglePriceWatch(variant.id)}
              aria-pressed={priceWatched}
              aria-label={priceWatched ? 'Stop watching the price' : `Watch the price — tell me if it drops below ${money(unit)}`}
              title={priceWatched
                ? 'Watching the price. Click to stop.'
                : `Tell me if this drops below ${money(unit)} — by push and, if linked, Telegram or Potato`}
            >
              <TrendingDown size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      <div className="pd-assurance">
        <span title="Checkout charges shipping on the whole cart, so ordering alongside other items may change this.">
          <Truck size={12} aria-hidden="true" />
          {shipping > 0 ? `${money(shipping)} shipping at this quantity` : 'Free shipping at this quantity'}
        </span>
        {coins.length > 0 && (
          <span className="pd-coins">
            {coins.map(c => (
              /* `.coin-glyph` carries the per-coin hues, including the darkened
                 light-mode set solved against a white card — worth inheriting
                 rather than restating three hex values here. */
              <span key={c.key} className={`pd-coin coin-glyph is-${c.key}`} title={c.label} aria-label={c.label}>{c.glyph}</span>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
