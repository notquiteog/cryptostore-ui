import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ShieldAlert, RefreshCw, CircleCheck, TriangleAlert, OctagonAlert, HelpCircle,
  EyeOff, Activity, ArrowRight, Check, ChevronDown, Timer, History,
} from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';
import { relTime, fullDate } from '../../utils/adminFormat';
import {
  SEVERITY, sev, bySeverity, linksFor, hintFor, figuresOf,
  bandSegments, bandLabel, flapCount,
} from '../../utils/riskChecks';

/**
 * The operational risk board.
 *
 * ── Why this is not on the dashboard ────────────────────────────────────────
 *
 * The dashboard answers "how is the business doing". This answers "is anything
 * about to stop working", and the two are read at different times by people in
 * different moods. Putting a disk-full warning next to a revenue sparkline
 * makes the sparkline feel alarming and the warning feel decorative.
 *
 * ── The board is short on purpose for some people ───────────────────────────
 *
 * Rows are filtered per check by permission, server side. A check somebody may
 * not see is ABSENT, never greyed out — a greyed row still discloses that the
 * store has a Zelle pool and that something is wrong with it. `hidden` is a
 * count, so a short board explains itself without naming what is missing.
 *
 * ── Severity is form, not just colour ───────────────────────────────────────
 *
 * Every state carries an icon and a left rail as well as a hue, because a board
 * whose only signal is red-versus-green is unreadable to a good fraction of the
 * people who will read it, and unreadable to anybody in a hurry.
 *
 * ── The layout is an annunciator panel, and that is not a metaphor ──────────
 *
 * This board is a latch: a check trips, the lamp lights, and it stays lit until
 * the condition clears — the scan alerts on the CROSSING, never on the
 * condition. That is exactly what an annunciator panel in a plant or a cockpit
 * does, down to the acknowledge button, which marks a lamp as seen without
 * clearing it or silencing anything. DESIGN §10 asks for the moment where a
 * mechanism has a physical analogue; here the analogue is not decoration
 * borrowed for the look, it is what the code already is.
 *
 * So the panel is drawn the way a panel is built. Lit lamps are large, at the
 * top, and carry everything needed to act. Dark lamps are a dense roster
 * underneath — present, because their absence would be the alarming thing, and
 * small, because they are not what anybody is here for. An unacknowledged lamp
 * is struck; acknowledged, it goes steady and names who saw it. Beside each one
 * runs the strip chart: where this check has been for the last fortnight, which
 * is the only way to tell one bad night from something that has been failing
 * quietly since Tuesday.
 *
 * ── DESIGN §6: what kind of list is this? ───────────────────────────────────
 *
 * Neither a responsive table nor two purpose-built views — a toggle, because
 * this list is unusual in two ways that decide it. It is never long (the
 * registry is nine checks and bounded by a release, not by the store's
 * turnover), and its rows are wildly unequal (nought to three of them matter
 * and the rest are there to be counted). A table gives nine rows identical
 * weight, which is the failure §1 names; the severity-weighted panel above is
 * the answer during an incident, and the flat roster is the answer for the
 * fourth check of a quiet shift. Both fit, so both ship, and `useViewMode`
 * remembers which one this operator meant.
 */

/**
 * How often the board re-reads itself.
 *
 * A minute, against a scan that runs every fifteen by default: the poll is not
 * trying to catch the scan, it is keeping "last scanned 3m ago" honest and
 * picking up an acknowledgement somebody else made while this tab was open.
 */
const REFRESH_MS = 60_000;

const ICONS = {
  critical: OctagonAlert,
  warn: TriangleAlert,
  unknown: HelpCircle,
  ok: CircleCheck,
};

const iconOf = (severity) => ICONS[severity] || HelpCircle;

/**
 * The DOM id a check's lamp carries, so the tape can jump to it.
 *
 * Dots are legal in an id and illegal in the fragment selector a browser
 * resolves `href="#…"` against, so `disk.uploads` has to become
 * `risk-check-disk-uploads` or the link silently does nothing. One function,
 * because the id is written in one place and read in another.
 */
const anchorId = (key) => `risk-check-${key.replace(/\./g, '-')}`;

/**
 * How long the current state has held, as a duration rather than an instant.
 *
 * "since 14:20" makes an operator do the subtraction, and the subtraction is
 * the whole question: a pool that has been critical for eleven minutes is a
 * pool somebody may already be fixing, and one that has been critical for two
 * days is a pool nobody has looked at.
 */
