import { useMemo, useState } from 'react';
import { Bell, BellRing, Eye, EyeOff, Heart, Layers } from 'lucide-react';
import { effectiveUnitPrice } from '../../utils/pricing';

/**
 * The variant list.
 *
 * Rows are focusable `div`s rather than `button`s: each one carries its own
 * wishlist and restock-alert controls, and a button inside a button is invalid
 * markup that React reports as a hydration error. `role="radio"` describes what
 * the list actually is — one choice out of several — which a bare clickable div
 * does not.
 */
export default function VariantPicker({
  variants = [],
  selected,
  onSelect,
  user,
  wishlistIds,
  onToggleWishlist,
  restockSubs,
  onToggleRestock,
  lowStockThreshold = 5,
}) {
  const [showOOS, setShowOOS] = useState(false);

  const { inStock, oos } = useMemo(() => ({
    inStock: variants.filter(v => v.quantity > 0),
    oos: variants.filter(v => v.quantity === 0),
  }), [variants]);

  // A product whose every variant is sold out would otherwise render an empty
  // panel with a "+3 OOS" button as the only hint that anything exists.
  const visible = showOOS || inStock.length === 0 ? variants : inStock;

  if (variants.length === 0) return null;

  return (
    <div className="pd-variants" data-reveal>
      <div className="pd-variants-head">
        <Layers size={13} aria-hidden="true" />
        <span>{variants.length === 1 ? 'Variant' : `Choose a variant · ${variants.length}`}</span>
        {oos.length > 0 && inStock.length > 0 && (
          <button
            type="button"
            className="pd-oos-toggle"
            onClick={() => setShowOOS(v => !v)}
            aria-pressed={showOOS}
          >
            {showOOS ? <EyeOff size={11} aria-hidden="true" /> : <Eye size={11} aria-hidden="true" />}
            {showOOS ? 'Hide sold out' : `${oos.length} sold out`}
          </button>
        )}
      </div>

      <div className="pd-variant-list" role="radiogroup" aria-label="Variant">
        {visible.map(v => {
          const active = selected?.id === v.id;
          const soldOut = v.quantity === 0;
          const low = !soldOut && v.quantity <= lowStockThreshold;
          const list = Number(v.price) || 0;
          const unit = effectiveUnitPrice(v, 1);
          const onSale = unit < list;
          const saved = wishlistIds?.has(v.id);
          const alerted = restockSubs?.has(v.id);

          return (
            <div
              key={v.id}
              role="radio"
              tabIndex={active || (!selected && v === visible[0]) ? 0 : -1}
              aria-checked={active}
              onClick={() => onSelect(v)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                onSelect(v);
              }}
              className={`pd-variant${active ? ' active' : ''}${soldOut ? ' oos' : ''}`}
            >
              <span className="pd-variant-mark" aria-hidden="true" />

              <div className="pd-variant-main">
                <span className="pd-variant-name">{v.name}</span>
                <span className={`pd-avail${soldOut ? ' oos' : low ? ' low' : ''}`}>
                  <span className="pd-avail-bars" aria-hidden="true">
                    <i /><i /><i />
                  </span>
                  {soldOut ? 'Sold out' : low ? `Only ${v.quantity} left` : `${v.quantity} in stock`}
                </span>
              </div>

              <div className="pd-variant-price">
                {onSale && <span className="was">${list.toFixed(2)}</span>}
                <span className={onSale ? 'now sale' : 'now'}>${unit.toFixed(2)}</span>
                {v.sale_label && onSale && <span className="pd-sale-tag">{v.sale_label}</span>}
              </div>

              <div className="pd-variant-actions">
                <button
                  type="button"
                  className={`pd-icon-btn${saved ? ' on' : ''}`}
                  onClick={e => { e.stopPropagation(); onToggleWishlist(v.id); }}
                  aria-label={saved ? `Remove ${v.name} from wishlist` : `Save ${v.name} to wishlist`}
                  title={saved ? 'Remove from wishlist' : 'Save to wishlist'}
                >
                  <Heart size={14} fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
                </button>
                {soldOut && user && (
                  <button
                    type="button"
                    className={`pd-icon-btn${alerted ? ' alerted' : ''}`}
                    onClick={e => { e.stopPropagation(); onToggleRestock(v.id); }}
                    aria-label={alerted ? `Cancel restock alert for ${v.name}` : `Alert me when ${v.name} is back`}
                    title={alerted ? 'Restock alert on — click to cancel' : 'Alert me when this is back'}
                  >
                    {alerted
                      ? <BellRing size={14} aria-hidden="true" />
                      : <Bell size={14} aria-hidden="true" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
