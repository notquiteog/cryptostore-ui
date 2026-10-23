import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { hasAdminPermission } from '../../utils/adminPermissions';
import toast from 'react-hot-toast';
import {
  Headphones, MessageSquare, Paperclip, StickyNote, CheckCircle, XCircle,
  Timer, Package, User, ShoppingBag, Inbox, Flag, Search,
  Scale, UserCheck, MessageCircleDashed,
} from 'lucide-react';
import { ParcelChip } from '../../components/order/ParcelStatus';
import PageHeader from '../../components/admin/PageHeader';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';
import { TicketRows, shortAge, waitLevel } from '../Support';

/**
 * The support queue.
 *
 * A ticket is not a row of eight columns — it is a customer, a conversation, a
 * clock and usually an order, and an operator triages by looking at all four at
 * once. Hence cards: each one carries enough context to decide *without*
 * opening the ticket, which is the only thing that makes a queue of 200 workable.
 *
 * DESIGN §6 answer: **a toggle**, and the paragraph above is exactly half of
 * why. It is the argument for *triage* — one ticket at a time, decided on the
 * spot — and it stays true. It is not the argument for the other thing that
 * happens on this screen, which is working a backlog of sixty. There the
 * question is not "what is this ticket" but "which of these has been waiting
 * longest, and whose", and a column of wait clocks answers that in one look
 * while sixty cards each carrying their clock at a different height do not.
 * The card is also six times the vertical space, so the backlog becomes six
 * screens of scrolling to find the one row that matters.
 *
 * Neither shape is the better answer, which is precisely the case §6 says wants
 * a toggle: the operator picks and `useViewMode` remembers. The compact half is
 * `TicketRows`, imported from the customer's own ticket list rather than
 * written twice — these two queues already drifted once as cards, and a second
 * hand-written row renderer is how they would drift again.
 *
 * Everything below `customer` and `internal_note_count` is staff-only and comes
 * from the server that way; this page never has to decide what to hide.
 */

const STATUSES = ['', 'open', 'awaiting_reply', 'resolved', 'closed'];
/** `support_tickets.kind`, as the server's `kind` filter spells it. */
const KINDS = [
  { key: '', label: 'Any kind' },
  { key: 'question', label: 'Questions' },
  { key: 'dispute', label: 'Disputes' },
];
/** The server's `assigned` filter: my desk, or the pile nobody has picked up. */
const OWNERS = [
  { key: '', label: 'Anyone' },
  { key: 'me', label: 'Mine' },
  { key: 'none', label: 'Unassigned' },
];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

// Statuses share the order page's colour language rather than inventing one.
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

/*
 * `shortAge` and `waitLevel` are imported, not redeclared.
 *
 * Both used to exist here as byte-identical copies of the ones in
 * `pages/Support.jsx`. They are the store's SLA thresholds — the hours a
 * *customer* has been waiting, which the server derives from the last
 * unanswered customer message rather than from `updated_at`, since a status
 * change or an internal note bumps that without the customer hearing a word.
 * Two copies means an operator who moves "hot" from 24h to 12h moves it on one
 * screen and finds the other still lying to them a week later.
 */

function PriorityPill({ priority }) {
  const tone = priority === 'urgent' ? 'is-urgent'
    : priority === 'high' ? 'is-high'
      : priority === 'low' ? 'is-low' : 'is-normal';
  return (
    <span className={`asup-prio ${tone}`}>
      <Flag size={11} aria-hidden="true" />
      {priority || 'normal'}
    </span>
  );
}

function AgeClock({ ticket, now }) {
  if (ticket.waiting_since) {
    const ms = now - new Date(ticket.waiting_since).getTime();
    const hours = ms / 3600000;
    return (
      <span className={`asup-clock ${waitLevel(hours)}`} title={`Customer waiting since ${new Date(ticket.waiting_since).toLocaleString()}`}>
        <Timer size={11} aria-hidden="true" />
        waiting {shortAge(ms)}
      </span>
    );
  }
  const ms = now - new Date(ticket.updated_at).getTime();
  return (
    <span className="asup-clock" title={`Last activity ${new Date(ticket.updated_at).toLocaleString()}`}>
      <Timer size={11} aria-hidden="true" />
      idle {shortAge(ms)}
    </span>
  );
}

