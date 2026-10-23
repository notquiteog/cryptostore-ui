import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Bird, RefreshCw, PenLine, Coins, Clock, Link2, AlertTriangle, CircleCheck,
  Radio, ExternalLink, History, User, Timer, ShieldAlert,
} from 'lucide-react';
import { api } from '../../utils/api';
import { changedWithBase } from '../../utils/settingsDiff';
import { reportSettingsError } from '../../utils/settingsConflict';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import NextStops from '../../components/admin/NextStops';

/**
 * The warrant canary, from the operator's side.
 *
 * ── What this page has to make impossible to misunderstand ──────────────────
 *
 * A canary is a human's affirmation, and its silence is the signal. The store
 * can re-sign it on a schedule — but only from a BUDGET the operator tops up
 * by hand, and at zero it lapses rather than renewing. This page draws that
 * budget as the row of renewals it is, spends one visibly each time the timer
 * signs, and puts the reason a signing would refuse in the largest type on
 * the screen. A canary page that read like a settings form would hide the
 * one number that keeps it honest.
 *
 * ── The three things on it ──────────────────────────────────────────────────
 *
 *   state    fresh / due / stale / lapsed / never / off, with the next-due
 *            time and the last chain stamps — what a reader sees.
 *   budget   the renewals, as tokens; the timer spends them, Sign now does
 *            not (a human affirming it is exactly what the budget requires).
 *   history  every issue ever signed, by whom, with what budget left.
 *
 * Settings (statement, interval, budget, require-chain) save through the
 * ordinary settings PUT, validated by server/config/canaryKeys.js.
 */

const STATE = {
  off:    { label: 'Off',    tone: 'is-quiet', text: 'The canary is switched off. Nothing is published.' },
  never:  { label: 'Never issued', tone: 'is-warn', text: 'The canary is on but nothing has been signed yet. Sign the first one by hand.' },
  fresh:  { label: 'Fresh',  tone: 'is-ok',   text: 'The current statement is within its interval.' },
  due:    { label: 'Due',    tone: 'is-warn', text: 'Past its next-due time. The timer will renew it on its next tick if it can.' },
  stale:  { label: 'Stale',  tone: 'is-bad',  text: 'More than one interval past due. Readers are told to treat the statement as withdrawn.' },
  lapsed: { label: 'Lapsed', tone: 'is-bad',  text: 'The renewal budget ran out. It will not renew until you top it up — that is the design.' },
};

const fmt = (v) => (v ? new Date(v).toLocaleString() : '—');
const until = (v) => {
  if (!v) return null;
  const ms = new Date(v).getTime() - Date.now();
  const h = Math.round(Math.abs(ms) / 3600000);
  const word = h >= 48 ? `${Math.round(h / 24)} days` : `${h} h`;
  return ms >= 0 ? `in ${word}` : `${word} ago`;
};

