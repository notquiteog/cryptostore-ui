import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useWishlist } from '../context/WishlistContext';
import { groupDisplayPrice, effectiveUnitPrice, listUnitPrice } from '../utils/pricing';
import { groupTags } from '../utils/tags';
import { productInStock, productThumb } from '../utils/catalog';
import { askAssistant } from '../utils/askAssistant';
import { useAiCapability } from '../hooks/useAiTool';
import {
  Eye, EyeOff, ChevronDown, SlidersHorizontal, X, Heart, PackageSearch,
  CalendarClock, Sparkles, SearchX, ImageOff, MessageCircleQuestion,
  ChevronLeft, ChevronRight, Layers,
} from 'lucide-react';
import useCountdown from '../hooks/useCountdown';
import useViewMode from '../hooks/useViewMode';
import useDocumentHead from '../hooks/useDocumentHead';
import { ROBOTS_SEARCH } from '../utils/documentHead';
import { catalogPath } from '../config/pageHead';
import ViewToggle from '../components/ViewToggle';
import toast from 'react-hot-toast';
import CompanionSpot from '../components/ai/CompanionSpot';

/**
 * How many products one page of the shelf holds.
 *
 * This was a flat 24, chosen when the catalog capped at 1560px and rendered
 * five or six columns — four clean rows. The catalog now rides `--shell-shelf`
 * and fills the monitor, so at 3840px it lays out fifteen columns and a page
 * of 24 is one full row plus nine cards and then the pager: a shelf that looks
 * half unpacked on exactly the screens with the most room to fill.
 *
 * Derived from the window instead, aiming at four rows of whatever fits, and
 * rounded to a whole number of columns so the last row is never a fragment.
 * 240 is the track floor plus its gap — the same number `.pcard-grid` lays out
 * against — so the column estimate matches what the grid actually does.
 *
 * Read once, at module load, and deliberately NOT recomputed on resize: the
 * page size is in the query, so following the window would refetch the shelf
 * on every drag of the frame and renumber the pages under the reader's cursor.
 * Someone who resizes gets the size their window had when they arrived, which
 * is what every other paginated view in this app does too. The server caps
 * `limit` at 100 (`productController.getProducts`), hence the 96 ceiling.
 */
function shelfPageSize(w) {
  const shelf = Math.min(w * 0.96, 5200);
  const cols = Math.max(2, Math.round(shelf / 240));
  return Math.min(96, Math.max(24, cols * 4 - ((cols * 4) % cols)));
}
const PER_PAGE = shelfPageSize(typeof window === 'undefined' ? 1440 : window.innerWidth);

/* How many rungs of a group's price ladder the hover panel prints before it
   collapses the rest into a count. Six covers every multi-variant group in a
   normal catalog; the twenty-variant outliers get a tail line instead of a
   panel that runs off the bottom of the card. */
const LADDER_MAX = 6;

const money = n => `$${(Number(n) || 0).toFixed(2)}`;
const pad = n => String(n).padStart(2, '0');

/**
 * The countdown pill on a scheduled product's card.
 *
 * A component rather than a helper because it needs `useCountdown`, and hooks
 * cannot be called from inside the `products.map()` that renders the grid.
 *
 * Kept deliberately terse — a card has one line to spare, and a grid of
 * twenty-four full clocks is a wall of moving digits. Days are shown with
 * hours and everything shorter collapses to HH:MM:SS, so the pill never
 * changes width as it counts (the tabular figures in catalog.css do the rest).
 *
 * `drop` is only ever present on a product the server already decided this
 * viewer may see: this renders the explanation, it does not make the decision.
 * Nothing here is load-bearing for visibility.
 */
