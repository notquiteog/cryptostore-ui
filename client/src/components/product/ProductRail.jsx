import { Link } from 'react-router-dom';
import { Package } from 'lucide-react';
import { groupDisplayPrice } from '../../utils/pricing';
import { productInStock, productThumb } from '../../utils/catalog';

/** Flatten a live product group into the shape the rail renders. */
export function toRailItem(product) {
  const pricing = groupDisplayPrice(product);
  return {
    id: product.id,
    name: product.name,
    category: product.category || null,
    thumb: productThumb(product),
    price: pricing.effective,
    listPrice: pricing.list,
    onSale: pricing.onSale,
    variantCount: product.variants?.length || 0,
    stocked: productInStock(product),
  };
}

/**
 * A horizontal shelf of product cards — used for "related" and "recently
 * viewed".
 *
 * A scroll-snap rail rather than a wrapping grid: both shelves are secondary to
 * the product being looked at, and a grid of eight would push the reviews off
 * the bottom of a phone. Renders nothing when empty, so a caller can mount it
 * unconditionally.
 *
 * Items arrive pre-flattened (see `toRailItem`) because the two callers do not
 * hold the same thing. Related products come from a live fetch and can quote a
 * price; recently-viewed comes from `localStorage`, where a price would be a
 * remembered one — and a stale number beside a live product is exactly the
 * disagreement the shared pricing helpers exist to prevent. Those cards carry
 * `price: null` and print no figure at all.
 */
export default function ProductRail({ title, icon = null, items = [], moreHref = null, moreLabel = 'See all' }) {
  if (!items || items.length === 0) return null;

  return (
    <section className="pd-section pd-rail-section" data-reveal>
      <header className="pd-section-head">
        <h2>{icon}{title}</h2>
        {moreHref && <Link to={moreHref} className="pd-section-more">{moreLabel}</Link>}
      </header>

      <div className="pd-rail">
        {items.map(item => (
          <Link key={item.id} to={`/products/${item.id}`} className="pd-rail-card">
            <span
              className="pd-rail-img"
              style={item.thumb ? { backgroundImage: `url(${item.thumb})` } : undefined}
            >
              {!item.thumb && <Package size={22} aria-hidden="true" />}
              {item.stocked === false && <span className="pd-rail-oos">Sold out</span>}
            </span>
            <span className="pd-rail-body">
              {item.category && <span className="pd-rail-cat">{item.category}</span>}
              <span className="pd-rail-name">{item.name}</span>
              {item.price != null && (
                <span className="pd-rail-price">
                  {item.variantCount > 1 && <em>from</em>}
                  <b className={item.onSale ? 'sale' : undefined}>${item.price.toFixed(2)}</b>
                  {item.onSale && <s>${item.listPrice.toFixed(2)}</s>}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
