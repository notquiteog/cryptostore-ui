import { Fragment, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Activity, Search, FilterX, ChevronDown, ShieldAlert, Clock, ScanSearch, Undo2,
} from 'lucide-react';
import { api } from '../../utils/api';
import PageHeader from '../../components/admin/PageHeader';
import Pager from '../../components/admin/Pager';
import AskAbout from '../../components/admin/AskAbout';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';
import { useAuth } from '../../context/AuthContext';
import { hasAdminPermission } from '../../utils/adminPermissions';
import { money, count as fmtCount, fullDate, humanize } from '../../utils/adminFormat';
import {
  AUDIT_FAMILIES, severityOf, labelOf, readPayload, readTransition,
} from '../../utils/auditActions';
import NextStops from '../../components/admin/NextStops';

const LIMIT = 50;

/**
 * How long a stretch of nothing has to be before the tape says so.
 *
 * Forty-five minutes, because the thing this marker exists to make visible is
 * the shape of a shift: a burst of packing, an hour of nothing, a burst of
 * refunds. Ten minutes would put a marker between most rows during a busy
 * afternoon and mark nothing at all; a whole day would only ever fire
 * overnight, which the day headers already say.
 */
const QUIET_MS = 45 * 60 * 1000;

/**
 * The time windows, in days, resolved by the server against its own clock.
 *
 * "All time" is first and is the default. An audit log that quietly defaulted
 * to the last 24 hours would answer "has this ever happened" with "no".
 */
