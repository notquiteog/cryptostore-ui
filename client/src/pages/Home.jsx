import ProgressBar from '../components/ProgressBar';
import AttentionOrders from '../components/order/AttentionOrders';
import { Link } from 'react-router-dom';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { api } from '../utils/api';
import { groupDisplayPrice, discountPct } from '../utils/pricing';
import { productStock, productThumb } from '../utils/catalog';
import { plainText } from '../utils/text';
import StarRating from '../components/StarRating';
import {
  DropClock, StorePulse, CategoryShelf, LatestOrderWidget, FreshDrops, TopRated,
} from '../components/home/HomeWidgets';
import StorePromises from '../components/home/StorePromises';
import RecentReviews from '../components/home/RecentReviews';
import { formatRemaining } from '../utils/time';
import { ChevronLeft, ChevronRight, Heart, Zap, Clock, ArrowRight, Package } from 'lucide-react';
import toast from 'react-hot-toast';
import ForYouRail from '../components/home/ForYouRail';
import StorefrontIntro from '../components/home/StorefrontIntro';

/**
 * How many featured cards ride in the track, measured from the track's own
 * width rather than the window's. The two differ by the page gutter, and only
 * the track's width decides whether a card still has room to be legible.
 *
 * This was three fixed steps that stopped at 3, and the comment here defended
 * the ceiling by arithmetic: a slide spends 56px on its own gutter, a featured
 * card stops being legible under ~250px, so a fourth card needs 1224px of
 * track — and `.container` capped at 1200px, so 1224 was unreachable code.
 *
 * The premise was the cap, and the cap is gone. The home page is a shop
 * window, so it rides `--shell-wide` now; at 3840 the track is about 3100px,
 * where three cards meant three ~1030px-wide tiles each holding a thumbnail
 * floating in the middle of a billboard. A featured rail is a shelf, and a
 * shelf gains facings as it gets longer.
 *
 * So the count is derived from a target facing width instead of a ladder of
 * breakpoints that has to be extended every time a wider monitor appears.
 * 360px keeps a comfortable margin over the 250px legibility floor once the
 * slide's own 56px gutter is taken out. Capped at 8 because past that the
 * rail stops being a curated selection and becomes the catalog, which is one
 * click away under it.
 */
const FEATURED_FACING = 360;
function cardsForWidth(w) {
  if (w < 620) return 1;
  return Math.max(2, Math.min(8, Math.round(w / FEATURED_FACING)));
}

/** "BRAND: Nike" reads as "Nike" on a card; the grouping only matters to filters. */
function shortTag(tag) {
  for (const sep of [' = ', ': ', ':', ' - ']) {
    const i = tag.indexOf(sep);
    if (i > 0) return tag.slice(i + sep.length).trim();
  }
  return tag;
}

/** Ticks once a second, but only while something on screen needs a clock. */
function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduced;
}

// ─── Flash sale strip ────────────────────────────────────────────────────────

/**
 * `sales` arrives from the page, which fetches once for this strip AND the
 * rail's drop clock — two widgets, one request, one copy of the truth.
 */
