import { Fragment, useState, useEffect } from 'react';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import { Award, Plus, X, Trash2, Edit2, Save, Info } from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import { headStartLabel } from '../../utils/headStart';
import NextStops from '../../components/admin/NextStops';

const thStyle = {
  padding: 'var(--sp-3) var(--sp-4)',
  textAlign: 'left',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const tdStyle = {
  padding: 'var(--sp-3) var(--sp-4)',
  borderBottom: '1px solid var(--border)',
  fontSize: 'var(--fs-base)',
  verticalAlign: 'middle',
};

const EMPTY_TIER = {
  name: '',
  discount_pct: '',
  description: '',
  color: '#6366f1',
  min_orders: '0',
  min_spend_30d: '0',
  early_access_minutes: '0',
};

/**
 * The ceiling the API clamps to (30 days in minutes), mirrored here only to set
 * the input's `max`. The server clamps regardless — a `max` attribute is a hint
 * to the operator, never the enforcement.
 */
const MAX_EARLY_ACCESS_MINUTES = 43200;

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * "1h 30m" — a head start in the units an operator thinks in, or null for none.
 *
 * The shared formatter, so this table, the product editor's per-tier go-live
 * table and the storefront's membership ladder all spell one number the same
 * way — two spellings of "1440 minutes" side by side is a needless moment of
 * "is that the same thing?".
 */
const offsetLabel = headStartLabel;

function ColorDot({ color, size = 14 }) {
  return (
    <span style={{
      display: 'inline-block',
      width: size,
      height: size,
      borderRadius: '50%',
      background: color || '#6366f1',
      border: '2px solid rgba(var(--tint-rgb), 0.15)',
      flexShrink: 0,
    }} />
  );
}

export default function Tiers() {
  const [tiers, setTiers] = useState([]);
  const [windowDays, setWindowDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newTier, setNewTier] = useState({ ...EMPTY_TIER });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editData, setEditData] = useState({});

  // Accounts pinned to a tier by hand, across every tier. Summed once rather
  // than twice inline: the subtitle needs the number and then needs to know
  // whether to pluralise it.
  const pinnedTotal = tiers.reduce((n, t) => n + Number(t.pinned_user_count || 0), 0);

  const fetchTiers = async () => {
    setLoading(true);
    try {
      const data = await api.get('/tiers');
      setTiers(data.tiers || data || []);
      if (data.window_days) setWindowDays(data.window_days);
    } catch (err) {
      toast.error(err.message || 'Failed to load tiers');
    }
    setLoading(false);
  };

  useEffect(() => { fetchTiers(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTier.name.trim()) return toast.error('Name is required');
    const disc = parseFloat(newTier.discount_pct);
    if (isNaN(disc) || disc < 0 || disc > 100) return toast.error('Discount must be between 0 and 100');
    setCreating(true);
    try {
      await api.post('/tiers', {
        ...newTier,
        discount_pct: disc,
        min_orders: parseInt(newTier.min_orders, 10) || 0,
        min_spend_30d: parseFloat(newTier.min_spend_30d) || 0,
        // Sent as a number, not the raw input string: the API rejects anything
        // Number() cannot read, and an empty field means "no head start".
        early_access_minutes: parseInt(newTier.early_access_minutes, 10) || 0,
      });
      toast.success('Tier created');
      setShowCreate(false);
      setNewTier({ ...EMPTY_TIER });
      fetchTiers();
    } catch (err) {
      toast.error(err.message || 'Failed to create tier');
    }
    setCreating(false);
  };

  const deleteTier = async (tier) => {
    if (!confirm(`Delete tier "${tier.name}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/tiers/${tier.id}`);
      toast.success('Tier deleted');
      fetchTiers();
    } catch (err) {
      // Surface 409 / "users assigned" error clearly
      toast.error(err.message || 'Failed to delete tier');
    }
  };

  const startEdit = (tier) => {
    setEditing(tier.id);
    setEditData({
      name: tier.name || '',
      discount_pct: String(tier.discount_pct ?? ''),
      description: tier.description || '',
      color: tier.color || '#6366f1',
      min_orders: String(tier.min_orders ?? '0'),
      min_spend_30d: String(tier.min_spend_30d ?? '0'),
      early_access_minutes: String(tier.early_access_minutes ?? '0'),
    });
  };

  const cancelEdit = () => { setEditing(null); setEditData({}); };

  const saveEdit = async (id) => {
    const disc = parseFloat(editData.discount_pct);
    if (isNaN(disc) || disc < 0 || disc > 100) return toast.error('Discount must be between 0 and 100');
    try {
      await api.put(`/tiers/${id}`, {
        ...editData,
        discount_pct: disc,
        min_orders: parseInt(editData.min_orders, 10) || 0,
        min_spend_30d: parseFloat(editData.min_spend_30d) || 0,
        early_access_minutes: parseInt(editData.early_access_minutes, 10) || 0,
      });
      toast.success('Tier updated');
      setEditing(null);
      fetchTiers();
    } catch (err) {
      toast.error(err.message || 'Failed to save tier');
    }
  };

  const nf = (key, label, type = 'text', extra = {}) => (
    <div className="form-group">
      <label>{label}</label>
      <input
        className="glass-input"
        type={type}
        value={newTier[key]}
        onChange={(e) => setNewTier((p) => ({ ...p, [key]: e.target.value }))}
        {...extra}
      />
    </div>
  );

  const ef = (key, label, type = 'text', extra = {}) => (
    <div className="form-group">
      <label>{label}</label>
      <input
        className="glass-input"
        type={type}
        value={editData[key]}
        onChange={(e) => setEditData((p) => ({ ...p, [key]: e.target.value }))}
        {...extra}
      />
    </div>
  );

  return (
    <div className="admin-page">
      <PageHeader
        icon={Award}
        title="Customer tiers"
        subtitle={tiers.length === 0
          ? 'No tiers configured.'
          : `${tiers.length} tier${tiers.length === 1 ? '' : 's'} · ${pinnedTotal} pinned account${pinnedTotal === 1 ? '' : 's'}`}
      >
        <button
          className="glass-btn glass-btn-primary"
          onClick={() => setShowCreate((v) => !v)}
        >
          {showCreate ? <X size={15} /> : <Plus size={15} />}
          {showCreate ? 'Cancel' : 'Add tier'}
        </button>
      </PageHeader>

      {/* Info banner */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-25)',
        padding: 'var(--sp-3) var(--sp-4)',
        borderRadius: 'var(--radius)',
        background: 'rgba(99,102,241,0.08)',
        border: '1px solid rgba(99,102,241,0.25)',
        marginBottom: 'var(--sp-6)',
        fontSize: 'var(--fs-base)',
        color: 'var(--text-secondary)',
      }}>
        <Info size={15} style={{ color: 'var(--primary)', flexShrink: 0 }} />
        <span>
          Tiers are earned automatically: a customer holds the highest tier whose spend
          threshold they have reached over the last <strong>{windowDays} days</strong>, counting
          paid, accepted, shipped and delivered orders. The window rolls, so a tier lapses on its
          own once those orders age out. To override that for one account, pin it from the Users page.
          {' '}
          <strong>Drop head start</strong> is how far ahead of a scheduled product's go-live this
          tier can already see and buy it — set once here, and every scheduled product inherits it.
        </span>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="glass-card" style={{ marginBottom: 'var(--sp-6)' }}>
          <h3 style={{ marginBottom: 'var(--sp-5)', fontSize: 'var(--fs-md)', fontWeight: 600 }}>New Tier</h3>
          <form onSubmit={handleCreate}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))', gap: '0 1rem' }}>
              {nf('name', 'Name', 'text', { placeholder: 'e.g. Gold', required: true })}
              {nf('discount_pct', 'Discount %', 'number', { min: 0, max: 100, step: 0.01, placeholder: '10' })}
              {nf('min_spend_30d', `Spend in ${windowDays}d to earn ($)`, 'number', { min: 0, step: '0.01', placeholder: '250' })}
              {nf('early_access_minutes', 'Drop head start (min)', 'number', {
                min: 0, max: MAX_EARLY_ACCESS_MINUTES, step: 1, placeholder: '0',
                title: 'How many minutes before a scheduled product goes live this tier can already see and buy it. 0 means no head start.',
              })}

              {/* Color picker */}
              <div className="form-group">
                <label>Badge Color</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-25)' }}>
                  <input
                    type="color"
                    value={newTier.color}
                    onChange={(e) => setNewTier((p) => ({ ...p, color: e.target.value }))}
                    style={{ width: 40, height: 34, padding: 2, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
                  />
                  <input
                    className="glass-input"
                    value={newTier.color}
                    onChange={(e) => setNewTier((p) => ({ ...p, color: e.target.value }))}
                    placeholder="#6366f1"
                    style={{ fontFamily: 'monospace', fontSize: 'var(--fs-base)' }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                <label>Description</label>
                <input
                  className="glass-input"
                  value={newTier.description}
                  onChange={(e) => setNewTier((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Short description shown to customers"
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--sp-3)', marginTop: 'var(--sp-1)' }}>
              <button type="submit" className="glass-btn glass-btn-primary" disabled={creating}>
                {creating ? <span className="spinner" style={{ width: 16, height: 16 }} /> : 'Create Tier'}
              </button>
              <button type="button" className="glass-btn" onClick={() => { setShowCreate(false); setNewTier({ ...EMPTY_TIER }); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-16)' }}>
            <div className="spinner" style={{ width: 36, height: 36 }} />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="admin-rtable" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 40 }}></th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Discount %</th>
                  <th style={thStyle}>Earned at ({windowDays}d spend)</th>
                  <th style={thStyle} title="Head start on scheduled product drops.">Drop head start</th>
                  <th style={thStyle}>Pinned</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {tiers.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-secondary)', padding: 'var(--sp-12)' }}>
                      No tiers yet.
                    </td>
                  </tr>
                ) : tiers.map((t) => (
                  <Fragment key={t.id}>
                    <tr>
                      <td data-label="Colour" style={{ ...tdStyle, textAlign: 'center' }}>
                        <ColorDot color={t.color} size={16} />
                      </td>
                      <td data-label="Name" style={{ ...tdStyle, fontWeight: 600 }}>
                        <span style={{ color: t.color || 'var(--text)' }}>{t.name}</span>
                        {t.description && (
                          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', fontWeight: 400, marginTop: 'var(--sp-05)' }}>
                            {t.description}
                          </div>
                        )}
                      </td>
                      <td data-label="Discount" style={{ ...tdStyle, fontWeight: 600, color: 'var(--success)' }}>
                        {t.discount_pct != null ? `${t.discount_pct}%` : '—'}
                      </td>
                      <td data-label="Earned at" style={{ ...tdStyle, fontWeight: 600, fontFeatureSettings: '"tnum"' }}>
                        {Number(t.min_spend_30d) > 0
                          ? money(t.min_spend_30d)
                          : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>entry tier</span>}
                      </td>
                      <td data-label="Drop head start" style={{ ...tdStyle, fontWeight: 600, fontFeatureSettings: '"tnum"' }}>
                        {offsetLabel(t.early_access_minutes)
                          ? <span style={{ color: 'var(--accent)' }}>{offsetLabel(t.early_access_minutes)} early</span>
                          : <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>no head start</span>}
                      </td>
                      <td data-label="Pinned" style={{ ...tdStyle, color: 'var(--text-secondary)' }}
                          title="Accounts an admin pinned to this tier. Everyone else is derived from spend.">
                        {t.pinned_user_count || 0}
                      </td>
                      <td data-actions="" style={tdStyle}>
                        <div style={{ display: 'flex', gap: 'var(--sp-15)' }}>
                          {editing === t.id ? (
                            <>
                              <button className="glass-btn glass-btn-primary glass-btn-sm" onClick={() => saveEdit(t.id)}>
                                <Save size={13} /> Save
                              </button>
                              <button className="glass-btn glass-btn-sm" onClick={cancelEdit}>
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <>
                              <button className="glass-btn glass-btn-sm" onClick={() => startEdit(t)}>
                                <Edit2 size={13} /> Edit
                              </button>
                              <button
                                className="glass-btn glass-btn-sm"
                                onClick={() => deleteTier(t)}
                                style={{ color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.3)' }}
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Inline edit row */}
                    {editing === t.id && (
                      <tr key={`edit-${t.id}`}>
                        <td colSpan={7} style={{ padding: 0, borderBottom: '1px solid var(--border)' }}>
                          <div style={{
                            padding: 'var(--sp-5)',
                            background: 'var(--bg-glow-1, rgba(99,102,241,0.04))',
                            borderTop: '2px solid var(--primary)',
                          }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(190px, 100%), 1fr))', gap: '0 1rem' }}>
                              {ef('name', 'Name', 'text', { placeholder: 'e.g. Gold' })}
                              {ef('discount_pct', 'Discount %', 'number', { min: 0, max: 100, step: 0.01 })}
                              {ef('min_spend_30d', `Spend in ${windowDays}d to earn ($)`, 'number', { min: 0, step: '0.01' })}
                              {ef('early_access_minutes', 'Drop head start (min)', 'number', {
                                min: 0, max: MAX_EARLY_ACCESS_MINUTES, step: 1,
                                title: 'How many minutes before a scheduled product goes live this tier can already see and buy it. 0 means no head start.',
                              })}

                              <div className="form-group">
                                <label>Badge Color</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-25)' }}>
                                  <input
                                    type="color"
                                    value={editData.color || '#6366f1'}
                                    onChange={(e) => setEditData((p) => ({ ...p, color: e.target.value }))}
                                    style={{ width: 40, height: 34, padding: 2, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
                                  />
                                  <input
                                    className="glass-input"
                                    value={editData.color}
                                    onChange={(e) => setEditData((p) => ({ ...p, color: e.target.value }))}
                                    style={{ fontFamily: 'monospace', fontSize: 'var(--fs-base)' }}
                                  />
                                </div>
                              </div>

                              <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                                <label>Description</label>
                                <input
                                  className="glass-input"
                                  value={editData.description}
                                  onChange={(e) => setEditData((p) => ({ ...p, description: e.target.value }))}
                                />
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <NextStops route="/admin/tiers" />
    </div>
  );
}