function DropBadge({ drop }) {
  const left = useCountdown(drop?.publish_at);
  if (!drop || !left || left.expired) return null;

  const { days, hours, minutes, seconds } = left;
  const staff = drop.staff_preview;

  return (
    <span
      className={`cat-drop-badge${drop.early_access ? ' is-early' : ''}${staff ? ' is-staff' : ''}`}
      title={staff
        ? `Hidden from buyers until ${new Date(drop.publish_at).toLocaleString()}`
        : `Public at ${new Date(drop.publish_at).toLocaleString()}`}
    >
      <span className="cat-drop-dot" aria-hidden="true" />
      {staff
        ? <CalendarClock size={11} className="cat-drop-icon" aria-hidden="true" />
        : <Sparkles size={11} className="cat-drop-icon" aria-hidden="true" />}
      {/* The word carries the meaning; the clock alone is just a number
          floating on a photo, and to a screen reader it is nothing at all. */}
      <span className="cat-drop-label">{staff ? 'Scheduled' : 'Early access'}</span>
      <span className="cat-drop-clock">
        {days > 0 ? (
          <>
            <span className="cat-drop-unit"><b className="cat-drop-num">{days}</b><span className="cat-drop-suffix">d</span></span>
            <span className="cat-drop-unit"><b className="cat-drop-num">{pad(hours)}</b><span className="cat-drop-suffix">h</span></span>
          </>
        ) : (
          <span className="cat-drop-num">
            {pad(hours)}<span className="cat-drop-sep">:</span>{pad(minutes)}<span className="cat-drop-sep">:</span>{pad(seconds)}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * The group's variants as a price ladder, cheapest first.
 *
 * Every figure comes from `effectiveUnitPrice` — the same helper the product
 * page and the cart preview quote from, which is the display-side mirror of
 * `pricingService.computeUnitPrice`. Working the ladder out here from
 * `variant.price` would be a fourth opinion on what a thing costs, and this
 * repository has already paid for having three.
 *
 * Quantity is fixed at 1 because a card cannot know how many the buyer wants;
 * a group whose real saving is at the 4+ break shows its single-unit rung
 * here, and the product page shows the ladder that rises with quantity.
 */
function priceLadder(product) {
  return (product?.variants || [])
    .map(v => ({
      id: v.id,
      name: v.name || 'Standard',
      effective: effectiveUnitPrice(v, 1),
      list: listUnitPrice(v),
      out: !(v.quantity > 0),
    }))
    .map(r => ({ ...r, onSale: r.effective < r.list }))
    .sort((a, b) => a.effective - b.effective);
}

/**
 * A product card.
 *
 * One link per card — the name carries it and `.pcard-link::after` stretches
 * over the whole tile — rather than the old `<Link>` wrapped around everything
 * with a wishlist `<button>` nested inside it. Nesting a button in an anchor is
 * invalid, and it is why the heart needed `preventDefault` gymnastics to stop a
 * save from also navigating.
 *
 * The ladder panel is the card's one piece of hover disclosure (DESIGN §4): a
 * group with six variants prints one headline price, and the question a buyer
 * actually has — what do the other five cost — used to need a page load to
 * answer. It is absolutely positioned over the image, so revealing it moves
 * nothing; it is `pointer-events: none`, so it never eats the click it is
 * sitting on; and the range beside the price says the same thing in one line
 * for anyone who cannot hover. Touch keeps the range and skips the panel.
 */
function ProductCard({ product, wishlisted, onToggleWishlist, canWish }) {
  const img = productThumb(product);
  const pricing = groupDisplayPrice(product);
  const inStock = productInStock(product);
  const ladder = useMemo(() => priceLadder(product), [product]);
  const multi = ladder.length > 1;
  const top = ladder.length ? ladder[ladder.length - 1].effective : 0;
  const firstVariant = product.variants?.[0];

  return (
    <article className={`pcard${inStock ? '' : ' is-oos'}`}>
      <div className="pcard-media" style={img ? { backgroundImage: `url(${img})` } : undefined}>
        {!img && <ImageOff className="pcard-noimg" size={26} aria-hidden="true" />}
        {!inStock && <span className="pcard-oos">Sold out</span>}
        <DropBadge drop={product.drop} />

        {/* Reserved by position, not by layout: the panel is a sibling of the
            image at rest, already sized, and only its opacity and offset move
            on hover. A panel that expanded the card would make the grid jump
            under the cursor and turn a click into a click on the next tile. */}
        {multi && (
          <div className="pcard-ladder" aria-hidden="true">
            <div className="pcard-ladder-head">
              <Layers size={11} aria-hidden="true" />
              {ladder.length} variants
            </div>
            {ladder.slice(0, LADDER_MAX).map(rung => (
              <div key={rung.id} className={`pcard-rung${rung.out ? ' is-out' : ''}`}>
                <span className="pcard-rung-name">{rung.name}</span>
                <span className="pcard-rung-price">
                  {rung.out ? '—' : money(rung.effective)}
                </span>
              </div>
            ))}
            {ladder.length > LADDER_MAX && (
              <div className="pcard-rung is-more">
                <span className="pcard-rung-name">+{ladder.length - LADDER_MAX} more</span>
              </div>
            )}
          </div>
        )}
      </div>

      {canWish && firstVariant && (
        <button
          type="button"
          className={`fc-heart${wishlisted ? ' on' : ''}`}
          onClick={() => onToggleWishlist(firstVariant.id)}
          aria-label={wishlisted ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
          title={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
        >
          <Heart size={14} fill={wishlisted ? 'currentColor' : 'none'} />
        </button>
      )}

      <div className="pcard-body">
        {/* Brand first, and it is the one that never truncates: this catalog
            holds three separate products called "Battery" and the maker is the
            only thing on the card that tells them apart. The category is the
            line that gives way on a narrow tile — when a buyer has filtered to
            Accessories, every card saying ACCESSORIES is noise anyway. */}
        <div className="pcard-meta">
          {product.brand && <span className="pcard-brand">{product.brand}</span>}
          {product.category && <span className="pcard-cat">{product.category}</span>}
        </div>

        {/* Two lines, clamped, with the height reserved either way. The old
            single-line ellipsis cut "Blue Dream — Greenhouse, 3.5g" to "Blue
            Dream — Greenh…", which is the half of the name that distinguishes
            it from four other cards on the same screen. */}
        <h3 className="pcard-name">
          <Link className="pcard-link" to={`/products/${product.id}`}>{product.name}</Link>
        </h3>

        <div className="pcard-foot">
          {/* One line, always. "$24.99 – $26.99" wrapped on a 212px tile and
              left the dash leading a second line, which also pushed that
              card's footer up and broke the price baseline across the row. The
              top of the range drops its dollar sign and its spaces instead —
              "$24.99–26.99" is the same fact in three fewer characters. A sale
              suppresses the range outright: the struck-through list price is
              the story there, and three figures on one line is a puzzle. */}
          <span className="pcard-price">
            <span className={pricing.onSale ? 'is-sale' : undefined}>{money(pricing.effective)}</span>
            {pricing.onSale && <span className="pcard-was">{money(pricing.list)}</span>}
            {!pricing.onSale && multi && top > pricing.effective && (
              <span className="pcard-upto">–{top.toFixed(2)}</span>
            )}
          </span>
          <span className={`pcard-stock${inStock ? '' : ' is-out'}`}>
            <span className="pcard-dot" aria-hidden="true" />
            {inStock ? 'In stock' : 'Sold out'}
          </span>
        </div>
      </div>
    </article>
  );
}

/**
 * The compact list's column headings.
 *
 * Clipped rather than removed once the rows become cards, so the list keeps
 * announcing real column headers to a screen reader at every width — the same
 * reason `.admin-rtable` clips its `<thead>` instead of hiding it.
 */
function ProductRowsHead() {
  return (
    <div className="crow-head" role="row">
      <span className="crow-h" role="columnheader">Product</span>
      <span className="crow-h" role="columnheader">Brand</span>
      <span className="crow-h" role="columnheader">Category</span>
      <span className="crow-h is-num" role="columnheader">Variants</span>
      <span className="crow-h is-num" role="columnheader">From</span>
      <span className="crow-h" role="columnheader">Stock</span>
      <span className="crow-h is-blank" role="columnheader" aria-label="Wishlist" />
    </div>
  );
}

/**
 * One catalog row, for the compact list view.
 *
 * Same record, different question. The grid answers "show me the shelf"; this
 * answers "where is the one I already know the name of, and what does it cost
 * now" — so brand, category and variant count get their own aligned columns
 * rather than being crammed into a sub-line under the name, and the numbers are
 * mono and right-aligned so a column of prices reads down its own axis.
 *
 * The sub-line still exists, and is the ONLY thing that carries brand and
 * category once the container is too narrow for seven columns. Dropping those
 * columns without it would delete the field that tells "Cured Resin Cart" by
 * Flavorade from "Cured Resin Cart" by Connected — and this catalog has both.
 */
function ProductRow({ product, wishlisted, onToggleWishlist, canWish }) {
  const img = productThumb(product);
  const pricing = groupDisplayPrice(product);
  const inStock = productInStock(product);
  const count = product.variants?.length || 0;
  const firstVariant = product.variants?.[0];

  return (
    <article className={`crow${inStock ? '' : ' is-oos'}`} role="row">
      <div className="crow-name" role="cell">
        <span className="crow-thumb" style={img ? { backgroundImage: `url(${img})` } : undefined}>
          {!img && <ImageOff size={13} aria-hidden="true" />}
        </span>
        <span className="crow-main">
          <Link className="crow-link" to={`/products/${product.id}`}>{product.name}</Link>
          <span className="crow-sub">
            {product.brand && <span>{product.brand}</span>}
            {product.category && <span>{product.category}</span>}
            {count > 1 && <span className="crow-variants">{count} variants</span>}
            {product.drop && <DropBadge drop={product.drop} />}
          </span>
        </span>
      </div>

      <div className="crow-brand" role="cell">{product.brand || '—'}</div>
      <div className="crow-cat" role="cell">{product.category || '—'}</div>
      <div className="crow-vars" role="cell">{count > 1 ? count : ''}</div>

      {/* `display: contents` on a wide row, so price and stock are two real
          grid columns that line up down the list; a flex stack on a narrow one,
          where they share the second line. Without the wrapper the narrow
          layout had two elements claiming the same grid area, which paints
          them on top of each other. */}
      <div className="crow-figures">
        <div className="crow-price" role="cell">
          <span className={pricing.onSale ? 'is-sale' : undefined}>{money(pricing.effective)}</span>
          {pricing.onSale && <span className="crow-was">{money(pricing.list)}</span>}
        </div>

        <div className={`crow-stock${inStock ? '' : ' is-out'}`} role="cell">
          <span className="crow-dot" aria-hidden="true" />
          <span>{inStock ? 'In stock' : 'Sold out'}</span>
        </div>
      </div>

      {/* Hover-revealed on a fine pointer, always present on a coarse one — the
          list has no second path to the wishlist, so hiding it behind hover on
          a phone would delete the control outright (DESIGN §4). */}
      {canWish && firstVariant && (
        <button
          type="button"
          className={`crow-heart${wishlisted ? ' on' : ''}`}
          onClick={() => onToggleWishlist(firstVariant.id)}
          aria-label={wishlisted ? `Remove ${product.name} from wishlist` : `Save ${product.name} to wishlist`}
          title={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
        >
          <Heart size={14} fill={wishlisted ? 'currentColor' : 'none'} />
        </button>
      )}
    </article>
  );
}

/**
 * Placeholder tiles that hold the grid's shape while the page loads.
 *
 * A centred spinner on an otherwise empty page collapsed the layout to nothing
 * and then dropped twenty-four cards into it, so every filter change was a
 * full-page reflow with a jump to match. These occupy the same boxes the
 * results will. The shimmer is a loader and stays animated under
 * `prefers-reduced-motion` — a frozen skeleton reads as a hung page.
 */
function CatalogSkeleton({ view }) {
  const n = view === 'rows' ? 10 : 12;
  return (
    <div className={view === 'rows' ? 'crow-list' : 'pcard-grid'} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={view === 'rows' ? 'crow-skel' : 'pcard-skel'}>
          <div className="skel-block" />
          <div className="skel-lines">
            <span className="skel-line" />
            <span className="skel-line is-short" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Products() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  // The wishlist lives in one place for the whole client — see
  // context/WishlistContext.jsx. This page used to hold its own Set and its
  // own toggle, which is why hearting something here never reached the navbar
  // popover.
  const { has: isWishlisted, toggle: toggleWishlist } = useWishlist();
  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [tags, setTags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showOOS, setShowOOS] = useState(false);
  // Which search stage the server answered with: 'exact' when the words
  // matched, 'similar' when nothing did and it fell back to trigram
  // similarity. Null when nothing was searched for.
  const [searchMode, setSearchMode] = useState(null);
  /*
   * DESIGN §6, answered: a TOGGLE. A buyer who scans this catalog by name
   * rather than by picture should not have to say so on every visit, and the
   * two shapes are genuinely different records — the card leads with the
   * product image, the row leads with the name and price.
   *
   * This was the fifth hand-rolled copy of the same switch in the app, on its
   * own `cs.catview.v1` key with its own `'grid' | 'list'` vocabulary and its
   * own `.cat-view-btn` class family. It now shares the one hook and control
   * with the other four; see hooks/useViewMode.js. The old key is not
   * migrated — a buyer re-picks once, which is cheaper than a shim that lives
   * in the codebase forever.
   */
  const [view, setView] = useViewMode('catalog', 'cards');

  const page = parseInt(searchParams.get('page') || '1');
  const search = searchParams.get('search') || '';
  // Undefined while the status is still loading, which renders nothing — the
  // same three-state rule useAiCapability's own header describes, so the
  // button does not flicker in after the empty state has settled.
  const assistantOffered = useAiCapability('assistant') === true;
  const category = searchParams.get('category') || '';
  const brand = searchParams.get('brand') || '';
  const tag = searchParams.get('tag') || '';
  const sort = searchParams.get('sort') || '';

  // The tab and the crawler: a category is a page of its own with its own
  // address, a later page says so, and a search result is nobody's result —
  // the same rules the served head applies (server/services/seo.js).
  useDocumentHead({
    title: category
      ? `${category}${page > 1 ? ` — page ${page}` : ''}`
      : (page > 1 ? `Catalog — page ${page}` : undefined),
    robots: search ? ROBOTS_SEARCH : undefined,
    canonicalPath: catalogPath({ category, page }),
  });

  const setParam = (key, val) => setSearchParams(prev => {
    if (val) prev.set(key, val); else prev.delete(key);
    prev.set('page', '1');
    return prev;
  });

  const goPage = (n) => {
    setSearchParams(prev => { prev.set('page', String(n)); return prev; });
    // The pager sits at the bottom of a 24-card grid; without this, page 2
    // opens scrolled past its own first eighteen results.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const clearAll = () => {
    setShowOOS(false);
    setSearchParams({});
  };

  useEffect(() => {
    Promise.all([
      api.get('/products/categories'),
      api.get('/products/brands'),
      api.get('/products/tags'),
    ]).then(([cats, br, tg]) => {
      setCategories(cats);
      setBrands(br);
      setTags(tg);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set('page', page);
    params.set('limit', PER_PAGE);
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    if (brand) params.set('brand', brand);
    if (tag) params.set('tag', tag);
    if (sort) params.set('sort', sort);
    params.set('in_stock_only', showOOS ? 'false' : 'true');

    api.get(`/products?${params.toString()}`)
      .then(productData => {
        setProducts(productData.products);
        setTotal(productData.total);
        setSearchMode(productData.search_mode || null);
      }).catch(() => {})
      .finally(() => setLoading(false));
  }, [page, search, category, brand, tag, sort, showOOS]);


  const tagGroups = useMemo(() => groupTags(tags), [tags]);
  const tagGroupEntries = useMemo(() => Object.entries(tagGroups), [tagGroups]);

  /*
   * The active query, as removable chips.
   *
   * The filter panel used to be the only place the state of the query was
   * written down, and it is collapsed by default — so a buyer who arrived on a
   * category link, or came back to a tab from yesterday, saw a short shelf and
   * a badge reading "2" with no way to learn what the two were without opening
   * a panel. Every filter now names itself on screen and can be dropped where
   * it stands.
   */
  const chips = useMemo(() => {
    const out = [];
    if (search) out.push({ key: 'search', label: 'Search', value: search, clear: () => setParam('search', '') });
    if (category) out.push({ key: 'category', label: 'Category', value: category, clear: () => setParam('category', '') });
    if (brand) out.push({ key: 'brand', label: 'Brand', value: brand, clear: () => setParam('brand', '') });
    if (tag) {
      // Print the human half of "COLOUR: Blue" — the raw tag is what the filter
      // sends, not what anyone should have to read.
      const flat = Object.values(tagGroups).flat().find(t => t.value === tag);
      out.push({ key: 'tag', label: 'Tag', value: flat?.label || tag, clear: () => setParam('tag', '') });
    }
    if (sort) {
      const label = sort === 'price_asc' ? 'Price: low → high' : sort === 'price_desc' ? 'Price: high → low' : sort;
      out.push({ key: 'sort', label: 'Sort', value: label, clear: () => setParam('sort', '') });
    }
    if (showOOS) {
      out.push({
        key: 'oos', label: 'Availability', value: 'Including sold out',
        clear: () => { setShowOOS(false); setSearchParams(prev => { prev.set('page', '1'); return prev; }); },
      });
    }
    return out;
  }, [search, category, brand, tag, sort, showOOS, tagGroups]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasActiveFilter = chips.length > 0;
  const pageCount = Math.max(1, Math.ceil(total / PER_PAGE));
  const firstOnPage = total === 0 ? 0 : (page - 1) * PER_PAGE + 1;
  const lastOnPage = Math.min(page * PER_PAGE, total);

  /* A window of page numbers around the current one, always including the
     first and last, with nulls where the run is broken. A catalog of 253
     groups is eleven pages; printing all eleven is fine, printing forty for a
     thousand is not. */
  const pageWindow = useMemo(() => {
    if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
    const near = [page - 1, page, page + 1].filter(n => n > 1 && n < pageCount);
    const nums = [...new Set([1, ...near, pageCount])].sort((a, b) => a - b);
    const out = [];
    nums.forEach((n, i) => {
      if (i > 0 && n - nums[i - 1] > 1) out.push(null);
      out.push(n);
    });
    return out;
  }, [page, pageCount]);

  return (
    <div className="page catalog">
      <div className="catalog-inner">

        {/* No search field here. The navbar's is always on screen, does the
            same job with the same component, and now carries this page's term
            (see Navbar) — two identical wide search boxes stacked a hundred
            pixels apart was the page telling the buyer it had not decided
            which one to use. */}
        <header className="cat-head">
          <div className="cat-head-text">
            <Link to="/" className="store-eyebrow cat-breadcrumb">Home <ChevronRight size={12} aria-hidden="true" /> The collection</Link>
            <h1 className="cat-title">Catalog</h1>
            {/* The count is the page's subtitle because it is the only fact
                about the shelf that is true right now. "Browse our range" is
                copy that would fit any store on earth. */}
            <p className="cat-count">
              {loading
                ? 'Counting the shelf…'
                : search
                  ? <>{total.toLocaleString()} {total === 1 ? 'result' : 'results'} for <b>{search}</b></>
                  : hasActiveFilter
                    ? <>{total.toLocaleString()} of the catalog {total === 1 ? 'matches' : 'match'}</>
                    : <>{total.toLocaleString()} {total === 1 ? 'product' : 'products'} on the shelf</>}
            </p>
          </div>
        </header>

        {/* Sticky under the navbar: on a 24-card grid the sort control was two
            screens above the cards it reorders, so changing it meant scrolling
            up, choosing, and scrolling back to where you were. */}
        <div className="cat-bar">
          <button
            type="button"
            className={`cat-bar-btn${filtersOpen ? ' is-open' : ''}${hasActiveFilter ? ' has-filters' : ''}`}
            onClick={() => setFiltersOpen(v => !v)}
            aria-expanded={filtersOpen}
            aria-controls="cat-filter-panel"
          >
            <SlidersHorizontal size={14} aria-hidden="true" />
            Filters
            {chips.length > 0 && <span className="cat-bar-badge">{chips.length}</span>}
            <ChevronDown size={14} className={`cat-bar-chev${filtersOpen ? ' is-open' : ''}`} aria-hidden="true" />
          </button>

          <label className="cat-bar-sort">
            <span className="cat-bar-sort-label">Sort</span>
            <select
              className="glass-input"
              value={sort}
              onChange={e => setParam('sort', e.target.value)}
            >
              {/* The default order is now relevance whenever a term was
                  typed — the server ranks by ts_rank in that case — so the
                  option is named for what it actually does rather than
                  leaving the buyer to guess why "Default" reordered. */}
              <option value="">{search ? 'Best match' : 'Shelf order'}</option>
              <option value="price_asc">Price: low → high</option>
              <option value="price_desc">Price: high → low</option>
            </select>
          </label>

          <div className="cat-bar-spacer" />

          <ViewToggle
            value={view}
            onChange={setView}
            label="Result layout"
            cardsLabel="Grid"
            rowsLabel="List"
          />
        </div>

        {/* Collapsible body — single child required for the grid-row reveal. */}
        <div className={`cat-panel${filtersOpen ? ' is-open' : ''}`} id="cat-filter-panel">
          <div className="cat-panel-inner">
            <div className="cat-panel-grid">
              {categories.length > 0 && (
                <label className="cat-field">
                  <span className="cat-field-label">Category</span>
                  <select className="glass-input" value={category} onChange={e => setParam('category', e.target.value)}>
                    <option value="">All categories</option>
                    {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}

              {brands.length > 0 && (
                <label className="cat-field">
                  <span className="cat-field-label">Brand</span>
                  <select className="glass-input" value={brand} onChange={e => setParam('brand', e.target.value)}>
                    <option value="">All brands</option>
                    {brands.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </label>
              )}

              {tagGroupEntries.map(([group, items]) => (
                <label key={group} className="cat-field">
                  <span className="cat-field-label">{group === '__flat__' ? 'Tags' : group}</span>
                  <select
                    className="glass-input"
                    value={items.some(i => i.value === tag) ? tag : ''}
                    onChange={e => setParam('tag', e.target.value)}
                  >
                    <option value="">All</option>
                    {items.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
                  </select>
                </label>
              ))}

              <div className="cat-field">
                <span className="cat-field-label">Availability</span>
                <button
                  type="button"
                  onClick={() => { setShowOOS(v => !v); setSearchParams(prev => { prev.set('page', '1'); return prev; }); }}
                  className={`glass-btn cat-avail${showOOS ? ' glass-btn-active' : ''}`}
                  aria-pressed={showOOS}
                >
                  {showOOS ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                  {showOOS ? 'Including sold out' : 'In stock only'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {hasActiveFilter && (
          <div className="cat-chips">
            {chips.map(chip => (
              <button
                key={chip.key}
                type="button"
                className="cat-chip"
                onClick={chip.clear}
                title={`Remove the ${chip.label.toLowerCase()} filter`}
              >
                <span className="cat-chip-key">{chip.label}</span>
                <span className="cat-chip-val">{chip.value}</span>
                <X size={11} aria-hidden="true" />
              </button>
            ))}
            <button type="button" className="cat-chip is-clear" onClick={clearAll}>
              Clear all
            </button>
          </div>
        )}

        {/* Say so when the results are a guess rather than a match. Presenting a
            fuzzy fallback silently reads as "this is what you asked for", and
            the buyer never finds out their typo was the reason the shelf looks
            wrong. */}
        {!loading && searchMode === 'similar' && products.length > 0 && (
          <div className="cat-searchnote" role="status">
            <SearchX size={15} aria-hidden="true" />
            <span>
              Nothing matched <b>{search}</b> exactly — showing the closest products instead.
            </span>
          </div>
        )}

        {loading ? (
          <CatalogSkeleton view={view} />
        ) : products.length === 0 ? (
          /* Empty states are navigation (DESIGN §9). A filtered-to-nothing
             shelf offers the widest thing that would have matched — the
             categories the store actually stocks — rather than a full stop. */
          <div className="glass-card empty-state cat-empty">
            <CompanionSpot fallback={<PackageSearch aria-hidden="true" />} />
            <h3>{hasActiveFilter ? 'Nothing on the shelf matches' : 'The shelf is bare'}</h3>
            <p>
              {hasActiveFilter
                ? 'Drop a filter, widen the search, or take a look at what is stocked right now.'
                : 'No products are listed yet. The store may still be setting up.'}
            </p>
            {hasActiveFilter && (
              <div className="cat-empty-acts">
                <button className="glass-btn glass-btn-primary" onClick={clearAll}>
                  Clear all filters
                </button>
                {!showOOS && (
                  <button
                    className="glass-btn"
                    onClick={() => { setShowOOS(true); setSearchParams(prev => { prev.set('page', '1'); return prev; }); }}
                  >
                    <Eye size={14} aria-hidden="true" />
                    Include sold out
                  </button>
                )}
                {/* The one moment we KNOW the catalogue failed somebody.
                    Word search matched nothing, which is precisely the case
                    meaning search and the assistant exist for — a buyer
                    describing what they want in words the descriptions do not
                    use. Offering it here costs a button and is the only place
                    in the shop where we can be sure it is the right thing to
                    offer. Hidden when the assistant is unavailable, because a
                    shortcut to a feature this store does not run is worse than
                    no shortcut. */}
                {assistantOffered && search.trim() && (
                  <button
                    className="glass-btn"
                    onClick={() => askAssistant(`I am looking for ${search.trim()} — what would you suggest?`)}
                  >
                    <MessageCircleQuestion size={14} aria-hidden="true" />
                    Ask about it
                  </button>
                )}
              </div>
            )}
            {hasActiveFilter && categories.length > 0 && (
              <div className="cat-empty-cats">
                <span className="cat-empty-cats-label">In stock by category</span>
                <div className="cat-empty-cats-row">
                  {categories.slice(0, 8).map(c => (
                    <button key={c} type="button" className="cat-chip" onClick={() => { setShowOOS(false); setSearchParams({ category: c }); }}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!hasActiveFilter && (
              <div className="cat-empty-acts">
                <Link className="glass-btn" to="/">Back to the front page</Link>
                <Link className="glass-btn" to="/support">Ask the store</Link>
              </div>
            )}
          </div>
        ) : view === 'rows' ? (
          <div className="crow-list" role="table" aria-label="Catalog">
            <ProductRowsHead />
            {products.map(p => (
              <ProductRow
                key={p.id}
                product={p}
                canWish={!!user}
                wishlisted={!!p.variants?.[0] && isWishlisted(p.variants[0].id)}
                onToggleWishlist={toggleWishlist}
              />
            ))}
          </div>
        ) : (
          <div className="pcard-grid">
            {products.map(p => (
              <ProductCard
                key={p.id}
                product={p}
                canWish={!!user}
                wishlisted={!!p.variants?.[0] && isWishlisted(p.variants[0].id)}
                onToggleWishlist={toggleWishlist}
              />
            ))}
          </div>
        )}

        {!loading && total > PER_PAGE && (
          <nav className="cat-pager" aria-label="Catalog pages">
            <span className="cat-pager-range">
              {firstOnPage.toLocaleString()}–{lastOnPage.toLocaleString()} of {total.toLocaleString()}
            </span>
            <div className="cat-pager-controls">
              <button
                type="button"
                className="cat-pager-btn"
                onClick={() => goPage(page - 1)}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                <ChevronLeft size={15} aria-hidden="true" />
              </button>
              {/* Numbers on a wide viewport, a plain "3 / 11" on a phone —
                  eleven tap targets in a row is a mis-tap generator. */}
              <span className="cat-pager-nums">
                {pageWindow.map((n, i) => n === null
                  ? <span key={`gap${i}`} className="cat-pager-gap">…</span>
                  : (
                    <button
                      key={n}
                      type="button"
                      className={`cat-pager-num${n === page ? ' is-on' : ''}`}
                      onClick={() => goPage(n)}
                      aria-current={n === page ? 'page' : undefined}
                    >
                      {n}
                    </button>
                  ))}
              </span>
              <span className="cat-pager-of">{page} / {pageCount}</span>
              <button
                type="button"
                className="cat-pager-btn"
                onClick={() => goPage(page + 1)}
                disabled={page >= pageCount}
                aria-label="Next page"
              >
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            </div>
          </nav>
        )}
      </div>
    </div>
  );
}