function heldFor(value, now) {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return null;

  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/* ── Pieces ───────────────────────────────────────────────────────────────── */

/**
 * The one number a check is really about, with the lines the operator drew on
 * it.
 *
 * Only percentage checks get a bar — a meter on a value with no ceiling is a
 * decoration pretending to be information — and the ticks are the difference
 * between "78% consumed" and "78% consumed, and you asked to hear about this at
 * 75". The server sends both, because only it knows the thresholds; a client
 * that guessed them would drift the first time somebody edited a setting.
 */
function Meter({ meter, label }) {
  if (!meter) return null;
  const { value, warn, critical } = meter;

  return (
    <div className="risk-meter-wrap">
      <div
        className="risk-meter"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${value}% used, warning at ${warn}%, critical at ${critical}%`}
      >
        <div className="risk-meter-fill" style={{ width: `${value}%` }} />
        {[['warn', warn], ['critical', critical]].map(([kind, at]) => (
          at != null && at > 0 && at < 100 ? (
            <span
              key={kind}
              className={`risk-tick is-${kind}`}
              style={{ left: `${at}%` }}
              // The tick is geometry, and geometry is not a channel on its own.
              // The number is in the title and in the meter's own label.
              title={`${sev(kind).label} at ${at}%`}
              aria-hidden="true"
            />
          ) : null
        ))}
      </div>
      <span className="risk-meter-scale" aria-hidden="true">
        <b>{value}%</b>
        {warn != null && <span>warn {warn}</span>}
        {critical != null && <span>crit {critical}</span>}
      </span>
    </div>
  );
}

/**
 * The strip chart: where this check has been across the window.
 *
 * Built out of `<div>`s with percentage widths rather than an SVG, because the
 * only geometry involved is "this state held this fraction of the window" and
 * a flex row expresses that natively — including when the card is 260px wide in
 * a roster and 700px wide in a panel, which an SVG viewBox would have to be
 * told about twice.
 *
 * The `null` severity is the stretch before the transition log has any
 * coverage, and it is drawn as a hatch rather than a colour on purpose. See
 * `bandSegments`: painting an unwatched week in the colour the check happens to
 * be now is the most misleading thing this page could do.
 */
function Band({ segments, days, flaps }) {
  if (!segments.length) return null;

  return (
    <div className="risk-band-wrap">
      <div className="risk-band" role="img" aria-label={bandLabel(segments, days)}>
        {segments.map((s) => (
          <span
            key={`${s.start}-${s.severity}`}
            className={`risk-band-seg is-${s.severity ?? 'none'}`}
            style={{ width: `${s.pct}%` }}
            title={s.severity ? sev(s.severity).label : 'Not recorded'}
          />
        ))}
      </div>
      <div className="risk-band-axis" aria-hidden="true">
        <span>{days}d ago</span>
        {/* A count of crossings, not of scans. A check that tripped and
            recovered four times in a fortnight is a different fault from one
            that tripped once and stayed down, and the latch alone renders the
            two identically. */}
        {flaps > 1 && <span className="risk-flaps">{flaps} changes</span>}
        <span>now</span>
      </div>
    </div>
  );
}

function Figures({ figures }) {
  if (!figures.length) return null;
  return (
    <dl className="risk-figures">
      {figures.map((f) => (
        <div key={f.label} className="risk-figure">
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Where an operator goes to fix this, and what to do when that is nowhere.
 *
 * Links are filtered against the account's own grants, so a manager is never
 * offered a button that lands them on a permission wall — see `linksFor`. When
 * every link has been filtered away, or the check never had one, the hint is
 * what is left, and it is written to be useful on its own.
 */
function NextSteps({ row, user, showHint }) {
  const links = linksFor(row, user);
  const hint = showHint ? hintFor(row.key) : null;
  if (!links.length && !hint) return null;

  return (
    <div className="risk-next">
      {hint && <p className="risk-hint">{hint}</p>}
      {links.length > 0 && (
        <nav className="risk-links" aria-label={`Where to fix ${row.label}`}>
          {links.map((l) => (
            <Link key={l.to} to={l.to} className="risk-link">
              {l.label} <ArrowRight size={12} aria-hidden="true" />
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

/**
 * The acknowledge control — the annunciator's ack button, and nothing more.
 *
 * It does not silence anything, because there is nothing recurring to silence:
 * the alert fires on the crossing and never repeats. What it does is tell the
 * next person to open this board that somebody is already on it, which at 03:00
 * is the difference between one investigation and two.
 *
 * Once acknowledged it stops being a button. A control that stays pressable
 * after it has done its work invites a second press that means nothing, and the
 * name is then the information: who, and how long ago.
 */
function AckControl({ row, onAck, busy, now }) {
  if (row.severity === 'ok') return null;

  if (row.acknowledged_at) {
    return (
      <span className="risk-ack is-done" title={fullDate(row.acknowledged_at)}>
        <Check size={12} aria-hidden="true" />
        Seen by {row.acknowledged_by || 'staff'} {relTime(row.acknowledged_at, now)}
      </span>
    );
  }

  return (
    <button
      type="button"
      className="risk-ack-btn"
      onClick={() => onAck([row.key])}
      disabled={busy}
    >
      <Check size={13} aria-hidden="true" />
      Acknowledge
    </button>
  );
}

/**
 * A lit lamp: one check that needs somebody, drawn with everything needed to
 * act on it.
 *
 * Deliberately not the same component as the roster row below. DESIGN §1 —
 * "real information is not uniformly weighted; a layout that gives three things
 * identical treatment is admitting it never asked which matters". These are the
 * rows somebody opened the page for, and they are the size of that.
 */
function CheckPanel({ row, index, band, days, flaps, user, onAck, busy, now }) {
  const s = sev(row.severity);
  const Icon = iconOf(row.severity);
  const held = heldFor(row.changed_at, now);

  return (
    <article
      id={anchorId(row.key)}
      className={`risk-panel is-${row.severity}${row.acknowledged_at ? ' is-acked' : ''}`}
      style={{ '--risk-tone': s.tone, '--i': Math.min(index, 10) }}
    >
      <div className="risk-panel-lamp" aria-hidden="true">
        <Icon size={20} />
      </div>

      <div className="risk-panel-body">
        <header className="risk-panel-head">
          <h3 className="risk-panel-label">{row.label}</h3>
          <span className="risk-badge">{s.label}</span>
          {/* A lamp says WHAT is wrong; the manual says what it means and what
              to do about it, and the two were a page apart. `NextSteps` below
              already links somewhere for the checks that have a destination —
              this is for the ones where the honest next step is understanding
              the check, which is most of them the first time an operator sees
              one lit. The question carries the label and the summary, because
              the summary is the sentence that names the actual state and a
              question without it gets a generic answer about the check. */}
          <AskAbout
            question={`On the risk board, the "${row.label}" check is showing ${s.label.toLowerCase()}: ${row.summary} What does this check watch, why would it be in that state, and what should I do about it?`}
            title={`Ask the assistant about the ${row.label} check`}
          />
          {held && (
            <span className="risk-held" title={`Since ${fullDate(row.changed_at)}`}>
              <Timer size={11} aria-hidden="true" /> {held}
            </span>
          )}
          <AckControl row={row} onAck={onAck} busy={busy} now={now} />
        </header>

        <p className="risk-summary">{row.summary}</p>

        <Meter meter={row.meter} label={row.label} />
        <Figures figures={figuresOf(row.detail)} />
        <Band segments={band} days={days} flaps={flaps} />
        <NextSteps row={row} user={user} showHint />
      </div>
    </article>
  );
}

/**
 * A dark lamp: one line, expandable.
 *
 * The detail is behind a press rather than a hover, which is DESIGN §4's rule
 * read the strict way — "never hide the only path to an action" and "touch has
 * no hover". A hover-only disclosure here would mean a phone could see nine
 * check names and none of their numbers, which is §5's "hiding columns silently
 * deletes data the operator needed" wearing a different hat.
 *
 * The lift and the arrow on hover are the reveal; the press is the disclosure.
 */
function RosterRow({ row, index, band, days, flaps, user, onAck, busy, now, open, onToggle }) {
  const s = sev(row.severity);
  const Icon = iconOf(row.severity);
  const held = heldFor(row.changed_at, now);
  const panelId = `${anchorId(row.key)}-detail`;

  return (
    <li
      id={anchorId(row.key)}
      className={`risk-row is-${row.severity}${open ? ' is-open' : ''}${row.acknowledged_at ? ' is-acked' : ''}`}
      style={{ '--risk-tone': s.tone, '--i': Math.min(index, 10) }}
    >
      <button
        type="button"
        className="risk-row-main"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="risk-row-icon" aria-hidden="true"><Icon size={15} /></span>
        <span className="risk-row-label">{row.label}</span>
        <span className="risk-row-summary">{row.summary}</span>
        <span className="risk-row-state">
          <span className="risk-badge">{s.label}</span>
          {held && <span className="risk-held t-num">{held}</span>}
        </span>
        <ChevronDown size={14} className="risk-row-chev" aria-hidden="true" />
      </button>

      {open && (
        <div className="risk-row-detail" id={panelId}>
          <Meter meter={row.meter} label={row.label} />
          <Figures figures={figuresOf(row.detail)} />
          <Band segments={band} days={days} flaps={flaps} />
          <div className="risk-row-foot">
            <NextSteps row={row} user={user} showHint={row.severity !== 'ok'} />
            <AckControl row={row} onAck={onAck} busy={busy} now={now} />
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * Every crossing in the window, newest first.
 *
 * This is the part the latch could never answer. The board says what is wrong
 * now; the tape says what changed, in what order, and whether it changed back —
 * which is how somebody reconstructs a night they slept through. It links each
 * entry to its lamp, and the whole section to the audit log, where the rescans
 * and acknowledgements that happened alongside are recorded.
 */
function ChangeTape({ events, labels, now, canAudit }) {
  if (!events.length) return null;

  return (
    <section className="risk-tape" aria-labelledby="risk-tape-head">
      <header className="risk-tape-head">
        <h2 id="risk-tape-head"><History size={14} aria-hidden="true" /> What changed</h2>
        {canAudit && (
          <Link to="/admin/audit-log" className="risk-tape-more">
            Audit log <ArrowRight size={12} aria-hidden="true" />
          </Link>
        )}
      </header>

      <ol className="risk-tape-list">
        {events.map((e) => (
          <li key={e.id} className={`risk-tape-row is-${e.to}`}>
            <time className="risk-tape-when t-num" dateTime={e.at} title={fullDate(e.at)}>
              {relTime(e.at, now)}
            </time>
            <a className="risk-tape-check" href={`#${anchorId(e.key)}`}>
              {labels.get(e.key) || e.key}
            </a>
            <span className="risk-tape-move" aria-label={`${sev(e.from).label} to ${sev(e.to).label}`}>
              <span className={`risk-dot is-${e.from}`} aria-hidden="true" />
              <ArrowRight size={11} aria-hidden="true" />
              <span className={`risk-dot is-${e.to}`} aria-hidden="true" />
            </span>
            <span className="risk-tape-text">{e.summary}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ── The page ─────────────────────────────────────────────────────────────── */

export default function RiskBoard() {
  const { user } = useAuth();
  const [view, setView] = useViewMode('risk-board', 'cards');

  const [board, setBoard] = useState(null);
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [acking, setAcking] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  /**
   * One clock for the whole page.
   *
   * Every relative time on screen — the durations, the tape, the band's right
   * edge — is measured from this, so a card never disagrees with the row under
   * it about what "now" is. Advanced on each poll rather than on a timer of its
   * own: a second ticker would re-render nine lamps every second to move a
   * figure that changes every minute.
   */
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      // Two requests, deliberately. The board is polled every minute; the
      // history changes only when something actually crosses a line, and
      // bundling them would re-send a fortnight of transitions sixty times an
      // hour. They are fetched together and settled together so the band never
      // renders against a board from a different scan.
      const [next, log] = await Promise.all([
        api.get('/risk/board'),
        api.get('/risk/history').catch(() => null),
      ]);
      setBoard(next);
      if (log) setHistory(log);
      setNow(Date.now());
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load the risk board');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    timer.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  const rescan = async () => {
    setScanning(true);
    try {
      const next = await api.post('/risk/rescan');
      setBoard(next);
      setNow(Date.now());
      // A forced scan can move a check, and a moved check is a new row on the
      // tape. Re-reading it here is what keeps the two halves of the page
      // describing the same instant.
      api.get('/risk/history').then(setHistory).catch(() => {});
      toast.success(next.scanned === false ? 'A scan was already running' : 'Scanned');
    } catch (err) {
      toast.error(err.message || 'Could not run the scan');
    } finally {
      setScanning(false);
    }
  };

  const acknowledge = async (keys) => {
    setAcking(true);
    try {
      const next = await api.post('/risk/acknowledge', { keys });
      setBoard(next);
      setNow(Date.now());
      const n = next.acknowledged?.length || 0;
      // Said as a count rather than "Acknowledged", because the server drops
      // keys that are already clear or already acknowledged and the operator
      // should see when their press landed on fewer rows than they aimed at.
      toast.success(n === 0 ? 'Nothing left to acknowledge' : `Acknowledged ${n} check${n === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err.message || 'Could not acknowledge');
    } finally {
      setAcking(false);
    }
  };

  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const rows = useMemo(() => [...(board?.rows || [])].sort(bySeverity), [board]);
  const attention = useMemo(() => rows.filter((r) => r.severity !== 'ok'), [rows]);
  const clear = useMemo(() => rows.filter((r) => r.severity === 'ok'), [rows]);
  const labels = useMemo(() => new Map(rows.map((r) => [r.key, r.label])), [rows]);

  const days = board?.window_days || 14;
  const windowStart = now - days * 86400000;

  /** Each check's transitions, newest first — the input the band walks back. */
  const byCheck = useMemo(() => {
    const map = new Map();
    for (const event of history?.events || []) {
      if (!map.has(event.key)) map.set(event.key, []);
      map.get(event.key).push(event);
    }
    return map;
  }, [history]);

  const bandFor = useCallback((row) => bandSegments({
    severity: row.severity,
    changedAt: row.changed_at,
    events: byCheck.get(row.key) || [],
    recordingSince: history?.recording_since ?? board?.recording_since,
    from: windowStart,
    to: now,
  }), [byCheck, history, board, windowStart, now]);

  const worst = sev(board?.worst || 'ok');
  const WorstIcon = iconOf(board?.worst || 'ok');
  const counts = board?.counts || {};
  const problems = (counts.critical || 0) + (counts.warn || 0) + (counts.unknown || 0);
  const unacked = attention.filter((r) => !r.acknowledged_at);

  /** When the scheduled pass is next due, from the last one plus the interval. */
  const nextScan = useMemo(() => {
    if (!board?.scanned_at || !board.scan_minutes || board.scan_enabled === false) return null;
    const due = new Date(board.scanned_at).getTime() + board.scan_minutes * 60000;
    const mins = Math.round((due - now) / 60000);
    return mins <= 0 ? 'due now' : `in ~${mins}m`;
  }, [board, now]);

  const shared = { days, user, onAck: acknowledge, busy: acking, now };

  return (
    <div className="admin-page risk-page">
      <PageHeader
        icon={ShieldAlert}
        title="Risk board"
        subtitle={
          loading ? 'Reading the store…'
            : problems === 0
              ? `All ${rows.length} check${rows.length === 1 ? '' : 's'} clear`
              : `${problems} check${problems === 1 ? '' : 's'} need attention`
        }
      >
        {!loading && !error && rows.length > 0 && (
          <ViewToggle value={view} onChange={setView} label="Board layout" />
        )}
        <button type="button" className="glass-btn glass-btn-sm" onClick={rescan} disabled={scanning}>
          <RefreshCw size={14} aria-hidden="true" className={scanning ? 'spin' : ''} />
          {scanning ? 'Scanning…' : 'Scan now'}
        </button>
      </PageHeader>

      {error && (
        <div className="glass-card pull-empty">
          <TriangleAlert size={22} aria-hidden="true" />
          <p>{error}</p>
          <button type="button" className="glass-btn glass-btn-sm" onClick={load}>Try again</button>
        </div>
      )}

      {!error && loading && (
        <div className="risk-skels" aria-hidden="true">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="risk-skel" style={{ '--i': i }} />)}
        </div>
      )}

      {!error && !loading && board && (
        <>
          {/* The banner is the whole board in one line, for somebody who opened
              this page to find out whether they can close it again. */}
          <div className={`risk-banner is-${board.worst}`} style={{ '--risk-tone': worst.tone }}>
            <span className="risk-banner-icon"><WorstIcon size={20} aria-hidden="true" /></span>
            <div className="risk-banner-text">
              <strong>
                {problems === 0
                  ? 'Nothing needs attention'
                  : [
                    counts.critical && `${counts.critical} critical`,
                    counts.warn && `${counts.warn} warning`,
                    counts.unknown && `${counts.unknown} unknown`,
                  ].filter(Boolean).join(' · ')}
              </strong>
              <span>
                {board.scanned_at ? `Scanned ${relTime(board.scanned_at, now)}` : 'Not scanned yet'}
                {nextScan && <>{' · '}next {nextScan}</>}
                {board.scan_enabled === false && <>{' · '}<b className="risk-off">scheduled scan is off</b></>}
                {board.hidden > 0 && (
                  <>
                    {' · '}
                    <span className="risk-hidden" title="Checks your permissions do not cover. They are not shown at all, rather than shown blanked.">
                      <EyeOff size={11} aria-hidden="true" /> {board.hidden} not visible to you
                    </span>
                  </>
                )}
              </span>
            </div>

            <div className="risk-banner-actions">
              {/* Only when there is more than one, because acknowledging a
                  single lamp is already one press on the lamp itself. */}
              {unacked.length > 1 && (
                <button
                  type="button"
                  className="risk-ack-btn is-bulk"
                  onClick={() => acknowledge(unacked.map((r) => r.key))}
                  disabled={acking}
                >
                  <Check size={13} aria-hidden="true" />
                  Acknowledge {unacked.length}
                </button>
              )}
              <div className="risk-tally" aria-hidden="true">
                {['critical', 'warn', 'unknown', 'ok'].map((k) => (
                  counts[k] ? (
                    <span key={k} className={`risk-pip is-${k}`} title={`${counts[k]} ${SEVERITY[k].label}`}>
                      {counts[k]}
                    </span>
                  ) : null
                ))}
              </div>
            </div>
          </div>

          {rows.length === 0 ? (
            /* DESIGN §9: an empty state is navigation, not an apology. This one
               is reachable — the route lets anybody holding any one of five
               permissions in, and a grant can be revoked while the tab is open —
               so it says what it is and points at the pages that are still
               theirs. */
            <div className="glass-card pull-empty">
              <Activity size={22} aria-hidden="true" />
              <p>None of the health checks are visible to your account.</p>
              <p className="risk-empty-sub">
                The board filters per check rather than blanking rows, so this
                means your grants cover none of the nine.
              </p>
              <nav className="risk-links">
                <Link to="/admin" className="risk-link">Admin home <ArrowRight size={12} aria-hidden="true" /></Link>
              </nav>
            </div>
          ) : view === 'rows' ? (
            /* The flat roster: every check at one density, worst first. */
            <ul className="risk-roster">
              {rows.map((row, i) => (
                <RosterRow
                  key={row.key}
                  row={row}
                  index={i}
                  band={bandFor(row)}
                  flaps={flapCount(byCheck.get(row.key) || [], windowStart)}
                  open={expanded.has(row.key)}
                  onToggle={() => toggle(row.key)}
                  {...shared}
                />
              ))}
            </ul>
          ) : (
            <>
              {attention.length > 0 && (
                <section className="risk-lit" aria-label="Checks needing attention">
                  {attention.map((row, i) => (
                    <CheckPanel
                      key={row.key}
                      row={row}
                      index={i}
                      band={bandFor(row)}
                      flaps={flapCount(byCheck.get(row.key) || [], windowStart)}
                      {...shared}
                    />
                  ))}
                </section>
              )}

              {clear.length > 0 && (
                <section className="risk-dark" aria-labelledby="risk-clear-head">
                  <h2 className="risk-section-head" id="risk-clear-head">
                    <CircleCheck size={13} aria-hidden="true" />
                    Clear
                    <span className="risk-section-count">{clear.length}</span>
                  </h2>
                  <ul className="risk-roster is-compact">
                    {clear.map((row, i) => (
                      <RosterRow
                        key={row.key}
                        row={row}
                        index={i}
                        band={bandFor(row)}
                        flaps={flapCount(byCheck.get(row.key) || [], windowStart)}
                        open={expanded.has(row.key)}
                        onToggle={() => toggle(row.key)}
                        {...shared}
                      />
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}

          {rows.length > 0 && (
            <ChangeTape
              events={(history?.events || []).slice(0, 12)}
              labels={labels}
              now={now}
              canAudit={user?.role === 'admin' || (user?.permissions || []).includes('analytics.audit_log')}
            />
          )}

          <p className="risk-foot">
            Checks alert on a <strong>change</strong> in severity, not on the condition — a disk at 81% is
            at 81% on every scan, and a channel that says so every fifteen minutes is one nobody reads.
            Recovery is recorded but never announced. Acknowledging marks a check as seen; it silences
            nothing, and it clears itself the moment the severity moves again.
          </p>
        </>
      )}
    </div>
  );
}