function FlashStrip({ sales }) {
  const now = useNow(sales.length > 0);
  // Sales drop off the strip the moment they lapse, rather than sitting there
  // advertising a price the checkout will no longer honour.
  const live = useMemo(
    () => sales.filter(s => new Date(s.ends_at).getTime() > now),
    [sales, now]
  );

  if (live.length === 0) return null;

  return (
    <div className="container container-wide">
      <div className="glass-card flash-strip">
        <div className="flash-strip-label">
          <span className="flash-strip-bolt"><Zap size={14} fill="currentColor" /></span>
          Flash Sale
        </div>
        <div className="flash-strip-scroll">
          {live.map(sale => {
            const listPrice = Number(sale.price);
            const salePrice = Number(sale.sale_price);
            const off = discountPct(listPrice, salePrice);
            const remaining = new Date(sale.ends_at).getTime() - now;
            const ending = remaining < 3600_000;
            return (
              <Link key={sale.id} to={`/products/${sale.group_id}`} className="flash-strip-item">
                <span className="flash-strip-name">{sale.group_name}</span>
                <span className="flash-strip-prices">
                  <span className="flash-strip-was">${listPrice.toFixed(2)}</span>
                  <span className="flash-strip-now">${salePrice.toFixed(2)}</span>
                </span>
                {off > 0 && <span className="flash-strip-off">-{off}%</span>}
                <span className={`flash-strip-clock${ending ? ' ending' : ''}`}>
                  <Clock size={11} />
                  {formatRemaining(remaining)}
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Featured card ───────────────────────────────────────────────────────────

function FeaturedCard({ product, wishlisted, onToggleWishlist, canWishlist }) {
  const pricing = groupDisplayPrice(product);
  const variants = product.variants || [];
  const totalQty = productStock(product);
  const inStock = variants.some(v => v.quantity > 0);
  const off = discountPct(pricing.list, pricing.effective);
  const tags = (product.tags || []).slice(0, 3);
  const stockClass = !inStock ? 'oos' : totalQty <= 5 ? 'low' : '';

  // Shared with the catalog grid and the rails: a slot may be a video, and a
  // video's still is its poster frame, not its own path.
  const image = productThumb(product);

  return (
    <Link to={`/products/${product.id}`} className="glass-card fc-card" draggable={false}>
      <div className="fc-media">
        {image
          ? <div className="fc-media-img" style={{ backgroundImage: `url(${image})` }} />
          : <div className="fc-media-empty"><Package size={64} strokeWidth={0.9} aria-hidden="true" /></div>}

        <div className="fc-badges">
          {pricing.onSale && (
            <span className="fc-badge fc-badge-sale">
              {pricing.saleLabel || (off > 0 ? `-${off}%` : 'Sale')}
            </span>
          )}
          {product.featured_reason === 'bestseller'
            ? <span className="fc-badge fc-badge-best">Best seller</span>
            : <span className="fc-badge fc-badge-new">New</span>}
          {variants.length > 1 && (
            <span className="fc-badge fc-badge-variants">{variants.length} variants</span>
          )}
        </div>

        {canWishlist && variants[0] && (
          <button
            type="button"
            className={`fc-heart${wishlisted ? ' on' : ''}`}
            onClick={e => onToggleWishlist(e, variants[0].id)}
            aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
            title={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
          >
            <Heart size={15} fill={wishlisted ? 'currentColor' : 'none'} />
          </button>
        )}

        {!inStock && <div className="fc-oos"><span>Out of stock</span></div>}
      </div>

      <div className="fc-body">
        {product.category && <div className="fc-cat">{product.category}</div>}
        <div className="fc-name">{product.name}</div>

        {product.review_count > 0 && (
          <div className="fc-rating">
            <StarRating rating={Math.round(product.average_rating || 0)} size={12} />
            <span className="fc-rating-score">{Number(product.average_rating).toFixed(1)}</span>
            <span>({product.review_count})</span>
          </div>
        )}

        {product.description && <div className="fc-desc">{plainText(product.description)}</div>}

        {tags.length > 0 && (
          <div className="fc-tags">
            {tags.map(t => <span key={t} className="fc-tag">{shortTag(t)}</span>)}
          </div>
        )}

        <div className="fc-foot">
          <div className="fc-price-block">
            <div className="fc-price-row">
              {variants.length > 1 && <span className="fc-price-from">From</span>}
              <span className={`fc-price${pricing.onSale ? ' on-sale' : ''}`}>
                ${pricing.effective.toFixed(2)}
              </span>
              {pricing.onSale && <span className="fc-price-was">${pricing.list.toFixed(2)}</span>}
            </div>
            <div className={`fc-stock ${stockClass}`}>
              <span className="fc-stock-dot" />
              {inStock ? `${totalQty} ${product.breakdown_enabled ? 'base units' : 'in stock'}` : 'Out of stock'}
            </div>
          </div>
          <span className="fc-cta">View <ArrowRight size={12} /></span>
        </div>
      </div>
    </Link>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home() {
  const { settings } = useTheme();
  const FeaturedHeading = settings.home_welcome_enabled === 'false' ? 'h1' : 'h2';
  const { user } = useAuth();
  const reducedMotion = usePrefersReducedMotion();

  const [products, setProducts] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [wishlistIds, setWishlistIds] = useState(new Set());

  useEffect(() => {
    api.get('/flash-sales/active')
      .then(data => setSales(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Seeded from the window so the first render is close, then corrected by the
  // observer below from the real measurement — which lands before paint, so the
  // estimate never reaches the screen.
  const [perView, setPerView] = useState(() => cardsForWidth(typeof window === 'undefined' ? 1280 : window.innerWidth));
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);

  const touchStartX = useRef(null);

  useEffect(() => {
    api.get('/products/featured')
      .then(data => {
        const list = Array.isArray(data) ? data : [];
        setProducts(list);
        // The payload already says what this viewer has saved, so the heart
        // renders correctly on first paint without a second round trip.
        setWishlistIds(new Set(
          list.flatMap(p => (p.variants || []).filter(v => v.wishlisted).map(v => v.id))
        ));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user]);

  // A ResizeObserver rather than a window 'resize' listener: the track can also
  // change width without the window doing anything (the admin drawer, a
  // scrollbar appearing, a zoom change), and those left the card count stale.
  const observerRef = useRef(null);
  const attachViewport = useCallback((node) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const ro = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect?.width;
      if (width > 0) setPerView(cardsForWidth(width));
    });
    ro.observe(node);
    observerRef.current = ro;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  const total = products.length;
  const maxIndex = Math.max(0, total - perView);

  // A narrowing window can strand the track past its last page.
  useEffect(() => {
    setCurrent(c => Math.min(c, maxIndex));
  }, [maxIndex]);

  const goTo = useCallback((idx) => {
    setCurrent(Math.min(Math.max(idx, 0), maxIndex));
  }, [maxIndex]);

  const next = useCallback(() => {
    setCurrent(c => (c >= maxIndex ? 0 : c + 1));
  }, [maxIndex]);

  const prev = useCallback(() => {
    setCurrent(c => (c <= 0 ? maxIndex : c - 1));
  }, [maxIndex]);

  // Auto-advance. `current` is a dependency so any manual move — arrow, dot,
  // swipe or key — restarts the dwell rather than cutting it short.
  useEffect(() => {
    if (paused || reducedMotion || maxIndex === 0) return undefined;
    const t = setTimeout(next, 5000);
    return () => clearTimeout(t);
  }, [current, paused, reducedMotion, maxIndex, next]);

  const toggleWishlist = async (e, variantId) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) return toast.error('Sign in to save items to your wishlist');
    if (wishlistIds.has(variantId)) {
      setWishlistIds(prev => { const s = new Set(prev); s.delete(variantId); return s; });
      api.delete('/wishlist/' + variantId).catch(() => {});
    } else {
      setWishlistIds(prev => new Set([...prev, variantId]));
      api.post('/wishlist', { variant_id: variantId }).catch(() => {});
    }
  };

  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 40) return;
    if (dx < 0) next(); else prev();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
  };

  return (
    <div className="page storefront-home">
      {/* No padding of its own: `.page` already places the first thing on the
          page where every other page places it, and the extra 1.5rem here made
          the home page the one screen that started lower than the rest. */}
      <AttentionOrders />
      <StorefrontIntro settings={settings} products={products} loading={loading} user={user} />
      <section>
        <FlashStrip sales={sales} />

        <div className="container container-wide">
          <div className="fc-head" id="featured-products">
            <div><span className="store-eyebrow">The curated edit</span><FeaturedHeading className="section-title" style={{ margin: 0 }}>Featured products</FeaturedHeading></div>
            <Link to="/products" className="store-text-action">View the collection <ArrowRight size={15} aria-hidden="true" /></Link>
          </div>

          {loading ? (
            <div className="loading-page" style={{ minHeight: '40vh' }}>
              <ProgressBar label="Loading products…" />
            </div>
          ) : total === 0 ? (
            <div style={{ paddingBottom: 'var(--sp-12)' }}>
              <div className="empty-state">
                <h3>No products yet</h3>
                <p>Check back soon.</p>
              </div>
            </div>
          ) : (
            <>
            <div
              className="fc-stage"
              style={{ position: 'relative' }}
              onMouseEnter={() => setPaused(true)}
              onMouseLeave={() => setPaused(false)}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
            >
              <div
                ref={attachViewport}
                className="fc-viewport"
                role="region"
                aria-roledescription="carousel"
                aria-label="Featured products"
                tabIndex={0}
                onKeyDown={handleKeyDown}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                <div
                  className="fc-track"
                  style={{ transform: `translateX(-${current * (100 / perView)}%)` }}
                >
                  {products.map((product, i) => (
                    <div
                      key={product.id}
                      className="fc-slide"
                      style={{ width: `${100 / perView}%` }}
                      role="group"
                      aria-roledescription="slide"
                      aria-label={`${i + 1} of ${total}`}
                      aria-hidden={i < current || i >= current + perView}
                      inert={i < current || i >= current + perView}
                    >
                      <FeaturedCard
                        product={product}
                        canWishlist={!!user}
                        wishlisted={wishlistIds.has(product.variants?.[0]?.id)}
                        onToggleWishlist={toggleWishlist}
                      />
                    </div>
                  ))}
                </div>
              </div>

              {maxIndex > 0 && (
                <>
                  <button className="fc-nav fc-nav-prev" onClick={prev} aria-label="Previous products">
                    <ChevronLeft size={18} />
                  </button>
                  <button className="fc-nav fc-nav-next" onClick={next} aria-label="Next products">
                    <ChevronRight size={18} />
                  </button>

                  <div className="fc-dots">
                    {Array.from({ length: maxIndex + 1 }, (_, i) => (
                      <button
                        key={i}
                        className={`fc-dot${i === current ? ' on' : ''}`}
                        onClick={() => goTo(i)}
                        aria-label={`Go to product ${i + 1}`}
                        aria-current={i === current}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Two rows under the shelf, grouped by what they are ABOUT rather
                than by where the data came from.

                First row: the shelf itself — what is on it, what landed
                newest, what buyers rated highest. Three readings of the
                catalogue, so they belong together and they are what a visitor
                who has just scrolled past the carousel is still shopping.

                Second row: what is true right now and only for this visitor —
                where their order is, and which drop is about to lapse. Both
                are clocks in a sense, both are gone for a signed-out visitor
                on a quiet store, and neither is about the catalogue.

                Nothing here is decorative: every widget renders only while it
                has something true to show, so a quiet store thins these rows
                out rather than padding them, and a silent one loses them
                entirely. Both rows sit BELOW the carousel because the carousel
                takes the whole content width — the trade that bought the cards
                ~44px each and a third card at desktop sizes. */}
            <div className="home-widget-row">
              <StorePulse products={products} sales={sales} settings={settings} />
              <FreshDrops />
              <TopRated products={products} />
            </div>

            <aside className="home-widget-row" aria-label="Your order and live drops">
              <LatestOrderWidget user={user} />
              <DropClock sales={sales} />
            </aside>

            {/* Built from this buyer's own orders, and absent for everybody
                else — including every signed-out visitor and everybody who has
                not agreed to it. Below the two widget rows because it is the
                most personal thing on the page and the least universal: a
                visitor scrolling the home page is shopping the catalogue, and
                the shelf that knows them belongs after the shelves that do
                not. See components/home/ForYouRail.jsx. */}
            <ForYouRail />

            <CategoryShelf products={products} />
            </>
          )}
        </div>
      </section>

      {/* Evidence, then claims. What buyers said comes first because it is the
          harder thing to say and the operator does not author it — the band
          prints the store's real rating spread, including the buckets nobody
          would choose to quote. The promises follow as the store's own answer.
          Reversing the two would put the marketing in front of the receipts.

          Both sit outside the block above on purpose: that block returns an
          empty state when the catalogue is empty, and a store still setting
          itself up is exactly the one whose operator has just written these.
          Each draws nothing at all until it is switched on and has something
          true to say. */}
      <RecentReviews />
      <StorePromises />

      {/* The old "Accepted payments" footer bar is gone on purpose: the rail's
          pulse widget already carries the payment marks, and a second copy at
          the bottom of the page was decoration pretending to be information. */}
    </div>
  );
}
