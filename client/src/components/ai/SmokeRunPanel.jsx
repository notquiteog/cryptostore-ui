import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Play, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';

/**
 * The assistant's nightly checks: what the last run found, and a button to run one now.
 *
 * ── Why this is a second panel and not a bigger test panel ─────────────────
 *
 * `AssistantTestPanel` above it answers "does this one question work right
 * now, ten times". This answers "did anything that worked yesterday stop
 * working" — the whole list, on a schedule, with the difference kept. They
 * share the question list and the assessor (`services/ai/evaluation.js`) and
 * nothing else, and putting both in one card would make the manual ten-shot
 * look like a setting of the scheduled run, which it is not.
 *
 * ── What it shows and does not ─────────────────────────────────────────────
 *
 * Pass, fail, which checks by label, which topic answered, and which topics
 * the list never reaches. Never the answers: the run asks as a named staff
 * account and the answers are that account's cart and orders. The server
 * does not store them (see the migration), so there is nothing here to show,
 * which is the point.
 */
export default function SmokeRunPanel() {
  const [status, setStatus] = useState(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try { setStatus(await api.get('/ai/smoke')); } catch { /* the page's other tiles say why */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  // A run is minutes of model calls; the panel polls while one is going and
  // stops the moment it is not.
  useEffect(() => {
    if (!status?.running) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [status?.running, load]);

  const run = async () => {
    setStarting(true);
    try {
      await api.post('/ai/smoke/run');
      toast.success('Run started — it takes a few minutes.');
      setTimeout(load, 1500);
    } catch (err) {
      toast.error(err.message || 'Could not start the run');
    } finally {
      setStarting(false);
    }
  };

  const last = status?.last;
  return (
    <section className="glass-card ai-section ai-smoke" data-search-target="ai-smoke-runs">
      <h3>Assistant checks</h3>
      <p className="ai-hint">
        The whole test-question list, asked as the account named under &ldquo;Keeping it honest&rdquo; &mdash;
        the buyer questions as that account, the staff questions with its own permissions &mdash;
        with only the pass or fail of each check recorded, never the answers. A question that
        passed last time and fails now is a regression, and lights a lamp on the Risk Board.
      </p>
      {status && (
        <>
          <p className="ai-smoke-state">
            {status.enabled
              ? `Runs every day at ${String(status.hour).padStart(2, '0')}:00 server time`
              : 'The daily run is off'}
            {status.account ? `, as ${status.account}.` : ' — and no account is named to run as.'}
          </p>
          <div className="ai-smoke-tools">
            <button type="button" className="glass-btn glass-btn-sm" onClick={run} disabled={starting || status.running || !status.account}>
              {status.running
                ? <><span className="spinner spinner-inline" aria-hidden="true" /> Running…</>
                : <><Play size={13} aria-hidden="true" /> Run now</>}
            </button>
            <button type="button" className="glass-btn glass-btn-sm" onClick={load}>
              <RefreshCw size={13} aria-hidden="true" /> Refresh
            </button>
          </div>
          {last ? <LastRun last={last} /> : <p className="ai-hint">No run has happened yet.</p>}
        </>
      )}
    </section>
  );
}

function LastRun({ last }) {
  const when = new Date(last.ran_at).toLocaleString();
  if (last.status !== 'ok') {
    return (
      <p className="ai-hint ai-hint-warn">
        <AlertTriangle size={13} aria-hidden="true" /> {when}: the run could not finish — {last.reason}
      </p>
    );
  }
  const regressions = Array.isArray(last.regressions) ? last.regressions : [];
  const results = Array.isArray(last.results) ? last.results : [];
  return (
    <div className="ai-smoke-last">
      <p>
        {when} ({last.trigger}): <b>{last.passed} passed</b>, {last.failed} failed
        {regressions.length ? <>, <b className="is-regressed">{regressions.length} regressed</b></> : ''}.
      </p>
      {regressions.length > 0 && (
        <ul className="ai-smoke-list is-regressed">
          {regressions.map((r) => (
            <li key={`${r.audience || 'buyer'}:${r.question}`}>
              <XCircle size={12} aria-hidden="true" /> {r.audience === 'staff' ? <em>staff · </em> : null}{r.question}
              {r.failed?.length > 0 && <small> — {r.failed.join(' · ')}</small>}
            </li>
          ))}
        </ul>
      )}
      <details className="ai-smoke-all">
        <summary>Every question</summary>
        <ul className="ai-smoke-list">
          {results.map((r) => {
            const failed = (r.checks || []).filter((c) => !c.ok).map((c) => c.label);
            return (
              <li key={`${r.audience || 'buyer'}:${r.question}`} className={r.pass ? 'is-pass' : 'is-fail'}>
                {r.pass ? <CheckCircle2 size={12} aria-hidden="true" /> : <XCircle size={12} aria-hidden="true" />}
                {' '}{r.audience === 'staff' ? <em>staff · </em> : null}{r.question}
                <small>
                  {r.topic ? ` — answered by ${r.topic}` : r.source === 'model' ? ' — model answer' : ''}
                  {failed.length ? ` — failed: ${failed.join('; ')}` : ''}
                </small>
              </li>
            );
          })}
        </ul>
      </details>
      {last.coverage && (
        <p className="ai-hint">
          {last.coverage.exercised?.length ?? 0} of {last.coverage.total}
          {' '}{(last.coverage.audiences || ['buyer']).join(' and ')} topics were reached.
          {last.coverage.untouched?.length
            ? ` Never reached by this list: ${last.coverage.untouched.join(', ')}.`
            : ' Every topic was reached.'}
        </p>
      )}
      <p className="ai-hint">Regressions also appear on the <Link to="/admin/risk">Risk Board</Link>.</p>
    </div>
  );
}
