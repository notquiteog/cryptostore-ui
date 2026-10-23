import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { productStock, productThumb } from '../../utils/catalog';
import toast from 'react-hot-toast';
import {
  Package, PackageSearch, Plus, Search, Edit, Trash2, ChevronLeft, ChevronRight,
  Star, Layers, TrendingUp, DollarSign, AlertTriangle, X,
  Boxes, EyeOff, RotateCcw, FolderTree, FolderInput, Pencil, Coins,
} from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';
import { useAuth } from '../../context/AuthContext';
import { hasAdminPermission } from '../../utils/adminPermissions';

const PAGE_SIZE = 24;

/* The price sheet is fetched when somebody opens it. It is the largest thing
   on this page and the one most visits never touch, so it is not in the
   page's chunk — same reasoning as the lazy routes in App.jsx. */
const PriceSheet = lazy(() => import('../../components/admin/PriceSheet'));

/**
 * Mirrors the whitelist in server/controllers/productController.js listProducts.
 * An option this page offers that the switch there does not recognise falls
 * through to the shelf order with no error — a control that silently does
 * nothing — so the two lists have to be edited together.
 */
const SORT_OPTIONS = [
  { value: '', label: 'Shelf order' },
  { value: 'name_asc', label: 'Name A → Z' },
  { value: 'name_desc', label: 'Name Z → A' },
  { value: 'updated', label: 'Recently edited' },
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'price_asc', label: 'Price low → high' },
  { value: 'price_desc', label: 'Price high → low' },
  { value: 'stock_asc', label: 'Stock low → high' },
  { value: 'stock_desc', label: 'Stock high → low' },
];

const STOCK_OPTIONS = [
  { value: '', label: 'Any stock' },
  { value: 'in', label: 'In stock' },
  { value: 'low', label: 'Low stock' },
  { value: 'out', label: 'Out of stock' },
];

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

