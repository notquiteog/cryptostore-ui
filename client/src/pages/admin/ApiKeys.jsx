import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import { Key, Plus, Trash2, Copy, KeyRound } from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';

export default function AdminApiKeys() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [createdKey, setCreatedKey] = useState(null);

  const fetchKeys = async () => {
    try {
      const data = await api.get('/admin/api-keys');
      setKeys(data);
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  };

  useEffect(() => { fetchKeys(); }, []);

  const createKey = async () => {
    if (!newLabel.trim()) return toast.error('Label is required');
    try {
      const data = await api.post('/admin/api-keys', { name: newLabel.trim() });
      setCreatedKey(data.key);
      setNewLabel('');
      fetchKeys();
      toast.success('API key created');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteKey = async (keyId) => {
    if (!confirm('Delete this API key? This cannot be undone.')) return;
    try {
      await api.delete(`/admin/api-keys/${keyId}`);
      toast.success('API key deleted');
      fetchKeys();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    /*
      The page was capped at `maxWidth: 700`, which DESIGN §1 names outright as
      an AI tell: a centred column with half a wide monitor left empty. Nothing
      here wanted the cap — a five-column key table and a usage note are not
      prose — and `.admin-page` already bounds the content to the admin column
      it sits in, so the cap only ever made the table narrower than the space
      it had. Removed rather than raised: there is no measure to preserve.
    */
    <div className="admin-page">
      <PageHeader
        icon={KeyRound}
        title="API keys"
        subtitle={keys.length === 0
          ? 'No keys issued. A key lets an external service talk to this store.'
          : `${keys.filter(k => k.active !== false).length} active of ${keys.length}`}
      >
        <button className="glass-btn glass-btn-primary" onClick={() => { setShowCreate(!showCreate); setCreatedKey(null); }}>
          <Plus size={16} aria-hidden="true" /> New key
        </button>
      </PageHeader>

      {/* The one and only sight of the secret. Tint composed from the theme's
          `--success-rgb` channel triple; the literals it replaces —
          `rgba(16, 185, 129, 0.1)` and a bare `1px solid var(--success)` — were
          a fossil green that no operator re-theme and no light mode could
          reach (DESIGN §11). */}
      {createdKey && (
        <div
          className="glass-card admin-panel-in"
          style={{
            marginBottom: 'var(--sp-6)',
            borderColor: 'rgba(var(--success-rgb), 0.4)',
            background: 'rgba(var(--success-rgb), 0.08)',
          }}
        >
          <h3 className="admin-card-title" style={{ color: 'var(--success)' }}>Key created</h3>
          <p className="admin-hint">
            Copy it now. The server keeps only a hash, so this is the last time it can be shown.
          </p>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
            {/* `.t-hash` is the ledger face with the dotted zero switched on —
                0 against O in a secret is a support ticket. It replaces an
                inline `fontFamily: 'monospace'`, which asked for whatever the
                platform had rather than the app's self-hosted face. */}
            <input className="glass-input t-hash" value={createdKey} readOnly aria-label="New API key" style={{ flex: 1, minWidth: 0 }} />
            <button className="glass-btn" onClick={() => copyToClipboard(createdKey)} aria-label="Copy the new API key">
              <Copy size={16} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="glass-card admin-panel-in" style={{ marginBottom: 'var(--sp-6)' }}>
          <h3 className="admin-card-title">Create New API Key</h3>
          <div className="form-group">
            <label htmlFor="apikey-label">Label</label>
            <input
              id="apikey-label"
              className="glass-input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Product Scraper"
              onKeyDown={(e) => e.key === 'Enter' && createKey()}
            />
          </div>
          <div className="admin-form-actions">
            <button className="glass-btn glass-btn-primary" onClick={createKey}><Key size={16} aria-hidden="true" /> Create</button>
            <button className="glass-btn" onClick={() => { setShowCreate(false); setCreatedKey(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {/*
        DESIGN §6: one responsive table. Not two views, not a toggle.

        Five columns, and a phone wants the same five in the same order — a
        label, the prefix that identifies the key, when it was minted, when it
        last spoke, and the one destructive control. No thumbnail, no progress
        bar, nothing that would earn a second hand-built mobile layout, so
        `.admin-rtable`'s row-becomes-a-card is the answer and every field
        survives the fold (§5).

        Two things had been quietly cancelling that. Every `<td>` carried an
        inline `fontSize`/`fontFamily`, and inline styles outrank a media
        query. Worse, the table was a direct child of `.table-container
        .glass-card`, and both `.table-container > table td` and
        `.glass-card > table td` in 07-layout.css are more specific than
        `.admin-rtable td` — so they kept winning *inside* the 720px block too,
        and the phone row-cards held their full desktop cell box. Wrapping the
        table in `.admin-table-scroll` breaks the direct-child match and gives
        the breakpoint something it can beat.
      */}
      {loading ? (
        <div className="glass-card" style={{ padding: 'var(--sp-4)' }} aria-busy="true" aria-label="Loading API keys">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="skeleton skeleton-row" />
          ))}
        </div>
      ) : keys.length === 0 ? (
        /* §9: an empty state is navigation, not an apology. "No API keys
           created yet" said nothing about what a key is for or where the two
           things that use one live. */
        <div className="glass-card empty-state">
          <Key size={34} aria-hidden="true" />
          <h3>No keys issued</h3>
          <p>
            A key is how something outside this box talks to it — the scrape endpoint,
            a stock feed, an importer. It is shown once and stored as a hash, so nothing
            here can be read back later.
          </p>
          <div className="empty-state-links">
            <button type="button" className="glass-btn glass-btn-sm" onClick={() => { setShowCreate(true); setCreatedKey(null); }}>
              <Plus size={13} aria-hidden="true" /> Issue the first key
            </button>
            <Link to="/admin/products" className="glass-btn glass-btn-sm">Catalog</Link>
            <Link to="/admin/audit-log" className="glass-btn glass-btn-sm">Audit log</Link>
          </div>
        </div>
      ) : (
        <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="admin-table-scroll">
            <table className="admin-rtable rtable-skin">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Key Preview</th>
                  <th>Created</th>
                  <th>Last Used</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id}>
                    {/* Weight, not an inline font-weight: the label is the one
                        field an operator scans for, and `<strong>` says so in
                        the markup as well as in the pixels. */}
                    <td data-label="Label"><strong>{k.name}</strong></td>
                    <td data-label="Key" className="ail-code">{k.key_prefix ? `${k.key_prefix}…` : '••••'}</td>
                    <td data-label="Created" className="ail-dim t-num">{new Date(k.created_at).toLocaleDateString()}</td>
                    {/* "Never" is the answer that matters here — a key issued
                        months ago and never used is one to delete — so it is
                        said in words rather than left as an em dash. */}
                    <td data-label="Last used" className="ail-dim t-num">
                      {k.last_used_at ? new Date(k.last_used_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td data-actions="">
                      <button
                        type="button"
                        className="glass-btn glass-btn-danger glass-btn-sm"
                        onClick={() => deleteKey(k.id)}
                        aria-label={`Delete the API key “${k.name}”`}
                      >
                        <Trash2 size={14} aria-hidden="true" /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="glass-card" style={{ marginTop: 'var(--sp-6)' }}>
        <h4 className="admin-card-title">Usage</h4>
        <p className="admin-hint" style={{ marginBottom: 0 }}>
          Send the key in the <code className="text-primary t-hash">x-api-key</code> header
          with requests to <code className="text-primary t-hash">POST /api/products/scrape</code>.
          Every call is attributed to the key it arrived on, so revoking one here stops
          exactly that caller and nothing else.
        </p>
        {/* These keys write the catalog. The feed only reads it, and it is
            deliberately a different secret — see routes/api.js. Said here
            because this is the page an operator lands on when they go looking
            for "the API key for letting someone read our products", and
            handing them one of these would give that stranger the ingest
            endpoint as well. */}
        <p className="admin-hint" style={{ marginBottom: 0, marginTop: 'var(--sp-3)' }}>
          These keys <strong>write</strong> this catalog. Letting someone else <em>read</em> it —
          the outgoing feed at <code className="text-primary t-hash">GET /api/products/scrape</code>,
          in the same format this store imports — is switched on separately under
          Settings → Product import, with its own key. Do not hand one of these out for that.
        </p>
      </div>
    </div>
  );
}
