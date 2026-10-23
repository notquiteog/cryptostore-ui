import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { Boxes, Plus, Trash2, Hammer, AlertTriangle, PackageSearch } from 'lucide-react';
import { api } from '../../utils/api';
import CatalogPicker from './CatalogPicker';

/**
 * What a kit contains, and the button that assembles some.
 *
 * ── Assembled, not derived ──────────────────────────────────────────────────
 *
 * `services/bundles.js` carries the full argument; the part that matters on
 * screen is the consequence. A bundle is not a product whose stock is computed
 * from its parts — it is a box somebody tapes shut. Building consumes the
 * components once and raises this product's own stock, and from that moment the
 * kit sells, reserves, cancels and refunds exactly like any other variant,
 * through the same paths, with no special case anywhere.
 *
 * That is why this panel has a Build button rather than a live stock figure:
 * the number on the shelf is a fact about boxes that exist, and "how many could
 * I make" is a different question, answered beside it.
 *
 * ── Two grants, and why the panel can be half-usable ────────────────────────
 *
 * Editing the recipe is `products.edit`. Building is `products.receive`,
 * because it moves stock — the same grant as booking in a delivery, for the
 * same reason. So a merchandiser may well see this panel, change what a kit
 * contains, and have no Build button, which is correct rather than broken. The
 * server is the authority either way; this only avoids drawing a control that
 * would 403.
 */
