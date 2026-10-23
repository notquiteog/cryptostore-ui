import { useState } from 'react';
import { Bell, ArrowLeftRight, Trash2 } from 'lucide-react';
import { api } from '../../utils/api';
import { useCart } from '../../context/CartContext';
const money = n => `$${Number(n || 0).toFixed(2)}`;

export default function CartRecovery({ item }) {
  const { fetchCart, removeItem, updateQuantity } = useCart();
  const [options, setOptions] = useState(null);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [watching, setWatching] = useState(false);
  const run = async fn => { setBusy(true); setMessage(null); try { await fn(); } catch (e) { setMessage(e.message); } finally { setBusy(false); } };
  const choice = options?.find(o => String(o.variant_id) === selected);
  return <div className="cart-recovery">
    <p className="flow-warn">{item.available === false ? 'This item is unavailable.' : `Only ${item.stock} available; your cart holds ${item.quantity}.`} Choose a replacement or remove it to continue.</p>
    <div className="flow-actions">
      {item.available !== false && Number(item.stock) > 0 && <button className="glass-btn glass-btn-sm" disabled={busy} onClick={() => run(() => updateQuantity(item.id, Number(item.stock)))}>Keep {item.stock}</button>}
      <button className="glass-btn glass-btn-sm" disabled={busy} onClick={() => run(async () => { const d = await api.get(`/orders/cart/${item.id}/options`); setOptions(d.options); })}><ArrowLeftRight size={14} /> Choose another size</button>
      {item.available !== false && <button className="glass-btn glass-btn-sm" disabled={busy || watching} onClick={() => run(async () => { await api.post(`/moderation/restock/${item.variant_id}`); setWatching(true); setMessage('Restock alert saved. You can remove this item and continue.'); })}><Bell size={14} /> {watching ? 'Alert saved' : 'Notify me'}</button>}
      <button className="glass-btn glass-btn-sm" disabled={busy} onClick={() => run(() => removeItem(item.id))}><Trash2 size={14} /> Remove and continue</button>
    </div>
    {options && <div className="flow-stack">{options.length ? <><label className="flow-field"><span>Available sizes</span><select className="glass-input" value={selected} disabled={busy} onChange={e => setSelected(e.target.value)}><option value="">Choose a size</option>{options.map(o => <option key={o.variant_id} value={o.variant_id}>{o.quantity} × {o.name} · {money(o.price)} each</option>)}</select></label>{choice && <div className="flow-actions"><p>New cart total <strong>{money(choice.total)}</strong> · includes {money(choice.shipping)} shipping, before checkout discounts.</p><button className="glass-btn glass-btn-primary" disabled={busy} onClick={() => run(async () => { await api.post(`/orders/cart/${item.id}/replace`, { variant_id: choice.variant_id, quantity: choice.quantity }); await fetchCart(); })}>Replace with {choice.quantity} × {choice.name}</button></div>}</> : <p>No other sizes are available right now.</p>}</div>}
    {message && <p role="status" className="flow-note">{message}</p>}
  </div>;
}
