import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Wallet, Truck, X } from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { adminCapabilities } from '../../utils/adminPermissions';
import { SwapComposer, RefundComposer } from './OrderLineActions';
import { ORDER_CHANGED } from '../../utils/orderEvents';

export default function SupportOrderTools({ ticket, onChanged }) {
  const { user } = useAuth();
  const caps = adminCapabilities(user);
  const [order, setOrder] = useState(null);
  const [error, setError] = useState(null);
  const [action, setAction] = useState('');
  const [itemId, setItemId] = useState('');
  const [number, setNumber] = useState('');
  const [carrier, setCarrier] = useState('');
  const [box, setBox] = useState('');
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => api.get(`/orders/${ticket.order_id}`).then(o => { setOrder(o); setError(null); }).catch(e => setError(e.message));
  useEffect(() => { if (caps.viewOrders) load(); }, [ticket.order_id, caps.viewOrders]);
  const done = () => { setAction(''); setReview(false); load(); onChanged?.(); window.dispatchEvent(new Event(ORDER_CHANGED)); };
  const track = async (removeId) => {
    setBusy(true); setError(null);
    try {
      const data = await api.post(`/support/${ticket.id}/resolve-order`, { action: removeId ? 'remove_tracking' : 'tracking', tracking_id: removeId,
        fields: { tracking_number: number.trim(), carrier: carrier.trim(), box_id: box ? Number(box) : undefined } });
      done(); if (data.note_warning) setError(data.note_warning);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };
  if (!caps.viewOrders) return null;
  return <section className="glass-card flow-stack support-order-tools">
    <div><span className="flow-eyebrow">Resolve from this ticket</span><h3>Order tools</h3><p className="flow-note">Completed actions leave an internal ticket note and an order audit entry.</p></div>
    {error && <p className="flow-error" role="alert">{error}{!order && <button className="glass-btn glass-btn-sm" onClick={load}>Try again</button>}</p>}
    {!order && !error && <p role="status">Reading available actions…</p>}
    {order && <>
      {order.next_action && <p className="flow-note"><strong>{order.next_action.label}</strong><br />{order.next_action.reason}</p>}
      <div className="flow-actions">
        {order.item_actions?.can_swap && <button className="glass-btn glass-btn-sm" onClick={() => setAction('swap')}><ArrowLeftRight size={14} /> Replacement</button>}
        {order.item_actions?.can_refund_credit && <button className="glass-btn glass-btn-sm" onClick={() => setAction('credit')}><Wallet size={14} /> Refund to credit</button>}
        {caps.has('orders.tracking') && caps.has('orders.view_shipping') && <button className="glass-btn glass-btn-sm" onClick={() => { setAction('tracking'); setReview(false); }}><Truck size={14} /> Tracking</button>}
      </div>
      {action === 'swap' && <label className="flow-field"><span>Line to replace</span><select className="glass-input" value={itemId} onChange={e => setItemId(e.target.value)}><option value="">Choose an order line</option>{order.items.filter(i => i.quantity > (i.refunded_quantity || 0)).map(i => <option key={i.id} value={i.id}>{i.product_name} · {i.variant_name}</option>)}</select></label>}
      {action === 'swap' && itemId && <SwapComposer ticketId={ticket.id} order={order} item={order.items.find(i => String(i.id) === itemId)} onDone={() => { setItemId(''); done(); }} onCancel={() => { setAction(''); setItemId(''); }} />}
      {action === 'credit' && <RefundComposer ticketId={ticket.id} order={order} onDone={done} onCancel={() => setAction('')} />}
      {action === 'tracking' && <div className="flow-stack">
        {(order.tracking_numbers || []).map(t => <div key={t.id} className="flow-actions"><span className="flow-wrap">{t.carrier} · {t.tracking_number}</span><button className="glass-btn glass-btn-sm" disabled={busy} onClick={() => setReview({ removeId: t.id, label: t.tracking_number })}>Remove</button></div>)}
        <label className="flow-field"><span>Tracking number</span><input className="glass-input" value={number} onChange={e => { setNumber(e.target.value); setReview(false); }} /></label>
        <label className="flow-field"><span>Carrier</span><input className="glass-input" value={carrier} onChange={e => { setCarrier(e.target.value); setReview(false); }} /></label>
        <label className="flow-field"><span>Parcel</span><select className="glass-input" value={box} onChange={e => { setBox(e.target.value); setReview(false); }}><option value="">Order tracking</option>{(order.boxes || []).map(b => <option value={b.id} key={b.id}>Box {b.box_number}</option>)}</select></label>
        {review ? <div className="flow-review"><p>{review.removeId ? `Remove tracking ${review.label}?` : `Record ${number.trim()}${carrier.trim() ? ` with ${carrier.trim()}` : ''} for ${box ? `the selected box` : 'this order'}?`}</p><div className="flow-actions"><button className="glass-btn glass-btn-primary" disabled={busy} onClick={() => track(review.removeId)}>{busy ? 'Saving…' : 'Confirm tracking change'}</button><button className="glass-btn" disabled={busy} onClick={() => setReview(false)}>Back</button></div></div> : <button className="glass-btn" disabled={!number.trim() || busy} onClick={() => setReview(true)}>Review tracking</button>}
      </div>}
      {action && <button className="glass-btn glass-btn-sm" disabled={busy} onClick={() => { setAction(''); setItemId(''); }}><X size={14} /> Close tool</button>}
      <Link className="glass-btn glass-btn-sm" to={`/orders/${order.uuid}`}>Full order details</Link>
    </>}
  </section>;
}
