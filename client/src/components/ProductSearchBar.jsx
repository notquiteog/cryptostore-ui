import { useState, useEffect, useId, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';
import { Search, X } from 'lucide-react';

/**
 * The storefront search box, with a suggestion menu.
 *
 * Two things changed when catalog search moved onto Postgres full text:
 *
 *  1. **The suggestions are ranked and typo-tolerant now.** The endpoint
 *     matches name, description, brand, category and tags, orders by
 *     relevance, and falls back to trigram similarity when nothing matches
 *     exactly — so this list is worth arrowing through, where before it was
 *     the eight lowest ids that happened to contain the substring.
 *  2. **The presentation moved into styles/features/catalog.css.** It used to
 *     be inline, and the inline copy hardcoded `rgba(0,0,0,0.7)` for its drop
 *     shadow and leaned on a dark-only plate — which, once the store gained a
 *     light palette, rendered as a black hole punched into a white page.
 *
 * The markup is the ARIA combobox pattern rather than a list of clickable
 * divs. DOM focus stays on the input and `aria-activedescendant` names the
 * highlighted option, which is what lets a keyboard user arrow through
 * suggestions without the field losing the text they are typing. The previous
 * markup moved a background colour and told assistive technology nothing at
 * all.
 */
export default function ProductSearchBar({ placeholder = 'Search products...', initialQuery = '', style = {} }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const timerRef = useRef(null);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Unique per instance: the navbar and the catalog page both mount one of
  // these, and two elements sharing an id makes aria-activedescendant point at
  // whichever the browser found first.
  const listboxId = useId();
  const optionId = (idx) => `${listboxId}-opt-${idx}`;

  /*
   * Whether the current text got there by someone typing it.
   *
   * The suggestion menu is a response to typing, not to the field having
   * content. Once the navbar's field started echoing the catalog's search term
   * (see Navbar), every arrival on /products?search=… mounted a filled input,
   * which fired the lookup below and dropped an open dropdown over the top of
   * the results the buyer had just navigated to. A ref rather than state
   * because nothing renders differently — it only decides whether the next
   * lookup is allowed to open anything.
   */
  const typedRef = useRef(false);

  // Sync initialQuery changes (e.g. page navigation clears it)
  useEffect(() => {
    typedRef.current = false;
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      setFocusedIdx(-1);
      return;
    }
    // Filled from the outside: show the term, fetch nothing, open nothing.
    // Focusing the field still opens the menu once there is something to open,
    // so the suggestions are one click away rather than gone.
    if (!typedRef.current) {
      setResults([]);
      setOpen(false);
      setFocusedIdx(-1);
      return;
    }
    setLoading(true);
    timerRef.current = setTimeout(() => {
      api.get(`/products/search/autocomplete?q=${encodeURIComponent(query.trim())}`)
        .then(data => {
          setResults(data);
          setOpen(data.length > 0);
          setFocusedIdx(-1);
        })
        .catch(() => { setResults([]); setOpen(false); })
        .finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const submitSearch = (q) => {
    setOpen(false);
    navigate(`/products?search=${encodeURIComponent(q.trim())}`);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      // `results.length` is the "see all results" row, which is a real
      // destination and so belongs in the roving selection rather than being
      // reachable by mouse alone.
      setFocusedIdx(i => Math.min(i + 1, results.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      if (focusedIdx >= 0 && results[focusedIdx]) {
        handleSelect(results[focusedIdx]);
      } else if (query.trim()) {
        submitSearch(query);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setFocusedIdx(-1);
    }
  };

  const handleSelect = (product) => {
    setOpen(false);
    setQuery('');
    navigate(`/products/${product.id}`);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const expanded = open && results.length > 0;
  // Covers the trailing "see all results" row as well as the products, because
  // it is an option in the listbox and a screen reader announcing nothing
  // while the highlight sits on it is the same bug as announcing nothing at
  // all.
  const activeId = expanded && focusedIdx >= 0 && focusedIdx <= results.length
    ? optionId(focusedIdx)
    : undefined;

  return (
    <div ref={containerRef} className="cat-search" style={style}>
      <div className="cat-search-field">
        <Search size={15} className="cat-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          className={`glass-input cat-search-input${query ? ' has-value' : ''}${loading ? ' is-loading' : ''}`}
          placeholder={placeholder}
          value={query}
          onChange={(e) => { typedRef.current = true; setQuery(e.target.value); }}
          onKeyDown={handleKeyDown}
          onFocus={() => results.length > 0 && setOpen(true)}
          autoComplete="off"
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-label={placeholder}
        />
        {query && (
          <button
            type="button"
            className="cat-search-clear"
            onClick={handleClear}
            aria-label="Clear search"
          >
            <X size={14} aria-hidden="true" />
          </button>
        )}
        {loading && <span className="cat-search-spinner" role="status" aria-label="Searching" />}
      </div>

      {expanded && (
        <div className="cat-search-menu" id={listboxId} role="listbox" aria-label="Product suggestions">
          {results.map((product, idx) => (
            <button
              key={product.id}
              type="button"
              id={optionId(idx)}
              role="option"
              aria-selected={focusedIdx === idx}
              // The input keeps DOM focus for the whole interaction, so these
              // must never take it — Tab has to leave the widget, not walk
              // eight suggestions.
              tabIndex={-1}
              className={`cat-search-option${focusedIdx === idx ? ' is-active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(product); }}
              onMouseEnter={() => setFocusedIdx(idx)}
            >
              <span className="cat-search-thumb">
                {product.thumbnail
                  ? <img src={product.thumbnail} alt="" />
                  : <span className="cat-search-thumb-empty" aria-hidden="true">📦</span>}
              </span>

              <span className="cat-search-info">
                <span className="cat-search-name">{product.name}</span>
                <span className="cat-search-price">From ${Number(product.min_price).toFixed(2)}</span>
              </span>
            </button>
          ))}

          <button
            type="button"
            id={optionId(results.length)}
            role="option"
            aria-selected={focusedIdx === results.length}
            tabIndex={-1}
            className={`cat-search-all${focusedIdx === results.length ? ' is-active' : ''}`}
            onMouseDown={(e) => { e.preventDefault(); submitSearch(query); }}
            onMouseEnter={() => setFocusedIdx(results.length)}
          >
            See all results for &ldquo;<strong>{query}</strong>&rdquo;
          </button>
        </div>
      )}
    </div>
  );
}
