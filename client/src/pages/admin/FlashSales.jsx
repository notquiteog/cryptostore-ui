import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import {
  Zap, Plus, X, Search, Package, AlertTriangle, Flame, CalendarClock,
  Boxes, DollarSign, Timer, ArrowUpDown, RotateCw, Check,
  Pause, Play, Pencil, Copy, Trash2, Ban, CalendarPlus, Layers, EyeOff, PackageX,
  Ticket,
} from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import CatalogPicker from '../../components/admin/CatalogPicker';
import FlashSaleCard, {
  saleState, money, formatDuration, toLocalInput, ENDING_SOON_MS,
  STATE_META, describeDiscount,
} from '../../components/admin/FlashSaleCard';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';
import { applyFlashDiscount } from '../../utils/pricing';

/*
 * Only two discount shapes can be created.
 *
 * A fixed price — "this variant now costs $9" — was the third, and it has been
 * withdrawn. An absolute number cannot compose with the volume tiers on the
 * same variant: the engine can only take the lower of two absolute figures, so
 * a buyer who already qualified for a 25-unit break at $6.00 got nothing at all
 * from a $7.20 sale, and the deeper the break the more completely the
 * advertised discount evaporated. A percentage or a flat amount applies to
 * whatever the unit costs at that quantity, so the sale is worth something at
 * every break.
 *
 * Sales created before it was withdrawn were converted to the flat discount
 * they were worth at the list price; none remain to label.
 */
const DISCOUNT_TYPES = [
  { value: 'percent', label: '% off', unit: '%', hint: 'Comes off the price at every quantity break.' },
  { value: 'flat', label: '$ off', unit: '$', hint: 'A fixed amount off the price at every quantity break.' },
];

const PERCENT_PRESETS = [10, 15, 20, 25, 33, 50];

/** Durations an operator actually reaches for, in hours. */
const DURATIONS = [
  { h: 1, label: '1 hour' },
  { h: 6, label: '6 hours' },
  { h: 12, label: '12 hours' },
  { h: 24, label: '1 day' },
  { h: 72, label: '3 days' },
  { h: 168, label: '1 week' },
];

const LABEL_IDEAS = ['Flash Sale', 'Weekend Deal', '24 Hours Only', 'Clearance', 'Restock Special'];

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'live', label: 'Live' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'paused', label: 'Paused' },
  { key: 'ended', label: 'Ended' },
];

const SORTS = [
  { key: 'ending', label: 'Ending soonest' },
  { key: 'newest', label: 'Newest first' },
  { key: 'deepest', label: 'Deepest discount' },
  { key: 'selling', label: 'Best selling' },
];

const emptyDraft = () => ({
  variant: null,
  group: null,
  discount_type: 'percent',
  discount_value: '',
  label: '',
  startNow: true,
  starts_at: '',
  hours: 24,
  customEnd: '',
});

