import ProgressBar from '../../components/ProgressBar';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import { LimitFields } from '../../components/RecipientLimits';
import RecipientPool from '../../components/RecipientPool';
import { Plus, Save, X, Mail } from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import NextStops from '../../components/admin/NextStops';

const BLANK = {
  label: '', address_line1: '', address_line2: '', city: '', state: '', zip: '',
  country: '', instructions: '',
};

/**
 * The drop-address form.
 *
 * Declared at module scope, not inside `AdminCashMail`. It used to be defined
 * in the component body, which makes it a brand-new component type on every
 * render — React unmounts the old tree and mounts a fresh one, so the input
 * being typed into lost focus after every single keystroke. ZelleAccounts had
 * already hoisted its twin; this is the same fix, and the reason both now sit
 * beside each other rather than one inside a render.
 */
function AddressForm({ data, setData, onSubmit, onCancel, submitLabel }) {
  return (
    <div className="glass-card" style={{ marginBottom: 'var(--sp-6)' }}>
      <div className="form-row">
        <div className="form-group">
          <label>Label</label>
          <input className="glass-input" value={data.label || ''} onChange={(e) => setData({ ...data, label: e.target.value })} placeholder="e.g. PO Box #1" />
        </div>
        <div className="form-group">
          <label>Active</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', cursor: 'pointer', marginTop: 'var(--sp-1)' }}>
            <input type="checkbox" checked={data.active !== false} onChange={(e) => setData({ ...data, active: e.target.checked })} style={{ accentColor: 'var(--primary)' }} />
            {data.active !== false ? 'In rotation' : 'Out of rotation'}
          </label>
        </div>
      </div>
      <div className="form-group">
        <label>Address Line 1</label>
        <input className="glass-input" value={data.address_line1 || ''} onChange={(e) => setData({ ...data, address_line1: e.target.value })} />
      </div>
      <div className="form-group">
        <label>Address Line 2</label>
        <input className="glass-input" value={data.address_line2 || ''} onChange={(e) => setData({ ...data, address_line2: e.target.value })} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>City</label>
          <input className="glass-input" value={data.city || ''} onChange={(e) => setData({ ...data, city: e.target.value })} />
        </div>
        <div className="form-group">
          <label>State</label>
          <input className="glass-input" value={data.state || ''} onChange={(e) => setData({ ...data, state: e.target.value })} />
        </div>
        <div className="form-group">
          <label>ZIP</label>
          <input className="glass-input" value={data.zip || ''} onChange={(e) => setData({ ...data, zip: e.target.value })} />
        </div>
      </div>
      <div className="form-group">
        <label>Country</label>
        <input className="glass-input" value={data.country || ''} onChange={(e) => setData({ ...data, country: e.target.value })} />
      </div>
      <div className="form-group">
        <label>Instructions</label>
        <textarea className="glass-input" rows={3} value={data.instructions || ''} onChange={(e) => setData({ ...data, instructions: e.target.value })}
          placeholder="Special instructions shown to buyer" />
      </div>

      <LimitFields data={data} setData={setData} />

      <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-4)' }}>
        <button className="glass-btn glass-btn-primary" onClick={onSubmit}><Save size={16} /> {submitLabel}</button>
        <button className="glass-btn" onClick={onCancel}><X size={16} /> Cancel</button>
      </div>
    </div>
  );
}

/** One drop address, read for display. See `components/RecipientPool.jsx`. */
function describeAddress(addr) {
  return {
    id: addr.id,
    title: addr.label || 'Unlabelled drop',
    // The whole point of this record is the envelope, so the address itself is
    // the "where the money goes" cell rather than a detail line — a drop with
    // its street hidden behind a click is a drop nobody can check.
    where: [addr.address_line1, addr.address_line2, addr.city, addr.state, addr.zip, addr.country]
      .filter(Boolean).join(', ') || 'No address recorded',
    instructions: addr.instructions,
  };
}

