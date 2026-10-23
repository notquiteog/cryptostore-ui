import { useEffect, useState } from 'react';
import { api } from './api';

/**
 * What is filed on one shelf, fetched once and shared.
 *
 * Module-level cache with the same reasoning as `useWarehouseLayout`: a hover
 * preview fires on mouse-over, a picker sweeps across six shelves on the way
 * to one, and without a cache that is six requests per accidental pass. Shelf
 * contents change about as often as somebody re-files a bin, so a session-long
 * cache is honest — and `bustShelfContents()` clears it after any write that
 * could have moved stock.
 *
 * In-flight requests are shared too, not just completed ones: hovering the same
 * shelf twice before the first answer lands must not issue a second call.
 */

const cache = new Map(); // NAME -> { entries, totals }
const inflight = new Map(); // NAME -> Promise

/** Drop cached shelves after a count, receipt, return or re-file. */
export function bustShelfContents(shelfName) {
  if (shelfName) {
    cache.delete(String(shelfName).toUpperCase());
    inflight.delete(String(shelfName).toUpperCase());
  } else {
    cache.clear();
    inflight.clear();
  }
}

export function fetchShelfContents(shelfName) {
  const name = String(shelfName || '').toUpperCase();
  if (!name) return Promise.resolve(null);
  if (cache.has(name)) return Promise.resolve(cache.get(name));
  if (inflight.has(name)) return inflight.get(name);

  const p = api.get(`/stock/shelves/${encodeURIComponent(name)}/contents`)
    .then((res) => {
      const value = { entries: res.entries || [], totals: res.totals || { entries: 0, units: 0, variants: 0 } };
      cache.set(name, value);
      return value;
    })
    // A shelf that cannot be read is an empty preview, never a thrown error
    // into a hover handler — the map is garnish over the bin string, and a
    // failed fetch must not take the page with it.
    .catch(() => ({ entries: [], totals: { entries: 0, units: 0, variants: 0 }, error: true }))
    .finally(() => inflight.delete(name));

  inflight.set(name, p);
  return p;
}

/**
 * Hook form. `null` while loading so callers can show a skeleton rather than
 * flashing "empty" at a shelf that is merely slow.
 */
export function useShelfContents(shelfName) {
  const [data, setData] = useState(() => {
    const name = String(shelfName || '').toUpperCase();
    return name && cache.has(name) ? cache.get(name) : null;
  });

  useEffect(() => {
    let live = true;
    if (!shelfName) { setData(null); return undefined; }
    const name = String(shelfName).toUpperCase();
    if (cache.has(name)) { setData(cache.get(name)); return undefined; }
    setData(null);
    fetchShelfContents(name).then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [shelfName]);

  return data;
}


