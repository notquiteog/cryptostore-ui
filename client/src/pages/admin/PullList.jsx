import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Route, RefreshCw, Package, Boxes, MapPin, AlertTriangle, Check,
  Printer, Inbox, CircleSlash, PackageCheck, Search, RotateCcw, ArrowRight, Hand,
  Split, TimerReset,
} from 'lucide-react';
import { api } from '../../utils/api';
import { playSound } from '../../utils/sounds';
import { useAuth } from '../../context/AuthContext';
import { adminCapabilities } from '../../utils/adminPermissions';
import PageHeader from '../../components/admin/PageHeader';
import FlowStrip from '../../components/fulfilment/FlowStrip';
import BinChip from '../../components/fulfilment/BinChip';
import { WarehouseCard } from '../../components/fulfilment/WarehouseViewer';
import { useWarehouseLayout, shelfForBin } from '../../utils/useWarehouseLayout';

/**
 * The walk sheet: everything on the orders YOU have taken, in the order you
 * would walk past it.
 *
 * ── Why it is scoped to your own claims ─────────────────────────────────────
 *
 * It used to list every pickable line in the store. That reads well and works
 * badly: two pickers on one floor were handed the same sheet, walked the same
 * shelves, and found out they had both pulled the same units at the bench —
 * and a picker who finished "the list" had no idea which of it was theirs.
 *
 * The sheet now shows the orders this packer is holding (claimed from the
 * packing screen), merged into one walk. That is the same claim the bench has
 * always used — same TTL, same guarded update, same release — so nothing new
 * owns the notion of "mine", and an idle claim frees itself exactly as before.
 * Two pickers now get two disjoint sheets by construction.
 *
 * ── Why this screen names no buyer ──────────────────────────────────────────
 *
 * The endpoint behind it joins `orders` only to filter on status and selects
 * nothing from it, so there is no customer, no address and no total in the
 * payload at any point. That is deliberate and it is what makes `orders.pick`
 * the weakest grant in the orders family: somebody can pull stock all day
 * without the store ever showing them who it is for. If a "helpful" order
 * reference ever appears here, that property is gone.
 *
 * ── Why it groups by bin ────────────────────────────────────────────────────
 *
 * A list ordered by product sends a picker back to the same shelf once per
 * product that lives on it. Grouping by `bin_location` makes each group one
 * physical stop, and the header count is what to carry away from it. Variants
 * with no bin fall into one trailing "Unfiled" group rather than being hidden:
 * a store part-way through filing its catalogue still has to pick the rest.
 *
 * ── The tote, and the sort ──────────────────────────────────────────────────
 *
 * A batch's whole promise is one walk for several orders, and the half that
 * makes it usable is the SORT: for each variant in the tote, how many units go
 * into which order. `services/pickBatches` has always computed that — the
 * allocations ride on every line — and this screen used to throw it away,
 * which left a picker holding five of one variant with nothing on the sheet
 * saying that three were for the first order and two for the third. The answer
 * was in the payload; the picker did it from memory.
 *
 * So each row carries its split, and the orders get numbered slots. Slots, not
 * order references: a picker works a tote by position ("the third pocket"),
 * and the short reference is there for the moment they have to type it into
 * the bench. With one order in the batch there is nothing to sort and the
 * whole apparatus stays off the screen.
 *
 * ── Ticking is local, and says so ───────────────────────────────────────────
 *
 * The checkmarks are a memory aid for one walk and NEVER go to the database.
 * Recording what was actually picked happens on the packing screen, against a
 * specific order, because that is the only place the store knows WHICH order's
 * units came off the shelf. A tick here that wrote to the database would have
 * to guess, and guessing wrong shorts a different buyer.
 *
 * They do survive a reload, though — in localStorage, on this device only.
 * The first version held them in component state, which read as principled
 * until somebody walked a warehouse with a phone: mobile browsers discard
 * background tabs freely, so setting the phone down mid-walk wiped the sheet.
 * The record is keyed to the calendar day and pruned against the live list,
 * so yesterday's walk never haunts today's.
 */

