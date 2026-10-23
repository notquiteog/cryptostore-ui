import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BellRing } from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { ORDER_CHANGED } from '../../utils/orderEvents';

export default function AttentionOrders() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!user) return;
    let live = true;
    const load = () => api.get('/orders/attention').then(d => { if (live) { setData(d); setError(null); } })
      .catch(e => { if (live) setError(e.message); });
    load();
    const timer = setInterval(load, 60000);
    window.addEventListener(ORDER_CHANGED, load);
    return () => { live = false; clearInterval(timer); window.removeEventListener(ORDER_CHANGED, load); };
  }, [user?.id, retry]);
  if (!user || (!error && data?.total === 0)) return null;
  return <section className="glass-card flow-attention" aria-labelledby="attention-heading">
    <div className="flow-heading"><div><span className="flow-eyebrow"><BellRing size={14} /> Your next step</span><h2 id="attention-heading">Needs your attention{data?.total > 0 ? ` · ${data.total}` : ''}</h2></div><Link to="/orders" className="glass-btn glass-btn-sm">All orders</Link></div>
    {error ? <p role="status">{error} <button className="glass-btn glass-btn-sm" onClick={() => setRetry(n => n + 1)}>Try again</button></p>
      : !data ? <p className="flow-note" role="status">Checking your orders…</p>
        : <ul className="flow-list">{data.orders.slice(0, expanded ? undefined : 3).map(o => <li key={o.uuid}>
          <div><span className="flow-eyebrow">{o.uuid.slice(0, 8).toUpperCase()} · {new Date(o.created_at).toLocaleDateString()}</span><strong>{o.next_action.label}</strong><p>{o.next_action.reason}</p></div>
          <Link className="glass-btn" to={o.next_action.href}>Continue <ArrowRight size={14} /></Link>
        </li>)}</ul>}
    {data?.total > 3 && <button className="glass-btn glass-btn-sm" onClick={() => setExpanded(v => !v)}>{expanded ? 'Show fewer' : `Show all ${data.total}`}</button>}
  </section>;
}
