import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../utils/api';
import toast from 'react-hot-toast';
import {
  Plus, MessageSquare, Paperclip, Package, Timer, LifeBuoy, StickyNote, ShoppingBag, Sparkles,
} from 'lucide-react';
import ViewToggle from '../components/ViewToggle';
import useViewMode from '../hooks/useViewMode';

/**
 * The customer's own tickets.
 *
 * Same card vocabulary as the staff queue, minus everything that is staff-only:
 * no priority, no internal-note count, no customer aggregates. None of that is
 * filtered here — the API simply does not send it to a non-staff caller.
 *
 * DESIGN §6 answer: **a toggle**, the same one the staff queue offers. Cards
 * are right for the three-ticket account, where each ticket is a small case
 * file and there is room to print the whole of it. They are wrong for the
 * account that has been buying for two years: forty comfortable cards is a
 * scroll, and "which of mine is still waiting on a reply" is a question a
 * column of clocks answers in one look and a stack of cards does not. Neither
 * shape wins outright, so the choice is the operator's — sorry, the
 * customer's — and `useViewMode` remembers it.
 *
 * The compact half is `TicketRows` below. The staff queue imports it rather
 * than writing a second one: these two lists already drifted once as cards, and
 * a separately-written row renderer is how they would drift again.
 */

const STATUSES = ['', 'open', 'awaiting_reply', 'resolved', 'closed'];

const statusTone = (status) => ({
  open: 'var(--primary)',
  awaiting_reply: 'var(--warning)',
  resolved: 'var(--success)',
  closed: 'var(--text-muted)',
}[status] || 'var(--text-muted)');

const statusBadge = (status) => ({
  open: 'badge-primary',
  awaiting_reply: 'badge-warning',
  resolved: 'badge-success',
  closed: 'badge-muted',
}[status] || 'badge-muted');

const prettify = (value) => String(value || '').replace(/_/g, ' ');
const money = (value) => `$${Number(value || 0).toFixed(2)}`;

/**
 * "17m", "6h", "3d" — a clock, not a sentence.
 *
 * Exported because `admin/Support.jsx` used to carry a byte-identical copy, and
 * a duplicated clock is a clock that eventually disagrees with itself: the two
 * queues render the same `waiting_since` and must round it the same way, or the
 * same ticket reads "47h" on one screen and "2d" on the other.
 */
