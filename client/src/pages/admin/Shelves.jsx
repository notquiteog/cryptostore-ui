import {
  useState, useEffect, useCallback, useMemo, useRef, useDeferredValue, memo,
} from 'react';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
  MapPin, Search, Save, RotateCcw, FilterX, CircleSlash, Boxes,
  AlertTriangle, Check, Wand2, PackageX,
  // Aliased: this file builds real `new Map()`s, and the icon shadowing the
  // constructor turns them into React elements at runtime.
  Map as MapIcon,
} from 'lucide-react';
import { api } from '../../utils/api';
import PageHeader from '../../components/admin/PageHeader';
import StatTiles from '../../components/admin/StatTiles';
import SlotGrid from '../../components/fulfilment/SlotGrid';
import { WarehouseCard } from '../../components/fulfilment/WarehouseViewer';
import { useWarehouseLayout } from '../../utils/useWarehouseLayout';
import { bustShelfContents } from '../../utils/shelfContents';
import { writeBins, BIN_CHUNK } from '../../utils/binWrites';

/**
 * Bulk shelf assignment.
 *
 * ── Why this ships with the pull list and not after it ──────────────────────
 *
 * The pull list groups by `bin_location` and walks in that order. On a store
 * where the column is NULL everywhere — which is every store, the moment the
 * migration runs — that ordering does nothing and the list is a shuffled pile.
 * Filing the catalogue is the work that makes the feature real, and nobody is
 * going to do it four hundred times through a product page. So the bulk editor
 * is part of the feature, not a follow-up.
 *
 * ── Everything is staged, nothing autosaves ─────────────────────────────────
 *
 * Edits accumulate in `draft` and go to the server in one request when the
 * operator says so. Autosaving per keystroke would write a row per character
 * typed into a bin field, and "A1" would pass through "A" on its way — a real
 * shelf, quite possibly somebody else's.
 *
 * The stage does survive the operator, though: `draft` mirrors into
 * sessionStorage and is restored (pruned against the live catalogue) on the
 * next mount. Filing a warehouse takes longer than one sitting, and the first
 * version lost a hundred staged rows to a stray tap on a sidebar link.
 * beforeunload catches the closing tab; the mirror catches everything else.
 *
 * The server normalises (trim, upper-case, cap at the column width) and so does
 * this screen, so what the operator sees staged is what lands. Two normalisers
 * that disagree is how "a1" and "A1" become two shelves.
 *
 * ── This table is big and behaves like a spreadsheet ────────────────────────
 *
 * Thousands of variants is the NORMAL case, so the row is memoised, the filter
 * runs against a deferred query so typing never waits on 3,000 re-renders, and
 * Enter walks down the shelf column the way it does in a spreadsheet — filing
 * is column work, and reaching for the mouse between rows is what made nobody
 * do it.
 */

/** Mirrors the server's normalisation exactly. See fulfilmentController.setBinLocations. */
const normalise = (v) => String(v ?? '').trim().toUpperCase().slice(0, 32);

const DRAFT_KEY = 'cs.shelfdraft.v1';

function loadStoredDraft() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(DRAFT_KEY));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

/**
 * One row. Memoised because there are thousands of it and a keystroke in any
 * one bin field must not re-render the other 2,999. Everything it receives is
 * either a primitive or a stable reference — the comparison is the default
 * shallow one, so a new callback per render here would silently defeat the
 * whole memo.
 */
