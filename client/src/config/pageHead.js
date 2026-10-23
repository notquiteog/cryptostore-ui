/**
 * What the tab says on each storefront route, and which routes are one
 * person's business.
 *
 * The server writes a title, description and robots directive into the head
 * of every page it serves (server/services/seo.js), which is what a crawler
 * or a chat unfurler reads. A visitor who then clicks around never loads a
 * page again — the router swaps the view — so the tab would keep the first
 * page's title for the whole visit unless the client re-writes it. This file
 * is the client's half of that: the route defaults, applied by the Layout on
 * every navigation (utils/documentHead.js), with the pages that know more
 * (a product's name, a category, an operator page's title) layering their
 * own on top through hooks/useDocumentHead.js.
 *
 * PRIVATE_SEGMENTS and PRIVATE_TITLES mirror `server/utils/spaRoutes.js` and
 * `PRIVATE_TITLES` in `server/services/seo.js` word for word, on purpose and
 * by hand: this file is imported by the client bundle and cannot require the
 * server's. `server/test/spaRoutes.test.js` reads this file as text and fails
 * the moment the two lists name different pages or title one differently —
 * a tab that says "Your cart" in the browser and "Cart" to a crawler is the
 * kind of drift nobody notices until a search result shows the wrong one.
 *
 * Titles are the page's own words. "Your orders" is what the orders page
 * puts in its <h1>; the tab should not call it something else.
 */

/** Routes that are somebody's account, cart or console: never indexed. */
export const PRIVATE_SEGMENTS = new Set([
  'login', 'register', 'cart', 'checkout', 'orders', 'profile', 'support',
  'wishlist', 'subusers', 'referral', 'membership', 'admin',
]);

/** The tab title for each private route, by first path segment. */
export const PRIVATE_TITLES = {
  login: 'Sign in',
  register: 'Create an account',
  cart: 'Your cart',
  checkout: 'Checkout',
  orders: 'Your orders',
  profile: 'Your profile',
  support: 'Support',
  wishlist: 'Wishlist',
  subusers: 'Sub-users',
  referral: 'Sub-users',
  membership: 'Membership',
  admin: 'Admin',
};

/**
 * Public routes with a fixed name. The catalogue and the product page refine
 * these from their data; the operator pages take their title from settings
 * and have no default here because the page itself is the only reader that
 * knows it.
 */
export const PUBLIC_TITLES = {
  products: 'Catalog',
  canary: 'Warrant canary',
};

/** First path segment, decoded, or '' for the root. */
export function rootSegment(pathname) {
  const seg = String(pathname || '/').split('/')[1] || '';
  try { return decodeURIComponent(seg); } catch { return seg; }
}

export const isPrivatePath = (pathname) => PRIVATE_SEGMENTS.has(rootSegment(pathname));

/** Whether the route shows the catalogue, which a guest-locked store hides. */
export const isCatalogPath = (pathname) => rootSegment(pathname) === 'products';

/**
 * The defaults for a route before its page has said anything.
 *
 * @returns {{ title: string|null, isHome: boolean, isPrivate: boolean, isCatalog: boolean }}
 */
export function routeDefaults(pathname) {
  const seg = rootSegment(pathname);
  // A public default names the page itself, not its subtree: `/products` is
  // the catalogue, `/products/12` is a product whose name the page will
  // supply, and until it does the store's own name is the honest title.
  const bare = String(pathname || '/').replace(/\/+$/, '').split('/').length <= 2;
  return {
    title: PRIVATE_TITLES[seg] || (bare ? PUBLIC_TITLES[seg] : null) || null,
    isHome: seg === '',
    isPrivate: PRIVATE_SEGMENTS.has(seg),
    isCatalog: seg === 'products',
  };
}

/**
 * The one address a catalogue page answers to: its category and page number
 * and nothing else — not the sort, not the search, not a stock filter. Same
 * shape as `catalogPath` in server/services/seo.js, which builds the sitemap
 * and the served canonical from it.
 */
export function catalogPath({ category = '', page = 1 } = {}) {
  const params = [];
  if (category) params.push(`category=${encodeURIComponent(category)}`);
  if (Number(page) > 1) params.push(`page=${Number(page)}`);
  return `/products${params.length ? `?${params.join('&')}` : ''}`;
}
