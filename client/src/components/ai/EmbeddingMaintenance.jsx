import { useState } from 'react';
import { Database, RefreshCw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../utils/api';

export default function EmbeddingMaintenance({ onChange }) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState('');
  async function run(action) {
    setBusy(true);
    try {
      const result = await api.post(`/ai/index/${action}`, {});
      const text = action === 'reset'
        ? `Reset complete. Removed ${result.collectionsRemoved} collections. Search indexes rebuild while semantic search is enabled; saved notes are indexed when their owner next uses memory.`
        : result.skipped ? result.reason : `Indexed ${result.embedded} items.${result.done ? ' The public index is up to date.' : ' Background indexing will continue.'}`;
      setMessage(text); setConfirming(false); await onChange?.();
    } catch (err) { toast.error(err.message || 'The index could not be updated'); }
    finally { setBusy(false); }
  }
  return <section className="glass-card">
    <h2><Database size={16} /> Embedding maintenance</h2>
    <p className="ai-hint">Rebuild search after changing embedding models, or reset this shop&apos;s entire vector index. Products, reviews, store pages and saved assistant notes are preserved.</p>
    <div className="aic-confirm-actions">
      <button type="button" className="glass-btn glass-btn-sm" disabled={busy} onClick={() => run('rebuild')}><RefreshCw size={14} /> {busy ? 'Working…' : 'Index next batch'}</button>
      <button type="button" className="glass-btn glass-btn-sm" disabled={busy} onClick={() => setConfirming(true)}><Trash2 size={14} /> Reset embeddings database</button>
    </div>
    {confirming && <div className="aic-confirm" role="group" aria-label="Confirm embedding reset">
      <p>This removes all of this shop&apos;s search and personal memory vectors. Ordinary text search stays available while the indexes rebuild. Other applications&apos; collections are preserved.</p>
      <div className="aic-confirm-actions">
        <button type="button" className="glass-btn glass-btn-sm glass-btn-danger" disabled={busy} onClick={() => run('reset')}>Reset this shop&apos;s embeddings</button>
        <button type="button" className="glass-btn glass-btn-sm" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </div>}
    {message && <p className="ai-hint" role="status">{message}</p>}
  </section>;
}
