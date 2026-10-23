import ProgressBar from '../components/ProgressBar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  BadgeCheck, Boxes, CalendarClock, CalendarDays, Check, ChevronRight,
  Flame, History, Info, Layers, Package, PackageSearch, Share2, Sparkles, Star, Users,
} from 'lucide-react';

import { api } from '../utils/api';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useWishlist } from '../context/WishlistContext';
import { useTheme } from '../context/ThemeContext';
import { discountPct, effectiveUnitPrice, listUnitPrice } from '../utils/pricing';
import { splitSpecs } from '../utils/tags';
import { productStock, readRecentlyViewed, rememberViewed } from '../utils/catalog';
import { plainLines, plainText } from '../utils/text';
import useReveal from '../hooks/useReveal';
import useDocumentHead from '../hooks/useDocumentHead';
import { clipDescription } from '../utils/documentHead';
import useCountdown from '../hooks/useCountdown';
import StarRating from '../components/StarRating';
import ProductGallery, { isVideoPath } from '../components/product/ProductGallery';
import VariantPicker from '../components/product/VariantPicker';
import BuyBox from '../components/product/BuyBox';
import ProductReviews from '../components/product/ProductReviews';
import BuyerSummary from '../components/product/BuyerSummary';
import ProductRail, { toRailItem } from '../components/product/ProductRail';

const pad = n => String(n).padStart(2, '0');

/**
 * The scheduled-drop banner, above the buy box.
 *
 * `product.drop` is non-null only for a product that is scheduled AND that the
 * server has already decided this viewer may see. There are exactly two ways
 * to be looking at one:
 *
 *   early_access  — the buyer's membership tier granted a head start, and the
 *                   product is live for them and for nobody else yet. This is
 *                   the reward the feature exists to deliver, so it says so
 *                   plainly rather than leaving them to notice the timer.
 *   staff_preview — staff holding products.view, looking at an unreleased
 *                   product. Worth marking clearly: without it the only
 *                   difference between "this is live" and "nobody but you can
 *                   see this" is a date in the admin panel.
 *
 * The banner disappears of its own accord when the clock reaches zero, because
 * at that moment the product is simply published and there is nothing left to
 * say. `useCountdown` recomputes from the wall clock rather than by
 * decrementing, so a tab left asleep for an hour wakes up correct.
 */