function relativeTime(value) {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return null;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/**
 * Group media first, then the first slot any variant carries.
 *
 * Shared with the storefront rather than re-derived: a slot may hold a video
 * now, whose still is its poster frame — and this list is the one place an
 * operator would notice a broken thumbnail last.
 */
function productImage(product) {
  return productThumb(product);
}

/**
 * Fractional stars: two identical rows stacked, the filled one clipped to the
 * rating's share of five. Cheaper and more legible than rounding to the nearest
 * half, which turns a 4.4 and a 4.6 into the same picture.
 */
function Stars({ value, size = 10 }) {
  const pct = Math.max(0, Math.min(100, ((Number(value) || 0) / 5) * 100));
  const row = (filled) => Array.from({ length: 5 }, (_, i) => (
    <Star key={i} size={size} fill={filled ? 'currentColor' : 'none'} strokeWidth={filled ? 0 : 1.6} />
  ));
  return (
    <span className="apr-stars" aria-hidden="true">
      <span className="apr-stars-track">{row(false)}</span>
      <span className="apr-stars-fill" style={{ width: `${pct}%` }}>{row(true)}</span>
    </span>
  );
}

/**
 * Everything the card prints, resolved once.
 *
 * `admin_stats` is the staff-only block listProducts attaches; the fallbacks
 * are what a caller without `products.view` would see, and they are drawn from
 * the active variants that always ship in the payload. They read low rather
 * than wrong — an inactive variant's units are simply not counted, which is
 * also the honest answer when the aggregate is unavailable.
 */
function readProduct(product, lowStockThreshold, revenueHidden) {
  const variants = product.variants || [];
  const s = product.admin_stats || null;

  const fallbackStock = productStock(product);
  const stockTotal = s ? s.stock_total : fallbackStock;
  // Units sitting on a switched-off variant are in the warehouse but not on the
  // shelf. They count toward inventory and never toward the health signal — a
  // card reading "139 units, healthy" beside a storefront saying sold out is the
  // one thing this page exists to prevent.
  const sellable = s ? s.stock_active : fallbackStock;
  const variantCount = s ? s.variant_count : variants.length;
  const activeVariants = s ? s.active_variant_count : variants.length;
  const stockedVariants = s
    ? s.in_stock_variant_count
    : variants.filter(v => (Number(v.quantity) || 0) > 0).length;

  const prices = variants.flatMap(v => [
    Number(v.price),
    ...(v.tiers || []).map(t => Number(t.price)),
  ]).filter(Number.isFinite);
  const priceMin = s && s.price_min != null ? s.price_min : (prices.length ? Math.min(...prices) : null);
  const priceMax = s && s.price_max != null ? s.price_max : (prices.length ? Math.max(...prices) : null);

  const out = sellable <= 0;
  const low = !out && sellable <= lowStockThreshold;

  return {
    image: productImage(product),
    stockTotal,
    sellable,
    heldBack: Math.max(0, stockTotal - sellable),
    variantCount,
    activeVariants,
    stockedVariants,
    priceMin,
    priceMax,
    out,
    low,
    onSale: variants.some(v => v.sale_price != null),
    unitsSold: s ? s.units_sold : null,
    orderCount: s ? s.order_count : null,
    revenue: s && !revenueHidden ? s.revenue : null,
    reviewCount: s ? s.review_count : null,
    rating: s ? s.average_rating : null,
    // Tone class: an inactive product is grey whatever its shelf holds, because
    // "50 units" on a product nobody can buy is not a healthy number.
    tone: !product.active ? 'is-off' : out ? 'is-out' : low ? 'is-low' : '',
  };
}

export default function AdminProducts() {
  const { user } = useAuth();

  const [products, setProducts] = useState([]);
  const [total, setTotal] = useState(0);
  const [lowStockThreshold, setLowStockThreshold] = useState(5);
  const [revenueHidden, setRevenueHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categories, setCategories] = useState([]);

  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const [stock, setStock] = useState('');
  const [sort, setSort] = useState('');
  /*
   * DESIGN §6, answered: this list is a TOGGLE, not a responsive table and not
   * two purpose-built views. A product is a picture — the thumbnail is how an
   * operator recognises the record before they have read a word of it — so the
   * comfortable card earns its width; but restocking a shelf means reading
   * forty stock figures down one axis, and that wants lines. Both shapes are
   * genuinely useful on the same monitor at different moments, which is exactly
   * the case §6 reserves the toggle for. Neither is a phone-only shape either:
   * the compact row half-folds rather than collapsing, so the two stay
   * distinguishable at 480px.
   *
   * The state used to be `'grid' | 'compact'` behind this page's own
   * `admin.products.density` key. It is `'cards' | 'rows'` under
   * `cs.view.admin-products.v1` now, shared with every other list in the app —
   * see hooks/useViewMode.js for why one module owns this. The old key is not
   * migrated: an operator who had chosen compact re-picks it once, which is a
   * cheaper trade than carrying a dead key name forward forever.
   */
  const [density, setDensity] = useViewMode('admin-products');
  // The one place the vocabulary meets the skin. The stylesheet has always
  // spelled the dense catalog `.apr-grid.is-compact`, across ~40 selectors and
  // four breakpoints; renaming all of them to chase a state rename would be a
  // far larger change than the rename is worth, and every one of those rules is
  // a place the two names could fall out of step. Mapped once, here.
  const compact = density === 'rows';

  /* ── Bulk category editing ───────────────────────────────────────────────
   *
   * `picked` holds group ids and deliberately survives paging, because the
   * whole point is that a selection spans pages: an operator filtering to
   * "Vapes" and working through four pages is making ONE decision, and a
   * selection that emptied itself on every page turn would be a control that
   * only ever worked on the last twenty-four products they looked at.
   *
   * It is NOT cleared when the filters change either, and that is the more
   * arguable half. Changing a filter while holding a selection is how somebody
   * assembles a set out of two searches, which is a real thing to want; the bar
   * always says how many are held, and clearing is one press. What it must
   * never do is act on anything but these ids — see the comment on
   * `assignCategory` in the controller for why the server takes ids and not a
   * filter.
   */
  const [picked, setPicked] = useState(() => new Set());
  const [catPanel, setCatPanel] = useState(null); // 'assign' | 'rename' | null
  const [catValue, setCatValue] = useState('');
  const [catBusy, setCatBusy] = useState(false);

  const [confirmId, setConfirmId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const canCreate = hasAdminPermission(user, 'products.create');
  const canEdit = hasAdminPermission(user, ['products.edit', 'products.stock', 'products.media']);
  const canDelete = hasAdminPermission(user, 'products.delete');

  // Typing a name should not fire a request per keystroke, and the pager has to
  // go home whenever the result set changes underneath it.
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [category, status, stock, sort]);

  // Pulled out of the effect because a category rename retires a name and an
  // assignment can invent one, so the dropdown has to be re-read after either.
  const fetchCategories = useCallback(() => (
    api.get('/products/categories')
      .then(list => setCategories(Array.isArray(list) ? list : []))
      .catch(() => setCategories([]))
  ), []);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  // A slow response for page 1 must not overwrite a fast one for page 2.
  const requestId = useRef(0);

  const fetchProducts = useCallback(() => {
    const mine = ++requestId.current;
    setLoading(true);

    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('limit', String(PAGE_SIZE));
    // The catalog hides sold-out products by default, which is precisely the
    // state an operator opens this page to fix. The explicit stock filter below
    // is the only thing that should narrow the list.
    params.set('in_stock_only', 'false');
    if (search) params.set('search', search);
    if (category) params.set('category', category);
    if (status) params.set('active', status);
    if (stock) params.set('stock', stock);
    if (sort) params.set('sort', sort);

    api.get(`/products?${params.toString()}`)
      .then(data => {
        if (mine !== requestId.current) return;
        setError(null);
        setProducts(data.products || []);
        setTotal(data.total || 0);
        if (typeof data.low_stock_threshold === 'number') setLowStockThreshold(data.low_stock_threshold);
        setRevenueHidden(data.revenue_hidden === true);
      })
      .catch(err => {
        if (mine !== requestId.current) return;
        // A failed request is not an empty catalog. Reporting one as the other
        // is how a rate-limited page ends up telling an operator their store
        // has no products in it.
        toast.error(err.message || 'Failed to load products');
        setError(err.message || 'The catalog could not be loaded.');
        setProducts([]);
        setTotal(0);
      })
      .finally(() => {
        if (mine === requestId.current) setLoading(false);
      });
  }, [page, search, category, status, stock, sort]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  const rows = useMemo(
    () => products.map(p => ({ product: p, view: readProduct(p, lowStockThreshold, revenueHidden) })),
    [products, lowStockThreshold, revenueHidden]
  );

  // Deliberately labelled "this page": these are sums over the 24 cards on
  // screen, not over the catalog. A tile that silently switched between the two
  // would be worse than no tile.
  const pageStats = useMemo(() => rows.reduce((acc, { view }) => ({
    units: acc.units + view.stockTotal,
    sold: acc.sold + (view.unitsSold || 0),
    revenue: acc.revenue + (view.revenue || 0),
    attention: acc.attention + (view.out || view.low ? 1 : 0),
  }), { units: 0, sold: 0, revenue: 0, attention: 0 }), [rows]);

  const togglePicked = useCallback((id) => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /* Everything on THIS page, added to whatever is already held — not replacing
     it, because the operator may have picked six on the previous page. The
     control flips to "Clear this page" once they are all in, so one button
     covers both directions without a second one to hunt for. */
  const pageIds = useMemo(() => products.map((p) => p.id), [products]);
  const allOnPagePicked = pageIds.length > 0 && pageIds.every((id) => picked.has(id));
  const togglePage = useCallback(() => {
    setPicked((prev) => {
      const next = new Set(prev);
      if (pageIds.every((id) => next.has(id))) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }, [pageIds]);

  /* ── Repricing what is picked ──
   *
   * The same selection, a different verb — and a materially more dangerous
   * one. It used to open a percentage box: move every live variant under the
   * picked products by N%, preview the pairs, apply. That could not set one
   * price, and it could not reach a volume tier at all. It opens the price
   * sheet now (components/admin/PriceSheet.jsx): every live variant with its
   * list price and its ladder as editable numbers, the percentage kept only as
   * a way to pre-fill the column, and a review step before the save that
   * counts what will change and marks what would sell below cost. The server
   * still refuses the whole batch if a colleague moved any of it since the
   * sheet was read; the sheet reloads and says which rows.
   */
  const [pricePanel, setPricePanel] = useState(false);
  const closePricePanel = () => setPricePanel(false);
  const onPricesSaved = async () => {
    closePricePanel();
    setPicked(new Set());
    await fetchProducts();
  };

  /* ── Deleting and hiding what is picked ──
   *
   * Delete is the only action on this bar that cannot be undone, so it has the
   * most between the press and the write: a preview that names every product,
   * counts the order lines still outstanding against each, and a confirm that
   * has to be pressed after reading it.
   *
   * Hiding sits in the same panel deliberately. It is almost always what was
   * meant — a product that should stop selling wants hiding, deleting is for
   * one that should never have existed — and putting the safe action beside
   * the irreversible one is what makes the choice visible instead of implied.
   */
  const [deletePanel, setDeletePanel] = useState(false);
  const [deletePreview, setDeletePreview] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const openDeletePanel = async () => {
    setDeletePanel(true);
    setCatPanel(null);
    closePricePanel();
    setDeleteBusy(true);
    try {
      setDeletePreview(await api.post('/products/bulk-delete', { group_ids: [...picked] }));
    } catch (err) {
      toast.error(err.message || 'Could not read those products');
      setDeletePanel(false);
    }
    setDeleteBusy(false);
  };

  const closeDeletePanel = () => { setDeletePanel(false); setDeletePreview(null); };

  const runBulkDelete = async () => {
    setDeleteBusy(true);
    try {
      const r = await api.post('/products/bulk-delete', {
        group_ids: [...picked],
        dry_run: false,
        // The open-order counts the panel showed. A product that has picked up
        // an order since refuses the whole delete — the warning the operator
        // read is only worth reading if it still describes the catalogue.
        expect: (deletePreview?.products || []).map((p) => ({ id: p.id, open_order_lines: p.open_order_lines })),
      });
      toast.success(`${r.deleted} product${r.deleted === 1 ? '' : 's'} deleted`);
      closeDeletePanel();
      setPicked(new Set());
      await Promise.all([fetchProducts(), fetchCategories()]);
    } catch (err) {
      if (err?.data?.code === 'orders_moved') {
        toast.error(err.message, { duration: 8000 });
        // Re-read, so the panel shows the order that just arrived rather than
        // the count that made the delete look safe.
        setDeletePreview(null);
        await openDeletePanel();
      } else {
        toast.error(err.message || 'That did not work');
      }
    }
    setDeleteBusy(false);
  };

  const runBulkVisibility = async (active) => {
    setDeleteBusy(true);
    try {
      const r = await api.post('/products/bulk-visibility', { group_ids: [...picked], active });
      toast.success(r.updated === 0
        ? `They are all ${active ? 'live' : 'hidden'} already`
        : `${r.updated} product${r.updated === 1 ? '' : 's'} ${active ? 'back on sale' : 'hidden'}`);
      closeDeletePanel();
      setPicked(new Set());
      await fetchProducts();
    } catch (err) {
      toast.error(err.message || 'That did not work');
    }
    setDeleteBusy(false);
  };

  /* The product count the rename was offered against.
   *
   * Held from the moment the panel opens rather than read at press time, so the
   * number checked is the one the operator was looking at. Cleared by a refusal,
   * which is what makes the second press go through. */
  const [catExpect, setCatExpect] = useState(null);

  const openCatPanel = (mode) => {
    setCatExpect(mode === 'rename' ? total : null);
    setCatPanel(mode);
    // Renaming starts from the current name so the common edit — a typo, a
    // plural, a capital letter — is a character away rather than a retype.
    setCatValue(mode === 'rename' ? category : '');
  };

  const runCategoryChange = async () => {
    setCatBusy(true);
    try {
      if (catPanel === 'rename') {
        // `expect_products` is the count the bar is showing. The server refuses
        // once if the category has grown or shrunk since — a product imported or
        // moved in between would otherwise be renamed without anybody seeing it.
        // Pressing again proceeds, which is the right weight for a label.
        const r = await api.post('/products/categories/rename', {
          from: category, to: catValue, expect_products: catExpect ?? total,
        });
        toast.success(`Renamed ${r.renamed} product${r.renamed === 1 ? '' : 's'} to “${r.to || 'Uncategorised'}”`);
        // The filter still names the old category, which no longer exists, so
        // the grid would come back empty and read as "the rename deleted
        // everything". Follow the products to their new name instead.
        setCategory(r.to || '');
      } else {
        const ids = [...picked];
        const r = await api.post('/products/categories/assign', { group_ids: ids, category: catValue });
        toast.success(`Moved ${r.updated} product${r.updated === 1 ? '' : 's'} to “${r.category || 'Uncategorised'}”`);
        setPicked(new Set());
      }
      setCatPanel(null);
      // Both the grid and the category dropdown are stale now: a rename can
      // retire a name and either action can create one.
      await Promise.all([fetchProducts(), fetchCategories()]);
    } catch (err) {
      if (err?.data?.code === 'category_moved') {
        // Dropping the expectation is what lets the next press succeed. The
        // operator has been told the number moved; insisting a second time is
        // them saying they meant it.
        setCatExpect(null);
        toast.error(err.message, { duration: 8000 });
        await fetchProducts();
      } else {
        toast.error(err.message || 'That did not work');
      }
    }
    setCatBusy(false);
  };

  const filtersActive = Boolean(search || category || status || stock || sort);
  const clearFilters = () => {
    setSearchInput(''); setSearch(''); setCategory(''); setStatus(''); setStock(''); setSort(''); setPage(1);
  };

  const deleteProduct = async (product) => {
    setDeletingId(product.id);
    try {
      await api.delete(`/products/${product.id}`);
      toast.success(`“${product.name}” deleted`);
      setConfirmId(null);
      // Deleting the last card on a page would otherwise leave the operator
      // staring at an empty grid with a live pager.
      if (products.length === 1 && page > 1) setPage(p => p - 1);
      else fetchProducts();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

  const subtitle = loading && products.length === 0
    ? 'Loading the catalog…'
    : error
      ? 'The catalog could not be loaded.'
      : total === 0
      ? (filtersActive ? 'Nothing matches these filters.' : 'No products in the catalog yet.')
      : `${total} product${total === 1 ? '' : 's'}${filtersActive ? ' matched' : ''}` +
        (pageStats.attention > 0 ? ` · ${pageStats.attention} need${pageStats.attention === 1 ? 's' : ''} restocking` : '');

  return (
    <div className="admin-page">
      <PageHeader icon={Package} title="Products" subtitle={subtitle}>
        {canCreate && (
          <Link to="/admin/products/new" className="glass-btn glass-btn-primary">
            <Plus size={18} /> Add product
          </Link>
        )}
      </PageHeader>

      {!loading && rows.length > 0 && (
        <div className="orders-stats">
          <div className="orders-stat-card" style={{ '--tone': 'var(--primary)', '--i': 0 }}>
            <span className="orders-stat-icon"><Layers size={15} /></span>
            <span className="orders-stat-value">{rows.length}</span>
            <span className="orders-stat-label">On this page</span>
          </div>
          <div className="orders-stat-card" style={{ '--tone': 'var(--success)', '--i': 1 }}>
            <span className="orders-stat-icon"><Boxes size={15} /></span>
            <span className="orders-stat-value">{pageStats.units.toLocaleString()}</span>
            <span className="orders-stat-label">Units on hand</span>
          </div>
          <div className="orders-stat-card" style={{ '--tone': 'var(--info)', '--i': 2 }}>
            <span className="orders-stat-icon"><TrendingUp size={15} /></span>
            <span className="orders-stat-value">{pageStats.sold.toLocaleString()}</span>
            <span className="orders-stat-label">Units sold</span>
          </div>
          <div className="orders-stat-card" style={{ '--tone': 'var(--success)', '--i': 3 }}>
            <span className="orders-stat-icon"><DollarSign size={15} /></span>
            <span className="orders-stat-value">{revenueHidden ? '—' : money(pageStats.revenue)}</span>
            <span className="orders-stat-label">{revenueHidden ? 'Revenue hidden' : 'Revenue'}</span>
          </div>
          <div
            className={`orders-stat-card${pageStats.attention > 0 ? ' is-urgent' : ''}`}
            style={{ '--tone': pageStats.attention > 0 ? 'var(--warning)' : 'var(--text-muted)', '--i': 4 }}
          >
            <span className="orders-stat-icon"><AlertTriangle size={15} /></span>
            <span className="orders-stat-value">{pageStats.attention}</span>
            <span className="orders-stat-label">Low or out</span>
          </div>
        </div>
      )}

      <div className="apr-toolbar">
        <div className="admin-search">
          <Search size={16} aria-hidden="true" />
          <input
            className="glass-input"
            type="search"
            placeholder="Search name or description…"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            aria-label="Search products"
          />
        </div>

        <div className="apr-filters">
          <select
            className="glass-input"
            value={category}
            onChange={e => setCategory(e.target.value)}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <select
            className="glass-input"
            value={status}
            onChange={e => setStatus(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="">Active &amp; inactive</option>
            <option value="true">Active only</option>
            <option value="false">Inactive only</option>
          </select>

          <select
            className="glass-input"
            value={stock}
            onChange={e => setStock(e.target.value)}
            aria-label="Filter by stock"
          >
            {STOCK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>

          <select
            className="glass-input"
            value={sort}
            onChange={e => setSort(e.target.value)}
            aria-label="Sort products"
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>

        <span className="apr-toolbar-spacer" />

        {/* The switch itself is components/ViewToggle.jsx — the same control,
            with the same two words, that the order queue and the buyer's own
            order list carry. This page used to hand-roll it and called the
            second half "Compact", so the same choice was named differently
            depending on which list you happened to be looking at. */}
        <ViewToggle value={density} onChange={setDensity} label="Product layout" />
      </div>

      {filtersActive && !loading && (
        <div className="apr-matchline">
          <span>
            {total === 0
              ? 'No products match the current filters.'
              : total === 1
                ? '1 product matches the current filters.'
                : `${total} products match the current filters.`}
          </span>
          <button type="button" className="glass-btn glass-btn-sm apr-clear" onClick={clearFilters}>
            <RotateCcw size={13} aria-hidden="true" /> Clear filters
          </button>
        </div>
      )}

      {loading ? (
        <div className={`apr-grid${compact ? ' is-compact' : ''}`} aria-busy="true" aria-label="Loading products">
          {Array.from({ length: compact ? 8 : 6 }, (_, i) => (
            <div key={i} className={`skeleton apr-skeleton${compact ? ' is-compact' : ''}`} />
          ))}
        </div>
      ) : error ? (
        <div className="glass-card empty-state is-error">
          <AlertTriangle aria-hidden="true" />
          <h3>The catalog could not be loaded</h3>
          <p>{error}</p>
          <button className="glass-btn glass-btn-primary" onClick={fetchProducts}>
            <RotateCcw size={16} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <div className="glass-card empty-state">
          <PackageSearch aria-hidden="true" />
          <h3>{filtersActive ? 'Nothing matches those filters' : 'No products yet'}</h3>
          <p>
            {filtersActive
              ? 'Try a broader search, or clear the filters to see the whole catalog.'
              : 'Create your first product, or import a catalog from Settings.'}
          </p>
          {filtersActive ? (
            <button className="glass-btn glass-btn-primary" onClick={clearFilters}>Clear all filters</button>
          ) : canCreate ? (
            <Link to="/admin/products/new" className="glass-btn glass-btn-primary">
              <Plus size={16} /> Add product
            </Link>
          ) : null}
        </div>
      ) : (
        <>
          {/* ── The category bar ────────────────────────────────────────────
           *
           * Two jobs on one strip, because they are the same job at two
           * scales. Renaming acts on a category by NAME and is offered only
           * while the filter names one, so the thing being renamed is the
           * thing on screen. Moving acts on the ids somebody picked and is
           * offered only once they have picked some.
           *
           * Always mounted when either applies rather than hidden behind a
           * "bulk edit" mode: a mode is a thing an operator has to know exists,
           * and the checkbox on each card is discoverable on its own.
           */}
          {canEdit && (category || picked.size > 0) && (
            <div className="glass-card apr-catbar" role="region" aria-label="Category tools">
              <div className="apr-catbar-main">
                <FolderTree size={16} aria-hidden="true" />
                {picked.size > 0 ? (
                  <span>
                    <strong>{picked.size}</strong> product{picked.size === 1 ? '' : 's'} picked
                    {category && <span className="apr-catbar-dim"> · filtered to “{category}”</span>}
                  </span>
                ) : (
                  <span>
                    Filtered to <strong>“{category}”</strong> — {total.toLocaleString()} product{total === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              <div className="apr-catbar-acts">
                {pageIds.length > 0 && (
                  <button type="button" className="glass-btn glass-btn-sm" onClick={togglePage}>
                    {allOnPagePicked ? 'Unpick this page' : `Pick all ${pageIds.length} on this page`}
                  </button>
                )}
                {picked.size > 0 && (
                  <>
                    <button type="button" className="glass-btn glass-btn-sm" onClick={() => setPicked(new Set())}>
                      Clear
                    </button>
                    <button
                      type="button"
                      className="glass-btn glass-btn-primary glass-btn-sm"
                      onClick={() => openCatPanel('assign')}
                    >
                      <FolderInput size={14} aria-hidden="true" /> Change category
                    </button>
                    {/* Not drawn as a peer of the category button. Repricing is
                        the one action on this bar that moves money, and a row
                        that draws it identically has not decided which of the
                        two the person is most likely to have meant. */}
                    <button
                      type="button"
                      className="glass-btn glass-btn-sm apr-catbar-money"
                      onClick={() => { setPricePanel(true); setCatPanel(null); closeDeletePanel(); }}
                    >
                      <Coins size={14} aria-hidden="true" /> Change prices
                    </button>
                    {/* Last on the row and drawn in danger, because it is the
                        one action here that cannot be undone. The panel it
                        opens offers hiding first — see openDeletePanel. */}
                    {canDelete && (
                      <button
                        type="button"
                        className="glass-btn glass-btn-danger glass-btn-sm"
                        onClick={openDeletePanel}
                      >
                        <Trash2 size={14} aria-hidden="true" /> Delete
                      </button>
                    )}
                  </>
                )}
                {category && picked.size === 0 && (
                  <button
                    type="button"
                    className="glass-btn glass-btn-primary glass-btn-sm"
                    onClick={() => openCatPanel('rename')}
                  >
                    <Pencil size={14} aria-hidden="true" /> Rename “{category}”
                  </button>
                )}
              </div>

              {catPanel && (
                <div className="apr-catpanel">
                  <label htmlFor="apr-cat-input">
                    {catPanel === 'rename'
                      ? `Rename “${category}” across every product in it`
                      : `Move ${picked.size} picked product${picked.size === 1 ? '' : 's'} to`}
                  </label>
                  <div className="apr-catpanel-row">
                    {/* A datalist rather than a select: the answer is usually an
                        existing category and occasionally a brand-new one, and
                        a dropdown cannot express the second. */}
                    <input
                      id="apr-cat-input"
                      className="glass-input"
                      list="apr-cat-options"
                      value={catValue}
                      placeholder="A category name, or leave empty to uncategorise"
                      onChange={(e) => setCatValue(e.target.value)}
                      maxLength={128}
                      autoFocus
                    />
                    <datalist id="apr-cat-options">
                      {categories.map((c) => <option key={c} value={c} />)}
                    </datalist>
                    <button
                      type="button"
                      className="glass-btn glass-btn-primary"
                      onClick={runCategoryChange}
                      disabled={catBusy || (catPanel === 'rename' && catValue.trim() === category)}
                    >
                      {catBusy ? 'Working…' : catPanel === 'rename' ? 'Rename' : 'Move'}
                    </button>
                    <button type="button" className="glass-btn" onClick={() => setCatPanel(null)} disabled={catBusy}>
                      Cancel
                    </button>
                  </div>
                  <small>
                    {catPanel === 'rename'
                      ? `Every product currently in “${category}” takes the new name. Nothing else about them changes — `
                        + 'not their variants, prices, stock or tags. Renaming onto a category that already exists merges the two.'
                      : 'Only the products you picked move. Nothing else about them changes.'}
                  </small>
                </div>
              )}

              {/* ── Repricing ──
                  The sheet, lazily. Its own fallback rather than the shell's:
                  the bar stays on screen and the panel arrives under it. */}
              {pricePanel && (
                <Suspense fallback={<div className="apr-catpanel"><p className="apr-del-count">Opening the price sheet…</p></div>}>
                  <PriceSheet groupIds={[...picked]} onSaved={onPricesSaved} onCancel={closePricePanel} />
                </Suspense>
              )}

              {/* ── Deleting ──
                  The preview is not optional and not a summary: every product
                  is named, and the ones with orders still outstanding say so on
                  their own line. A line deleted out from under an unpicked
                  order becomes a row on the pull list with no shelf to walk to,
                  which is invisible from this screen and is the whole reason
                  the count is here. */}
              {deletePanel && (
                <div className="apr-catpanel apr-delpanel">
                  <label>
                    Delete {picked.size} picked product{picked.size === 1 ? '' : 's'}
                  </label>

                  {deleteBusy && !deletePreview && <p className="apr-del-count">Reading them…</p>}

                  {deletePreview && (
                    <div className="apr-price-preview">
                      <p className="apr-del-count">
                        {deletePreview.total} product{deletePreview.total === 1 ? '' : 's'} would be removed.
                        {deletePreview.missing > 0 && ` ${deletePreview.missing} of the ones you picked no longer exist.`}
                      </p>
                      {deletePreview.entangled > 0 && (
                        <p className="apr-del-warn">
                          <AlertTriangle size={14} aria-hidden="true" />
                          {deletePreview.entangled} of them {deletePreview.entangled === 1 ? 'is' : 'are'} on
                          {' '}{deletePreview.open_order_lines} order line
                          {deletePreview.open_order_lines === 1 ? '' : 's'} that {deletePreview.open_order_lines === 1 ? 'has' : 'have'} not
                          finished. Past orders keep their names and prices either way, but a line
                          nobody has picked yet becomes a row on the pull list with no shelf.
                          Hiding them leaves those orders packable.
                        </p>
                      )}
                      <ul className="apr-price-rows">
                        {deletePreview.products.map((p) => (
                          <li key={p.id} className={p.open_order_lines > 0 ? 'is-entangled' : undefined}>
                            <span className="apr-price-name">
                              {p.name}
                              {p.category ? ` · ${p.category}` : ''}
                            </span>
                            <span className="apr-del-vars">
                              {p.variants} variant{p.variants === 1 ? '' : 's'}
                            </span>
                            <span className="apr-del-open">
                              {p.open_order_lines > 0 ? `${p.open_order_lines} on open orders` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* The safe action leads and the irreversible one is behind a
                      rule, in danger — the same order the order desk uses. */}
                  <div className="apr-catpanel-row apr-del-acts">
                    <button
                      type="button"
                      className="glass-btn glass-btn-primary"
                      onClick={() => runBulkVisibility(false)}
                      disabled={deleteBusy}
                    >
                      <EyeOff size={14} aria-hidden="true" /> Hide them instead
                    </button>
                    <button type="button" className="glass-btn" onClick={() => runBulkVisibility(true)} disabled={deleteBusy}>
                      Make live
                    </button>
                    <button type="button" className="glass-btn" onClick={closeDeletePanel} disabled={deleteBusy}>
                      Cancel
                    </button>
                    <span className="apr-del-sep" aria-hidden="true" />
                    <button
                      type="button"
                      className="glass-btn glass-btn-danger"
                      onClick={runBulkDelete}
                      disabled={deleteBusy || !deletePreview || deletePreview.total === 0}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      {deleteBusy ? 'Working…' : `Delete ${deletePreview?.total ?? ''} permanently`}
                    </button>
                  </div>

                  <small>
                    Deleting removes the product, its variants and its media. Past orders keep the
                    names and prices they were placed at — those are copied onto the order, not
                    read back from here.
                  </small>
                </div>
              )}
            </div>
          )}

          <div className={`apr-grid${compact ? ' is-compact' : ''}`}>
            {rows.map(({ product: p, view: v }, idx) => {
              const meterPct = v.variantCount > 0
                ? Math.round((v.stockedVariants / v.variantCount) * 100)
                : 0;
              // The headline is inventory; the tone and the caption are
              // sellability. Both are printed because an operator restocking
              // needs the first and an operator debugging a sold-out storefront
              // needs the second.
              const stockLabel = `${v.stockTotal.toLocaleString()} ${p.breakdown_enabled ? 'base ' : ''}unit${v.stockTotal === 1 ? '' : 's'}`;
              const stockCaption = v.heldBack > 0
                ? `${v.sellable.toLocaleString()} sellable`
                : v.out ? 'Out of stock' : v.low ? 'Low stock' : 'Stock';
              const edited = relativeTime(p.updated_at);

              return (
                <article
                  key={p.id}
                  className={`glass-card apr-card ${v.tone}`}
                  style={{ '--i': Math.min(idx, 11) }}
                >
                  <div className="apr-media">
                    {/* The pick control. A real checkbox rather than a card-wide
                        click target: the card already has two click targets that
                        matter more (the name opens the editor, the thumbnail is
                        the thing being identified), and turning the whole card
                        into a toggle would make opening a product to check it
                        before moving it impossible. */}
                    {canEdit && (
                      <label className={`apr-pick${picked.has(p.id) ? ' is-picked' : ''}`}>
                        <input
                          type="checkbox"
                          checked={picked.has(p.id)}
                          onChange={() => togglePicked(p.id)}
                          // Names no verb. The selection fed one action when it
                          // was built and now feeds two, and a label that
                          // promises a category change is a screen reader
                          // telling somebody the wrong thing about the button
                          // they are about to press.
                          aria-label={`Pick ${p.name} for a bulk edit`}
                        />
                      </label>
                    )}
                    {v.image
                      ? <img className="apr-thumb" src={v.image} alt="" loading="lazy" />
                      : <div className="apr-thumb-empty"><Package size={30} aria-hidden="true" /></div>}

                    {/* Stock and bundle state only. The active/inactive pill
                        lives beside the name instead, because the compact row
                        crops the thumbnail too narrow to hold a legible pill
                        and that is the one state with no other tell. */}
                    <div className="apr-flags">
                      <span className="apr-flags-right">
                        {v.out && <span className="apr-flag is-danger">Out of stock</span>}
                        {v.low && <span className="apr-flag is-warning">Low stock</span>}
                        {p.is_bundle && <span className="apr-flag">Bundle</span>}
                      </span>
                    </div>
                  </div>

                  <div className="apr-body">
                    <div className="apr-head">
                      <div className="apr-titles">
                        <div className="apr-eyebrow">
                          {[p.category, p.brand].filter(Boolean).join(' · ') || 'Uncategorised'}
                        </div>
                        <h3 className="apr-name">
                          {canEdit
                            ? <Link to={`/admin/products/${p.id}/edit`}>{p.name}</Link>
                            : p.name}
                        </h3>
                      </div>
                      <span className={`apr-state${p.active ? '' : ' is-off'}`}>
                        {p.active
                          ? 'Active'
                          : <><EyeOff size={10} aria-hidden="true" /> Inactive</>}
                      </span>
                    </div>

                    <div className="apr-price-row">
                      <span className="apr-price">
                        {v.priceMin == null
                          ? '—'
                          : v.priceMax != null && v.priceMax > v.priceMin
                            ? <>{money(v.priceMin)}<span className="apr-price-dash">–</span>{money(v.priceMax)}</>
                            : money(v.priceMin)}
                      </span>
                      {v.onSale
                        ? <span className="apr-sale">On sale</span>
                        : <span className="apr-price-note">
                            {v.variantCount === 1 ? 'single price' : 'incl. tier breaks'}
                          </span>}
                    </div>

                    <div className="apr-stock">
                      <div className="apr-stock-line">
                        <span className="apr-stock-caption">{stockCaption}</span>
                        <span className="apr-stock-value"><i className="apr-dot" />{stockLabel}</span>
                      </div>
                      <div
                        className="apr-meter"
                        role="img"
                        aria-label={`${v.stockedVariants} of ${v.variantCount} variants stocked`}
                        title={`${v.stockedVariants} of ${v.variantCount} variants stocked`}
                      >
                        <i style={{ width: `${meterPct}%` }} />
                      </div>
                    </div>

                    <div className="apr-stats">
                      <div className="apr-stat">
                        <span className="apr-stat-label"><Layers size={10} aria-hidden="true" /> Variants</span>
                        <span className="apr-stat-value">
                          {v.activeVariants === v.variantCount
                            ? v.variantCount
                            : `${v.activeVariants} of ${v.variantCount}`}
                        </span>
                      </div>
                      <div className="apr-stat">
                        <span className="apr-stat-label"><TrendingUp size={10} aria-hidden="true" /> Sold</span>
                        <span className={`apr-stat-value${v.unitsSold ? '' : ' is-muted'}`}
                          title={v.orderCount != null ? `${v.orderCount} order${v.orderCount === 1 ? '' : 's'}` : undefined}>
                          {v.unitsSold == null ? '—' : v.unitsSold.toLocaleString()}
                        </span>
                      </div>
                      <div className="apr-stat">
                        <span className="apr-stat-label"><DollarSign size={10} aria-hidden="true" /> Revenue</span>
                        <span className={`apr-stat-value${v.revenue ? '' : ' is-muted'}`}>
                          {v.revenue == null ? '—' : money(v.revenue)}
                        </span>
                      </div>
                      <div className="apr-stat">
                        <span className="apr-stat-label"><Star size={10} aria-hidden="true" /> Rating</span>
                        <span className={`apr-stat-value is-rating${v.reviewCount ? '' : ' is-muted'}`}>
                          {v.reviewCount ? (
                            <span className="apr-rating">
                              <Stars value={v.rating} />
                              <span className="apr-rating-num">
                                {Number(v.rating).toFixed(1)} ({v.reviewCount})
                              </span>
                            </span>
                          ) : v.reviewCount === 0 ? 'No reviews' : '—'}
                        </span>
                      </div>
                    </div>

                    {p.tags?.length > 0 && (
                      <div className="apr-tags">
                        {p.tags.slice(0, 4).map(t => <span key={t} className="apr-tag">{t}</span>)}
                        {p.tags.length > 4 && (
                          <span className="apr-tag is-more">+{p.tags.length - 4}</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="apr-foot">
                    <span className="apr-updated">{edited ? `Edited ${edited}` : `#${p.id}`}</span>
                    <div className="apr-actions">
                      {canEdit && (
                        <Link
                          to={`/admin/products/${p.id}/edit`}
                          className="glass-btn glass-btn-sm"
                          aria-label={`Edit ${p.name}`}
                          title="Edit"
                        >
                          <Edit size={14} aria-hidden="true" />
                        </Link>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          className="glass-btn glass-btn-danger glass-btn-sm"
                          onClick={() => setConfirmId(p.id)}
                          aria-label={`Delete ${p.name}`}
                          title="Delete"
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>

                  {confirmId === p.id && (
                    <div className="apr-confirm" role="alertdialog" aria-label={`Delete ${p.name}?`}>
                      <AlertTriangle size={26} className="apr-confirm-icon" aria-hidden="true" />
                      <div className="apr-confirm-title">Delete “{p.name}”?</div>
                      <p className="apr-confirm-body">
                        This also removes {v.variantCount} variant{v.variantCount === 1 ? '' : 's'},
                        {' '}its images, tags, tier prices
                        {v.reviewCount ? ` and ${v.reviewCount} review${v.reviewCount === 1 ? '' : 's'}` : ''}
                        {v.unitsSold ? `, and unlinks it from ${v.unitsSold} sold unit${v.unitsSold === 1 ? '' : 's'} of order history` : ''}.
                        {' '}This cannot be undone — switching it inactive keeps the record.
                      </p>
                      <div className="apr-confirm-actions">
                        <button
                          type="button"
                          className="glass-btn glass-btn-sm"
                          onClick={() => setConfirmId(null)}
                          disabled={deletingId === p.id}
                        >
                          <X size={14} aria-hidden="true" /> Cancel
                        </button>
                        <button
                          type="button"
                          className="glass-btn glass-btn-danger glass-btn-sm"
                          onClick={() => deleteProduct(p)}
                          disabled={deletingId === p.id}
                        >
                          {deletingId === p.id
                            ? <><span className="spinner spinner-inline" /> Deleting…</>
                            : <><Trash2 size={14} aria-hidden="true" /> Delete forever</>}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <div className="apr-pager">
            <span className="apr-pager-info">
              Showing {rangeStart}–{rangeEnd} of {total} product{total === 1 ? '' : 's'}
            </span>
            <div className="apr-pager-nav">
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                disabled={page === 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft size={16} aria-hidden="true" /> Prev
              </button>
              <span className="apr-pager-pos">{page} / {totalPages}</span>
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                Next <ChevronRight size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
