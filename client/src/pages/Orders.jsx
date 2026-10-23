import AttentionOrders from '../components/order/AttentionOrders';
import { ReorderButton, ReorderSummary } from '../components/order/Reorder';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { api } from '../utils/api';
import { useCart } from '../context/CartContext';
import {
  Package, Clock, ChevronRight, CreditCard, Hash, RotateCcw, ArrowRight,
  CheckCircle, AlertTriangle, X, FlaskConical, TrendingUp, TrendingDown,
} from 'lucide-react';
import { ParcelChip } from '../components/order/ParcelStatus';
import ViewToggle from '../components/ViewToggle';
import useViewMode from '../hooks/useViewMode';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

/** A running total wants thousands separators; a line price does not. */
const grouped = (n) =>
  `$${(Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS = {
  pending_payment:        { badge: 'badge-warning', accent: 'var(--warning)', label: 'Awaiting your payment', step: 0 },
  awaiting_confirmation:  { badge: 'badge-warning', accent: 'var(--warning)', label: 'Confirming payment',    step: 0 },
  paid:                   { badge: 'badge-success', accent: 'var(--success)', label: 'Payment received',      step: 1 },
  accepted:               { badge: 'badge-primary', accent: 'var(--secondary)', label: 'Being packed',        step: 2 },
  shipped:                { badge: 'badge-info',    accent: 'var(--primary)', label: 'On its way',            step: 3 },
  delivered:              { badge: 'badge-success', accent: 'var(--success)', label: 'Delivered',             step: 4 },
  disputed:               { badge: 'badge-danger',  accent: 'var(--danger)',  label: 'Dispute open',          step: null },
  cancelled:              { badge: 'badge-muted',   accent: 'var(--text-muted)', label: 'Cancelled',          step: null },
  refunded:               { badge: 'badge-warning', accent: 'var(--warning)', label: 'Refunded',              step: null },
};

const statusOf = (s) => STATUS[s] || { badge: 'badge-primary', accent: 'var(--primary)', label: String(s || '').replace(/_/g, ' '), step: null };

const STEPS = ['Ordered', 'Paid', 'Packed', 'Shipped', 'Delivered'];

const OPEN_STATUSES = ['pending_payment', 'awaiting_confirmation', 'paid', 'accepted', 'shipped'];

/**
 * The five-step track, with the step it has reached written underneath.
 *
 * The dots alone were a row of coloured circles with a `title` attribute — no
 * label, nothing to a screen reader, and nothing at all on touch, where there
 * is no hover to reveal a tooltip. The step name is now printed beside them,
 * which also means the track survives `--glow-strength: 0`, where the lit dot
 * was most of what distinguished "paid" from "shipped".
 *
 * A cancelled or refunded order has no position on this line, so it does not
 * get one drawn: the badge in the header is the whole story there.
 */
function StatusTrack({ status }) {
  const st = statusOf(status);
  if (st.step === null) return null;

  return (
    <div className="ordx-track" role="img" aria-label={`Step ${st.step + 1} of ${STEPS.length}: ${st.label}`}>
      <div className="ordx-track-dots" aria-hidden="true">
        {STEPS.map((step, i) => (
          <span key={step} className="ordx-track-seg">
            <span className={`ordx-dot${i < st.step ? ' is-done' : i === st.step ? ' is-now' : ''}`} />
            {i < STEPS.length - 1 && <span className={`ordx-rail${i < st.step ? ' is-done' : ''}`} />}
          </span>
        ))}
      </div>
      <span className="ordx-track-label">{st.label}</span>
    </div>
  );
}

/**
 * What was actually in the order.
 *
 * The card used to print "1 item(s)" — a count, a lazy parenthetical plural,
 * and no answer to the only question a buyer scanning their own history has,
 * which is *which* order this is. Two lines of real product names identify it
 * instantly; the rest collapses into a count, because a forty-line order would
 * otherwise be the whole page.
 */
function OrderItems({ items, count, max = 2 }) {
  const rows = Array.isArray(items) ? items : [];
  if (rows.length === 0) {
    const n = count || 0;
    return <p className="ordx-items is-empty">{n} {n === 1 ? 'item' : 'items'}</p>;
  }
  const shown = rows.slice(0, max);
  const rest = rows.length - shown.length;
  return (
    <ul className="ordx-items">
      {shown.map(it => (
        <li key={it.id}>
          <b>{it.quantity}×</b> {it.product_name}
          {it.variant_name && <span className="ordx-item-variant">{it.variant_name}</span>}
        </li>
      ))}
      {rest > 0 && <li className="ordx-items-rest">+{rest} more {rest === 1 ? 'line' : 'lines'}</li>}
    </ul>
  );
}

/** Payment method, named honestly wherever the order appears. */
function PayMark({ method }) {
  if (method === 'demo') {
    // An order that reads "PAID" with no money behind it must say so on every
    // surface it appears on, never only at checkout.
    return <span className="orderx-demo-chip"><FlaskConical size={11} aria-hidden="true" /> Demo — no real payment</span>;
  }
  return (
    <span className="ordx-pay">
      <CreditCard size={12} aria-hidden="true" />
      {(method || 'unpaid').replace(/_/g, ' ')}
    </span>
  );
}

function formatDate(d) {
  return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(d) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(0, mins)}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

const refOf = (order) => (order.uuid ? order.uuid.split('-')[0].toUpperCase() : String(order.id));

/**
 * Whose move this order is, in four words.
 *
 * `order.next_action` is computed by the server (utils/orderNextAction.js)
 * from the order's own state and is the same object the order page, the
 * admin queue, the home widget and both bots draw — so a buyer is told one
 * thing about one order wherever they look. The list used to say "Paid" or
 * "Accepted" and nothing about why it had not moved; the unpaid banner above
 * was the only order with an answer.
 *
 * Only the buyer's own move is lit (DESIGN §3): a wait on the store is a
 * fact, not a call to action. Closed orders draw nothing rather than "nothing
 * to do".
 */
function NextLine({ action, compact = false }) {
  if (!action || action.actor === 'none') return null;
  const yours = action.actor === 'viewer';
  return (
    <Link
      to={action.href}
      className={`ordx-next${yours ? ' is-yours' : ''}${compact ? ' is-compact' : ''}`}
      title={action.reason}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="ordx-next-who">{yours ? 'Your move' : action.responsibility}</span>
      <span className="ordx-next-label">{action.label}</span>
      {!compact && <ChevronRight size={12} aria-hidden="true" />}
    </Link>
  );
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  /*
   * DESIGN §6, answered: a TOGGLE, and it is the clearest case in the app for
   * one. Twenty orders is a scroll in cards and a screen in rows, and which a
   * buyer wants depends entirely on why they opened the page — checking on
   * something in flight, where the five-step track is the whole point and only
   * the card has room to draw it, or looking a purchase up months later, where
   * the track is noise and what matters is reading references and totals down
   * one axis. Neither shape is the other with fields removed, so the single
   * responsive table cannot serve both, and neither is phone-only: `.ordx-rows`
   * re-flows to three lines per record on a narrow container rather than
   * dropping columns.
   *
   * This was `'cards' | 'list'` behind this page's own `cs.ordview.v1`. It is
   * `'cards' | 'rows'` under `cs.view.orders.v1` now — the same hook, control
   * and word pair as the two admin lists; see hooks/useViewMode.js. The old key
   * is deliberately not migrated: a buyer re-picks once, which costs less than
   * a compatibility shim living in the codebase forever.
   */
  const [view, setView] = useViewMode('orders');
  // One summary sheet for the whole list, not one per card: the result is a
  // page-level answer, and a panel that opened inside a card would be clipped
  // by it and would move the rows below.
  const [reorderResult, setReorderResult] = useState(null);

  useEffect(() => {
    api.get('/orders')
      .then(data => setOrders(data.orders))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const counts = useMemo(() => {
    const c = { all: orders.length, open: 0, delivered: 0, closed: 0, unpaid: 0 };
    for (const o of orders) {
      if (OPEN_STATUSES.includes(o.status)) c.open += 1;
      else if (o.status === 'delivered') c.delivered += 1;
      else c.closed += 1;
      if (o.status === 'pending_payment') c.unpaid += 1;
    }
    return c;
  }, [orders]);

  const spent = useMemo(
    () => orders.reduce((sum, o) => sum + Number(o.total || 0), 0),
    [orders],
  );

  const FILTERS = [
    { key: 'all', label: 'All', n: counts.all },
    { key: 'open', label: 'In progress', n: counts.open },
    { key: 'delivered', label: 'Delivered', n: counts.delivered },
    { key: 'closed', label: 'Closed', n: counts.closed },
  ];

  const filtered = useMemo(() => {
    if (filter === 'all') return orders;
    if (filter === 'open') return orders.filter(o => OPEN_STATUSES.includes(o.status));
    if (filter === 'delivered') return orders.filter(o => o.status === 'delivered');
    if (filter === 'closed') return orders.filter(o => !OPEN_STATUSES.includes(o.status) && o.status !== 'delivered');
    return orders.filter(o => o.status === filter);
  }, [orders, filter]);

  // The oldest unpaid order is the one whose payment window closes first, so
  // it is the one the banner offers rather than whichever happens to be newest.
  const oldestUnpaid = useMemo(
    () => orders
      .filter(o => o.status === 'pending_payment')
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))[0] || null,
    [orders],
  );

  if (loading) {
    return (
      <div className="page container ordx">
        <h1 className="ordx-title">Your orders</h1>
        <div className="ordx-skels" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="ordx-skel"><span className="skel-line" /><span className="skel-line is-short" /></div>)}
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="page container ordx">
        <div className="glass-card empty-state">
          <Package aria-hidden="true" />
          <h3>No orders yet</h3>
          <p>When you place one it appears here, tracked from payment through packing to delivery.</p>
          {/* Empty states are navigation (DESIGN §9): the two things a person
              with no orders actually does next. */}
          <div className="ordx-empty-acts">
            <Link to="/products" className="glass-btn glass-btn-primary">Browse the catalog</Link>
            <Link to="/support" className="glass-btn">Ask the store</Link>
          </div>
        </div>
        <ReorderSummary result={reorderResult} onClose={() => setReorderResult(null)} />
      </div>
    );
  }

  return (
    <div className="page container ordx">
      <AttentionOrders />
      {/*
        The four equal stat cards that used to open this page — Total / Active /
        Completed / Total Spent, icon over figure over label — were 130px of
        screen giving four facts identical weight, including a box that read
        "Completed 0". Real information is not uniformly weighted. The counts
        that matter live on the filter pills, where they also do something; the
        rest is one line of type under the title.
      */}
      <header className="ordx-head">
        <div className="ordx-head-text">
          <h1 className="ordx-title">Your orders</h1>
          <p className="ordx-sub">
            {counts.all} {counts.all === 1 ? 'order' : 'orders'}
            {counts.open > 0 && <> · <b>{counts.open}</b> in progress</>}
            {' · '}{grouped(spent)} spent
          </p>
        </div>

        {/* The shared switch, not a fourth hand-rolled copy of it. This page's
            version said "Cards / List" while the catalog said "Cards /
            Compact" — one choice with two names, which is how a buyer who
            learns the control on one screen fails to recognise it on the
            next. */}
        <ViewToggle value={view} onChange={setView} label="Order layout" />
      </header>

      {/* The one thing on this page that is the buyer's move rather than the
          store's. Glow means "needs attention" (DESIGN §3), and this is the
          only element on the page that gets it. */}
      {oldestUnpaid && (
        <Link to={`/orders/${oldestUnpaid.uuid || oldestUnpaid.id}`} className="ordx-alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span className="ordx-alert-text">
            {counts.unpaid === 1
              ? <>Order <b>#{refOf(oldestUnpaid)}</b> is waiting for your payment.</>
              : <><b>{counts.unpaid} orders</b> are waiting for your payment — the oldest is <b>#{refOf(oldestUnpaid)}</b>.</>}
          </span>
          <span className="ordx-alert-go">Pay it <ArrowRight size={13} aria-hidden="true" /></span>
        </Link>
      )}

      <div className="status-filter-row ordx-filters">
        {FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            className={`status-filter-pill${filter === f.key ? ' active' : ''}`}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
          >
            {f.label}
            <span className="ordx-pill-n">{f.n}</span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        /* Zero results after filtering, offering the way to widen it rather
           than a full stop. */
        <div className="glass-card empty-state ordx-empty">
          <Package aria-hidden="true" />
          <h3>No orders in this view</h3>
          <p>You have {counts.all} {counts.all === 1 ? 'order' : 'orders'} in total — none of them are {FILTERS.find(f => f.key === filter)?.label.toLowerCase()}.</p>
          <div className="ordx-empty-acts">
            <button type="button" className="glass-btn glass-btn-primary" onClick={() => setFilter('all')}>
              Show all {counts.all}
            </button>
            <Link to="/products" className="glass-btn">Browse the catalog</Link>
          </div>
        </div>
      ) : view === 'rows' ? (
        <div className="ordx-rows" role="table" aria-label="Your orders">
          <div className="ordx-rows-head" role="row">
            <span className="ordx-h" role="columnheader">Order</span>
            <span className="ordx-h" role="columnheader">Placed</span>
            <span className="ordx-h" role="columnheader">Contents</span>
            <span className="ordx-h" role="columnheader">Status</span>
            <span className="ordx-h is-num" role="columnheader">Total</span>
            <span className="ordx-h is-blank" role="columnheader" aria-label="Actions" />
          </div>
          {filtered.map(order => {
            const st = statusOf(order.status);
            return (
              <article key={order.id} className="ordx-row" role="row" style={{ '--row-accent': st.accent }}>
                {/* `data-when` feeds the narrow layout, where the date column
                    is dropped and the stylesheet prints it under the reference
                    instead — dropping a column must never drop a field. */}
                <div className="ordx-row-ref" role="cell" data-when={formatDate(order.created_at)}>
                  <Link className="ordx-row-link" to={`/orders/${order.uuid || order.id}`}>#{refOf(order)}</Link>
                  <PayMark method={order.payment_method} />
                </div>
                <div className="ordx-row-date" role="cell">
                  <span>{formatDate(order.created_at)}</span>
                  <span className="ordx-row-ago">{timeAgo(order.created_at)}</span>
                </div>
                <div className="ordx-row-items" role="cell">
                  <OrderItems items={order.items} count={order.item_count} max={1} />
                </div>
                <div className="ordx-row-status" role="cell">
                  <span className={`badge ${st.badge}`}>{st.label}</span>
                  <NextLine action={order.next_action} compact />
                  <ParcelChip parcels={order.parcels} compact />
                </div>
                <div className="ordx-row-total" role="cell">{money(order.total)}</div>
                <div className="ordx-row-acts" role="cell">
                  <ReorderButton orderRef={order.uuid || order.id} onResult={setReorderResult} label="Buy again" />
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="ordx-cards">
          {filtered.map((order, i) => {
            const st = statusOf(order.status);
            return (
              <article
                key={order.id}
                className="ordx-card"
                data-status={order.status}
                style={{ '--row-accent': st.accent, '--i': Math.min(i, 12) }}
              >
                <div className="ordx-card-top">
                  <Link className="ordx-ref" to={`/orders/${order.uuid || order.id}`}>
                    <Hash size={13} aria-hidden="true" />
                    {refOf(order)}
                  </Link>
                  <span className="ordx-when">
                    <Clock size={11} aria-hidden="true" />
                    <time dateTime={order.created_at} title={new Date(order.created_at).toLocaleString()}>
                      {formatDate(order.created_at)} · {timeAgo(order.created_at)}
                    </time>
                  </span>
                  {/* Only when there is no track to say it. A shipped order
                      wearing an "ON ITS WAY" badge above a track already
                      labelled "ON ITS WAY" is the same redundancy this card was
                      rebuilt to remove, just two statements instead of three. */}
                  {st.step === null && <span className={`badge ${st.badge} ordx-badge`}>{st.label}</span>}
                </div>

                <StatusTrack status={order.status} />
                <NextLine action={order.next_action} />
                {order.parcels?.tracked > 0 && (
                  <div className="ordx-parcel"><ParcelChip parcels={order.parcels} /></div>
                )}

                <div className="ordx-card-body">
                  <OrderItems items={order.items} count={order.item_count} />
                  <div className="ordx-card-figures">
                    <span className="ordx-total">{money(order.total)}</span>
                    <PayMark method={order.payment_method} />
                  </div>
                </div>

                {/* Revealed on a fine pointer, permanent on a coarse one, and
                    the space is reserved either way so the list cannot jitter
                    under the cursor (DESIGN §4). "Open" is never the only path
                    — the reference at the top of the card is the same link. */}
                <div className="ordx-card-acts">
                  <ReorderButton orderRef={order.uuid || order.id} onResult={setReorderResult} label="Buy it again" />
                  <Link to={`/orders/${order.uuid || order.id}`} className="ordx-open">
                    Open order <ChevronRight size={13} aria-hidden="true" />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <ReorderSummary result={reorderResult} onClose={() => setReorderResult(null)} />
    </div>
  );
}