const REFRESH_MS = 60_000;
const STAGGER_CAP = 12;
const TICKS_KEY = 'cs.pullticks.v1';

const today = () => new Date().toISOString().slice(0, 10);

function loadTicks() {
  try {
    const raw = JSON.parse(localStorage.getItem(TICKS_KEY));
    if (raw?.day === today() && Array.isArray(raw.ids)) return new Set(raw.ids);
  } catch { /* corrupt or absent: a fresh walk */ }
  return new Set();
}

function saveTicks(set) {
  try {
    if (set.size === 0) localStorage.removeItem(TICKS_KEY);
    else localStorage.setItem(TICKS_KEY, JSON.stringify({ day: today(), ids: [...set] }));
  } catch { /* private mode: ticks live for the tab and no further */ }
}

/** Bin groups, in walk order, with the unfiled remainder last. */
function groupByBin(lines) {
  const map = new Map();
  for (const line of lines) {
    const key = line.bin_location || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(line);
  }
  return [...map.entries()]
    .map(([bin, items]) => ({
      bin,
      items,
      units: items.reduce((s, i) => s + i.to_pick, 0),
      // An orphan has no on-hand figure at all, so `null < to_pick` would
      // coerce to 0 and flag the whole group short for a reason that is not
      // shortage. They get their own flag on the row instead.
      short: items.some((i) => !i.orphaned && i.on_hand < i.to_pick),
    }))
    // The server already ordered NULLS LAST; this only guards against a client
    // re-sort ever being added above and quietly floating the unfiled group to
    // the top, where it would be the first thing a picker walks to and the one
    // place they cannot walk to.
    .sort((a, b) => (a.bin === '' ? 1 : b.bin === '' ? -1 : 0));
}

/**
 * The per-order split for one variant: how many of the units in your hand go
 * into which order in the tote.
 *
 * Rendered only when the batch holds more than one order — with one, every
 * unit goes to the only order there is, and a chip saying so is noise on a
 * sheet somebody reads at arm's length while walking.
 *
 * Shows the SLOT, because that is how a picker addresses a tote, with the
 * short reference as the title for the moment they have to type it in. Units
 * already picked are dimmed rather than dropped: a part-picked allocation is
 * the one a picker most needs to see, and hiding it makes the split stop
 * adding up.
 */
function AllocSplit({ allocations }) {
  if (!allocations || allocations.length < 2) return null;
  return (
    <span className="pull-split" aria-label="How these units split across the orders in your tote">
      <Split size={11} aria-hidden="true" />
      {allocations.map((a) => (
        <span
          key={a.order_item_id}
          className={`pull-split-chip${a.to_pick === 0 ? ' is-done' : ''}`}
          title={`Order ${a.order_short} — ${a.to_pick} to pull${a.picked ? `, ${a.picked} already picked` : ''}`}
        >
          <span className="pull-split-slot">{a.slot}</span>
          <span className="pull-split-n">×{a.to_pick || a.picked}</span>
        </span>
      ))}
    </span>
  );
}

