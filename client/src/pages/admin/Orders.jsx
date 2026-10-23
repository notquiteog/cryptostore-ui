import { writeOrderQueue } from '../../utils/orderQueue';
import BulkOrderReview from '../../components/admin/BulkOrderReview';
import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../utils/api';
import { ORDER_CHANGED } from '../../utils/orderEvents';
import { useAuth } from '../../context/AuthContext';
import { adminCapabilities } from '../../utils/adminPermissions';
import {
  num, money, count as fmtCount, orderRef, relTime, fullDate,
  shortDateTime, humanize, stagger,
} from '../../utils/adminFormat';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import StatTiles from '../../components/admin/StatTiles';
import Pager from '../../components/admin/Pager';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';
import toast from 'react-hot-toast';
import {
  Eye, Package, RefreshCw, CheckCircle, Truck, XCircle, ArrowRight, Clock,
  DollarSign, User, AlertTriangle, CreditCard, ShoppingBag, Layers, Zap,
  Search, ChevronDown, Download, Undo2, FilterX, AlertCircle, Hash, MapPin, Ticket, Wallet, Link2, Timer, PackageCheck, Boxes, Hand,
  Bookmark, X, Plus, NotepadText,
} from 'lucide-react';
import { ParcelChip } from '../../components/order/ParcelStatus';

/**
 * The staff order queue.
 *
 * Rebuilt from a table plus a duplicate set of mobile cards into one paginated
 * card grid, because the two renderings had already drifted: the cards never
 * grew the bulk-selection checkbox, and neither of them showed the timeline,
 * the items, the payment progress or the money breakdown that the list endpoint
 * has been returning all along. Everything on a card here comes from a field
 * that was already on the wire and simply had nowhere to go.
 *
 * Filtering, sorting, searching and counting are all server-side. That is not
 * an optimisation: a stat computed from "the twenty rows that happen to be on
 * this page" is a different number on every page, which is what the old
 * Revenue tile was.
 */

/** The lifecycle an order walks, in order. */
const TRACK = ['pending_payment', 'awaiting_confirmation', 'paid', 'accepted', 'shipped', 'delivered'];

/**
 * Statuses where the next move is ours, not the customer's.
 *
 * Mirrors the `nextAction` table below: these are exactly the states that have
 * a staff transition waiting. `pending_payment` is deliberately absent — the
 * store is waiting on money, and `ADMIN_TRANSITIONS` has no edge out of it.
 */
const ACTION_STATUSES = ['awaiting_confirmation', 'paid', 'accepted'];

const STATUS_TONE = {
  pending_payment: 'var(--text-muted)',
  awaiting_confirmation: 'var(--warning)',
  paid: 'var(--info)',
  accepted: 'var(--info)',
  shipped: 'var(--primary)',
  delivered: 'var(--success)',
  disputed: 'var(--danger)',
  cancelled: 'var(--text-muted)',
  refunded: 'var(--text-muted)',
};

const FILTERS = [
  { key: '', label: 'All' },
  { key: ACTION_STATUSES.join(','), label: 'Needs action' },
  { key: 'pending_payment', label: 'Unpaid' },
  { key: 'awaiting_confirmation', label: 'Confirming' },
  { key: 'paid', label: 'Paid' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'shipped', label: 'Shipped' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'disputed', label: 'Disputed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'refunded', label: 'Refunded' },
];

const SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'updated', label: 'Recently updated' },
  { key: 'total_high', label: 'Largest total', money: true },
  { key: 'total_low', label: 'Smallest total', money: true },
];

const PAYMENT_LABEL = {
  btc: 'Bitcoin', xmr: 'Monero', ltc: 'Litecoin',
  cash_in_mail: 'Cash in mail', zelle: 'Zelle',
};

/**
 * The staff transition available from each status.
 *
 * `needs` mirrors the server-side gate, so a button is only drawn when the
 * account behind it could actually complete the request. Rendering one whose
 * endpoint answers 403 is how a read-only manager ends up with two buttons that
 * do nothing but produce error toasts.
 */
const nextAction = {
  awaiting_confirmation: { status: 'paid', label: 'Mark paid', icon: CheckCircle, style: 'glass-btn-success', needs: 'orders.confirm_payment' },
  paid: { status: 'accepted', label: 'Accept', icon: ArrowRight, style: 'glass-btn-primary' },
  accepted: { status: 'shipped', label: 'Ship', icon: Truck, style: 'glass-btn-primary' },
  shipped: { status: 'delivered', label: 'Mark delivered', icon: Package, style: '' },
};

/** Statuses `ADMIN_TRANSITIONS` allows to travel to `refunded`. */
const REFUNDABLE = ['paid', 'disputed', 'cancelled'];

/**
 * The queue as the operator left it.
 *
 * Opening an order from page 3 of "accepted, Zelle, sorted oldest" and
 * pressing back used to land on page 1 of everything, with the selection
 * gone and the scroll at the top — so working through a queue meant
 * re-finding the place after every order. Filters, sort, page, the search,
 * the selection, the open drawers and the scroll position are kept for the
 * session and restored on the next visit that arrives without a filter in
 * the URL. A link that carries `?search=` or `?status=` still wins, because
 * that link was asking for something specific.
 *
 * Session storage, not local: a queue is a shift's state, not a preference.
 * Nothing here is order data — it is which pills were pressed.
 */
