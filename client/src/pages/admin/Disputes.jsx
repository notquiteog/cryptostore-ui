import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { adminCapabilities } from '../../utils/adminPermissions';
import {
  num, money, count as fmtCount, relTime, fullDate, shortDateTime,
  ageDays, humanize, stagger,
} from '../../utils/adminFormat';
import PageHeader from '../../components/admin/PageHeader';
import ReplyAssist from '../../components/admin/ai/ReplyAssist';
import AskAbout from '../../components/admin/AskAbout';
import StatTiles from '../../components/admin/StatTiles';
import Pager from '../../components/admin/Pager';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';
import toast from 'react-hot-toast';
import Avatar from '../../components/Avatar';
import ArmoredText from '../../components/pgp/ArmoredText';
import {
  AlertTriangle, MessageSquare, CheckCircle, XCircle, Eye, Search, ChevronDown,
  Clock, User, Package, FilterX, AlertCircle, RefreshCw, Send, Scale,
  Hourglass, Undo2, ShoppingBag, Inbox, LifeBuoy, Paperclip, UserCheck, ExternalLink,
} from 'lucide-react';
import { ParcelChip } from '../../components/order/ParcelStatus';
import TicketAttachment from '../../components/support/TicketAttachment';

/**
 * The dispute queue.
 *
 * Previously one unbounded column that fetched every dispute the store had ever
 * had and showed, per row, the reason and the status. What it could not tell
 * you was the thing a queue exists to tell you: which claims are waiting on
 * *us*. That now comes off the list query — who spoke last in each thread, how
 * long the claim has been open, and what state the order underneath it is in.
 *
 * DESIGN §6's question — responsive table, two purpose-built views, or a
 * toggle — is answered "toggle" here, at the `useViewMode` call below. Both
 * shapes render the same record and the same case file; see `DisputeCaseFile`.
 */

/**
 * The resolutions the form may submit — exactly `resolveDispute`'s
 * `validStatuses`, and nothing else.
 *
 * This once offered 'open' and 'rejected'. Both 400 with "Invalid status", and
 * 'rejected' is not in the `disputes.status` CHECK constraint either, so denying
 * a bogus claim always failed and threw away the typed response on retry. Deny a
 * claim by closing it with the reason written into the response.
 */
const RESOLUTIONS = [
  { key: 'in_review', label: 'Keep in review', hint: 'Replies to the customer without settling anything.' },
  { key: 'resolved', label: 'Resolve', hint: 'The claim was upheld and has been dealt with.' },
  { key: 'closed', label: 'Close', hint: 'The claim is finished — use this to deny one, with the reason in your response.' },
];

/**
 * What settling the dispute does to the order underneath it.
 *
 * `shipped` is the unwind: nothing was owed, so the order goes back to where it
 * was before the dispute opened and finishes normally.
 */
const ORDER_OUTCOMES = [
  { value: '', label: 'Automatic', hint: 'Refunds if an amount is set, otherwise releases the order.', tone: 'var(--primary)' },
  { value: 'shipped', label: 'Release the order (no money owed)', hint: 'Back to shipped; the buyer can still finalize.', tone: 'var(--info)' },
  { value: 'refunded', label: 'Refund the buyer', hint: 'Terminal. Returns store credit and coupon, scaled to the amount.', tone: 'var(--danger)' },
  { value: 'delivered', label: 'Close as delivered', hint: 'Asserts the goods arrived. Terminal — ends the dispute window.', tone: 'var(--success)' },
];

const STATUS_TONE = {
  open: 'var(--warning)',
  in_review: 'var(--info)',
  resolved: 'var(--success)',
  closed: 'var(--text-muted)',
};

const STATUS_ICON = {
  open: AlertTriangle,
  in_review: MessageSquare,
  resolved: CheckCircle,
  closed: XCircle,
};

const LIVE = ['open', 'in_review'];

/** The `assigned` query filter the server accepts, and what each pill says. */
const OWNER_FILTERS = [
  { key: '', label: 'Anyone' },
  { key: 'me', label: 'Mine' },
  { key: 'none', label: 'Unassigned' },
];

/** Shared closed-state object, so an untouched card gets a stable prop. */
const EMPTY_PANEL = { thread: false, resolve: false };

const FILTERS = [
  { key: '', label: 'All' },
  { key: LIVE.join(','), label: 'Still open' },
  { key: 'open', label: 'New' },
  { key: 'in_review', label: 'In review' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'closed', label: 'Closed' },
];

const SORTS = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first — work the queue' },
  { key: 'updated', label: 'Recently updated' },
  { key: 'waiting', label: 'Latest message' },
];

/**
 * How long a claim has been open, and how alarmed the queue should be about it.
 *
 * Only while it is still open. A dispute settled last month is still seven days
 * old, and both shapes were painting that age in `--danger` — alarm spent on a
 * record nobody has to do anything about, which is DESIGN §3's rule ("lit means
 * live, focused or dangerous") failed in the direction that costs the most: if
 * everything is red, the red claims stop standing out. `live` defaults true so
 * the "Oldest open" tile, which is only ever measuring open claims, reads the
 * same as it always did.
 */
function ageTone(days, live = true) {
  if (!live) return 'var(--text-muted)';
  if (days >= 7) return 'var(--danger)';
  if (days >= 3) return 'var(--warning)';
  return 'var(--text-muted)';
}

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
 * The shared `isRedacted` reads any null on a record marked `redacted` as
 * withheld. A dispute redacted only for customer identity still carries a
 * legitimately-empty `refund_amount`, and calling that "Hidden" reports a
 * permission problem where there is only an absent value. When
 * `redacted_fields` is present it is the whole truth.
 */
function withheld(record, field) {
  if (!record?.redacted) return false;
  if (Array.isArray(record.redacted_fields)) return record.redacted_fields.includes(field);
  return record[field] === null || record[field] === undefined;
}

/** The buyer, however much of them this viewer is allowed to know. */
function claimantName(d) {
  if (d.username) return d.username;
  if (d.customer_ref) return `customer ${d.customer_ref}`;
  if (d.user_id != null) return `User #${d.user_id}`;
  return 'Hidden';
}