function PullRow({ line, done, isNew, onToggle, index, multiOrder }) {
  // `orphaned` means the variant was deleted while this line still owed units.
  // It is not short — there is no on-hand figure to be short of — and it is not
  // pickable either, so it must not borrow the shortage styling.
  const short = !line.orphaned && line.on_hand < line.to_pick;
  return (
    <li
      className={`pull-row${done ? ' is-done' : ''}${short ? ' is-short' : ''}${line.orphaned ? ' is-orphan' : ''}${isNew ? ' is-new' : ''}`}
      style={{ '--i': Math.min(index, STAGGER_CAP) }}
    >
      <button
        type="button"
        className="pull-tick"
        onClick={onToggle}
        aria-pressed={done}
        aria-label={done ? `Untick ${line.group_name} ${line.variant_name}` : `Tick ${line.group_name} ${line.variant_name} as pulled`}
      >
        <Check size={15} aria-hidden="true" />
      </button>

      <span className="pull-qty" aria-label={`${line.to_pick} units`}>
        <span className="pull-qty-num">{line.to_pick}</span>
        <span className="pull-qty-x">×</span>
      </span>

      <span className="pull-name">
        {/* No group id on an orphan — the catalogue row is gone, so a link
            would 404. The name still stands, because the order line kept it. */}
        {line.group_id
          ? <Link to={`/admin/products/${line.group_id}`} className="pull-group">{line.group_name}</Link>
          : <span className="pull-group">{line.group_name}</span>}
        <span className="pull-variant">{line.variant_name}</span>
        {/* The sort, under the name where the eye already is. It is part of
            the instruction ("pull five: three for slot 1, two for slot 3"),
            not metadata about it. */}
        {multiOrder && <AllocSplit allocations={line.allocations} />}
      </span>

      <span className="pull-meta">
        {isNew && (
          <span className="pull-new" title="Arrived since you started this walk">new</span>
        )}
        {line.orphaned && (
          <span
            className="pull-flag is-orphan"
            title="This product was deleted from the catalogue while the order still owed these units. There is no shelf to walk to — settle the line with a swap or a refund on the packing screen."
          >
            <CircleSlash size={12} aria-hidden="true" />
            no catalogue record
          </span>
        )}
        {short && (
          <span className="pull-flag" title={`Only ${line.on_hand} on hand — this walk is ${line.to_pick - line.on_hand} short`}>
            <AlertTriangle size={12} aria-hidden="true" />
            {line.on_hand} on hand
          </span>
        )}
        <span className="pull-orders" title={`Across ${line.order_count} order${line.order_count === 1 ? '' : 's'}`}>
          {line.order_count} ord
        </span>
      </span>
    </li>
  );
}

/**
 * The tote: which order sits in which slot, and how much of each is done.
 *
 * A batch has no object of its own — it is just the set of orders one person
 * holds (see services/pickBatches) — so this is the only place the picker can
 * see the batch AS a thing, and the only place they can step from the walk
 * into one specific bench. Each slot links to that order's packing screen,
 * which is where units stop being "in the tote" and become recorded picks.
 *
 * Hidden for a single-order batch: with one order the slot number is a
 * decoration and the walk sheet's own finish button already goes there.
 */
