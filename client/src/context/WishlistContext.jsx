import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../utils/api';
import { useAuth } from './AuthContext';
import toast from 'react-hot-toast';

/**
 * The one owner of "what is on this account's wishlist" in the client.
 *
 * Before this, three surfaces each kept a private copy: `Products.jsx` and
 * `ProductDetail.jsx` both held their own `wishlistIds` Set with their own
 * near-identical `toggleWishlist`, and the navbar popover fetched `/wishlist`
 * once on first hover and cached it for the life of the page. Nothing
 * connected them, so hearting an item on the catalog never reached the
 * popover — it kept rendering whatever the list looked like the first time it
 * was opened, which for most people is "Nothing saved yet", forever. Exactly
 * the failure CLAUDE.md names for web-versus-bot, one layer down: shared
 * behaviour living in more than one place, so a change lands on one path and
 * quietly misses the rest.
 *
 * `revision` is what the popover watches. It counts committed mutations rather
 * than exposing the rows, because the popover needs more per item than the id
 * set carries (name, variant, price, thumbnail) and that is a server join, not
 * something worth mirroring here. One counter is enough to say "your cached
 * answer is stale"; see `useLazyFetch` in NavMenus.jsx.
 */
const WishlistContext = createContext(null);

export function WishlistProvider({ children }) {
  const { user } = useAuth();
  const [ids, setIds] = useState(() => new Set());
  const [revision, setRevision] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setIds(new Set());
      setLoaded(true);
      return;
    }
    try {
      const list = await api.get('/wishlist/ids');
      setIds(new Set(Array.isArray(list) ? list : []));
    } catch {
      // A failed read leaves the previous answer standing rather than
      // emptying the set: a blank wishlist is indistinguishable from "we
      // could not ask", and the second one must not un-fill every heart on
      // the page the moment the network hiccups.
    } finally {
      setLoaded(true);
    }
  }, [user]);

  // Signing out has to clear it synchronously rather than waiting for a
  // refresh: the next account's hearts must never be drawn from the last
  // one's list, however briefly.
  useEffect(() => {
    if (!user) {
      setIds(new Set());
      setLoaded(true);
      return;
    }
    refresh();
  }, [user, refresh]);

  const has = useCallback((variantId) => ids.has(variantId), [ids]);

  /**
   * Optimistic, and honest when the write fails.
   *
   * The two copies this replaces both ended their request with
   * `.catch(() => {})` — so a rejected POST left the heart filled in and the
   * item nowhere, and the buyer only found out when the wishlist page came up
   * short. The heart moves first because the interaction has to feel
   * immediate, and it moves back if the server refused, with the reason.
   */
  const toggle = useCallback(async (variantId, label) => {
    if (!user) {
      toast.error('Sign in to save items to your wishlist');
      return false;
    }
    const wasOn = ids.has(variantId);
    setIds((prev) => {
      const next = new Set(prev);
      if (wasOn) next.delete(variantId); else next.add(variantId);
      return next;
    });
    try {
      if (wasOn) await api.delete('/wishlist/' + variantId);
      else await api.post('/wishlist', { variant_id: variantId });
      // Only after the server agrees. Bumping optimistically would send the
      // popover to refetch a list that does not contain the change yet.
      setRevision((r) => r + 1);
      return !wasOn;
    } catch (err) {
      setIds((prev) => {
        const next = new Set(prev);
        if (wasOn) next.add(variantId); else next.delete(variantId);
        return next;
      });
      toast.error(err?.message || (wasOn ? 'Could not remove from wishlist' : 'Could not save to wishlist'));
      return wasOn;
    }
  }, [user, ids]);

  /**
   * For surfaces that removed an item by some other route — the wishlist page
   * itself deletes rows directly, and the quick-add in the navbar popover can
   * clear one. They tell the context rather than leaving it to go stale.
   */
  const forget = useCallback((variantId) => {
    setIds((prev) => {
      if (!prev.has(variantId)) return prev;
      const next = new Set(prev);
      next.delete(variantId);
      return next;
    });
    setRevision((r) => r + 1);
  }, []);

  const value = useMemo(
    () => ({ ids, has, toggle, forget, refresh, revision, loaded, count: ids.size }),
    [ids, has, toggle, forget, refresh, revision, loaded],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used within WishlistProvider');
  return ctx;
}
