import { useEffect, useMemo, useState } from 'react';
import { Search, Layers, Tag, Users, Sparkle } from 'lucide-react';
import { api } from '../../utils/api';

/**
 * The three restrictions a coupon can carry, as one fieldset.
 *
 * ── Why all three live in one component ─────────────────────────────────────
 *
 * Because they answer one question — *who gets this, and on what* — and an
 * operator setting a welcome code for Gold members on edibles is making one
 * decision, not three. Scattering them through the flat form grid beside
 * "Total redemptions" would hide the fact that a scope and a tier floor
 * COMPOUND: a coupon can easily be configured so that nobody qualifies, and
 * the only way to notice is to see the conditions together.
 *
 * ── Why the product list is a picker and not an id box ──────────────────────
 *
 * `components/admin/CatalogPicker.jsx` records what an id box costs: the
 * operator has to already know an integer that appears nowhere on the screen,
 * and a mistyped digit lands the discount on whichever product happens to own
 * that number, silently and at full effect. A coupon is money, so this is the
 * same argument with a larger bill attached. Products are chosen by name, from
 * a list filtered as it is typed into.
 *
 * This is not `CatalogPicker` itself, and the difference is load-bearing: that
 * component picks ONE VARIANT and calls back. A coupon scopes to a product
 * GROUP — all its options — and to several of them at once, which is a
 * different selection model (multi, toggleable, persistent) over a different
 * grain. Reusing it would have meant a single-select component pretending.
 *
 * ── Why a category is a chip and not free text ──────────────────────────────
 *
 * `product_groups.category` is free text, and a coupon for a category nobody
 * has filed anything under discounts nothing while still claiming a use. So the
 * categories offered are the ones the catalogue actually has. The server still
 * matches case-insensitively (`coupon_scope_categories`), because the same
 * category often exists in two spellings — but an operator should not have to
 * discover that by watching a coupon do nothing.
 *
 * @param {object} value    `{ scope, scope_group_ids, scope_categories, first_order_only, min_tier_id }`
 * @param {Function} onChange  called with the whole patch
 */
