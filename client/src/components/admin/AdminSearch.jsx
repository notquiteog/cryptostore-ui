import { useState, useRef, useEffect, useMemo, useCallback, useId } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { canAccessAdminPath } from '../../utils/adminPermissions';
import { ADMIN_SEARCH_ENTRIES, searchAdminEntries } from '../../utils/adminSearchIndex';
import { useMeaningResults } from '../../utils/paletteMeaning';

/**
 * Find any admin setting from the nav, and land on it.
 *
 * ── What this replaces ─────────────────────────────────────────────────────
 *
 * A search box that lived on the Settings page and filtered that page's cards.
 * It worked, but it could only ever find the sixteen things on one route — so
 * an operator hunting for a rate limit, a node's RPC password or a VIP tier
 * searched, found nothing, and concluded the store had no such setting. The
 * search belongs where the navigation is, because "where is that setting?" is a
 * navigation question.
 *
 * ── Results are permission-filtered, not permission-greyed ─────────────────
 *
 * An entry the viewer cannot reach is absent, not disabled. A greyed row still
 * discloses that the store has a Zelle pool and roughly what is in it — the
 * same reasoning `routes/risk.js` gives for filtering its board per check
 * rather than greying rows out. It also means pressing Enter can never land on
 * a 403.
 *
 * ── The highlight is a promise this component only half keeps ──────────────
 *
 * Choosing a result navigates with `?hl=<target>`; the resolver in AdminLayout
 * is what finds the element and glows it. Split that way because the
 * destination page mounts long after this component has closed, and because a
 * link pasted to a colleague should do the same thing as a click here.
 *
 * ── This component is mounted TWICE ────────────────────────────────────────
 *
 * AdminLayout renders its nav once for the desktop sidebar and once for the
 * mobile drawer, so two of these exist at all times and exactly one of them is
 * displayed. Two consequences are handled explicitly rather than left to luck:
 * the DOM ids are per-instance (`useId`), because two open lists would
 * otherwise both claim `id="admin-search-results"` and break the
 * `aria-controls` and `aria-activedescendant` they hand the screen reader; and
 * the Ctrl/Cmd+K handler only acts on the instance that is actually rendered.
 *
 * That last one worked by accident before it worked by design — `focus()` on a
 * `display: none` input is a no-op, so whichever copy was hidden quietly lost
 * and the visible one happened to win. That is true today on both breakpoints
 * and would stop being true the moment the drawer is hidden by some other
 * means, with the symptom being a keyboard shortcut that focuses nothing.
 */