const QUEUE_STATE_KEY = 'cs.admin-orders.queue.v1';
function readQueueState() {
  try {
    const raw = sessionStorage.getItem(QUEUE_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeQueueState(state) {
  try { sessionStorage.setItem(QUEUE_STATE_KEY, JSON.stringify(state)); } catch { /* a queue that forgets is still a queue */ }
}

/**
 * Named filter sets, saved per browser.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * The queue above already remembers where you were within a SESSION. What it
 * cannot do is hold more than one place at a time, and a dispatcher's morning
 * is a handful of specific questions — "paid, fully picked, no tracking",
 * "everything flagged by a carrier", "Zelle, oldest first". Each was rebuilt
 * from the pills every time, every day.
 *
 * ── Why `localStorage` and not a table ──────────────────────────────────────
 *
 * Two reasons, and the second is the one that decided it.
 *
 * A view is a preference rather than shop data, so it belongs where the
 * density toggle lives — it is which pills were pressed, nothing more. And
 * putting it in Postgres would mean a filter set can contain `query`, which is
 * free text a staff member typed — often a username or an order reference —
 * and the shop would then be holding a durable list of which staff member
 * repeatedly searches for which buyer. `CLAUDE.md`'s rule is that capability
 * the server does not have cannot be taken from it, and a saved-search table
 * is precisely the kind of thing that is cheap to add and awkward to explain
 * to somebody reading a seized disk.
 *
 * The cost is honest and worth stating: views do not follow a person between
 * browsers. That is the right trade for something that is rebuilt in four
 * clicks if it is ever lost.
 */
const QUEUE_VIEWS_KEY = 'cs.admin-orders.views.v1';
const MAX_VIEWS = 12;

function readViews() {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUE_VIEWS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((v) => v && typeof v.name === 'string').slice(0, MAX_VIEWS) : [];
  } catch { return []; }
}
function writeViews(views) {
  try { localStorage.setItem(QUEUE_VIEWS_KEY, JSON.stringify(views.slice(0, MAX_VIEWS))); } catch { /* ignore */ }
}

/** The filter axes a view holds. Everything else — page, scroll, selection —
 *  is where you were, not what you were looking at. */
const VIEW_AXES = ['status', 'parcel', 'noted', 'method', 'sort', 'limit', 'query', 'columns', 'density'];
const viewFrom = (f) => Object.fromEntries(VIEW_AXES.map((k) => [k, f[k] ?? '']));
const sameView = (a, b) => VIEW_AXES.every((k) => String(a?.[k] ?? '') === String(b?.[k] ?? ''));

/**
 * Whose move this order is, and what is blocking it.
 *
 * The transition button in the footer is the operator's CONTROL; this is
 * the diagnosis, and the two answer different questions. "Accept" says what
 * the button does. "Paid and not yet accepted — nothing is picked until it
 * is" says why the order is sitting in the queue, which is what an operator
 * scanning forty cards is actually asking. The object is the server's own
 * (utils/orderNextAction.js), computed against this viewer's permissions
 * after redaction, and it is the same one the buyer's list, the order page,
 * the home widget and both bots draw — so nobody is told a different story.
 *
 * The label links to where the action lives: the pack bench, the Ship desk,
 * the dispute desk, or the order page's own panel.
 */
function NowLine({ action }) {
  if (!action || action.actor === 'none') return null;
  return (
    <div className={`acard-now${action.actor === 'store' ? ' is-store' : ''}`}>
      <Link to={action.href} className="acard-now-label" title={action.reason}>
        <Timer size={11} aria-hidden="true" /> {action.label}
      </Link>
      <span className="acard-now-who">{action.responsibility}</span>
      <span className="acard-now-reason">{action.reason}</span>
    </div>
  );
}

/**
 * The server nulls a field the viewer holds no permission for and marks the
 * record `redacted`. Rendering a withheld total as $0.00 would read as a free
 * order, so every money cell goes through here first.
 */
function Hidden({ what = 'this value' }) {
  return (
    <span className="acard-hidden" title={`Hidden — you do not have permission to see ${what}`}>
      Hidden
    </span>
  );
}

/**
 * Did the server actually withhold this field?
 *
 * The shared `isRedacted` treats any null on a record marked `redacted` as
 * withheld, which is right when the server sends no field list and wrong when
 * it does: an order redacted only for customer identity still carries a
 * legitimately-empty `refund_amount`, and reading that as "Hidden" tells the
 * operator a permission problem exists where there is only an absent value.
 * When `redacted_fields` is present it is the whole truth.
 */
function withheld(record, field) {
  if (!record?.redacted) return false;
  if (Array.isArray(record.redacted_fields)) return record.redacted_fields.includes(field);
  return record[field] === null || record[field] === undefined;
}

/** The buyer, however much of them this viewer is allowed to know. */
function customerName(order) {
  if (order.username) return order.username;
  if (order.customer_ref) return `customer ${order.customer_ref}`;
  if (order.user_id != null) return `uid:${order.user_id}`;
  return 'Hidden';
}

export default function AdminOrders() {
  const { user } = useAuth();
  const can = useMemo(() => adminCapabilities(user), [user]);
  const [searchParams] = useSearchParams();

  const [orders, setOrders] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, limit: 20, counts: {}, totals: null, requireTracking: false, claimMinutes: 20 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const startKey = `cs.admin-orders.start.v1:${user?.id}`;
  const startingView = useMemo(() => {
    try { const saved = JSON.parse(localStorage.getItem(startKey) || 'null'); if (saved && typeof saved === 'object') return saved; } catch { /* optional preference */ }
    return { status: can.isAdmin ? '' : can.pickOrders || can.manageTracking ? 'accepted' : can.confirmPayment ? 'awaiting_confirmation' : '', sort: 'oldest', columns: 'total,items,payment,placed', density: can.isAdmin ? 'cards' : 'rows' };
  }, [startKey, can]);

  // What this session left behind — unless the URL asks for something
  // specific, in which case the link wins. Read once, at mount.
  const remembered = useMemo(
    () => (searchParams.has('search') || searchParams.has('status') || searchParams.has('parcel') ? {} : readQueueState() || startingView),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [page, setPage] = useState(() => Math.max(1, Number(remembered?.page) || 1));
  // Other pages link in with a filter already chosen — the Users page sends
  // "every order from this customer" as `?search=`. Read once at mount and
  // again whenever the URL changes, so arriving from a link lands on the
  // filtered queue rather than on page one of everything.
  const [status, setStatus] = useState(() => searchParams.get('status') || remembered?.status || '');
  // "Flagged by the carrier" — a delivery exception or a return on a parcel.
  // Its own axis rather than a status, because the order underneath is still
  // `shipped`; the dashboard tile links here with it set.
  const [parcel, setParcel] = useState(() => searchParams.get('parcel') || remembered?.parcel || '');
  // Orders the floor has written a note on. The column has a partial index for
  // this exact question (20261113000000) and nothing was asking it — a note
  // that can only be found by opening the order it is on is a note to yourself.
  const [noted, setNoted] = useState(() => searchParams.get('noted') || remembered?.noted || '');
  const [method, setMethod] = useState(() => remembered?.method || '');
  const [sort, setSort] = useState(() => remembered?.sort || 'newest');
  const [limit, setLimit] = useState(() => Number(remembered?.limit) || 20);
  const [searchInput, setSearchInput] = useState(() => searchParams.get('search') || remembered?.query || '');
  const [query, setQuery] = useState(() => searchParams.get('search') || remembered?.query || '');
  // Cards or line items, remembered. This was `useState('grid')` — the one
  // toggle of the three in the app that persisted nothing, so an operator
  // who wanted the compact queue re-chose it every single time they came
  // back to the page. See hooks/useViewMode.js.
  const [density, setDensity] = useViewMode('admin-orders', remembered?.density || 'cards');

  const urlSearch = searchParams.get('search') || '';
  const urlStatus = searchParams.get('status') || '';
  const urlParcel = searchParams.get('parcel') || '';
  // The URL as last applied. Compared rather than flagged: a "first run"
  // boolean was tried and lost the remembered filters in development, where
  // StrictMode runs every mount effect twice — the second run saw the flag
  // already set and reset the queue to page one of everything. A comparison
  // is right on both runs, because the URL has not changed on either.
  const appliedUrl = useRef({ search: urlSearch, status: urlStatus, parcel: urlParcel });
  useEffect(() => {
    // One-way: the URL seeds the controls, the controls never write back. A
    // round trip here would fight the debounce and rewrite history per
    // keystroke.
    //
    // Only a URL that actually CHANGED applies. The initial state already
    // came from the URL, or from the remembered queue when the URL carried
    // nothing, and re-applying it on mount would throw the remembered
    // filters away.
    if (appliedUrl.current.search === urlSearch && appliedUrl.current.status === urlStatus && appliedUrl.current.parcel === urlParcel) return;
    appliedUrl.current = { search: urlSearch, status: urlStatus, parcel: urlParcel };
    setSearchInput(urlSearch);
    setQuery(urlSearch);
    setStatus(urlStatus);
    setParcel(urlParcel);
    setPage(1);
  }, [urlSearch, urlStatus, urlParcel]);

  const [selected, setSelected] = useState(() => new Set(Array.isArray(remembered?.selected) ? remembered.selected : []));
  const [expanded, setExpanded] = useState(() => new Set(Array.isArray(remembered?.expanded) ? remembered.expanded : []));

  // Keep the queue's state as it changes, and the scroll position on the way
  // out. Restored above on the next visit.
  useEffect(() => {
    const prev = readQueueState() || {};
    writeQueueState({
      ...prev, status, method, sort, limit, page, query,
      selected: [...selected], expanded: [...expanded],
    });
  }, [status, method, sort, limit, page, query, selected, expanded]);
  useEffect(() => {
    const keepScroll = () => writeQueueState({ ...(readQueueState() || {}), scrollY: window.scrollY });
    window.addEventListener('pagehide', keepScroll);
    return () => { keepScroll(); window.removeEventListener('pagehide', keepScroll); };
  }, []);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [bulkAction, setBulkAction] = useState('status');
  const [bulkStatus, setBulkStatus] = useState('accepted');
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkReview, setBulkReview] = useState(null);
  const [exporting, setExporting] = useState(false);

  /**
   * One clock for the whole page.
   *
   * Every card shows a relative age. A timer per card is twenty intervals and
   * twenty re-renders a minute; one here re-renders the page once and every
   * card reads the same instant, so two orders placed together never disagree
   * about how old they are.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // Search fires per keystroke; without a sequence number a slow response for
  // "ab" can land after the response for "abcd" and repaint the grid with the
  // wrong rows.
  const seqRef = useRef(0);

  const fetchOrders = useCallback(async ({ quiet = false } = {}) => {
    const seq = ++seqRef.current;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
      if (status) params.set('status', status);
      if (parcel) params.set('parcel', parcel);
      if (noted) params.set('noted', noted);
      if (method) params.set('payment_method', method);
      if (query) params.set('search', query);

      // `scope=all` is what asks for the shop's queue rather than this
      // staff member's own orders — see getOrders. The permission still
      // decides whether it may be had.
      const data = await api.get(`/orders?scope=all&${params}`);
      if (seq !== seqRef.current) return;

      setOrders(data.orders || []);
      setMeta({
        total: Number(data.total || 0),
        totalPages: Math.max(1, Number(data.totalPages || 1)),
        // Render from what the server applied, not what was asked for: `limit`
        // is clamped to 100 server-side and a refused sort silently becomes
        // `newest`.
        limit: Number(data.limit || limit),
        counts: data.counts || {},
        totals: data.totals || null,
        requireTracking: !!data.fulfilment?.require_tracking,
        claimMinutes: Number(data.fulfilment?.claim_minutes) || 20,
      });
      if (data.sort && data.sort !== sort) setSort(data.sort);
      // Keep whatever is still on the page selected — an operator coming back
      // from an order they opened mid-selection finds their ticks where they
      // left them — and drop the rest, which a filter or a page turn has
      // taken out of reach.
      setSelected((prev) => {
        const onPage = new Set((data.orders || []).map((o) => o.uuid));
        const next = new Set([...prev].filter((uuid) => onPage.has(uuid)));
        return next.size === prev.size ? prev : next;
      });
      setError(null);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err.message || 'Failed to load orders');
      toast.error(err.message || 'Failed to load orders');
    } finally {
      if (seq === seqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [page, limit, sort, status, parcel, noted, method, query]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // The scroll position, once, after the first load has drawn the rows it
  // was measured against. Any later load is the operator's own doing.
  const scrollRestored = useRef(false);
  useEffect(() => {
    if (loading || scrollRestored.current) return;
    scrollRestored.current = true;
    const y = Number(remembered?.scrollY) || 0;
    if (y > 0) window.scrollTo({ top: y, behavior: 'auto' });
  }, [loading, remembered]);

  // Debounce typing into a committed query so the list is not refetched on
  // every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // An order moved from somewhere that is not this page — a button on an
  // assistant card in the navbar panel. Quiet, because the operator did the
  // thing and is looking at the queue expecting it to follow; a spinner over
  // the rows would say "something happened" about a change they just made.
  // See utils/orderEvents.js.
  useEffect(() => {
    const onChanged = () => fetchOrders({ quiet: true });
    window.addEventListener(ORDER_CHANGED, onChanged);
    return () => window.removeEventListener(ORDER_CHANGED, onChanged);
  }, [fetchOrders]);

  // A filter that narrows the result set can strand the viewer past the last
  // page — the server echoes the page it was asked for, so the pager would
  // otherwise read "Page 7 of 2" over an empty grid.
  useEffect(() => {
    if (!loading && orders.length === 0 && page > meta.totalPages) setPage(meta.totalPages);
  }, [loading, orders.length, page, meta.totalPages]);

  /** Change a filter and go back to the first page — page 4 of the old result. */
  const resetTo = (fn) => { fn(); setPage(1); };

  const clearFilters = () => resetTo(() => {
    setStatus(''); setParcel(''); setNoted(''); setMethod(''); setSearchInput(''); setQuery('');
  });

  const isFiltered = status !== '' || parcel !== '' || noted !== '' || method !== '' || query !== '';

  /* ── Saved views ──────────────────────────────────────────────────────── */

  const [views, setViews] = useState(readViews);
  const [columns, setColumns] = useState(() => remembered?.columns ?? 'total,items,payment,placed');
  const current = { status, parcel, noted, method, sort, limit, query, columns, density };
  // Which saved view, if any, the queue is currently showing. Compared on the
  // filter axes rather than tracked as "the one I clicked", so changing a pill
  // after applying a view correctly stops it reading as that view.
  const activeView = views.find((v) => sameView(v, current)) || null;

  const applyView = (view) => resetTo(() => {
    setColumns(view.columns ?? 'total,items,payment,placed');
    if (view.density) setDensity(view.density);
    setStatus(view.status || '');
    setParcel(view.parcel || '');
    setNoted(view.noted || '');
    setMethod(view.method || '');
    setSort(view.sort || 'newest');
    setLimit(Number(view.limit) || 20);
    // The search box and the applied query move together — setting only the
    // applied one leaves the input showing the previous view's text.
    setSearchInput(view.query || '');
    setQuery(view.query || '');
  });

  const saveView = () => {
    const name = window.prompt('Name this view', activeView?.name || '')?.replace(/\s+/g, ' ').trim();
    if (!name) return;
    const next = [
      { name: name.slice(0, 40), ...viewFrom(current) },
      // Saving over a name replaces it rather than making a second view with
      // the same label, which is what somebody pressing Save twice means.
      ...views.filter((v) => v.name.toLowerCase() !== name.toLowerCase()),
    ].slice(0, MAX_VIEWS);
    setViews(next);
    writeViews(next);
    toast.success(`Saved "${name}"`);
  };

  const removeView = (view) => {
    const next = views.filter((v) => v.name !== view.name);
    setViews(next);
    writeViews(next);
  };

  useEffect(() => {
    writeQueueState({ ...(readQueueState() || {}), columns, parcel, density });
  }, [columns, parcel, density]);
  useEffect(() => {
    if (loading || !orders.length) return;
    const target = searchParams.get('queueReturn');
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(`queue-order-${target}`);
      if (row) { row.scrollIntoView({ block: 'center' }); row.querySelector('a[href^="/orders/"]')?.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [loading]);
  const rememberNavigation = e => {
    const link = e.target.closest?.('a[href^="/orders/"]');
    if (!link) return;
    writeOrderQueue(user.id, { ids: orders.map(o => o.uuid), page, limit, total: meta.total,
      filters: { status, parcel, payment_method: method, sort, search: query } });
  };

  const counts = meta.counts;
  const sumOf = useCallback(
    (keys) => keys.reduce((total, key) => total + Number(counts[key] || 0), 0),
    [counts],
  );

  const allCount = Object.values(counts).reduce((total, n) => total + Number(n || 0), 0);
  const needsAction = sumOf(ACTION_STATUSES);
  const disputed = Number(counts.disputed || 0);
  const unpaid = sumOf(['pending_payment']);

  const stats = [
    {
      key: 'matching',
      label: isFiltered ? 'Matching' : 'All orders',
      value: fmtCount(meta.total),
      icon: Layers,
      tone: 'var(--primary)',
      hint: isFiltered ? 'under current filters' : undefined,
    },
    {
      key: 'action',
      label: 'Need action',
      value: fmtCount(needsAction),
      icon: Zap,
      tone: 'var(--warning)',
      urgent: needsAction > 0,
      active: status === ACTION_STATUSES.join(','),
      onClick: () => resetTo(() => setStatus(
        status === ACTION_STATUSES.join(',') ? '' : ACTION_STATUSES.join(','),
      )),
      title: 'Orders waiting on a staff decision',
    },
    {
      key: 'unpaid',
      label: 'Awaiting payment',
      value: fmtCount(unpaid),
      icon: Timer,
      tone: 'var(--text-muted)',
      active: status === 'pending_payment',
      onClick: () => resetTo(() => setStatus(status === 'pending_payment' ? '' : 'pending_payment')),
      title: 'Placed but not yet funded',
    },
    {
      key: 'parcels',
      label: 'Flagged by carrier',
      value: parcel === 'attention' ? fmtCount(meta.total) : '',
      icon: Truck,
      tone: 'var(--danger)',
      active: parcel === 'attention',
      onClick: () => resetTo(() => setParcel(parcel === 'attention' ? '' : 'attention')),
      title: 'Parcels the carrier reports as a delivery exception or a return',
    },
    {
      key: 'noted',
      label: 'Has a staff note',
      value: noted === '1' ? fmtCount(meta.total) : '',
      icon: NotepadText,
      tone: 'var(--info)',
      active: noted === '1',
      onClick: () => resetTo(() => setNoted(noted === '1' ? '' : '1')),
      title: 'Orders somebody on the floor has written something on',
    },
    disputed > 0 && {
      key: 'disputed',
      label: 'Disputed',
      value: fmtCount(disputed),
      icon: AlertTriangle,
      tone: 'var(--danger)',
      urgent: true,
      active: status === 'disputed',
      onClick: () => resetTo(() => setStatus(status === 'disputed' ? '' : 'disputed')),
    },
    {
      key: 'revenue',
      label: 'Revenue',
      // `totals` is omitted entirely for a viewer without the money
      // permission — an em dash, never a zero.
      value: meta.totals ? money(meta.totals.revenue) : <Hidden what="order totals" />,
      icon: DollarSign,
      tone: 'var(--success)',
      hint: meta.totals ? 'excludes cancelled and refunded' : undefined,
    },
  ];

  const markBusy = (id, busy) => setBusyIds((prev) => {
    const next = new Set(prev);
    if (busy) next.add(id); else next.delete(id);
    return next;
  });

  const updateStatus = async (order, newStatus) => {
    const id = order.uuid || order.id;
    markBusy(order.id, true);
    try {
      await api.put(`/orders/${id}/status`, { status: newStatus });
      toast.success(`Order ${orderRef(order)} → ${humanize(newStatus)}`);
      fetchOrders({ quiet: true });
    } catch (err) {
      toast.error(err.message || 'Could not update the order');
    } finally {
      markBusy(order.id, false);
    }
  };

  const cancelOrder = async (order) => {
    if (!confirm(
      `Cancel order ${orderRef(order)}?\n\n`
      + 'Stock goes back to the catalog and any coupon or store credit is returned. '
      + 'This cannot be undone.',
    )) return;
    markBusy(order.id, true);
    try {
      await api.post(`/orders/${order.uuid || order.id}/cancel`, {});
      toast.success(`Order ${orderRef(order)} cancelled`);
      fetchOrders({ quiet: true });
    } catch (err) {
      toast.error(err.message || 'Could not cancel the order');
    } finally {
      markBusy(order.id, false);
    }
  };

  const refundOrder = async (order) => {
    const amount = withheld(order, 'total') ? null : num(order.total);
    if (!confirm(
      `Refund order ${orderRef(order)}?\n\n`
      + (amount != null ? `The buyer is owed ${money(amount)}. ` : '')
      + 'This settles any open dispute on the order and is terminal — '
      + 'a refunded order cannot move again. This cannot be undone.',
    )) return;
    markBusy(order.id, true);
    try {
      await api.put(`/orders/${order.uuid || order.id}/status`, { status: 'refunded' });
      toast.success(`Order ${orderRef(order)} refunded`);
      fetchOrders({ quiet: true });
    } catch (err) {
      toast.error(err.message || 'Could not refund the order');
    } finally {
      markBusy(order.id, false);
    }
  };

  const toggleSelect = (order) => setSelected((prev) => {
    const next = new Set(prev);
    // The bulk endpoint matches on uuid and silently fails every numeric id, so
    // the selection is keyed the same way the request will be.
    const key = order.uuid;
    if (!key) return prev;
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const selectableUuids = useMemo(() => orders.map((o) => o.uuid).filter(Boolean), [orders]);
  const allSelected = selectableUuids.length > 0 && selected.size === selectableUuids.length;

  const executeBulk = () => {
    if (!selected.size) return;
    setBulkReview({ orderUuids: [...selected], action: bulkAction, status: bulkStatus });
  };

  /**
   * Pull the export through fetch rather than letting the browser navigate.
   * A top-level navigation carries no Authorization header and the JWT lives in
   * localStorage, so an `<a href download>` saves a 401 body to disk as the
   * "export". `api.get` cannot be used either — it always parses JSON and this
   * endpoint sends text/csv.
   */
  const handleExport = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('token');
      // The same filters the queue is showing, so the file holds what the
      // screen holds. The server reads them through the list endpoint's own
      // scope builder (orderController.orderListScope); nothing about which
      // rows match is decided here.
      const params = new URLSearchParams({ sort });
      if (status) params.set('status', status);
      if (method) params.set('payment_method', method);
      if (query) params.set('search', query);
      const res = await fetch(`/api/coupons/orders-export?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Export failed (HTTP ${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = isFiltered ? 'orders-filtered.csv' : 'orders.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (err) {
      toast.error(err.message || 'Failed to export orders');
    }
    setExporting(false);
  };

  const toggleExpanded = (id) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const subtitle = loading
    ? 'Loading the queue…'
    : error
      ? 'The queue could not be loaded.'
      : meta.total === 0
        ? (isFiltered ? 'Nothing matches these filters.' : 'No orders have been placed yet.')
        : needsAction > 0 || disputed > 0
          ? `${needsAction} awaiting action${disputed > 0 ? ` · ${disputed} disputed` : ''}`
          : `${fmtCount(meta.total)} order${meta.total === 1 ? '' : 's'}, none waiting on you`;

  return (
    <div onClickCapture={rememberNavigation} className="admin-page">
      {bulkReview && <BulkOrderReview request={bulkReview} onClose={() => setBulkReview(null)} onApplied={result => {
        setSelected(new Set(result.items.filter(i => !i.eligible).map(i => i.uuid)));
        fetchOrders({ quiet: true });
      }} />}
      <PageHeader icon={ShoppingBag} title="Orders" subtitle={subtitle}>
        {/* `staff-queues` and `find_stuck_orders` both read this queue. The
            queue is where somebody wonders which end of it to start at. */}
        <AskAbout
          question="What is stuck in the order queue right now, and what has been waiting longest?"
          label="Ask"
          title="Ask the assistant what is stuck"
        />
        {can.exportOrders && (
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={handleExport}
            disabled={exporting}
            title={isFiltered
              ? `Downloads the ${fmtCount(meta.total)} order${meta.total === 1 ? '' : 's'} matching the current filters as CSV.`
              : 'Downloads every order in the store as CSV.'}
          >
            {exporting ? <span className="spinner spinner-inline" /> : <Download size={14} aria-hidden="true" />}
            {isFiltered ? `Export ${fmtCount(meta.total)} matching` : 'Export all'}
          </button>
        )}
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => fetchOrders({ quiet: true })}
          disabled={refreshing}
        >
          {refreshing ? <span className="spinner spinner-inline" /> : <RefreshCw size={14} aria-hidden="true" />}
          Refresh
        </button>
      </PageHeader>

      <StatTiles stats={stats} />

      <div className="admin-toolbar is-sticky">
        <div className="status-filter-row" role="group" aria-label="Filter orders by status">
          {FILTERS.map((f) => {
            // `meta.total` is the count *after* the status filter, so using it
            // here made the All pill agree with whichever pill was selected —
            // "All 3" next to "Shipped 3". `counts` is grouped over the search
            // scope without the status filter, so its sum is the real total.
            const n = f.key === '' ? allCount : sumOf(f.key.split(','));
            return (
              <button
                key={f.key || 'all'}
                type="button"
                className={`status-filter-pill${status === f.key ? ' active' : ''}`}
                onClick={() => resetTo(() => setStatus(f.key))}
                aria-pressed={status === f.key}
              >
                {f.label}
                <span className="status-filter-count">{fmtCount(n)}</span>
              </button>
            );
          })}
        </div>

        <div className="admin-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="glass-input"
            type="search"
            placeholder={can.seeCustomer ? 'Order id, customer, product…' : 'Order id or product…'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search orders"
          />
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-toolbar-group">
          <label className="admin-toolbar-label" htmlFor="orders-sort">Sort</label>
          <select
            id="orders-sort"
            className="glass-input"
            value={sort}
            onChange={(e) => resetTo(() => setSort(e.target.value))}
            aria-label="Sort orders"
          >
            {SORTS.filter((s) => !s.money || can.seeTotals || can.isAdmin).map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>

          <label className="admin-toolbar-label" htmlFor="orders-method">Payment</label>
          <select
            id="orders-method"
            className="glass-input"
            value={method}
            onChange={(e) => resetTo(() => setMethod(e.target.value))}
            aria-label="Filter by payment method"
          >
            <option value="">Any method</option>
            {Object.entries(PAYMENT_LABEL).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        <span className="admin-toolbar-spacer" />

        <div className="admin-toolbar-group">
          <ViewToggle value={density} onChange={setDensity} label="Order layout" />
        </div>
      </div>

      {/* Saved views.
          The row is present whenever there is something to show OR something
          to save, and absent on a clean unfiltered queue with no views — an
          empty bar offering to save "no filters at all" is a control that
          teaches people the feature does nothing.

          Each view is a button, not a dropdown: there are at most a dozen,
          they are the operator's own words, and a list you can read at a
          glance is the difference between "pick the one I mean" and "open a
          menu and hunt". DESIGN §7 — task-shaped, not schema-shaped. */}
      {(
        <div className="aord-views" role="group" aria-label="Saved views">
          <Bookmark size={13} aria-hidden="true" className="aord-views-icon" />
          {views.map((v) => (
            <span key={v.name} className={`aord-view${activeView?.name === v.name ? ' is-on' : ''}`}>
              <button
                type="button"
                className="aord-view-apply"
                onClick={() => applyView(v)}
                aria-pressed={activeView?.name === v.name}
                title={[
                  v.status && `status: ${v.status}`,
                  v.parcel && `parcel: ${v.parcel}`,
                  v.method && `paid by: ${v.method}`,
                  v.query && `search: ${v.query}`,
                  v.sort && v.sort !== 'newest' && `sorted ${v.sort}`,
                ].filter(Boolean).join(' · ') || 'No filters'}
              >
                {v.name}
              </button>
              {/* Removal lives on the chip rather than behind an edit mode:
                  twelve of these is the ceiling, and the one somebody wants
                  gone is the one under their cursor. */}
              <button
                type="button"
                className="aord-view-drop"
                onClick={() => removeView(v)}
                aria-label={`Forget the view "${v.name}"`}
                title="Forget this view"
              >
                <X size={11} aria-hidden="true" />
              </button>
            </span>
          ))}
          {!activeView && (
            <button type="button" className="glass-btn glass-btn-sm aord-view-save" onClick={saveView}>
              <Plus size={12} aria-hidden="true" /> Save this view
            </button>
          )}
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => {
            try { localStorage.setItem(startKey, JSON.stringify(viewFrom(current))); toast.success('This view will open when you start a new session'); }
            catch { toast.error('This browser could not save the starting view'); }
          }}>Start here next time</button>
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => {
            try { localStorage.removeItem(startKey); toast.success('New sessions will use your role’s starting view'); }
            catch { toast.error('This browser could not reset the starting view'); }
          }}>Use role default</button>
        </div>
      )}

      {isFiltered && !loading && (
        <div className="admin-filter-note">
          <span>
            Showing {fmtCount(meta.total)} order{meta.total === 1 ? '' : 's'} matching the current filters.
          </span>
          <button type="button" className="glass-btn glass-btn-sm" onClick={clearFilters}>
            <FilterX size={13} aria-hidden="true" /> Clear
          </button>
        </div>
      )}

      {can.bulkUpdateOrders && selected.size > 0 && (
        <div className="aord-bulk">
          <span className="aord-bulk-count">{selected.size} selected</span>
          <select
            className="glass-input"
            value={bulkAction}
            onChange={(e) => setBulkAction(e.target.value)}
            aria-label="Bulk action"
          >
            <option value="status">Change status</option>
            {can.cancelOrder && <option value="cancel">Cancel orders</option>}
          </select>
          {bulkAction === 'status' && (
            <select
              className="glass-input"
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value)}
              aria-label="New status"
            >
              {/* Exactly the statuses the bulk endpoint whitelists. */}
              {['accepted', 'shipped', 'delivered'].map((s) => (
                <option key={s} value={s}>{humanize(s)}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="glass-btn glass-btn-primary glass-btn-sm"
            onClick={executeBulk}
            disabled={bulkLoading}
          >
            {bulkLoading ? <span className="spinner spinner-inline" /> : null} Apply
          </button>
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {can.bulkUpdateOrders && !loading && !error && orders.length > 0 && (
        <div className="admin-filter-note">
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => setSelected(allSelected ? new Set() : new Set(selectableUuids))}
          >
            {allSelected ? 'Deselect all' : `Select all ${selectableUuids.length} on this page`}
          </button>
        </div>
      )}

      {loading ? (
        <div className={`acard-grid${density === 'rows' ? ' is-list' : ''}`} aria-busy="true" aria-label="Loading orders">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={`skeleton acard-skel${density === 'rows' ? ' is-list' : ''}`} style={{ '--i': i }} />
          ))}
        </div>
      ) : error ? (
        <div className="glass-card empty-state is-error">
          <AlertCircle size={34} aria-hidden="true" />
          <h3>The order queue could not be loaded</h3>
          <p>{error}</p>
          <button type="button" className="glass-btn" onClick={() => fetchOrders()}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : orders.length === 0 ? (
        <div className="glass-card empty-state">
          {isFiltered ? <FilterX size={34} aria-hidden="true" /> : <Package size={34} aria-hidden="true" />}
          <h3>{isFiltered ? 'Nothing matches those filters' : 'No orders yet'}</h3>
          <p>
            {isFiltered
              ? 'Try a different status, payment method, or search term.'
              : 'Orders placed in the store will appear here as soon as they are created.'}
          </p>
          {isFiltered && (
            <button type="button" className="glass-btn" onClick={clearFilters}>
              <FilterX size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <details className="flow-columns"><summary>Visible details</summary><div className="flow-actions">{[['total', 'Total'], ['items', 'Items'], ['payment', 'Payment'], ['placed', 'Date placed']].filter(([key]) => key !== 'total' || can.seeTotals || can.isAdmin).map(([key, label]) => <label key={key}><input type="checkbox" checked={columns.split(',').includes(key)} onChange={e => setColumns(prev => { const next = new Set(prev.split(',').filter(Boolean)); if (e.target.checked) next.add(key); else next.delete(key); return [...next].join(','); })} /> {label}</label>)}</div></details>
          <div className={`acard-grid${density === 'rows' ? ' is-list' : ''} ${['total', 'items', 'payment', 'placed'].filter(k => !columns.split(',').includes(k)).map(k => `queue-hide-${k}`).join(' ')}`}>
            {orders.map((order, i) => (
              <OrderCard
                key={order.id}
                order={order}
                index={i}
                now={now}
                can={can}
                viewerId={user?.id}
                requireTracking={meta.requireTracking}
                claimMinutes={meta.claimMinutes}
                dense={density === 'rows'}
                selected={selected.has(order.uuid)}
                selectable={can.bulkUpdateOrders && !!order.uuid}
                busy={busyIds.has(order.id)}
                expanded={expanded.has(order.id)}
                onToggleSelect={() => toggleSelect(order)}
                onToggleExpanded={() => toggleExpanded(order.id)}
                onAdvance={updateStatus}
                onCancel={cancelOrder}
                onRefund={refundOrder}
              />
            ))}
          </div>

          <Pager
            page={page}
            totalPages={meta.totalPages}
            total={meta.total}
            noun="order"
            label="Order pages"
            onChange={setPage}
          >
            <label className="admin-toolbar-label" htmlFor="orders-per-page">Per page</label>
            <select
              id="orders-per-page"
              className="glass-input"
              value={limit}
              onChange={(e) => resetTo(() => setLimit(Number(e.target.value)))}
              aria-label="Orders per page"
            >
              {[12, 20, 40, 60].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Pager>
        </>
      )}
    </div>
  );
}

/* ── Card ──────────────────────────────────────────────────────── */

function OrderCard({
  order, index, now, can, viewerId, requireTracking, claimMinutes = 20, dense, selected, selectable, busy, expanded,
  onToggleSelect, onToggleExpanded, onAdvance, onCancel, onRefund,
}) {
  const tone = STATUS_TONE[order.status] || 'var(--text-muted)';
  const ref = orderRef(order);
  const items = Array.isArray(order.items) ? order.items : [];
  const trackIndex = TRACK.indexOf(order.status);
  const hiddenTotal = withheld(order, 'total');

  // Pack/dispatch work-state, from the list endpoint's counters. `packed`
  // is what used to be invisible: every unit picked, nothing shipped — the
  // state the Ship desk owns.
  const outstandingUnits = Number(order.outstanding_units || 0);
  const packed = outstandingUnits > 0
    && Number(order.picked_units || 0) >= outstandingUnits
    && ['paid', 'accepted'].includes(order.status);
  const boxCount = Number(order.box_count || 0);
  const boxesShipped = Number(order.boxes_shipped || 0);
  /**
   * Who has this order on their bench.
   *
   * The claim columns were always in this payload and nothing rendered them,
   * so a claimed order and an untouched one looked identical here — which made
   * "why hasn't this shipped" a question the Orders screen could not answer,
   * on the screen where it is actually asked. The fields go out under
   * `orders.pick` (orderVisibility.BENCH_FIELDS), so a viewer without it sees
   * no chip rather than an empty one.
   *
   * Liveness is judged against `packing_hold_until` as well as the TTL,
   * matching the server: an order whose holder bought another hour is still
   * held, however long ago they last touched it.
   */
  const claim = (() => {
    if (!order.packing_by || !order.packing_since) return null;
    const ttlEnd = new Date(order.packing_since).getTime() + claimMinutes * 60000;
    const hold = order.packing_hold_until ? new Date(order.packing_hold_until).getTime() : 0;
    const until = Math.max(ttlEnd, hold);
    if (until <= Date.now()) return null;
    return {
      who: order.packing_username || 'someone',
      onHold: hold > Date.now(),
      minutes: Math.max(0, Math.ceil((until - Date.now()) / 60000)),
      note: order.packing_note || null,
    };
  })();
  // Under required tracking an accepted order with unshipped boxes does not
  // ship from this card — the server would refuse — so the Ship button yields
  // to a link to the desk that can.
  const shipsAtDesk = requireTracking && order.status === 'accepted' && boxCount > boxesShipped;

  /**
   * Whether a request is staff work is a property of the order, not the
   * account: the server picks the customer transition table whenever the actor
   * owns the order, and that table allows `shipped -> delivered` and nothing
   * else. Mark paid, Accept and Ship all 400 on a staff member's own order —
   * deliberately, so nobody confirms their own payment. Offering the buttons
   * only produced a toast full of server error text, so they are withheld and
   * the reason is stated instead.
   */
  const isOwnOrder = viewerId != null && order.user_id != null && order.user_id === viewerId;

  const na = nextAction[order.status];
  const canAdvance = na
    && can.updateOrderStatus
    && !isOwnOrder
    && (!na.needs || can.has(na.needs));

  // `disputed` belongs on this list: cancelling a disputed order is refused by
  // the server, and the button used to render anyway and 400.
  const canCancel = can.cancelOrder
    && !['cancelled', 'refunded', 'delivered', 'shipped', 'disputed'].includes(order.status);

  const canRefund = can.refundOrder && REFUNDABLE.includes(order.status)
    // A cancelled order only reaches `refunded` if money actually arrived.
    && (order.status !== 'cancelled' || !!order.paid_at);

  const payment = order.payment;
  const confirmations = payment ? num(payment.confirmations) : 0;
  const required = payment ? Math.max(1, num(payment.required_confirmations, 1)) : 1;
  const confirmPct = payment ? Math.min(100, (confirmations / required) * 100) : 0;

  const tracking = Array.isArray(order.tracking_numbers) ? order.tracking_numbers : [];

  return (
    <article
      className={[
        'glass-card acard',
        selected ? 'is-selected' : '',
        busy ? 'is-busy' : '',
        ACTION_STATUSES.includes(order.status) || order.status === 'disputed' ? 'is-urgent' : '',
      ].filter(Boolean).join(' ')}
      style={{ '--acard-tone': tone, '--i': stagger(index) }}
      id={`queue-order-${order.uuid}`}
      data-status={order.status}
      aria-busy={busy || undefined}
    >
      <span className="acard-rail" aria-hidden="true" />

      <header className="acard-head">
        <div className="acard-head-main">
          {selectable && (
            <label className="aord-select" title={`Select order ${ref}`}>
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                aria-label={`Select order ${ref}`}
              />
            </label>
          )}
          <div style={{ minWidth: 0 }}>
            <span className="acard-id">
              <Hash size={11} aria-hidden="true" style={{ opacity: 0.5 }} />{ref}
            </span>
            <div className="acard-sub">
              <User size={11} aria-hidden="true" />
              {customerName(order)}
              <span aria-hidden="true">·</span>
              <span title={fullDate(order.created_at)}>{relTime(order.created_at, now)}</span>
            </div>
          </div>
        </div>
        <span className="acard-chip" style={{ '--acard-chip-tone': tone }}>
          <span className="acard-chip-dot" />
          {humanize(order.status)}
        </span>
      </header>

      {!dense && (
        trackIndex >= 0 ? (
          <div className="aord-track" role="img" aria-label={`Order progress: ${humanize(order.status)}`}>
            {TRACK.map((step, i) => (
              <Fragment key={step}>
                {i > 0 && <span className={`aord-step-line${i <= trackIndex ? ' is-done' : ''}`} aria-hidden="true" />}
                <span
                  className={[
                    'aord-step',
                    i < trackIndex ? 'is-done' : '',
                    i === trackIndex ? 'is-current' : '',
                  ].filter(Boolean).join(' ')}
                  aria-hidden="true"
                >
                  <span className="aord-step-dot" />
                  {/* Only the step the order is actually at is named. Six
                      labels across a 340px card is a wall of 8px type; the
                      dots carry the shape and the label carries the answer. */}
                  {i === trackIndex && <span className="aord-step-label">{humanize(step)}</span>}
                </span>
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="aord-track">
            <span className="aord-track-ended">
              {order.status === 'disputed' ? <AlertTriangle size={12} aria-hidden="true" /> : <Undo2 size={12} aria-hidden="true" />}
              {order.status === 'disputed' ? 'Disputed after shipping' : `Ended · ${humanize(order.status)}`}
            </span>
          </div>
        )
      )}

      <div className="acard-body">
        <NowLine action={order.next_action} />
        <div className="acard-fields">
          <div className="acard-field" data-queue-field="total">
            <span className="acard-field-label">Total</span>
            <span className="acard-field-value is-strong">
              {hiddenTotal ? <Hidden what="order totals" /> : money(order.total)}
            </span>
          </div>
          <div className="acard-field" data-queue-field="items">
            <span className="acard-field-label">Items</span>
            <span className="acard-field-value">
              <ShoppingBag size={12} aria-hidden="true" />
              {order.item_count != null ? num(order.item_count) : items.length || '—'}
            </span>
          </div>
          <div className="acard-field" data-queue-field="payment">
            <span className="acard-field-label">Payment</span>
            <span className="acard-field-value">
              {order.payment_method === 'zelle' || order.payment_method === 'cash_in_mail'
                ? <Wallet size={12} aria-hidden="true" />
                : <CreditCard size={12} aria-hidden="true" />}
              {PAYMENT_LABEL[order.payment_method] || humanize(order.payment_method)}
            </span>
          </div>
          <div className="acard-field" data-queue-field="placed">
            <span className="acard-field-label">Placed</span>
            <span className="acard-field-value" title={fullDate(order.created_at)}>
              <Clock size={12} aria-hidden="true" />
              {shortDateTime(order.created_at)}
            </span>
          </div>
        </div>

        {/* A crypto order that has money on the way but not yet enough
            confirmations is the single most common thing an operator is
            waiting on, so the progress is on the face of the card. */}
        {!dense && payment && !payment.confirmed && order.status === 'awaiting_confirmation' && (
          <div className="acard-field">
            <span className="acard-field-label">
              Confirmations · {confirmations}/{required}
            </span>
            <span className="acard-meter">
              <span className="acard-meter-fill" style={{ width: `${confirmPct}%` }} />
            </span>
          </div>
        )}

        {!dense && items.length > 0 && (
          <div className="aord-items">
            {items.slice(0, 2).map((item) => (
              <span className="aord-item" key={item.id}>
                <span className="aord-item-name">{item.product_name}{item.variant_name ? ` · ${item.variant_name}` : ''}</span>
                <span className="aord-item-qty">×{num(item.quantity, 1)}</span>
              </span>
            ))}
            {items.length > 2 && (
              <span className="aord-item-more">+{items.length - 2} more item{items.length - 2 === 1 ? '' : 's'}</span>
            )}
          </div>
        )}

        <div className="acard-chips">
          {/* What the carrier last said, rolled up per order — the same pill
              the buyer sees on their own list. Absent until something on the
              order is tracked. */}
          <ParcelChip parcels={order.parcels} compact />
          {claim && (
            <Link
              to={`/admin/pack/${order.id}`}
              className="acard-chip"
              style={{ '--acard-chip-tone': claim.onHold ? 'var(--warning)' : 'var(--primary)' }}
              title={claim.onHold
                ? `${claim.who} has asked to keep this order for another ${claim.minutes}m${claim.note ? ` — "${claim.note}"` : ''}`
                : `${claim.who} is packing this — the claim frees in ${claim.minutes}m if they go idle${claim.note ? ` — "${claim.note}"` : ''}`}
            >
              <Hand size={10} aria-hidden="true" /> {claim.who}
              {claim.onHold ? ` · kept ${claim.minutes}m` : ''}
            </Link>
          )}
          {packed && (
            <Link
              to="/admin/ship"
              className="acard-chip"
              style={{ '--acard-chip-tone': 'var(--success)' }}
              title="Every unit is picked — this order is waiting on the Ship desk"
            >
              <PackageCheck size={10} aria-hidden="true" /> Packed
            </Link>
          )}
          {boxCount > 0 && (
            <span
              className="acard-chip"
              style={{ '--acard-chip-tone': 'var(--secondary)' }}
              title={`${boxesShipped} of ${boxCount} boxes shipped`}
            >
              <Boxes size={10} aria-hidden="true" /> {boxCount} box{boxCount === 1 ? '' : 'es'}
              {boxCount > 0 && ` · ${boxesShipped} shipped`}
            </span>
          )}
          {tracking.length > 0 && (
            <span className="acard-chip" style={{ '--acard-chip-tone': 'var(--info)' }}>
              <Truck size={10} aria-hidden="true" /> {tracking.length} tracking
            </span>
          )}
          {num(order.discount_amount) > 0 && !withheld(order, 'discount_amount') && (
            <span className="acard-chip" style={{ '--acard-chip-tone': 'var(--success)' }}>
              <Ticket size={10} aria-hidden="true" /> −{money(order.discount_amount)}
            </span>
          )}
          {order.shipping_address_encrypted && (
            <span className="acard-chip" style={{ '--acard-chip-tone': 'var(--text-muted)' }}>
              <MapPin size={10} aria-hidden="true" /> Address on file
            </span>
          )}
          {/* `zelle_reference` is not in any SENSITIVE_FIELDS group, so the
              server ships it to every staff viewer holding `orders.view`. It
              is the memo code that ties a bank transfer to this order — the
              same class of thing as a tracking number — so the card gates it
              on the payment permission rather than printing what the redaction
              pass happens to have missed. */}
          {order.zelle_reference && can.seePayment && (
            <span className="acard-chip" style={{ '--acard-chip-tone': 'var(--info)' }}>
              <Link2 size={10} aria-hidden="true" /> {order.zelle_reference}
            </span>
          )}
        </div>
      </div>

      <footer className="acard-foot">
        <div className="acard-actions">
          {canAdvance && shipsAtDesk && (
            <Link
              to="/admin/ship"
              className="glass-btn glass-btn-sm glass-btn-primary"
              title="Tracked dispatch: this order's boxes ship one by one from the Ship desk"
              aria-label={`Ship order ${ref} from the Ship desk`}
            >
              <Truck size={13} aria-hidden="true" /> Ship desk
            </Link>
          )}
          {canAdvance && !shipsAtDesk && (() => {
            const Icon = na.icon;
            return (
              <button
                type="button"
                className={`glass-btn glass-btn-sm ${na.style}`}
                onClick={() => onAdvance(order, na.status)}
                disabled={busy}
                aria-label={`${na.label} — order ${ref}`}
                title={na.label}
              >
                <Icon size={13} aria-hidden="true" /> {na.label}
              </button>
            );
          })()}

          {na && can.updateOrderStatus && isOwnOrder && (
            <span
              className="acard-foot-note"
              title="This is your own order. Someone else has to confirm the payment and move it along."
            >
              Your order
            </span>
          )}

          {canRefund && (
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              onClick={() => onRefund(order)}
              disabled={busy}
              aria-label={`Refund order ${ref}`}
              title="Refund the buyer"
            >
              <Undo2 size={13} aria-hidden="true" /> Refund
            </button>
          )}

          {canCancel && (
            <button
              type="button"
              className="glass-btn glass-btn-sm glass-btn-danger"
              onClick={() => onCancel(order)}
              disabled={busy}
              aria-label={`Cancel order ${ref}`}
              title="Cancel order"
            >
              <XCircle size={13} aria-hidden="true" />
            </button>
          )}

          <Link
            to={`/orders/${order.uuid || order.id}`}
            className="glass-btn glass-btn-sm"
            aria-label={`Open order ${ref}`}
            title="Open the full order"
          >
            <Eye size={13} aria-hidden="true" />
          </Link>
        </div>

        <button
          type="button"
          className="glass-btn glass-btn-sm acard-disclose"
          onClick={onToggleExpanded}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} details for order ${ref}`}
        >
          Details <ChevronDown size={13} aria-hidden="true" />
        </button>
      </footer>

      <div className={`acard-drawer${expanded ? ' is-open' : ''}`}>
        <div className="acard-drawer-clip">
          {/* `inert` keeps the collapsed panel out of the tab order and away
              from a screen reader — a zero-height grid track still contains
              focusable links otherwise. */}
          <div className="acard-drawer-inner" inert={expanded ? undefined : true}>
            <OrderDetails order={order} items={items} tracking={tracking} payment={payment} can={can} />
          </div>
        </div>
      </div>
    </article>
  );
}

/* ── Drawer contents ───────────────────────────────────────────── */

function OrderDetails({ order, items, tracking, payment, can }) {
  const rows = [];

  const pushMoney = (label, field, { negative = false } = {}) => {
    if (withheld(order, field)) {
      rows.push([label, <Hidden key={field} what="order totals" />]);
      return;
    }
    const value = num(order[field]);
    if (value === 0) return;
    rows.push([label, `${negative ? '−' : ''}${money(value)}`]);
  };

  pushMoney('Shipping', 'shipping_cost');
  pushMoney('Discount', 'discount_amount', { negative: true });
  pushMoney('Store credit used', 'store_credit_applied', { negative: true });
  pushMoney('Refunded', 'refund_amount');

  const timeline = [
    ['Placed', order.created_at],
    ['Paid', order.paid_at],
    ['Shipped', order.shipped_at],
    ['Delivered', order.delivered_at],
    ['Cancelled', order.cancelled_at],
  ].filter(([, value]) => value);

  return (
    <>
      {items.length > 0 && (
        <section>
          <p className="acard-drawer-title">Items</p>
          <div className="acard-rows">
            {items.map((item) => (
              <div className="acard-row" key={item.id}>
                <span className="acard-row-label">
                  {item.product_name}{item.variant_name ? ` · ${item.variant_name}` : ''} ×{num(item.quantity, 1)}
                </span>
                <span className="acard-row-value">
                  {item.redacted || withheld(order, 'total')
                    ? <Hidden what="item prices" />
                    : money(num(item.price_at_purchase) * num(item.quantity, 1))}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <p className="acard-drawer-title">Money</p>
        <div className="acard-rows">
          {rows.map(([label, value]) => (
            <div className="acard-row" key={label}>
              <span className="acard-row-label">{label}</span>
              <span className="acard-row-value">{value}</span>
            </div>
          ))}
          <div className="acard-row">
            <span className="acard-row-label">Order total</span>
            <span className="acard-row-value is-total">
              {withheld(order, 'total') ? <Hidden what="order totals" /> : money(order.total)}
            </span>
          </div>
        </div>
      </section>

      {payment && (
        <section>
          <p className="acard-drawer-title">Payment</p>
          <div className="acard-rows">
            <div className="acard-row">
              <span className="acard-row-label">Rail</span>
              <span className="acard-row-value">
                {(payment.crypto_type || order.payment_method || '').toUpperCase()}
                {payment.testnet ? ' · testnet' : ''}
              </span>
            </div>
            <div className="acard-row">
              <span className="acard-row-label">Confirmations</span>
              <span className="acard-row-value">
                {num(payment.confirmations)} / {Math.max(1, num(payment.required_confirmations, 1))}
                {payment.confirmed ? ' · confirmed' : ''}
              </span>
            </div>
            {/* The redaction pass nulls `amount_crypto` for a viewer without
                the money permission, so the row has to survive a null value to
                be able to say the value was withheld — guarding the row on the
                value being present deleted the explanation along with it. */}
            <div className="acard-row">
              <span className="acard-row-label">Amount</span>
              <span className="acard-row-value">
                {payment.amount_crypto != null
                  ? `${payment.amount_crypto} ${(payment.crypto_type || '').toUpperCase()}`
                  : payment.redacted
                    ? <Hidden what="payment amounts" />
                    : '—'}
              </span>
            </div>
            <div className="acard-row">
              <span className="acard-row-label">Address</span>
              <span className="acard-row-value ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                {payment.payment_address || payment.wallet_address
                  || <Hidden what="payment addresses" />}
              </span>
            </div>
            {payment.checked_at && (
              <div className="acard-row">
                <span className="acard-row-label">Last checked</span>
                <span className="acard-row-value">{shortDateTime(payment.checked_at)}</span>
              </div>
            )}
          </div>
        </section>
      )}

      {tracking.length > 0 && (
        <section>
          <p className="acard-drawer-title">Tracking</p>
          <div className="acard-rows">
            {tracking.map((t) => (
              <div className="acard-row" key={t.id}>
                <span className="acard-row-label">{t.carrier || 'Carrier'}</span>
                <span className="acard-row-value ds-mono" style={{ fontSize: 'var(--fs-xs)' }}>
                  {t.tracking_number || <Hidden what="tracking numbers" />}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <p className="acard-drawer-title">Timeline</p>
        <div className="acard-rows">
          {timeline.map(([label, value]) => (
            <div className="acard-row" key={label}>
              <span className="acard-row-label">{label}</span>
              <span className="acard-row-value">{shortDateTime(value)}</span>
            </div>
          ))}
        </div>
      </section>

      {!can.seeShipping && order.redacted && (
        <p className="acard-foot-note">
          Some fields on this order are hidden by your permissions.
        </p>
      )}
    </>
  );
}