function TotePanel({ orders, lines }) {
  const perOrder = useMemo(() => {
    const acc = new Map(orders.map((o) => [o.id, { to_pick: 0, picked: 0 }]));
    for (const line of lines) {
      for (const a of line.allocations || []) {
        const row = acc.get(a.order_id);
        if (!row) continue;
        row.to_pick += a.to_pick;
        row.picked += a.picked;
      }
    }
    return acc;
  }, [orders, lines]);

  if (orders.length < 2) return null;

  return (
    <section className="glass-card pull-tote" aria-label="The orders in this batch">
      <header className="pull-tote-head">
        <Boxes size={15} aria-hidden="true" />
        <strong>Your tote — {orders.length} orders</strong>
        <span className="pull-tote-hint">Each unit's slot is on its row below</span>
      </header>
      <ol className="pull-tote-slots">
        {orders.map((o) => {
          const n = perOrder.get(o.id) || { to_pick: 0, picked: 0 };
          const total = n.to_pick + n.picked;
          const full = total > 0 && n.to_pick === 0;
          const onHold = o.packing_hold_until && new Date(o.packing_hold_until).getTime() > Date.now();
          return (
            <li key={o.id} className={`pull-tote-slot${full ? ' is-full' : ''}`}>
              <Link to={`/admin/pack/${o.id}`} title={`Pack order ${o.short}`}>
                <span className="pull-tote-n">{o.slot}</span>
                <span className="pull-tote-ref">{o.short}</span>
                <span className="pull-tote-units">
                  {full ? 'all picked' : `${n.picked}/${total}`}
                </span>
                {/* The hold this order is under, if its holder bought one. It
                    belongs here rather than only on the bench: the picker is
                    away from the bench, which is the whole reason they pressed
                    the button. */}
                {onHold && (
                  <span className="pull-tote-hold" title={`Kept until ${new Date(o.packing_hold_until).toLocaleTimeString()}`}>
                    <TimerReset size={11} aria-hidden="true" />
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export default function PullList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  // Shelf filing is catalogue work behind `products.stock`. A pure picker
  // does not hold it, and the "Assign shelves" link just bounced them off the
  // route guard — a door drawn for somebody it will not open for.
  const canFileShelves = useMemo(() => adminCapabilities(user).adjustStock, [user]);
  const [lines, setLines] = useState([]);
  const [orders, setOrders] = useState([]);
  const [totals, setTotals] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(loadTicks);
  const [hideDone, setHideDone] = useState(false);
  const [query, setQuery] = useState('');
  const timer = useRef(null);
  // Variant ids that were on the sheet when the walk started (or when the
  // picker last pressed Refresh, which is them saying "I have seen the sheet").
  // Lines outside this set arrived mid-walk through the quiet poll, and they
  // get flagged rather than silently blending in — a walk that grows without
  // saying so is how a picker "finishes" and leaves three lines on the shelf.
  const seenIds = useRef(null);

  const load = useCallback(async ({ quiet = false, absorb = false } = {}) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const data = await api.get('/fulfilment/batch');
      const fresh = data.lines || [];
      setOrders(data.orders || []);
      setLines(fresh);
      setTotals(data.totals || null);
      setError(null);
      if (seenIds.current === null || absorb) {
        seenIds.current = new Set(fresh.map((l) => l.key));
      }
      // Prune ticks for lines that left the sheet (packed, refunded, swapped)
      // so the walk's progress figure divides work done by work that exists.
      setDone((prev) => {
        const live = new Set(fresh.map((l) => l.key));
        const next = new Set([...prev].filter((id) => live.has(id)));
        if (next.size !== prev.size) saveTicks(next);
        return next.size !== prev.size ? next : prev;
      });
    } catch (err) {
      setError(err.message || 'Could not load the pull list');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // A picker leaves this open on a bench while orders keep arriving. Refreshing
  // quietly keeps the sheet honest without yanking the scroll position, and the
  // ticks survive because they are keyed on variant id, not on position.
  useEffect(() => {
    timer.current = setInterval(() => load({ quiet: true }), REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  const toggle = (variantId) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(variantId)) next.delete(variantId); else next.add(variantId);
      saveTicks(next);
      return next;
    });
    playSound('tick');
  };

  const resetWalk = () => {
    setDone(() => {
      saveTicks(new Set());
      return new Set();
    });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lines.filter((l) => {
      if (hideDone && done.has(l.key)) return false;
      if (!q) return true;
      return `${l.group_name} ${l.variant_name} ${l.bin_location || 'unfiled'}`.toLowerCase().includes(q);
    });
  }, [lines, hideDone, done, query]);

  const groups = useMemo(() => groupByBin(visible), [visible]);

  // Jump chips for long walks: one per stop, in walk order. They scroll rather
  // than filter, because a picker standing at shelf D wants to LOOK at shelf D
  // without the rest of the sheet ceasing to exist behind their thumb.
  const allGroups = useMemo(() => groupByBin(lines), [lines]);
  const jumpTo = (bin) => {
    document.getElementById(`pull-bin-${bin || '__unfiled'}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const pulledUnits = useMemo(
    () => lines.filter((l) => done.has(l.key)).reduce((s, l) => s + l.to_pick, 0),
    [lines, done],
  );
  const totalUnits = totals?.units || 0;
  const pct = totalUnits > 0 ? Math.round((pulledUnits / totalUnits) * 100) : 0;

  const newCount = useMemo(
    () => (seenIds.current ? lines.filter((l) => !seenIds.current.has(l.key)).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines],
  );

  /**
   * The next stop: the first unticked line in walk order.
   *
   * This is the whole job of the map card — not "here is your warehouse" but
   * "go here next". Walk order is already the array order (the server applied
   * it), so first-unticked IS next, with no second sort to disagree with the
   * sheet below.
   */
  const nextLine = useMemo(
    () => lines.find((l) => !done.has(l.key) && l.bin_location) || null,
    [lines, done],
  );

  /**
   * Bin → shelf, by the canonical rule.
   *
   * Was `bin.split('-')[0]`, which reads "A1-L2-S3" correctly and a shelf
   * named "A-1" incorrectly, every time. `shelfForBin` is the same
   * longest-name-wins match the server's walk order uses, which is what lets
   * shelves "A" and "A1" coexist at all — worth using rather than
   * approximating in the one place a picker is told where to stand.
   */
  const layout = useWarehouseLayout();
  const nextShelf = useMemo(
    () => shelfForBin(layout, nextLine?.bin_location),
    [layout, nextLine],
  );

  /**
   * Every stop still to make, so the card can draw the remaining route.
   *
   * BINS, not shelf names. The sheet below is already a list of bins — a stop
   * is `A2-L4-S6`, not "somewhere on A2" — and collapsing them to shelves made
   * the map disagree with the sheet it sits above: two bins on one run became
   * one number, drawn over the middle of eight feet of shelving, with the path
   * routed through a point the picker has no reason to stand at. The map
   * resolves each bin to its slot and hangs the number, the path and the lit
   * patch off that.
   *
   * Still deduped: two lines in the same bin are one stop, because they are
   * one place to stand.
   */
  const remainingStops = useMemo(
    () => [...new Set(lines.filter((l) => !done.has(l.key) && l.bin_location)
      .map((l) => String(l.bin_location).toUpperCase()))],
    [lines, done],
  );

  const allTicked = lines.length > 0 && lines.every((l) => done.has(l.key));

  return (
    <div className="admin-page pull-page">
      <PageHeader
        icon={Route}
        title="Pull list"
        subtitle={
          loading ? 'Building the walk…'
            : totalUnits === 0 ? 'Nothing waiting to be pulled'
              : `${totalUnits} unit${totalUnits === 1 ? '' : 's'} across ${totals.bins || 0} shelf stop${totals.bins === 1 ? '' : 's'}`
                + (orders.length > 1 ? ` · ${orders.length} orders in one walk` : '')
        }
      >
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => window.print()}>
          <Printer size={14} aria-hidden="true" /> Print
        </button>
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => load({ quiet: true, absorb: true })}
          disabled={refreshing}
          title={newCount > 0 ? 'Refresh, and fold the new arrivals into the sheet' : 'Refresh the sheet'}
        >
          <RefreshCw size={14} aria-hidden="true" className={refreshing ? 'spin' : ''} /> Refresh
        </button>
      </PageHeader>

      <FlowStrip current="pull" />

      {/* Printed sheets carry their own context: who holds the paper does not
          hold the screen the totals were on. Screen users never see this. */}
      <div className="pull-print-head" aria-hidden="true">
        Pulled {new Date().toLocaleString()} · {totalUnits} unit{totalUnits === 1 ? '' : 's'} ·{' '}
        {totals?.bins || 0} stop{totals?.bins === 1 ? '' : 's'}
        {totals?.unfiled ? ` · ${totals.unfiled} unfiled` : ''}
      </div>


      {/* Which order is which slot. Above the walk because the picker reads it
          once, at the start, and refers to the slot numbers on every row after
          that. */}
      {!loading && !error && <TotePanel orders={orders} lines={lines} />}

      {/* The next stop, drawn. Replaces the four counters that used to sit here:
          a picker standing in an aisle needs "go there next", not a tally of
          work they can already see below. The remaining stops are drawn as a
          route so the rest of the walk is legible at a glance. */}
      {!loading && lines.length > 0 && (
        <WarehouseCard
          title={nextLine ? `Next stop — ${nextLine.bin_location}` : 'Walk complete'}
          /* `shelfForBin`, not `split('-')[0]`. The canonical rule is
             longest-shelf-name-wins, which is what makes shelves "A" and "A1"
             able to coexist; splitting on the first dash gets that right only
             by luck and gets a shelf named "A-1" wrong every time. */
          highlight={nextShelf?.name || null}
          /* The bin itself, so the plan can point at the SECTION of the shelf
             rather than the whole run of it — and, in 2.5D, at the level. A
             picker told "A1" still has to search six feet of shelving. */
          highlightBin={nextLine?.bin_location || null}
          route={remainingStops}
          aside={nextLine ? (
            <div className="whc-next">
              <span className="whc-next-label">Next stop</span>
              <span className="whc-next-bin"><MapPin size={13} aria-hidden="true" /> {nextLine.bin_location}</span>
              <span className="whc-next-item">
                <strong>{nextLine.to_pick}×</strong>
                <span>{nextLine.group_name}</span>
                {nextLine.variant_name && <em>{nextLine.variant_name}</em>}
              </span>
              <span className="whc-next-rest">
                {remainingStops.length} stop{remainingStops.length === 1 ? '' : 's'} left on this walk
              </span>
            </div>
          ) : (
            <div className="whc-next is-done">
              <Check size={15} aria-hidden="true" />
              <span>Every stop on this walk is ticked.</span>
            </div>
          )}
        />
      )}

      {totalUnits > 0 && (
        <div className="pull-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Walk progress">
          <div className="pull-progress-track">
            <div className="pull-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="pull-progress-text">
            <strong>{pulledUnits}</strong> / {totalUnits} pulled
          </span>
        </div>
      )}

      {!loading && !error && lines.length > 0 && (
        <div className="admin-toolbar pull-toolbar">
          <div className="admin-search">
            <Search size={14} aria-hidden="true" />
            <input
              className="glass-input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by product or shelf"
              aria-label="Filter the pull list"
            />
          </div>
          <button
            type="button"
            className={`pull-chip${hideDone ? ' is-active' : ''}`}
            onClick={() => setHideDone((v) => !v)}
            aria-pressed={hideDone}
            disabled={done.size === 0 && !hideDone}
          >
            <PackageCheck size={13} aria-hidden="true" />
            Hide pulled
          </button>
          {done.size > 0 && (
            <button
              type="button"
              className="pull-chip"
              onClick={resetWalk}
              title="Untick everything and start the walk over"
            >
              <RotateCcw size={13} aria-hidden="true" />
              Reset walk
            </button>
          )}
          {newCount > 0 && (
            <span className="pull-newcount" role="status">
              {newCount} new since you started
            </span>
          )}
        </div>
      )}

      {/* One chip per stop once the walk is long enough for "where was C2"
          to be a real question. Three stops fit on one screen; jumping is
          noise there. */}
      {!loading && !error && allGroups.length > 3 && (
        <nav className="pull-jumps" aria-label="Jump to a shelf stop">
          {allGroups.map((g) => (
            <button
              key={g.bin || '__unfiled'}
              type="button"
              className={`pull-jump${g.bin ? '' : ' is-unfiled'}${g.short ? ' is-short' : ''}`}
              onClick={() => jumpTo(g.bin)}
            >
              {g.bin || 'Unfiled'}
              <span className="pull-jump-n">{g.units}</span>
            </button>
          ))}
        </nav>
      )}

      {error && (
        <div className="glass-card pull-empty">
          <AlertTriangle size={22} aria-hidden="true" />
          <p>{error}</p>
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => load()}>Try again</button>
        </div>
      )}

      {!error && loading && (
        <div className="pull-skeleton" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="pull-skel-row" style={{ '--i': i }} />)}
        </div>
      )}

      {!error && !loading && groups.length === 0 && (
        <div className="glass-card pull-empty">
          <Inbox size={22} aria-hidden="true" />
          <p>
            {lines.length === 0
              ? 'You are not holding any orders. Take some on the packing screen and they will appear here as one walk.'
              : query ? 'Nothing on the sheet matches that filter.'
                : 'Everything on this walk is ticked off.'}
          </p>
          {lines.length === 0 && (
            <Link to="/admin/pack" className="glass-btn glass-btn-sm glass-btn-primary">
              <Hand size={13} aria-hidden="true" /> Pick orders to pack
            </Link>
          )}
          {lines.length > 0 && (
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              onClick={() => { setHideDone(false); setQuery(''); }}
            >
              Show the full sheet
            </button>
          )}
        </div>
      )}

      {!error && !loading && groups.map((group, gi) => (
        <section
          key={group.bin || '__unfiled'}
          id={`pull-bin-${group.bin || '__unfiled'}`}
          className={`pull-bin${group.bin ? '' : ' is-unfiled'}${group.short ? ' has-short' : ''}`}
          style={{ '--i': Math.min(gi, STAGGER_CAP) }}
        >
          <header className="pull-bin-head">
            {/* A stamp-sized floor plan locating this stop — renders only
                when the store has drawn a map and the bin sits on a shelf. */}
            {group.bin && <BinChip bin={group.bin} />}
            <span className="pull-bin-tag">
              <MapPin size={13} aria-hidden="true" />
              {group.bin || 'Unfiled'}
            </span>
            <span className="pull-bin-count">
              {group.units} unit{group.units === 1 ? '' : 's'}
              <span className="pull-bin-sep">·</span>
              {group.items.length} line{group.items.length === 1 ? '' : 's'}
            </span>
            {!group.bin && canFileShelves && (
              <Link to="/admin/shelves" className="pull-bin-fix">Assign shelves</Link>
            )}
          </header>
          <ul className="pull-rows">
            {group.items.map((line, i) => (
              <PullRow
                key={line.key}
                line={line}
                index={i}
                done={done.has(line.key)}
                isNew={seenIds.current ? !seenIds.current.has(line.key) : false}
                onToggle={() => toggle(line.key)}
                multiOrder={orders.length > 1}
              />
            ))}
          </ul>
        </section>
      ))}

      {/* The walk's own finish line. It appears only when every stop is ticked,
          and it goes where the work actually gets recorded — ticks are a local
          memory aid, and the units are not really picked until the bench says
          so against an order. With one order in the batch it opens that order;
          with several it opens the queue, which is where the sort happens. */}
      {!error && !loading && allTicked && (
        <div className="pull-ready" role="status">
          <span className="pull-ready-text">
            <PackageCheck size={18} aria-hidden="true" />
            <strong>Ready to pack!</strong>
            <em>
              {totalUnits} unit{totalUnits === 1 ? '' : 's'} pulled across{' '}
              {orders.length} order{orders.length === 1 ? '' : 's'}
            </em>
          </span>
          {/* With one order, straight to its bench. With several, straight to
              the FIRST slot rather than back to the queue: the tote is in the
              picker's hands and the next physical act is emptying it into
              order one, not choosing what to do next. The tote panel above is
              how they reach the others. */}
          <button
            type="button"
            className="glass-btn glass-btn-primary"
            onClick={() => navigate(orders.length ? `/admin/pack/${orders[0].id}` : '/admin/pack')}
          >
            {orders.length > 1
              ? <>Sort into slot 1 — {orders[0].short}</>
              : <>Go to packing</>} <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      {!error && !loading && lines.length > 0 && (
        <p className="pull-foot">
          Ticks are a memory aid for this walk — they stay on this device and reset at midnight,
          and they are never sent to the store. Record what was actually picked on
          the <Link to="/admin/pack">packing screen</Link>, where the store knows which order each
          unit belongs to.
        </p>
      )}
    </div>
  );
}