const ShelfRow = memo(function ShelfRow({
  v, idx, value, changed, selected, repeat, onBin, onBlurBin, onToggle, onNav,
}) {
  return (
    <tr className={`${changed ? 'is-changed' : ''}${selected ? ' is-selected' : ''}${v.active ? '' : ' is-inactive'}`}>
      <td className="shelf-col-pick">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => { /* click carries the shift state; change alone cannot */ }}
          onClick={(e) => onToggle(v.variant_id, idx, e.shiftKey)}
          aria-label={`Select ${v.group_name} ${v.variant_name}`}
        />
      </td>
      <td className="shelf-item">
        {repeat ? (
          <>
            {/* The eye groups the block by the first row; repeating the name
                2,000 times is what made the old table read as noise. The name
                stays for find-in-page and screen readers. */}
            <span className="shelf-ditto" aria-hidden="true">·</span>
            <span className="sr-only">{v.group_name}</span>
          </>
        ) : (
          <span className="shelf-group">{v.group_name}</span>
        )}
        <span className="shelf-variant">
          {v.variant_name}
          {!v.active && <span className="shelf-inactive-tag">inactive</span>}
        </span>
      </td>
      <td className="shelf-col-num shelf-stock">{v.quantity}</td>
      <td className="shelf-col-bin">
        <input
          type="text"
          className={`shelf-bin-input${changed ? ' is-changed' : ''}`}
          value={value}
          maxLength={32}
          placeholder="—"
          list="shelf-known-bins"
          data-shelf-idx={idx}
          onChange={(e) => onBin(v.variant_id, e.target.value)}
          onBlur={(e) => onBlurBin(v.variant_id, e.target.value)}
          onFocus={(e) => e.target.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); onNav(idx, e.shiftKey ? -1 : 1); }
            else if (e.key === 'Escape') e.currentTarget.blur();
          }}
          aria-label={`Shelf for ${v.group_name} ${v.variant_name}`}
        />
      </td>
    </tr>
  );
});

