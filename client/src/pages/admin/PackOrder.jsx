import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  PackageCheck, RefreshCw, Hand, Lock, ArrowLeft, Check, Minus, Plus,
  AlertTriangle, Inbox, Clock, Boxes, MapPin, ArrowLeftRight, Receipt,
  CircleCheck, Keyboard, ExternalLink, FastForward, StickyNote, Timer,
  Printer, X, Truck, PackagePlus, Layers, TimerReset, Square, SquareCheck,
  Users, Unlock, ClipboardList, Tags, FileText, Send, History, Package,
} from 'lucide-react';
import { api } from '../../utils/api';
import { playSound } from '../../utils/sounds';
import { useAuth } from '../../context/AuthContext';
import { adminCapabilities } from '../../utils/adminPermissions';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import StatTiles from '../../components/admin/StatTiles';
import { SwapComposer } from '../../components/order/OrderLineActions';
import BoxesPanel from '../../components/fulfilment/BoxesPanel';
import Carton from '../../components/fulfilment/Carton';
import BinChip from '../../components/fulfilment/BinChip';
import QtyInput from '../../components/fulfilment/QtyInput';
import FlowStrip from '../../components/fulfilment/FlowStrip';
import ScanBox, { useScanRouter, useScanWedge } from '../../components/fulfilment/ScanBox';
import { BoxTagSheet, PackingSlipSheet, usePrintMode } from '../../components/fulfilment/PrintSheets';
import { useTheme } from '../../context/ThemeContext';

/**
 * The packing bench.
 *
 * Two screens behind one route: the queue at `/admin/pack`, and one order at
 * `/admin/pack/:id`. They are one file because the second is what the first is
 * for, and splitting them puts the claim logic in two places.
 *
 * ── Nothing here moves stock ────────────────────────────────────────────────
 *
 * `product_variants.quantity` was decremented at checkout, inside the order
 * transaction. Recording a pick says a physical unit went in a box; it does not
 * take a second unit out of the catalogue. If you are adding a write here, that
 * is the invariant to check first.
 *
 * ── Why an order has to be claimed ──────────────────────────────────────────
 *
 * Two packers half-filling one box is the failure this prevents, and it is the
 * same collision `services/recipientPool` solves for payment recipients. The
 * claim is soft and expires, because the alternative — a hard lock with a
 * release button — is a lock that stays stuck the first time somebody walks
 * away from the bench holding a box.
 *
 * ── Short lines are the interesting outcome ─────────────────────────────────
 *
 * A line that cannot be filled is the store finding out its stock number was
 * wrong, and the buyer is owed an answer. There are two answers and this screen
 * treats them differently, for a reason worth stating because it looks like an
 * inconsistency:
 *
 *   Swap    — rendered inline, using the same `SwapComposer` the order page
 *             uses. It needs nothing from the order but the line's quantity and
 *             name, and the only money it prints is the CATALOGUE price of the
 *             replacement, which `orders.swap_items` already grants (see the
 *             flash-sale catalogue route, shared with exactly this picker).
 *
 *   Refund  — a LINK to the order, not a dialog. `RefundComposer` prices its
 *             preview from `price_at_purchase`, `shipping_cost` and
 *             `shipping_refunded`, and every one of those is gated behind
 *             `orders.view_totals`. This screen deliberately fetches no money
 *             at all, so inlining that form would leave two bad options:
 *             widen the payload and hand order totals to every picker, or
 *             render the form against absent fields and quote the buyer a
 *             refund of $0.00. Sending the operator to the screen that already
 *             holds the money — and already checks the grant — is the only
 *             version that is both correct and honest about what a picker
 *             may see.
 */

const REFRESH_MS = 45_000;
const STAGGER_CAP = 10;

/** Mirrors the server's PICKABLE_STATUSES: what the bench may still work on. */
const PICKABLE = ['paid', 'accepted'];

const shortId = (uuid, id) => (uuid ? uuid.split('-')[0].toUpperCase() : `#${id}`);