export default function AdminDisputes() {
  const { user } = useAuth();
  const can = useMemo(() => adminCapabilities(user), [user]);

  const [disputes, setDisputes] = useState([]);
  const [meta, setMeta] = useState({ total: 0, totalPages: 1, limit: 20, counts: {} });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState(LIVE.join(','));
  const [sort, setSort] = useState('oldest');
  const [limit, setLimit] = useState(20);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  // Whose desk: '' for everyone's, 'me' for mine, 'none' for the pile nobody
  // has picked up. The assignee lives on the dispute's ticket; the server
  // filters on it and hands the name back on every row.
  const [assigned, setAssigned] = useState('');

  /**
   * Who a claim may be handed to. Loaded once, and only for an account that
   * may hand one on — the endpoint answers to `disputes.reply`, and a reader
   * who cannot reply sees the owner's name without a control. Failure is an
   * absent control, not an error: the queue works unassigned.
   */
  const [assignees, setAssignees] = useState([]);
  const canAssign = can.has('disputes.reply');
  useEffect(() => {
    if (!canAssign) return;
    api.get('/admin/disputes/assignees')
      .then((d) => setAssignees(d.assignees || []))
      .catch(() => setAssignees([]));
  }, [canAssign]);

  /**
   * Cards or line items — DESIGN §6's third answer, the toggle.
   *
   * This queue used to hardcode `.acard-grid is-list` at the skeleton *and* at
   * the rows, so it was one column at every width with no way back to a
   * scannable grid: forty claims meant forty screens of scrolling to find the
   * one somebody just asked about. Both shapes are real work here — a dispute
   * is read in full before it is settled, and a backlog is triaged by scanning
   * across several at once — so the operator picks, and `useViewMode` remembers
   * the choice instead of re-asking on every navigation.
   *
   * 'rows' is the default because reading is the commoner act: the line item
   * puts the claim, the money and whose move it is on one line, and the case
   * file opens underneath it in place.
   */
  const [view, setView] = useViewMode('admin-disputes', 'rows');

  // One slot per panel per dispute, not one slot per dispute. Sharing a single
  // slot meant opening the thread to check what the customer actually said
  // closed the settle form and threw away the response already typed into it.
  const [openPanel, setOpenPanel] = useState({}); // { [id]: { thread: bool, resolve: bool } }
  const [threads, setThreads] = useState({}); // { [id]: { messages, loading } }

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const seqRef = useRef(0);

  const fetchDisputes = useCallback(async ({ quiet = false } = {}) => {
    const seq = ++seqRef.current;
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
      if (status) params.set('status', status);
      if (query) params.set('search', query);
      if (assigned) params.set('assigned', assigned);

      const data = await api.get(`/admin/disputes?${params}`);
      if (seq !== seqRef.current) return;

      setDisputes(data.disputes || []);
      setMeta({
        total: Number(data.total || 0),
        totalPages: Math.max(1, Number(data.totalPages || 1)),
        limit: Number(data.limit || limit),
        counts: data.counts || {},
      });
      if (data.sort && data.sort !== sort) setSort(data.sort);
      setError(null);
    } catch (err) {
      if (seq !== seqRef.current) return;
      setError(err.message || 'Failed to load disputes');
      toast.error(err.message || 'Failed to load disputes');
    } finally {
      if (seq === seqRef.current) { setLoading(false); setRefreshing(false); }
    }
  }, [page, limit, sort, status, query, assigned]);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!loading && disputes.length === 0 && page > meta.totalPages) setPage(meta.totalPages);
  }, [loading, disputes.length, page, meta.totalPages]);

  const resetTo = (fn) => { fn(); setPage(1); };

  const clearFilters = () => resetTo(() => {
    setStatus(''); setSearchInput(''); setQuery(''); setAssigned('');
  });

  const isFiltered = status !== '' || query !== '' || assigned !== '';

  const counts = meta.counts;
  const sumOf = useCallback(
    (keys) => keys.reduce((total, key) => total + Number(counts[key] || 0), 0),
    [counts],
  );

  const live = sumOf(LIVE);
  // Threads whose last word was the customer's. Counted from the current page
  // rather than the whole table — the server does not aggregate it — so the
  // tile says which page it is describing.
  // `last_message_is_staff` is null when a dispute has no messages yet — which
  // is the *most* unanswered a claim can be, not the least. Testing for
  // `=== false` counted only threads the customer had followed up in, so a
  // brand-new claim nobody had touched showed as needing nothing.
  const needsReply = (d) => LIVE.includes(d.status) && d.last_message_is_staff !== true;
  const awaitingReply = disputes.filter(needsReply).length;
  const oldest = disputes.reduce(
    (worst, d) => (LIVE.includes(d.status) ? Math.max(worst, ageDays(d.created_at, now)) : worst),
    0,
  );

  const stats = [
    {
      key: 'live',
      label: 'Still open',
      value: fmtCount(live),
      icon: AlertTriangle,
      tone: 'var(--warning)',
      urgent: live > 0,
      active: status === LIVE.join(','),
      onClick: () => resetTo(() => setStatus(status === LIVE.join(',') ? '' : LIVE.join(','))),
    },
    {
      key: 'waiting',
      label: 'Awaiting reply',
      value: fmtCount(awaitingReply),
      icon: Hourglass,
      tone: 'var(--danger)',
      urgent: awaitingReply > 0,
      hint: 'on this page',
      title: 'Threads where the customer spoke last',
    },
    {
      key: 'oldest',
      label: 'Oldest open',
      value: oldest > 0 ? `${oldest}d` : '—',
      icon: Clock,
      tone: ageTone(oldest),
      hint: 'on this page',
    },
    {
      key: 'resolved',
      label: 'Resolved',
      value: fmtCount(counts.resolved || 0),
      icon: CheckCircle,
      tone: 'var(--success)',
      active: status === 'resolved',
      onClick: () => resetTo(() => setStatus(status === 'resolved' ? '' : 'resolved')),
    },
    {
      key: 'closed',
      label: 'Closed',
      value: fmtCount(counts.closed || 0),
      icon: XCircle,
      tone: 'var(--text-muted)',
      active: status === 'closed',
      onClick: () => resetTo(() => setStatus(status === 'closed' ? '' : 'closed')),
    },
  ];

  const togglePanel = (id, panel) => setOpenPanel((prev) => ({
    ...prev,
    [id]: { ...prev[id], [panel]: !prev[id]?.[panel] },
  }));

  const closePanel = (id, panel) => setOpenPanel((prev) => ({
    ...prev,
    [id]: { ...prev[id], [panel]: false },
  }));

  /**
   * Load a thread the first time its panel opens.
   *
   * Dispute threads have no dedicated rate limiter — only the app-wide
   * per-IP cap — so this is strictly on demand and never polled.
   */
  const loadThread = useCallback(async (id) => {
    setThreads((prev) => ({ ...prev, [id]: { messages: prev[id]?.messages || [], loading: true } }));
    try {
      const data = await api.get(`/moderation/disputes/${id}/messages`);
      // The response also carries the raw, unredacted dispute row. Only the
      // messages are taken: rendering the card from it would hand a viewer the
      // customer identity and order money that the list deliberately withheld.
      setThreads((prev) => ({ ...prev, [id]: { messages: data.messages || [], loading: false } }));
    } catch (err) {
      toast.error(err.message || 'Could not load the thread');
      // Drop the entry rather than caching an empty thread. `openThread` skips
      // the fetch whenever an entry exists, so a single failed request — a
      // dropped connection, a 429 — would otherwise leave that dispute
      // permanently showing "No messages yet" with no way to retry short of a
      // page reload.
      setThreads((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, []);

  const openThread = (id) => {
    const opening = !openPanel[id]?.thread;
    togglePanel(id, 'thread');
    if (opening && !threads[id]) loadThread(id);
  };

  const sendMessage = async (id, body) => {
    if (!body.trim()) { toast.error('Write a message first'); return false; }
    try {
      await api.post(`/moderation/disputes/${id}/messages`, { body: body.trim() });
      toast.success('Reply sent to the customer');
      await loadThread(id);
      // A staff reply moves the dispute out of the unanswered queue server-side,
      // so the row's status and "awaiting reply" marker are both now stale.
      fetchDisputes({ quiet: true });
      return true;
    } catch (err) {
      toast.error(err.message || 'Could not send the message');
      return false;
    }
  };

  const resolveDispute = async (dispute, form) => {
    if (!form.response.trim()) { toast.error('A response is required'); return false; }

    const body = { status: form.status, admin_response: form.response.trim() };
    // Naming an order outcome alongside `in_review` would ask the server to
    // close an order whose dispute is still live.
    if (form.status !== 'in_review' && form.outcome) body.order_status = form.outcome;
    if (form.status !== 'in_review' && form.refund !== '') {
      const amount = parseFloat(form.refund);
      if (!Number.isFinite(amount) || amount < 0) { toast.error('Refund amount must be a positive number'); return false; }
      body.refund_amount = amount;
    }

    try {
      await api.put(`/admin/disputes/${dispute.id}`, body);
      toast.success(`Dispute #${dispute.id} → ${humanize(form.status)}`);
      closePanel(dispute.id, 'resolve');
      fetchDisputes({ quiet: true });
      return true;
    } catch (err) {
      toast.error(err.message || 'Could not update the dispute');
      // The server commits the dispute half and rejects only the order half
      // when a transition is refused, answering 400 with `dispute_updated`.
      // Toasting alone left the page showing a status the database no longer
      // had, so refetch whenever the write partially landed.
      if (err.data?.dispute_updated) {
        closePanel(dispute.id, 'resolve');
        fetchDisputes({ quiet: true });
      }
      return false;
    }
  };

  /**
   * Hand a claim to somebody. Optimistic, because the select has to show
   * the name it was just set to; reverted on refusal, because a select that
   * shows an owner the server declined is a claim nobody is working.
   */
  const assignDispute = async (dispute, next) => {
    const previous = { assigned_to: dispute.assigned_to ?? null, assignee_username: dispute.assignee_username || null };
    const name = next === null ? null : (assignees.find((a) => a.id === next)?.username || null);
    const patch = (changes) => setDisputes((prev) => prev.map((d) => (d.id === dispute.id ? { ...d, ...changes } : d)));
    patch({ assigned_to: next, assignee_username: name });
    try {
      await api.put(`/admin/disputes/${dispute.id}/assignee`, { assigned_to: next });
      toast.success(next === null ? `Dispute #${dispute.id} unassigned` : `Dispute #${dispute.id} → ${name}`);
      // A filter on ownership can no longer be trusted to hold this row.
      if (assigned) fetchDisputes({ quiet: true });
    } catch (err) {
      patch(previous);
      toast.error(err.message || 'Could not assign the dispute');
    }
  };

  const subtitle = loading
    ? 'Loading the queue…'
    : error
      ? 'The dispute queue could not be loaded.'
      : meta.total === 0
        ? (isFiltered ? 'Nothing matches these filters.' : 'Nothing has been escalated.')
        : live > 0
          ? `${fmtCount(live)} still open${awaitingReply > 0 ? ` · ${awaitingReply} waiting on a reply` : ''}`
          : `${fmtCount(meta.total)} dispute${meta.total === 1 ? '' : 's'}, none open`;

  return (
    <div className="admin-page">
      <PageHeader icon={Scale} title="Disputes" subtitle={subtitle}>
        <AskAbout
          question="How many disputes are open, which one has been waiting longest, and is anything overdue a reply?"
          label="Ask"
          title="Ask the assistant about the dispute queue"
        />
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => fetchDisputes({ quiet: true })}
          disabled={refreshing}
        >
          {refreshing ? <span className="spinner spinner-inline" /> : <RefreshCw size={14} aria-hidden="true" />}
          Refresh
        </button>
      </PageHeader>

      <StatTiles stats={stats} />

      <div className="admin-toolbar is-sticky">
        <div className="status-filter-row" role="group" aria-label="Filter disputes by status">
          {FILTERS.map((f) => {
            const n = f.key === ''
              ? sumOf(['open', 'in_review', 'resolved', 'closed'])
              : sumOf(f.key.split(','));
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

        {/* Whose desk. Beside the status pills rather than in the sort
            dropdown because "mine" is a filter, not an order, and the queue
            a person works from is the one with their name on it. */}
        <div className="status-filter-row" role="group" aria-label="Filter disputes by owner">
          {OWNER_FILTERS.map((f) => (
            <button
              key={f.key || 'anyone'}
              type="button"
              className={`status-filter-pill${assigned === f.key ? ' active' : ''}`}
              onClick={() => resetTo(() => setAssigned(f.key))}
              aria-pressed={assigned === f.key}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="admin-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="glass-input"
            type="search"
            placeholder={can.seeCustomer ? 'Reason, order id, customer…' : 'Reason or order id…'}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label="Search disputes"
          />
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-toolbar-group">
          <label className="admin-toolbar-label" htmlFor="disputes-sort">Sort</label>
          <select
            id="disputes-sort"
            className="glass-input"
            value={sort}
            onChange={(e) => resetTo(() => setSort(e.target.value))}
            aria-label="Sort disputes"
          >
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>

        <span className="admin-toolbar-spacer" />

        <div className="admin-toolbar-group">
          <ViewToggle value={view} onChange={setView} label="Dispute layout" />
        </div>
      </div>

      {isFiltered && !loading && (
        <div className="admin-filter-note">
          <span>{fmtCount(meta.total)} dispute{meta.total === 1 ? '' : 's'} match the current filters.</span>
          <button type="button" className="glass-btn glass-btn-sm" onClick={clearFilters}>
            <FilterX size={13} aria-hidden="true" /> Clear
          </button>
        </div>
      )}

      {/* The skeleton is drawn in whichever shape is about to arrive. Loading a
          card grid and then swapping it for a row list is a page that jumps
          under the operator on every filter change. */}
      {loading ? (
        view === 'rows' ? (
          <div className="lrows adsp-rows" aria-busy="true" aria-label="Loading disputes">
            {Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton lrow-skel" />)}
          </div>
        ) : (
          <div className="acard-grid" aria-busy="true" aria-label="Loading disputes">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="skeleton acard-skel" style={{ '--i': i }} />
            ))}
          </div>
        )
      ) : error ? (
        <div className="glass-card empty-state is-error">
          <AlertCircle size={34} aria-hidden="true" />
          <h3>The dispute queue could not be loaded</h3>
          <p>{error}</p>
          <button type="button" className="glass-btn" onClick={() => fetchDisputes()}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        </div>
      ) : disputes.length === 0 ? (
        /* DESIGN §9: an empty dispute queue is the *good* state, and it was
           still a dead end — a page that said "no disputes" and offered
           nowhere to go. The two places somebody standing here actually goes
           next are the order queue (a claim is always about an order, and a
           disputed order shows there even before anyone escalates) and the
           support inbox, where the complaints that never became disputes are.
           Both are gated on the permission that opens them, so nothing offers
           a link that lands on a 403. */
        <div className="glass-card empty-state">
          {isFiltered ? <FilterX size={34} aria-hidden="true" /> : <Inbox size={34} aria-hidden="true" />}
          <h3>{isFiltered ? 'Nothing matches those filters' : 'No disputes'}</h3>
          <p>
            {isFiltered
              ? 'Try a different status or search term.'
              : 'Nothing has been escalated. Disputes raised against an order will land here.'}
          </p>
          <div className="empty-state-links">
            {isFiltered && (
              <button type="button" className="glass-btn" onClick={clearFilters}>
                <FilterX size={14} aria-hidden="true" /> Clear filters
              </button>
            )}
            {can.has('orders.view') && (
              <Link to="/admin/orders?status=disputed" className="glass-btn">
                <ShoppingBag size={14} aria-hidden="true" /> Disputed orders
              </Link>
            )}
            {can.has('support.view') && (
              <Link to="/admin/support" className="glass-btn">
                <LifeBuoy size={14} aria-hidden="true" /> Support inbox
              </Link>
            )}
          </div>
        </div>
      ) : (
        <>
          {view === 'rows' ? (
            /* The head names the columns the mono numerals align under; the
               `.lrows` container query below 560px hides it and re-flows each
               line into a small card, so nothing here is a column that
               disappears on a phone.

               The action track is a fixed 168px and not `auto`, which is what
               it was: `.lrows-head` and `.lrow` are two separate grids, and an
               `auto` track resolves against each one's own content — so the
               head's visually-hidden "Actions" label sized it to 0px while the
               rows sized it to the buttons, and every heading sat a hundred
               pixels left of the column it named. Every other track here is
               `minmax(0, fixed)` or `fr`, which both resolve identically in
               the two grids. 168px is the widest the strip gets: Settle,
               Thread and Order together measure 165. */
            <div
              className="lrows adsp-rows"
              style={{
                '--lrow-cols':
                  'minmax(0, 124px) minmax(0, 1fr) minmax(0, 2fr) 92px 92px'
                  + ' minmax(0, 116px) minmax(0, 104px) minmax(0, 140px) 168px',
              }}
            >
              <div className="lrows-head">
                <span>Dispute</span>
                <span>Buyer</span>
                <span className="adsp-h-reason">The claim</span>
                <span className="adsp-h-num">Order</span>
                <span className="adsp-h-num">Refunded</span>
                <span>Opened</span>
                <span>Thread</span>
                <span>State</span>
                <span><span className="sr-only">Actions</span></span>
              </div>
              {disputes.map((d) => (
                <DisputeRow
                  key={d.id}
                  dispute={d}
                  now={now}
                  can={can}
                  panel={openPanel[d.id] || EMPTY_PANEL}
                  thread={threads[d.id]}
                  onOpenThread={() => openThread(d.id)}
                  onOpenResolve={() => togglePanel(d.id, 'resolve')}
                  onSend={(body) => sendMessage(d.id, body)}
                  onResolve={(form) => resolveDispute(d, form)}
                  assignees={canAssign ? assignees : null}
                  onAssign={(next) => assignDispute(d, next)}
                />
              ))}
            </div>
          ) : (
            <div className="acard-grid">
              {disputes.map((d, i) => (
                <DisputeCard
                  key={d.id}
                  dispute={d}
                  index={i}
                  now={now}
                  can={can}
                  panel={openPanel[d.id] || EMPTY_PANEL}
                  thread={threads[d.id]}
                  onOpenThread={() => openThread(d.id)}
                  onOpenResolve={() => togglePanel(d.id, 'resolve')}
                  onSend={(body) => sendMessage(d.id, body)}
                  onResolve={(form) => resolveDispute(d, form)}
                  assignees={canAssign ? assignees : null}
                  onAssign={(next) => assignDispute(d, next)}
                />
              ))}
            </div>
          )}

          <Pager
            page={page}
            totalPages={meta.totalPages}
            total={meta.total}
            noun="dispute"
            label="Dispute pages"
            onChange={setPage}
          >
            <label className="admin-toolbar-label" htmlFor="disputes-per-page">Per page</label>
            <select
              id="disputes-per-page"
              className="glass-input"
              value={limit}
              onChange={(e) => resetTo(() => setLimit(Number(e.target.value)))}
              aria-label="Disputes per page"
            >
              {[10, 20, 40].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Pager>
        </>
      )}
    </div>
  );
}

/* ── Card ──────────────────────────────────────────────────────── */

function DisputeCard({
  dispute: d, index, now, can, panel, thread, onOpenThread, onOpenResolve, onSend, onResolve, assignees, onAssign,
}) {
  const tone = STATUS_TONE[d.status] || 'var(--text-muted)';
  const StatusIcon = STATUS_ICON[d.status] || AlertTriangle;
  const isLive = LIVE.includes(d.status);
  const days = ageDays(d.created_at, now);
  const orderRefText = d.order_uuid ? d.order_uuid.split('-')[0].toUpperCase() : `#${d.order_id}`;
  const awaitingReply = d.last_message_is_staff !== true;

  const anyPanelOpen = panel.thread || panel.resolve;

  return (
    <article
      className={`glass-card acard${isLive ? ' is-urgent' : ''}`}
      style={{ '--acard-tone': tone, '--i': stagger(index) }}
      data-status={d.status}
    >
      <span className="acard-rail" aria-hidden="true" />

      <header className="acard-head">
        <div className="acard-head-main">
          <div style={{ minWidth: 0 }}>
            <span className="acard-title">
              Dispute #{d.id} on order{' '}
              <Link to={`/orders/${d.order_uuid || d.order_id}`}>{orderRefText}</Link>
            </span>
            <div className="acard-sub">
              <User size={11} aria-hidden="true" />
              {claimantName(d)}
              <span aria-hidden="true">·</span>
              <span className="adsp-age" style={{ '--adsp-age-tone': ageTone(days, isLive) }}>
                <Clock size={11} aria-hidden="true" />
                <span title={fullDate(d.created_at)}>
                  {/* "open 0d" is not a duration anybody says out loud. A claim
                      raised this morning reads as its age instead. */}
                  {isLive ? (days > 0 ? `open ${days}d` : `opened ${relTime(d.created_at, now)}`) : relTime(d.created_at, now)}
                </span>
              </span>
            </div>
          </div>
        </div>
        <div className="acard-chips" style={{ justifyContent: 'flex-end' }}>
          {awaitingReply && isLive && (
            <span className="adsp-waiting">
              <Hourglass size={10} aria-hidden="true" /> Needs a reply
            </span>
          )}
          <span className="acard-chip" style={{ '--acard-chip-tone': tone }}>
            <StatusIcon size={10} aria-hidden="true" />
            {humanize(d.status)}
          </span>
        </div>
      </header>

      <div className="acard-body">
        <p className="acard-quote">
          <strong>Customer&rsquo;s claim</strong>
          {d.reason}
        </p>

        {d.admin_response && (
          <p className="acard-quote" style={{ borderLeftColor: 'var(--primary)' }}>
            <strong>Staff response</strong>
            {d.admin_response}
          </p>
        )}

        <div className="acard-fields">
          <div className="acard-field">
            <span className="acard-field-label">Order total</span>
            <span className="acard-field-value is-strong">
              {withheld(d, 'total') ? <Hidden what="order totals" /> : money(d.total)}
            </span>
          </div>
          <div className="acard-field">
            <span className="acard-field-label">Refunded</span>
            <span className="acard-field-value is-strong">
              {withheld(d, 'refund_amount')
                ? <Hidden what="refund amounts" />
                : d.refund_amount == null ? '—' : money(d.refund_amount)}
            </span>
          </div>
          <div className="acard-field">
            <span className="acard-field-label">Order state</span>
            <span className="acard-field-value">
              <Package size={12} aria-hidden="true" />
              {humanize(d.order_status || 'unknown')}
              <ParcelChip parcels={d.parcels} compact />
            </span>
          </div>
          <div className="acard-field">
            <span className="acard-field-label">Items</span>
            <span className="acard-field-value">
              <ShoppingBag size={12} aria-hidden="true" />
              {num(d.item_count)}
            </span>
          </div>
          <div className="acard-field">
            <span className="acard-field-label">Messages</span>
            <span className="acard-field-value">
              <MessageSquare size={12} aria-hidden="true" />
              {num(d.message_count)}
              {d.attachment_count > 0 && (
                <span className="acard-foot-note" title={`${num(d.attachment_count)} file${num(d.attachment_count) === 1 ? '' : 's'} attached`}>
                  · <Paperclip size={11} aria-hidden="true" /> {num(d.attachment_count)}
                </span>
              )}
              {d.last_message_at && (
                <span className="acard-foot-note" title={fullDate(d.last_message_at)}>
                  · {relTime(d.last_message_at, now)}
                </span>
              )}
            </span>
          </div>
          <div className="acard-field">
            <span className="acard-field-label">Held by</span>
            <span className="acard-field-value">
              <DisputeOwner dispute={d} assignees={assignees} onAssign={onAssign} />
            </span>
          </div>
          <div className="acard-field">
            <span className="acard-field-label">Last updated</span>
            <span className="acard-field-value" title={fullDate(d.updated_at)}>
              <Clock size={12} aria-hidden="true" />
              {shortDateTime(d.updated_at || d.created_at)}
            </span>
          </div>
        </div>
      </div>

      <footer className="acard-foot">
        <div className="acard-actions">
          {isLive && can.has('disputes.resolve') && (
            <button
              type="button"
              className="glass-btn glass-btn-sm glass-btn-primary acard-disclose"
              onClick={onOpenResolve}
              aria-expanded={panel.resolve}
              aria-label={`Settle dispute ${d.id}`}
            >
              <Scale size={13} aria-hidden="true" /> Settle <ChevronDown size={13} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="glass-btn glass-btn-sm acard-disclose"
            onClick={onOpenThread}
            aria-expanded={panel.thread}
            aria-label={`Thread for dispute ${d.id}`}
          >
            <MessageSquare size={13} aria-hidden="true" />
            Thread{num(d.message_count) > 0 ? ` (${num(d.message_count)})` : ''}
            <ChevronDown size={13} aria-hidden="true" />
          </button>
        </div>
        <Link
          to={`/orders/${d.order_uuid || d.order_id}`}
          className="glass-btn glass-btn-sm"
          aria-label={`Open order ${orderRefText}`}
        >
          <Eye size={13} aria-hidden="true" /> Order
        </Link>
      </footer>

      <div className={`acard-drawer${anyPanelOpen ? ' is-open' : ''}`}>
        <div className="acard-drawer-clip">
          <div className="acard-drawer-inner" inert={anyPanelOpen ? undefined : true}>
            <DisputeCaseFile
              dispute={d}
              now={now}
              can={can}
              panel={panel}
              thread={thread}
              onOpenResolve={onOpenResolve}
              onSend={onSend}
              onResolve={onResolve}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

/* ── Line item ─────────────────────────────────────────────────── */

/**
 * One dispute as a line, with its case file folded underneath it.
 *
 * Every field the card prints is here — nothing is dropped to make the line
 * fit, which DESIGN §5 rules out explicitly because a hidden column is data
 * the operator came for silently deleted. The two long ones, the claim and the
 * staff response, are truncated to a line each with the full text one row-open
 * away rather than one hover away: a hover `title` is nothing at all on a
 * touch screen.
 *
 * The panel is a sibling of the row, not a child of it. A `.lrow` is a CSS
 * grid of column tracks, so anything nested inside it becomes a cell and
 * inherits the columns; the case file has to sit outside those tracks to be
 * able to span the list. It also renders permanently rather than on open, so
 * the `0fr -> 1fr` drawer has something to animate and so `.lrow` keeps a
 * stable child index — see the note on `.adsp-rows` in 59-admin-disputes.css.
 */
function DisputeRow({
  dispute: d, now, can, panel, thread, onOpenThread, onOpenResolve, onSend, onResolve, assignees, onAssign,
}) {
  const tone = STATUS_TONE[d.status] || 'var(--text-muted)';
  const StatusIcon = STATUS_ICON[d.status] || AlertTriangle;
  const isLive = LIVE.includes(d.status);
  const days = ageDays(d.created_at, now);
  const orderRefText = d.order_uuid ? d.order_uuid.split('-')[0].toUpperCase() : `#${d.order_id}`;
  const awaitingReply = d.last_message_is_staff !== true;
  const anyPanelOpen = panel.thread || panel.resolve;
  const items = num(d.item_count);

  /**
   * Whose move it is. The row's other line, under the status chip, is who
   * holds it — the ticket's assignee, which this cell was reserved for while
   * the schema had no owner to name.
   */
  const holder = !isLive
    ? 'settled'
    : awaitingReply ? 'waiting on us' : 'waiting on them';

  return (
    <Fragment>
      <div
        /* `is-urgent` marks only the claims nobody has answered, not every
           open one. Marking all of them lit the whole list under the default
           "still open" filter, which is the same as marking none — and the
           shared rule declares its background after the hover rule, so an
           urgent row also gives up its hover feedback. Spending that on the
           subset that needs somebody keeps it meaning something. */
        className={`lrow${isLive && awaitingReply ? ' is-urgent' : ''}${anyPanelOpen ? ' is-open' : ''}`}
        style={{ '--lrow-tone': tone }}
        data-status={d.status}
      >
        <div className="lrow-stack adsp-row-claim">
          <span className="lrow-id">#{d.id}</span>
          <small>
            <Link to={`/orders/${d.order_uuid || d.order_id}`} title={`Open order ${orderRefText}`}>
              {orderRefText}
            </Link>
          </small>
        </div>

        <div className="lrow-stack adsp-row-buyer">
          <span className="lrow-text">{claimantName(d)}</span>
          <small>
            {items} item{items === 1 ? '' : 's'} · {humanize(d.order_status || 'unknown')}
          </small>
          {/* Its own line, not inside the <small>: that element clips to one
              line with an ellipsis, which swallowed the chip whole. */}
          <ParcelChip parcels={d.parcels} compact />
        </div>

        <div className="lrow-stack adsp-row-reason">
          <span className="lrow-text" title={d.reason}>{d.reason}</span>
          {d.admin_response && (
            <small title={d.admin_response}>Staff: {d.admin_response}</small>
          )}
        </div>

        {/* `data-label` is read back by the phone shape in
            59-admin-disputes.css: with the column headings gone, two bare
            figures side by side are two numbers nobody can name. */}
        <span className="lrow-num adsp-row-total" data-label="Order">
          {withheld(d, 'total') ? <Hidden what="order totals" /> : money(d.total)}
        </span>

        <span className="lrow-num adsp-row-refund" data-label="Refunded">
          {withheld(d, 'refund_amount')
            ? <Hidden what="refund amounts" />
            : d.refund_amount == null
              ? <span className="adsp-row-nil" title="Nothing refunded">—</span>
              : money(d.refund_amount)}
        </span>

        <div className="lrow-stack adsp-row-opened">
          <span
            className="adsp-age"
            style={{ '--adsp-age-tone': ageTone(days, isLive) }}
            title={fullDate(d.created_at)}
          >
            <Clock size={11} aria-hidden="true" />
            {/* Same wording as the card: "open 0d" is not a duration anybody
                says out loud, so a claim raised this morning reads as its age. */}
            {isLive
              ? (days > 0 ? `open ${days}d` : `opened ${relTime(d.created_at, now)}`)
              : relTime(d.created_at, now)}
          </span>
          <small title={fullDate(d.updated_at || d.created_at)}>
            moved {relTime(d.updated_at || d.created_at, now)}
          </small>
        </div>

        <div className="lrow-stack adsp-row-thread">
          <span className="lrow-num adsp-row-msgs">
            <MessageSquare size={11} aria-hidden="true" />
            {num(d.message_count)}
            {d.attachment_count > 0 && (
              <span title={`${num(d.attachment_count)} file${num(d.attachment_count) === 1 ? '' : 's'} attached`}>
                <Paperclip size={11} aria-hidden="true" />
                {num(d.attachment_count)}
              </span>
            )}
          </span>
          <small title={d.last_message_at ? fullDate(d.last_message_at) : undefined}>
            {d.last_message_at ? relTime(d.last_message_at, now) : 'no messages'}
          </small>
        </div>

        <div className="lrow-stack adsp-row-state">
          <span className="acard-chip" style={{ '--acard-chip-tone': tone }}>
            <StatusIcon size={10} aria-hidden="true" />
            {humanize(d.status)}
          </span>
          <small className={isLive && awaitingReply ? 'adsp-row-owed' : undefined}>
            {holder}
          </small>
          {/* Its own line, like the parcel chip: `<small>` clips to one line. */}
          <DisputeOwner dispute={d} assignees={assignees} onAssign={onAssign} compact />
        </div>

        <div className="lrow-actions">
          {isLive && can.has('disputes.resolve') && (
            <button
              type="button"
              className="glass-btn glass-btn-sm glass-btn-primary acard-disclose"
              onClick={onOpenResolve}
              aria-expanded={panel.resolve}
              aria-label={`Settle dispute ${d.id}`}
              title="Settle this dispute"
            >
              <Scale size={13} aria-hidden="true" />
              <ChevronDown size={13} aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="glass-btn glass-btn-sm acard-disclose"
            onClick={onOpenThread}
            aria-expanded={panel.thread}
            aria-label={`Thread for dispute ${d.id}`}
            title={`Message thread${num(d.message_count) > 0 ? ` — ${num(d.message_count)} message${num(d.message_count) === 1 ? '' : 's'}` : ''}`}
          >
            <MessageSquare size={13} aria-hidden="true" />
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          <Link
            to={`/orders/${d.order_uuid || d.order_id}`}
            className="glass-btn glass-btn-sm"
            aria-label={`Open order ${orderRefText}`}
            title="Open the full order"
          >
            <Eye size={13} aria-hidden="true" />
          </Link>
        </div>
      </div>

      {/* `--acard-tone` so the quoted claim inside carries the dispute's status
          colour on its rail, exactly as it does on the card — the drawer is
          outside the article that would normally supply it. */}
      <div
        className={`acard-drawer adsp-case${anyPanelOpen ? ' is-open' : ''}`}
        style={{ '--acard-tone': tone }}
      >
        <div className="acard-drawer-clip">
          <div className="acard-drawer-inner" inert={anyPanelOpen ? undefined : true}>
            <DisputeCaseFile
              dispute={d}
              now={now}
              can={can}
              panel={panel}
              thread={thread}
              onOpenResolve={onOpenResolve}
              onSend={onSend}
              onResolve={onResolve}
              /* The row shows one truncated line of the claim; the card prints
                 it whole on its face. Restating it here would be a duplicate
                 paragraph in the card view and the only copy in the row view,
                 so the case file draws it for the shape that needs it. */
              showClaim
            />
          </div>
        </div>
      </div>
    </Fragment>
  );
}

/* ── Owner ─────────────────────────────────────────────────────── */

/**
 * Who holds a claim, and the control to change it.
 *
 * A select when the viewer may hand claims on (`assignees` is a list), the
 * name alone when they may not (`assignees` is null). "Unassigned" is said
 * out loud in both shapes rather than left blank — an empty cell reads as
 * "loading", and the point of ownership is that unowned work is visible as
 * such. The same rule the support desk's owner cell applies.
 */
function DisputeOwner({ dispute: d, assignees, onAssign, compact = false }) {
  const owned = d.assigned_to != null;
  if (!Array.isArray(assignees)) {
    return (
      <span className={`adsp-owner${owned ? '' : ' is-free'}`}>
        <UserCheck size={11} aria-hidden="true" />
        {d.assignee_username || 'Unassigned'}
      </span>
    );
  }
  // An owner who is no longer eligible — demoted, deactivated — is still
  // shown as holding it, or the select would silently display the first
  // option as if it were the truth.
  const stale = owned && !assignees.some((a) => a.id === d.assigned_to);
  return (
    <span className={`adsp-owner${owned ? '' : ' is-free'}`}>
      <UserCheck size={11} aria-hidden="true" />
      <select
        className={`glass-input adsp-owner-select${compact ? ' is-compact' : ''}`}
        value={d.assigned_to ?? ''}
        onChange={(e) => onAssign(e.target.value === '' ? null : Number(e.target.value))}
        aria-label={`Who holds dispute ${d.id}`}
        title={d.assignee_username ? `Held by ${d.assignee_username}` : 'Unassigned'}
      >
        <option value="">Unassigned</option>
        {stale && <option value={d.assigned_to}>{d.assignee_username || `#${d.assigned_to}`}</option>}
        {assignees.map((a) => <option key={a.id} value={a.id}>{a.username}</option>)}
      </select>
    </span>
  );
}

/* ── Case file ─────────────────────────────────────────────────── */

/**
 * The settle form and the message thread — one copy, used by both shapes.
 *
 * These panels were written inside `DisputeCard`, which was fine while the
 * queue had one shape and is exactly the divergence CLAUDE.md keeps warning
 * about the moment it has two: a fix to the outcome warning or the reply box
 * would land on whichever view the person happened to be looking at. Both the
 * card and the line item mount this, so a single-shape change is awkward to
 * express here rather than easy.
 *
 * The draft and the form live here rather than in the page so they are per
 * dispute; the page owns which panels are open, because that has to survive
 * switching views.
 */
function DisputeCaseFile({
  dispute: d, now, can, panel, thread, showClaim = false, onOpenResolve, onSend, onResolve,
}) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const [form, setForm] = useState({ response: '', status: 'resolved', outcome: '', refund: '' });
  const [submitting, setSubmitting] = useState(false);

  // Reset the resolve form each time the panel opens, so a half-typed response
  // from a previous session is never silently submitted against a dispute whose
  // state has moved on underneath it.
  useEffect(() => {
    if (panel.resolve) setForm({ response: '', status: 'resolved', outcome: '', refund: '' });
  }, [panel.resolve]);

  const chosenOutcome = ORDER_OUTCOMES.find((o) => o.value === form.outcome) || ORDER_OUTCOMES[0];
  const refundValue = form.refund === '' ? 0 : parseFloat(form.refund);
  const refundIsPositive = Number.isFinite(refundValue) && refundValue > 0;

  /**
   * What the server will actually do, said out loud before it is committed.
   *
   * `deriveOrderTransition` honours an explicit `delivered` or `refunded`, but
   * `shipped` falls through to the money check — so "release the order" with a
   * refund amount typed above it silently refunds instead. That contradiction
   * is stated here rather than discovered afterwards.
   */
  const outcomeWarning = form.outcome === 'shipped' && refundIsPositive;

  const outcomeNote = outcomeWarning
    ? 'A refund amount is set, so the order will be refunded — releasing it is ignored while money is owed. Clear the amount to release instead.'
    : form.outcome
      ? chosenOutcome.hint
      : refundIsPositive
        ? 'A refund amount is set, so the order will be refunded.'
        : 'No refund set, so the order returns to shipped and finishes normally.';

  return (
    <>
      {showClaim && (
        <div className="adsp-case-claim">
          <p className="acard-quote">
            <strong>Customer&rsquo;s claim</strong>
            {d.reason}
          </p>
          {d.admin_response && (
            <p className="acard-quote adsp-case-response">
              <strong>Staff response</strong>
              {d.admin_response}
            </p>
          )}
        </div>
      )}

      {panel.resolve && (
        <div className="adsp-resolve">
          <p className="acard-drawer-title">Settle this dispute</p>

          <div className="form-group">
            <label htmlFor={`response-${d.id}`}>Response to the customer</label>
            <textarea
              id={`response-${d.id}`}
              className="glass-input"
              rows={3}
              value={form.response}
              onChange={(e) => setForm({ ...form, response: e.target.value })}
              placeholder="What you decided, and why."
            />
            <p className="adsp-hint">
              This replaces any previous response on the dispute and the customer sees it.
            </p>
          </div>

          <div className="adsp-resolve-grid">
            <div className="form-group">
              <label htmlFor={`resolution-${d.id}`}>Resolution</label>
              <select
                id={`resolution-${d.id}`}
                className="glass-input"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                {RESOLUTIONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
              <p className="adsp-hint">
                {RESOLUTIONS.find((r) => r.key === form.status)?.hint}
              </p>
            </div>

            {form.status !== 'in_review' && (
              <div className="form-group">
                <label htmlFor={`refund-${d.id}`}>Refund amount</label>
                <input
                  id={`refund-${d.id}`}
                  className="glass-input"
                  type="number"
                  min="0"
                  step="0.01"
                  max={withheld(d, 'total') ? undefined : num(d.total)}
                  value={form.refund}
                  onChange={(e) => setForm({ ...form, refund: e.target.value })}
                  placeholder={withheld(d, 'total') ? '0.00' : `0.00 – ${num(d.total).toFixed(2)}`}
                />
                <p className="adsp-hint">
                  Leave blank for no refund. Once set, an amount cannot be cleared back to none.
                </p>
              </div>
            )}
          </div>

          {form.status !== 'in_review' && (
            <div className="form-group">
              <label htmlFor={`outcome-${d.id}`}>What happens to the order</label>
              <select
                id={`outcome-${d.id}`}
                className="glass-input"
                value={form.outcome}
                onChange={(e) => setForm({ ...form, outcome: e.target.value })}
              >
                {ORDER_OUTCOMES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <div
                className="adsp-outcome"
                style={{ '--adsp-outcome-tone': outcomeWarning ? 'var(--warning)' : chosenOutcome.tone }}
              >
                <strong>{outcomeWarning ? 'Heads up: ' : 'Result: '}</strong>
                {outcomeNote}
              </div>
            </div>
          )}

          <div className="admin-form-actions">
            <button
              type="button"
              className="glass-btn glass-btn-primary glass-btn-sm"
              disabled={submitting || !form.response.trim()}
              onClick={() => {
                setSubmitting(true);
                onResolve(form).finally(() => setSubmitting(false));
              }}
            >
              {submitting ? <span className="spinner spinner-inline" /> : <CheckCircle size={13} aria-hidden="true" />}
              Submit
            </button>
            <button type="button" className="glass-btn glass-btn-sm" onClick={onOpenResolve}>
              <Undo2 size={13} aria-hidden="true" /> Cancel
            </button>
          </div>
        </div>
      )}
      {panel.thread && (
        <>
          <p className="acard-drawer-title">Message thread</p>
          {thread?.loading ? (
            <div className="spinner" style={{ width: 24, height: 24 }} />
          ) : !thread || thread.messages.length === 0 ? (
            <p className="acard-foot-note" style={{ fontStyle: 'normal' }}>
              No messages yet. Anything you send here goes to the customer.
            </p>
          ) : (
            <div
              className="adsp-thread"
              // Focusable so the scroller can be reached and scrolled by
              // keyboard; none of its children are focusable, so without
              // this the messages below the fold are unreachable.
              tabIndex={0}
              role="log"
              aria-label={`Message thread for dispute ${d.id}`}
            >
              {thread.messages.map((m) => (
                <div key={m.id} className={`adsp-msg${m.is_staff ? ' is-staff' : ''}`}>
                  <div className="adsp-msg-head">
                    {/* `dispute_messages.user_id` is ON DELETE SET NULL
                        behind an inner join on users, so a deleted
                        author's message drops out of the thread — the
                        count on the row can legitimately exceed what is
                        rendered here. */}
                    {/* Same face and same hover card as the ticket thread and
                        the live chat. A dispute is decided on who the buyer is
                        as much as on what they wrote, and the card carries the
                        order count and tenure that used to mean leaving this
                        page to look them up. */}
                    <Avatar username={m.username} avatarPath={m.avatar_path} size={22} />
                    <span className="adsp-msg-who">{m.username || 'Unknown'}</span>
                    {m.is_staff && <span>staff</span>}
                    <span title={fullDate(m.created_at)}>{relTime(m.created_at, now)}</span>
                  </div>
                  {/* A div, not a p: an encrypted block pasted into the
                      thread renders as a panel, and a panel is not phrasing
                      content. Same class, same look, plus the audited decrypt
                      for staff who may read addresses. */}
                  <ArmoredText as="div" className="adsp-msg-body" text={m.body} context={`dispute ${d.id}`} />
                  {/* The evidence. Fetched with the viewer's credentials
                      through the same route the ticket page uses, which
                      admits the dispute desk's read grant for these files. */}
                  {m.attachments?.length > 0 && (
                    <div className="adsp-msg-atts">
                      {m.attachments.map((att) => <TicketAttachment key={att.id} att={att} />)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* The thread's other home. Everything the dispute desk cannot do
              to it — attach a file to a reply, file an internal note, change
              its priority — the support desk can, and the two share one
              record. Gated on the grant that opens that page. */}
          {d.ticket_id && can.has('support.view') && (
            <p className="acard-foot-note adsp-ticket-link">
              <Link to={`/admin/support/${d.ticket_id}`}>
                <ExternalLink size={12} aria-hidden="true" /> Open ticket #{d.ticket_id} on the support desk
              </Link>
              {' '}for internal notes, files on a reply, or a priority change.
            </p>
          )}

          {can.has('disputes.reply') ? (
            <div className="adsp-compose">
              <textarea
                className="glass-input"
                rows={2}
                maxLength={4000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Reply to the customer…"
                aria-label={`Reply to dispute ${d.id}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!sending && draft.trim()) {
                      setSending(true);
                      onSend(draft).then((ok) => { if (ok) setDraft(''); }).finally(() => setSending(false));
                    }
                  }
                }}
              />
              <button
                type="button"
                className="glass-btn glass-btn-primary glass-btn-sm"
                disabled={sending || !draft.trim()}
                onClick={() => {
                  setSending(true);
                  onSend(draft).then((ok) => { if (ok) setDraft(''); }).finally(() => setSending(false));
                }}
              >
                {sending ? <span className="spinner spinner-inline" /> : <Send size={13} aria-hidden="true" />}
                Send
              </button>
              {/* Under the composer, never in it — the same placement and the
                  same reason as the support desk's: the box that sends holds
                  only what a person decided to send, and a draft arrives in it
                  by a deliberate press. The buyer's own consent is checked
                  server-side (`allowedForSubject`), so a claim from somebody
                  who never turned the assistant on returns a sentence saying
                  so rather than an empty draft. */}
              <ReplyAssist desk="dispute" ticketId={d.id} onUse={setDraft} />
            </div>
          ) : (
            <p className="acard-foot-note">
              You can read this thread but not post in it.
            </p>
          )}
        </>
      )}
    </>
  );
}