function DropBanner({ drop }) {
  const left = useCountdown(drop?.publish_at);
  if (!drop || !left || left.expired) return null;

  const staff = drop.staff_preview;
  const at = new Date(drop.publish_at);
  const cells = [
    { key: 'd', value: left.days, label: 'days' },
    { key: 'h', value: pad(left.hours), label: 'hours' },
    { key: 'm', value: pad(left.minutes), label: 'mins' },
    { key: 's', value: pad(left.seconds), label: 'secs' },
  ];
  // A drop days away does not need a days column reading "0".
  const shown = left.days > 0 ? cells : cells.slice(1);

  return (
    <section
      className={`cat-dropbanner${drop.early_access ? ' is-early' : ''}${staff ? ' is-staff' : ''}`}
      aria-label={staff ? 'Scheduled product' : 'Early access'}
    >
      <div className="cat-dropbanner-main">
        <span className="cat-dropbanner-icon" aria-hidden="true">
          {staff ? <CalendarClock size={17} /> : <Sparkles size={17} />}
        </span>
        <div className="cat-dropbanner-text">
          <h2 className="cat-dropbanner-title">
            {staff ? 'Scheduled — not public yet' : 'Early access'}
          </h2>
          <p className="cat-dropbanner-sub">
            {staff ? (
              <>Buyers cannot see this product until <time dateTime={drop.publish_at}>{at.toLocaleString()}</time>, minus whatever head start their tier carries.</>
            ) : drop.early_access ? (
              <>Your membership tier opened this {drop.early_access_minutes} minutes early. It goes public at <time dateTime={drop.publish_at}>{at.toLocaleString()}</time>.</>
            ) : (
              <>This product goes on general sale at <time dateTime={drop.publish_at}>{at.toLocaleString()}</time>.</>
            )}
          </p>
        </div>
      </div>

      {/* aria-hidden because the sentence above already states the go-live
          time in full; a screen reader re-reading four numbers every second
          would drown the page. */}
      <div className="cat-dropbanner-clock" aria-hidden="true">
        {shown.map((cell, idx) => (
          <div
            key={cell.key}
            className={`cat-dropbanner-cell${idx === shown.length - 1 ? ' is-live' : ''}`}
          >
            <b>{cell.value}</b>
            <span>{cell.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function relativeDay(date) {
  const then = new Date(date).getTime();
  if (!Number.isFinite(then)) return null;
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} ${months === 1 ? 'month' : 'months'} ago`;
  const years = Math.floor(months / 12);
  return `${years} ${years === 1 ? 'year' : 'years'} ago`;
}

export default function ProductDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { items: cartItems, addToCart, updateQuantity } = useCart();
  const { settings } = useTheme();

  const [product, setProduct] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  // Shared with the catalog and the navbar popover — see
  // context/WishlistContext.jsx. Held privately here once, which is why a
  // heart pressed on this page never reached either of the others.
  const { ids: wishlistIds, has: isWishlisted, toggle: toggleWishlistId } = useWishlist();

  // The tab and the address bar's share card: the product's own name, and
  // its description as a search result would quote it. Undefined until the
  // product lands, so the route's default shows rather than a stale one.
  useDocumentHead({
    title: product?.name,
    description: product ? clipDescription(plainText(product.description || '')) || undefined : undefined,
  });
  const [restockSubs, setRestockSubs] = useState(new Set());
  // Variants this buyer is watching the price of — see BuyBox's watch button.
  const [priceWatches, setPriceWatches] = useState(new Set());
  const [reviews, setReviews] = useState([]);
  const [reviewAvg, setReviewAvg] = useState(null);
  const [related, setRelated] = useState({ items: [], fromCategory: false });
  // Products that keep turning up in the same orders as this one. Its own
  // request rather than a field on the product, because it is a self-join over
  // order history and the product page is the hottest read in the shop — see
  // productController.getAlsoBought.
  const [alsoBought, setAlsoBought] = useState([]);
  const [recent, setRecent] = useState([]);
  const [barVisible, setBarVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const pageRef = useRef(null);
  const buyRef = useRef(null);

  const lowStockThreshold = Math.max(1, parseInt(settings?.low_stock_threshold || '5', 10) || 5);

  // Review evidence for the SELECTED variant's tags, keyed by label.
  // `product_reviews.variant_id` is NOT NULL, so "fruity" belongs to the
  // Blueberry one rather than to every flavour — switching variant changes the
  // counts along with the picture and the spec table.
  const tagEvidence = useMemo(
    () => (selectedVariant ? (product?.tag_evidence?.[selectedVariant.id] || {}) : {}),
    [product, selectedVariant],
  );

  const loadReviews = useCallback((groupId) => {
    api.get(`/reviews/${groupId}`)
      .then(d => { setReviews(d.reviews || []); setReviewAvg(d.average_rating); })
      .catch(() => {});
  }, []);

  // ── Product ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProduct(null);
    setSelectedVariant(null);

    api.get(`/products/${id}`)
      .then(data => {
        if (cancelled) return;
        // Retired options are dropped here as well as on the server.
        //
        // Not belt-and-braces for its own sake: this page is the one screen a
        // hidden variant reached anyway, because the endpoint serves the admin
        // editor too and used to widen its answer for anyone holding
        // `products.view`. A staff member browsing the shop then saw a retired
        // size rendered as an ordinary buyable one, and `addToCart` — which
        // re-checks `active` and must — refused it. The server now keys that on
        // `?editing=1` rather than on who is asking, and this page never sends
        // it; the filter stays so that a future caller which does cannot turn
        // the storefront back into a list of buttons that fail.
        const sellable = (data.variants || []).filter(v => v.active !== false);
        data = { ...data, variants: sellable };
        setProduct(data);
        // Auto-select the first in-stock variant, falling back to the first.
        const first = sellable.find(v => v.quantity > 0) || sellable[0] || null;
        setSelectedVariant(first);
        loadReviews(data.id);
        // Read the list *before* recording this visit, so the rail shows where
        // the visitor has been rather than where they are.
        setRecent(readRecentlyViewed().filter(r => r.id !== data.id));
        rememberViewed(data);
      })
      .catch(() => { if (!cancelled) toast.error('Product not found'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [id, loadReviews]);

  // ── Per-user state: wishlist and restock alerts ──────────────────────────
  useEffect(() => {
    if (!user) {
      setRestockSubs(new Set());
      return;
    }
    api.get('/moderation/restock')
      .then(subs => setRestockSubs(new Set(subs.map(s => s.variant_id))))
      .catch(() => {});
  }, [user]);

  // ── Related products ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!product) return undefined;
    let cancelled = false;

    const fetchRail = async () => {
      const seen = Number(product.id);
      const query = product.category
        ? `/products?category=${encodeURIComponent(product.category)}&limit=9`
        : '/products?sort=newest&limit=9';
      let list = await api.get(query).then(d => d.products || []).catch(() => []);
      list = list.filter(p => p.id !== seen);
      // A category of one leaves an empty shelf; fall back to the newest arrivals
      // rather than rendering a heading over nothing. The "see all" link has to
      // follow, or it would offer a category page holding just this product.
      let fromCategory = Boolean(product.category);
      if (list.length === 0 && product.category) {
        fromCategory = false;
        list = await api.get('/products?sort=newest&limit=9')
          .then(d => (d.products || []).filter(p => p.id !== seen))
          .catch(() => []);
      }
      if (!cancelled) setRelated({ items: list.slice(0, 8).map(toRailItem), fromCategory });
    };

    fetchRail();

    // Deliberately not awaited with the rail above: an empty answer is the
    // common case for a new product, and the related shelf should not wait on
    // it. Failure is an absent panel, never a visible error — nobody came to
    // this page for a recommendation.
    api.get(`/products/${product.id}/also-bought`)
      .then(d => { if (!cancelled) setAlsoBought((d.products || []).map(toRailItem)); })
      .catch(() => { if (!cancelled) setAlsoBought([]); });

    return () => { cancelled = true; };
  }, [product]);

  // ── The floating buy bar appears once the real one has scrolled away ─────
  useEffect(() => {
    const el = buyRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(
      ([entry]) => setBarVisible(!entry.isIntersecting && entry.boundingClientRect.top < 0),
      { threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [product]);

  // Only what makes the page root exist. Sections that mount later — the two
  // rails, the tab panel — are picked up by the hook's own MutationObserver.
  useReveal(pageRef, [product?.id, loading]);

  // ── What this variant already has in the cart ────────────────────────────
  const cartLine = useMemo(
    () => (selectedVariant ? cartItems.find(i => i.variant_id === selectedVariant.id) || null : null),
    [cartItems, selectedVariant],
  );

  // The box opens on the quantity the buyer already owns, so switching variants
  // or reloading shows what is in the cart rather than a fresh 1 — the number
  // they need in order to edit it, and the number the volume ladder below is
  // being read against.
  //
  // Keyed on the variant and on the SAVED quantity, never on `quantity` itself:
  // a local edit leaves `cartLine.quantity` alone, so typing 7 does not get
  // stamped back to 3 on the next render. A refetch that genuinely changes the
  // line (another tab, the cart page) does re-sync, which is correct.
  useEffect(() => {
    setQuantity(cartLine ? cartLine.quantity : 1);
  }, [selectedVariant?.id, cartLine?.quantity]);

  // Units counting toward this variant's volume break. Breaks pool across a
  // product's same-priced variants (pricingService.poolTierQuantities), so the
  // ladder has to be read against the pool or the page promises a break the
  // cart will not give — and, now that a band can rise, fails to warn about one
  // the cart WILL apply. Matched on `base_price`, the raw column: `price` has
  // the viewer's tier discount and markup folded in, and pooling is decided
  // before any of that.
  const pooledQuantity = useMemo(() => {
    if (!selectedVariant) return quantity;
    const raw = Number(selectedVariant.base_price ?? selectedVariant.price);
    if (!Number.isFinite(raw)) return quantity;
    const cents = Math.round(raw * 100);
    let others = 0;
    for (const i of cartItems) {
      if (i.variant_id === selectedVariant.id) continue;  // `quantity` stands in for it
      if (i.group_id !== product?.id) continue;
      if (Math.round(Number(i.base_price) * 100) !== cents) continue;
      others += i.quantity;
    }
    return quantity + others;
  }, [cartItems, selectedVariant, product?.id, quantity]);

  // ── Actions ──────────────────────────────────────────────────────────────
  // One button, two verbs. Once the variant is in the cart the box is showing
  // that line's quantity, so "add" would add it a second time — the edit the
  // buyer just made has to be saved as a replacement, not a top-up.
  const handleAddToCart = async () => {
    if (!user) return toast.error('Please sign in to add items to cart');
    if (!selectedVariant) return;
    setAdding(true);
    try {
      if (cartLine) {
        await updateQuantity(cartLine.id, quantity);
        toast.success(`Cart updated — ${quantity} × ${selectedVariant.name}`);
      } else {
        await addToCart(selectedVariant.id, quantity);
        toast.success(`Added ${quantity} × ${selectedVariant.name} to cart`);
      }
    } catch (err) {
      toast.error(err.message);
    }
    setAdding(false);
  };

  /*
   * The detail page confirms; the catalog grid does not. Same write either
   * way — the context owns the request, the optimistic flip and the rollback
   * — but a heart on a 40-card grid that toasted on every press would bury
   * the screen, while here it is the only feedback that the press landed.
   * The toast follows the context's answer rather than assuming success, so a
   * refused write says so instead of claiming a save that did not happen.
   */
  const toggleWishlist = async (variantId) => {
    const wasOn = isWishlisted(variantId);
    const nowOn = await toggleWishlistId(variantId);
    if (nowOn === wasOn) return; // refused, or signed out — already reported
    toast.success(nowOn ? 'Saved to wishlist' : 'Removed from wishlist');
  };

  useEffect(() => {
    if (!user) { setPriceWatches(new Set()); return; }
    api.get('/moderation/price-watch')
      .then((rows) => setPriceWatches(new Set((rows || []).map((r) => r.variant_id))))
      .catch(() => {});
  }, [user]);

  const togglePriceWatch = async (variantId) => {
    if (!user) return toast.error('Sign in to watch a price');
    if (priceWatches.has(variantId)) {
      try {
        await api.delete(`/moderation/price-watch/${variantId}`);
        setPriceWatches((prev) => { const s = new Set(prev); s.delete(variantId); return s; });
        toast.success('Stopped watching the price');
      } catch (err) {
        toast.error(err.message || 'Could not stop the watch');
      }
    } else {
      try {
        const res = await api.post(`/moderation/price-watch/${variantId}`);
        setPriceWatches((prev) => new Set([...prev, variantId]));
        const at = res?.watched_cents != null ? ` below $${(res.watched_cents / 100).toFixed(2)}` : '';
        toast.success(`Watching — you'll hear if it drops${at}`);
      } catch (err) {
        toast.error(err.message || 'Could not watch the price');
      }
    }
  };

  const toggleRestockAlert = async (variantId) => {
    if (!user) return toast.error('Sign in to get restock alerts');
    if (restockSubs.has(variantId)) {
      await api.delete(`/moderation/restock/${variantId}`).catch(() => {});
      setRestockSubs(prev => { const s = new Set(prev); s.delete(variantId); return s; });
      toast.success('Restock alert removed');
    } else {
      await api.post(`/moderation/restock/${variantId}`).catch(() => {});
      setRestockSubs(prev => new Set([...prev, variantId]));
      toast.success("You'll be notified when this restocks");
    }
  };

  const share = async () => {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title: product.name, url });
        return;
      } catch (err) {
        // Dismissing the sheet is a decision, not a failure. Anything else —
        // no user activation, a payload the platform refuses — falls through to
        // copying, so the button always does *something*.
        if (err?.name === 'AbortError') return;
      }
    }

    try {
      // `navigator.clipboard` needs a secure context; over plain HTTP, which is
      // how a Tor front end is usually reached, it is simply absent. The
      // execCommand path is deprecated but is the only one that works there.
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const field = document.createElement('input');
        field.value = url;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        document.execCommand('copy');
        field.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link — copy it from the address bar');
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const media = useMemo(() => {
    if (!product) return [];
    // Variant imagery leads: it is the more specific answer to "what am I
    // buying", and the gallery resets to the first item on every variant
    // change, so the first thing shown is always the thing selected.
    const rows = [
      ...(selectedVariant?.images || []),
      ...(product.images || []),
    ];
    const seen = new Set();
    return rows
      .filter(r => r?.path && !seen.has(r.path) && seen.add(r.path))
      // `poster` is the still the encoder pulled from a video. Without it the
      // gallery's thumbnail rail has to load and decode a frame of every clip
      // to show anything at all, and the stage flashes black before playback.
      .map(r => ({
        src: r.path,
        isVideo: isVideoPath(r.path, r.media_type),
        poster: r.poster_path || null,
      }));
  }, [product, selectedVariant]);

  const { specs, flat } = useMemo(
    () => splitSpecs([...(product?.tags || []), ...(selectedVariant?.tags || [])]),
    [product, selectedVariant]
  );

  /*
   * Descriptions in this catalog were authored with `<br>` in them and the
   * server stores them that way, so printing the raw string put the literal
   * characters "<br>" in the middle of the page's largest paragraph. Flattened
   * rather than rendered as HTML — see utils/text.js for why that direction is
   * the only one this codebase takes.
   *
   * `lead` and `about` are the same text: the standfirst beside the buy box is
   * clamped to three lines by CSS, and the section below prints all of it. The
   * variant's own copy is suppressed when it merely repeats the group's, which
   * this catalog's seeded data does on every single variant.
   */
  const about = useMemo(() => plainLines(product?.description), [product?.description]);
  const lead = about;
  const variantAbout = useMemo(
    () => plainLines(selectedVariant?.description),
    [selectedVariant?.description],
  );

  // Priced against the pooled quantity, not this line's, so the floating bar
  // quotes the same unit the buy box and the cart do.
  const unit = effectiveUnitPrice(selectedVariant, pooledQuantity);
  const list = listUnitPrice(selectedVariant);
  const off = discountPct(list, unit);
  const soldOut = selectedVariant ? selectedVariant.quantity === 0 : true;
  const totalStock = useMemo(
    () => productStock(product),
    [product]
  );

  if (loading) return <div className="loading-page"><ProgressBar label="Loading product…" /></div>;
  if (!product) {
    return (
      <div className="page container">
        <div className="glass-card empty-state">
          <PackageSearch aria-hidden="true" />
          <h3>Product not found</h3>
          <p>It may have been delisted, or the link is wrong.</p>
          <Link to="/products" className="glass-btn glass-btn-primary">Browse the catalog</Link>
        </div>
      </div>
    );
  }

  const added = relativeDay(product.created_at);

  return (
    <div className="page container pd-page" ref={pageRef}>

      <nav className="pd-breadcrumb" aria-label="Breadcrumb">
        <Link to="/" className="pd-bc-link">Home</Link>
        <ChevronRight size={12} className="pd-bc-sep" aria-hidden="true" />
        <Link to="/products" className="pd-bc-link">Products</Link>
        {product.category && (<>
          <ChevronRight size={12} className="pd-bc-sep" aria-hidden="true" />
          <Link to={`/products?category=${encodeURIComponent(product.category)}`} className="pd-bc-link">
            {product.category}
          </Link>
        </>)}
        <ChevronRight size={12} className="pd-bc-sep" aria-hidden="true" />
        <span className="pd-bc-current">{product.name}</span>
      </nav>

      <div className="pd-layout">

        {/* ── Media ── */}
        <div className="pd-media-col">
          <ProductGallery
            media={media}
            alt={product.name}
            oos={soldOut}
            badges={
              <>
                {off > 0 && <span className="pd-badge sale"><Flame size={11} aria-hidden="true" /> −{off}%</span>}
                {added && ['today', 'yesterday'].includes(added) && (
                  <span className="pd-badge new"><Sparkles size={11} aria-hidden="true" /> New</span>
                )}
                {product.variants?.length > 1 && (
                  <span className="pd-badge"><Boxes size={11} aria-hidden="true" /> {product.variants.length} variants</span>
                )}
              </>
            }
          />

          {/* Specifications sit here rather than behind a tab.

              Two reasons, and the first is the honest one: a square gallery in
              a half-width column is ~545px tall next to a buy column that runs
              to twice that, so this side of the page was several hundred
              pixels of nothing. The second is that a tab strip whose whole job
              is hiding half the content is a control that has to justify its
              pixels, and this one could not — specs are what a buyer reads
              *while* choosing a variant, not after.

              They follow `selectedVariant`, so switching variant changes the
              picture and the spec table together. */}
          {(specs.length > 0 || flat.length > 0) && (
            <section className="pd-aside" data-reveal aria-labelledby="pd-specs-h">
              <h2 className="pd-aside-title" id="pd-specs-h">
                <Layers size={14} aria-hidden="true" />
                Specifications
              </h2>
              {specs.length > 0 && (
                <dl className="pd-specs">
                  {specs.map(sp => (
                    <div className="pd-spec" key={sp.key}>
                      <dt>{sp.key.toLowerCase()}</dt>
                      <dd>
                        {sp.values.map((v, i) => {
                          // How many reviews of THIS variant used the word.
                          // Computed server-side from reviews already on the
                          // page below, so the claim is checkable by scrolling
                          // — which is the whole argument docs/AI.md §6 makes
                          // for saying it at all. Absent for a word nobody has
                          // used; never rendered as a zero.
                          const ev = tagEvidence[v.label];
                          return (
                            <span key={v.value}>
                              {i > 0 && ', '}
                              {/* A specification was plain text while the flat
                                  tags beside it were links. A buyer reading
                                  "Indica" had no way to ask for more of it, on
                                  the one screen where they are most likely to
                                  want to. */}
                              <Link
                                className="pd-spec-link"
                                to={`/products?tag=${encodeURIComponent(v.value)}`}
                              >
                                {v.label}
                              </Link>
                              {ev && (
                                <span
                                  className="pd-spec-evidence"
                                  title={`${ev.supporting} of ${ev.of} reviews of this option use this word`}
                                >
                                  {ev.supporting} said so
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {flat.length > 0 && (
                <div className="pd-tag-row">
                  {flat.map(t => (
                    <Link key={t} to={`/products?tag=${encodeURIComponent(t)}`} className="pd-tag">{t}</Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── What is in the kit ──
              A bundle sells as an ordinary variant, and until now the page said
              so in every way except the one that matters: the price, the photo
              and the Add button were all there, and nothing told a buyer the box
              held four things. `bundle_contents` arrives only for a bundle with
              a recipe, so this renders for nothing else.

              Beside the specifications rather than in the buy column, because it
              is the same kind of fact — what this thing IS — and because the buy
              column is already the longest thing on the page. Each line links to
              the component's own product, so "2 × Blue Dream — 3.5g" is
              something a buyer can go and read about rather than a name they
              have to trust. */}
          {product.bundle_contents?.length > 0 && (
            <section className="pd-aside pd-kit" data-reveal aria-labelledby="pd-kit-h">
              <h2 className="pd-aside-title" id="pd-kit-h">
                <Package size={14} aria-hidden="true" />
                What is in the kit
              </h2>
              <ul className="pd-kit-list">
                {product.bundle_contents.map((c) => (
                  <li className="pd-kit-line" key={`${c.group_id}-${c.product_name}-${c.variant_name}`}>
                    <span className="pd-kit-qty">{c.quantity}&times;</span>
                    <Link to={`/products/${c.group_id}`} className="pd-kit-link">
                      {c.product_name}
                      {c.variant_name && <span className="pd-kit-variant"> — {c.variant_name}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ── Buy column ── */}
        <div className="pd-info-col">

          {/* First thing in the buy column, above the name: whether this is
              even on sale yet outranks what it is called. Renders nothing for
              the ordinary published product, which is almost all of them. */}
          <DropBanner drop={product.drop} />

          <div className="pd-chips">
            {product.category && (
              <Link to={`/products?category=${encodeURIComponent(product.category)}`} className="pd-chip-cat">
                {product.category}
              </Link>
            )}
            {product.brand && <span className="pd-chip">{product.brand}</span>}
            <button type="button" className="pd-share" onClick={share} title="Copy a link to this product">
              {copied ? <Check size={13} aria-hidden="true" /> : <Share2 size={13} aria-hidden="true" />}
              <span>{copied ? 'Copied' : 'Share'}</span>
            </button>
          </div>

          <h1 className="pd-title">{product.name}</h1>

          <div className="pd-meta">
            {reviews.length > 0 ? (
              <a href="#reviews" className="pd-meta-rating">
                <StarRating rating={Math.round(Number(reviewAvg) || 0)} size={13} />
                <b>{Number(reviewAvg).toFixed(1)}</b>
                <span>({reviews.length})</span>
              </a>
            ) : (
              <span className="pd-meta-item"><Star size={12} aria-hidden="true" /> No reviews yet</span>
            )}
            <span className="pd-meta-sep" aria-hidden="true" />
            <span className="pd-meta-item">
              <Boxes size={12} aria-hidden="true" />
              {totalStock > 0 ? `${totalStock} ${product.breakdown_enabled ? 'base units' : 'units'} available` : 'Currently unavailable'}
            </span>
            {added && (<>
              <span className="pd-meta-sep" aria-hidden="true" />
              <span className="pd-meta-item"><CalendarDays size={12} aria-hidden="true" /> Listed {added}</span>
            </>)}
          </div>

          {lead && <p className="pd-lead">{lead}</p>}

          <VariantPicker
            variants={product.variants || []}
            selected={selectedVariant}
            onSelect={v => setSelectedVariant(v)}
            user={user}
            wishlistIds={wishlistIds}
            onToggleWishlist={toggleWishlist}
            restockSubs={restockSubs}
            onToggleRestock={toggleRestockAlert}
            lowStockThreshold={lowStockThreshold}
          />

          <div ref={buyRef}>
            <BuyBox
              variant={selectedVariant}
              quantity={quantity}
              tierQuantity={pooledQuantity}
              inCartQuantity={cartLine ? cartLine.quantity : 0}
              onQuantity={setQuantity}
              onAddToCart={handleAddToCart}
              adding={adding}
              user={user}
              wishlisted={selectedVariant ? isWishlisted(selectedVariant.id) : false}
              onToggleWishlist={toggleWishlist}
              restockAlerted={selectedVariant ? restockSubs.has(selectedVariant.id) : false}
              onToggleRestock={toggleRestockAlert}
              priceWatched={selectedVariant ? priceWatches.has(selectedVariant.id) : false}
              onTogglePriceWatch={togglePriceWatch}
              settings={settings}
              lowStockThreshold={lowStockThreshold}
            />
          </div>
        </div>
      </div>

      {/* ── Description ──
          A section with a heading, not a tab panel. Specifications moved up
          beside the gallery, which left the strip switching between one tab
          and an empty one. */}
      <section className="pd-section" data-reveal aria-labelledby="pd-about-h">
        <h2 className="pd-section-title" id="pd-about-h">
          <Info size={15} aria-hidden="true" />
          Description
        </h2>
        <div className="pd-prose">
          {about
            ? <p>{about}</p>
            : <p className="pd-muted-line">No description has been written for this product yet.</p>}
          {variantAbout && variantAbout !== about && (
            <>
              <h3>About {selectedVariant.name}</h3>
              <p>{variantAbout}</p>
            </>
          )}
        </div>
      </section>

      {/* The store's own paragraph about the reviews, directly above them.
          Only present on the response when a moderator has published one —
          `getProduct` sends none of the three keys otherwise — so the block
          draws on presence and there is no empty state to design. */}
      {product.review_summary && (
        <BuyerSummary
          text={product.review_summary}
          at={product.review_summary_at}
          count={product.review_summary_count}
        />
      )}

      <ProductReviews
        variants={product.variants || []}
        user={user}
        reviews={reviews}
        average={reviewAvg}
        onReload={() => loadReviews(product.id)}
        mediaEnabled={settings?.review_media_enabled === 'true'}
      />

      {/* Ahead of the category shelf on purpose: "bought in the same order as
          this, repeatedly" is a stronger signal than "filed under the same
          word", and the stronger shelf should be the one that gets read. */}
      <ProductRail
        title="Often bought together"
        icon={<Users size={15} aria-hidden="true" />}
        items={alsoBought}
      />

      <ProductRail
        title={related.fromCategory ? `More in ${product.category}` : 'You might also like'}
        icon={<BadgeCheck size={15} aria-hidden="true" />}
        items={related.items}
        moreHref={related.fromCategory
          ? `/products?category=${encodeURIComponent(product.category)}`
          : '/products'}
        moreLabel="Browse all"
      />

      <ProductRail
        title="Recently viewed"
        icon={<History size={15} aria-hidden="true" />}
        items={recent}
      />

      {/* ── Floating buy bar (small screens) ── */}
      {selectedVariant && !soldOut && (
        <div className={`pd-floatbar${barVisible ? ' show' : ''}`} aria-hidden={!barVisible}>
          <div className="pd-floatbar-info">
            <span className="pd-floatbar-name">{selectedVariant.name}</span>
            <span className="pd-floatbar-price">
              ${(unit * quantity).toFixed(2)}
              {quantity > 1 && <em>{quantity} × ${unit.toFixed(2)}</em>}
            </span>
          </div>
          {user ? (
            <button
              type="button"
              className="glass-btn glass-btn-primary"
              onClick={handleAddToCart}
              disabled={adding}
              tabIndex={barVisible ? 0 : -1}
            >
              {adding
                ? <span className="spinner" style={{ width: 14, height: 14 }} />
                : cartLine ? 'Update cart' : 'Add to cart'}
            </button>
          ) : (
            <Link to="/login" className="glass-btn glass-btn-primary" tabIndex={barVisible ? 0 : -1}>
              Sign in to buy
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
