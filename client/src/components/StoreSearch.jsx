import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, CornerDownLeft, Package, ShoppingBag, LifeBuoy, FileText, ArrowRight, X,
} from 'lucide-react';
import { api } from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { STORE_SEARCH_ENTRIES, visibleStoreEntries, searchStoreEntries } from '../utils/storeSearchIndex';
import { useMeaningResults } from '../utils/paletteMeaning';

/**
 * Find anything in the store, from anywhere in it.
 *
 * ── What this is, next to the product search ───────────────────────────────
 * The navbar's ProductSearchBar finds products and only products, because the
 * field a buyer types a product name into should not also list "Membership".
 * This palette is for the other question — "where is…" — and it answers it
 * with places (utils/storeSearchIndex.js), the buyer's own orders and support
 * threads, and products too, so the one shortcut is enough. Ctrl/Cmd+K opens
 * it on every storefront page, the way it opens the admin's.
 *
 * ── Copied from AdminSearch on purpose, including the parts that look
 *    incidental ────────────────────────────────────────────────────────────
 * - Per-instance ids from `useId()`. This palette is mounted once today, but
 *   the admin's is mounted twice (sidebar and drawer) and the id collision
 *   that follows breaks `aria-activedescendant` silently. Cheap insurance.
 * - The shortcut acts only when this instance is rendered (`offsetParent`),
 *   for the same reason: a hidden copy must not steal a keystroke.
 * - Results are FILTERED by access, never greyed — a greyed row discloses.
 * - The written half is checked by a test in both directions
 *   (client/test/storeSearch.test.mjs).
 *
 * ── What the buyer's own rows never contain ────────────────────────────────
 * An order row is a reference, a status, an amount and a date; a ticket row
 * is a subject and a status. No address ever renders here — this list is a
 * jump table, and the order page is where the order's detail belongs.
 *
 * ── Async sections and the empty answer ────────────────────────────────────
 * Places rank locally on every keystroke; products, orders and tickets are
 * fetched after a short pause and only from two characters, through the
 * endpoints their pages already read (so the search rules — visibility,
 * redaction, ownership — are theirs, not a second set). A fetch that fails
 * removes its section rather than reporting an error: the palette is a
 * shortcut, and a shortcut that nags is one nobody opens twice.
 */

const MIN_ASYNC = 2;
const DEBOUNCE_MS = 180;

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const shortRef = (uuid, id) => (uuid ? String(uuid).replace(/-/g, '').slice(-8).toUpperCase() : `#${id}`);
const statusWord = (s) => String(s || '').replace(/_/g, ' ');

