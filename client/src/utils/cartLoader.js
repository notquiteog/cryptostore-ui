// Network responses can arrive out of order or after sign-out. Only the newest
// read for the current account may update the shared cart or its error state.
export function createCartLoader({ read, currentUserId, update }) {
  let revision = 0, accountId = null;
  return async function load(userId) {
    if (userId !== currentUserId()) return;
    const request = ++revision;
    if (userId !== accountId) update({ items: [], error: null, hydrated: false });
    accountId = userId;
    if (userId == null) {
      update({ items: [], error: null, hydrated: false, loading: false });
      return;
    }
    update({ loading: true });
    const current = () => request === revision && userId === currentUserId();
    try {
      const items = await read();
      if (current()) update({ items, error: null, hydrated: true, loading: false });
    } catch (err) {
      if (current()) update({ items: [], error: err?.message || 'Could not load your cart', hydrated: true, loading: false });
    }
  };
}