export default function Canary() {
  const [st, setSt] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [signing, setSigning] = useState(false);
  const [probe, setProbe] = useState(null);
  const [probing, setProbing] = useState(false);
  // The editable copy of the four settings, separate from what is stored so
  // the page can say what has changed.
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get('/canary/status');
      setSt(data);
      setForm({
        enabled: data.enabled,
        statement: data.statement,
        intervalHours: data.intervalHours,
        budget: data.budget,
        requireChain: data.requireChain,
      });
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load the canary');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => st && form && (
    form.enabled !== st.enabled || form.statement !== st.statement
    || Number(form.intervalHours) !== st.intervalHours || Number(form.budget) !== st.budget
    || form.requireChain !== st.requireChain
  ), [st, form]);

  const save = async () => {
    setSaving(true);
    try {
      // Only the fields this operator moved. Five keys is not two hundred, but
      // the statement is the one field on this page somebody is most likely to
      // be mid-edit on in another tab — and writing back a stale copy of a
      // warrant canary's text is the worst version of this bug in the console.
      // See utils/settingsDiff.
      const next = {
        canary_enabled: form.enabled ? 'true' : 'false',
        canary_statement: form.statement,
        canary_interval_hours: String(form.intervalHours),
        canary_budget: String(form.budget),
        canary_require_chain: form.requireChain ? 'true' : 'false',
      };
      const changes = changedWithBase(next, {
        canary_enabled: st.enabled ? 'true' : 'false',
        canary_statement: st.statement,
        canary_interval_hours: String(st.intervalHours),
        canary_budget: String(st.budget),
        canary_require_chain: st.requireChain ? 'true' : 'false',
      });
      if (!changes) {
        setSaving(false);
        return toast('Nothing to save');
      }
      await api.put('/settings', changes);
      toast.success('Canary settings saved');
      await load();
    } catch (err) {
      reportSettingsError(err, load);
    } finally {
      setSaving(false);
    }
  };

  const signNow = async () => {
    setSigning(true);
    try {
      const res = await api.post('/canary/issue');
      const reach = res.tips.filter((t) => t.reachable).length;
      toast.success(`Signed. ${reach} of ${res.tips.length} chain${res.tips.length === 1 ? '' : 's'} stamped; next due ${fmt(res.issue.next_due_at)}.`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not sign');
    } finally {
      setSigning(false);
    }
  };

  const probeChains = async () => {
    setProbing(true);
    try { setProbe(await api.get('/canary/chains')); } catch (err) { toast.error(err.message); } finally { setProbing(false); }
  };

  if (error) {
    return (
      <div className="admin-page can-page">
        <div className="glass-card pull-empty"><AlertTriangle size={22} aria-hidden="true" /><p>{error}</p></div>
      </div>
    );
  }
  if (!st || !form) return <div className="admin-page can-page"><div className="pkq-skel" /></div>;

  const state = STATE[st.state] || STATE.off;
  const budgetMax = Math.max(st.budget, Number(form.budget) || 0, 8);

  return (
    <div className="admin-page can-page">
      <PageHeader
        icon={Bird}
        title="Warrant canary"
        subtitle={st.enabled
          ? `${state.label}${st.last ? ` · next due ${until(st.last.next_due_at)}` : ''} · ${st.budget} renewal${st.budget === 1 ? '' : 's'} in the budget`
          : 'Off — a statement you affirm, re-signed on a schedule from a budget only you can top up'}
      >
        <a href="/canary.txt" target="_blank" rel="noopener noreferrer" className="glass-btn glass-btn-sm" title="The signed block, as a visitor fetches it">
          <ExternalLink size={14} aria-hidden="true" /> canary.txt
        </a>
        <Link to="/canary" className="glass-btn glass-btn-sm">Public page</Link>
        <button type="button" className="glass-btn glass-btn-sm" onClick={load}>
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
        <AskAbout
          question="What is the warrant canary on this store, what do its statement, interval and renewal budget do, and what happens if it is not renewed?"
          title="Ask the assistant about the warrant canary"
        />
      </PageHeader>

      {/* ── The state, loud ── */}
      <section className={`glass-card can-state ${state.tone}`} aria-live="polite">
        <div className="can-state-main">
          <span className="can-state-label">{state.label}</span>
          <p className="can-state-text">{state.text}</p>
          {st.last && (
            <dl className="can-state-facts">
              <div><dt>Last signed</dt><dd>{fmt(st.last.issued_at)} · {st.last.issued_by ? 'by hand' : 'by the timer'}</dd></div>
              <div><dt>Next due</dt><dd>{fmt(st.last.next_due_at)} <em>({until(st.last.next_due_at)})</em></dd></div>
              <div>
                <dt>Chains stamped</dt>
                <dd>
                  {st.last.chains.length === 0 ? 'none enabled' : st.last.chains.map((c) => (
                    <span key={c.coin} className={`can-chain${c.reachable ? '' : ' is-down'}`} title={c.reachable ? c.hash : c.error}>
                      {c.coin.toUpperCase()} {c.reachable ? `#${c.height}` : 'unreachable'}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
          )}
        </div>
        {st.blocker && st.enabled && (
          <p className="can-blocker" role="alert">
            <ShieldAlert size={16} aria-hidden="true" />
            <span><strong>The next automatic signing would refuse:</strong> {st.blocker}</span>
          </p>
        )}
        {st.last_tick?.at && st.last_tick.result !== 'signed' && st.enabled && (
          <p className="can-tick">
            <Timer size={13} aria-hidden="true" />
            The timer last tried at {fmt(st.last_tick.at)} and did not sign: {st.last_tick.result}
          </p>
        )}
      </section>

      <div className="can-grid">
        {/* ── The budget ── */}
        <section className="glass-card can-card">
          <h3><Coins size={15} aria-hidden="true" /> Renewal budget</h3>
          <p className="can-lede">
            Each automatic signing spends one. At zero the canary lapses instead of renewing, and only
            you can top it up — that is what makes a timer-signed canary still a canary. Signing by hand
            never spends one.
          </p>
          <div className="can-tokens" role="img" aria-label={`${form.budget} renewals in the budget`}>
            {Array.from({ length: budgetMax }, (_, i) => (
              <span key={i} className={`can-token${i < Number(form.budget) ? ' is-live' : ''}${i < st.budget && i >= Number(form.budget) ? ' is-spending' : ''}`} style={{ '--i': i }} />
            ))}
          </div>
          <div className="can-budget-row">
            <label htmlFor="can-budget">Renewals</label>
            <input id="can-budget" className="glass-input can-num" type="number" min="0" max="365" value={form.budget}
              onChange={(e) => setForm({ ...form, budget: e.target.value })} />
            <span className="can-budget-hint">
              × {form.intervalHours} h = about {Math.round((Number(form.budget) || 0) * Number(form.intervalHours) / 24)} days of renewals without you
            </span>
          </div>
        </section>

        {/* ── The schedule ── */}
        <section className="glass-card can-card">
          <h3><Clock size={15} aria-hidden="true" /> Schedule</h3>
          <div className="can-field">
            <label htmlFor="can-interval">Re-sign every</label>
            <span className="can-inline">
              <input id="can-interval" className="glass-input can-num" type="number" min="1" max="720" value={form.intervalHours}
                onChange={(e) => setForm({ ...form, intervalHours: e.target.value })} />
              <span>hours</span>
              <span className="can-presets">
                {[[24, 'daily'], [168, 'weekly'], [336, 'fortnightly'], [720, 'monthly']].map(([h, l]) => (
                  <button key={h} type="button" className={`can-preset${Number(form.intervalHours) === h ? ' is-on' : ''}`} onClick={() => setForm({ ...form, intervalHours: h })}>{l}</button>
                ))}
              </span>
            </span>
          </div>
          <label className="can-switch">
            <input type="checkbox" checked={form.requireChain} onChange={(e) => setForm({ ...form, requireChain: e.target.checked })} />
            <span>Refuse to auto-sign when no chain can be reached. A canary whose freshness proof is "unknown" is not fresh.</span>
          </label>
          <label className="can-switch">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            <span><strong>Publish the canary.</strong> Off, nothing is served at /canary.txt.</span>
          </label>
          {!st.can_sign && (
            <p className="can-warn"><AlertTriangle size={13} aria-hidden="true" /> {st.fingerprint ? 'The store key cannot sign unattended: ' : ''}{st.blocker || 'No signing key.'} <Link to="/admin/pgp">PGP Key page</Link></p>
          )}
        </section>
      </div>

      {/* ── The statement ── */}
      <section className="glass-card can-card">
        <h3><PenLine size={15} aria-hidden="true" /> The statement</h3>
        <p className="can-lede">
          Your words, signed verbatim. The store appends the structured block — issue time, next due,
          the store key, and the tip height and hash of every enabled chain — so a reader can prove the
          signature happened after a block nobody could have predicted. Nothing about the budget, or
          whether the timer or you signed, is published: that is your routine, and it stays on this page.
        </p>
        <textarea
          className="glass-input can-statement"
          rows={8}
          value={form.statement}
          onChange={(e) => setForm({ ...form, statement: e.target.value })}
          spellCheck="true"
        />
        <div className="can-actions">
          <button type="button" className="glass-btn glass-btn-sm glass-btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : dirty ? 'Save settings' : 'Saved'}
          </button>
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={signNow}
            disabled={signing || !st.enabled || !st.can_sign || dirty}
            title={dirty ? 'Save first — the signature covers the stored statement'
              : !st.enabled ? 'Turn the canary on and save first'
                : !st.can_sign ? st.blocker
                  : 'Sign the statement now, by hand. Does not spend the budget; resets the next-due clock.'}
          >
            <PenLine size={13} aria-hidden="true" /> {signing ? 'Signing…' : 'Sign now'}
          </button>
          <button type="button" className="glass-btn glass-btn-sm" onClick={probeChains} disabled={probing} title="Read every enabled chain's tip now, without signing">
            <Radio size={13} aria-hidden="true" /> {probing ? 'Reading…' : 'Read chain tips'}
          </button>
        </div>
        {probe && (
          <ul className="can-probe">
            {probe.tips.length === 0 && <li>No coin is enabled, so a signing would carry no chain stamp.</li>}
            {probe.tips.map((t) => (
              <li key={t.coin} className={t.reachable ? '' : 'is-down'}>
                {t.reachable ? <CircleCheck size={13} aria-hidden="true" /> : <AlertTriangle size={13} aria-hidden="true" />}
                <b>{t.coin.toUpperCase()}</b> {t.reachable ? <>height {t.height} · <code>{t.hash}</code></> : <>unreachable — {t.error}</>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── History ── */}
      <section className="glass-card can-card">
        <h3><History size={15} aria-hidden="true" /> Every issue</h3>
        {st.history.length === 0 ? (
          <p className="can-lede">Nothing signed yet.</p>
        ) : (
          <ul className="can-history">
            {st.history.map((h) => (
              <li key={h.id}>
                <span className="can-h-when">{fmt(h.issued_at)}</span>
                <span className="can-h-by">{h.issued_by ? <><User size={11} aria-hidden="true" /> by hand</> : <><Timer size={11} aria-hidden="true" /> timer</>}</span>
                <span className="can-h-chains">
                  {h.chains.length === 0 ? 'no chains' : h.chains.map((c) => (
                    <span key={c.coin} className={`can-chain${c.reachable ? '' : ' is-down'}`}>{c.coin.toUpperCase()}{c.reachable ? ` #${c.height}` : ' ✕'}</span>
                  ))}
                </span>
                <span className="can-h-budget">{h.budget_after} left</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="pull-foot">
        <Link2 size={12} aria-hidden="true" /> Readers verify with <code>gpg --verify canary.txt</code> against the store key on the{' '}
        <Link to="/admin/pgp">PGP Key page</Link>. The risk board carries a row for this canary and goes critical when it is stale.
      </p>
      <NextStops route="/admin/canary" />
    </div>
  );
}
