import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import {
  Gauge, Info, ShieldAlert, Power, Search, FilterX,
  Settings2, ScrollText, KeyRound, Users, ChevronDown,
} from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import { reportSettingsError } from '../../utils/settingsConflict';
import SettingsConflict from '../../components/admin/SettingsConflict';
import useSettingsWatch from '../../hooks/useSettingsWatch';
import SaveBar from '../../components/admin/SaveBar';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';

/**
 * Rate limits and unpaid-order caps.
 *
 * The page carries no copy of the registry: the schema, the current values and
 * whether this operator may edit them all arrive from GET /settings/limits,
 * which reads server/config/limits.js — the same source the seed, the
 * migration, the write-validation and the limiters themselves use. A second
 * copy here is how a control ends up on screen with nothing enforcing it.
 *
 * Saving PUTs only the keys that actually changed, not the whole blob, so a
 * manager scoped to settings.security cannot be 403'd by an unrelated key
 * riding along in the same request.
 *
 * ── The shape of this screen, and why ───────────────────────────────────────
 *
 * The registry holds **thirty-six limiters** across seven groups. The first
 * version of this page drew every one of them as an always-open card with
 * three fields and a paragraph of hint, which is roughly fifteen screens of
 * scrolling with no search, no filter and no order but the registry's own.
 * Every real question an operator arrives with was unanswerable without
 * reading all of it:
 *
 *   · "Something is throttling real customers — which limiter covers login?"
 *   · "What has somebody switched off?"
 *   · "Is anything counted per network address?" — the question the registry's
 *     own comments spend three paragraphs on, because on a Tor-fronted store
 *     an address-keyed limit is one shared bucket for every visitor.
 *   · "Which of these is effectively wide open?" — not answerable at all
 *     without dividing thirty-six pairs of numbers in your head, since
 *     "600 per 15 min" and "120 per 5 min" are not comparable by eye.
 *
 * So: a search, a row of filters that are also the audit summary, and a
 * budget bar (see `RateBar`) that puts every limiter on one comparable scale.
 *
 * DESIGN §6 asks every list to answer one question — responsive table, two
 * purpose-built views, or a toggle. **The answer here is a toggle**, because
 * the two readings of this list genuinely want different shapes:
 *
 *   · *Rows* (the default) is the audit view: one limiter per line, every
 *     control inline, thirty-six of them scannable down one axis. This is the
 *     view that answers "what is off" and "what is loose".
 *   · *Cards* is the reading view: the hint is a paragraph explaining what a
 *     surface costs, and somebody deciding what to set `wallet_unlock` to
 *     needs to read it, not skim it.
 *
 * The hint is the field that differs, which is exactly §6's test for building
 * two real views rather than hiding columns — in rows it is disclosed per
 * limiter, in cards it is always open.
 */

/** Windows are stored in minutes; show something a human reads at a glance. */
function humanWindow(minutes) {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m <= 0) return '—';
  if (m < 60) return `${m} min`;
  if (m % 60 === 0) {
    const h = m / 60;
    if (h % 24 === 0) return `${h / 24} day${h / 24 === 1 ? '' : 's'}`;
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  return `${(m / 60).toFixed(1)} hours`;
}

/** "10 per 15 min" — the sentence the operator is actually reasoning about. */
function rateSentence(max, windowMin) {
  const n = Number(max);
  if (!Number.isFinite(n)) return '—';
  return `${n} per ${humanWindow(windowMin)}`;
}

/**
 * Requests per minute: the one figure that is comparable between two limiters.
 *
 * Everything else on a limiter is a pair — a count and a window — and two
 * pairs cannot be ranked by eye. Reduced to a rate they can, which is what
 * makes the bar below mean anything.
 */
function perMinute(max, windowMin) {
  const n = Number(max);
  const w = Number(windowMin);
  if (!Number.isFinite(n) || !Number.isFinite(w) || w <= 0) return null;
  return n / w;
}

/**
 * The rate, said in whatever unit does not require the reader to multiply.
 *
 * The registry spans 0.083/min (dispute filing) to 40/min (the global
 * backstop), a 480× spread. Printing "0.08/min" for the low end is a figure
 * nobody can picture; "5/hr" is the same fact in the unit that surface is
 * actually thought about in.
 */
function rateUnit(pm) {
  if (pm === null) return '—';
  if (pm >= 10) return `${Math.round(pm)}/min`;
  if (pm >= 1) return `${Math.round(pm * 10) / 10}/min`;
  const perHour = pm * 60;
  if (perHour >= 1) return `${Math.round(perHour)}/hr`;
  return `${Math.round(perHour * 24)}/day`;
}

/**
 * The budget bar — DESIGN §10, a flourish that does a job.
 *
 * A rate limiter *is* a budget: so many requests, then the door shuts until
 * the window rolls. Drawing that budget to a scale shared by the whole page
 * turns "which of these is wide open" from arithmetic into a glance, and it
 * moves while the operator types, so the control and the consequence are on
 * screen at the same moment.
 *
 * Log scale, not linear: on a linear scale the 480× spread in the shipped
 * defaults renders thirty-four of the thirty-six bars as an identical stub
 * next to the global backstop, which tells the reader nothing. `log1p` rather
 * than `log` so a limiter set to its floor still has a length.
 *
 * A switched-off limiter draws the full track in the danger tone, because
 * that is literally true — off is an unbounded budget, the widest one the
 * page can show. It is also why the off state does not need the bar to
 * disappear to be legible: full-width red is the loudest thing on the screen,
 * which is the correct volume for "this surface is unprotected".
 */