export function shortAge(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * How loudly the age clock should shout.
 *
 * Also shared with the staff queue: these are the store's SLA thresholds, and
 * an operator who moves "hot" from 24h to 12h has to move it once, not find the
 * second copy afterwards.
 */
export function waitLevel(hours) {
  if (hours < 6) return 'is-fresh';
  if (hours < 24) return 'is-warm';
  if (hours < 72) return 'is-hot';
  return 'is-critical';
}

/**
 * A ticket as a line item — the one compact shape both support queues use.
 *
 * It lives in the customer page rather than in `admin/Support.jsx` because the
 * import has to run in the direction that does not hand the storefront a
 * dependency on the admin tree: a buyer's page importing the staff queue would
 * drag `adminPermissions` and the whole staff card into a module that has no
 * business holding either. The staff extras — priority, the tier chip, the
 * customer aggregates, the internal-note count, the row actions — are additive
 * and gated on `staff`, and the server does not send any of them to a non-staff
 * caller regardless of what this component would render.
 *
 * Every field the card prints is still here. DESIGN §5 is explicit that the
 * compact view is not the comfortable one with columns deleted, so the record
 * re-flows instead: the conversation counters ride the subject line, the linked
 * order's status and total sit under its reference, and "opened" sits under the
 * wait clock. The three facts that genuinely cannot hold a line — the order's
 * item count and placed date, and the customer aggregates that are zero — are
 * on the owning cell's `title`, which §4 allows as *disclosure*; they are not
 * dropped, and the cards view is one press of the toggle away.
 *
 * The row itself is `.lrows` / `.lrow` from 74-list-views.css: the rhythm, the
 * hairline, the hover, the truncation, the keyboard-reachable actions and the
 * narrow shape are shared with every other queue in the app rather than
 * re-derived here.
 */
export function TicketRows({
  tickets, now, staff = false, hrefFor, busyId = null, renderActions = null,
}) {
  const withActions = staff && typeof renderActions === 'function';

  /**
   * Column tracks, declared once on `.lrows` so the heading row and every
   * record inherit the same string. Set separately on `.lrows-head` and `.lrow`
   * they drift apart the first time somebody widens a column and edits only one
   * of the two.
   *
   * The flexible tracks are `minmax(0, …)`: a track's default `auto` minimum is
   * its content, so one pasted four-hundred-character subject would stop the
   * row truncating and start pushing the list wider than its container.
   *
   * Not one `auto` track anywhere, either, and this is the part that is easy to
   * get wrong: `.lrows-head` and every single `.lrow` are *separate* grid
   * containers that merely share a track string, so a content-sized track
   * resolves independently in each of them. Written `auto`, the action column
   * came out 56px wide under the word "Actions" and 164px wide under a select
   * and two buttons — which pushed a different amount of free space into the
   * `fr` tracks on every line, so the heading sat 70px right of the column it
   * named and a resolved ticket (one button fewer) did not line up with the
   * ticket above it. A fixed width is what makes the columns columns.
   */
  const cols = staff
    ? `78px minmax(0, 2.1fr) minmax(0, 1.4fr) 120px 112px 104px${withActions ? ' 168px' : ''}`
    : '78px minmax(0, 2.6fr) 128px 120px 104px';

  return (
    <div className={`lrows asup-rows${staff ? ' is-staff' : ''}`} style={{ '--lrow-cols': cols }}>
      <div className="lrows-head">
        <span>Ticket</span>
        <span>Subject</span>
        {staff && <span>Customer</span>}
        <span>Order</span>
        <span>Waiting</span>
        <span>Status</span>
        {withActions && <span>Actions</span>}
      </div>

      {tickets.map((t) => {
        const live = t.status !== 'resolved' && t.status !== 'closed';
        const waitMs = t.waiting_since ? now - new Date(t.waiting_since).getTime() : null;
        const level = waitMs != null ? waitLevel(waitMs / 3600000) : null;
        /**
         * `is-urgent` means somebody has to act, not "this ticket is loud".
         * A resolved ticket can still carry an unanswered customer message —
         * `waiting_since` is derived from the conversation, not the status — and
         * painting a closed backlog in the danger tone is exactly how an
         * operator learns to stop seeing the marker on the tickets that matter.
         */
        const urgent = live && (t.priority === 'urgent' || level === 'is-critical');

        const last = t.last_message;
        const author = last
          ? (staff
            ? `${last.is_staff ? 'Staff' : 'Customer'} · ${last.username || 'unknown'}`
            : (last.is_staff ? 'Support' : 'You'))
          : null;

        const notes = staff ? Number(t.internal_note_count || 0) : 0;
        const countsTitle = [
          `${t.message_count} message${t.message_count === 1 ? '' : 's'}`,
          `${t.attachment_count} attachment${t.attachment_count === 1 ? '' : 's'}`,
          staff ? `${notes} internal note${notes === 1 ? '' : 's'}` : null,
        ].filter(Boolean).join(' · ');

        const order = t.order;
        const orderTitle = order
          ? [
            `Order ${order.uuid}`,
            prettify(order.status),
            order.total_redacted ? 'total hidden' : money(order.total),
            `${order.item_count ?? '—'} items`,
            `placed ${order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}`,
          ].join(' · ')
          : undefined;

        // Staff-only aggregates. Zeroes go in the title rather than on the row:
        // "0 disputes" is the ordinary case and spending a cell on it is how a
        // dense list becomes a cluttered one (§7), while a customer who *does*
        // have one gets a flag that cannot be missed.
        const ctx = staff ? t.customer : null;
        const ctxTitle = ctx
          ? [
            `${ctx.order_count} order${ctx.order_count === 1 ? '' : 's'}`,
            `lifetime ${ctx.spend_redacted ? 'hidden' : money(ctx.lifetime_spend)}`,
            `${ctx.other_open_tickets} other open ticket${ctx.other_open_tickets === 1 ? '' : 's'}`,
            `${ctx.active_dispute_count} active dispute${ctx.active_dispute_count === 1 ? '' : 's'}`,
          ].join(' · ')
          : undefined;

        return (
          <div
            key={t.id}
            className={`lrow${urgent ? ' is-urgent' : ''}${busyId === t.id ? ' is-busy' : ''}`}
            // The row accent is the status tone the card's left rail already
            // uses, so switching views does not relearn the colour language —
            // except when the row is urgent, where danger has to win or the
            // urgent fill would be tinted whatever "open" happens to be.
            style={{ '--lrow-tone': urgent ? 'var(--danger)' : statusTone(t.status) }}
            aria-busy={busyId === t.id || undefined}
          >
            <div className="lrow-stack asup-row-idcell">
              <span className="lrow-id">#{t.id}</span>
              {staff && (
                <small className={`asup-row-prio is-${t.priority || 'normal'}`}>
                  {t.priority || 'normal'}
                </small>
              )}
            </div>

            <div className="lrow-stack lrow-wrap">
              <span className="asup-row-line">
                <Link className="asup-row-subject lrow-text" to={hrefFor(t)} title={t.subject}>
                  {t.subject}
                </Link>
                {/* Counters in the mono face (§6) and pinned to the right of
                    the line: fixed width on the right, subject truncating into
                    whatever is left, so a long subject can never push the
                    message count off the row. */}
                <span className="asup-row-counts lrow-num" title={countsTitle}>
                  <MessageSquare size={11} aria-hidden="true" />{t.message_count}
                  {t.attachment_count > 0 && (
                    <>
                      <Paperclip size={11} aria-hidden="true" />{t.attachment_count}
                    </>
                  )}
                  {notes > 0 && (
                    <span className="is-note" title="Internal staff notes — never shown to the customer">
                      <StickyNote size={11} aria-hidden="true" />{notes}
                    </span>
                  )}
                </span>
              </span>
              <small title={last ? `${author} · ${new Date(last.created_at).toLocaleString()}` : undefined}>
                {last
                  ? `${author} · ${shortAge(now - new Date(last.created_at).getTime())} ago · ${last.preview}`
                  : 'No messages yet'}
              </small>
            </div>

            {staff && (
              <div className="lrow-stack lrow-wrap">
                {/* The name gets the whole top line. It shared it with the
                    dispute flags once, and because a flag cannot shrink the
                    name collapsed to "zz…" the moment an account had two of
                    them — so the row identified the customer least precisely
                    exactly when it mattered most. The flags moved down to the
                    head of the second line, where they are still the first
                    thing read and the ellipsis reaches them last. */}
                <span className="asup-row-who lrow-text" title={t.username || 'Deleted account'}>
                  {t.username || 'Deleted account'}
                </span>
                <small title={ctxTitle}>
                  {ctx?.active_dispute_count > 0 && (
                    <span
                      className="asup-row-flag is-alert"
                      title={`${ctx.active_dispute_count} active dispute${ctx.active_dispute_count === 1 ? '' : 's'} on this account`}
                    >
                      {ctx.active_dispute_count} disputed
                    </span>
                  )}
                  {ctx?.other_open_tickets > 0 && (
                    <span
                      className="asup-row-flag is-watch"
                      title={`${ctx.other_open_tickets} other open ticket${ctx.other_open_tickets === 1 ? '' : 's'} from this customer`}
                    >
                      +{ctx.other_open_tickets} open
                    </span>
                  )}
                  {ctx?.tier_name && (
                    <span
                      className="asup-row-tier"
                      style={ctx.tier_color ? { '--asup-tier': ctx.tier_color } : undefined}
                    >
                      {ctx.tier_name}
                    </span>
                  )}
                  {ctx
                    ? `${ctx.order_count} order${ctx.order_count === 1 ? '' : 's'} · ${ctx.spend_redacted ? 'Hidden' : money(ctx.lifetime_spend)}`
                    : '—'}
                </small>
              </div>
            )}

            {order ? (
              <div className="lrow-stack lrow-wrap">
                <Link
                  to={`/orders/${order.uuid}`}
                  className="asup-row-order"
                  title={orderTitle}
                >
                  <Package size={11} aria-hidden="true" />
                  <span className="lrow-text">{order.uuid.slice(0, 8)}</span>
                </Link>
                <small title={orderTitle}>
                  {prettify(order.status)} · {order.total_redacted ? 'Hidden' : money(order.total)}
                </small>
              </div>
            ) : (
              <span className="asup-row-none lrow-wrap">No order</span>
            )}

            <div className="lrow-stack lrow-wrap">
              <span
                className={`asup-clock${level ? ` ${level}` : ''}`}
                title={waitMs != null
                  ? `Customer waiting since ${new Date(t.waiting_since).toLocaleString()}`
                  : `Last activity ${new Date(t.updated_at).toLocaleString()}`}
              >
                <Timer size={11} aria-hidden="true" />
                {waitMs != null
                  ? `waiting ${shortAge(waitMs)}`
                  : `${staff ? 'idle' : 'updated'} ${shortAge(now - new Date(t.updated_at).getTime())}`}
              </span>
              <small title={`Opened ${new Date(t.created_at).toLocaleString()}`}>
                opened {new Date(t.created_at).toLocaleDateString()}
              </small>
            </div>

            <span className="asup-row-statuscell">
              <span className={`badge ${statusBadge(t.status)}`}>{prettify(t.status)}</span>
            </span>

            {withActions && <div className="lrow-actions">{renderActions(t)}</div>}
          </div>
        );
      })}
    </div>
  );
}

export default function Support() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [orderId, setOrderId] = useState('');

  /**
   * What the shop can already answer, fetched while they type the subject.
   *
   * Debounced, because this fires on a field somebody is mid-sentence in and
   * a request per keystroke would be a self-inflicted load test. 600ms is long
   * enough that a normal typist sends one request per phrase and short enough
   * that the answer is there before they reach the message box.
   *
   * The order picker is sent when they have used it: an exact reference beats
   * the subject-line heuristic every time, and this is the one place in the
   * shop that knows which order somebody means without having to guess.
   *
   * Silence is the normal outcome and is never surfaced as an error — the
   * route answers `{answer: null}` when the feature is off, when nothing
   * matched, and when anything at all went wrong, and all three mean the same
   * thing here: show nothing, let them write.
   */
  const [hint, setHint] = useState(null);
  useEffect(() => {
    if (!showNew || subject.trim().length < 6) { setHint(null); return undefined; }
    let alive = true;
    const timer = setTimeout(() => {
      api.post('/ai/support-hint', { subject: subject.trim(), orderId: orderId ? Number(orderId) : null })
        .then((r) => { if (alive) setHint(r?.answer ? r : null); })
        .catch(() => { if (alive) setHint(null); });
    }, 600);
    return () => { alive = false; clearTimeout(timer); };
  }, [showNew, subject, orderId]);
  const [orders, setOrders] = useState([]);
  const [files, setFiles] = useState([]);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  // Cards or line items, remembered across visits. See hooks/useViewMode.js —
  // the point of the shared hook is that this list cannot invent a third
  // spelling of the same idea, or forget the choice the way the admin order
  // queue used to.
  const [view, setView] = useViewMode('support');

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { loadTickets(); }, [filter, page]);

  const loadTickets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter) params.set('status', filter);
      params.set('page', String(page));
      params.set('limit', '12');
      const data = await api.get(`/support?${params}`);
      setTickets(data.tickets || []);
      // The list has always paginated on the server. It never did in the UI, so
      // a customer past the first page of tickets simply lost the rest.
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
      if ((data.totalPages || 1) < page) setPage(data.totalPages || 1);
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  /**
   * Orders this account may attach.
   *
   * Deliberately not `GET /orders?limit=100`, which returns *every* customer's
   * orders to a staff account — so an admin opening this form got a dropdown of
   * orders the create endpoint then rejected — and which runs three sub-queries
   * per row to assemble items, payment and tracking that an <option> never reads.
   */
  const loadOrders = async () => {
    try {
      const data = await api.get('/support/orders/linkable');
      setOrders(data.orders || []);
    } catch {
      // A picker that fails to populate must not block the form: the order link
      // is optional and can be attached to the ticket afterwards.
      setOrders([]);
    }
  };

  const openNewForm = () => {
    setShowNew(true);
    loadOrders();
  };

  /**
   * A ticket written up elsewhere — by the assistant's `open_support_ticket`
   * tool — arrives as `?new=1&subject=…&order=…`. The form opens with the
   * fields filled and NOTHING sent: the whole design of that tool is that
   * the person reads the form and presses Send themselves, so this must never
   * submit. The params are consumed once and cleared, so a reload does not
   * reopen a form somebody closed.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    const s = String(searchParams.get('subject') || '').slice(0, 255);
    const o = String(searchParams.get('order') || '');
    if (s) setSubject(s);
    if (/^\d{1,12}$/.test(o)) setOrderId(o);
    openNewForm();
    setSearchParams({}, { replace: true });
    // Once, on arrival. The params are the trigger and are cleared here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createTicket = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const fd = new FormData();
      fd.append('subject', subject);
      fd.append('body', body);
      if (orderId) fd.append('order_id', orderId);
      for (const f of files) fd.append('attachments', f);
      await api.upload('/support', fd);
      toast.success('Ticket created');
      setSubject('');
      setBody('');
      setOrderId('');
      setFiles([]);
      setShowNew(false);
      setPage(1);
      loadTickets();
    } catch (err) {
      toast.error(err.message);
    }
    setCreating(false);
  };

  const subtitleCount = total === 1 ? '1 ticket' : `${total} tickets`;

  return (
    <div className="page container" style={{ maxWidth: 1000, margin: '0 auto' }}>
      <div className="admin-toolbar">
        <div className="status-filter-row">
          {STATUSES.map(s => (
            <button
              key={s || 'all'}
              type="button"
              className={`status-filter-pill${filter === s ? ' active' : ''}`}
              onClick={() => { setFilter(s); setPage(1); }}
            >
              {s ? prettify(s) : 'All'}
            </button>
          ))}
        </div>
        <div className="asup-controls">
          {!loading && total > 0 && <span className="asup-pager-label">{subtitleCount}</span>}
          <ViewToggle value={view} onChange={setView} label="Ticket layout" />
          <button className="glass-btn glass-btn-primary glass-btn-sm" onClick={openNewForm}>
            <Plus size={14} aria-hidden="true" /> New ticket
          </button>
        </div>
      </div>

      {showNew && (
        <div className="glass-card admin-panel-in" style={{ marginBottom: 'var(--sp-6)' }}>
          <h3 className="admin-card-title">Create a support ticket</h3>
          <form onSubmit={createTicket}>
            <div className="form-group">
              <label htmlFor="asup-subject-field">Subject</label>
              <input
                id="asup-subject-field"
                className="glass-input"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                required
                maxLength={255}
                placeholder="Brief description of your issue"
              />
            </div>
            <div className="form-group">
              <label htmlFor="asup-order-field">Related order (optional)</label>
              <select
                id="asup-order-field"
                className="glass-input"
                value={orderId}
                onChange={e => setOrderId(e.target.value)}
              >
                <option value="">None</option>
                {orders.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.uuid.slice(0, 8)} — {prettify(o.status)} — {o.total_redacted ? 'hidden' : money(o.total)}
                    {' — '}{new Date(o.created_at).toLocaleDateString()}
                  </option>
                ))}
                {/* An order handed in by the link (`?order=`) that the list
                    does not hold — the linkable list is the last hundred,
                    and the order page links every order. A controlled
                    select whose value matches no option draws "None" while
                    the state still carries the id, so the ticket would
                    attach an order the person was shown was not attached.
                    Naming it keeps what is shown and what is sent the same. */}
                {orderId && orders.length > 0 && !orders.some(o => String(o.id) === String(orderId)) && (
                  <option value={orderId}>Order #{orderId} (from the link you followed)</option>
                )}
              </select>
              <p className="admin-hint" style={{ marginTop: 'var(--sp-15)', marginBottom: 0 }}>
                You can attach or change this later from the ticket itself.
              </p>
            </div>
            {/* What the shop can already tell them, beside the box while they
                write. Never blocks, never delays, never asks them to confirm
                they still want to file — it is information next to the form,
                not a step in front of it. Silent unless a deterministic topic
                actually matched, so anything unusual sees nothing at all.
                Off unless the operator turned it on. */}
            {hint?.answer && (
              <div className="asup-hint" role="status">
                <Sparkles size={14} aria-hidden="true" />
                <div>
                  <p className="asup-hint-lead">While you are writing — the shop can already tell you this:</p>
                  <p className="asup-hint-body">{hint.answer}</p>
                  {hint.actions?.length > 0 && (
                    <div className="asup-hint-links">
                      {hint.actions.slice(0, 3).map((a) => (
                        <Link key={a.id} to={a.href} className="glass-btn glass-btn-sm">{a.title}</Link>
                      ))}
                    </div>
                  )}
                  <p className="asup-hint-foot">Send your ticket anyway if this is not what you needed.</p>
                </div>
              </div>
            )}
            <div className="form-group">
              <label htmlFor="asup-body-field">Message</label>
              <textarea
                id="asup-body-field"
                className="glass-input"
                value={body}
                onChange={e => setBody(e.target.value)}
                required
                rows={5}
                placeholder="Describe your issue in detail..."
              />
            </div>
            <div className="form-group">
              <label htmlFor="asup-files-field">Attachments (optional)</label>
              <input
                id="asup-files-field"
                type="file"
                multiple
                accept="image/*,video/*"
                className="glass-input"
                onChange={e => setFiles([...e.target.files])}
              />
            </div>
            <div className="admin-form-actions" style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
              <button type="submit" className="glass-btn glass-btn-primary" disabled={creating}>
                {creating ? <><span className="spinner spinner-inline" /> Creating…</> : 'Submit ticket'}
              </button>
              <button type="button" className="glass-btn" onClick={() => setShowNew(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        // The placeholder has to be the shape that is about to arrive, or the
        // page reflows the moment the data lands — six card silhouettes
        // collapsing into twelve lines is worse than no skeleton at all.
        view === 'rows' ? (
          <div className="lrows asup-rows" aria-busy="true" aria-label="Loading your tickets">
            {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton lrow-skel" />)}
          </div>
        ) : (
          <div className="asup-grid">
            {[0, 1, 2].map(i => <div key={i} className="skeleton asup-skel" />)}
          </div>
        )
      ) : tickets.length === 0 ? (
        // One empty state for both views rather than a `.lrows-empty` twin: a
        // second copy is the one that goes stale, and §9 wants the same three
        // exits either way — open a ticket, widen the filter, or go look at the
        // orders the tickets are usually about.
        <div className="glass-card empty-state">
          <LifeBuoy aria-hidden="true" />
          <h3>{filter ? 'Nothing in this view' : 'No tickets yet'}</h3>
          <p>
            {filter
              ? 'No ticket of yours has that status right now.'
              : 'Open a ticket if something is wrong with an order or you need a hand. Replies land here and in your notifications.'}
          </p>
          <div className="empty-state-links">
            {filter
              ? <button className="glass-btn" onClick={() => { setFilter(''); setPage(1); }}>Show all tickets</button>
              : <button className="glass-btn glass-btn-primary" onClick={openNewForm}><Plus size={14} aria-hidden="true" /> New ticket</button>}
            <Link className="glass-btn" to="/orders">
              <ShoppingBag size={14} aria-hidden="true" /> Your orders
            </Link>
          </div>
        </div>
      ) : view === 'rows' ? (
        <TicketRows tickets={tickets} now={now} hrefFor={(t) => `/support/${t.id}`} />
      ) : (
        <div className="asup-grid">
          {tickets.map((t, idx) => (
            <article
              key={t.id}
              className="glass-card asup-card"
              style={{ '--i': Math.min(idx, 9), '--asup-tone': statusTone(t.status) }}
            >
              <div className="asup-card-top">
                <span className={`badge ${statusBadge(t.status)}`}>{prettify(t.status)}</span>
                {t.waiting_since ? (
                  <span className={`asup-clock ${waitLevel((now - new Date(t.waiting_since).getTime()) / 3600000)}`}>
                    <Timer size={11} aria-hidden="true" />
                    waiting {shortAge(now - new Date(t.waiting_since).getTime())}
                  </span>
                ) : (
                  <span className="asup-clock">
                    <Timer size={11} aria-hidden="true" />
                    updated {shortAge(now - new Date(t.updated_at).getTime())} ago
                  </span>
                )}
              </div>

              <Link className="asup-subject" to={`/support/${t.id}`}>{t.subject}</Link>

              {t.last_message && (
                <div className="asup-quote">
                  <span className="asup-quote-author">
                    {t.last_message.is_staff ? 'Support' : 'You'} ·{' '}
                    {new Date(t.last_message.created_at).toLocaleString()}
                  </span>
                  {t.last_message.preview}
                </div>
              )}

              {t.order ? (
                <div className="asup-order">
                  <div className="asup-order-head">
                    <Link to={`/orders/${t.order.uuid}`} className="asup-order-link" title={t.order.uuid}>
                      <Package size={12} aria-hidden="true" />
                      {t.order.uuid.slice(0, 8)}
                    </Link>
                    <span className="badge badge-muted">{prettify(t.order.status)}</span>
                  </div>
                  <div className="asup-order-facts">
                    <span>Total <b>{t.order.total_redacted ? 'Hidden' : money(t.order.total)}</b></span>
                    <span>Items <b>{t.order.item_count ?? '—'}</b></span>
                    <span>Placed <b>{t.order.created_at ? new Date(t.order.created_at).toLocaleDateString() : '—'}</b></span>
                  </div>
                </div>
              ) : (
                <div className="asup-order-empty">No order attached — you can add one from the ticket.</div>
              )}

              <div className="asup-meta">
                <span><MessageSquare size={12} aria-hidden="true" /> {t.message_count}</span>
                {t.attachment_count > 0 && (
                  <span><Paperclip size={12} aria-hidden="true" /> {t.attachment_count}</span>
                )}
                <span title={new Date(t.created_at).toLocaleString()}>
                  opened {new Date(t.created_at).toLocaleDateString()}
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="asup-pager">
          <button className="glass-btn glass-btn-sm" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
            Prev
          </button>
          <span className="asup-pager-label">Page {page} of {totalPages}</span>
          <button className="glass-btn glass-btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
            Next
          </button>
        </div>
      )}
    </div>
  );
}