export default function AdminCashMail() {
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newAddress, setNewAddress] = useState(BLANK);
  const [editing, setEditing] = useState(null);
  const [editData, setEditData] = useState({});

  const fetchAddresses = useCallback(async () => {
    try {
      const data = await api.get('/admin/cash-mail-addresses');
      setAddresses(data);
    } catch (err) {
      toast.error(err.message);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAddresses(); }, [fetchAddresses]);

  const addAddress = async () => {
    if (!newAddress.label.trim() || !newAddress.address_line1.trim()) {
      return toast.error('Label and address are required');
    }
    try {
      await api.post('/admin/cash-mail-addresses', newAddress);
      toast.success('Address added');
      setShowAdd(false);
      setNewAddress(BLANK);
      fetchAddresses();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const startEdit = (addr) => {
    setShowAdd(false);
    setEditing(addr.id);
    // Null limits become '' so the inputs stay controlled and a cleared field
    // reads back as "no limit" rather than as an unchanged value.
    setEditData({
      ...addr,
      daily_limit: addr.daily_limit ?? '',
      monthly_limit: addr.monthly_limit ?? '',
      lifetime_limit: addr.lifetime_limit ?? '',
    });
  };

  const saveEdit = async () => {
    try {
      await api.put(`/admin/cash-mail-addresses/${editing}`, editData);
      toast.success('Address updated');
      setEditing(null);
      fetchAddresses();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const deleteAddress = async (addr) => {
    const hasHistory = (addr.stats?.orders_assigned || 0) > 0;
    const message = hasHistory
      ? `"${addr.label || 'This address'}" has payment history, so it will be retired (taken out of rotation) rather than deleted. Continue?`
      : 'Delete this cash mail address? It has never been used, so it will be removed entirely.';
    if (!confirm(message)) return;
    try {
      const res = await api.delete(`/admin/cash-mail-addresses/${addr.id}`);
      toast.success(res.message || 'Address deleted');
      fetchAddresses();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 'var(--sp-8)' }}><ProgressBar label="Loading cash payments…" /></div>;

  return (
    // Wider than it was: the pool's line-item view runs six columns of record
    // before the actions, and at the old 800px the drop address and the label
    // were both truncating to nothing. The cards fill the extra width with the
    // usage meters they already carry.
    <div className="admin-page" style={{ maxWidth: 1000 }}>
      <PageHeader
        icon={Mail}
        title="Cash in Mail"
        subtitle={addresses.length === 0
          ? 'No drop addresses configured — cash orders have nowhere to go.'
          : `${addresses.filter(a => a.active !== false).length} active of ${addresses.length} address${addresses.length === 1 ? '' : 'es'}`}
      >
        <button className="glass-btn glass-btn-primary" onClick={() => setShowAdd(!showAdd)}>
          <Plus size={16} /> Add address
        </button>
      </PageHeader>

      {showAdd && (
        <AddressForm data={newAddress} setData={setNewAddress} onSubmit={addAddress}
          onCancel={() => setShowAdd(false)} submitLabel="Add Address" />
      )}

      {editing && (
        <AddressForm data={editData} setData={setEditData} onSubmit={saveEdit}
          onCancel={() => setEditing(null)} submitLabel="Save Changes" />
      )}

      {/* DESIGN §6 — this list is a TOGGLE (cards or compact lines), and the
          toggle lives in `components/RecipientPool.jsx` rather than here,
          because the Zelle pool is the same list of the same shape. See that
          file's header for why a toggle and not a responsive table. */}
      <RecipientPool
        surface="admin-cash-mail"
        items={addresses}
        describe={describeAddress}
        rotation={{ inPool: 'In rotation', outOfPool: 'Retired' }}
        whereHeading="Drop address"
        noun="address"
        canManage
        onEdit={startEdit}
        onDelete={deleteAddress}
        emptyIcon={Mail}
        emptyCopy="Cash-in-mail stays unavailable at checkout until at least one drop address is in rotation — a cash order placed now has nowhere to be sent."
        onAdd={() => setShowAdd(true)}
        addLabel="Add the first address"
      />
      <NextStops route="/admin/cash-mail" />
    </div>
  );
}
