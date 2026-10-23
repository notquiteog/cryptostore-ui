import { useEffect, useRef, useState } from 'react';
import { CheckCircle, AlertTriangle, X } from 'lucide-react';
import { api } from '../../utils/api';

export default function BulkOrderReview({ request, onClose, onApplied }) {
  const dialog = useRef(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(null);
  const [current, setCurrent] = useState(request);
  const run = async (body, preview) => {
    setBusy(true); setError(null);
    try {
      const data = await api.post('/orders/bulk', { ...body, preview });
      if (!preview) {
        const omitted = (result?.items || []).filter(i => !body.orderUuids.includes(i.uuid));
        data.items = [...data.items, ...omitted]; data.failed += omitted.length;
      }
      setResult(data);
      if (!preview) onApplied(data);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { dialog.current?.showModal(); run(request, true); }, []);
  const ready = result?.items.filter(i => i.eligible) || [];
  const failed = result?.items.filter(i => !i.eligible) || [];
  const verb = current.action === 'cancel' || current.status === 'cancelled' ? 'Cancel orders' : `Mark ${current.status}`;
  return <dialog ref={dialog} className="flow-dialog" onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} aria-labelledby="bulk-review-title">
    <header className="flow-heading"><div><span className="flow-eyebrow">Bulk action</span><h2 id="bulk-review-title">{result && !result.preview ? 'Action results' : 'Review selected orders'}</h2><p>{verb} · {current.orderUuids.length} selected</p></div><button className="glass-btn flow-icon" disabled={busy} onClick={onClose} aria-label="Close review"><X size={18} /></button></header>
    <div className="flow-dialog-body">
      {error && <p className="flow-error" role="alert">{error}</p>}
      {!result && busy && <p role="status">Checking each order…</p>}
      {result && <><p className="flow-note">{result.preview ? `${ready.length} ready · ${failed.length} blocked. Orders are checked again when you apply.` : `${ready.length} updated · ${failed.length} not changed.`}</p><ul className="flow-list">{result.items.map(i => <li key={i.uuid}><span className={i.eligible ? 'flow-good' : 'flow-warn'}>{i.eligible ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}</span><div><strong>{i.uuid.slice(0, 8).toUpperCase()}</strong><p>{i.reason}</p></div><span className={`badge ${i.eligible ? 'badge-success' : 'badge-warning'}`}>{i.status}</span></li>)}</ul></>}
    </div>
    <footer className="flow-actions">
      {result?.preview && ready.length > 0 && <button className="glass-btn glass-btn-primary" disabled={busy} onClick={() => run({ ...current, orderUuids: ready.map(i => i.uuid) }, false)}>{busy ? 'Applying…' : `Apply to ${ready.length} ready orders`}</button>}
      {result && !result.preview && failed.length > 0 && <button className="glass-btn glass-btn-primary" disabled={busy} onClick={() => { const next = { ...current, orderUuids: failed.map(i => i.uuid) }; setCurrent(next); run(next, true); }}>Review failed orders again</button>}
      {error && <button className="glass-btn" disabled={busy} onClick={() => run(current, true)}>Refresh review</button>}
      <button className="glass-btn" disabled={busy} onClick={onClose}>{result && !result.preview ? 'Done' : 'Close'}</button>
    </footer>
  </dialog>;
}
