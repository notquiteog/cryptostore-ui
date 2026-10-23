import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, List } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../utils/api';
import { readOrderQueue, writeOrderQueue } from '../../utils/orderQueue';

export default function OrderQueueNav({ orderRef }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [queue, setQueue] = useState(() => readOrderQueue(user?.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const index = queue?.ids.indexOf(orderRef) ?? -1;
  if (index < 0) return null;
  const absolute = (queue.page - 1) * queue.limit + index + 1;
  const move = async direction => {
    setError(null);
    const next = queue.ids[index + direction];
    if (next) { navigate(`/orders/${next}`); return; }
    setBusy(true);
    try {
      const page = queue.page + direction;
      // Staff-only (rendered under `isStaffViewer` in OrderDetail) and it
      // walks the shop's queue, so it asks for that scope by name.
      const data = await api.get(`/orders?scope=all&${new URLSearchParams({ ...queue.filters, page, limit: queue.limit })}`);
      if (!data.orders.length) { setError('The queue changed. Return to the queue to refresh it.'); return; }
      const updated = { ...queue, page, total: data.total, ids: data.orders.map(o => o.uuid) };
      writeOrderQueue(user.id, updated); setQueue(updated);
      // The order list already restores this shift state; advancing a page in
      // the detail view must update it too, or Back would open the old page.
      try { const state = JSON.parse(sessionStorage.getItem('cs.admin-orders.queue.v1') || '{}'); sessionStorage.setItem('cs.admin-orders.queue.v1', JSON.stringify({ ...state, page, scrollY: 0 })); } catch {}
      navigate(`/orders/${direction > 0 ? updated.ids[0] : updated.ids.at(-1)}`);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  return <nav className="glass-card flow-queue-nav" aria-label="Filtered order queue">
    <Link className="glass-btn glass-btn-sm" to={`/admin/orders?queueReturn=${encodeURIComponent(orderRef)}`}><List size={16} /> Back to queue</Link>
    <span>Order <strong>{absolute}</strong> of {queue.total}<small>Within your filtered results</small></span>
    <div className="flow-actions"><button className="glass-btn" disabled={busy || absolute <= 1} onClick={() => move(-1)}><ChevronLeft size={16} /> Previous</button><button className="glass-btn" disabled={busy || absolute >= queue.total} onClick={() => move(1)}>Next <ChevronRight size={16} /></button></div>
    {error && <p className="flow-error" role="status">{error}</p>}
  </nav>;
}