const WINDOWS = [
  { value: '', label: 'All time' },
  { value: '1', label: 'Last 24h' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
];

/**
 * The clock column is forced to 24-hour, against the reader's locale.
 *
 * Everywhere else in the console a time is formatted for whoever is looking at
 * it. Here it is a ledger column read down its own axis, and a 12-hour clock
 * costs three characters of `AM`/`PM` per row and puts a variable-width suffix
 * inside a `tabular-nums` column, so the colons stop lining up. §6: a column
 * that does not align is unreadable at a glance.
 */
function clockTime(date) {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

/** The stable local-day key two timestamps are compared on. */
function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(date) {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (dayKey(date) === dayKey(today)) return 'Today';
  if (dayKey(date) === dayKey(yesterday)) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long' });
}

/** `3h 12m`, for the length of a quiet stretch. */
function quietFor(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/**
 * One page of rows as days, with the quiet stretches between entries measured.
 *
 * Rows arrive newest-first, so the gap recorded on an entry is the time between
 * it and the entry *above* it — the stretch during which nothing happened.
 * Deliberately never computed across a day boundary or across the top of a
 * page: the row before the first row of page two is on page one, so a gap there
 * would be measured against a row that is not on screen.
 */
function groupByDay(rows) {
  const groups = [];
  let current = null;

  rows.forEach((row, index) => {
    const at = new Date(row.created_at || row.timestamp);
    // A row whose timestamp will not parse still has to appear — it is an audit
    // record, and dropping it because its date is malformed is the one thing
    // this page must never do. It lands in its own group under a plain label.
    const valid = !Number.isNaN(at.getTime());
    const key = valid ? dayKey(at) : 'undated';

    if (!current || current.key !== key) {
      current = { key, at: valid ? at : null, entries: [] };
      groups.push(current);
    }

    const previous = index > 0 ? rows[index - 1] : null;
    const previousAt = previous ? new Date(previous.created_at || previous.timestamp) : null;
    const quiet = valid && current.entries.length && previousAt && !Number.isNaN(previousAt.getTime())
      ? previousAt.getTime() - at.getTime()
      : 0;

    current.entries.push({ row, at: valid ? at : null, quiet });
  });

  return groups;
}

/**
 * A payload value, rendered as the thing it is rather than as JSON.
 *
 * The shapes here are all live in the seeded log: `settings.updated` carries a
 * fifty-element `keys` array, `order.batch_claimed` carries `order_ids`,
 * `user.updated` carries a nested `{changes: {role: {from, to}}}` diff, and
 * plenty of rows carry a lone boolean. A single `JSON.stringify` covered all of
 * them and made none of them readable.
 */
function FieldValue({ field }) {
  const { value, money: isMoney, key } = field;

  if (value === null) return <span className="alog-null">null</span>;
  if (typeof value === 'boolean') return <span className="alog-bool">{value ? 'yes' : 'no'}</span>;
  if (isMoney) return <span className="t-num">{money(value)}</span>;

  if (Array.isArray(value)) return <FieldList items={value} linkOrders={key === 'order_ids'} />;

  if (typeof value === 'object') {
    // A before/after diff. `{role: {from: 'user', to: 'manager'}}` is the only
    // nested shape in the table, and printing it as `role: user → manager` is
    // the difference between an audit row and a stack trace.
    return (
      <span className="alog-nested">
        {Object.entries(value).map(([subKey, sub]) => (
          <span key={subKey} className="alog-nested-item">
            <em>{humanize(subKey)}</em>
            {sub && typeof sub === 'object' && 'to' in sub ? (
              <>
                <span className="alog-was">{String(sub.from ?? '—')}</span>
                <span className="alog-arrow" aria-label="changed to">→</span>
                <span className="alog-now">{String(sub.to ?? '—')}</span>
              </>
            ) : (
              <span className="alog-now">{JSON.stringify(sub)}</span>
            )}
          </span>
        ))}
      </span>
    );
  }

  // An ISO instant reads as a wall of digits; anything else is printed as-is.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(value)) {
    const when = new Date(value);
    if (!Number.isNaN(when.getTime())) return <span className="t-num">{when.toLocaleString()}</span>;
  }

  return <span className="alog-plain">{String(value)}</span>;
}

/**
 * A list payload as chips, with a cap.
 *
 * The cap is not cosmetic. One `settings.updated` row in the seeded log carries
 * fifty theme keys; printed in full it is taller than the viewport and buries
 * the twelve rows underneath it. Fourteen shows the shape, the count says what
 * is hidden, and the button opens the rest in place — §5's rule that nothing
 * disappears without the screen saying so.
 */
function FieldList({ items, linkOrders }) {
  const [expanded, setExpanded] = useState(false);
  const CAP = 14;
  const shown = expanded ? items : items.slice(0, CAP);
  const hidden = items.length - shown.length;

  return (
    <span className="alog-list">
      {shown.map((item, i) => (
        linkOrders ? (
          <Link
            key={`${item}-${i}`}
            className="alog-chip is-link t-num"
            to={`/admin/orders?search=${encodeURIComponent(item)}`}
          >
            #{String(item)}
          </Link>
        ) : (
          <span key={`${item}-${i}`} className="alog-chip">
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </span>
        )
      ))}
      {hidden > 0 && (
        <button type="button" className="alog-chip is-more" onClick={() => setExpanded(true)}>
          +{hidden} more
        </button>
      )}
    </span>
  );
}

/** The decoded payload, plus the raw bytes behind one more disclosure. */
function Payload({ entry, fields, raw, ip }) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="alog-payload">
      {fields.length > 0 && (
        <dl className="alog-fields">
          {fields.map((field) => (
            <Fragment key={field.key}>
              <dt>{field.label}</dt>
              <dd><FieldValue field={field} /></dd>
            </Fragment>
          ))}
        </dl>
      )}

      {/* The address is shown here rather than in a column of its own. On a
          store that has not turned `session_ip_logging` on — the default, and
          the right default per CLAUDE.md — every row's address is NULL, so a
          column for it was forty rows of em dash taking a fifth of the width.
          Kept, because §5 forbids silently deleting data the operator had; moved,
          because a field that is empty by design does not earn a column. */}
      {ip ? (
        <p className="alog-ip">
          <span className="alog-ip-label">Recorded address</span>
          <code className="t-hash">{ip}</code>
        </p>
      ) : null}

      <div className="alog-payload-foot">
        <button
          type="button"
          className="alog-raw-toggle"
          aria-expanded={showRaw}
          onClick={() => setShowRaw((v) => !v)}
        >
          <ChevronDown size={12} aria-hidden="true" className={showRaw ? 'is-open' : ''} />
          Raw payload
        </button>
        {/* Kept reachable on purpose. The decoded view above is an
            interpretation written in this file, and an audit trail whose only
            rendering is an interpretation is one an operator cannot check. */}
        {showRaw && (
          <pre className="alog-raw t-hash">{JSON.stringify(raw, null, 2)}</pre>
        )}
      </div>

      {!fields.length && !ip && !showRaw && (
        <p className="alog-payload-thin">
          {entry.action} recorded no payload beyond who and when.
        </p>
      )}
    </div>
  );
}

