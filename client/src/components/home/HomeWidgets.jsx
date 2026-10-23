import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Zap, Star, PackageCheck, Layers, ArrowRight, Grid2x2, Sparkles, Truck } from 'lucide-react';
import { api } from '../../utils/api';
import { productStock, productThumb } from '../../utils/catalog';
import { groupDisplayPrice } from '../../utils/pricing';
import { formatRemaining } from '../../utils/time';
import { orderBadge } from '../NavMenus';
import StarRating from '../StarRating';

/**
 * The home widget rail: dense, glanceable, honest. Every number here is read
 * from data the page already holds or one cheap public endpoint — nothing is
 * invented, and a widget with nothing true to say renders nothing rather than
 * padding the page (an empty "drops" card is an ad for a sale that does not
 * exist).
 */

/** Ticks once a second while `active`; shared clock for the rail. */
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

// ─── Drop clock ──────────────────────────────────────────────────────────────

const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The soonest-ending live flash sale, with a clock face. The ring drains over
 * the sale's final 24 hours — before that it sits full, which reads correctly
 * as "no urgency yet" — and the exact remaining time is always printed beside
 * it, so the ring is presentation and the text is the truth.
 */
export function DropClock({ sales }) {
  const now = useNow(sales.length > 0);
  const live = useMemo(
    () => sales
      .filter((s) => new Date(s.ends_at).getTime() > now)
      .sort((a, b) => new Date(a.ends_at) - new Date(b.ends_at)),
    [sales, now],
  );
  if (live.length === 0) return null;

  const sale = live[0];
  const remaining = new Date(sale.ends_at).getTime() - now;
  const frac = Math.max(0, Math.min(1, remaining / 86400_000));
  const ending = remaining < 3600_000;
  const off = Math.round((1 - Number(sale.sale_price) / Number(sale.price)) * 100);

  return (
    <Link to={`/products/${sale.group_id}`} className="glass-card home-widget drop-clock">
      <div className="home-widget-label">
        <Zap size={12} fill="currentColor" /> Drop ends in
      </div>
      <div className="drop-clock-body">
        <div className={`drop-clock-ring${ending ? ' ending' : ''}`} aria-hidden="true">
          <svg viewBox="0 0 60 60" width="60" height="60">
            <circle className="drop-ring-track" cx="30" cy="30" r={RING_R} />
            <circle
              className="drop-ring-fill"
              cx="30"
              cy="30"
              r={RING_R}
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - frac)}
            />
          </svg>
          <span className="drop-clock-time">{formatRemaining(remaining)}</span>
        </div>
        <div className="drop-clock-info">
          <span className="drop-clock-name">{sale.group_name}</span>
          <span className="drop-clock-prices">
            <s>${Number(sale.price).toFixed(2)}</s>
            <strong>${Number(sale.sale_price).toFixed(2)}</strong>
            {off > 0 && <em>-{off}%</em>}
          </span>
          {live.length > 1 && (
            <span className="drop-clock-more">+{live.length - 1} more live</span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ─── Store pulse ─────────────────────────────────────────────────────────────

/**
 * Compact counters over the featured shelf and payment rails. Scoped labels on
 * purpose: "on this shelf" is measured from the featured payload, and claiming
 * store-wide totals from it would be a lie the first time an operator checked.
 */
export function StorePulse({ products, sales, settings }) {
  const units = products.reduce(
    (sum, p) => sum + productStock(p),
    0,
  );
  const rated = products.filter((p) => p.review_count > 0);
  const best = rated.length
    ? rated.reduce((a, b) => (Number(b.average_rating) > Number(a.average_rating) ? b : a))
    : null;
  const rails = [
    settings.btc_enabled === 'true' && { glyph: '₿', label: 'Bitcoin', cls: 'is-btc' },
    settings.xmr_enabled === 'true' && { glyph: 'ɱ', label: 'Monero', cls: 'is-xmr' },
    settings.ltc_enabled === 'true' && { glyph: 'Ł', label: 'Litecoin', cls: 'is-ltc' },
    settings.cash_in_mail_enabled === 'true' && { glyph: '✉', label: 'Cash in mail', cls: 'is-cash' },
  ].filter(Boolean);

  if (products.length === 0) return null;

  return (
    <div className="glass-card home-widget store-pulse">
      <div className="home-widget-label">
        <PackageCheck size={12} /> On this shelf
      </div>
      <dl className="pulse-grid">
        <div className="pulse-cell">
          <dt>Featured</dt>
          <dd>{products.length}</dd>
        </div>
        <div className="pulse-cell">
          <dt>Units ready</dt>
          <dd>{units.toLocaleString()}</dd>
        </div>
        {sales.length > 0 && (
          <div className="pulse-cell">
            <dt>Live drops</dt>
            <dd className="pulse-hot">{sales.length}</dd>
          </div>
        )}
        {best && (
          <div className="pulse-cell">
            <dt>Top rated</dt>
            <dd className="pulse-star">
              <Star size={11} fill="currentColor" /> {Number(best.average_rating).toFixed(1)}
            </dd>
          </div>
        )}
      </dl>
      {rails.length > 0 && (
        <div className="pulse-rails" aria-label="Accepted payments">
          {rails.map((r) => (
            <span key={r.label} className={`pulse-rail ${r.cls}`} title={r.label}>{r.glyph}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Your latest order ───────────────────────────────────────────────────────

const ORDER_STEPS = ['pending', 'paid', 'accepted', 'shipped', 'delivered'];

/**
 * The signed-in buyer's most recent order, with a five-dot lifecycle track.
 * The single most useful thing a returning buyer wants from the home page is
 * "where is my stuff" — one glance here instead of a navigation. Renders
 * nothing for guests, buyers with no orders, or while the fetch is out (a
 * skeleton for a widget that may end up not existing would flash for
 * everyone).
 */
export function LatestOrderWidget({ user }) {
  const [orders, setOrders] = useState(null);

  useEffect(() => {
    if (!user) { setOrders(null); return; }
    let alive = true;
    // Paginated shape: {orders, total, ...} — one row is all this needs.
    api.get('/orders?limit=1')
      .then((data) => { if (alive) setOrders(data?.orders || []); })
      .catch(() => { if (alive) setOrders([]); });
    return () => { alive = false; };
  }, [user]);

  const latest = orders?.[0];
  if (!latest) return null;

  const step = ORDER_STEPS.indexOf(latest.status);
  const terminal = ['cancelled', 'refunded', 'disputed'].includes(latest.status);

  return (
    <Link to={`/orders/${latest.uuid || latest.id}`} className="glass-card home-widget latest-order">
      <div className="home-widget-label"><Truck size={12} /> Your latest order</div>
      <div className="latest-order-row">
        <span className="latest-order-id">#{latest.id}</span>
        <span className={`badge ${orderBadge(latest.status)}`}>{latest.status}</span>
        <span className="latest-order-total">${Number(latest.total).toFixed(2)}</span>
      </div>
      {/* Whose move it is — the server's own answer (utils/orderNextAction),
          the same one the order page and the list draw. A widget that says
          "accepted" answers "where is my stuff" with a word; this answers it
          with the thing that is actually happening. The whole card is the
          link, so this is a line rather than a second one. */}
      {latest.next_action && latest.next_action.actor !== 'none' && (
        <div className={`latest-order-next${latest.next_action.actor === 'viewer' ? ' is-yours' : ''}`} title={latest.next_action.reason}>
          <span className="latest-order-next-who">
            {latest.next_action.actor === 'viewer' ? 'Your move' : latest.next_action.responsibility}
          </span>
          {latest.next_action.label}
        </div>
      )}
      {!terminal && step >= 0 && (
        <div className="latest-order-track" role="img" aria-label={`Order progress: ${latest.status}`}>
          {ORDER_STEPS.map((s, i) => (
            <span key={s} className={`latest-order-dot${i <= step ? ' on' : ''}`} title={s} />
          ))}
        </div>
      )}
    </Link>
  );
}

// ─── Mini product lists: fresh drops & top rated ─────────────────────────────

function MiniProductRow({ product }) {
  const thumb = productThumb(product);
  let price = null;
  try {
    const p = groupDisplayPrice(product);
    if (Number.isFinite(p?.effective)) price = p.effective;
  } catch { /* a list row without variants simply shows no price */ }
  return (
    <Link to={`/products/${product.id}`} className="mini-prod-row">
      {thumb
        ? <span className="mini-prod-thumb" style={{ backgroundImage: `url(${thumb})` }} aria-hidden="true" />
        : <span className="mini-prod-thumb mini-prod-thumb-empty" aria-hidden="true"><Grid2x2 size={14} /></span>}
      <span className="mini-prod-main">
        <span className="mini-prod-name">{product.name}</span>
        {product.review_count > 0 && (
          <span className="mini-prod-rating">
            <StarRating rating={Math.round(product.average_rating || 0)} size={10} />
            <span>({product.review_count})</span>
          </span>
        )}
      </span>
      {price != null && <span className="mini-prod-price">${price.toFixed(2)}</span>}
    </Link>
  );
}

/** Newest three products store-wide, straight from the catalog's own sort. */
export function FreshDrops() {
  const [products, setProducts] = useState([]);
  useEffect(() => {
    api.get('/products?sort=newest&limit=3')
      .then((data) => setProducts(data?.products || []))
      .catch(() => {});
  }, []);
  if (products.length === 0) return null;
  return (
    <div className="glass-card home-widget mini-prod-widget">
      <div className="home-widget-label"><Sparkles size={12} /> Fresh on the shelf</div>
      <div className="mini-prod-list">
        {products.map((p) => <MiniProductRow key={p.id} product={p} />)}
      </div>
    </div>
  );
}

/** The three best-reviewed featured products; no fetch, no invented data. */
export function TopRated({ products }) {
  const top = useMemo(
    () => products
      .filter((p) => p.review_count > 0)
      .sort((a, b) => Number(b.average_rating) - Number(a.average_rating) || b.review_count - a.review_count)
      .slice(0, 3),
    [products],
  );
  if (top.length === 0) return null;
  return (
    <div className="glass-card home-widget mini-prod-widget">
      <div className="home-widget-label"><Star size={12} /> Buyers' favourites</div>
      <div className="mini-prod-list">
        {top.map((p) => <MiniProductRow key={p.id} product={p} />)}
      </div>
    </div>
  );
}

// ─── Category shelf ──────────────────────────────────────────────────────────

/**
 * Quick-nav tiles into the catalog, one per category, each with a
 * representative image.
 *
 * ── Where the picture comes from, and where it used to ─────────────────────
 *
 * The server picks one, per category, through the catalogue's own visibility
 * rules (`?thumbs=1` — see `getCategories`). It used to be BORROWED from
 * whatever `/products/featured` happened to return, which only worked when the
 * featured list happened to cover the category: on a shop with twelve
 * categories and ten featured products, Carts, Concentrates, Disposables and
 * Edibles all drew the grey placeholder while each had hundreds of products
 * with photographs. The media was never missing — nothing looked for it.
 *
 * The borrow is kept as a fallback rather than deleted. It costs nothing (the
 * featured products are already loaded for the rail above) and it covers the
 * one case the server query cannot: a category whose only imagery sits on a
 * product the shelf query skipped.
 *
 * Counts are still deliberately absent: the categories endpoint doesn't serve
 * them, and a number that is sometimes wrong is worse than no number.
 */
export function CategoryShelf({ products }) {
  const [categories, setCategories] = useState([]);
  const [serverThumbs, setServerThumbs] = useState(() => new Map());

  useEffect(() => {
    api.get('/products/categories?thumbs=1')
      .then((rows) => {
        const list = Array.isArray(rows) ? rows : [];
        // Tolerates both shapes on purpose. The flag is opt-in and this is the
        // only caller that sends it, but a plain list of strings is still a
        // valid answer from this endpoint and must not blank the shelf.
        setCategories(list.map((r) => (typeof r === 'string' ? r : r.category)).filter(Boolean));
        setServerThumbs(new Map(
          list.filter((r) => typeof r === 'object' && r?.category && r.thumb)
            .map((r) => [r.category, r.thumb]),
        ));
      })
      .catch(() => {});
  }, []);

  const thumbFor = useMemo(() => {
    const map = new Map();
    for (const p of products) {
      if (p.category && !map.has(p.category)) {
        const t = productThumb(p);
        if (t) map.set(p.category, t);
      }
    }
    return map;
  }, [products]);

  if (categories.length === 0) return null;

  const shown = categories.slice(0, 6);

  return (
    <div className="category-shelf">
      <div className="home-widget-label shelf-label">
        <Layers size={12} /> Browse the shelves
      </div>
      <div className="shelf-grid">
        {shown.map((cat, i) => {
          // Server first, then the featured borrow — see the header.
          const thumb = serverThumbs.get(cat) ?? thumbFor.get(cat);
          return (
            <Link
              key={cat}
              to={`/products?category=${encodeURIComponent(cat)}`}
              className="glass-card shelf-tile"
              style={{ '--stagger-i': i }}
            >
              {thumb
                ? <span className="shelf-thumb" style={{ backgroundImage: `url(${thumb})` }} aria-hidden="true" />
                : <span className="shelf-thumb shelf-thumb-empty" aria-hidden="true"><Grid2x2 size={16} /></span>}
              <span className="shelf-name">{cat}</span>
              <ArrowRight size={13} className="shelf-arrow" aria-hidden="true" />
            </Link>
          );
        })}
        <Link to="/products" className="glass-card shelf-tile shelf-tile-all">
          <span className="shelf-name">All products</span>
          <ArrowRight size={13} className="shelf-arrow" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