export default function Shelves() {
  const [variants, setVariants] = useState([]);
  const [draft, setDraft] = useState({});
  // The shelf whose slot grid is open, picked off the map card.
  const [slotShelf, setSlotShelf] = useState(null);
  const layout = useWarehouseLayout();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [onlyUnfiled, setOnlyUnfiled] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [binFilter, setBinFilter] = useState('');
  const [sort, setSort] = useState('shelf');
  const [bulkValue, setBulkValue] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const deferredQuery = useDeferredValue(query);
  const restored = useRef(false);
  const lastToggled = useRef(null);
  const headCheckRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get('/fulfilment/bins');
      const fresh = data.variants || [];
      setVariants(fresh);
      setSelected(new Set());

      // Restore the staged edits this browser was holding, minus anything the
      // catalogue has since made moot: a variant that is gone, or a stage that
      // now matches what the server already has.
      const stored = loadStoredDraft();
      const byId = new Map(fresh.map((v) => [String(v.variant_id), v]));
      const kept = {};
      for (const [vid, val] of Object.entries(stored)) {
        const v = byId.get(vid);
        if (v && normalise(val) !== normalise(v.bin_location || '')) kept[vid] = val;
      }
      setDraft(kept);
      const n = Object.keys(kept).length;
      if (n > 0 && !restored.current) {
        toast(`Restored ${n} staged shelf change${n === 1 ? '' : 's'} — save or discard them`);
      }
      restored.current = true;
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load shelf locations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The sessionStorage mirror of the stage. Cheap enough to do wholesale on
  // every change at this size, and wholesale cannot drift.
  useEffect(() => {
    try {
      if (Object.keys(draft).length === 0) sessionStorage.removeItem(DRAFT_KEY);
      else sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch { /* private mode: the stage lives as long as the tab */ }
  }, [draft]);

  const binOf = useCallback(
    (v) => (v.variant_id in draft ? draft[v.variant_id] : (v.bin_location || '')),
    [draft],
  );

  const dirty = useMemo(
    () => Object.entries(draft).filter(([id, value]) => {
      const original = variants.find((v) => String(v.variant_id) === String(id))?.bin_location || '';
      return normalise(value) !== normalise(original);
    }),
    [draft, variants],
  );

  // Warn before the tab closes on unsaved work. In-app navigation is covered
  // by the sessionStorage mirror instead — blocking a React Router transition
  // needs the data router this app does not use, and a stage that survives
  // beats a dialog that nags.
  useEffect(() => {
    if (dirty.length === 0) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty.length]);

  const sorted = useMemo(() => {
    if (sort === 'shelf') return variants; // the server's walk order: filed first, then by product
    const arr = [...variants];
    if (sort === 'product') {
      arr.sort((a, b) => a.group_name.localeCompare(b.group_name) || a.variant_name.localeCompare(b.variant_name));
    } else if (sort === 'stock') {
      arr.sort((a, b) => b.quantity - a.quantity);
    }
    return arr;
  }, [variants, sort]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    return sorted.filter((v) => {
      if (onlyUnfiled && binOf(v)) return false;
      if (binFilter && normalise(binOf(v)) !== binFilter) return false;
      if (hideEmpty && v.quantity === 0) return false;
      if (!q) return true;
      return `${v.group_name} ${v.variant_name} ${binOf(v)}`.toLowerCase().includes(q);
    });
  }, [sorted, deferredQuery, onlyUnfiled, hideEmpty, binFilter, binOf]);

  /**
   * Who is in each bin, draft edits winning.
   *
   * Same shape the map editor supplies, and for the same reason: the grid has
   * to show what the operator has just typed, not what the server last
   * confirmed. `binOf` already resolves draft-over-stored, so this is just it
   * inverted into a bin → variants index.
   */
  const occupantsByBin = useMemo(() => {
    const map = new Map();
    for (const v of variants) {
      const bin = binOf(v);
      if (!bin) continue;
      if (!map.has(bin)) map.set(bin, []);
      map.get(bin).push(v);
    }
    return map;
  }, [variants, binOf]);

  /** The shelf the map picked, with its levels/slots from the layout. */
  const openShelf = useMemo(() => {
    if (!slotShelf || !layout) return null;
    return layout.shelves.find((sh) => sh.name === slotShelf) || null;
  }, [slotShelf, layout]);

  /**
   * How many variants sit anywhere under the selected shelf.
   *
   * The same prefix rule the walk order uses — a bin belongs to shelf S when it
   * IS S or starts with `S-` — because `shelves` above is indexed by full bin
   * string ("A1-L2-S3"), and counting those would answer a different question
   * than the one the panel asks.
   */
  const filedUnderShelf = useMemo(() => {
    if (!slotShelf) return 0;
    const name = String(slotShelf).toUpperCase();
    return variants.filter((v) => {
      const bin = normalise(binOf(v));
      return bin && (bin === name || bin.startsWith(`${name}-`));
    }).length;
  }, [variants, binOf, slotShelf]);

  // Every shelf that exists, draft included, with how many variants it holds.
  // Feeds the legend chips and the <datalist> that autocompletes bin fields —
  // one source, so the suggestions can never offer a shelf the legend denies.
  const shelves = useMemo(() => {
    const counts = new Map();
    for (const v of variants) {
      const bin = normalise(binOf(v));
      if (bin) counts.set(bin, (counts.get(bin) || 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [variants, binOf]);

  const stats = [
    { key: 'total', label: 'Variants', value: variants.length, icon: Boxes, tone: 'var(--secondary)' },
    {
      key: 'filed', label: 'Filed', value: variants.filter((v) => binOf(v)).length,
      icon: Check, tone: 'var(--success)',
    },
    {
      key: 'unfiled', label: 'Unfiled',
      value: variants.filter((v) => !binOf(v)).length,
      icon: CircleSlash,
      tone: variants.some((v) => !binOf(v)) ? 'var(--warning)' : 'var(--success)',
      onClick: () => setOnlyUnfiled((v) => !v),
      active: onlyUnfiled,
      hint: 'Filter to these',
    },
    {
      key: 'bins', label: 'Shelves in use',
      value: shelves.length,
      icon: MapPin, tone: 'var(--accent)',
    },
  ];

  const setBin = useCallback((variantId, value) => {
    setDraft((prev) => ({ ...prev, [variantId]: value }));
  }, []);

  const blurBin = useCallback((variantId, value) => {
    setDraft((prev) => ({ ...prev, [variantId]: normalise(value) }));
  }, []);

  // Enter walks the shelf column; the DOM is the index. Looking the input up
  // by attribute instead of holding 3,000 refs keeps the memoised rows dumb.
  const navRow = useCallback((idx, dir) => {
    const next = document.querySelector(`.shelf-table input[data-shelf-idx="${idx + dir}"]`);
    if (next) { next.focus(); next.select(); }
  }, []);

  // Read through a ref so this callback keeps ONE identity for the life of
  // the page. Depending on `filtered` directly would mint a new function per
  // keystroke, and a new function per keystroke re-renders all 3,000 memoised
  // rows — the exact work the memo exists to skip.
  const filteredRef = useRef(filtered);
  useEffect(() => { filteredRef.current = filtered; }, [filtered]);

  const toggleSelect = useCallback((variantId, idx, shiftKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const turningOn = !next.has(variantId);
      if (shiftKey && lastToggled.current != null) {
        // Shift extends from the last row touched, applying THAT row's new
        // state across the range — the convention every mail client taught.
        const [lo, hi] = [Math.min(lastToggled.current, idx), Math.max(lastToggled.current, idx)];
        for (let i = lo; i <= hi; i++) {
          const row = filteredRef.current[i];
          if (!row) continue;
          if (turningOn) next.add(row.variant_id); else next.delete(row.variant_id);
        }
      } else if (turningOn) {
        next.add(variantId);
      } else {
        next.delete(variantId);
      }
      lastToggled.current = idx;
      return next;
    });
  }, []);

  const allVisibleSelected = filtered.length > 0 && filtered.every((v) => selected.has(v.variant_id));
  const someVisibleSelected = filtered.some((v) => selected.has(v.variant_id));

  useEffect(() => {
    if (headCheckRef.current) {
      headCheckRef.current.indeterminate = someVisibleSelected && !allVisibleSelected;
    }
  }, [someVisibleSelected, allVisibleSelected]);

  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((v) => next.delete(v.variant_id));
      else filtered.forEach((v) => next.add(v.variant_id));
      return next;
    });
    lastToggled.current = null;
  };

  const applyBulk = () => {
    const value = normalise(bulkValue);
    if (selected.size === 0) return toast.error('Select some variants first');
    setDraft((prev) => {
      const next = { ...prev };
      for (const id of selected) next[id] = value;
      return next;
    });
    toast.success(value
      ? `Staged ${selected.size} variant${selected.size === 1 ? '' : 's'} to ${value}`
      : `Cleared the shelf on ${selected.size} variant${selected.size === 1 ? '' : 's'}`);
    setSelected(new Set());
    setBulkValue('');
  };

  const discard = () => {
    setDraft({});
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* already best-effort */ }
  };

  /**
   * Written in chunks, because the endpoint refuses more than 500 rows at once
   * and this page can stage far more than that in one click.
   *
   * The header checkbox selects every variant the filters leave on screen —
   * 12,798 of them on the catalogue this was found with — so typing a shelf and
   * pressing Apply staged all of them, and Save came back "Assign at most 500
   * locations in one request." Nothing was written, the draft stayed staged,
   * and the limit appears nowhere on the page. `utils/binWrites.js` is the one
   * place that knows the cap, shared with the warehouse map's slot editor.
   *
   * A refusal part way through is reported as what it is. Each chunk is its own
   * transaction on the server and an accepted one cannot be taken back from
   * here, so the rows that landed are dropped from the draft and the rest stay
   * staged — the number on the Save button afterwards is the number still to
   * write, which is the only honest thing it could say.
   */
  const save = useCallback(async () => {
    if (dirty.length === 0 || saving) return;
    setSaving(true);
    const rows = dirty.map(([variant_id, bin_location]) => ({
      variant_id: Number(variant_id),
      bin_location: normalise(bin_location),
    }));
    const chunked = rows.length > BIN_CHUNK;
    const result = await writeBins(rows, (body) => api.put('/fulfilment/bins', body), {
      onProgress: chunked ? (saved, total) => toast.loading(`Filing ${saved} of ${total}…`, { id: 'shelf-save' }) : undefined,
    });
    if (chunked) toast.dismiss('shelf-save');
    const written = rows.length - result.remaining.length;
    if (result.error) {
      const staged = result.remaining.length;
      toast.error(written > 0
        ? `${result.changed} shelf location${result.changed === 1 ? '' : 's'} saved, then: ${result.error.message}. ${staged} still staged.`
        : (result.error.message || 'Could not save shelf locations'));
    } else {
      toast.success(`${result.changed} shelf location${result.changed === 1 ? '' : 's'} saved`);
    }
    // Drop only what was actually written. What the server refused is still a
    // pending edit and must survive the reload below.
    if (written > 0) {
      const landed = new Set(rows.slice(0, written).map((r) => String(r.variant_id)));
      setDraft((prev) => {
        const next = {};
        for (const [vid, val] of Object.entries(prev)) if (!landed.has(vid)) next[vid] = val;
        try {
          if (Object.keys(next).length) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(next));
          else sessionStorage.removeItem(DRAFT_KEY);
        } catch { /* best-effort */ }
        return next;
      });
      load();
    }
    setSaving(false);
  }, [dirty, saving, load]);

  // Ctrl+S / Cmd+S saves the stage. Filing is keyboard work; the browser's
  // save-page dialog is never what those fingers meant here.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  const anyFilter = query || onlyUnfiled || hideEmpty || binFilter;

  // Ditto marks only make sense against what is actually rendered: repeats are
  // computed over the filtered, sorted list so a filter that isolates one
  // variant still shows its full name.
  const rows = useMemo(() => filtered.map((v, i) => ({
    v,
    repeat: i > 0 && filtered[i - 1].group_name === v.group_name,
  })), [filtered]);

  return (
    <div className="admin-page shelf-page">
      <PageHeader
        icon={MapPin}
        title="Shelf locations"
        subtitle={loading ? 'Loading the catalogue…'
          : dirty.length > 0 ? `${dirty.length} unsaved change${dirty.length === 1 ? '' : 's'} — Ctrl+S saves`
            : `${variants.filter((v) => binOf(v)).length} of ${variants.length} variants filed`}
      >
        <Link to="/admin/warehouse" className="glass-btn glass-btn-sm" title="Draw the floor these codes live on, and set the walk order">
          <MapIcon size={14} aria-hidden="true" /> Warehouse map
        </Link>
        {dirty.length > 0 && (
          <button type="button" className="glass-btn glass-btn-sm" onClick={discard} disabled={saving}>
            <RotateCcw size={14} aria-hidden="true" /> Discard
          </button>
        )}
        <button
          type="button"
          className="glass-btn glass-btn-sm glass-btn-primary"
          onClick={save}
          disabled={dirty.length === 0 || saving}
        >
          <Save size={14} aria-hidden="true" />
          {saving ? 'Saving…' : dirty.length > 0 ? `Save ${dirty.length}` : 'Save'}
        </button>
      </PageHeader>

      {!loading && variants.length > 0 && <StatTiles stats={stats} />}

      {/* Pick a shelf off the floor plan instead of hunting its code in a
          four-hundred-row table. Press a shelf, get its slot grid, file
          straight into a slot. The table below stays — it is still the fastest
          way to file a whole catalogue — but this is how you answer "what is
          on THAT one" without knowing its name first. */}
      {!loading && (
        <WarehouseCard
          title="Pick a shelf to open its slots"
          highlight={slotShelf}
          onPickShelf={setSlotShelf}
          emptyNote="No warehouse map drawn yet — draw one on the Warehouse page and shelves become clickable here."
          aside={(
            <div className="shelf-pick">
              {openShelf ? (
                <>
                  <span className="shelf-pick-label">Selected</span>
                  <strong className="shelf-pick-name">{openShelf.name}</strong>
                  <span className="shelf-pick-meta">
                    {openShelf.levels && openShelf.slots_per_level
                      ? `${openShelf.levels} level${openShelf.levels === 1 ? '' : 's'} × ${openShelf.slots_per_level} slot${openShelf.slots_per_level === 1 ? '' : 's'}`
                      : 'No slot grid set on this shelf'}
                  </span>
                  <span className="shelf-pick-meta">
                    {filedUnderShelf} variant{filedUnderShelf === 1 ? '' : 's'} filed under it
                  </span>
                  {openShelf.levels && openShelf.slots_per_level ? (
                    <button
                      type="button"
                      className="glass-btn glass-btn-sm glass-btn-primary"
                      onClick={() => setSlotShelf(openShelf.name)}
                    >
                      <Boxes size={13} aria-hidden="true" /> Open slots
                    </button>
                  ) : (
                    <Link to="/admin/warehouse" className="glass-btn glass-btn-sm">
                      Set levels & slots
                    </Link>
                  )}
                </>
              ) : (
                <p className="shelf-pick-hint">
                  Press a shelf on the plan to see what is filed on it and drop
                  variants into its slots.
                </p>
              )}
            </div>
          )}
        />
      )}

      <div className="admin-toolbar shelf-toolbar">
        <div className="admin-search">
          <Search size={14} aria-hidden="true" />
          <input
            className="glass-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by product, variant or shelf"
            aria-label="Filter variants"
          />
        </div>

        {!loading && (
          <span className="shelf-count" role="status">
            {filtered.length === variants.length
              ? `${variants.length} variants`
              : `${filtered.length} of ${variants.length}`}
          </span>
        )}

        <div className="shelf-sort" role="group" aria-label="Sort order">
          {[['shelf', 'Shelf'], ['product', 'Product'], ['stock', 'Stock']].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`shelf-sort-btn${sort === key ? ' is-active' : ''}`}
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`pull-chip${hideEmpty ? ' is-active' : ''}`}
          onClick={() => setHideEmpty((v) => !v)}
          aria-pressed={hideEmpty}
          title="Hide variants with nothing on hand"
        >
          <PackageX size={13} aria-hidden="true" /> Hide empty
        </button>

        {anyFilter && (
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => { setQuery(''); setOnlyUnfiled(false); setHideEmpty(false); setBinFilter(''); }}
            title="Clear filters"
          >
            <FilterX size={13} aria-hidden="true" />
          </button>
        )}

        <div className="admin-toolbar-spacer" />

        <div className={`shelf-bulk${selected.size > 0 ? ' has-sel' : ''}`}>
          <span className="shelf-bulk-count">{selected.size} selected</span>
          <input
            type="text"
            className="shelf-bulk-input"
            value={bulkValue}
            onChange={(e) => setBulkValue(e.target.value)}
            placeholder="Shelf"
            maxLength={32}
            list="shelf-known-bins"
            aria-label="Shelf location to apply to the selection"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyBulk(); } }}
          />
          <button type="button" className="glass-btn glass-btn-sm" onClick={applyBulk} disabled={selected.size === 0}>
            <Wand2 size={13} aria-hidden="true" /> Apply
          </button>
        </div>
      </div>

      {/* The warehouse at a glance: every shelf in use, tap one to see what
          lives on it. Doubles as a typo detector — a lone "A11" beside a
          well-populated "A1" is a mistake you can SEE. */}
      {!loading && shelves.length > 0 && (
        <nav className="shelf-legend" aria-label="Shelves in use">
          {shelves.map(([bin, count]) => (
            <button
              key={bin}
              type="button"
              className={`shelf-legend-chip${binFilter === bin ? ' is-active' : ''}`}
              onClick={() => setBinFilter((cur) => (cur === bin ? '' : bin))}
              aria-pressed={binFilter === bin}
            >
              {bin}
              <span className="shelf-legend-n">{count}</span>
            </button>
          ))}
        </nav>
      )}

      <datalist id="shelf-known-bins">
        {shelves.map(([bin]) => <option key={bin} value={bin} />)}
      </datalist>

      {error && (
        <div className="glass-card pull-empty">
          <AlertTriangle size={22} aria-hidden="true" />
          <p>{error}</p>
          <button type="button" className="glass-btn glass-btn-sm" onClick={load}>Try again</button>
        </div>
      )}

      {!error && loading && (
        <div className="pull-skeleton" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="pull-skel-row" style={{ '--i': i }} />)}
        </div>
      )}

      {!error && !loading && (
        <div className="shelf-table-wrap">
          <table className="shelf-table">
            <thead>
              <tr>
                <th scope="col" className="shelf-col-pick">
                  <input
                    ref={headCheckRef}
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label={allVisibleSelected ? 'Deselect all visible variants' : 'Select all visible variants'}
                  />
                </th>
                <th scope="col">Item</th>
                <th scope="col" className="shelf-col-num">Stock</th>
                <th scope="col" className="shelf-col-bin">Shelf</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ v, repeat }, i) => (
                <ShelfRow
                  key={v.variant_id}
                  v={v}
                  idx={i}
                  repeat={repeat}
                  value={binOf(v)}
                  changed={normalise(binOf(v)) !== normalise(v.bin_location || '')}
                  selected={selected.has(v.variant_id)}
                  onBin={setBin}
                  onBlurBin={blurBin}
                  onToggle={toggleSelect}
                  onNav={navRow}
                />
              ))}
            </tbody>
          </table>

          {filtered.length === 0 && (
            <div className="glass-card pull-empty">
              <Search size={22} aria-hidden="true" />
              <p>No variants match that filter.</p>
            </div>
          )}
        </div>
      )}

      {/* Filing from the plan. Assignments land in the SAME draft the table
          edits, so the two are one pending change with one Save — a grid that
          wrote straight through would have the page showing saved and unsaved
          shelf codes side by side with no way to tell them apart. */}
      {openShelf && openShelf.levels && openShelf.slots_per_level && (
        <SlotGrid
          shelf={openShelf}
          variants={variants}
          occupantsByBin={occupantsByBin}
          lede="They join this page's pending changes — press Save to write them."
          onAssign={(variantId, bin) => { setBin(variantId, bin || ''); bustShelfContents(openShelf.name); }}
          onClose={() => setSlotShelf(null)}
        />
      )}
    </div>
  );
}
