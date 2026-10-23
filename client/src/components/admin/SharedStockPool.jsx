import { useEffect, useState } from 'react';
import { Boxes, RefreshCw } from 'lucide-react';
import { api } from '../../utils/api';
import { packsFrom, unitsFor, formatUnits } from '../../utils/stockUnits';

// Base units arrive from the API as NUMERIC — a STRING, not a number, since
// pack sizes became fractional (a "3.5g" variant takes 3.5 out of a jar of
// grams). Two consequences this file has to respect, because both fail quietly:
// `"1000.000".toLocaleString()` is the untouched string rather than "1,000",
// and `a / b` on raw values is float division whose floor can disagree with the
// server's by one pack. Everything numeric here therefore goes through
// utils/stockUnits, which scales to integer thousandths exactly as
// services/inventory.js does on the other side.
const asNumber = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const withCommas = (v) => formatUnits(v).replace(/\B(?=(\d{3})+(?!\d))/, ',');

export default function SharedStockPool({ variantId, mode, quantity, bin }) {
  const [pool, setPool] = useState(null);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setPool(null); setError(null);
    api.get(`/stock/variants/${variantId}/pool`).then(d => { if (live) { setPool(d.pool); setError(null); } }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [variantId, tick]);
  if (error) return <p className="flow-error">{error} <button type="button" className="glass-btn glass-btn-sm" onClick={() => setTick(n => n + 1)}>Try again</button></p>;
  if (!pool) return null;
  const input = Number(quantity);
  // Packs are counted and received whole even when a pack takes a fraction of a
  // base unit, so this stays an integer check.
  const preview = !!mode && quantity !== '' && quantity != null && Number.isInteger(input) && input >= (mode === 'receive' ? 1 : 0);
  const shelf = String(bin || '').trim();
  const poolUnits = asNumber(pool.stock_quantity);
  const expected = shelf
    ? Number((pool.locations || []).find(loc => loc.bin_location === shelf)?.quantity || 0)
    : packsFrom(poolUnits, pool.stock_units);
  const delta = preview ? (mode === 'receive' ? unitsFor(input, pool.stock_units) : unitsFor(input - expected, pool.stock_units)) : 0;
  const after = Math.max(0, poolUnits + delta);
  return <section className={`flow-pool flow-stack${preview ? ' is-projecting' : ''}`} aria-label="Shared stock and demand">
    <div className="flow-heading"><div><span className="flow-eyebrow"><Boxes size={14} /> Shared stock · saved inventory</span><h4>{pool.name}</h4></div><button type="button" className="glass-btn flow-icon" onClick={() => setTick(n => n + 1)} aria-label="Refresh shared stock"><RefreshCw size={14} /></button></div>
    <div className="flow-pool-stats"><div><strong>{withCommas(poolUnits)}</strong><span>base units available</span></div><div><strong>{withCommas(pool.reserved_units)}</strong><span>reserved on open orders</span></div><div><strong>{pool.pending_counts}</strong><span>counts awaiting approval</span></div></div>
    <p className="flow-note">All sizes draw from this same balance. Availability below shows each size on its own; the quantities cannot be added together. Reserved units have already left the available balance.</p>
    {preview && <p className="flow-review" role="status">{mode === 'receive' ? `Receiving ${input} packs adds ${formatUnits(delta)} base units.` : `Counting ${input} packs adjusts the pool by ${delta > 0 ? '+' : ''}${formatUnits(delta)} base units; any remainder is preserved.`} Projected balance: <strong>{withCommas(after)}</strong>.</p>}
    <div className="flow-table-wrap"><table className="flow-table"><thead><tr><th>Pack size</th><th>Available{preview ? ' → after' : ''}</th><th>Open orders</th><th>Watching</th></tr></thead><tbody>{pool.variants.map(v => <tr key={v.id}><th scope="row">{v.name}<small>{formatUnits(v.stock_units)} base units{v.bin_location ? ` · ${v.bin_location}` : ''}{!v.active ? ' · inactive' : ''}</small></th><td>{packsFrom(poolUnits, v.stock_units)}{preview && <> → <strong>{packsFrom(after, v.stock_units)}</strong></>}</td><td>{Number(v.pending_packs)} packs</td><td>{Number(v.watchers)}</td></tr>)}</tbody></table></div>
  </section>;
}