export default function AuditLog() {
  /*
    DESIGN §6, asked and answered: this list is neither the responsive table nor
    two purpose-built views. It is the line-item half of `.lrows` with a toggle
    to the card half — `useViewMode` + `ViewToggle`, the shared pair — because
    the two readings of an audit log are genuinely different jobs.

    A table was the wrong shape and the old page proved it. A table's promise is
    that every row has the same fields; an audit row's payload is different for
    every action — `settings.updated` carries fifty theme keys, `user.updated`
    carries a before/after diff, `order.packed` carries an order and a box. The
    only column a table can offer all of them is one holding a JSON dump behind
    a "Details" button, which is what shipped, and which meant the interesting
    half of every record was one click away and unreadable when it arrived.

    So: Compact is one line per action for scanning a shift, and Detail opens
    every payload for reading an incident. Both are the same records with the
    same fields — §5's rule that a second view is not the first with columns
    removed — and the choice persists.
  */
  const [view, setView] = useViewMode('audit-log', 'rows');

  // One state object, because every filter shares a rule: changing any of them
  // returns to page 1. Held apart, that rule was a second effect racing the
  // fetch, and the fetch usually won — you filtered, and got page 6 of the new
  // result set with the pager saying 1.
  const [q, setQ] = useState({ families: [], actor: '', window: '', query: '', page: 1 });
  const setFilter = useCallback((patch) => {
    setQ((prev) => ({ ...prev, page: 1, ...patch }));
  }, []);

  const [searchInput, setSearchInput] = useState('');
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState([]);
  const [actors, setActors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [droppedTerm, setDroppedTerm] = useState(null);
  const [openIds, setOpenIds] = useState(() => new Set());
  /* ── Putting a bulk repricing back ──
   *
   * The only undo in this log, and only because the old prices are recorded in
   * the row itself. It is a two-step like every other destructive-adjacent
   * control in the console: ask what it WOULD put back, say so, and let the
   * operator agree — the count matters, because a repricing that has been
   * partly edited since will restore fewer lines than it changed, and that is
   * the number somebody needs before they press anything.
   */
  const { user } = useAuth();
  const canEditProducts = hasAdminPermission(user, 'products.edit');
  const [reverting, setReverting] = useState(null);
  const [reloadTick, setReloadTick] = useState(0);

  const revertPrices = async (row) => {
    setReverting(row.id);
    try {
      const plan = await api.post(`/products/prices/revert/${row.id}`, {});
      if (plan.restoring === 0) {
        toast(plan.skipped.length
          ? 'Every one of those prices has been changed since — nothing left to put back.'
          : 'Those prices are already what they were.');
        return;
      }
      const skipNote = plan.skipped.length
        ? `\n\n${plan.skipped.length} will be left alone because somebody has changed ${plan.skipped.length === 1 ? 'it' : 'them'} since.`
        : '';
      const goneNote = plan.missing ? `\n${plan.missing} of the variants no longer exist.` : '';
      // eslint-disable-next-line no-alert
      if (!window.confirm(`Put ${plan.restoring} price${plan.restoring === 1 ? '' : 's'} back to what they were before this change?${skipNote}${goneNote}`)) return;
      const done = await api.post(`/products/prices/revert/${row.id}`, { dry_run: false });
      toast.success(`${done.reverted} price${done.reverted === 1 ? '' : 's'} put back`);
      // The revert writes its own audit row, so the log the operator is looking
      // at is now one entry out of date.
      setReloadTick((n) => n + 1);
    } catch (err) {
      toast.error(err.message || 'Could not put those prices back');
    } finally {
      setReverting(null);
    }
  };

  // Every fetch carries a sequence number and a late one is dropped. Typing in
  // the search box while a slow page is in flight otherwise resolves out of
  // order and paints the older result over the newer one — on a filtered audit
  // log that shows the operator rows their filter excludes.
  const seq = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setFilter({ query: searchInput.trim() }), 350);
    return () => clearTimeout(timer);
  }, [searchInput, setFilter]);

  useEffect(() => {
    const ticket = ++seq.current;
    setLoading(true);

    const params = new URLSearchParams({ page: q.page, limit: LIMIT });
    // Families are sent as the prefixes they stand for. The server matches
    // prefixes and knows nothing about the grouping — see `auditActions.js`.
    const prefixes = q.families.flatMap(
      (key) => AUDIT_FAMILIES.find((f) => f.key === key)?.prefixes || [],
    );
    if (prefixes.length) params.set('action', prefixes.join(','));
    if (q.actor) params.set('actor', q.actor);
    if (q.window) params.set('since', q.window);
    if (q.query) params.set('q', q.query);

    api.get(`/admin/audit-log?${params.toString()}`)
      .then((data) => {
        if (ticket !== seq.current) return;
        setRows(data.logs || []);
        // Postgres returns count() as a string through some drivers, and a
        // string here made `total / LIMIT` NaN and the pager report "Page 1 of
        // 1" over a log with thousands of rows.
        setTotal(Number(data.total) || 0);
        setFacets(data.families || []);
        setActors(data.actors || []);
        // The server drops a search term shorter than its trigram floor. Left
        // unsaid, a one-character search returns the whole log while the
        // heading reads "1,146 actions matching “a”" — a sentence that is not
        // true of what is on screen.
        setDroppedTerm(q.query && !data.searched ? q.query : null);
        setError(null);
      })
      .catch((err) => {
        if (ticket !== seq.current) return;
        setError(err.message || 'Failed to load the audit log');
        toast.error(err.message || 'Failed to load the audit log');
      })
      .finally(() => {
        if (ticket === seq.current) setLoading(false);
      });
  }, [q, reloadTick]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));
  const groups = useMemo(() => groupByDay(rows), [rows]);

  /*
    Chip counts, summed from the server's per-prefix tallies.

    These are counts across the whole filtered log, not across the loaded page,
    and they honour every filter EXCEPT the family filter — so each chip says
    what you would get by pressing it. A facet counted through its own filter
    reads zero on every chip but the active one, which is precisely when the
    control stops being usable.
  */
  const familyCounts = useMemo(() => {
    const byPrefix = new Map(facets.map((f) => [`${f.prefix}.`, f.count]));
    const counts = {};
    let filed = 0;
    for (const family of AUDIT_FAMILIES) {
      counts[family.key] = family.prefixes.reduce((sum, p) => sum + (byPrefix.get(p) || 0), 0);
      filed += counts[family.key];
    }
    counts.__total = facets.reduce((sum, f) => sum + f.count, 0);
    counts.__unfiled = counts.__total - filed;
    return counts;
  }, [facets]);

  const filtered = q.families.length > 0 || !!q.actor || !!q.window || !!q.query;

  const clearAll = () => {
    setSearchInput('');
    setQ({ families: [], actor: '', window: '', query: '', page: 1 });
  };

  const toggleFamily = (key) => {
    setFilter({
      families: q.families.includes(key)
        ? q.families.filter((k) => k !== key)
        : [...q.families, key],
    });
  };

  const toggleOpen = (id) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /*
    A sentence about what is on screen, built from the filter that produced it.

    §1 asks for copy that could not belong to another product, and PageHeader
    asks for a live count rather than a description of the page. "83 actions by
    wh_verify in the last 7 days" is both; "View the audit log" is neither.
  */
  const subtitle = useMemo(() => {
    const parts = [`${fmtCount(total)} action${total === 1 ? '' : 's'}`];
    if (q.families.length) {
      const names = q.families
        .map((key) => AUDIT_FAMILIES.find((f) => f.key === key)?.label)
        .filter(Boolean);
      parts.push(`in ${names.join(', ').toLowerCase()}`);
    }
    if (q.actor) parts.push(`by ${q.actor}`);
    // Only claim to have matched on a term the server actually searched on.
    if (q.query && !droppedTerm) parts.push(`matching “${q.query}”`);
    const window = WINDOWS.find((w) => w.value === q.window);
    if (window?.value) parts.push(window.label.toLowerCase().replace('last ', 'in the last '));
    if (droppedTerm) parts.push(`— “${droppedTerm}” is too short to search, keep typing`);
    return parts.join(' ');
  }, [total, q, droppedTerm]);

  return (
    <div className="admin-page alog-page">
      <PageHeader icon={Activity} title="Audit log" subtitle={subtitle}>
        {/* The shape of the trail, without reading it.
            `staff-audit` in services/ai/topics/staff.js answers this from the
            same `split_part(action, '.', 1)` families the chips below are
            grouped by, and deliberately names nobody — "who" is the question
            this page exists to answer, and it answers it better than a
            sentence could. The question here is the other one: whether
            anything unusual has been going on. */}
        <AskAbout
          question="Summarise the audit log: how many staff actions in the last week and the last month, which areas they were in, and how many were refunds, forced payment confirmations, permission changes, wallet operations or address decryptions."
          label="Ask"
          title="Ask the assistant what the audit trail looks like lately"
        />
        <div className="admin-search alog-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="glass-input"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="An order id, a username, a fingerprint…"
            aria-label="Search actions, actors and payloads"
          />
        </div>
        <ViewToggle
          value={view}
          onChange={setView}
          label="Entry detail"
          cardsLabel="Detail"
          rowsLabel="Compact"
        />
      </PageHeader>

      {/*
        The filter bar. Sticky, because a fifty-row page is two screens tall and
        the control that narrows it should not be one of the things you scroll
        away from — `--glass-sm` and `--shadow-sm`, the tier §3 assigns to a
        sticky toolbar.

        What this replaces was a single text box labelled "Filter by action…"
        that matched on prefix. It worked, and it required the operator to
        already know that the string for "someone touched the wallet" is
        `wallet.` — the page was asking them to have read the server source.
      */}
      <div className="alog-filters">
        <div className="alog-chips" role="group" aria-label="Filter by what was touched">
          <button
            type="button"
            className={`alog-fchip${q.families.length === 0 ? ' is-on' : ''}`}
            aria-pressed={q.families.length === 0}
            onClick={() => setFilter({ families: [] })}
          >
            <span className="alog-fchip-label">Everything</span>
            <span className="alog-fchip-count t-num">{fmtCount(familyCounts.__total || 0)}</span>
          </button>

          {AUDIT_FAMILIES.map((family) => {
            const Icon = family.icon;
            const on = q.families.includes(family.key);
            return (
              <button
                key={family.key}
                type="button"
                className={`alog-fchip is-${family.key}${on ? ' is-on' : ''}`}
                aria-pressed={on}
                onClick={() => toggleFamily(family.key)}
                title={family.blurb}
              >
                <Icon size={13} aria-hidden="true" />
                <span className="alog-fchip-label">{family.label}</span>
                <span className="alog-fchip-count t-num">
                  {fmtCount(familyCounts[family.key] || 0)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="alog-controls">
          {/* A datalist, not a select. The seeded log has 156 distinct actors —
              every fulfilment account that ever packed a box — and a dropdown of
              156 names is a scroll, not a control. Typing narrows it, and the
              actor name on any row sets it in one click. */}
          <label className="alog-control">
            <span className="alog-control-label">Actor</span>
            <input
              className="glass-input"
              list="alog-actors"
              value={q.actor}
              onChange={(e) => setFilter({ actor: e.target.value })}
              placeholder="Anyone"
              aria-label="Filter by actor"
            />
            <datalist id="alog-actors">
              {actors.map((name) => <option key={name} value={name} />)}
            </datalist>
          </label>

          <label className="alog-control">
            <span className="alog-control-label">Window</span>
            <select
              className="glass-input"
              value={q.window}
              onChange={(e) => setFilter({ window: e.target.value })}
              aria-label="Filter by time window"
            >
              {WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          </label>

          {filtered && (
            <button type="button" className="glass-btn glass-btn-sm alog-clear" onClick={clearAll}>
              <FilterX size={13} aria-hidden="true" /> Clear
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="empty-state is-error">
          <ShieldAlert aria-hidden="true" />
          <p>
            The audit log did not load: {error}. Nothing has been lost — this page
            only reads — but until it loads, the trail cannot be checked.
          </p>
          <button type="button" className="glass-btn" onClick={() => setQ((p) => ({ ...p }))}>
            Try again
          </button>
        </div>
      ) : loading ? (
        <div className="lrows alog-feed" aria-busy="true" aria-label="Loading the audit log">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="skeleton lrow-skel alog-skel" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="lrows alog-feed">
          {/* §9: an empty log is navigation, not an apology. Filtered to nothing,
              the way out is widening the filter; empty outright, the way out is
              the surfaces that write to this table in the first place. */}
          <div className="lrows-empty">
            {filtered ? (
              <>
                <strong>Nothing recorded matches that.</strong>
                {/* Same honesty as the heading: a term the server never
                    searched on cannot be the reason there are no rows. */}
                {q.query && !droppedTerm
                  ? <>No action, actor or payload contains “{q.query}”.</>
                  : <>No action was recorded under this filter.</>}
                <div className="lrows-empty-links">
                  <button type="button" className="glass-btn glass-btn-sm" onClick={clearAll}>
                    <FilterX size={13} aria-hidden="true" /> Clear every filter
                  </button>
                  {q.window && (
                    <button
                      type="button"
                      className="glass-btn glass-btn-sm"
                      onClick={() => setFilter({ window: '' })}
                    >
                      <Clock size={13} aria-hidden="true" /> Search all time
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <strong>Nothing has been recorded yet.</strong>
                Refunds, forced payment confirmations, permission grants, key
                operations and dispute rulings each write a line here.
                <div className="lrows-empty-links">
                  <Link to="/admin/users" className="glass-btn glass-btn-sm">Accounts</Link>
                  <Link to="/admin/orders" className="glass-btn glass-btn-sm">Order queue</Link>
                  <Link to="/admin/disputes" className="glass-btn glass-btn-sm">Disputes</Link>
                  <Link to="/admin/risk" className="glass-btn glass-btn-sm">Risk board</Link>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className={`lrows alog-feed is-${view}`}>
          {groups.map((group) => (
            <Fragment key={group.key}>
              {/*
                The day header is the tape's fold. Sticky within the feed so the
                date you are reading under stays named however far down the page
                you scroll — on a fifty-row page spanning three days, the
                alternative is a screen of timestamps with no date on it.
              */}
              <div className="alog-day">
                <span className="alog-day-name">
                  {group.at ? dayLabel(group.at) : 'Undated'}
                </span>
                {group.at && (
                  <span className="alog-day-date">
                    {group.at.toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}
                  </span>
                )}
                <span className="alog-day-count t-num">{group.entries.length} shown</span>
              </div>

              {group.entries.map(({ row, at, quiet }) => {
                const { refs, fields, raw } = readPayload(row.metadata);
                // Graded on the payload as well as the name: a settings save is
                // only notable when it touched something other than the theme.
                const severity = severityOf(row.action, raw);
                const transition = readTransition(fields);
                const open = view === 'cards' || openIds.has(row.id);
                const hasMore = fields.length > 0 || !!row.ip_address;

                return (
                  <Fragment key={row.id}>
                    {quiet >= QUIET_MS && (
                      /*
                        §10: a flourish that does a job. The tape shows where
                        nothing happened, because the shape an investigation is
                        looking for is a burst — an hour of silence and then
                        four refunds in ninety seconds. A uniform list of rows
                        hides that completely; here it is the gap you can see.
                      */
                      <div className="alog-quiet">
                        <span className="alog-quiet-mark" aria-hidden="true" />
                        <span className="alog-quiet-text">
                          {quietFor(quiet)} {filtered ? 'with nothing matching' : 'quiet'}
                        </span>
                      </div>
                    )}

                    <div
                      className={`lrow alog-row is-${severity}${open ? ' is-open' : ''}`}
                      style={{ '--lrow-tone': `var(--alog-${severity})` }}
                    >
                      <time
                        className="alog-time t-num"
                        dateTime={at ? at.toISOString() : undefined}
                        title={fullDate(row.created_at || row.timestamp)}
                      >
                        {at ? clockTime(at) : '––:––:––'}
                      </time>

                      {/* The spine. Each row draws its own segment top to bottom,
                          so consecutive rows join into one continuous line with
                          no magic offset to keep in step with the grid tracks —
                          and a day header, having no segment, breaks it. */}
                      <span className="alog-tick" aria-hidden="true" />

                      <button
                        type="button"
                        className="alog-actor"
                        onClick={() => setFilter({ actor: row.username || '' })}
                        title={`Show only what ${row.username || 'this actor'} did`}
                      >
                        {row.username || 'unattributed'}
                      </button>

                      <div className="alog-what">
                        {/* §3: severity is never colour alone. The tone, the
                            left rule, the filled tick and this glyph are four
                            channels saying the same thing, so the row still
                            reads as consequential at `--glow-strength: 0`, in
                            light mode, and to someone who cannot separate the
                            danger hue from the warning one. */}
                        {severity === 'severe' && (
                          <ShieldAlert size={13} className="alog-severe-mark" aria-label="High-consequence action" />
                        )}
                        <span className="alog-label">{labelOf(row.action)}</span>

                        {transition && (
                          <span className="alog-transition">
                            <span className="alog-was">{humanize(transition.from)}</span>
                            <span className="alog-arrow" aria-label="became">→</span>
                            <span className="alog-now">{humanize(transition.to)}</span>
                          </span>
                        )}

                        {refs.map((ref) => (
                          ref.to ? (
                            <Link
                              key={ref.key}
                              to={ref.to}
                              className={`alog-ref is-link${ref.mono ? ' t-hash' : ''}`}
                            >
                              {ref.label ? <span className="alog-ref-label">{ref.label}</span> : null}
                              {ref.text}
                            </Link>
                          ) : (
                            <span
                              key={ref.key}
                              className={`alog-ref${ref.mono ? ' t-hash' : ''}`}
                            >
                              {ref.label ? <span className="alog-ref-label">{ref.label}</span> : null}
                              {ref.text}
                            </span>
                          )
                        ))}

                        {/* The identifier the row was actually written with.
                            Small, muted, and never removed: a label in this
                            file's words is an interpretation, and the operator
                            grepping the server for the call site needs the real
                            string. §"Name things for what they are." */}
                        <code className="alog-raw-action">{row.action}</code>
                      </div>

                      <div className="lrow-actions alog-actions">
                        {/* ── Putting a bulk repricing back ──
                            The only action in this log with an undo, and only
                            because the old prices are IN the row: a bulk
                            repricing records `{variant_id, from, to}` per line,
                            since unlike stock nothing else keeps the previous
                            number. Every other row here describes something
                            whose prior state is gone.

                            It previews first and puts back only the lines still
                            sitting at the price this change set — a line edited
                            since belongs to whoever edited it. Behind
                            `products.edit`, because it is the same write. */}
                        {row.action === 'product.prices_adjusted' && canEditProducts && (
                          <button
                            type="button"
                            className="glass-btn glass-btn-sm alog-revert"
                            title="Put these prices back to what they were"
                            disabled={reverting === row.id}
                            onClick={() => revertPrices(row)}
                          >
                            <Undo2 size={13} aria-hidden="true" />
                            <span>{reverting === row.id ? 'Working…' : 'Put back'}</span>
                          </button>
                        )}
                        {/* Compact hides the payload behind this; Detail has it
                            open already, so the control would be a button that
                            does nothing. */}
                        {view === 'rows' && hasMore && (
                          <button
                            type="button"
                            className="glass-btn glass-btn-sm alog-expand"
                            aria-expanded={open}
                            // The word is hidden on a narrow feed, where a
                            // 95px button beside a 40px record is the record
                            // losing. The label has to be on the button itself
                            // rather than only in the span, or hiding the span
                            // leaves a chevron with no accessible name.
                            aria-label={open ? 'Hide payload' : 'Show payload'}
                            onClick={() => toggleOpen(row.id)}
                          >
                            <ChevronDown
                              size={13}
                              aria-hidden="true"
                              className={open ? 'is-open' : ''}
                            />
                            <span className="alog-expand-word">{open ? 'Less' : 'Payload'}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/*
                      §2: the `0fr → 1fr` grid track, copied from the receipt.
                      It reveals the payload's natural height with no JS
                      measurement and animates a property that does not trigger
                      layout on the rows below.
                    */}
                    <div className={`alog-drawer${open ? ' is-open' : ''}`}>
                      <div className="alog-drawer-inner">
                        {open && (
                          <Payload
                            entry={row}
                            fields={fields}
                            raw={raw}
                            ip={row.ip_address || row.ip || null}
                          />
                        )}
                      </div>
                    </div>
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </div>
      )}

      <Pager
        page={q.page}
        totalPages={totalPages}
        total={total}
        noun="action"
        label="Audit log pages"
        onChange={(page) => setQ((prev) => ({ ...prev, page }))}
      />

      {/* Two facts about this table that are not visible in it, and that change
          how the page should be read. Stated once, at the bottom, rather than
          repeated as an empty column on every row. */}
      {!loading && !error && rows.length > 0 && (
        <p className="alog-footnote">
          <ScanSearch size={13} aria-hidden="true" />
          Search covers the action, the actor and the payload.
          {' '}Addresses are recorded only while <Link to="/admin/settings">session IP logging</Link> is on.
        </p>
      )}
      <NextStops route="/admin/audit-log" />
    </div>
  );
}