function RateBar({ pm, ceiling, off, invalid }) {
  const fill = off
    ? 1
    : (pm === null || !(ceiling > 0)
      ? 0
      // Floored so the slowest limiter on the page is a visible stub rather
      // than an empty track that reads as broken or as "off".
      : Math.min(1, Math.max(0.04, Math.log1p(pm) / Math.log1p(ceiling))));

  return (
    <div
      className={`rl-bar${off ? ' is-off' : ''}${invalid ? ' is-invalid' : ''}`}
      style={{ '--rl-fill': fill }}
      aria-hidden="true"
    >
      <span className="rl-bar-fill" />
    </div>
  );
}

function Toggle({ id, checked, onChange, disabled, label }) {
  return (
    <label className="switch" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" />
    </label>
  );
}

/** The on / off pill. Colour, border and a word — never colour alone. */
function StatePill({ on }) {
  return (
    <span className={`rl-state${on ? ' on' : ''}`}>
      <Power size={11} aria-hidden="true" />
      {on ? 'On' : 'Off'}
    </span>
  );
}

/**
 * A number with its range enforced in the field rather than only on save.
 *
 * `bare` is the audit-view variant, where `.lrows-head` already prints the
 * column heading and a visible label per input would be the same word printed
 * thirty-six times down the screen. The accessible name comes from
 * `srLabel` and names the *limiter* as well as the field, because "Requests
 * allowed" thirty-six times running identifies nothing to a screen reader.
 *
 * `.rl-field-mini` is the same word again, `aria-hidden` and painted only when
 * the container is too narrow for the heading row — one visible label, one
 * accessible name, never two competing ones.
 */
function NumField({ id, label, srLabel, value, spec, disabled, onChange, suffix, bare, cell }) {
  const n = Number(value);
  const out = Number.isFinite(n) && (n < spec.min || n > spec.max);
  return (
    <div className={`rl-field${bare ? ' rl-field-bare' : ''}${cell ? ` ${cell}` : ''}`}>
      {bare ? (
        <span className="rl-field-mini" aria-hidden="true">{label}</span>
      ) : (
        <label htmlFor={id} className="rl-field-label">{label}</label>
      )}
      <div className="rl-field-input">
        <input
          id={id}
          className={`glass-input${out ? ' rl-invalid' : ''}`}
          type="number"
          inputMode="numeric"
          min={spec.min}
          max={spec.max}
          value={value}
          disabled={disabled}
          aria-label={bare ? srLabel : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && <span className="rl-field-suffix">{suffix}</span>}
      </div>
      {out && (
        <span className="rl-field-error">Must be between {spec.min} and {spec.max}</span>
      )}
    </div>
  );
}

/**
 * What a limit counts against.
 *
 * This is the control that makes the whole page usable on a Tor-fronted store.
 * A limit keyed on the network address is one shared bucket for every visitor
 * arriving through the same exit — so the operator has to be able to see, per
 * limit, which identity is being counted, and change it without a deploy.
 *
 * The options come from the server, so the picker can never offer a strategy
 * the write-validation would reject.
 */
