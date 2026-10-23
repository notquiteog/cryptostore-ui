import { useCallback, useEffect, useState } from 'react';

/**
 * The cards-or-rows choice for one list, remembered per surface.
 *
 * DESIGN §6 asks every list to answer one question — responsive table, two
 * purpose-built views, or a toggle — and where the answer is "a toggle", it
 * says to persist the choice. Three surfaces had already built that toggle,
 * and no two of them agreed:
 *
 *   · `pages/Orders.jsx`      'cards' | 'list'    persisted as `cs.ordview.v1`
 *   · `admin/Products.jsx`    'grid'  | 'compact'  persisted as its own key
 *   · `admin/Orders.jsx`      'grid'  | 'list'     NOT persisted at all
 *
 * Three spellings of one idea, one of which silently forgot the operator's
 * choice on every navigation — which is the failure mode a shared module
 * exists to make impossible. CLAUDE.md's parity rule is written about the web
 * and the bots, but the reasoning is the same here: shared behaviour lives in
 * one module that every caller uses, and the module's shape should make a
 * single-surface divergence awkward to express.
 *
 * The vocabulary is 'cards' and 'rows', after the two things §6 actually
 * names: dense cards, and compact line items.
 *
 * @param {string} surface  stable id for the list — becomes the storage key
 * @param {'cards'|'rows'} [fallback]  what an operator who has never chosen sees
 * @returns {['cards'|'rows', (next: 'cards'|'rows') => void]}
 */
export default function useViewMode(surface, fallback = 'cards') {
  const key = `cs.view.${surface}.v1`;

  const [mode, setMode] = useState(() => {
    // Read once, in the initialiser, so the first paint is already the
    // remembered view: reading in an effect renders the fallback for a frame
    // and then swaps the whole list under the operator.
    try {
      const stored = localStorage.getItem(key);
      return stored === 'cards' || stored === 'rows' ? stored : fallback;
    } catch {
      // Private mode, or storage disabled. The toggle still works for the
      // length of the session; it just cannot remember.
      return fallback;
    }
  });

  useEffect(() => {
    try { localStorage.setItem(key, mode); } catch { /* private mode */ }
  }, [key, mode]);

  // Guarded rather than trusting the caller: a surface that passes anything but
  // the two words would otherwise write a value the initialiser above refuses
  // to read back, and the toggle would look like it worked until the next
  // reload.
  const choose = useCallback((next) => {
    if (next === 'cards' || next === 'rows') setMode(next);
  }, []);

  return [mode, choose];
}