/** The linked order, with the totals the viewer is allowed to see. */
function OrderStrip({ order }) {
  if (!order) {
    return <div className="asup-order-empty">No order linked to this ticket.</div>;
  }
  return (
    <div className="asup-order">
      <div className="asup-order-head">
        <Link to={`/orders/${order.uuid}`} className="asup-order-link" title={order.uuid}>
          <Package size={12} aria-hidden="true" />
          {order.uuid.slice(0, 8)}
        </Link>
        <span className={`badge ${order.status === 'disputed' || order.status === 'cancelled' ? 'badge-danger' : 'badge-muted'}`}>
          {prettify(order.status)}
        </span>
        {/* "Where is my parcel" is the commonest ticket; the carrier's
            answer sits beside the ticket so the agent need not go and
            find it. */}
        <ParcelChip parcels={order.parcels} compact />
      </div>
      <div className="asup-order-facts">
        <span>Total <b>{order.total_redacted ? 'Hidden' : money(order.total)}</b></span>
        <span>Items <b>{order.item_count ?? '—'}</b></span>
        <span>Placed <b>{order.created_at ? new Date(order.created_at).toLocaleDateString() : '—'}</b></span>
      </div>
    </div>
  );
}

/** Staff-only aggregates: who is on the other end of this ticket. */
function CustomerContext({ customer }) {
  if (!customer) return null;
  return (
    <div className="asup-ctx">
      <div className="asup-ctx-cell">
        <span className="asup-ctx-label">Lifetime</span>
        <span className={`asup-ctx-value${customer.spend_redacted ? ' is-hidden' : ''}`}>
          {customer.spend_redacted ? 'Hidden' : money(customer.lifetime_spend)}
        </span>
      </div>
      <div className="asup-ctx-cell">
        <span className="asup-ctx-label">Orders</span>
        <span className="asup-ctx-value">{customer.order_count}</span>
      </div>
      <div className="asup-ctx-cell">
        <span className="asup-ctx-label">Other tickets</span>
        <span className={`asup-ctx-value${customer.other_open_tickets > 0 ? ' is-watch' : ''}`}>
          {customer.other_open_tickets}
        </span>
      </div>
      <div className="asup-ctx-cell">
        <span className="asup-ctx-label">Disputes</span>
        <span className={`asup-ctx-value${customer.active_dispute_count > 0 ? ' is-alert' : ''}`}>
          {customer.active_dispute_count}
        </span>
      </div>
    </div>
  );
}