export default function BundleRecipe({ groupId, isBundle, canBuild, variants = [] }) {
  const [state, setState] = useState(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [buildQty, setBuildQty] = useState('1');
  const [buildVariant, setBuildVariant] = useState('');
  // Null until the first request answers. `false` means the store has bundles
  // switched off, which the server reports as a 404 with a code rather than as
  // an empty recipe — an empty recipe and an absent feature look identical and
  // mean opposite things.
  const [available, setAvailable] = useState(null);

  const load = useCallback(async () => {
    if (!groupId) return;
    try {
      const data = await api.get(`/products/${groupId}/bundle`);
      setState(data);
      setAvailable(true);
    } catch (err) {
      if (err.code === 'bundles_disabled' || /switched off/i.test(err.message || '')) setAvailable(false);
      else setAvailable(false);
    }
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  // The first sellable option, so the commonest kit — one product, one option —
  // needs no choice made at all.
  useEffect(() => {
    if (!buildVariant && variants.length) setBuildVariant(String(variants[0].id));
  }, [variants, buildVariant]);

  if (!isBundle || available !== true || !state) return null;

  const components = state.components || [];

  const save = async (next) => {
    setBusy(true);
    try {
      const data = await api.put(`/products/${groupId}/bundle`, {
        components: next.map((c) => ({ variant_id: c.variant_id, quantity: c.quantity })),
      });
      setState((s) => ({ ...s, ...data }));
    } catch (err) {
      toast.error(err.message || 'Could not save the recipe');
      await load();
    }
    setBusy(false);
  };

  const addComponent = (variant, group) => {
    setPicking(false);
    if (components.some((c) => c.variant_id === variant.id)) {
      toast('That option is already in this bundle');
      return;
    }
    save([...components, {
      variant_id: variant.id, quantity: 1,
      variant_name: variant.name, group_name: group?.name || '',
    }]);
  };

  const setQuantity = (variantId, raw) => {
    const n = Math.max(1, Math.min(10000, parseInt(raw, 10) || 1));
    save(components.map((c) => (c.variant_id === variantId ? { ...c, quantity: n } : c)));
  };

  const removeComponent = (variantId) => save(components.filter((c) => c.variant_id !== variantId));

  const runBuild = async () => {
    setBusy(true);
    try {
      const data = await api.post(`/products/${groupId}/bundle/build`, {
        variant_id: Number(buildVariant),
        quantity: Number(buildQty),
      });
      toast.success(`Built ${data.built} — components taken off the shelf`);
      setState((s) => ({ ...s, components: data.components, buildable: data.buildable }));
      setBuildQty('1');
    } catch (err) {
      toast.error(err.message || 'Could not build those');
      await load();
    }
    setBusy(false);
  };

  const buildable = Number(state.buildable) || 0;
  const blocked = components.find((c) => c.unavailable);
  // The component that runs out first. Naming it is the difference between
  // "you can make six" and "you can make six, and it is the batteries".
  const limiting = components.length && !blocked
    ? components.reduce((worst, c) => (c.supports < worst.supports ? c : worst), components[0])
    : null;

  return (
    <div className="glass-card admin-panel bundle-card">
      <h3 className="admin-card-title">
        <Boxes size={16} aria-hidden="true" /> What this bundle contains
      </h3>

      <p className="admin-hint bundle-lede">
        Building takes the components off their shelves and puts finished boxes on this
        product&apos;s. From then on it sells like anything else — a cancelled order returns the
        box, not its parts.
      </p>

      {components.length === 0 ? (
        <p className="bundle-empty">
          Nothing in it yet. Add the options a customer gets when they buy one.
        </p>
      ) : (
        <ul className="bundle-list">
          {components.map((c) => (
            <li key={c.variant_id} className={`bundle-row${c.unavailable ? ' is-off' : ''}`}>
              <span className="bundle-name">
                <strong>{c.group_name}</strong>
                <small>{c.variant_name}</small>
              </span>
              <span className="bundle-qty">
                <input
                  className="glass-input"
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  value={c.quantity}
                  disabled={busy}
                  onChange={(e) => setQuantity(c.variant_id, e.target.value)}
                  aria-label={`How many ${c.variant_name} in one bundle`}
                />
                <em>per bundle</em>
              </span>
              {/* Stock, and what it means for this kit. Two numbers because
                  they answer different questions: "have I got any" and "how
                  many boxes does that make". */}
              <span className="bundle-stock" title={`${c.available} in stock`}>
                {c.unavailable
                  ? <><AlertTriangle size={12} aria-hidden="true" /> switched off</>
                  : `${c.available.toLocaleString()} in stock · enough for ${c.supports.toLocaleString()}`}
              </span>
              <button
                type="button"
                className="glass-btn glass-btn-sm glass-btn-danger"
                onClick={() => removeComponent(c.variant_id)}
                disabled={busy}
                aria-label={`Remove ${c.variant_name} from this bundle`}
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="bundle-acts">
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => setPicking(true)} disabled={busy}>
          <Plus size={14} aria-hidden="true" /> Add a component
        </button>
        {components.length > 0 && (
          <span className="bundle-can">
            {blocked
              ? <><AlertTriangle size={13} aria-hidden="true" /> Cannot build — {blocked.group_name} is switched off</>
              : buildable > 0
                ? <>Enough on the shelves for <strong>{buildable.toLocaleString()}</strong>{limiting ? ` · limited by ${limiting.group_name}` : ''}</>
                : <>Not enough stock to build any{limiting ? ` · ${limiting.group_name} is the one holding it up` : ''}</>}
          </span>
        )}
      </div>

      {picking && (
        <div className="bundle-picker">
          <CatalogPicker onSelect={addComponent} />
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => setPicking(false)}>Cancel</button>
        </div>
      )}

      {canBuild && components.length > 0 && !blocked && (
        <div className="bundle-build">
          <label htmlFor="bundle-build-qty">Build</label>
          <input
            id="bundle-build-qty"
            className="glass-input"
            type="number"
            min="1"
            max={Math.max(1, buildable)}
            step="1"
            value={buildQty}
            disabled={busy || buildable === 0}
            onChange={(e) => setBuildQty(e.target.value)}
          />
          {/* Only when there is a choice to make. One option is the common
              case and a select holding a single item is a control that asks a
              question with one answer. */}
          {variants.length > 1 && (
            <select
              className="glass-input"
              value={buildVariant}
              disabled={busy}
              onChange={(e) => setBuildVariant(e.target.value)}
              aria-label="Which option these boxes are"
            >
              {variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          )}
          <button
            type="button"
            className="glass-btn glass-btn-primary glass-btn-sm"
            onClick={runBuild}
            disabled={busy || buildable === 0 || !buildVariant}
          >
            <Hammer size={14} aria-hidden="true" /> {busy ? 'Building…' : 'Build'}
          </button>
          <small className="admin-hint">
            Recorded in the goods-in log, like a delivery. There is no undo — taking a kit apart
            means booking its parts back in.
          </small>
        </div>
      )}

      {!canBuild && components.length > 0 && (
        <p className="admin-hint bundle-note">
          <PackageSearch size={13} aria-hidden="true" /> Building needs the
          &ldquo;Receive stock&rdquo; permission — it moves stock between shelves.
        </p>
      )}
    </div>
  );
}