/** How long the whole sale runs, resolved from either the preset or the box. */
function draftEnd(draft, from = Date.now()) {
  if (draft.hours === 'custom') {
    const d = new Date(draft.customEnd);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(from + draft.hours * 3_600_000);
}

function draftStart(draft) {
  if (draft.startNow) return new Date();
  const d = new Date(draft.starts_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ── The line-item view ──────────────────────────────────────────────────────
 *
 * DESIGN §6 — which of the three shapes this list is: **a toggle.**
 *
 * The card earns every pixel it takes while a sale is running. A window that
 * is closing is not a value, it is a rate, and the progress bar draws the rate
 * — you can see a sale is two thirds gone without reading the clock. The
 * was→now pair with the arrow between them is the offer itself, and it is the
 * thing an operator checks before deciding whether to extend.
 *
 * None of that is true once the sale has ended. A finished sale has a full bar
 * and a countdown running backwards, and forty of them at 340px tall is nine
 * screens of history you have to scroll past to reach the two that are live.
 * That is the case the line item answers, so the toggle exists and
 * `useViewMode` remembers which side of it this operator works on.
 *
 * Not the responsive table: the record carries a product thumbnail, a
 * countdown bar and a state that is a colour before it is a word, and the
 * phone shape of that is a small card, not ten stacked label/value pairs —
 * which is exactly the table this page replaced.
 */
const ROW_COLS = 'minmax(0, 1.6fr) 88px 152px 72px minmax(0, 2fr) minmax(0, 1.3fr) 210px';

/**
 * What is wrong with a sale, in the words a line has room for.
 *
 * `FlashSaleCard` builds the same four checks in sentences, because a card has
 * the width for a sentence and the operator reading one card is deciding about
 * that sale. A row has to say it in three words next to thirty-nine others.
 *
 * The conditions themselves are the duplicate worth watching: a fifth warning
 * added to the card and not to this function is a sale whose problem is
 * visible in one view and invisible in the other, which is this repository's
 * documented failure mode wearing different clothes. If a sixth caller ever
 * needs them, lift both into one exported helper rather than writing a third.
 */
function rowWarnings(sale) {
  const out = [];
  if (!sale.group_active) out.push({ icon: EyeOff, text: 'Product switched off' });
  else if (!sale.variant_active) out.push({ icon: EyeOff, text: 'Variant switched off' });
  if (sale.stock <= 0) out.push({ icon: PackageX, text: 'Out of stock' });
  return out;
}

/**
 * One sale as a line item, carrying every field its card carries.
 *
 * Product, variant, the price it was and the price it is, how deep that is as
 * a percentage and as the stored rule, the window with its clock still
 * running, what it has sold and taken, stock, tier floor and state — §5, since
 * a compact view that quietly drops "out of stock" is a view that lets an
 * operator extend a sale on something nobody can buy.
 *
 * `now` arrives from the page's single clock for the same reason the card
 * takes it: forty rows each holding their own interval would tick a second
 * apart and visibly disagree about how long is left.
 */
function SaleRow({
  sale, now, revenueHidden, busy,
  onEdit, onToggle, onExtend, onEndNow, onDuplicate, onDelete,
}) {
  const state = saleState(sale, now);
  const meta = STATE_META[state];

  const list = Number(sale.original_price);
  // Null for a discount that reduces nothing — the same guard FlashSaleCard
  // applies, for the same reason: `Number(null)` is 0, so reading it bare
  // renders a dead sale as 100% off at $0.00.
  const price = sale.sale_price == null ? null : Number(sale.sale_price);
  const off = price != null && list > 0 && price < list
    ? Math.round(((list - price) / list) * 100)
    : 0;

  const startsMs = new Date(sale.starts_at).getTime();
  const endsMs = new Date(sale.ends_at).getTime();
  const span = endsMs - startsMs;
  const elapsed = Math.min(Math.max(now - startsMs, 0), Math.max(span, 0));
  const progress = span > 0 ? (state === 'ended' ? 1 : elapsed / span) : 0;
  const remaining = endsMs - now;
  const endingSoon = state === 'live' && remaining > 0 && remaining <= ENDING_SOON_MS;

  // Same floor the card prints: what a unit actually costs once the volume
  // break and the sale compose. Every storable discount composes, so there is
  // one way to work it out — the fixed-price branch that used to sit here
  // floored against the break instead of stacking on it, because an absolute
  // number cannot compose, and no row can carry that type any more.
  const bestTier = sale.best_tier_price == null ? null : Number(sale.best_tier_price);
  const floor = bestTier == null
    ? null
    : applyFlashDiscount(bestTier, sale.discount_type, sale.discount_value);

  // One phrase rather than the card's label-and-value pair. A row has a single
  // line for the clock, and "Ends in / 2h 14m left" printed side by side on it
  // says "in" and "left" twice.
  const clock = state === 'scheduled' ? `starts in ${formatDuration(startsMs - now)}`
    : state === 'ended' ? `ended ${formatDuration(now - endsMs)} ago`
    : state === 'paused' ? `paused, ${formatDuration(remaining)} left`
    : `${formatDuration(remaining)} left`;

  const stats = sale.stats || {};
  const units = Number(stats.units_sold || 0);
  const orders = Number(stats.order_count || 0);
  const stock = Number(sale.stock ?? 0);
  const warnings = rowWarnings(sale);

  const when = (v) => new Date(v).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div
      className={`lrow fsale-lrow${state === 'live' ? ' is-live' : ''}${endingSoon ? ' is-urgent' : ''}${busy ? ' is-busy' : ''}`}
      /* Two tones, because they answer two questions. `--tone` is the sale's
         state and colours the pill and the countdown bar; `--lrow-tone` is the
         row's left edge, which an hour from closing belongs to the warning
         colour whatever the state says — that edge is the only thing carrying
         urgency once forty rows are on screen. */
      style={{ '--tone': meta.tone, '--lrow-tone': endingSoon ? 'var(--warning)' : meta.tone }}
    >
      <div className="fsale-lrow-prod">
        {sale.thumb
          ? <img className="fsale-lrow-thumb" src={sale.thumb} alt="" loading="lazy" />
          : <span className="fsale-lrow-thumb is-blank"><Layers size={13} aria-hidden="true" /></span>}
        <div className="lrow-stack">
          <span className="lrow-text">{sale.group_name || 'Unknown product'}</span>
          <small>
            {sale.variant_name || `Variant #${sale.variant_id}`}
            <span className="fsale-dot">·</span>
            <span className="fsale-vid">#{sale.variant_id}</span>
            {sale.label && <><span className="fsale-dot">·</span><em>{sale.label}</em></>}
          </small>
        </div>
      </div>

      <span className="fsale-state fsale-lrow-state">
        {state === 'live' && <span className="fsale-live-dot" aria-hidden="true" />}
        {meta.label}
      </span>

      <div className="fsale-lrow-price">
        <span className="fsale-lrow-money">
          <span className="fsale-was">{money(list)}</span>
          <span className="fsale-arrow" aria-hidden="true">→</span>
          <span className="fsale-lrow-now">{money(price)}</span>
        </span>
        <small>{floor != null ? `floor ${money(floor)} at tiers` : 'no volume tiers'}</small>
      </div>

      <div className="fsale-lrow-off">
        <span className="lrow-num">{off > 0 ? `-${off}%` : '—'}</span>
        <small>{describeDiscount(sale)}</small>
      </div>

      <div className="lrow-wrap fsale-lrow-when">
        <span className="fsale-lrow-clock">{clock}</span>
        {/* The card's countdown bar at a third of the height. It is the one
            part of the flourish that survives the trip to a line, because it
            is the only channel that shows a rate rather than a reading. */}
        <span
          className="fsale-bar fsale-lrow-bar"
          role="img"
          aria-label={`${Math.round(progress * 100)}% of the window elapsed`}
        >
          <span className="fsale-bar-fill" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
        </span>
        {/* Two timestamps do not fit a line on a laptop, and the countdown
            above already carries the live reading. DESIGN §4's other use of
            hover — disclosing a truncated value rather than a control — is
            what the `title` is for; the exact window is one pointer away and
            the whole string is on the element for anything reading the DOM. */}
        <small title={`${when(sale.starts_at)} → ${when(sale.ends_at)}`}>
          {when(sale.starts_at)} → {when(sale.ends_at)}
        </small>
      </div>

      <div className="lrow-wrap fsale-lrow-perf">
        <span className="fsale-lrow-sold">
          {units.toLocaleString()} sold
          <span className="fsale-dot">·</span>
          {revenueHidden ? '—' : money(stats.revenue || 0)}
        </span>
        <small title={`${orders} order${orders === 1 ? '' : 's'} placed while this sale has been open · ${stock.toLocaleString()} in stock`}>
          {orders} order{orders === 1 ? '' : 's'}
          <span className="fsale-dot">·</span>
          <span className={stock <= 0 ? 'is-bad' : undefined}>
            {stock <= 0 ? 'no stock' : `${stock.toLocaleString()} in stock`}
          </span>
        </small>
      </div>

      {/* Icon-only: six labelled buttons per line would be more chrome than
          record. Each keeps its `title` and an off-screen name, and
          `.lrow-actions` reveals the group on hover *and* focus-within — hover
          alone would leave the delete unreachable from a keyboard. Fine
          control over the end time lives behind Edit, which unfolds the row
          into its own card with a real date field. */}
      <div className="lrow-actions">
        {state !== 'ended' && (
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => onToggle(sale)}
            disabled={busy}
            title={sale.active ? 'Stop pricing this sale without deleting it' : 'Resume this sale'}
          >
            {sale.active ? <Pause size={13} /> : <Play size={13} />}
            <span className="sr-only">{sale.active ? 'Pause' : 'Resume'}</span>
          </button>
        )}
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => onExtend(sale, 24)}
          disabled={busy}
          title={state === 'ended' ? 'Reopen this sale for another day' : 'Push the end time back by a day'}
        >
          {state === 'ended' ? <Zap size={13} /> : <CalendarPlus size={13} />}
          <span className="sr-only">{state === 'ended' ? 'Run again' : 'Extend by a day'}</span>
        </button>
        {state !== 'ended' && (
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => onEndNow(sale)}
            disabled={busy}
            title={state === 'scheduled' ? 'Cancel this sale before it starts' : 'Close the window now'}
          >
            <Ban size={13} />
            <span className="sr-only">{state === 'scheduled' ? 'Cancel' : 'End now'}</span>
          </button>
        )}
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => onEdit(sale)}
          disabled={busy}
          title="Edit the discount, end time and label"
        >
          <Pencil size={13} />
          <span className="sr-only">Edit</span>
        </button>
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => onDuplicate(sale)}
          disabled={busy}
          title="Start the same offer on another variant"
        >
          <Copy size={13} />
          <span className="sr-only">Duplicate</span>
        </button>
        <button
          type="button"
          className="glass-btn glass-btn-sm glass-btn-danger"
          onClick={() => onDelete(sale)}
          disabled={busy}
          title="Delete this sale"
        >
          <Trash2 size={13} />
          <span className="sr-only">Delete</span>
        </button>
      </div>

      {/* Only drawn when something is actually wrong, so a healthy board stays
          one line per sale and a broken one is impossible to scroll past. */}
      {warnings.length > 0 && (
        <ul className="fsale-lrow-warn">
          {warnings.map((w, i) => (
            <li key={i}><w.icon size={11} aria-hidden="true" /> {w.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function FlashSales() {
  const [sales, setSales] = useState([]);
  const [revenueHidden, setRevenueHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [picking, setPicking] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editingId, setEditingId] = useState(null);
  const [busyIds, setBusyIds] = useState(() => new Set());

  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('ending');
  // Cards or line items, remembered per operator. See hooks/useViewMode.js.
  const [view, setView] = useViewMode('admin-flash-sales');

  const createRef = useRef(null);

  /*
   * One clock for the page.
   *
   * Every card shows a countdown, and giving each its own interval would mean
   * a dozen timers firing a second apart — so two cards created in the same
   * minute would visibly tick at different moments. A single second hand
   * driving the whole grid keeps them in step and costs one timer regardless
   * of how many sales are on screen.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const fetchSales = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const data = await api.get('/flash-sales/admin');
      setSales(data.sales || (Array.isArray(data) ? data : []));
      setRevenueHidden(!!data.revenue_hidden);
    } catch (err) {
      toast.error(err.message || 'Failed to load flash sales');
    }
    if (quiet) setRefreshing(false); else setLoading(false);
  }, []);

  useEffect(() => { fetchSales(); }, [fetchSales]);

  /*
   * The units-sold and revenue figures on each card are a server aggregate, so
   * unlike the countdowns they cannot be recomputed from the clock. Re-asked
   * every couple of minutes, and only while the tab is actually being looked
   * at — a background tab polling an admin endpoint forever is just load.
   */
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && !editingId) fetchSales({ quiet: true });
    }, 120_000);
    return () => clearInterval(id);
  }, [fetchSales, editingId]);

  const markBusy = (id, on) => setBusyIds((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });

  /* ── Derived ─────────────────────────────────────────────────────────────── */

  // Re-derived on every tick, because a sale is live right up until the second
  // it is not, and the pills, tiles and sort order all have to agree with the
  // card. The cards re-render each second for their countdowns anyway.
  const withState = useMemo(
    () => sales.map(s => ({ ...s, _state: saleState(s, now) })),
    [sales, now]
  );

  const counts = useMemo(() => {
    const c = { all: withState.length, live: 0, scheduled: 0, paused: 0, ended: 0 };
    for (const s of withState) c[s._state] += 1;
    return c;
  }, [withState]);

  const stats = useMemo(() => {
    let units = 0, revenue = 0, endingSoon = 0;
    for (const s of withState) {
      units += Number(s.stats?.units_sold || 0);
      revenue += Number(s.stats?.revenue || 0);
      if (s._state === 'live' && new Date(s.ends_at).getTime() - now <= ENDING_SOON_MS) endingSoon += 1;
    }
    return { units, revenue, endingSoon };
  }, [withState, now]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = withState.filter(s => {
      if (filter !== 'all' && s._state !== filter) return false;
      if (!q) return true;
      return [s.group_name, s.variant_name, s.label, s.category, `#${s.variant_id}`]
        .some(v => String(v || '').toLowerCase().includes(q));
    });

    const endsAt = (s) => new Date(s.ends_at).getTime();
    const depth = (s) => {
      const list = Number(s.original_price);
      const price = s.sale_price == null ? null : Number(s.sale_price);
      return price != null && list > 0 && price < list ? (list - price) / list : 0;
    };

    const rank = { live: 0, scheduled: 1, paused: 2, ended: 3 };
    return [...rows].sort((a, b) => {
      if (sort === 'newest') return new Date(b.created_at) - new Date(a.created_at);
      if (sort === 'deepest') return depth(b) - depth(a);
      if (sort === 'selling') return Number(b.stats?.units_sold || 0) - Number(a.stats?.units_sold || 0);
      // Ending soonest, but a live sale always sorts above a scheduled one and
      // an ended one always falls to the bottom — otherwise "soonest" puts last
      // week's finished sale first.
      if (rank[a._state] !== rank[b._state]) return rank[a._state] - rank[b._state];
      return endsAt(a) - endsAt(b);
    });
  }, [withState, filter, query, sort]);

  /* ── Create ──────────────────────────────────────────────────────────────── */

  const openCreate = (prefill) => {
    setDraft({ ...emptyDraft(), ...prefill });
    setPicking(!prefill?.variant);
    setCreateError('');
    setShowCreate(true);
    // The panel opens above the grid; on a page already scrolled down to the
    // card that was duplicated it would otherwise open off-screen.
    requestAnimationFrame(() => createRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  };

  const closeCreate = () => {
    setShowCreate(false);
    setDraft(emptyDraft());
    setCreateError('');
  };

  const setD = (patch) => { setDraft((d) => ({ ...d, ...patch })); setCreateError(''); };

  const listPrice = Number(draft.variant?.price);
  const previewPrice = draft.variant && draft.discount_value !== ''
    ? applyFlashDiscount(listPrice, draft.discount_type, draft.discount_value)
    : null;
  const previewOff = previewPrice != null && listPrice > 0 && previewPrice < listPrice
    ? Math.round(((listPrice - previewPrice) / listPrice) * 100)
    : 0;
  const previewEnd = draftEnd(draft);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!draft.variant) { setPicking(true); return setCreateError('Pick a product first'); }
    if (draft.discount_value === '') return setCreateError('Enter how much comes off');

    const value = parseFloat(draft.discount_value);
    if (!Number.isFinite(value) || value <= 0) return setCreateError('The discount has to be more than zero');
    if (draft.discount_type === 'percent' && value > 100) return setCreateError('A percentage discount cannot exceed 100%');
    if (draft.discount_type === 'flat' && value >= listPrice) {
      return setCreateError(`A flat discount has to be less than the ${money(listPrice)} list price`);
    }

    const starts = draftStart(draft);
    if (!starts) return setCreateError('Pick a valid start time');
    const ends = draftEnd(draft, starts.getTime());
    if (!ends) return setCreateError('Pick a valid end time');
    if (ends <= new Date()) return setCreateError('The sale has to end in the future');
    if (ends <= starts) return setCreateError('The sale has to end after it starts');

    setCreating(true);
    try {
      await api.post('/flash-sales/admin', {
        variant_id: draft.variant.id,
        discount_type: draft.discount_type,
        discount_value: value,
        label: draft.label || undefined,
        starts_at: starts.toISOString(),
        ends_at: ends.toISOString(),
      });
      toast.success(draft.variant.sale ? 'Flash sale replaced' : 'Flash sale created');
      closeCreate();
      fetchSales({ quiet: true });
    } catch (err) {
      const msg = err.message || 'Failed to create flash sale';
      setCreateError(msg);
      toast.error(msg);
    }
    setCreating(false);
  };

  /* ── Per-card actions ────────────────────────────────────────────────────── */

  const patchSale = async (sale, body, okMessage) => {
    markBusy(sale.id, true);
    try {
      await api.put(`/flash-sales/admin/${sale.id}`, body);
      if (okMessage) toast.success(okMessage);
      await fetchSales({ quiet: true });
      return true;
    } catch (err) {
      toast.error(err.message || 'Could not update the sale');
      return false;
    } finally {
      markBusy(sale.id, false);
    }
  };

  const toggleActive = (sale) =>
    patchSale(sale, { active: !sale.active }, sale.active ? 'Sale paused' : 'Sale resumed');

  /**
   * Push the end back by `hours`.
   *
   * Measured from now rather than from the stored end when the sale has
   * already closed, so "run again" on a sale that finished last Tuesday gives
   * a window that is actually open instead of one still in the past.
   */
  const extend = (sale, hours) => {
    const from = Math.max(new Date(sale.ends_at).getTime(), Date.now());
    const ends = new Date(from + hours * 3_600_000);
    const reopening = new Date(sale.ends_at).getTime() <= Date.now();
    return patchSale(
      sale,
      { ends_at: ends.toISOString(), ...(reopening ? { active: true } : {}) },
      reopening ? `Running again for ${formatDuration(hours * 3_600_000)}` : `Extended to ${ends.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`
    );
  };

  /*
   * Close the window at this instant, and switch it off as well.
   *
   * Either alone would do it — the engine wants an active sale inside its
   * window — but recording both means the row reads the same way to anything
   * that only checks one of them, and "Run again" has a single obvious inverse.
   *
   * The start is pulled back too, which only bites on a sale that had not begun
   * yet: leaving a start in the future behind an end in the present is a window
   * that runs backwards, and the server rightly refuses it. Collapsing both
   * onto now says what actually happened — it was cancelled before it ran.
   */
  const endNow = (sale) => {
    const at = new Date();
    const scheduled = new Date(sale.starts_at) > at;
    return patchSale(
      sale,
      { ends_at: at.toISOString(), active: false, ...(scheduled ? { starts_at: at.toISOString() } : {}) },
      scheduled ? 'Sale cancelled' : 'Sale closed'
    );
  };

  const saveEdit = async (sale, edit) => {
    const value = parseFloat(edit.discount_value);
    if (!Number.isFinite(value) || value <= 0) return toast.error('Enter a discount greater than zero');
    if (edit.discount_type === 'percent' && value > 100) return toast.error('A percentage discount cannot exceed 100%');

    const body = {
      discount_type: edit.discount_type,
      discount_value: value,
      label: edit.label,
    };
    if (edit.ends_at) {
      const ends = new Date(edit.ends_at);
      if (Number.isNaN(ends.getTime())) return toast.error('That end time is not a valid date');
      body.ends_at = ends.toISOString();
    }

    const ok = await patchSale(sale, body, 'Sale updated');
    if (ok) setEditingId(null);
  };

  const duplicate = (sale) => {
    openCreate({
      discount_type: sale.discount_type,
      discount_value: String(sale.discount_value ?? ''),
      label: sale.label || '',
      hours: 24,
    });
    toast('Pick the variant to run the same offer on', { icon: '📋' });
  };

  const deleteSale = async (sale) => {
    const name = sale.label || `${sale.group_name} · ${sale.variant_name}`;
    if (!confirm(`Delete the flash sale on "${name}"? This cannot be undone.`)) return;
    markBusy(sale.id, true);
    try {
      await api.delete(`/flash-sales/admin/${sale.id}`);
      toast.success('Flash sale deleted');
      // Dropped locally first so the card leaves on the click rather than on
      // the round trip; the refetch below is what makes it authoritative.
      setSales((prev) => prev.filter(s => s.id !== sale.id));
      fetchSales({ quiet: true });
    } catch (err) {
      toast.error(err.message || 'Failed to delete sale');
      markBusy(sale.id, false);
    }
  };

  /* ── Render ──────────────────────────────────────────────────────────────── */

  const subtitle = loading ? 'Loading…'
    : counts.all === 0 ? 'No sales yet — put a timed discount on any variant in the catalog.'
    : `${counts.live} live${counts.scheduled ? `, ${counts.scheduled} lined up` : ''} of ${counts.all}`
      + (stats.endingSoon ? ` · ${stats.endingSoon} ending within the hour` : '');

  return (
    <div className="admin-page">
      <PageHeader icon={Zap} title="Flash sales" subtitle={subtitle}>
        <button
          className="glass-btn glass-btn-primary"
          onClick={() => (showCreate ? closeCreate() : openCreate())}
        >
          {showCreate ? <X size={15} /> : <Plus size={15} />}
          {showCreate ? 'Cancel' : 'New sale'}
        </button>
      </PageHeader>

      {!loading && counts.all > 0 && (
        <div className="orders-stats">
          <div className="orders-stat-card fsale-stat" style={{ '--tone': 'var(--success)' }}>
            <span className="orders-stat-icon"><Flame size={15} /></span>
            <span className="orders-stat-value">{counts.live}</span>
            <span className="orders-stat-label">Live now</span>
          </div>
          <div
            className={`orders-stat-card fsale-stat${stats.endingSoon > 0 ? ' is-urgent' : ''}`}
            style={{ '--tone': stats.endingSoon > 0 ? 'var(--warning)' : 'var(--text-muted)' }}
          >
            <span className="orders-stat-icon"><Timer size={15} /></span>
            <span className="orders-stat-value">{stats.endingSoon}</span>
            <span className="orders-stat-label">Ending within 1h</span>
          </div>
          <div className="orders-stat-card fsale-stat" style={{ '--tone': 'var(--info)' }}>
            <span className="orders-stat-icon"><CalendarClock size={15} /></span>
            <span className="orders-stat-value">{counts.scheduled}</span>
            <span className="orders-stat-label">Scheduled</span>
          </div>
          <div className="orders-stat-card fsale-stat" style={{ '--tone': 'var(--primary)' }}>
            <span className="orders-stat-icon"><Boxes size={15} /></span>
            <span className="orders-stat-value">{stats.units.toLocaleString()}</span>
            <span className="orders-stat-label">Units sold on sale</span>
          </div>
          <div className="orders-stat-card fsale-stat" style={{ '--tone': 'var(--success)' }}>
            <span className="orders-stat-icon"><DollarSign size={15} /></span>
            <span className="orders-stat-value">{revenueHidden ? '—' : money(stats.revenue)}</span>
            <span className="orders-stat-label">{revenueHidden ? 'Revenue hidden' : 'Taken on sale'}</span>
          </div>
        </div>
      )}

      {/* ── Create panel ── */}
      {showCreate && (
        <div className="glass-card admin-panel-in fsale-create" ref={createRef}>
          <h2 className="admin-card-title">New flash sale</h2>

          <form onSubmit={handleCreate}>
            {/* Step 1 — what it runs on */}
            <section className="fsale-step">
              <h3 className="fsale-step-head"><span className="fsale-step-n">1</span> Product</h3>

              {draft.variant && !picking ? (
                <div className="fsale-chosen">
                  {draft.variant.thumb
                    ? <img className="fsale-thumb" src={draft.variant.thumb} alt="" />
                    : <span className="fsale-thumb fsale-thumb-blank"><Package size={17} aria-hidden="true" /></span>}
                  <div className="fsale-chosen-text">
                    <strong>{draft.group?.name}</strong>
                    <span>
                      {draft.variant.name}
                      <span className="fsale-dot">·</span>#{draft.variant.id}
                      <span className="fsale-dot">·</span>{money(draft.variant.price)}
                      <span className="fsale-dot">·</span>
                      {draft.variant.stock > 0 ? `${draft.variant.stock} in stock` : 'out of stock'}
                    </span>
                  </div>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => setPicking(true)}>
                    Change
                  </button>
                </div>
              ) : (
                <CatalogPicker
                  excludeVariantId={draft.variant?.id}
                  onSelect={(variant, group) => {
                    setD({ variant, group });
                    setPicking(false);
                  }}
                />
              )}

              {draft.variant?.sale && !picking && (
                <p className="fsale-inline-warn">
                  <AlertTriangle size={12} aria-hidden="true" />
                  This variant already has a flash sale. Creating this one replaces it.
                </p>
              )}
              {draft.variant && !draft.variant.active && !picking && (
                <p className="fsale-inline-warn">
                  <AlertTriangle size={12} aria-hidden="true" />
                  This variant is switched off, so the sale will not be visible to customers.
                </p>
              )}
            </section>

            {/* Step 2 — how much comes off */}
            <section className="fsale-step">
              <h3 className="fsale-step-head"><span className="fsale-step-n">2</span> Discount</h3>

              <div className="fsale-discount-row">
                <div className="fsale-seg" role="group" aria-label="Discount type">
                  {DISCOUNT_TYPES.map(t => (
                    <button
                      key={t.value}
                      type="button"
                      className={`fsale-seg-opt${draft.discount_type === t.value ? ' is-on' : ''}`}
                      onClick={() => setD({ discount_type: t.value })}
                      aria-pressed={draft.discount_type === t.value}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                <div className={`fsale-amount fsale-amount-${draft.discount_type}`}>
                  <input
                    className="glass-input"
                    type="number"
                    min={0}
                    max={draft.discount_type === 'percent' ? 100 : undefined}
                    step="any"
                    value={draft.discount_value}
                    onChange={(e) => setD({ discount_value: e.target.value })}
                    placeholder={draft.discount_type === 'percent' ? '25' : '5.00'}
                    aria-label={draft.discount_type === 'percent' ? 'Percent off' : 'Amount off'}
                  />
                  <span className="fsale-amount-unit" aria-hidden="true">
                    {DISCOUNT_TYPES.find(t => t.value === draft.discount_type)?.unit}
                  </span>
                </div>
              </div>

              {draft.discount_type === 'percent' && (
                <div className="fsale-chips" role="group" aria-label="Common discounts">
                  {PERCENT_PRESETS.map(p => (
                    <button
                      key={p}
                      type="button"
                      className={`fsale-chip${String(p) === String(draft.discount_value) ? ' is-on' : ''}`}
                      onClick={() => setD({ discount_value: String(p) })}
                    >
                      {p}%
                    </button>
                  ))}
                </div>
              )}

              <p className="admin-hint fsale-hint">
                {DISCOUNT_TYPES.find(t => t.value === draft.discount_type)?.hint}
              </p>
            </section>

            {/* Step 3 — when it runs */}
            <section className="fsale-step">
              <h3 className="fsale-step-head"><span className="fsale-step-n">3</span> Schedule</h3>

              <div className="fsale-sched">
                <div className="fsale-seg" role="group" aria-label="Start">
                  <button
                    type="button"
                    className={`fsale-seg-opt${draft.startNow ? ' is-on' : ''}`}
                    onClick={() => setD({ startNow: true })}
                    aria-pressed={draft.startNow}
                  >
                    Start now
                  </button>
                  <button
                    type="button"
                    className={`fsale-seg-opt${!draft.startNow ? ' is-on' : ''}`}
                    onClick={() => setD({
                      startNow: false,
                      starts_at: draft.starts_at || toLocalInput(Date.now() + 3_600_000),
                    })}
                    aria-pressed={!draft.startNow}
                  >
                    Schedule
                  </button>
                </div>

                {!draft.startNow && (
                  <input
                    className="glass-input fsale-when"
                    type="datetime-local"
                    value={draft.starts_at}
                    onChange={(e) => setD({ starts_at: e.target.value })}
                    aria-label="Start time"
                  />
                )}
              </div>

              <div className="fsale-chips" role="group" aria-label="How long it runs">
                {DURATIONS.map(d => (
                  <button
                    key={d.h}
                    type="button"
                    className={`fsale-chip${draft.hours === d.h ? ' is-on' : ''}`}
                    onClick={() => setD({ hours: d.h })}
                  >
                    {d.label}
                  </button>
                ))}
                <button
                  type="button"
                  className={`fsale-chip${draft.hours === 'custom' ? ' is-on' : ''}`}
                  onClick={() => setD({
                    hours: 'custom',
                    customEnd: draft.customEnd || toLocalInput(Date.now() + 86_400_000),
                  })}
                >
                  Until…
                </button>
              </div>

              {draft.hours === 'custom' && (
                <input
                  className="glass-input fsale-when"
                  type="datetime-local"
                  value={draft.customEnd}
                  onChange={(e) => setD({ customEnd: e.target.value })}
                  aria-label="End time"
                />
              )}

              <div className="form-group fsale-label-group">
                <label htmlFor="fsale-label">Label (optional)</label>
                <input
                  id="fsale-label"
                  className="glass-input"
                  type="text"
                  maxLength={128}
                  value={draft.label}
                  onChange={(e) => setD({ label: e.target.value })}
                  placeholder="Shown on the storefront badge"
                />
                <div className="fsale-chips fsale-chips-tight">
                  {LABEL_IDEAS.map(l => (
                    <button
                      key={l}
                      type="button"
                      className={`fsale-chip${draft.label === l ? ' is-on' : ''}`}
                      onClick={() => setD({ label: draft.label === l ? '' : l })}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* Live preview */}
            <section className={`fsale-preview${previewPrice != null && previewPrice < listPrice ? ' is-ready' : ''}`}>
              <h3 className="fsale-preview-head">Preview</h3>

              {!draft.variant ? (
                <p className="fsale-preview-idle">Pick a product to see what customers will pay.</p>
              ) : previewPrice == null || previewPrice >= listPrice ? (
                <p className="fsale-preview-idle">Enter a discount to see what customers will pay.</p>
              ) : (
                <>
                  <div className="fsale-prices fsale-prices-lg">
                    <span className="fsale-was">{money(listPrice)}</span>
                    <span className="fsale-arrow" aria-hidden="true">→</span>
                    <span className="fsale-now">{money(previewPrice)}</span>
                    {previewOff > 0 && <span className="fsale-off">-{previewOff}%</span>}
                  </div>

                  <p className="fsale-preview-line">
                    Saves {money(listPrice - previewPrice)} a unit
                    {previewEnd && (
                      <>
                        <span className="fsale-dot">·</span>
                        {draft.hours === 'custom'
                          ? <>ends {previewEnd.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</>
                          : <>
                              runs for {DURATIONS.find(d => d.h === draft.hours)?.label}
                              <span className="fsale-dot">·</span>
                              ends {previewEnd.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                            </>}
                      </>
                    )}
                  </p>

                  {/*
                    The engine applies the sale to whatever the unit costs at
                    that quantity, so a percentage stacks on top of the volume
                    break rather than competing with it. Showing the stack is
                    the whole argument for percentages over fixed prices, and
                    it is the number the operator is really deciding about.
                  */}
                  {draft.variant.tiers?.length > 0 && (
                    <div className="fsale-tier-table">
                      <div className="fsale-tier-row fsale-tier-head">
                        <span>Quantity</span><span>Now</span><span>On sale</span>
                      </div>
                      {draft.variant.tiers.map((t, i) => {
                        const tierPrice = Number(t.price);
                        const after = applyFlashDiscount(tierPrice, draft.discount_type, draft.discount_value);
                        return (
                          <div className="fsale-tier-row" key={`${t.min_qty_label}-${i}`}>
                            <span>{t.min_qty_label}</span>
                            <span className="fsale-tier-was">{money(tierPrice)}</span>
                            <span className="fsale-tier-now">{money(after)}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </section>

            {createError && (
              <div className="fsale-error" role="alert">
                <AlertTriangle size={14} aria-hidden="true" /> {createError}
              </div>
            )}

            <div className="admin-form-actions">
              <button type="submit" className="glass-btn glass-btn-primary" disabled={creating}>
                {creating
                  ? <><span className="spinner spinner-inline" /> Creating…</>
                  : <><Zap size={15} /> {draft.variant?.sale ? 'Replace sale' : 'Start flash sale'}</>}
              </button>
              <button type="button" className="glass-btn" onClick={closeCreate}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Toolbar ── */}
      {!loading && sales.length > 0 && (
        <div className="admin-toolbar fsale-toolbar">
          <div className="status-filter-row" role="group" aria-label="Filter sales">
            {FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                className={`status-filter-pill${filter === f.key ? ' active' : ''}`}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
              >
                {f.label}
                <span className="status-filter-count">{counts[f.key]}</span>
              </button>
            ))}
          </div>

          <div className="fsale-toolbar-right">
            <label className="fsale-sort">
              <ArrowUpDown size={14} aria-hidden="true" />
              <span className="sr-only">Sort by</span>
              <select className="glass-input" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>

            <div className="admin-search">
              <Search size={15} aria-hidden="true" />
              <input
                className="glass-input"
                type="search"
                placeholder="Find a sale…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search flash sales"
              />
            </div>

            <button
              type="button"
              className={`glass-btn glass-btn-sm fsale-refresh${refreshing ? ' is-spinning' : ''}`}
              onClick={() => fetchSales({ quiet: true })}
              disabled={refreshing}
              title="Refresh sold and revenue figures"
            >
              <RotateCw size={14} />
              <span className="sr-only">Refresh</span>
            </button>

            <ViewToggle value={view} onChange={setView} label="Sale layout" />
          </div>
        </div>
      )}

      {/* ── The board ── */}
      {loading ? (
        view === 'rows' ? (
          <div className="lrows fsale-rows" style={{ '--lrow-cols': ROW_COLS }} aria-busy="true" aria-label="Loading flash sales">
            {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton lrow-skel" />)}
          </div>
        ) : (
          <div className="fsale-grid">
            {[0, 1, 2].map(i => <div key={i} className="skeleton fsale-skeleton" />)}
          </div>
        )
      ) : visible.length === 0 ? (
        /* One empty state for both views: why the board is empty has nothing
           to do with how it would have been drawn, and two copies is two
           places for the wording to go stale.

           §9 — navigation, not an apology. A sale needs a variant to run on,
           so the catalog is the first way out; the other two are the discount
           mechanisms that do not need a window. */
        <div className="glass-card empty-state">
          <Zap size={34} aria-hidden="true" />
          <h3>{sales.length === 0 ? 'No flash sales yet' : 'Nothing matches that'}</h3>
          <p>
            {sales.length === 0
              ? 'A flash sale is a discount with a clock on it. Pick any variant from the catalog and give it a window.'
              : 'Nothing answers to that filter and that search together.'}
          </p>
          <div className="fsale-empty-acts">
            {sales.length === 0 ? (
              <>
                <button type="button" className="glass-btn glass-btn-primary" onClick={() => openCreate()}>
                  <Plus size={15} aria-hidden="true" /> New sale
                </button>
                <Link className="glass-btn" to="/admin/products">
                  <Package size={15} aria-hidden="true" /> Catalog
                </Link>
                <Link className="glass-btn" to="/admin/coupons">
                  <Ticket size={15} aria-hidden="true" /> Coupons
                </Link>
              </>
            ) : (
              <button
                type="button"
                className="glass-btn"
                onClick={() => { setFilter('all'); setQuery(''); }}
              >
                <X size={14} aria-hidden="true" /> Show all {counts.all} sale{counts.all === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>
      ) : view === 'rows' ? (
        <div className="lrows fsale-rows" style={{ '--lrow-cols': ROW_COLS }}>
          <div className="lrows-head">
            <span>Product</span>
            <span className="fsale-lrow-h-mid">State</span>
            <span>Was → now</span>
            <span className="fsale-lrow-h-num">Off</span>
            <span>Window</span>
            <span>Sold</span>
            <span className="sr-only">Actions</span>
          </div>
          {visible.map(sale => (
            /* Editing unfolds the line back into the object it describes,
               rather than growing a second editor that would then have to be
               kept in step with the card's. One editor, one set of validation
               rules, and the row you clicked is where the card appears. */
            editingId === sale.id ? (
              <div className="fsale-lrow-editing" key={sale.id}>
                <FlashSaleCard
                  sale={sale}
                  now={now}
                  revenueHidden={revenueHidden}
                  busy={busyIds.has(sale.id)}
                  editing
                  onEdit={(s) => setEditingId(s.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onSave={(edit) => saveEdit(sale, edit)}
                  onToggle={toggleActive}
                  onExtend={extend}
                  onEndNow={endNow}
                  onDuplicate={duplicate}
                  onDelete={deleteSale}
                />
              </div>
            ) : (
              <SaleRow
                key={sale.id}
                sale={sale}
                now={now}
                revenueHidden={revenueHidden}
                busy={busyIds.has(sale.id)}
                onEdit={(s) => setEditingId(s.id)}
                onToggle={toggleActive}
                onExtend={extend}
                onEndNow={endNow}
                onDuplicate={duplicate}
                onDelete={deleteSale}
              />
            )
          ))}
        </div>
      ) : (
        <div className="fsale-grid">
          {visible.map(sale => (
            <FlashSaleCard
              key={sale.id}
              sale={sale}
              now={now}
              revenueHidden={revenueHidden}
              busy={busyIds.has(sale.id)}
              editing={editingId === sale.id}
              onEdit={(s) => setEditingId(s.id)}
              onCancelEdit={() => setEditingId(null)}
              onSave={(edit) => saveEdit(sale, edit)}
              onToggle={toggleActive}
              onExtend={extend}
              onEndNow={endNow}
              onDuplicate={duplicate}
              onDelete={deleteSale}
            />
          ))}
        </div>
      )}

      {!loading && visible.length > 0 && (
        <p className="fsale-footnote">
          <Check size={12} aria-hidden="true" />
          Sale prices stack with volume breaks and customer tier discounts — the
          countdowns above are live, and sold figures refresh every couple of minutes.
        </p>
      )}
    </div>
  );
}
