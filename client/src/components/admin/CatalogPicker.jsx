import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../utils/api';
import { Search, PackageSearch, EyeOff, Zap, Layers } from 'lucide-react';

/**
 * Choose a variant to put a sale on, by looking at the catalog.
 *
 * Replaces a bare "Variant ID" number box. That box asked the operator to
 * already know an integer that appears nowhere on this screen, so starting a
 * sale meant leaving the page, finding the product, reading the id off another
 * one and typing it back — and a mistyped digit landed the discount on
 * whichever variant happened to own that number, silently and at full effect.
 *
 * Searching is done twice over, deliberately. The list already on screen is
 * filtered on every keystroke so the results move with the typing, and a
 * debounced request re-asks the server, which can see the whole catalog rather
 * than the page's worth of it. The local pass is what makes it feel instant;
 * the server pass is what makes it correct.
 *
 * @param {object}   props
 * @param {Function} props.onSelect  called with (variant, group)
 * @param {number}   [props.excludeVariantId]  marked "current" rather than offered
 */
export default function CatalogPicker({ onSelect, excludeVariantId }) {
  const [groups, setGroups] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Debounced server search. The first pass runs with an empty query, so the
  // picker is populated before anything is typed.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const data = await api.get(`/flash-sales/admin/catalog${query ? `?search=${encodeURIComponent(query)}` : ''}`);
        if (cancelled) return;
        setGroups(data.groups || []);
        setError('');
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load the catalog');
      }
      if (!cancelled) setLoading(false);
    };
    const timer = setTimeout(run, query ? 220 : 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  /** The instant pass: narrow what is already here while the request is in flight. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    const matches = (text) => String(text || '').toLowerCase().includes(q);
    return groups
      .map(g => {
        // A group whose own name matches keeps all its variants — the operator
        // searched for the product, not for one size of it.
        if (matches(g.name) || matches(g.category) || matches(g.brand)) return g;
        const variants = g.variants.filter(v => matches(v.name) || String(v.id) === q);
        return variants.length ? { ...g, variants } : null;
      })
      .filter(Boolean);
  }, [groups, query]);

  // Flat order of the rendered rows, which is what the arrow keys walk.
  const flat = useMemo(
    () => visible.flatMap(g => g.variants.map(v => ({ variant: v, group: g }))),
    [visible]
  );

  useEffect(() => { setActive(0); }, [query]);

  useEffect(() => {
    const row = listRef.current?.querySelector('[data-active="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [active, visible]);

  const choose = (entry) => entry && onSelect?.(entry.variant, entry.group);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(flat[active]);
    }
  };

  let index = -1;

  return (
    <div className="fsale-picker">
      <div className="admin-search fsale-picker-search">
        <Search size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          className="glass-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search products, variants, or paste a variant ID…"
          aria-label="Search the catalog"
          autoComplete="off"
        />
      </div>

      {error ? (
        <p className="fsale-picker-empty">{error}</p>
      ) : loading ? (
        <div className="fsale-picker-list">
          {[0, 1, 2].map(i => <div key={i} className="skeleton skeleton-row" />)}
        </div>
      ) : flat.length === 0 ? (
        <p className="fsale-picker-empty">
          <PackageSearch size={26} aria-hidden="true" />
          {query ? `Nothing in the catalog matches “${query}”.` : 'No products yet.'}
        </p>
      ) : (
        <div className="fsale-picker-list" ref={listRef} role="listbox" aria-label="Variants">
          {visible.map(group => (
            <div className="fsale-picker-group" key={group.id}>
              <div className="fsale-picker-ghead">
                {group.thumb
                  ? <img className="fsale-thumb fsale-thumb-sm" src={group.thumb} alt="" loading="lazy" />
                  : <span className="fsale-thumb fsale-thumb-sm fsale-thumb-blank"><Layers size={13} aria-hidden="true" /></span>}
                <span className="fsale-picker-gname">{group.name}</span>
                {!group.active && (
                  <span className="fsale-tag fsale-tag-muted"><EyeOff size={10} aria-hidden="true" /> Hidden</span>
                )}
                {group.category && <span className="fsale-picker-gmeta">{group.category}</span>}
              </div>

              {group.variants.map(v => {
                index += 1;
                const i = index;
                const isCurrent = excludeVariantId != null && v.id === excludeVariantId;
                const price = Number(v.price);
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    data-active={i === active}
                    className={`fsale-picker-row${i === active ? ' is-active' : ''}${isCurrent ? ' is-current' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose({ variant: v, group })}
                  >
                    {v.thumb
                      ? <img className="fsale-thumb fsale-thumb-sm" src={v.thumb} alt="" loading="lazy" />
                      : <span className="fsale-thumb fsale-thumb-sm fsale-thumb-blank" aria-hidden="true" />}

                    <span className="fsale-picker-vname">
                      {v.name}
                      <span className="fsale-picker-vid">#{v.id}</span>
                    </span>

                    <span className="fsale-picker-vprice">
                      {Number.isFinite(price) ? `$${price.toFixed(2)}` : '—'}
                    </span>

                    <span className="fsale-picker-tags">
                      {!v.active && <span className="fsale-tag fsale-tag-muted"><EyeOff size={10} aria-hidden="true" /> Off</span>}
                      <span className={`fsale-tag${v.stock > 0 ? '' : ' fsale-tag-danger'}`}>
                        {v.stock > 0 ? `${v.stock} in stock` : 'Out of stock'}
                      </span>
                      {v.tier_count > 0 && v.best_tier_price != null && (
                        <span className="fsale-tag fsale-tag-info">
                          tiers from ${Number(v.best_tier_price).toFixed(2)}
                        </span>
                      )}
                      {v.sale && !isCurrent && (
                        <span className="fsale-tag fsale-tag-warn"><Zap size={10} aria-hidden="true" /> Has a sale</span>
                      )}
                      {isCurrent && <span className="fsale-tag fsale-tag-primary">Current</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