function ageOf(value) {
  if (!value) return '—';
  const mins = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Escalate quietly with age: a day is late, three days is a problem. */
function ageClass(value) {
  if (!value) return '';
  const hours = (Date.now() - new Date(value).getTime()) / 3600_000;
  if (hours >= 72) return ' is-stale';
  if (hours >= 24) return ' is-old';
  return '';
}

/**
 * Minutes until a live claim lapses, clamped at zero.
 *
 * Read off the server's `held_until` and nowhere else — it is the only place
 * that knows whether the holder has bought a hold. Re-deriving it here from
 * `held_since + claim_minutes` would tell a picker an order frees in three
 * minutes when its holder has parked it for another hour, which sends them to a
 * shelf for nothing.
 */
function freesIn(order) {
  if (!order?.held_until) return 0;
  const until = new Date(order.held_until).getTime();
  return Math.max(0, Math.ceil((until - Date.now()) / 60000));
}

/** "1h 05m" past the hour, "45m" below it. A hold is measured in hours. */
function longSpan(mins) {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/**
 * Claim whatever the server says is next and go there. Shared by the queue's
 * headline button and its keyboard shortcut; an empty queue is an answer, not
 * an error.
 */
async function claimNext(navigate) {
  try {
    const res = await api.post('/fulfilment/queue/next');
    if (res.resumed) toast('Back to the order you were holding');
    navigate(`/admin/pack/${res.id}`);
  } catch (err) {
    toast(err.message || 'Nothing is waiting to be packed.');
  }
}

/**
 * Who is holding what, and the button that takes it back.
 *
 * ── Why this exists at all, given the claim is deliberately soft ────────────
 *
 * The soft claim's promise is that nothing gets permanently stuck: an idle
 * claim frees itself, so no release button is needed and no lock survives
 * somebody walking away. The HOLD breaks that promise on purpose — surviving
 * inactivity is its whole value — and a hold is exactly what somebody presses
 * before a delivery arrives, or before going home. Eight hours is a shift.
 *
 * So this panel is the hold's counterweight, and it is scoped like one:
 * `orders.pick_supervise`, which neither picking preset carries. A packer who
 * could break claims could take any order off any colleague, which is the
 * collision the claim exists to prevent wearing a different hat.
 *
 * `idle_minutes` is the figure to read, not the countdown: a claim renewed two
 * minutes ago is somebody working, and one renewed forty minutes ago under an
 * hour's hold is somebody who may have gone home. The panel sorts by it, so
 * the orders worth taking back are the ones at the top.
 */
function ClaimsPanel({ onChanged }) {
  const [claims, setClaims] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/fulfilment/claims');
      setClaims(data.claims || []);
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load the claims');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const breakClaim = async (claim) => {
    setBusyId(claim.id);
    try {
      const res = await api.post(`/fulfilment/orders/${claim.id}/break-claim`);
      toast.success(res.freed
        ? `Back in the queue — it was ${res.held_by_username || 'unnamed'}'s`
        : 'That claim had already gone.');
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(err.message || 'Could not hand that claim back');
    } finally {
      setBusyId(null);
    }
  };

  const sorted = useMemo(
    () => [...(claims || [])].sort((a, b) => (b.idle_minutes ?? 0) - (a.idle_minutes ?? 0)),
    [claims],
  );

  if (error) {
    return <div className="glass-card pkc-panel"><AlertTriangle size={16} aria-hidden="true" /> {error}</div>;
  }
  if (claims === null) return null;

  return (
    <section className="glass-card pkc-panel" aria-label="Orders currently held">
      <header className="pkc-head">
        <Users size={15} aria-hidden="true" />
        <strong>On the bench — {claims.length} held</strong>
        <button type="button" className="glass-btn glass-btn-sm" onClick={load}>
          <RefreshCw size={13} aria-hidden="true" /> Refresh
        </button>
      </header>

      {claims.length === 0 ? (
        <p className="pkc-empty">Nobody is holding an order right now.</p>
      ) : (
        <ul className="pkc-list">
          {sorted.map((c) => (
            <li key={c.id} className={`pkc-row${c.on_hold ? ' is-onhold' : ''}`}>
              <Link to={`/admin/pack/${c.id}`} className="pkc-ref">{shortId(c.uuid, c.id)}</Link>
              <span className="pkc-who">
                {c.on_hold ? <TimerReset size={12} aria-hidden="true" /> : <Hand size={12} aria-hidden="true" />}
                {c.held_by_username || 'unnamed'}
              </span>
              <span className="pkc-progress">{c.picked}/{c.units} picked</span>
              <span
                className={`pkc-idle${(c.idle_minutes ?? 0) >= 30 ? ' is-stale' : ''}`}
                title={`Last bench activity ${c.idle_minutes}m ago · frees ${new Date(c.held_until).toLocaleTimeString()}`}
              >
                idle {longSpan(c.idle_minutes ?? 0)}
              </span>
              {c.packing_note && (
                <span className="pkc-note" title={c.packing_note}>
                  <StickyNote size={11} aria-hidden="true" /> {c.packing_note}
                </span>
              )}
              <button
                type="button"
                className="glass-btn glass-btn-sm pkc-break"
                onClick={() => breakClaim(c)}
                disabled={busyId === c.id}
                title={`Hand this order back to the queue. ${c.held_by_username || 'The holder'} loses it, and the handover note stays on it.`}
              >
                <Unlock size={12} aria-hidden="true" /> Hand back
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What the shift got through — the claims board's past tense.
 *
 * ── The gap it fills ────────────────────────────────────────────────────────
 *
 * `ClaimsPanel` above answers "who is holding what, right now". Nothing
 * answered "how did this afternoon go". The bench has been writing the
 * attribution down the whole time — `packed_by`, `sealed_by`, `shipped_by`,
 * `short_by` — and no screen had ever read any of it back, so a supervisor
 * could watch work in progress and had no account of work finished.
 *
 * ── What it deliberately does not show, and says so ─────────────────────────
 *
 * Units PICKED, per person. `order_items` records `picked_quantity` and
 * `picked_at` and has no `picked_by`, so a line does not remember who pulled
 * it — and adding that column would put a staff identity on every row of the
 * largest table in the schema for a figure that units BOXED already proxies.
 * `services/packBench.shiftSummary` makes that argument at length and sends
 * `picks_attributable: false` so this panel can state it rather than leaving a
 * reader to assume a missing column is a zero.
 *
 * ── Not a league table ──────────────────────────────────────────────────────
 *
 * Sorted by units boxed because that is the largest number and sorting by it
 * puts the busiest row first, which is what a supervisor scanning for "who is
 * free" wants. It carries no target, no rate and no per-hour figure: those
 * turn a work record into a performance score, and nothing in this schema was
 * collected for that.
 */
/*
 * ── Two audiences, one panel ────────────────────────────────────────────────
 *
 * `mine` swaps the endpoint for `/fulfilment/shift/mine`, which is the same
 * summary narrowed to the caller and gated on `orders.pick` instead of
 * `orders.pick_supervise`. It exists because the people doing the work could
 * not see what they had done: the whole-bench view sits behind supervision, so
 * a packer saw nothing of their own afternoon and a supervisor saw everybody's.
 *
 * One component rather than two, because everything below — the window
 * buttons, the per-person figures, the caveat about picks not being
 * attributable — is identical and would be re-typed slightly differently by
 * whichever of the two got edited second. What differs is the endpoint, the
 * wording and whether a name is worth printing, and all three are this prop.
 *
 * It stays NOT a league table in either mode, for the reason the header above
 * gives: no target, no rate, no per-hour figure. A packer reading their own
 * row should find an account of what they did, not a score.
 */
function ShiftPanel({ mine = false }) {
  const [data, setData] = useState(null);
  const [hours, setHours] = useState(12);
  const [error, setError] = useState(null);

  const load = useCallback(async (h) => {
    try {
      setData(await api.get(`/fulfilment/shift${mine ? '/mine' : ''}?hours=${h}`));
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load the shift');
    }
  }, [mine]);

  useEffect(() => { load(hours); }, [load, hours]);

  if (error) {
    return <div className="glass-card pkc-panel"><AlertTriangle size={16} aria-hidden="true" /> {error}</div>;
  }
  if (!data) return null;

  const t = data.totals;
  return (
    <section className="glass-card pkc-panel pks-panel" aria-label={mine ? 'What you got through' : 'What the shift got through'}>
      <header className="pkc-head">
        <History size={15} aria-hidden="true" />
        <strong>
          {mine ? 'Your last' : 'Last'} {hours}h — {t.boxes_packed} box{t.boxes_packed === 1 ? '' : 'es'} packed
          {t.boxes_shipped > 0 && `, ${t.boxes_shipped} out`}
        </strong>
        {/* Three windows, not a date picker: a shift, a day, a week. Anything
            finer is a question this panel is not for. */}
        <span className="pks-windows" role="group" aria-label="Window">
          {[[12, 'Shift'], [24, 'Day'], [168, 'Week']].map(([h, label]) => (
            <button
              key={h}
              type="button"
              className={`glass-btn glass-btn-sm${hours === h ? ' glass-btn-primary' : ''}`}
              onClick={() => setHours(h)}
              aria-pressed={hours === h}
            >
              {label}
            </button>
          ))}
        </span>
      </header>

      {data.people.length === 0 ? (
        <p className="pkc-empty">
          {mine
            ? 'You have not packed or dispatched anything in that window.'
            : 'Nothing was packed or dispatched in that window.'}
        </p>
      ) : (
        <ul className="pkc-list pks-list">
          {data.people.map((p) => (
            <li key={p.user_id} className="pkc-row pks-row">
              {/* No name on your own row: there is exactly one, it is yours,
                  and the header already says so. A deleted staff account keeps
                  its work and loses its name — the boxes were still packed, so
                  the row stays either way. */}
              {!mine && (
                <span className="pkc-who">
                  <Hand size={12} aria-hidden="true" />
                  {p.username || <em>deleted account</em>}
                </span>
              )}
              <span className="pks-stat" title="Boxes this person packed, and the units recorded in them">
                <Package size={11} aria-hidden="true" />
                {p.boxes_packed} box{p.boxes_packed === 1 ? '' : 'es'}
                <em>{p.units_boxed} unit{p.units_boxed === 1 ? '' : 's'}</em>
              </span>
              <span className="pks-stat" title="Cartons this person taped shut">
                <PackageCheck size={11} aria-hidden="true" /> {p.boxes_sealed} sealed
              </span>
              {p.boxes_shipped > 0 && (
                <span className="pks-stat" title="Parcels this person dispatched">
                  <Truck size={11} aria-hidden="true" /> {p.boxes_shipped} out
                </span>
              )}
              {p.shorts_raised > 0 && (
                <span className="pks-stat is-short" title="Lines this person could not fill and flagged for the order desk">
                  <AlertTriangle size={11} aria-hidden="true" /> {p.shorts_raised} short
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Stated, not implied. A panel showing per-person figures with one
          metric quietly missing invites the reader to read absence as zero. */}
      {data.picks_attributable === false && (
        <p className="pks-caveat">
          Units are counted as <strong>boxed</strong>, not picked — a line does not record who
          pulled it, and the shop deliberately does not keep that.
        </p>
      )}
    </section>
  );
}

/* ────────────────────────────── Queue ────────────────────────────── */

function QueueCard({
  order, onClaim, busy, index,
  selecting, selected, selectable, onToggle, atCap,
}) {
  const pct = order.units > 0 ? Math.round((order.picked / order.units) * 100) : 0;
  const started = order.picked > 0;
  const heldByOther = order.held_by && !order.mine;
  // While choosing a batch the whole card is the target, not a 20px box in its
  // corner: this is picked on a phone at a bench, often with one hand.
  const pickable = selecting && selectable;
  const blocked = pickable && !selected && atCap;
  return (
    <article
      className={`pkq-card${order.mine ? ' is-mine' : ''}${heldByOther ? ' is-held' : ''}`
        + `${selecting ? ' is-choosing' : ''}${selected ? ' is-picked' : ''}`
        + `${pickable && !selected && atCap ? ' is-capped' : ''}`}
      style={{ '--i': Math.min(index, STAGGER_CAP) }}
      onClick={pickable && !blocked ? () => onToggle(order) : undefined}
    >
      {/* The mark states membership, not tickability.

          An order you already hold IS in the batch — a batch is the set of
          orders you hold — so it shows CHECKED and muted rather than as an
          empty box you cannot tick, which is what it drew at first and which
          said the exact opposite of the truth. An order somebody else holds
          gets no mark at all: it is not part of this decision. */}
      {selecting && (selectable || order.mine) && (
        <span className={`pkq-pick${order.mine ? ' is-locked' : ''}`} aria-hidden="true">
          {selected || order.mine ? <SquareCheck size={17} /> : <Square size={17} />}
        </span>
      )}
      <header className="pkq-head">
        <span className="pkq-id">{shortId(order.uuid, order.id)}</span>
        <span
          className={`pkq-status is-${order.status}`}
          title={order.status === 'accepted'
            ? 'Accepted — pack it; it then ships from the Ship desk'
            : 'Paid but not yet accepted — pack it now; the Ship desk accepts and ships it after'}
        >
          {order.status}
        </span>
        <span className={`pkq-age${ageClass(order.created_at)}`} title={new Date(order.created_at).toLocaleString()}>
          <Clock size={11} aria-hidden="true" /> {ageOf(order.created_at)}
        </span>
      </header>

      <div className="pkq-figures">
        <span className="pkq-units">{order.units}</span>
        <span className="pkq-units-label">unit{order.units === 1 ? '' : 's'}</span>
        <span className="pkq-lines">{order.lines} line{order.lines === 1 ? '' : 's'}</span>
        {/* A line the last packer could not fill. The chip is the whole point
            of the short mark: whoever can offer the buyer a substitute is not
            standing at this bench, and this queue is one of the two screens
            they do look at. It reads as a warning rather than as a count,
            because the action it wants is "somebody deal with this", not
            "pick faster". */}
        {order.short_lines > 0 && (
          <span className="pkq-short" title="A packer could not fill this line — the order desk needs to offer a substitute or refund it">
            <AlertTriangle size={11} aria-hidden="true" />
            {order.short_lines} short
          </span>
        )}
      </div>

      {/* What is in it.
          A packer choosing what to take next is choosing between jobs, and two
          cards reading "1 unit · 1 line" are indistinguishable until one of
          them is opened. Two product names make the queue scannable and let
          somebody notice the four orders that all want the same shelf. Names
          and counts only — this screen has never been allowed a buyer. */}
      {order.items?.length > 0 && (
        <ul className="pkq-items">
          {order.items.slice(0, 2).map((it, i) => (
            <li key={`${it.product_name}:${it.variant_name}:${i}`}>
              <b>{it.quantity}×</b> {it.product_name}
              {it.variant_name && <span className="pkq-item-variant">{it.variant_name}</span>}
            </li>
          ))}
          {order.lines > 2 && (
            <li className="pkq-items-rest">+{order.lines - 2} more line{order.lines - 2 === 1 ? '' : 's'}</li>
          )}
        </ul>
      )}

      {/* The carton, not a bar. Drawn once anything is in it OR someone else
          holds the order: a box a third full on somebody's bench is what the
          claim guard is protecting, and this is the first time the queue
          has been able to show it rather than say it. */}
      {(started || heldByOther) && (
        <div className="pkq-carton">
          <Carton
            size={34}
            filled={order.picked}
            capacity={order.units}
            held={heldByOther}
            label={`${order.picked} of ${order.units} unit${order.units === 1 ? '' : 's'} in the box`
              + (heldByOther ? ` — on ${order.held_by_username || "someone's"} bench` : '')}
          />
          <span className="pkq-carton-count">
            <b>{order.picked}</b>/{order.units} <small>{pct}% in the box</small>
          </span>
        </div>
      )}

      {order.packing_note && (
        <p className="pkq-note" title={order.packing_note}>
          <StickyNote size={12} aria-hidden="true" />
          <span>{order.packing_note}</span>
        </p>
      )}

      <footer className="pkq-foot">
        {heldByOther ? (
          <span
            className={`pkq-holder${order.held_on_hold ? ' is-onhold' : ''}`}
            title={order.held_on_hold
              ? `${order.held_by_username || 'Someone'} has asked to keep this order until ${new Date(order.held_until).toLocaleTimeString()}`
              : `Held since ${new Date(order.held_since).toLocaleTimeString()} — a claim left idle frees itself`}
          >
            {order.held_on_hold
              ? <TimerReset size={12} aria-hidden="true" />
              : <Lock size={12} aria-hidden="true" />}
            {' '}{order.held_by_username || 'someone'}
            <span className="pkq-holder-ttl">
              {order.held_on_hold ? 'kept for ' : 'frees in '}{longSpan(freesIn(order))}
            </span>
          </span>
        ) : selecting ? (
          // While choosing, the card IS the control. A second button that
          // navigates away mid-selection would throw the rest of it away.
          <span className={`pkq-choose${selected ? ' is-picked' : ''}`}>
            {selected ? 'In this batch' : order.mine ? 'Already yours' : 'Tap to add'}
          </span>
        ) : (
          <button
            type="button"
            className={`glass-btn glass-btn-sm ${order.mine ? 'glass-btn-success' : 'glass-btn-primary'}`}
            onClick={() => onClaim(order)}
            disabled={busy}
            // The ref, because the visible label repeats per card: a screen
            // reader walking the queue otherwise hears eight identical
            // "Pack this" buttons with nothing to tell them apart.
            aria-label={`${order.mine ? 'Resume packing' : 'Pack'} order ${shortId(order.uuid, order.id)}`}
          >
            {order.mine
              ? <><ArrowLeft size={13} aria-hidden="true" style={{ transform: 'rotate(180deg)' }} /> Resume</>
              : <><Hand size={13} aria-hidden="true" /> Pack this</>}
          </button>
        )}
      </footer>
    </article>
  );
}

function PackQueue() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // A scanner pointed at a box tag or a packing slip lands on the right
  // order — this queue, the bench, or the desk — from anywhere on this page.
  const routeScan = useScanRouter();
  useScanWedge(routeScan);
  // Bumped on every queue load so the flow strip's counts move with the page.
  const [tick, setTick] = useState(0);
  // Supervising is its own grant, so the panel is drawn for the people who
  // hold it and does not exist for anybody else — a door drawn for somebody it
  // will not open for is the failure the pull list's "Assign shelves" link had.
  const canSupervise = useMemo(() => adminCapabilities(user).superviseBench, [user]);
  const [showClaims, setShowClaims] = useState(false);
  const [orders, setOrders] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [batching, setBatching] = useState(false);
  const [maxBatch, setMaxBatch] = useState(12);
  /**
   * Choosing a batch: which orders go in the tote.
   *
   * It used to take the oldest four, full stop. That is the right rule for a
   * phone and for the API — "give me the next N" needs no screen — and it is
   * the wrong one for somebody standing in front of the queue, who can see
   * what the oldest-first rule cannot: that three of these orders are all one
   * shelf, that two carry a note saying the restock is due friday, that the
   * big one will not fit in this tote with the others. So the button now opens
   * a choice, and the server still runs the same guarded claim per order —
   * choosing changes WHICH claimable orders are taken, never whether an order
   * was claimable.
   */
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const timer = useRef(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const data = await api.get('/fulfilment/queue');
      const fresh = data.orders || [];
      setOrders(fresh);
      setTick((n) => n + 1);
      if (data.max_batch) setMaxBatch(data.max_batch);
      setTruncated(!!data.truncated);
      setError(null);
      // Drop ticks for orders that left the queue or were claimed by somebody
      // else while the picker was choosing. A selection that keeps a card
      // nobody can claim any more sends the whole batch to a refusal.
      setSelected((prev) => {
        if (prev.size === 0) return prev;
        const free = new Set(fresh.filter((o) => !o.held_by || o.mine).map((o) => o.id));
        const next = new Set([...prev].filter((id) => free.has(id)));
        return next.size === prev.size ? prev : next;
      });
    } catch (err) {
      setError(err.message || 'Could not load the packing queue');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    timer.current = setInterval(() => load({ quiet: true }), REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  // `n` takes the next order, exactly like the button. A packer's hands are
  // full; the keyboard path is the fast one at a desk with a scanner or a
  // stack of labels.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      claimNext(navigate);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const claim = async (order) => {
    setBusyId(order.id);
    try {
      await api.post(`/fulfilment/orders/${order.id}/claim`);
      navigate(`/admin/pack/${order.id}`);
    } catch (err) {
      // A lost race is normal traffic on a busy bench, not an error state —
      // refresh so the card shows who actually holds it.
      toast.error(err.message || 'Could not claim that order');
      load({ quiet: true });
    } finally {
      setBusyId(null);
    }
  };

  const mineCount = useMemo(() => orders.filter((o) => o.mine).length, [orders]);
  // Orders already yours are already in the batch — a batch IS the set of
  // orders you hold — so the tote's room is what is left after them.
  const room = Math.max(0, maxBatch - mineCount);
  const atCap = selected.size >= room;

  const toggleSelect = (order) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(order.id)) next.delete(order.id);
      else if (next.size < room) next.add(order.id);
      else return prev;
      return next;
    });
    playSound('tick');
  };

  const startChoosing = () => {
    setSelecting(true);
    setSelected(new Set());
  };

  const cancelChoosing = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  /**
   * Take the chosen orders and go to the walk.
   *
   * Sends the ids rather than a count, so the picker gets the orders they
   * looked at. `missed` is named rather than swallowed: an order can be taken
   * by somebody else between the tap that ticked it and the tap that claims
   * it, and a picker who ticked five, got four, and was told nothing will walk
   * the floor believing the fifth is in the tote.
   *
   * With nothing ticked but orders already held, this is just "walk what I
   * have" — no claim call at all, because there is nothing new to take.
   */
  const takeBatch = async () => {
    if (selected.size === 0) {
      setSelecting(false);
      navigate('/admin/pull-list');
      return;
    }
    setBatching(true);
    try {
      const res = await api.post('/fulfilment/batch/claim', { order_ids: [...selected] });
      const missed = res.missed?.length || 0;
      if (missed > 0) {
        toast(`Took ${res.claimed} — ${missed} ${missed === 1 ? 'was' : 'were'} claimed by somebody else first`);
      } else {
        toast.success(`Took ${res.claimed} order${res.claimed === 1 ? '' : 's'} — walk them in one trip`);
      }
      setSelecting(false);
      setSelected(new Set());
      navigate('/admin/pull-list');
    } catch (err) {
      toast.error(err.message || 'Nothing free to claim right now');
      // The queue moved under the selection; re-read it so the cards show who
      // actually holds what before the picker chooses again.
      load({ quiet: true });
    } finally {
      setBatching(false);
    }
  };

  // Your own held order sorts first: "where was I" beats "what is oldest"
  // every time somebody comes back to the bench. The rest stays in the
  // server's oldest-first order.
  const sorted = useMemo(
    () => [...orders].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0)),
    [orders],
  );

  const totals = useMemo(() => ({
    orders: orders.length,
    units: orders.reduce((s, o) => s + (o.units - o.picked), 0),
    mine: orders.filter((o) => o.mine).length,
    held: orders.filter((o) => o.held_by && !o.mine).length,
    noted: orders.filter((o) => o.packing_note).length,
  }), [orders]);

  const stats = [
    { key: 'orders', label: 'Waiting', value: totals.orders, icon: Inbox, tone: 'var(--primary)' },
    { key: 'units', label: 'Units left', value: totals.units, icon: Boxes, tone: 'var(--secondary)' },
    totals.mine > 0 && { key: 'mine', label: 'Yours', value: totals.mine, icon: Hand, tone: 'var(--success)', urgent: true },
    totals.held > 0 && { key: 'held', label: 'With others', value: totals.held, icon: Lock, tone: 'var(--text-muted)' },
    totals.noted > 0 && {
      key: 'noted', label: 'With notes', value: totals.noted, icon: StickyNote, tone: 'var(--warning)',
      hint: 'A packer left a handover',
    },
  ].filter(Boolean);

  return (
    <div className="admin-page pack-page">
      <PageHeader
        icon={PackageCheck}
        title="Packing"
        subtitle={loading ? 'Loading the bench…'
          : totals.orders === 0 ? 'Nothing waiting to be packed'
            : `${totals.orders} order${totals.orders === 1 ? '' : 's'} waiting · ${totals.units} unit${totals.units === 1 ? '' : 's'} left`}
      >
        {orders.length > 0 && !selecting && (
          <button
            type="button"
            className="glass-btn glass-btn-sm glass-btn-primary"
            onClick={() => claimNext(navigate)}
            title="Claim the oldest free order and start packing it (n)"
          >
            <FastForward size={14} aria-hidden="true" /> Pack next
          </button>
        )}
        {/* Take several at once and walk them as ONE trip. Ten small orders
            sharing four shelves is one walk, not ten — see
            services/pickBatches.js. Opens a choice rather than grabbing the
            oldest four: the person looking at the queue can see which orders
            belong in one tote, and the oldest-first rule cannot. */}
        {orders.length > 1 && !selecting && (
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={startChoosing}
            disabled={batching}
            title="Choose the orders to pull in one walk"
          >
            <Layers size={14} aria-hidden="true" /> Take a batch
          </button>
        )}
        {selecting && (
          <button type="button" className="glass-btn glass-btn-sm" onClick={cancelChoosing} disabled={batching}>
            <X size={14} aria-hidden="true" /> Cancel
          </button>
        )}
        {canSupervise && !selecting && (
          <button
            type="button"
            className={`glass-btn glass-btn-sm${showClaims ? ' glass-btn-primary' : ''}`}
            onClick={() => setShowClaims((v) => !v)}
            aria-pressed={showClaims}
            title="Who is holding which order, and how long since they last touched it"
          >
            <ClipboardList size={14} aria-hidden="true" /> On the bench
          </button>
        )}
        <ScanBox />
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => load({ quiet: true })} disabled={refreshing}>
          <RefreshCw size={14} aria-hidden="true" className={refreshing ? 'spin' : ''} /> Refresh
        </button>
      </PageHeader>

      {/* Where this station sits on the route, and what is waiting at the
          others. The Pull list and Ship desk links that used to sit in the
          header live here now, with their backlogs beside them. */}
      <FlowStrip current="pack" refreshKey={tick} />

      {canSupervise && showClaims && <ClaimsPanel onChanged={() => load({ quiet: true })} />}
      {canSupervise && showClaims && <ShiftPanel />}
      {/* A packer's own account of the shift. Only for the people the
          whole-bench panel above is closed to — showing both to a supervisor
          would be the same figures twice, with their own row in each. */}
      {!canSupervise && !selecting && <ShiftPanel mine />}

      {orders.length > 0 && !selecting && <StatTiles stats={stats} />}

      {selecting && (
        <div className="glass-card pkq-choosebar" role="status">
          <Layers size={17} aria-hidden="true" />
          <div className="pkq-choosebar-text">
            <strong>
              Pick the orders for this walk
              {mineCount > 0 && ` — ${mineCount} already yours`}
            </strong>
            <p>
              {selected.size === 0
                ? mineCount > 0
                  ? `Tap the ones to add, or go straight to the walk for the ${mineCount} you hold.`
                  : `Tap the ones to pull together. Up to ${room} in one tote.`
                : `${selected.size} chosen${atCap ? ` — that is the ${maxBatch} one tote holds` : `, ${room - selected.size} more will fit`}.`}
            </p>
          </div>
          <button
            type="button"
            className="glass-btn glass-btn-sm glass-btn-primary"
            onClick={takeBatch}
            disabled={batching || (selected.size === 0 && mineCount === 0)}
          >
            {batching ? 'Claiming…' : selected.size === 0
              ? <>Walk your {mineCount} <ArrowLeft size={13} aria-hidden="true" style={{ transform: 'rotate(180deg)' }} /></>
              : <>Take {selected.size} → pull list</>}
          </button>
        </div>
      )}

      {truncated && (
        <p className="pkq-trunc" role="status">
          Showing the oldest 200 orders — the rest join the queue as these clear.
        </p>
      )}

      {error && (
        <div className="glass-card pull-empty">
          <AlertTriangle size={22} aria-hidden="true" />
          <p>{error}</p>
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => load()}>Try again</button>
        </div>
      )}

      {!error && loading && (
        <div className="pkq-grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="pkq-skel" style={{ '--i': i }} />)}
        </div>
      )}

      {!error && !loading && orders.length === 0 && (
        <div className="glass-card pull-empty">
          <CircleCheck size={22} aria-hidden="true" style={{ color: 'var(--success)' }} />
          <p>The bench is clear. Nothing is waiting to be packed.</p>
        </div>
      )}

      {!error && !loading && orders.length > 0 && (
        <div className="pkq-grid">
          {sorted.map((o, i) => (
            <QueueCard
              key={o.id}
              order={o}
              index={i}
              busy={busyId === o.id}
              onClaim={claim}
              selecting={selecting}
              selected={selected.has(o.id)}
              // Orders you already hold are already in the batch, so there is
              // nothing to tick; orders somebody else holds are not yours to
              // take. Everything else is fair game.
              selectable={!o.held_by}
              atCap={atCap}
              onToggle={toggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── One order ─────────────────────────── */

/**
 * One line's "put it in the box" control.
 *
 * The packer has just counted units off a shelf into their hand; the next
 * physical act is dropping them in a carton. Before this, saying so meant
 * scrolling past every other line to the boxes panel and finding the line
 * again in an "Add items" list — the two halves of one motion, at opposite
 * ends of the screen.
 *
 * It offers the units this line has PICKED but not yet allocated, which is the
 * number in the packer's hand. With one open box it is a single button naming
 * that box; with several, a small menu, defaulting to the last unsealed one
 * because that is the carton currently open on the bench. Sealed boxes are not
 * offered at all — the server would refuse, and a button that cannot work is
 * worse than no button.
 */
function LineToBox({ item, boxes, unallocated, busy, onAllocate }) {
  const [picking, setPicking] = useState(false);
  const open = boxes.filter((b) => !b.sealed_at && !b.shipped_at);
  if (unallocated <= 0 || open.length === 0) return null;

  // The carton currently being filled: the last one opened that is still open.
  const active = open[open.length - 1];

  if (open.length === 1) {
    return (
      <button
        type="button"
        className="pkl-tobox"
        onClick={() => onAllocate(item, active, unallocated)}
        disabled={busy}
        title={`Put the ${unallocated} unit(s) you have picked into box ${active.box_number}`}
      >
        <PackagePlus size={12} aria-hidden="true" /> {unallocated} → Box {active.box_number}
      </button>
    );
  }

  return picking ? (
    <span className="pkl-tobox-pick">
      {open.map((b) => (
        <button
          key={b.id}
          type="button"
          className="pkl-tobox"
          onClick={() => { onAllocate(item, b, unallocated); setPicking(false); }}
          disabled={busy}
        >
          Box {b.box_number}
        </button>
      ))}
      <button type="button" className="pkl-tobox-cancel" onClick={() => setPicking(false)}>cancel</button>
    </span>
  ) : (
    <button
      type="button"
      className="pkl-tobox"
      onClick={() => setPicking(true)}
      disabled={busy}
      title={`Put the ${unallocated} unit(s) you have picked into a box`}
    >
      <PackagePlus size={12} aria-hidden="true" /> {unallocated} → Box…
    </button>
  );
}

function PackLine({
  item, onSet, busy, focused, onFocus, index, can, onSwap, onCount, orderUuid,
  boxes = [], unallocated = 0, onAllocate, onShort,
}) {
  const target = item.quantity - (item.refunded_quantity || 0);
  const complete = item.picked_quantity >= target;
  const short = item.on_hand != null && item.on_hand < target - item.picked_quantity;

  const step = (delta) => {
    const next = Math.max(0, Math.min(target, item.picked_quantity + delta));
    if (next !== item.picked_quantity) onSet(next);
  };

  return (
    <li
      className={`pkl${complete ? ' is-complete' : ''}${focused ? ' is-focused' : ''}${short && !complete ? ' is-short' : ''}`}
      style={{ '--i': Math.min(index, STAGGER_CAP) }}
      onFocus={onFocus}
      onMouseEnter={onFocus}
    >
      <button
        type="button"
        className="pkl-all"
        onClick={() => onSet(complete ? 0 : target)}
        disabled={busy}
        aria-label={complete ? `Clear ${item.variant_name}` : `Mark all ${target} of ${item.variant_name} picked`}
        title={complete ? 'Clear this line' : 'Pick the whole line'}
      >
        <Check size={16} aria-hidden="true" />
      </button>

      <div className="pkl-main">
        <div className="pkl-names">
          <span className="pkl-product">{item.product_name}</span>
          {item.variant_name && item.variant_name !== item.product_name && (
            <span className="pkl-variant">{item.variant_name}</span>
          )}
        </div>
        <div className="pkl-tags">
          {/* Where the shelf is, at a glance — nothing when no map is drawn. */}
          {item.bin_location && <BinChip bin={item.bin_location} />}
          {item.bin_location
            ? <span className="pkl-bin"><MapPin size={11} aria-hidden="true" />{item.bin_location}</span>
            : <span className="pkl-bin is-unfiled"><MapPin size={11} aria-hidden="true" />Unfiled</span>}
          {item.refunded_quantity > 0 && (
            <span className="pkl-tag" title="Already refunded to store credit">
              {item.refunded_quantity} refunded
            </span>
          )}
          {short && !complete && (
            <span className="pkl-tag is-warn" title={`Only ${item.on_hand} on hand`}>
              <AlertTriangle size={11} aria-hidden="true" /> {item.on_hand} on hand
            </span>
          )}
        </div>
      </div>

      {/* Print-only: a hand-tick box beside the counter state, so a slip
          walked to a bench without a screen still has somewhere to record. */}
      <span className="pkl-print-box" aria-hidden="true" />

      <div className="pkl-counter">
        <button type="button" className="pkl-step" onClick={() => step(-1)} disabled={busy || item.picked_quantity === 0} aria-label="One fewer">
          <Minus size={14} aria-hidden="true" />
        </button>
        <span
          className="pkl-count"
          aria-live="polite"
          // Same near-miss forgiveness as the box chips: the counter area is
          // the target, not just the digits inside it.
          onClick={(e) => {
            const input = e.currentTarget.querySelector('input');
            if (input && document.activeElement !== input) { input.focus(); input.select(); }
          }}
        >
          {/* The picked figure is typed as well as stepped: a 54-unit line is
              one entry, not fifty-four presses. Same absolute-set endpoint
              the steppers and hotkeys use. */}
          <QtyInput
            className="pkl-count-now"
            value={item.picked_quantity}
            max={target}
            disabled={busy}
            onCommit={(n) => onSet(n)}
            ariaLabel={`Units of ${item.variant_name || item.product_name} picked`}
          />
          <span className="pkl-count-of">/ {target}</span>
        </span>
        <button type="button" className="pkl-step" onClick={() => step(1)} disabled={busy || complete} aria-label="One more">
          <Plus size={14} aria-hidden="true" />
        </button>
      </div>

      {onAllocate && (
        <div className="pkl-boxing">
          <LineToBox
            item={item}
            boxes={boxes}
            unallocated={unallocated}
            busy={busy}
            onAllocate={onAllocate}
          />
        </div>
      )}

      {/* The count sits with the settlement actions and outlives them: a line
          can be fully picked and the shelf still be wrong, and a picker who
          counted twelve where the catalogue said ten has found the same error
          as one who counted three. Offered only where there is a catalogue row
          to count against — an orphaned line has no shelf. */}
      {onCount && can.count_stock && item.variant_id && (
        <div className="pkl-count">
          <button
            type="button"
            className="pkl-countbtn"
            onClick={onCount}
            title={item.on_hand == null
              ? 'Record what is actually on this shelf'
              : `The catalogue says ${item.on_hand} — record what is actually there`}
          >
            <ClipboardList size={12} aria-hidden="true" /> Count
          </button>
        </div>
      )}

      {/*
        * ── The handoff ──
        *
        * A packer who cannot fill a line has three answers on this screen and
        * only two of them used to be reachable by a picker. Swap and Refund
        * both need grants (`orders.swap_items`, `orders.refund_credit`) that
        * live with whoever runs the order desk — who is somewhere else and has
        * no way of learning that this just happened.
        *
        * So this is the third: it records the shortage and the packer's own
        * words, and it is `orders.pick` work because it is a statement about
        * the shelf in front of them. The queue, the Ship desk and the order
        * page read it; the person with the swap grant opens the substitution
        * tool already pointed at this line.
        *
        * Offered whether or not the line is complete, unlike the two below: a
        * packer can fill three of five and still need somebody told about the
        * other two, and the server refuses only the case where nothing is
        * outstanding at all.
        */}
      {onShort && (
        <div className="pkl-shortmark" data-on={item.short_at ? 'yes' : 'no'}>
          {item.short_at ? (
            <>
              <span className="pkl-shortmark-flag">
                <AlertTriangle size={12} aria-hidden="true" /> Marked short
                {item.short_note && <em>“{item.short_note}”</em>}
              </span>
              <button
                type="button"
                className="pkl-shortbtn"
                onClick={() => onShort(item, false)}
                disabled={busy}
                title="The stock turned up — clear the mark"
              >
                Clear
              </button>
            </>
          ) : !complete && (
            <button
              type="button"
              className="pkl-shortbtn"
              onClick={() => onShort(item, true)}
              disabled={busy}
              title="Tell the order desk this line cannot be filled"
            >
              <AlertTriangle size={12} aria-hidden="true" /> Cannot fill this
            </button>
          )}
        </div>
      )}

      {!complete && (can.swap || can.refund_credit) && (
        <div className="pkl-settle">
          {can.swap && (
            <button type="button" className="glass-btn glass-btn-sm" onClick={onSwap} disabled={busy || item.swap_eligibility?.allowed === false} title={item.swap_eligibility?.reason || 'Offer the buyer a different variant'}>
              <ArrowLeftRight size={12} aria-hidden="true" /> Swap
            </button>
          )}
          {can.refund_credit && (
            <Link
              to={`/orders/${orderUuid}`}
              className="glass-btn glass-btn-sm"
              title="Refund this line to store credit, on the order page — refunds are priced from order totals, which the packing screen does not load"
            >
              <Receipt size={12} aria-hidden="true" /> Refund
            </Link>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Count the shelf, from the bench.
 *
 * ── Why a short line needed a third answer ──────────────────────────────────
 *
 * A line that cannot be filled is the store finding out its stock number was
 * wrong, and the bench offered two answers to it: swap (changes what the buyer
 * gets) and refund (changes what they paid). Neither of them says the SHELF
 * was wrong, so the on-hand figure went on drifting and the pull list went on
 * predicting shortages from the same bad number — exactly what
 * `services/stockCounts` was built to end. The count existed; it just lived on
 * Stock Ops, three screens from the person holding the evidence in their hand.
 *
 * It is offered on any line with a catalogue row, not only a short one: a
 * picker who finds TWELVE where the system said ten has found the same kind of
 * error, and a discrepancy nobody wrote down is a discrepancy nobody can act
 * on.
 *
 * The count is recorded either way; what the packer's grants decide is whether
 * it also MOVES stock. `products.stock` applies it on the spot, `products.count`
 * files it for somebody who can. The button says which will happen before it
 * is pressed, because "recorded" and "applied" are different promises.
 *
 * Nothing here touches the ORDER. Counting the shelf does not fill the line —
 * the buyer is still owed those units, and settling that is still a swap or a
 * refund. The dialog says so rather than implying the short line is dealt with.
 */
function CountDialog({ item, applies, onDone, onCancel }) {
  const dialogRef = useRef(null);
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const el = dialogRef.current;
    if (el && !el.open) el.showModal();
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return undefined;
    const onCancelEvent = (e) => { e.preventDefault(); onCancel(); };
    el.addEventListener('cancel', onCancelEvent);
    return () => el.removeEventListener('cancel', onCancelEvent);
  }, [onCancel]);

  const n = parseInt(counted, 10);
  const valid = Number.isInteger(n) && n >= 0;
  const expected = item.on_hand;
  const delta = valid && expected != null ? n - expected : null;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    try {
      const res = await api.post('/stock/counts', {
        variant_id: item.variant_id,
        bin_location: item.bin_location || null,
        counted: n,
        note: note.trim() || null,
      });
      playSound('tick');
      toast.success(res.applied
        ? `Shelf set to ${n} — the catalogue is updated`
        : `Counted ${n} — filed for approval`);
      onDone(res);
    } catch (err) {
      toast.error(err.message || 'Could not record that count');
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialogRef} className="pk-release-dialog" aria-label="Count this shelf">
      <form className="pk-release-form" onSubmit={submit}>
        <header className="pk-release-head">
          <h3><ClipboardList size={15} aria-hidden="true" /> Count the shelf</h3>
          <button type="button" className="glass-btn glass-btn-sm" onClick={onCancel} aria-label="Close">
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <p className="pk-release-lead">
          <strong>{item.variant_name || item.product_name}</strong>
          {item.bin_location ? ` at ${item.bin_location}` : ' (unfiled)'} — the catalogue says{' '}
          <strong>{expected == null ? 'unknown' : expected}</strong>. How many are actually there?
        </p>
        <input
          className="glass-input"
          type="number"
          min="0"
          inputMode="numeric"
          value={counted}
          onChange={(e) => setCounted(e.target.value)}
          placeholder="Units on the shelf"
          aria-label="Units counted"
          // The one field worth taking focus for: the packer is already
          // holding the answer.
          autoFocus
        />
        {delta != null && delta !== 0 && (
          <p className={`pk-count-delta${delta < 0 ? ' is-short' : ''}`}>
            {delta > 0 ? `${delta} more` : `${Math.abs(delta)} fewer`} than the catalogue thinks.
          </p>
        )}
        <textarea
          className="glass-input pk-release-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          rows={2}
          placeholder="Why, if it is worth saying — e.g. two damaged, one behind the shelf"
          aria-label="Note about this count"
        />
        <p className="pk-count-foot">
          {applies
            ? 'This sets the on-hand figure straight away, and is audited.'
            : 'This is filed for somebody with stock permission to approve — the catalogue does not move yet.'}
          {' '}It does not fill the line: the buyer is still owed those units.
        </p>
        <div className="pk-release-actions">
          <button type="button" className="glass-btn glass-btn-sm" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="glass-btn glass-btn-sm glass-btn-primary" disabled={!valid || busy}>
            <ClipboardList size={13} aria-hidden="true" />
            {busy ? 'Recording…' : applies ? 'Count and apply' : 'File this count'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/**
 * The release dialog. A native <dialog>, for the same reasons SwapComposer
 * gives at length: focus trapping, Escape, and the top layer for free.
 *
 * The note is the whole point of making release a dialog instead of a button:
 * the moment somebody walks away from a half-done box is the one moment they
 * know why, and a release that cannot carry that reason turns every handover
 * into archaeology. Pre-filled with the current note because release REPLACES
 * it — clearing the field clears the note, which is how a resolved "2 short"
 * stops haunting the card.
 */
function ReleaseDialog({ note: initial, onRelease, onCancel, busy }) {
  const dialogRef = useRef(null);
  const [note, setNote] = useState(initial || '');

  useEffect(() => {
    const el = dialogRef.current;
    if (el && !el.open) el.showModal();
  }, []);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return undefined;
    const onCancelEvent = (e) => { e.preventDefault(); onCancel(); };
    el.addEventListener('cancel', onCancelEvent);
    return () => el.removeEventListener('cancel', onCancelEvent);
  }, [onCancel]);

  return (
    <dialog ref={dialogRef} className="pk-release-dialog" aria-label="Release this order">
      <form
        className="pk-release-form"
        onSubmit={(e) => { e.preventDefault(); onRelease(note); }}
      >
        <header className="pk-release-head">
          <h3><ArrowLeft size={15} aria-hidden="true" /> Release this order</h3>
          <button type="button" className="glass-btn glass-btn-sm" onClick={onCancel} aria-label="Close">
            <X size={14} aria-hidden="true" />
          </button>
        </header>
        <p className="pk-release-lead">
          It goes back in the queue for anyone to claim. Leave a note if the next
          packer should know something about this box.
        </p>
        <textarea
          className="glass-input pk-release-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={280}
          rows={3}
          placeholder="e.g. 2 short on the cart line — restock due friday"
          aria-label="Handover note for the next packer"
        />
        <div className="pk-release-actions">
          <span className="pk-release-count">{note.length}/280</span>
          <button type="button" className="glass-btn glass-btn-sm" onClick={onCancel} disabled={busy}>
            Keep packing
          </button>
          <button type="submit" className="glass-btn glass-btn-sm glass-btn-primary" disabled={busy}>
            <ArrowLeft size={13} aria-hidden="true" />
            {busy ? 'Releasing…' : note.trim() ? 'Release with note' : 'Release'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function PackOne({ id }) {
  const navigate = useNavigate();
  const { settings } = useTheme();
  const routeScan = useScanRouter();
  useScanWedge(routeScan);
  // Which sheet the next print shows: 'tags' (one per carton) or 'slip'
  // (the packing slip that goes in the parcel). See PrintSheets.
  const [printMode, print] = usePrintMode();
  // Set once the pack is finished, in place of navigating away: the box is
  // done and the next move is offered here — the desk, the next order, or
  // the tags that have not been printed yet.
  const [done, setDone] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState(0);
  const [swapItem, setSwapItem] = useState(null);
  const [countItem, setCountItem] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseBusy, setReleaseBusy] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [claiming, setClaiming] = useState(false);
  // When the claim was last renewed, as this client last heard it. Every
  // recorded pick renews it server-side, so the countdown resets on activity
  // and only ever runs down while the bench is idle.
  const [renewedAt, setRenewedAt] = useState(null);
  // An explicit hold the packer bought, as a timestamp in ms — separate from
  // `renewedAt` because the two expire on different clocks. Activity pushes the
  // TTL; a hold does not move when you work, and the claim ends at the LATER of
  // the two. Collapsing them into one number would either lose an hour somebody
  // paid for on the next pick, or leave the countdown showing a hold that
  // recorded picks had already outrun.
  const [holdUntil, setHoldUntil] = useState(null);
  const [extending, setExtending] = useState(false);
  const [, setClockTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await api.get(`/fulfilment/orders/${id}`);
      setData(res);
      setError(null);
      setRenewedAt(res.order?.mine && res.order?.held_since ? new Date(res.order.held_since).getTime() : null);
      setHoldUntil(res.order?.mine && res.order?.hold_until ? new Date(res.order.hold_until).getTime() : null);
    } catch (err) {
      setError(err.message || 'Could not load that order');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // The claim countdown only needs minute resolution, so a slow tick is
  // enough to keep it honest without re-rendering the bench every second.
  useEffect(() => {
    const t = setInterval(() => setClockTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  const items = data?.items || [];
  const can = data?.can || { swap: false, refund_credit: false, count_stock: false, apply_counts: false };
  const order = data?.order;
  const mine = order?.mine;
  const claimMinutes = data?.claim_minutes || 20;
  // Whether every box must carry a tracking number before it ships — sent
  // with the order so the bench can label its completion button honestly.
  const requireTracking = !!data?.require_tracking;
  const boxes = data?.boxes || [];

  const totals = useMemo(() => {
    const target = items.reduce((s, i) => s + (i.quantity - (i.refunded_quantity || 0)), 0);
    const picked = items.reduce((s, i) => s + i.picked_quantity, 0);
    return { target, picked, pct: target > 0 ? Math.round((picked / target) * 100) : 0 };
  }, [items]);

  const allPicked = totals.target > 0 && totals.picked >= totals.target;

  /**
   * Per line: units PICKED but not yet in any box — what is physically in the
   * packer's hand right now, and therefore what the line's "into box" button
   * offers.
   *
   * Deliberately measured against `picked_quantity`, not the line's
   * outstanding total: offering to box units nobody has pulled off a shelf yet
   * would let the record run ahead of the physical work, which is the one way
   * a contents record becomes a lie without anybody typing a wrong number.
   */
  const unallocatedByLine = useMemo(() => {
    const inBoxes = new Map();
    for (const box of boxes) {
      for (const alloc of box.items || []) {
        inBoxes.set(alloc.order_item_id, (inBoxes.get(alloc.order_item_id) || 0) + alloc.quantity);
      }
    }
    return new Map(items.map((i) => [i.id, Math.max(0, i.picked_quantity - (inBoxes.get(i.id) || 0))]));
  }, [boxes, items]);

  /**
   * Put a line's in-hand units into a box.
   *
   * ADDS to whatever that box already holds of the line rather than replacing
   * it — pressing twice after picking two more units means four in the box,
   * not two. The endpoint itself is absolute (the setPicked idempotency rule),
   * so the sum is computed here where the current allocation is known.
   */
  const allocateToBox = useCallback(async (item, box, units) => {
    if (!item || !box || units <= 0) return;
    const already = (box.items || []).find((a) => a.order_item_id === item.id)?.quantity || 0;
    setBusy(true);
    playSound('tick');
    try {
      const res = await api.put(`/fulfilment/orders/${order.id}/boxes/${box.id}/items`, {
        order_item_id: item.id,
        quantity: already + units,
      });
      setData((prev) => (prev ? { ...prev, boxes: res.boxes } : prev));
    } catch (err) {
      toast.error(err.message || 'Could not put that in the box');
    } finally {
      setBusy(false);
    }
  }, [order?.id]);

  // How long one press buys and how far a hold may reach, from the server so
  // the button names its own effect rather than restating a constant that
  // would drift from utils/packClaim the first time either changes.
  const holdStep = data?.hold?.step_minutes || 60;
  const holdMax = data?.hold?.max_minutes || 480;

  // The claim ends at the LATER of the two clocks — exactly the rule the
  // server enforces in packClaim.claimExpiresAt. Any other arithmetic here
  // produces a bench counting down to a moment the server will not honour.
  const claimEndsAt = mine
    ? Math.max(renewedAt ? renewedAt + claimMinutes * 60000 : 0, holdUntil || 0)
    : 0;
  const claimLeft = claimEndsAt ? Math.max(0, Math.ceil((claimEndsAt - Date.now()) / 60000)) : null;
  const onHold = !!holdUntil && holdUntil > Date.now();
  // Room left under the ceiling. Below a minute there is nothing another press
  // could add, so the button says so instead of pressing into a no-op.
  const holdRoom = holdMax - Math.max(0, ((holdUntil || Date.now()) - Date.now()) / 60000);
  const holdFull = holdRoom < 1;

  /**
   * Buy another hour on this claim.
   *
   * The case is the big order: a picker takes a tote to the far end of the
   * building and records nothing for half an hour, and the store hands their
   * half-packed box to somebody else who walks to the same shelves and finds
   * the units gone. Renewing by hand only helps somebody standing at the
   * screen — which is exactly who did not need it.
   */
  const extend = async () => {
    setExtending(true);
    try {
      const res = await api.post(`/fulfilment/orders/${id}/extend`);
      setHoldUntil(new Date(res.hold_until).getTime());
      setRenewedAt(Date.now());
      playSound('tick');
      toast.success(res.capped
        ? `Kept until ${new Date(res.hold_until).toLocaleTimeString()} — that is as long as a hold goes`
        : `Yours until ${new Date(res.hold_until).toLocaleTimeString()}`);
    } catch (err) {
      toast.error(err.message || 'Could not extend the claim');
      // A refused extension usually means the claim went while the packer was
      // away — re-read so the screen offers "take this order" instead of a
      // countdown to a claim they no longer hold.
      load();
    } finally {
      setExtending(false);
    }
  };

  const setPicked = useCallback(async (item, next) => {
    setBusy(true);
    const target = item.quantity - (item.refunded_quantity || 0);
    // The sound rides the press, not the round trip — a confirmation that
    // arrives half a second after the thumb moved reads as a different event.
    playSound(next >= target && target > 0 ? 'cart' : 'tick');
    // Optimistic: a packer pressing a stepper once per physical item cannot
    // wait on a round trip between units. A failure re-reads the server's
    // truth rather than trying to unwind by hand.
    setData((prev) => prev && ({
      ...prev,
      items: prev.items.map((i) => (i.id === item.id ? { ...i, picked_quantity: next } : i)),
    }));
    try {
      await api.put(`/fulfilment/orders/${id}/items/${item.id}/picked`, { picked_quantity: next });
      // The server refreshed the claim alongside the pick; mirror it so the
      // countdown in the bench resets with the same clock.
      setRenewedAt(Date.now());
    } catch (err) {
      toast.error(err.message || 'Could not record that pick');
      load();
    } finally {
      setBusy(false);
    }
  }, [id, load]);

  /**
   * Mark a line short, or clear the mark.
   *
   * Asks for the note on the way, because the note is most of the value: "only
   * 3 of the 5, the rest of the batch is damaged" is what lets whoever offers
   * the substitute write something sensible to the buyer, and a flag with no
   * words is a message that says "go and ask the packer".
   *
   * A `prompt` rather than an inline field, and that is a real trade. The bench
   * is a screen somebody uses with one hand while holding a tote, and adding a
   * textarea per line to a list of forty lines is chrome on the screen's
   * busiest surface for an action that happens twice a week. The prompt is
   * cancellable and the note is optional — an empty one still records the
   * shortage, which is the part that has to reach the order desk.
   *
   * NOT optimistic, unlike the pick stepper. A pick is one of fifty presses a
   * minute and a packer cannot wait on a round trip between units; a short is a
   * message to another person, and showing it as sent before the server has it
   * is the one case where the optimistic update would lie about something
   * somebody else is relying on.
   */
  const markShort = useCallback(async (item, short) => {
    let note;
    if (short) {
      // eslint-disable-next-line no-alert
      note = window.prompt(`What is wrong with ${item.variant_name || item.product_name}?\n(optional — the order desk sees this, the buyer never does)`);
      if (note === null) return; // cancelled
    }
    setBusy(true);
    try {
      await api.put(`/fulfilment/orders/${id}/items/${item.id}/short`, {
        short,
        note: short ? (note || '').trim() || undefined : undefined,
      });
      setRenewedAt(Date.now());
      toast.success(short ? 'The order desk can see it now' : 'Mark cleared');
      load();
    } catch (err) {
      toast.error(err.message || 'Could not mark that line');
    } finally {
      setBusy(false);
    }
  }, [id, load]);

  // Keyboard-first, because the alternative is a mouse in a hand that is
  // holding something. Space picks the focused line whole, arrows step it,
  // digits set an exact count, j/k walk the list. Ignored while a dialog or a
  // text field has focus.
  useEffect(() => {
    const onKey = (e) => {
      if (!mine || !items.length) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.querySelector('dialog[open]')) return;

      const item = items[focus];
      if (!item) return;
      const target = item.quantity - (item.refunded_quantity || 0);

      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setFocus((f) => Math.min(items.length - 1, f + 1)); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setFocus((f) => Math.max(0, f - 1)); }
      else if (e.key === ' ') { e.preventDefault(); setPicked(item, item.picked_quantity >= target ? 0 : target); }
      else if (e.key === 'ArrowRight' || e.key === '+') { e.preventDefault(); setPicked(item, Math.min(target, item.picked_quantity + 1)); }
      else if (e.key === 'ArrowLeft' || e.key === '-') { e.preventDefault(); setPicked(item, Math.max(0, item.picked_quantity - 1)); }
      else if (/^[0-9]$/.test(e.key)) {
        // An exact count for the line under focus. Clamped, not rejected: on a
        // line of 4, pressing 9 means "all of it" from a gloved hand, and a
        // beep about the difference helps nobody.
        e.preventDefault();
        const n = Math.min(target, parseInt(e.key, 10));
        if (n !== item.picked_quantity) setPicked(item, n);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, focus, mine, setPicked]);

  const claim = async () => {
    setClaiming(true);
    try {
      await api.post(`/fulfilment/orders/${id}/claim`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not claim the order');
      load();
    } finally {
      setClaiming(false);
    }
  };

  const release = async (note) => {
    setReleaseBusy(true);
    try {
      await api.post(`/fulfilment/orders/${id}/release`, { note });
      navigate('/admin/pack');
    } catch (err) {
      toast.error(err.message || 'Could not release the order');
      setReleaseBusy(false);
    }
  };

  const complete = async () => {
    setCompleting(true);
    try {
      const res = await api.post(`/fulfilment/orders/${id}/complete`);
      playSound('success');
      // The page stays, and the next move is offered in place of the bench
      // strip. It used to toast "it ships from the Ship desk" and navigate to
      // the queue, which told a packer who ALSO works the desk to go and find
      // the order they were just holding. Completion never ships (that was a
      // one-press dispatch trap — see the server's completePack), so the next
      // station is always the desk; `can_ship` is the server saying whether
      // this packer can walk there themselves.
      setDone({ can_ship: !!res.can_ship, box_count: res.box_count ?? boxes.length });
    } catch (err) {
      toast.error(err.message || 'Could not complete the pack');
    } finally {
      setCompleting(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-page pack-page">
        <div className="pkq-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="pkq-skel" style={{ '--i': i }} />)}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-page pack-page">
        <div className="glass-card pull-empty">
          <AlertTriangle size={22} aria-hidden="true" />
          <p>{error}</p>
          <Link to="/admin/pack" className="glass-btn glass-btn-sm">Back to the queue</Link>
        </div>
      </div>
    );
  }

  const movedOn = !PICKABLE.includes(order.status);
  const pageClass = `admin-page pack-page pack-one${printMode === 'tags' ? ' is-printing-tags' : printMode === 'slip' ? ' is-printing-slip' : ''}`;

  return (
    <div className={pageClass}>
      <PageHeader
        icon={PackageCheck}
        title={`Packing ${shortId(order.uuid, order.id)}`}
        subtitle={`${totals.picked} of ${totals.target} unit${totals.target === 1 ? '' : 's'} picked · ${items.length} line${items.length === 1 ? '' : 's'} · ${order.status} · ${ageOf(order.created_at)} old`}
      >
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => window.print()} title="Print the pick list — products, counts and shelves, with a tick box per line">
          <Printer size={14} aria-hidden="true" /> Pick list
        </button>
        {/* The bench knows the order id from the path, and `utils/pageContext`
            now sends it — so "this one" resolves through `look_up_order`,
            redacted for whatever this packer may see, and the answer comes
            back with the verbs they are allowed to press. Before that the
            question had to name a number the person was already looking at. */}
        <AskAbout
          question={`I am packing order ${order.id}. What is the state of it, is anything holding it up, and what is the next step?`}
          label="Ask about this order"
          title="Ask the assistant about the order on the bench"
        />
        <Link to={`/orders/${order.uuid}`} className="glass-btn glass-btn-sm" title="Open the full order — customer, address and totals, if you may see them">
          <ExternalLink size={14} aria-hidden="true" /> Order
        </Link>
        {mine && (
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => setReleasing(true)}>
            <ArrowLeft size={14} aria-hidden="true" /> Release
          </button>
        )}
      </PageHeader>

      <div className="pack-print-head" aria-hidden="true">
        Pack slip · {shortId(order.uuid, order.id)} · {totals.target} unit{totals.target === 1 ? '' : 's'} ·{' '}
        {items.length} line{items.length === 1 ? '' : 's'} · printed {new Date().toLocaleString()}
      </div>

      {order.packing_note && (
        <div className="glass-card pk-note" role="note">
          <StickyNote size={16} aria-hidden="true" />
          <div>
            <strong>Handover from the last packer</strong>
            <p>{order.packing_note}</p>
          </div>
        </div>
      )}

      {movedOn && (
        <div className="glass-card pkq-locked">
          <CircleCheck size={18} aria-hidden="true" style={{ color: 'var(--success)' }} />
          <div>
            <strong>This order has moved on — it is now {order.status}.</strong>
            <p>There is nothing left to pack here.</p>
          </div>
          <Link to="/admin/pack" className="glass-btn glass-btn-sm">Queue</Link>
        </div>
      )}

      {!movedOn && !mine && order.claimable && (
        <div className="glass-card pk-claim">
          <Hand size={18} aria-hidden="true" />
          <div>
            <strong>Nobody is packing this order.</strong>
            <p>Take the claim to record picks — it frees itself after {claimMinutes} idle minutes.</p>
          </div>
          <button type="button" className="glass-btn glass-btn-sm glass-btn-primary" onClick={claim} disabled={claiming}>
            <Hand size={13} aria-hidden="true" /> {claiming ? 'Taking…' : 'Take this order'}
          </button>
        </div>
      )}

      {!movedOn && !mine && !order.claimable && (
        <div className="glass-card pkq-locked">
          <Lock size={18} aria-hidden="true" />
          <div>
            <strong>{order.held_by_username || 'Somebody else'} is packing this order.</strong>
            <p>
              Pick a different one from the queue rather than working the same box twice.
              {order.hold_until
                ? `They have asked to keep it for another ${longSpan(freesIn(order))}.`
                : `Their claim frees in ${freesIn(order)}m if they go idle.`}
            </p>
          </div>
          <Link to="/admin/pack" className="glass-btn glass-btn-sm">Queue</Link>
        </div>
      )}

      <div className="pk-progress" role="progressbar" aria-valuenow={totals.pct} aria-valuemin={0} aria-valuemax={100} aria-label="Pack progress">
        {/* The carton at the bench: every pick drops a unit in and the level
            rises against the order's units. The thin track under it keeps
            the exact proportion for the packer who wants the number. */}
        <Carton
          size={58}
          filled={totals.picked}
          capacity={totals.target}
          sealed={allPicked}
          held={!mine && !!order.held_by}
          className="pk-carton"
          label={`${totals.picked} of ${totals.target} unit${totals.target === 1 ? '' : 's'} in the box${allPicked ? ' — everything is in' : ''}`}
        />
        <div className="pk-progress-body">
          <div className="pk-progress-words">
            <b>{totals.picked}</b> of {totals.target} unit{totals.target === 1 ? '' : 's'} in the box
            {allPicked && <span className="pk-progress-done">— everything is in</span>}
          </div>
          <div className="pk-progress-track">
            <div className={`pk-progress-fill${allPicked ? ' is-done' : ''}`} style={{ width: `${totals.pct}%` }} />
          </div>
        </div>
        <span className="pk-progress-pct">{totals.pct}%</span>
      </div>

      <ul className="pkl-list">
        {items.map((item, i) => (
          <PackLine
            key={item.id}
            item={item}
            index={i}
            focused={mine && i === focus}
            onFocus={() => setFocus(i)}
            busy={busy || !mine || order.fulfilment_hold}
            can={mine ? can : { swap: false, refund_credit: false, count_stock: false }}
            onSet={(n) => setPicked(item, n)}
            onSwap={() => setSwapItem(item)}
            onCount={mine && !movedOn ? () => setCountItem(item) : null}
            orderUuid={order.uuid}
            boxes={boxes}
            unallocated={unallocatedByLine.get(item.id) || 0}
            onAllocate={mine && !movedOn ? allocateToBox : null}
            onShort={mine && !movedOn ? markShort : null}
          />
        ))}
      </ul>

      {/* The boxes step, present from the moment the bench opens rather than
          appearing once every line is picked.
          
          It used to wait for `allPicked`, which read as tidy and worked badly:
          a packer spends the whole pick with units accumulating in their hand
          and nowhere on screen to put them, and the per-line "into box" action
          has no target at all until a box exists. The server now creates Box 1
          when the claim holder opens the order, so there is always somewhere
          to put the first thing picked. Still holder-only — boxes are a
          statement about a pack, and only the person holding it may make it. */}
      {mine && !movedOn && !done && (
        <BoxesPanel
          orderId={order.id}
          orderUuid={order.uuid}
          boxes={boxes}
          items={items}
          requireTracking={requireTracking}
          boxPresets={data?.box_presets || []}
          // Where a sealed carton goes. Empty on a store that never named
          // anywhere, and the bench then shows no staging field at all.
          stagingPlaces={data?.staging_places || []}
          disabled={busy || order.fulfilment_hold}
          onPrintTags={() => print('tags')}
          onPrintSlip={() => print('slip')}
          onBoxesChange={(updater) => setData((prev) => prev && ({
            ...prev,
            boxes: typeof updater === 'function' ? updater(prev.boxes || []) : updater,
          }))}
        />
      )}

      {/* The pack is done. The bench strip gives way to the next move —
          which move depends on who is standing here. A packer who also works
          the desk walks the order there in one press; a packer who does not
          is told the desk takes it from here and offered the next order. The
          tags are offered again because the moment after taping the last
          carton is the moment they are needed. */}
      {done && (
        <div className="pk-done" role="status">
          <span className="pk-done-mark" aria-hidden="true"><CircleCheck size={22} /></span>
          <div className="pk-done-text">
            <strong>Packed — {done.box_count} box{done.box_count === 1 ? '' : 'es'}</strong>
            <p>
              {done.can_ship
                ? (order.status === 'paid'
                  ? 'It is waiting at the Ship desk to be accepted and dispatched — you can take it there now.'
                  : 'It is waiting at the Ship desk for tracking and dispatch — you can take it there now.')
                : (order.status === 'paid'
                  ? 'It is on the Ship desk\'s list; someone there accepts it and sends it out.'
                  : 'It is on the Ship desk\'s list; someone there adds tracking and sends it out.')}
            </p>
          </div>
          <div className="pk-done-actions">
            <button type="button" className="glass-btn glass-btn-sm" onClick={() => print('tags')} title="One tag per carton, with a barcode the desk scans">
              <Tags size={13} aria-hidden="true" /> Box tags
            </button>
            <button type="button" className="glass-btn glass-btn-sm" onClick={() => print('slip')} title="The contents sheet that goes in the parcel">
              <FileText size={13} aria-hidden="true" /> Packing slip
            </button>
            {done.can_ship && (
              <button type="button" className="glass-btn glass-btn-sm glass-btn-primary" onClick={() => navigate(`/admin/ship?order=${order.id}`)}>
                <Send size={13} aria-hidden="true" /> Take it to the Ship desk
              </button>
            )}
            <button type="button" className={`glass-btn glass-btn-sm${done.can_ship ? '' : ' glass-btn-primary'}`} onClick={() => claimNext(navigate)} title="Claim the oldest free order (n)">
              <FastForward size={13} aria-hidden="true" /> Pack next
            </button>
            <Link to="/admin/pack" className="glass-btn glass-btn-sm">Queue</Link>
          </div>
        </div>
      )}

      {/* The printed sheets, hidden on screen. Rendered whether or not the
          claim is still held: the tags are most often printed right after
          completion, when the claim has already gone back. */}
      {boxes.length > 0 && (
        <>
          <BoxTagSheet storeName={settings?.store_name} order={order} boxes={boxes} items={items} />
          <PackingSlipSheet storeName={settings?.store_name} order={order} boxes={boxes} items={items} />
        </>
      )}

      {mine && !done && (
        <div className="pk-bench">
          {claimLeft != null && (
            <span className="pk-claim-group">
              <button
                type="button"
                className={`pk-claim-ttl${claimLeft <= 5 && !onHold ? ' is-low' : ''}${onHold ? ' is-held' : ''}`}
                onClick={claim}
                title={onHold
                  ? `You have asked to keep this order until ${new Date(holdUntil).toLocaleTimeString()}. Recording picks renews it too.`
                  : 'Your claim on this order. Recording picks renews it; press to renew it by hand.'}
              >
                {onHold ? <TimerReset size={13} aria-hidden="true" /> : <Timer size={13} aria-hidden="true" />}
                {onHold ? 'kept ' : 'claim '}{longSpan(claimLeft)}
              </button>
              {/* The button for the case renewing cannot cover: a picker away
                  from the screen with a tote. It buys a fixed hour rather than
                  offering a duration picker, because a picker with their hands
                  full needs one press, and pressing twice is two hours. */}
              <button
                type="button"
                className="pk-claim-extend"
                onClick={extend}
                disabled={extending || holdFull}
                title={holdFull
                  ? `A hold reaches ${Math.round(holdMax / 60)} hours and no further — release it or press again later.`
                  : `Keep this order for another ${holdStep} minutes, even if you record nothing`}
              >
                <TimerReset size={13} aria-hidden="true" />
                {extending ? '…' : holdFull ? 'max' : `+${holdStep}m`}
              </button>
            </span>
          )}
          <span className="pk-keys">
            <Keyboard size={13} aria-hidden="true" />
            <kbd>space</kbd> whole line <kbd>←</kbd><kbd>→</kbd> one unit <kbd>0</kbd>–<kbd>9</kbd> exact <kbd>j</kbd><kbd>k</kbd> move
          </span>
          {/* One label, every mode, every permission: finishing a pack never
              ships. It used to when tracking was off, the order was accepted
              and the packer held update_status — an honest label on a fused
              action, and the fusion was the trap: a packer who only meant
              "this box is done" had no way to say it without also telling the
              buyer their order was on its way. Dispatch is the Ship desk's
              own press now, so this button can promise exactly one thing. */}
          {(() => {
            const needsBox = boxes.length === 0;
            return (
              <button
                type="button"
                className="glass-btn glass-btn-primary"
                onClick={complete}
                disabled={!allPicked || needsBox || completing || order.fulfilment_hold}
                title={!allPicked
                  ? 'Every line has to be picked, swapped or refunded first'
                  : needsBox ? 'Record at least one box first'
                    : order.status === 'paid'
                      ? 'Finish — the Ship desk accepts and dispatches it from there'
                      : 'Finish — it ships from the Ship desk, box by box or all at once'}
              >
                <PackageCheck size={15} aria-hidden="true" />
                {completing ? 'Finishing…' : 'Packed — to Ship desk'}
              </button>
            );
          })()}
        </div>
      )}

      {order.fulfilment_hold && <p className="flow-review" role="status">Packing is paused while the customer answers a replacement offer. <Link to={`/orders/${order.uuid}#order-items`}>Review the offer</Link>. Picking resumes when all offers are answered or withdrawn.</p>}
      {countItem && (
        <CountDialog
          item={countItem}
          applies={!!can.apply_counts}
          // Reload either way: an APPLIED count moved `on_hand`, which is the
          // figure every short-line warning on this screen is drawn from, and
          // a filed one did not — but the packer has no way to tell those
          // apart from a screen that did not change.
          onDone={() => { setCountItem(null); load(); }}
          onCancel={() => setCountItem(null)}
        />
      )}

      {swapItem && (
        <SwapComposer
          order={{ id: order.id, uuid: order.uuid }}
          item={swapItem}
          onDone={() => { setSwapItem(null); load(); }}
          onCancel={() => setSwapItem(null)}
        />
      )}

      {releasing && (
        <ReleaseDialog
          note={order.packing_note}
          busy={releaseBusy}
          onRelease={release}
          onCancel={() => setReleasing(false)}
        />
      )}
    </div>
  );
}

export default function PackOrder() {
  const { id } = useParams();
  return id ? <PackOne key={id} id={id} /> : <PackQueue />;
}