function IdentityField({ id, srLabel, value, options, disabled, onChange, bare, cell }) {
  const chosen = options.find((o) => o.key === value);
  return (
    <div className={`rl-field${bare ? ' rl-field-bare' : ' rl-field-wide'}${cell ? ` ${cell}` : ''}`}>
      {bare ? (
        <span className="rl-field-mini" aria-hidden="true">Counted per</span>
      ) : (
        <label htmlFor={id} className="rl-field-label">Counted per</label>
      )}
      <div className="rl-field-input">
        <select
          id={id}
          className={`glass-input rl-identity-select${value === 'address' ? ' is-address' : ''}`}
          value={value ?? ''}
          disabled={disabled}
          aria-label={bare ? srLabel : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>
      {!bare && chosen?.hint && (
        <span className="rl-field-hint rl-identity-hint">{chosen.hint}</span>
      )}
    </div>
  );
}

/**
 * What a proof-of-work number MEANS, as the suffix beside its box.
 *
 * The section used to hold nothing but difficulties, so every field got the
 * puzzle-duration readout. It now also holds free runs, a window and a surge
 * threshold, and the old blanket rule would have rendered a free run of 120 as
 * a puzzle taking eleven days — a number that is not wrong so much as about
 * something else entirely. `kind` comes from the registry (config/limits.js),
 * so a field added server-side is labelled correctly here without a client
 * release.
 */
function powSuffix(field, value) {
  const kind = field.kind || 'bits';
  if (kind === 'count') {
    return String(value) === '0' && field.key === 'rl_pow_surge_threshold'
      ? 'off'
      : 'requests';
  }
  if (kind === 'minutes') return 'minutes';
  return String(value) === '0' ? 'off' : `≈ ${powSeconds(value)}`;
}

/**
 * Roughly how long a puzzle takes, said in the unit the operator is choosing
 * in. Each bit doubles the expected hashes; a laptop does ~2 million
 * SHA-256s a second in a worker, a weak phone perhaps a tenth of that.
 */
function powSeconds(bits) {
  const b = Number(bits) || 0;
  if (b <= 0) return 'off';
  const hashes = 2 ** b;
  const laptop = hashes / 2_000_000;
  const phone = hashes / 200_000;
  const say = (s) => (s < 1 ? `${Math.max(1, Math.round(s * 1000))} ms` : s < 90 ? `${s.toFixed(s < 10 ? 1 : 0)} s` : `${Math.round(s / 60)} min`);
  return `${say(laptop)} laptop · ${say(phone)} phone`;
}

export default function AdminLimits() {
  const [schema, setSchema] = useState(null);
  const [values, setValues] = useState({});
  const [initial, setInitial] = useState({});
  /* ── A colleague got there first ──
   *
   * This page has the strongest case for a per-key choice of anywhere in the
   * console: a hundred and ninety-one independent numbers, where "keep my new
   * checkout budget, take their new login budget" is an entirely ordinary thing
   * to mean. Reloading would throw away every other value the operator had
   * typed in order to resolve one of them.
   *
   * Taking theirs moves the field AND the baseline, so the key stops being
   * dirty; keeping mine moves only the baseline, so it is still dirty and the
   * next Save carries it with one the server will accept. Neither writes.
   */
  const [conflicts, setConflicts] = useState([]);
  // Every limit this page is holding, so a colleague's change to one of them
  // says so at the moment it lands rather than when Save is refused.
  const watch = useSettingsWatch(useMemo(() => Object.keys(values), [values]));

  const takeTheirs = (c) => {
    setValues((cur) => ({ ...cur, [c.key]: c.theirs }));
    setInitial((cur) => ({ ...cur, [c.key]: c.theirs }));
    setConflicts((cur) => cur.filter((x) => x.key !== c.key));
  };

  const keepMine = (c) => {
    setInitial((cur) => ({ ...cur, [c.key]: c.theirs }));
    setConflicts((cur) => cur.filter((x) => x.key !== c.key));
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [view, setView] = useViewMode('limits', 'rows');
  // Which limiters have their hint open in the rows view. A Set rather than a
  // single open key: comparing two limiters means reading both.
  const [openHints, setOpenHints] = useState(() => new Set());

  /**
   * How many requests each limit has refused, and since when.
   *
   * Counted in the serving process rather than written down — see
   * `middleware/rateLimiters.js`: persisting a row per rejection would let
   * anybody who can trigger a 429 drive a database write, which turns the rate
   * limiter into a write amplifier for exactly the traffic it exists to stop.
   * So these reset on restart, and `since` is printed rather than implied.
   */
  const rejections = schema?.rejections?.counts || {};
  const rejectionsFor = (key) => Number(rejections[key]) || 0;
  const countsSince = schema?.rejections?.since
    ? new Date(schema.rejections.since).toLocaleString()
    : 'this process started';
  const rejectionTotal = Object.values(rejections).reduce((t, n) => t + (Number(n) || 0), 0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/settings/limits');
      setSchema(data);
      setValues({ ...data.values });
      setInitial({ ...data.values });
    } catch (err) {
      toast.error(err.message || 'Failed to load limits');
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const canEdit = schema?.can_edit !== false;

  // Identity strategies come from the server for the same reason the schema
  // does: a picker that offered a value the write-validation rejects would fail
  // only on save, after the operator had already made the choice.
  const identities = useMemo(() => schema?.identities || [], [schema]);

  /** Only what actually changed — see the note in the file header. */
  const dirtyKeys = useMemo(
    () => Object.keys(values).filter((k) => String(values[k]) !== String(initial[k])),
    [values, initial],
  );
  const dirtySet = useMemo(() => new Set(dirtyKeys), [dirtyKeys]);

  const specForKey = useMemo(() => {
    const map = {};
    if (!schema) return map;
    for (const g of schema.groups) {
      for (const l of g.limits) {
        map[l.max.key] = l.max;
        map[l.window.key] = l.window;
      }
    }
    for (const f of schema.unpaid.fields) if (f.type !== 'bool') map[f.key] = f;
    return map;
  }, [schema]);

  const invalidKeys = useMemo(
    () => dirtyKeys.filter((k) => {
      const spec = specForKey[k];
      if (!spec) return false;
      const n = Number(values[k]);
      return !Number.isFinite(n) || n < spec.min || n > spec.max;
    }),
    [dirtyKeys, specForKey, values],
  );

  const set = (key, v) => setValues((prev) => ({ ...prev, [key]: String(v) }));

  const toggleHint = (key) => setOpenHints((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  /**
   * Every limiter, flattened, with the derived state the toolbar filters on.
   *
   * Derived once here rather than per render inside the list: the filters, the
   * counts in the pills and the rows themselves all ask the same four
   * questions of every limiter, and computing them three times is how the two
   * halves of a filter end up disagreeing about what "off" means.
   */
  const entries = useMemo(() => {
    if (!schema) return [];
    const out = [];
    for (const group of schema.groups) {
      for (const limit of group.limits) {
        const on = String(values[limit.toggle.key]) === 'true';
        const identity = limit.identity
          ? (values[limit.identity.key] ?? limit.identity.default)
          : null;
        const keys = [limit.max.key, limit.window.key, limit.toggle.key]
          .concat(limit.identity ? [limit.identity.key] : []);
        out.push({
          group,
          limit,
          on,
          identity,
          isAddress: identity === 'address',
          dirty: keys.some((k) => dirtySet.has(k)),
          invalid: keys.some((k) => invalidKeys.includes(k)),
          pm: perMinute(values[limit.max.key], values[limit.window.key]),
          // The keys are searchable too: an operator reading a server log or a
          // migration has `rl_login_ip_max` in front of them, not "Login
          // attempts (per caller)".
          haystack: `${limit.label} ${limit.hint} ${group.label} ${keys.join(' ')}`.toLowerCase(),
        });
      }
    }
    return out;
  }, [schema, values, dirtySet, invalidKeys]);

  /**
   * The top of the shared scale for the bars.
   *
   * Taken over enforcing limiters only. A switched-off limiter has no ceiling
   * at all, and letting one define the scale would flatten every real limit on
   * the page against an infinity.
   */
  const ceiling = useMemo(() => {
    let top = 1;
    for (const e of entries) if (e.on && e.pm !== null && e.pm > top) top = e.pm;
    return top;
  }, [entries]);

  const counts = useMemo(() => ({
    all: entries.length,
    off: entries.filter((e) => !e.on).length,
    address: entries.filter((e) => e.isAddress && e.on).length,
    changed: entries.filter((e) => e.dirty).length,
  }), [entries]);

  // A filter that has emptied itself is not a filter the operator chose to be
  // in — pressing Save while "Unsaved" is selected would otherwise leave them
  // staring at a zero-results screen they never asked for.
  const activeFilter = filter === 'changed' && counts.changed === 0 ? 'all' : filter;
  const q = query.trim().toLowerCase();
  const isFiltered = activeFilter !== 'all' || q.length > 0;

  const visible = useMemo(() => entries.filter((e) => {
    if (activeFilter === 'off' && e.on) return false;
    if (activeFilter === 'address' && !(e.isAddress && e.on)) return false;
    if (activeFilter === 'changed' && !e.dirty) return false;
    if (q && !e.haystack.includes(q)) return false;
    return true;
  }), [entries, activeFilter, q]);

  /** Groups in registry order, carrying only the limiters that survived. */
  const visibleGroups = useMemo(() => {
    const byGroup = new Map();
    for (const e of visible) {
      if (!byGroup.has(e.group.key)) byGroup.set(e.group.key, { group: e.group, items: [] });
      byGroup.get(e.group.key).items.push(e);
    }
    return [...byGroup.values()];
  }, [visible]);

  // The unpaid block is not a limiter — it is enforced inside the checkout
  // transaction and by the background sweep, not by a middleware — so the
  // enforcing/address filters do not apply to it. It answers the search only.
  const unpaidMatches = useMemo(() => {
    if (!schema || activeFilter !== 'all') return false;
    if (!q) return true;
    const hay = `${schema.unpaid.label} ${schema.unpaid.hint} ${schema.unpaid.fields
      .map((f) => `${f.label} ${f.hint} ${f.key}`).join(' ')}`.toLowerCase();
    return hay.includes(q);
  }, [schema, activeFilter, q]);

  const save = async () => {
    if (dirtyKeys.length === 0) return;
    if (invalidKeys.length > 0) {
      return toast.error('Some values are out of range — fix them before saving.');
    }
    setSaving(true);
    try {
      const payload = {};
      for (const k of dirtyKeys) payload[k] = String(values[k]);
      // What this page was showing for each of those keys when it loaded. The
      // server refuses the save if any has moved since, rather than writing
      // over a colleague — this page holds a hundred and ninety-one settings,
      // which makes it the one most likely to be open in two browsers at once.
      // See utils/settingsDiff and the `__base` handling in settingsController.
      payload.__base = Object.fromEntries(dirtyKeys.map((k) => [k, String(initial[k] ?? '')]));
      await api.put('/settings', payload);
      setInitial({ ...values });
      toast.success(`Saved ${dirtyKeys.length} change${dirtyKeys.length === 1 ? '' : 's'} — in force immediately`);
    } catch (err) {
      reportSettingsError(err, load, setConflicts);
    }
    setSaving(false);
  };

  const revert = () => setValues({ ...initial });
  const clearFilters = () => { setQuery(''); setFilter('all'); };

  if (loading) {
    return (
      <div className="admin-page">
        <PageHeader icon={Gauge} title="Rate limits" subtitle="Loading…" />
        <div className="rl-skeletons">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="skeleton rl-skeleton" />)}
        </div>
      </div>
    );
  }

  if (!schema) {
    return (
      <div className="admin-page">
        <PageHeader icon={Gauge} title="Rate limits" />
        <div className="glass-card empty-state is-error">
          <ShieldAlert size={34} aria-hidden="true" />
          <h3>Could not load limits</h3>
          <p>
            The registry did not answer. The limiters currently in force are unaffected —
            they are read on the server, not from this page.
          </p>
          {/* §9: even the error state is navigation. Somewhere to go if the
              retry keeps failing. */}
          <div className="empty-state-links">
            <button className="glass-btn glass-btn-primary" onClick={load}>Retry</button>
            <Link className="glass-btn" to="/admin/settings">Store settings</Link>
            <Link className="glass-btn" to="/admin/audit-log">Audit log</Link>
          </div>
        </div>
      </div>
    );
  }

  const FILTERS = [
    { key: 'all', label: 'All limiters', n: counts.all, tone: null },
    { key: 'off', label: 'Switched off', n: counts.off, tone: 'danger' },
    { key: 'address', label: 'Address-keyed', n: counts.address, tone: 'warning' },
    ...(counts.changed > 0
      ? [{ key: 'changed', label: 'Unsaved', n: counts.changed, tone: null }]
      : []),
  ];

  // The state of the page, then what it has actually been doing. The second
  // half only appears once something has been refused, so a quiet shop reads
  // exactly as it did before — PageHeader asks for a live count, not a
  // description, and "0 turned away" is neither.
  const configured = counts.off > 0
    ? `${counts.all - counts.off} of ${counts.all} on · ${counts.off} switched off`
    : `All ${counts.all} on`;
  const subtitle = dirtyKeys.length > 0
    ? `${dirtyKeys.length} unsaved change${dirtyKeys.length === 1 ? '' : 's'}`
    : rejectionTotal > 0
      ? `${configured} · ${rejectionTotal.toLocaleString()} request${rejectionTotal === 1 ? '' : 's'} turned away since ${countsSince}`
      : configured;

  const rowsMode = view === 'rows';

  return (
    <div className="admin-page rl-page">
      {watch.stale.length > 0 && conflicts.length === 0 && (
        <div className="glass-card admin-panel-in scfl scfl-live" role="status">
          <p className="admin-hint">
            <ShieldAlert size={14} aria-hidden="true" />
            {' '}{watch.by ? `${watch.by} changed` : 'Somebody changed'}
            {' '}{watch.stale.length === 1 ? 'a limit' : `${watch.stale.length} limits`} just now:
            {' '}{watch.stale.map((k) => <code key={k} className="scfl-key">{k}</code>)}.
            {' '}Those are in force already — saving will be refused for them until you reload.
          </p>
          <div className="scfl-foot">
            <button type="button" className="glass-btn glass-btn-primary glass-btn-sm" onClick={() => { watch.clear(); load(); }}>
              Reload
            </button>
            <button type="button" className="glass-btn glass-btn-sm" onClick={watch.clear}>Dismiss</button>
          </div>
        </div>
      )}

      <SettingsConflict
        conflicts={conflicts}
        onTakeTheirs={takeTheirs}
        onKeepMine={keepMine}
        onReload={() => { setConflicts([]); load(); }}
        onDismiss={() => setConflicts([])}
      />

      <PageHeader icon={Gauge} title="Rate limits" subtitle={subtitle}>
        {/* A hundred and ninety-one settings, and the page with the least
            obvious consequences per switch: a budget set too tight fails
            buyers silently. `help-set-limits` is the paragraph this lands on. */}
        <AskAbout
          question="On the Rate limits page in the admin panel, what do the caps and windows control, what does keying a limit by address rather than by account change, and how do I tell whether one is set too tight?"
          title="Ask the assistant what the rate limits control"
        />
      </PageHeader>

      {!canEdit && (
        <div className="rl-note rl-note-warn">
          <Info size={15} aria-hidden="true" />
          <span>
            You can read these limits but not change them. Editing needs the{' '}
            <strong>settings.security</strong> permission.
          </span>
        </div>
      )}

      {/* ── Toolbar ───────────────────────────────────────────────────────
          The filters are the audit summary as well as the filter: "3 switched
          off" is the number an operator opens this page to check, and making
          it the control that shows those three saves the scroll that reading
          it would otherwise start. */}
      <div className="admin-toolbar is-sticky rl-toolbar">
        <div className="status-filter-row" role="group" aria-label="Filter limiters">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className={
                `status-filter-pill rl-pill${f.tone ? ` is-${f.tone}` : ''}` +
                (activeFilter === f.key ? ' active' : '')
              }
              aria-pressed={activeFilter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              <span className="status-filter-count">{f.n}</span>
            </button>
          ))}
        </div>

        <div className="admin-toolbar-group rl-toolbar-end">
          <div className="admin-search">
            <Search size={15} aria-hidden="true" />
            <input
              className="glass-input"
              type="search"
              placeholder="login, wallet, upload, rl_global_max…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search limiters"
            />
          </div>
          <ViewToggle
            value={view}
            onChange={setView}
            label="Limiter layout"
            cardsLabel="Detail"
            rowsLabel="Audit"
          />
        </div>
      </div>

      {isFiltered && (
        <div className="admin-filter-note">
          <span>
            Showing {visible.length} of {counts.all} limiters
            {q ? <> matching <strong>{query.trim()}</strong></> : null}.
          </span>
          <button type="button" className="glass-btn glass-btn-sm" onClick={clearFilters}>
            <FilterX size={13} aria-hidden="true" /> Clear
          </button>
        </div>
      )}

      {/* ── Unpaid orders ─────────────────────────────────────────────────
          Kept as a card while the limiters below are flat lists, and the
          difference is meaning rather than decoration: these three are not
          middleware. They are enforced inside the checkout transaction and by
          the background sweep, so they neither have a window nor appear on the
          shared budget scale. DESIGN §1 — one elevation for everything is how
          a page stops having a path through it. */}
      {unpaidMatches && (
        <section className="glass-card rl-unpaid" style={{ '--rl-i': 0 }}>
          <header className="rl-group-head">
            <h2 className="rl-group-title">{schema.unpaid.label}</h2>
            <p className="rl-group-hint">{schema.unpaid.hint}</p>
          </header>

          <div className="rl-unpaid-fields">
            {schema.unpaid.fields.map((f) => (
              f.type === 'bool' ? (
                <div key={f.key} className="rl-bool-row">
                  <Toggle
                    id={`t-${f.key}`}
                    checked={String(values[f.key]) === 'true'}
                    disabled={!canEdit}
                    onChange={(v) => set(f.key, v)}
                  />
                  <div className="rl-bool-text">
                    <label htmlFor={`t-${f.key}`} className="rl-bool-label">{f.label}</label>
                    <p className="rl-field-hint">{f.hint}</p>
                  </div>
                </div>
              ) : (
                <div key={f.key} className="rl-unpaid-field">
                  <NumField
                    id={`f-${f.key}`}
                    label={f.label}
                    value={values[f.key] ?? ''}
                    spec={f}
                    disabled={!canEdit}
                    onChange={(v) => set(f.key, v)}
                    suffix={String(values[f.key]) === '0' ? 'unlimited' : null}
                  />
                  <p className="rl-field-hint">{f.hint}</p>
                </div>
              )
            ))}
          </div>

          {/* §9: the sweep's timing is not set here, and an operator who came
              looking for it should leave with the address rather than a dead
              end. The hint above names those two settings; this is the link. */}
          <p className="rl-crosslink">
            <Settings2 size={14} aria-hidden="true" />
            How long an order waits before the sweep touches it is set by the payment
            windows on <Link to="/admin/settings">Store settings</Link>.
          </p>
        </section>
      )}

      {/* ── Proof of work ──
          Not a limiter either: a per-request CPU cost the browser pays. Drawn
          from the registry's own block, so a surface added server-side appears
          here without a client release. */}
      {schema.pow && (!query || `${schema.pow.label} ${schema.pow.hint} proof work puzzle cpu`.toLowerCase().includes(query.toLowerCase())) && (
        <section className="glass-card rl-unpaid rl-pow" style={{ '--rl-i': 1 }}>
          <header className="rl-group-head">
            <h2 className="rl-group-title">{schema.pow.label}</h2>
            <p className="rl-group-hint">{schema.pow.hint}</p>
          </header>
          {/* The ladder's own settings first, then the surfaces.
              Split because they are two different decisions: the ladder is one
              promise about worst-case latency made once, and the surfaces are
              per-door judgements about how much ordinary use looks like. A flat
              wall of twenty-nine numbers reads as one undifferentiated thing,
              and the number an operator most needs to get right — the ceiling —
              would be buried in the middle of it. Partitioned on `surface`,
              which the registry sets only on the per-door fields, so this needs
              no second list to keep in step. */}
          {[
            { title: 'The ladder', fields: schema.pow.fields.filter((f) => !f.surface) },
            { title: 'Per surface', fields: schema.pow.fields.filter((f) => f.surface) },
          ].filter((b) => b.fields.length > 0).map((block) => (
            <div key={block.title} className="rl-pow-block">
              <h3 className="rl-group-title rl-pow-block-title">{block.title}</h3>
              <div className="rl-unpaid-fields">
                {block.fields.map((f) => (
                  <div key={f.key} className="rl-unpaid-field">
                    <NumField
                      id={`f-${f.key}`}
                      label={f.label}
                      value={values[f.key] ?? ''}
                      spec={f}
                      disabled={!canEdit}
                      onChange={(v) => set(f.key, v)}
                      suffix={powSuffix(f, values[f.key])}
                    />
                    <p className="rl-field-hint">{f.hint}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* ── Limiters ──────────────────────────────────────────────────────
          Zero-results is a state this page can now reach, so it is drawn.
          §9: offer the way to widen the filter, not an apology. */}
      {visibleGroups.length === 0 && (
        <div className="glass-card empty-state rl-empty">
          <Search size={30} aria-hidden="true" />
          <h3>No limiter matches</h3>
          <p>
            {activeFilter === 'off'
              ? 'Every limiter in the registry is on — there is nothing switched off.'
              : activeFilter === 'address'
                ? 'No limiter is counted by network address. On a Tor-fronted store that is the reading you want.'
                : <>Nothing in the registry matches <strong>{query.trim()}</strong>.</>}
          </p>
          <div className="empty-state-links">
            <button type="button" className="glass-btn glass-btn-primary" onClick={clearFilters}>
              <FilterX size={14} aria-hidden="true" /> Show all {counts.all}
            </button>
            <Link className="glass-btn" to="/admin/settings">Store settings</Link>
          </div>
        </div>
      )}

      {visibleGroups.map(({ group, items }, gi) => (
        <section key={group.key} className="rl-group" style={{ '--rl-i': gi + 1 }}>
          <header className="rl-group-head">
            <h2 className="rl-group-title">
              {group.label}
              <span className="rl-group-count">{items.length}</span>
            </h2>
            <p className="rl-group-hint">{group.hint}</p>
          </header>

          {rowsMode ? (
            <div className="lrows rl-rows">
              {/* The last track is a stated width, not `auto`. Every `.lrow`
                  is its own grid and so is `.lrows-head`, so an `auto` track
                  resolves separately in each — the heading row, whose state
                  cell holds one word against the rows' pill-and-switch, would
                  size it narrow and shift every column label left of the
                  values underneath it. */}
              <div className="lrows-head">
                <span>Limiter</span>
                <span>Budget</span>
                <span>Requests</span>
                <span>Window</span>
                <span>Counted per</span>
                <span className="rl-col-state">State</span>
              </div>

              {items.map((e) => {
                const { limit, on } = e;
                const open = openHints.has(limit.key);
                return (
                  <div key={limit.key} className="rl-rowwrap">
                    <div
                      className={
                        `lrow rl-row${on ? '' : ' is-off'}${e.dirty ? ' is-dirty' : ''}`
                      }
                    >
                      <div className="lrow-stack rl-row-id">
                        <button
                          type="button"
                          className="rl-disclose"
                          aria-expanded={open}
                          aria-controls={`hint-${limit.key}`}
                          onClick={() => toggleHint(limit.key)}
                        >
                          <ChevronDown size={13} aria-hidden="true" className="rl-disclose-chev" />
                          <span className="lrow-text">{limit.label}</span>
                        </button>
                        {/* Not the rate sentence: the two inputs two columns
                            over already say "10" and "15", and the budget
                            column already says what they come to per minute.
                            Three restatements of one pair is chrome. The
                            settings key stem is the one fact about this row
                            that is nowhere else on screen, and it is what an
                            operator holding a server log or a migration has in
                            front of them instead of the label. */}
                        <small className="rl-row-key">{limit.max.key.replace(/_max$/, '_*')}</small>
                        {/* What this limit has actually turned away.
                            The page was configuration with no feedback: a
                            budget set too tight fails buyers silently, and the
                            only place that showed was a 429 nobody records.
                            Present only when non-zero — sixty rows reading "0
                            turned away" is a page whose reader learns to skim
                            it. The tooltip carries the window, because a bare
                            count reads as a lifetime total. */}
                        {rejectionsFor(limit.key) > 0 && (
                          <span
                            className="rl-row-hits"
                            title={`${rejectionsFor(limit.key)} request${rejectionsFor(limit.key) === 1 ? '' : 's'} refused by this limit since ${countsSince}. Counted in the serving process and reset when it restarts.`}
                          >
                            <ShieldAlert size={11} aria-hidden="true" />
                            {rejectionsFor(limit.key)} turned away
                          </span>
                        )}
                      </div>

                      <div className="rl-row-budget">
                        <RateBar pm={e.pm} ceiling={ceiling} off={!on} invalid={e.invalid} />
                        <span className="rl-row-rate lrow-num">
                          {on ? rateUnit(e.pm) : 'no cap'}
                        </span>
                      </div>

                      <NumField
                        id={`f-${limit.max.key}`}
                        label="Requests allowed"
                        srLabel={`${limit.label} — requests allowed`}
                        value={values[limit.max.key] ?? ''}
                        spec={limit.max}
                        disabled={!canEdit || !on}
                        onChange={(v) => set(limit.max.key, v)}
                        bare
                        cell="rl-cell-max"
                      />
                      <NumField
                        id={`f-${limit.window.key}`}
                        label="Window"
                        srLabel={`${limit.label} — window in minutes`}
                        value={values[limit.window.key] ?? ''}
                        spec={limit.window}
                        disabled={!canEdit || !on}
                        onChange={(v) => set(limit.window.key, v)}
                        suffix="min"
                        bare
                        cell="rl-cell-window"
                      />

                      {limit.identity && identities.length > 0 ? (
                        <IdentityField
                          id={`f-${limit.identity.key}`}
                          srLabel={`${limit.label} — counted per`}
                          value={e.identity}
                          options={identities}
                          disabled={!canEdit || !on}
                          onChange={(v) => set(limit.identity.key, v)}
                          bare
                          cell="rl-cell-identity"
                        />
                      ) : <span className="rl-cell-identity" />}

                      <div className="rl-row-state">
                        <StatePill on={on} />
                        <Toggle
                          id={`t-${limit.toggle.key}`}
                          checked={on}
                          disabled={!canEdit}
                          label={`${limit.label} — enforce`}
                          onChange={(v) => set(limit.toggle.key, v)}
                        />
                      </div>
                    </div>

                    {/* The paragraph the rows view trades away for density,
                        back on request. `hidden` rather than unmounted so the
                        aria-controls target always exists. */}
                    <div id={`hint-${limit.key}`} className="rl-rowhint" hidden={!open}>
                      <p>{limit.hint}</p>
                      {limit.identity && (
                        <p className="rl-rowhint-identity">
                          <strong>
                            {identities.find((o) => o.key === e.identity)?.label || e.identity}:
                          </strong>{' '}
                          {identities.find((o) => o.key === e.identity)?.hint}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rl-cards">
              {items.map((e) => {
                const { limit, on } = e;
                return (
                  <article
                    key={limit.key}
                    className={`rl-limit${on ? '' : ' is-off'}${e.dirty ? ' is-dirty' : ''}`}
                  >
                    <div className="rl-limit-head">
                      <div className="rl-limit-id">
                        <h3 className="rl-limit-title">{limit.label}</h3>
                        <p className="rl-field-hint">{limit.hint}</p>
                      </div>
                      <div className="rl-limit-switch">
                        <StatePill on={on} />
                        <Toggle
                          id={`t-${limit.toggle.key}`}
                          checked={on}
                          disabled={!canEdit}
                          label={`${limit.label} — enforce`}
                          onChange={(v) => set(limit.toggle.key, v)}
                        />
                      </div>
                    </div>

                    <div className="rl-limit-body">
                      <NumField
                        id={`c-${limit.max.key}`}
                        label="Requests allowed"
                        value={values[limit.max.key] ?? ''}
                        spec={limit.max}
                        disabled={!canEdit || !on}
                        onChange={(v) => set(limit.max.key, v)}
                      />
                      <NumField
                        id={`c-${limit.window.key}`}
                        label="Per window"
                        value={values[limit.window.key] ?? ''}
                        spec={limit.window}
                        disabled={!canEdit || !on}
                        onChange={(v) => set(limit.window.key, v)}
                        suffix="min"
                      />
                      <div className="rl-summary" aria-live="polite">
                        <span className="rl-summary-label">In force</span>
                        <span className="rl-summary-value">
                          {on
                            ? rateSentence(values[limit.max.key], values[limit.window.key])
                            : 'No limit'}
                        </span>
                        <RateBar pm={e.pm} ceiling={ceiling} off={!on} invalid={e.invalid} />
                        <span className="rl-summary-rate">
                          {on ? `${rateUnit(e.pm)} sustained` : 'unbounded'}
                        </span>
                      </div>
                      {limit.identity && identities.length > 0 && (
                        <IdentityField
                          id={`c-${limit.identity.key}`}
                          value={e.identity}
                          options={identities}
                          disabled={!canEdit || !on}
                          onChange={(v) => set(limit.identity.key, v)}
                        />
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      ))}

      {/* ── Where next ────────────────────────────────────────────────────
          §9: a page is not finished while its only outbound path is Back.
          These are the three places somebody goes straight from here — to the
          windows the unpaid sweep obeys, to check who last moved one of these
          numbers, and to the keys the integration budget is counted per. */}
      <nav className="rl-next" aria-label="Related settings">
        <Link className="rl-next-link" to="/admin/settings">
          <Settings2 size={15} aria-hidden="true" />
          <span><strong>Store settings</strong>Payment windows, checkout rules</span>
        </Link>
        <Link className="rl-next-link" to="/admin/audit-log">
          <ScrollText size={15} aria-hidden="true" />
          <span><strong>Audit log</strong>Who last changed a limit, and when</span>
        </Link>
        <Link className="rl-next-link" to="/admin/api-keys">
          <KeyRound size={15} aria-hidden="true" />
          <span><strong>API keys</strong>The inbound budget is counted per key</span>
        </Link>
        <Link className="rl-next-link" to="/admin/users">
          <Users size={15} aria-hidden="true" />
          <span><strong>Staff and permissions</strong>Who may edit this page</span>
        </Link>
      </nav>

      {/* ── The save bar ──────────────────────────────────────────────────
          Thirty-six limiters is a long page and the header scrolls away after
          the first group, so committing a value changed near the bottom used
          to mean scrolling back past every field you had just decided not to
          touch.

          The shared bar, not a copy: `blocked` refuses the save while any
          value sits outside its registry range, `note` says which of those two
          things is true, and `extra` carries the Review button that filters
          the list down to what is pending. No `cleanNote` — the page subtitle
          already reports the settled state, and it has to carry a count of
          what is enforcing anyway. */}
      {canEdit && (
        <SaveBar
          dirtyCount={dirtyKeys.length}
          saving={saving}
          onSave={save}
          onDiscard={revert}
          blocked={invalidKeys.length > 0}
          note={invalidKeys.length > 0
            ? `${invalidKeys.length} out of range — fix before saving`
            : 'In force the moment they are saved. No restart.'}
          extra={counts.changed > 0 && activeFilter !== 'changed' ? (
            <button
              type="button"
              className="glass-btn glass-btn-sm rl-savebar-review"
              onClick={() => setFilter('changed')}
            >
              Review
            </button>
          ) : null}
        />
      )}
    </div>
  );
}