export default function AdminSearch({ onNavigate }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const wrapRef = useRef(null);
  // Unique per mounted instance — see the note about being rendered twice.
  const uid = useId();
  const listId = `admin-search-results-${uid}`;
  const optionId = (entryId) => `admin-search-opt-${uid}-${entryId}`;

  // Entries this account can actually reach. Computed once per user rather
  // than per keystroke — the permission check walks a route map.
  const reachable = useMemo(
    () => ADMIN_SEARCH_ENTRIES.filter((e) => canAccessAdminPath(user, e.path)),
    [user],
  );

  const wordResults = useMemo(() => searchAdminEntries(reachable, query).slice(0, 8), [reachable, query]);

  /**
   * The second stage: what the operator MEANT, when the words matched nothing.
   *
   * Deliberately not merged with the word results, and not run alongside them.
   * A word hit is a better answer than a meaning hit — the ordering
   * `catalogSearch.js` gives for the storefront and the one `ai_search_floor`'s
   * own hint describes — so this is asked only when the first stage came back
   * empty. It returns [] on a store with AI off, no embedding model or an
   * unreachable one, which is the ordinary case rather than the error case:
   * the list below is then exactly what it was before any of this existed.
   */
  const meaningResults = useMeaningResults(reachable, query, wordResults.length === 0, 'admin');

  // ONE flat list, so the arrow keys, the active index and every aria
  // attribute below carry on operating on `results` without knowing which
  // stage produced them. Two lists would mean two sets of index arithmetic and
  // an `aria-activedescendant` that has to pick between them.
  const results = wordResults.length > 0 ? wordResults : meaningResults;
  const byMeaning = wordResults.length === 0 && meaningResults.length > 0;

  // Clamp rather than reset. Typing another character usually narrows the list,
  // and throwing the selection back to the top each time makes the keyboard
  // path feel like it is fighting you.
  useEffect(() => {
    setActive((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results.length]);

  const go = useCallback((entry) => {
    if (!entry) return;
    setQuery('');
    setOpen(false);
    inputRef.current?.blur();
    // The target rides in the URL rather than in router state so that a
    // refresh, a bookmark or a link pasted into chat all still land on the
    // setting. AdminLayout strips it once it has glowed.
    // The fallback rides along so the resolver can try it without needing the
    // index — a link pasted to a colleague carries everything it needs.
    const params = new URLSearchParams();
    if (entry.target) params.set('hl', entry.target);
    if (entry.fallback) params.set('hl2', entry.fallback);
    const qs = params.toString();
    navigate(qs ? `${entry.path}?${qs}` : entry.path);
    onNavigate?.();
  }, [navigate, onNavigate]);

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!open || results.length === 0) {
      // Enter on an empty or closed list should do nothing rather than submit
      // whatever form the nav happens to sit inside.
      if (e.key === 'Enter') e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[active]);
    }
  };

  // Keep the active row in view when arrowing past the visible edge.
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  // Ctrl/Cmd+K from anywhere in the admin panel. Mounted in the nav, so it is
  // available on every admin route rather than only on Settings — which is
  // where the shortcut used to be, and why it so often did nothing.
  useEffect(() => {
    const onKey = (e) => {
      if (!((e.ctrlKey || e.metaKey) && (e.key || '').toLowerCase() === 'k')) return;
      // Only the displayed copy responds. `offsetParent` is null for anything
      // inside a `display: none` subtree, which is what the hidden one is at
      // either breakpoint, so this picks the same instance the operator can
      // actually see — deterministically, rather than relying on focus() being
      // a no-op on the other one.
      if (!inputRef.current || inputRef.current.offsetParent === null) return;
      e.preventDefault();
      inputRef.current.focus();
      inputRef.current.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // A click anywhere else closes the list. Pointerdown rather than click so the
  // list is gone before a click on the page behind it resolves.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const showList = open && query.trim().length > 0;

  return (
    // `admin-nav-search`, NOT `admin-search`: that name already belongs to the
    // page-toolbar search box in 36-admin-page-furniture.css, and sharing it
    // had the two components styling each other — the toolbar file pinned this
    // component's magnifier over its own placeholder text, and this component's
    // spacing pushed every toolbar search off its baseline.
    <div className="admin-nav-search" ref={wrapRef}>
      <div className="admin-search-field">
        <Search size={15} aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          className="admin-search-input"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search settings…"
          aria-label="Search admin settings"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && results[active] ? optionId(results[active].id) : undefined}
          role="combobox"
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck="false"
        />
        {/* Hidden below the widest breakpoint: on a phone the drawer is already
            narrow and the hint costs more room than it earns. */}
        <kbd className="admin-search-kbd" aria-hidden="true">⌘K</kbd>
      </div>

      {showList && (
        <ul
          className="admin-search-results"
          id={listId}
          role="listbox"
          ref={listRef}
          aria-label="Settings matching your search"
        >
          {results.length === 0 && (
            <li className="admin-search-empty" role="presentation">
              Nothing matches “{query.trim()}”.
            </li>
          )}
          {/* Said out loud, because these rows do NOT contain what was typed
              and a row that does not visibly match the query reads as a bug
              otherwise. It is also the honest label for the trade: these came
              back from a model, the ones above never leave the browser. */}
          {byMeaning && (
            <li className="admin-search-meaning" role="presentation">
              <Sparkles size={11} aria-hidden="true" />
              No setting uses those words — closest by meaning
            </li>
          )}
          {results.map((entry, i) => (
            <li key={entry.id} role="presentation">
              <button
                type="button"
                id={optionId(entry.id)}
                role="option"
                aria-selected={i === active}
                data-active={i === active ? 'true' : undefined}
                className={`admin-search-result${i === active ? ' is-active' : ''}`}
                // Mouse move rather than enter: entering re-selects a row the
                // cursor merely happens to be resting under when the list
                // re-renders, which fights the arrow keys.
                onMouseMove={() => setActive(i)}
                onClick={() => go(entry)}
              >
                <span className="admin-search-result-main">
                  <span className="admin-search-result-label">{entry.label}</span>
                  {entry.hint && <span className="admin-search-result-hint">{entry.hint}</span>}
                </span>
                <span className="admin-search-result-page">{entry.page}</span>
              </button>
            </li>
          ))}
          {results.length > 0 && (
            <li className="admin-search-foot" role="presentation">
              <CornerDownLeft size={12} aria-hidden="true" /> to open
              <span className="admin-search-foot-sep">·</span>
              ↑↓ to choose
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
