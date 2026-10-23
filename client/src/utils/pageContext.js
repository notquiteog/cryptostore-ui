/**
 * Where the person is, as the smallest thing that could possibly be sent.
 *
 * ── Ids, never facts ────────────────────────────────────────────────────────
 *
 * This returns a route name and at most one integer. It deliberately does NOT
 * return the product's name, its price, or anything else the page happens to
 * have loaded, even though all of that is sitting in memory and sending it
 * would save the server a query.
 *
 * The reason is that the server would then be repeating the client's word for
 * it. A modified client could announce a product that does not exist, or one
 * the buyer has no early access to, or a different price — and the assistant
 * would say it back. `server/services/ai/pageContext.js` looks every id up
 * through the catalogue's own visibility rules instead, so the worst a forged
 * payload achieves is an answer about a product the person could already see.
 *
 * ── Derived from the path, not from route params ────────────────────────────
 *
 * The buddy lives in the navbar, which is OUTSIDE the route tree, so
 * `useParams` there returns nothing — it would silently give an empty object
 * on every page rather than failing. Parsing `location.pathname` is what works
 * from where the component actually is, and it is a pure function, which is
 * why it is here with a test rather than inline in the component.
 */

/** Route segments that map straight through with no id. */
const PLAIN = new Set(['products', 'cart', 'orders', 'wishlist', 'support', 'membership', 'subusers', 'profile']);

/**
 * The admin console's desks, by their first path segment.
 *
 * ── Why the console was silent, and why that was not a decision ────────────
 *
 * `AdminCompanion` renders the assistant on every one of these pages, and
 * until this map existed the line below returned `null` for all of them. So a
 * manager standing on the pack bench asking "what is wrong with this one?"
 * sent no context at all, and the staff tools in `services/ai/tools.js` could
 * only fire when the person typed an order number they were already looking
 * at. The half that reads the payload had been built for this from the start
 * — `visibleOrder` in the server's own pageContext takes a capability set and
 * resolves a staff view of somebody else's order — and nothing ever sent it.
 *
 * The `/admin` exclusion had been written on the same line as checkout's, and
 * shared its comment. They are not the same rule. **Checkout stays out**: no
 * feature may compete with somebody completing a payment, and the server
 * enforces it too. The console was never covered by that argument.
 *
 * ── Namespaced, so a desk can never be mistaken for a buyer's page ─────────
 *
 * Every name here starts `admin-`, and that prefix is load-bearing rather than
 * tidy. Emitting a bare `orders` from `/admin/orders` would reach
 * `describe()`'s buyer branch and tell the model "the person is on their order
 * list" — to a manager looking at the shop's whole queue. One vocabulary for
 * two audiences is how that sentence gets written, so there are two.
 *
 * The server keeps its own copy of this list (`ADMIN_ROUTES` there) and drops
 * any of it for an asker whose request does not carry staff capabilities.
 * Duplicated for the reason the checkout omission is duplicated: a rule only
 * one end enforces is a rule one refactor from being gone.
 */
const ADMIN_ROUTES = new Set([
  'dashboard', 'analytics', 'marketing', 'risk', 'audit-log',
  'products', 'flash-sales', 'coupons', 'reviews', 'catalog-health',
  'pack', 'ship', 'manifest', 'pull-list', 'shelves', 'stock', 'warehouse',
  'orders', 'users', 'support', 'disputes', 'tiers', 'invite-links',
  'cash-mail', 'zelle', 'store-credit', 'nodes',
  'theme', 'settings', 'limits', 'ai', 'pgp', 'api-keys',
  'home', 'pages', 'canary',
]);

/**
 * The console's half of the parse.
 *
 * Two desks carry an identifier and the rest carry only their name. Both are
 * ids the server re-resolves — the product through the ADMIN visibility rule
 * rather than the catalogue's, because the page an operator is most likely to
 * ask about is a draft that is not published yet, and the order through the
 * `orders.view` grant that opened the page they claim to be on.
 *
 * `/admin/orders` deliberately carries nothing. Its open order lives in a
 * drawer rather than in the path, so there is no id to send and inventing one
 * from component state would be sending a fact.
 */
function adminContext(parts) {
  const desk = parts[1] ?? '';
  if (!desk) return { route: 'admin' };
  if (!ADMIN_ROUTES.has(desk)) return null;

  // /admin/products/:id/edit — the group being edited. `new` has no id yet.
  if (desk === 'products') {
    const productId = idOf(parts[2]);
    return productId ? { route: 'admin-product', productId } : { route: 'admin-products' };
  }
  // /admin/pack/:id — the order on the bench.
  if (desk === 'pack') {
    const orderId = idOf(parts[2]);
    return orderId ? { route: 'admin-pack', orderId } : { route: 'admin-pack' };
  }
  return { route: `admin-${desk}` };
}

/** Small positive integers only. A uuid or a slug is not an id. */
function idOf(segment) {
  if (!/^\d{1,9}$/.test(segment ?? '')) return null;
  const n = Number(segment);
  return n > 0 ? n : null;
}

/**
 * A full uuid, lower-cased, or nothing. Every order link the storefront
 * writes carries one — the list, the receipt, the home widget, the bots — so
 * "this order" was unanswerable on exactly the page it is asked from until
 * this existed. Still an identifier: the server looks it up through the same
 * ownership rule as a numeric id and believes nothing else about it.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function refOf(segment) {
  return UUID.test(segment ?? '') ? segment.toLowerCase() : null;
}

/**
 * @param {string} pathname
 * @returns {null|{route:string, productId?:number, orderId?:number, orderRef?:string}}
 */
export default function pageContext(pathname) {
  const parts = String(pathname || '/').split('/').filter(Boolean);

  // Nothing on checkout, ever.
  //
  // docs/AI.md §9 rule 1 — nothing may compete with somebody completing a
  // payment, and that includes the assistant volunteering opinions about the
  // basket at the moment it is being paid for. The server omits checkout from
  // its own route whitelist as well, because a rule that only one end enforces
  // is a rule one refactor from being gone.
  if (!parts.length) return { route: 'home' };
  if (parts[0] === 'checkout') return null;
  if (parts[0] === 'admin') return adminContext(parts);

  if (parts[0] === 'products') {
    const productId = idOf(parts[1]);
    return productId ? { route: 'product', productId } : { route: 'products' };
  }
  if (parts[0] === 'orders') {
    // A numeric id or a uuid, whichever the link carried. The receipt at
    // `/orders/:uuid/receipt` is still that order. Anything else in the slot
    // falls back to the plain list route rather than sending junk.
    const orderId = idOf(parts[1]);
    if (orderId) return { route: 'order', orderId };
    const orderRef = refOf(parts[1]);
    return orderRef ? { route: 'order', orderRef } : { route: 'orders' };
  }
  if (PLAIN.has(parts[0])) return { route: parts[0] };
  return null;
}