export default function StoreSearch({ open, onClose }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useTheme();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const timerRef = useRef(null);
  const seqRef = useRef(0);

  const uid = useId();
  const listId = `store-search-results-${uid}`;
  const optionId = (key) => `store-search-opt-${uid}-${key}`;

  // Places this visitor can reach, computed once per user/settings rather
  // than per keystroke.
  const reachable = useMemo(
    () => visibleStoreEntries(STORE_SEARCH_ENTRIES, { user, settings }),
    [user, settings],
  );
  const places = useMemo(() => {
    const q = query.trim();
    // An empty query is the menu: every reachable place, in roster order.
    if (!q) return reachable.filter((e) => e.group === 'Go to').slice(0, 9);
    return searchStoreEntries(reachable, q).slice(0, 6);
  }, [reachable, query]);

  /**
   * Places found by meaning, when the words found none.
   *
   * Only the PLACES stage falls back this way. Products already have their own
   * semantic stage on the server (catalogSearch.js), so a buyer searching for
   * a thing to buy is answered there and asking twice would embed the same
   * sentence a second time for nothing. What has no fallback until now is the
   * navigation half — "where do I see what I ordered" names no page in this
   * store, and a buyer who gets an empty palette concludes the page does not
   * exist.
   *
   * Signed-out visitors reach this too, and the server decides whether they
   * may: it applies the same `ai_anon_allowed` rule the assistant applies,
   * because a public model call is free inference for whoever finds it. Off by
   * default, in which case this returns [] and the palette is exactly what it
   * was.
   */
  const meaningPlaces = useMeaningResults(reachable, query, places.length === 0, 'store');

  // Reset on open; focus the field once it exists.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    setProducts([]); setOrders([]); setTickets([]);
    const t = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(t);
  }, [open]);

  // The async sections.
  useEffect(() => {
    if (!open) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (q.length < MIN_ASYNC) {
      setProducts([]); setOrders([]); setTickets([]); setBusy(false);
      return undefined;
    }
    setBusy(true);
    const seq = ++seqRef.current;
    timerRef.current = setTimeout(async () => {
      const enc = encodeURIComponent(q);
      const [p, o, t] = await Promise.all([
        api.get(`/products/search/autocomplete?q=${enc}`).catch(() => []),
        user ? api.get(`/orders?search=${enc}&limit=5`).catch(() => null) : null,
        user ? api.get(`/support?q=${enc}&limit=5`).catch(() => null) : null,
      ]);
      if (seq !== seqRef.current) return; // a newer keystroke owns the list
      setProducts(Array.isArray(p) ? p.slice(0, 6) : []);
      setOrders(Array.isArray(o?.orders) ? o.orders.slice(0, 5) : []);
      setTickets(Array.isArray(t?.tickets) ? t.tickets.slice(0, 5) : []);
      setBusy(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timerRef.current);
  }, [query, open, user]);

  // One flat, arrow-navigable list with section labels.
  const rows = useMemo(() => {
    const out = [];
    const push = (group, items) => items.forEach((r) => out.push({ ...r, group }));
    push('Products', products.map((p) => ({
      key: `p-${p.id}`, icon: Package, label: p.name, path: `/products/${p.id}`,
      hint: p.min_price != null ? `From ${money(p.min_price)}` : undefined, thumb: p.thumbnail || null,
    })));
    push('Your orders', orders.map((o) => ({
      key: `o-${o.id}`, icon: ShoppingBag, label: `Order ${shortRef(o.uuid, o.id)}`, path: `/orders/${o.id}`,
      hint: `${statusWord(o.status)}${o.total != null ? ` · ${money(o.total)}` : ''}${o.created_at ? ` · ${new Date(o.created_at).toLocaleDateString()}` : ''}`,
    })));
    push('Support', tickets.map((t) => ({
      key: `t-${t.id}`, icon: LifeBuoy, label: t.subject || `Ticket #${t.id}`, path: `/support/${t.id}`,
      hint: statusWord(t.status),
    })));
    push('', places.map((e) => ({
      key: `e-${e.id}`, icon: e.group === 'Pages' ? FileText : ArrowRight, label: e.label, path: e.path, hint: e.hint, group: e.group,
    })));
    // Under their own heading, because these rows do not contain what was
    // typed and an unexplained row that ignores the query reads as a broken
    // search. Last, because a word match is a better answer than a meaning
    // one — the ordering catalogSearch.js gives for products.
    push('Closest by meaning', meaningPlaces.map((e) => ({
      key: `m-${e.id}`, icon: e.group === 'Pages' ? FileText : ArrowRight, label: e.label, path: e.path, hint: e.hint,
    })));
    return out;
  }, [products, orders, tickets, places, meaningPlaces]);

  useEffect(() => {
    setActive((i) => (rows.length === 0 ? 0 : Math.min(i, rows.length - 1)));
  }, [rows.length]);

  const go = useCallback((row) => {
    if (!row) return;
    onClose?.();
    navigate(row.path);
  }, [navigate, onClose]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
    if (rows.length === 0) { if (e.key === 'Enter') e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % rows.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + rows.length) % rows.length); }
    else if (e.key === 'Enter') { e.preventDefault(); go(rows[active]); }
  };

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // Body scroll lock while the sheet is up: on a phone the palette is the
  // page, and the page behind it must not scroll under a thumb.
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const activeRow = rows[active];
  let lastGroup = null;

  return (
    <div className="ss-backdrop glass-plate" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="ss-dialog" role="dialog" aria-modal="true" aria-label="Find anything in the store">
        <div className="ss-field">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            className="ss-input"
            placeholder={user ? 'Products, orders, tickets, pages…' : 'Products and pages…'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeRow ? optionId(activeRow.key) : undefined}
          />
          {busy && <span className="ss-spinner" role="status" aria-label="Searching" />}
          <button type="button" className="ss-close" onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden="true" />
          </button>
        </div>

        <ul ref={listRef} id={listId} role="listbox" className="ss-results" aria-label="Results">
          {rows.length === 0 && query.trim().length >= MIN_ASYNC && !busy && (
            <li className="ss-empty">Nothing matches “{query.trim()}”.</li>
          )}
          {rows.map((row, idx) => {
            const head = row.group !== lastGroup ? row.group : null;
            lastGroup = row.group;
            const Icon = row.icon;
            return (
              <li key={row.key} className="ss-item">
                {head && <div className="ss-group" aria-hidden="true">{head}</div>}
                <button
                  type="button"
                  id={optionId(row.key)}
                  role="option"
                  aria-selected={idx === active}
                  data-active={idx === active ? 'true' : undefined}
                  className={`ss-row${idx === active ? ' is-active' : ''}`}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(idx)}
                  onMouseDown={(e) => { e.preventDefault(); go(row); }}
                >
                  <span className="ss-row-icon" aria-hidden="true">
                    {row.thumb ? <img src={row.thumb} alt="" /> : <Icon size={15} />}
                  </span>
                  <span className="ss-row-main">
                    <span className="ss-row-label">{row.label}</span>
                    {row.hint && <span className="ss-row-hint">{row.hint}</span>}
                  </span>
                  {idx === active && <CornerDownLeft size={13} className="ss-row-enter" aria-hidden="true" />}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="ss-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

/**
 * The shortcut and the open/close state, for whichever nav mounts the
 * palette. Ctrl/Cmd+K toggles; only the rendered copy of the nav responds,
 * which is the `offsetParent` test the admin search documents.
 */
export function useStorePalette(anchorRef) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (!((e.ctrlKey || e.metaKey) && (e.key || '').toLowerCase() === 'k')) return;
      if (anchorRef?.current && anchorRef.current.offsetParent === null) return;
      // The admin panel has its own palette on the same key; this hook is
      // only mounted by the storefront nav, but the guard is cheap.
      if (window.location.pathname.startsWith('/admin')) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [anchorRef]);
  return [open, setOpen];
}