export default function CouponScope({ value, onChange }) {
  const [groups, setGroups] = useState([]);
  const [categories, setCategories] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const scope = value.scope || 'order';
  const pickedGroups = value.scope_group_ids || [];
  const pickedCategories = value.scope_categories || [];

  const set = (patch) => onChange({ ...value, ...patch });

  useEffect(() => {
    let alive = true;
    // Three independent reads, so they run together. Each degrades on its own:
    // a failed tier read leaves the tier floor as "any tier" rather than
    // taking the whole fieldset down, which matters because two of the three
    // restrictions are still perfectly usable without it.
    Promise.allSettled([
      // No `active` filter: a staff viewer already sees switched-off products
      // here, and a coupon prepared for a product that goes live next week is
      // exactly the thing an operator is setting up in advance.
      api.get('/products?limit=200'),
      api.get('/products/categories'),
      api.get('/tiers'),
    ]).then(([p, c, t]) => {
      if (!alive) return;
      const rows = p.status === 'fulfilled' ? (p.value?.products ?? p.value ?? []) : [];
      setGroups(Array.isArray(rows) ? rows : []);
      const cats = c.status === 'fulfilled' ? (c.value?.categories ?? c.value ?? []) : [];
      setCategories(Array.isArray(cats) ? cats.filter(Boolean) : []);
      const ladder = t.status === 'fulfilled' ? (t.value?.tiers ?? t.value ?? []) : [];
      setTiers(Array.isArray(ladder) ? ladder : []);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? groups.filter((g) => String(g.name || '').toLowerCase().includes(q)
        || String(g.category || '').toLowerCase().includes(q))
      : groups;
    // The chosen ones float to the top, so a selection made before a search is
    // typed does not vanish behind the filter — losing sight of what is already
    // picked is how an operator ends up saving a coupon scoped to one product
    // when they meant six.
    const chosen = new Set(pickedGroups.map(Number));
    return [...rows].sort((a, b) => (chosen.has(Number(b.id)) ? 1 : 0) - (chosen.has(Number(a.id)) ? 1 : 0));
  }, [groups, query, pickedGroups]);

  const toggleGroup = (id) => {
    const n = Number(id);
    const next = pickedGroups.map(Number).includes(n)
      ? pickedGroups.filter((g) => Number(g) !== n)
      : [...pickedGroups, n];
    set({ scope_group_ids: next });
  };

  const toggleCategory = (cat) => {
    const next = pickedCategories.includes(cat)
      ? pickedCategories.filter((c) => c !== cat)
      : [...pickedCategories, cat];
    set({ scope_categories: next });
  };

  /*
   * The sentence that says what this coupon will actually do.
   *
   * Written out rather than left to be inferred from three controls, because
   * the conditions compound and the failure is silent: a Gold-only,
   * first-order-only coupon is a coupon for somebody who has reached Gold
   * without ever completing an order, which is nobody. An operator reading
   * "their first order, if they are Gold or above" has a chance of noticing;
   * one reading two ticked boxes does not.
   */
  const summary = useMemo(() => {
    const parts = [];
    if (scope === 'products') {
      parts.push(pickedGroups.length
        ? `${pickedGroups.length} product${pickedGroups.length === 1 ? '' : 's'}`
        : 'nothing yet — pick at least one product');
    } else if (scope === 'categories') {
      parts.push(pickedCategories.length
        ? `the ${pickedCategories.join(', ')} categor${pickedCategories.length === 1 ? 'y' : 'ies'}`
        : 'nothing yet — pick at least one category');
    } else {
      parts.push('the whole order');
    }
    const who = [];
    if (value.min_tier_id) {
      const tier = tiers.find((t) => Number(t.id) === Number(value.min_tier_id));
      who.push(`${tier ? tier.name : 'that tier'} members and above`);
    }
    if (value.first_order_only) who.push('a first order only');
    return `Discounts ${parts[0]}${who.length ? `, for ${who.join(', and ')}` : ', for anybody with the code'}.`;
  }, [scope, pickedGroups, pickedCategories, value.min_tier_id, value.first_order_only, tiers]);

  return (
    <fieldset className="cscope">
      <legend className="cscope-legend">Who it is for, and what it covers</legend>

      <div className="cscope-row">
        <div className="form-group">
          <label htmlFor="coupon-scope">Applies to</label>
          <select
            id="coupon-scope"
            className="glass-input"
            value={scope}
            onChange={(e) => set({ scope: e.target.value })}
          >
            <option value="order">The whole order</option>
            <option value="products">Chosen products</option>
            <option value="categories">Chosen categories</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="coupon-tier">Minimum tier</label>
          <select
            id="coupon-tier"
            className="glass-input"
            value={value.min_tier_id ?? ''}
            onChange={(e) => set({ min_tier_id: e.target.value || null })}
          >
            <option value="">Any tier, including none</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>{t.name} and above</option>
            ))}
          </select>
        </div>

        <div className="form-group admin-form-check">
          <label className="switch">
            <input
              type="checkbox"
              checked={Boolean(value.first_order_only)}
              onChange={(e) => set({ first_order_only: e.target.checked })}
            />
            <span className="switch-track" />
          </label>
          <span>First order only</span>
        </div>
      </div>

      {scope === 'products' && (
        <div className="cscope-pick">
          <div className="cscope-search">
            <Search size={14} aria-hidden="true" />
            <input
              className="glass-input"
              type="search"
              placeholder="Filter products by name or category"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter products"
            />
            <span className="cscope-tally">{pickedGroups.length} chosen</span>
          </div>
          {loading ? (
            <p className="cscope-state">Loading the catalogue…</p>
          ) : matching.length === 0 ? (
            <p className="cscope-state">
              {groups.length === 0
                ? 'There are no products yet, so there is nothing to scope a coupon to.'
                : 'No product matches that. Clear the filter to see the rest.'}
            </p>
          ) : (
            <ul className="cscope-list">
              {matching.map((g) => {
                const on = pickedGroups.map(Number).includes(Number(g.id));
                return (
                  <li key={g.id}>
                    <label className="cscope-item" data-on={on ? 'yes' : 'no'}>
                      <input type="checkbox" checked={on} onChange={() => toggleGroup(g.id)} />
                      <Layers size={13} aria-hidden="true" />
                      <span className="cscope-name">{g.name}</span>
                      {g.category && <span className="cscope-cat">{g.category}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {scope === 'categories' && (
        <div className="cscope-pick">
          {loading ? (
            <p className="cscope-state">Loading categories…</p>
          ) : categories.length === 0 ? (
            /* Navigation, not apology (DESIGN §9): the reason there is nothing
               to pick is that no product has been filed, and the fix is on the
               product editor rather than here. */
            <p className="cscope-state">
              No product carries a category yet. Set one on a product and it appears here.
            </p>
          ) : (
            <div className="cscope-chips">
              {categories.map((c) => {
                const on = pickedCategories.includes(c);
                return (
                  <label key={c} className="cscope-chip" data-on={on ? 'yes' : 'no'}>
                    <input type="checkbox" checked={on} onChange={() => toggleCategory(c)} />
                    <Tag size={12} aria-hidden="true" />
                    {c}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      <p className="cscope-summary">
        {value.first_order_only ? <Sparkle size={13} aria-hidden="true" /> : <Users size={13} aria-hidden="true" />}
        {summary}
      </p>
    </fieldset>
  );
}
