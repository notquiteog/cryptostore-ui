import ProgressBar from '../../components/ProgressBar';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { adminCapabilities } from '../../utils/adminPermissions';
import { LimitFields } from '../../components/RecipientLimits';
import RecipientPool from '../../components/RecipientPool';
import toast from 'react-hot-toast';
import { Plus, Save, X, Landmark, Mail, Phone, AlertTriangle } from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import NextStops from '../../components/admin/NextStops';

const EMPTY = {
  label: '', recipient_name: '', recipient_handle: '', handle_type: 'email',
  bank_name: '', instructions: '', active: true,
  daily_limit: '', monthly_limit: '', lifetime_limit: '',
};

function AccountForm({ data, setData, onSubmit, onCancel, submitLabel, busy }) {
  return (
    <div className="glass-card" style={{ marginBottom: 'var(--sp-6)' }}>
      <div className="form-row">
        <div className="form-group">
          <label>Label</label>
          <input className="glass-input" value={data.label || ''}
            onChange={(e) => setData({ ...data, label: e.target.value })}
            placeholder="Internal name, e.g. Primary" />
        </div>
        <div className="form-group">
          <label>Active</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', cursor: 'pointer', marginTop: 'var(--sp-1)' }}>
            <input type="checkbox" checked={data.active !== false}
              onChange={(e) => setData({ ...data, active: e.target.checked })}
              style={{ accentColor: 'var(--primary)' }} />
            {data.active !== false ? 'In rotation' : 'Out of rotation'}
          </label>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Recipient name</label>
          <input className="glass-input" value={data.recipient_name || ''}
            onChange={(e) => setData({ ...data, recipient_name: e.target.value })}
            placeholder="Name on the account" />
          <small style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-2xs)' }}>
            Shown to the buyer so they can confirm they are paying the right person.
          </small>
        </div>
        <div className="form-group">
          <label>Handle type</label>
          <select className="glass-input" value={data.handle_type || 'email'}
            onChange={(e) => setData({ ...data, handle_type: e.target.value })}>
            <option value="email">Email</option>
            <option value="phone">Phone</option>
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Zelle {data.handle_type === 'phone' ? 'phone number' : 'email address'}</label>
          <input className="glass-input" value={data.recipient_handle || ''}
            onChange={(e) => setData({ ...data, recipient_handle: e.target.value })}
            placeholder={data.handle_type === 'phone' ? '+1 555 123 4567' : 'name@example.com'} />
        </div>
        <div className="form-group">
          <label>Bank name (optional)</label>
          <input className="glass-input" value={data.bank_name || ''}
            onChange={(e) => setData({ ...data, bank_name: e.target.value })}
            placeholder="Helps the buyer recognise the transfer" />
        </div>
      </div>

      <div className="form-group">
        <label>Instructions (optional)</label>
        <textarea className="glass-input" rows={2} value={data.instructions || ''}
          onChange={(e) => setData({ ...data, instructions: e.target.value })}
          placeholder="Shown to the buyer alongside the payment details" />
      </div>

      <LimitFields data={data} setData={setData} />

      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-4)' }}>
        <button className="glass-btn glass-btn-primary" onClick={onSubmit} disabled={busy}>
          <Save size={16} /> {busy ? 'Saving…' : submitLabel}
        </button>
        <button className="glass-btn" onClick={onCancel}><X size={16} /> Cancel</button>
      </div>
    </div>
  );
}

/** One Zelle account, read for display. See `components/RecipientPool.jsx`. */
function describeAccount(account) {
  return {
    id: account.id,
    title: account.label || account.recipient_name,
    // The name on the account is not decoration: it is what the buyer is asked
    // to check before sending money that cannot be pulled back, so it stays
    // under the label in both views rather than being an expandable detail.
    sub: account.recipient_name,
    where: account.recipient_handle,
    whereIcon: account.handle_type === 'phone'
      ? <Phone size={12} aria-hidden="true" />
      : <Mail size={12} aria-hidden="true" />,
    lines: [account.bank_name],
    instructions: account.instructions,
  };
}