export default function AdminSupport() {
  const { user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');
  // What kind of thread and whose desk. The queue badged a dispute but could
  // not show only disputes, and named an owner but could not show only mine;
  // both are the server's `kind` and `assigned` filters (supportController).
  const [kind, setKind] = useState('');
  const [assigned, setAssigned] = useState('');
  // Who tickets may be handed to. Loaded once: the list is short, changes
  // rarely, and refetching it per row would be a request per keystroke of the
  // queue's own filtering.
  const [assignees, setAssignees] = useState([]);
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [busyId, setBusyId] = useState(null);
  // Cards or line items, remembered per operator. See hooks/useViewMode.js: the
  // shared hook exists so this queue cannot invent a third spelling of the
  // choice, and cannot forget it on navigation the way the admin order queue
  // used to.
  const [view, setView] = useViewMode('admin-support');
  // What the operator is typing vs what the list is filtered by. Debounced so
  // a queue of 200 is not refetched on every keystroke of "refund".
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const id = setTimeout(() => { setQuery(searchInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // The queue reads as a clock, so the ages have to move on their own. One
  // timer for the page rather than one per card.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  // The route is gated on support.view, but the status buttons call an endpoint
  // gated on support.manage. Rendering them regardless is how a read-only
  // manager got two buttons that always answered 403.
  const canManage = hasAdminPermission(user, 'support.manage');

  useEffect(() => { loadTickets(); }, [status, priority, kind, assigned, sort, page, query]);

  // Failure is an absent control, not an error: a queue that cannot be
  // assigned still works, and a manager who lacks `support.manage` gets a 403
  // here by design.
  useEffect(() => {
    if (!canManage) return;
    api.get('/support/assignees')
      .then(d => setAssignees(d.assignees || []))
      .catch(() => setAssignees([]));
  }, [canManage]);

  const loadTickets = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (priority) params.set('priority', priority);
      if (kind) params.set('kind', kind);
      if (assigned) params.set('assigned', assigned);
      if (query) params.set('q', query);
      params.set('sort', sort);
      params.set('page', String(page));
      params.set('limit', '24');
      const data = await api.get(`/support?${params}`);
      setTickets(data.tickets || []);
      setTotalPages(data.totalPages || 1);
      setTotal(data.total || 0);
      // Deleting the last ticket of a page would otherwise strand the operator
      // on an empty page with no way back but the Prev button.
      if ((data.totalPages || 1) < page) setPage(data.totalPages || 1);
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  const patchTicket = (id, changes) => {
    setTickets(prev => prev.map(t => (t.id === id ? { ...t, ...changes } : t)));
  };

  const updateStatus = async (ticket, next) => {
    setBusyId(ticket.id);
    const previous = ticket.status;
    patchTicket(ticket.id, { status: next });
    try {
      await api.put(`/support/${ticket.id}/status`, { status: next });
      toast.success(`Ticket #${ticket.id} ${prettify(next)}`);
    } catch (err) {
      patchTicket(ticket.id, { status: previous });
      toast.error(err.message);
    }
    setBusyId(null);
  };

  const updatePriority = async (ticket, next) => {
    if (next === ticket.priority) return;
    const previous = ticket.priority;
    patchTicket(ticket.id, { priority: next });
    try {
      await api.put(`/support/${ticket.id}/priority`, { priority: next });
      toast.success(`Priority set to ${next}`);
    } catch (err) {
      patchTicket(ticket.id, { priority: previous });
      toast.error(err.message);
    }
  };

  const waitingOnPage = useMemo(
    () => tickets.filter(t => t.waiting_since).length,
    [tickets],
  );

  const subtitle = loading
    ? 'Reading the queue…'
    : total === 0
      ? 'No tickets match this view.'
      : totalPages > 1
        ? `${waitingOnPage} of the ${tickets.length} on this page waiting on a reply · ${total} tickets total`
        : `${waitingOnPage} of ${total} waiting on a reply`;

  const changeFilter = (setter) => (value) => { setter(value); setPage(1); };

  /**
   * The same three controls the card's footer carries, sized for a line.
   *
   * `.lrow-actions` reveals them on `:hover` **and** `:focus-within`, so the
   * keyboard reaches them; on a coarse pointer 74-list-views.css leaves them
   * permanently visible, because touch has no hover and a control nobody can
   * reveal is a control nobody has. Resolve and Close lose their words and keep
   * their `title`/`aria-label` — two labelled buttons plus a select is 260px of
   * track on every row, which is the difference between a subject that reads
   * and a subject truncated to four characters.
   */
  const assign = async (t, raw) => {
    const next = raw === '' ? null : Number(raw);
    const previous = t.assigned_to ?? null;
    const name = assignees.find(a => a.id === next)?.username || null;
    patchTicket(t.id, { assigned_to: next, assignee_username: name });
    try {
      await api.put(`/support/${t.id}/assignee`, { assigned_to: next });
      toast.success(next === null ? `#${t.id} returned to the queue` : `#${t.id} assigned to ${name}`);
    } catch (err) {
      toast.error(err.message);
      // Put the row back. The optimistic patch is what makes the queue feel
      // like a queue; leaving a failed one in place would show a thread as
      // owned by somebody who never took it.
      patchTicket(t.id, {
        assigned_to: previous,
        assignee_username: assignees.find(a => a.id === previous)?.username || null,
      });
    }
  };

  const rowActions = (t) => (
    <>
      <select
        className="glass-input asup-select asup-row-select"
        aria-label={`Assignee for ticket ${t.id}`}
        value={t.assigned_to ?? ''}
        onChange={e => assign(t, e.target.value)}
      >
        <option value="">Unassigned</option>
        {assignees.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}
      </select>
      <select
        className="glass-input asup-select asup-row-select"
        aria-label={`Priority for ticket ${t.id}`}
        value={t.priority || 'normal'}
        onChange={e => updatePriority(t, e.target.value)}
      >
        {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      {t.status !== 'resolved' && t.status !== 'closed' && (
        <button
          type="button"
          className="glass-btn glass-btn-sm glass-btn-success"
          disabled={busyId === t.id}
          onClick={() => updateStatus(t, 'resolved')}
          title={`Resolve ticket #${t.id}`}
          aria-label={`Resolve ticket #${t.id}`}
        >
          <CheckCircle size={14} aria-hidden="true" />
        </button>
      )}
      {t.status !== 'closed' && (
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          disabled={busyId === t.id}
          onClick={() => updateStatus(t, 'closed')}
          title={`Close ticket #${t.id}`}
          aria-label={`Close ticket #${t.id}`}
        >
          <XCircle size={14} aria-hidden="true" />
        </button>
      )}
    </>
  );

  return (
    <div className="admin-page">
      <PageHeader icon={Headphones} title="Support" subtitle={subtitle} />

      <div className="admin-toolbar is-sticky">
        <div className="status-filter-row">
          {STATUSES.map(s => (
            <button
              key={s || 'all'}
              type="button"
              className={`status-filter-pill${status === s ? ' active' : ''}`}
              onClick={() => changeFilter(setStatus)(s)}
            >
              {s ? prettify(s) : 'All'}
            </button>
          ))}
        </div>

        {/* Two more rows of pills, not a dropdown each: a filter the operator
            reaches for on every visit — "just the disputes", "just mine" —
            belongs one press away, in the same row shape as the status. */}
        <div className="status-filter-row" role="group" aria-label="Filter tickets by kind">
          {KINDS.map(k => (
            <button
              key={k.key || 'any'}
              type="button"
              className={`status-filter-pill${kind === k.key ? ' active' : ''}`}
              onClick={() => changeFilter(setKind)(k.key)}
              aria-pressed={kind === k.key}
            >
              {k.key === 'dispute' && <Scale size={11} aria-hidden="true" />}
              {k.label}
            </button>
          ))}
        </div>
        <div className="status-filter-row" role="group" aria-label="Filter tickets by owner">
          {OWNERS.map(o => (
            <button
              key={o.key || 'anyone'}
              type="button"
              className={`status-filter-pill${assigned === o.key ? ' active' : ''}`}
              onClick={() => changeFilter(setAssigned)(o.key)}
              aria-pressed={assigned === o.key}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="admin-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="glass-input"
            type="search"
            placeholder="Subject, customer, #id or order…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search tickets by subject, customer, ticket id or order id"
          />
        </div>

        <div className="asup-controls">
          <label htmlFor="asup-priority">Priority</label>
          <select
            id="asup-priority"
            className="glass-input asup-select"
            value={priority}
            onChange={e => changeFilter(setPriority)(e.target.value)}
          >
            <option value="">Any</option>
            {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>

          <label htmlFor="asup-sort">Sort</label>
          <select
            id="asup-sort"
            className="glass-input asup-select"
            value={sort}
            onChange={e => changeFilter(setSort)(e.target.value)}
          >
            <option value="recent">Most recent</option>
            <option value="waiting">Longest waiting</option>
            <option value="priority">Priority</option>
          </select>

          <ViewToggle value={view} onChange={setView} label="Ticket layout" />
        </div>
      </div>

      {loading ? (
        // The placeholder has to be the shape that is about to arrive. Six card
        // silhouettes collapsing into twenty-four lines the moment the data
        // lands is a reflow, which is the one thing a skeleton exists to avoid.
        view === 'rows' ? (
          <div className="lrows asup-rows is-staff" aria-busy="true" aria-label="Loading the queue">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => <div key={i} className="skeleton lrow-skel" />)}
          </div>
        ) : (
          <div className="asup-grid">
            {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton asup-skel" />)}
          </div>
        )
      ) : tickets.length === 0 ? (
        // One empty state for both views, not a `.lrows-empty` twin: the second
        // copy is the one that goes stale. §9 wants somewhere to go either way,
        // and an empty support queue has two obvious next moves — widen the
        // filter, or go and look at the orders the tickets are usually about.
        <div className="glass-card empty-state">
          <Inbox aria-hidden="true" />
          <h3>Nothing in this view</h3>
          <p>
            {status || priority || query
              ? 'No ticket matches the current filters. Clear them to see the whole queue.'
              : 'The queue is empty. New tickets land here the moment a customer opens one.'}
          </p>
          <div className="empty-state-links">
            {(status || priority || query) && (
              <button
                className="glass-btn"
                onClick={() => { setStatus(''); setPriority(''); setSearchInput(''); setPage(1); }}
              >
                Clear filters
              </button>
            )}
            <Link className="glass-btn" to="/admin/orders">
              <ShoppingBag size={14} aria-hidden="true" /> Order queue
            </Link>
          </div>
        </div>
      ) : view === 'rows' ? (
        <TicketRows
          tickets={tickets}
          now={now}
          staff
          busyId={busyId}
          hrefFor={(t) => `/admin/support/${t.id}`}
          // Only passed when the account can actually use them: the row
          // reserves no action track at all without this, rather than drawing an
          // empty column beside a read-only manager's queue.
          renderActions={canManage ? rowActions : null}
        />
      ) : (
        <div className="asup-grid">
          {tickets.map((t, idx) => (
            <article
              key={t.id}
              className="glass-card asup-card"
              style={{ '--i': Math.min(idx, 9), '--asup-tone': statusTone(t.status) }}
            >
              <div className="asup-card-top">
                {/* A dispute has a refund window attached and an order sitting
                    in `disputed` the whole time it is open. Since the two
                    queues merged it has to be legible AS a dispute at a
                    glance, or the merge just hid it among the questions. */}
                {t.kind === 'dispute' && (
                  <span className="badge badge-danger asup-kind" title="This thread belongs to an order dispute">
                    <Scale size={11} aria-hidden="true" /> Dispute
                  </span>
                )}
                <PriorityPill priority={t.priority} />
                <span className={`badge ${statusBadge(t.status)}`}>{prettify(t.status)}</span>
                <AgeClock ticket={t} now={now} />
              </div>

              {/* Never answered by anyone, ever — not "waiting for a reply",
                  which the age clock already says. This is the state the open
                  count could never distinguish: twelve tickets nobody has
                  looked at reads identically to twelve answered within the
                  hour. See migration 20261009000000. */}
              {!t.first_staff_reply_at && (
                <span className="asup-unanswered" title="No staff member has replied to this yet">
                  <MessageCircleDashed size={12} aria-hidden="true" /> Not yet answered
                </span>
              )}

              <Link className="asup-subject" to={`/admin/support/${t.id}`}>{t.subject}</Link>

              <div className="asup-who">
                <User size={13} aria-hidden="true" />
                <strong>{t.username || 'Deleted account'}</strong>
                {t.customer?.tier_name && (
                  <span
                    className="asup-tier"
                    style={t.customer.tier_color ? { '--asup-tier': t.customer.tier_color } : undefined}
                  >
                    {t.customer.tier_name}
                  </span>
                )}
                <span className="asup-id">#{t.id}</span>
              </div>

              {/* Who has this. Unassigned is said out loud rather than left
                  blank: an empty space reads as "loading", and the whole point
                  of assignment is that an unowned thread is visible as one. */}
              <div className={`asup-owner${t.assigned_to ? '' : ' is-free'}`}>
                <UserCheck size={12} aria-hidden="true" />
                {t.assignee_username || 'Unassigned'}
              </div>

              {t.last_message && (
                <div className="asup-quote">
                  <span className="asup-quote-author">
                    {t.last_message.is_staff ? 'Staff' : 'Customer'} · {t.last_message.username || 'unknown'} ·{' '}
                    {new Date(t.last_message.created_at).toLocaleString()}
                  </span>
                  {t.last_message.preview}
                </div>
              )}

              <OrderStrip order={t.order} />
              <CustomerContext customer={t.customer} />

              <div className="asup-meta">
                <span><MessageSquare size={12} aria-hidden="true" /> {t.message_count}</span>
                {t.attachment_count > 0 && (
                  <span><Paperclip size={12} aria-hidden="true" /> {t.attachment_count}</span>
                )}
                {t.internal_note_count > 0 && (
                  <span className="is-note" title="Internal staff notes — never shown to the customer">
                    <StickyNote size={12} aria-hidden="true" /> {t.internal_note_count}
                  </span>
                )}
                <span title={new Date(t.created_at).toLocaleString()}>
                  <ShoppingBag size={12} aria-hidden="true" /> opened {new Date(t.created_at).toLocaleDateString()}
                </span>
              </div>

              {canManage && (
                <div className="asup-actions">
                  <select
                    className="glass-input asup-select"
                    aria-label={`Priority for ticket ${t.id}`}
                    value={t.priority || 'normal'}
                    onChange={e => updatePriority(t, e.target.value)}
                  >
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <span className="asup-spacer" />
                  {t.status !== 'resolved' && t.status !== 'closed' && (
                    <button
                      className="glass-btn glass-btn-sm glass-btn-success"
                      disabled={busyId === t.id}
                      onClick={() => updateStatus(t, 'resolved')}
                    >
                      <CheckCircle size={14} aria-hidden="true" /> Resolve
                    </button>
                  )}
                  {t.status !== 'closed' && (
                    <button
                      className="glass-btn glass-btn-sm"
                      disabled={busyId === t.id}
                      onClick={() => updateStatus(t, 'closed')}
                    >
                      <XCircle size={14} aria-hidden="true" /> Close
                    </button>
                  )}
                </div>
              )}
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
