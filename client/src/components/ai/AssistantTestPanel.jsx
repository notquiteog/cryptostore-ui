import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';

export default function AssistantTestPanel() {
  const [questions, setQuestions] = useState([]);
  const [question, setQuestion] = useState('');
  const [expected, setExpected] = useState('');
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const stop = useRef(false);
  useEffect(() => {
    api.get('/ai/test-questions').then((r) => { setQuestions(r.questions); setQuestion(r.questions[0] || ''); }).catch(() => {});
    return () => { stop.current = true; };
  }, []);
  const run = async () => {
    stop.current = false;
    setRunning(true); setResults([]);
    for (let i = 0; i < 10 && !stop.current; i++) {
      try {
        const result = await api.post('/ai/test', { question, expected });
        if (stop.current) break;
        setResults((r) => [...r, result]);
      } catch (e) {
        setResults((r) => [...r, { pass: false, error: e.message }]);
        // A rate limit or failed connection is actionable; ten automatic
        // retries would spend more resources without testing answer quality.
        break;
      }
    }
    setRunning(false);
  };
  const passed = results.filter((r) => r.pass).length;
  return <section className="glass-card ai-section">
    <h3>Test the assistant</h3>
    <p className="ai-hint">Run a question ten times through the buyer’s answer service using your account and consent settings. Checks cover required topics and cards; inspect the replies for accuracy. Store facts are identified separately from model answers. Rate limits and the daily budget still apply.</p>
    <label htmlFor="ai-test-example">Example question</label>
    <select id="ai-test-example" className="glass-input" value={questions.includes(question) ? question : ''} onChange={(e) => setQuestion(e.target.value)} disabled={running}>
      <option value="">Custom question</option>{questions.map((q) => <option key={q}>{q}</option>)}
    </select>
    <label htmlFor="ai-test-question">Question</label>
    <textarea id="ai-test-question" className="glass-input" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} disabled={running} />
    <label htmlFor="ai-test-expected">Required words or phrases (optional, comma separated)</label>
    <input id="ai-test-expected" className="glass-input" value={expected} onChange={(e) => setExpected(e.target.value)} maxLength={500} disabled={running} />
    <div className="ai-actions">
      <button className="glass-btn glass-btn-primary" type="button" onClick={run} disabled={running || !question.trim()}>Run 10 checks</button>
      {running && <button className="glass-btn" type="button" onClick={() => { stop.current = true; }}>Stop after this run</button>}
      <Link className="glass-btn" to="/profile#ai-assistant">Your AI consent settings</Link>
    </div>
    {results.length > 0 && <p role="status">{passed}/{results.length} checks passed{results.length === 10 ? passed >= 9 ? ' · 9/10 target met' : ' · below the 9/10 target' : ' · incomplete'}</p>}
    {results.map((r, i) => <details key={i} className="ai-test-result">
      {/* Provenance, because "why did it say that?" starts with whether the
          shop looked it up or a model wrote it. `topic` names the registry
          entry that answered (server/services/ai/topics); `tools` names any
          action the turn actually took, which is the one thing about an answer
          that changed something. */}
      <summary>
        Run {i + 1} · {r.pass ? 'passed' : 'needs attention'} · {r.source === 'store' ? 'live store facts' : 'model'}
        {r.topic && <> · <code>{r.topic}</code></>}
        {r.tools?.length > 0 && <> · called {r.tools.map((t) => <code key={t}>{t}</code>).reduce((a, b) => [a, ', ', b])}</>}
      </summary>
      <p style={{ whiteSpace: 'pre-wrap' }}>{r.error || r.text}</p>
      {/* What actually broke, which the buyer-facing sentence above cannot
          say. `POST /ai/test` asks the assistant for it (`explainFailures`)
          because this panel is behind `settings.security` and exists to
          diagnose — the alternative was an operator reading "stopped part way
          through" ten times and having to find the server log to learn that
          the model server had answered 400 and what it said. */}
      {r.detail && <p className="ai-hint" style={{ whiteSpace: 'pre-wrap' }}><strong>Cause:</strong> {r.detail}</p>}
      <ul>{r.checks?.map((c) => <li key={c.label}>{c.ok ? 'Passed' : 'Failed'}: {c.label}</li>)}</ul>
      <div className="buddy-cards">{r.products?.map((p) => <Link className="buddy-card" key={p.id} to={`/products/${p.id}`}>{p.name}</Link>)}{r.actions?.map((c) => <Link className="buddy-card" key={c.id} to={c.href}>{c.title}</Link>)}</div>
    </details>)}
  </section>;
}