export default function AdminZelleAccounts() {
  const { user } = useAuth();
  const can = useMemo(() => adminCapabilities(user), [user]);

  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [newAccount, setNewAccount] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [editData, setEditData] = useState({});

  const fetchAccounts = useCallback(async () => {
    try {
      setAccounts(await api.get('/admin/zelle-accounts'));
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const create = async () => {
    setBusy(true);
    try {
      await api.post('/admin/zelle-accounts', newAccount);
      toast.success('Zelle account added');
      setShowAdd(false);
      setNewAccount(EMPTY);
      fetchAccounts();
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  const startEdit = (account) => {
    setShowAdd(false);
    setEditing(account.id);
    setEditData({
      ...account,
      daily_limit: account.daily_limit ?? '',
      monthly_limit: account.monthly_limit ?? '',
      lifetime_limit: account.lifetime_limit ?? '',
    });
  };

  const saveEdit = async () => {
    setBusy(true);
    try {
      await api.put(`/admin/zelle-accounts/${editing}`, editData);
      toast.success('Zelle account updated');
      setEditing(null);
      fetchAccounts();
    } catch (err) {
      toast.error(err.message);
    }
    setBusy(false);
  };

  const remove = async (account) => {
    const hasHistory = (account.stats?.orders_assigned || 0) > 0;
    const message = hasHistory
      ? `"${account.label || account.recipient_name}" has payment history, so it will be retired (taken out of rotation) rather than deleted. Continue?`
      : `Delete "${account.label || account.recipient_name}"? It has never been used, so it will be removed entirely.`;
    if (!confirm(message)) return;

    try {
      const res = await api.delete(`/admin/zelle-accounts/${account.id}`);
      toast.success(res.message);
      fetchAccounts();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 'var(--sp-8)' }}><ProgressBar label="Loading payment accounts…" /></div>;
  }

  const activeCount = accounts.filter((a) => a.active).length;

  return (
    // Wider than it was, for the same reason as Cash in Mail: the pool's
    // line-item view runs six columns of record before its actions, and a
    // Zelle handle truncated to "name@exa…" is the one field on the row
    // nobody can work from.
    <div className="admin-page" style={{ maxWidth: 1000 }}>
      <PageHeader
        icon={Landmark}
        title="Zelle accounts"
        subtitle={accounts.length === 0
          ? 'No accounts configured — Zelle checkout has nothing to hand out.'
          : `${accounts.filter(a => a.active !== false).length} in rotation of ${accounts.length}`}
      >
        <button className="glass-btn glass-btn-primary" onClick={() => { setEditing(null); setShowAdd((v) => !v); }}>
          <Plus size={16} /> Add account
        </button>
      </PageHeader>

      <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', marginTop: 0, maxWidth: '78ch', lineHeight: 1.55 }}>
        Buyers are handed one of these accounts at checkout, least-recently-used first, along with a
        reference code to put in the Zelle memo. Zelle has no merchant API, so staff confirm receipt
        manually — the reference code is what ties an incoming transfer to an order.
      </p>

      <div className="glass-card" style={{ padding: 'var(--sp-3)', marginBottom: 'var(--sp-5)', borderLeft: '3px solid var(--warning)' }}>
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', display: 'flex', gap: 'var(--sp-2)' }}>
          <AlertTriangle size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 2 }} />
          <span>
            Zelle transfers are irreversible and reveal the buyer's real bank name to you — and yours to
            them. Most banks also prohibit receiving business payments on a personal account, and enforce
            their own daily and monthly caps. Set limits below to match whatever the receiving bank
            actually allows.
          </span>
        </p>
      </div>

      {showAdd && (
        <AccountForm data={newAccount} setData={setNewAccount} onSubmit={create}
          onCancel={() => setShowAdd(false)} submitLabel="Add Account" busy={busy} />
      )}

      {editing && (
        <AccountForm data={editData} setData={setEditData} onSubmit={saveEdit}
          onCancel={() => setEditing(null)} submitLabel="Save Changes" busy={busy} />
      )}

      {accounts.length > 0 && activeCount === 0 && (
        <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
          <AlertTriangle size={13} aria-hidden="true" /> No accounts are in rotation, so Zelle is not offered at checkout.
        </p>
      )}

      {/* DESIGN §6 — this list is a TOGGLE (cards or compact lines), and the
          toggle lives in `components/RecipientPool.jsx` rather than here,
          because the cash-in-mail pool is the same list of the same shape.
          See that file's header for why a toggle and not a responsive table. */}
      <RecipientPool
        surface="admin-zelle"
        items={accounts}
        describe={describeAccount}
        rotation={{ inPool: 'In rotation', outOfPool: 'Retired' }}
        whereHeading="Zelle handle"
        noun="account"
        canManage={can.has('orders.zelle')}
        onEdit={startEdit}
        onDelete={remove}
        emptyIcon={Landmark}
        emptyCopy="Zelle stays unavailable at checkout until at least one account is in rotation. Add the handle money should arrive at, and the name the buyer will see when they send it."
        onAdd={() => { setEditing(null); setShowAdd(true); }}
        addLabel="Add the first account"
      />
      <NextStops route="/admin/zelle" />
    </div>
  );
}
