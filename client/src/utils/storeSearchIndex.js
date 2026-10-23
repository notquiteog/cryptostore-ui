// Extension included: this module is imported by a node test, and node's ESM
// resolver does not do Vite's extensionless lookup.
import { STORE_PAGES } from '../config/storePages.js';
import { rankEntries } from './searchRank.js';

/**
 * Everything a buyer can jump to from the storefront palette, written down.
 *
 * ── Two kinds of result, one list ───────────────────────────────────────────
 * The palette (components/StoreSearch.jsx) shows the entries in this file —
 * places — alongside things it fetches as the buyer types: products through
 * the catalog's own ranked search, the buyer's orders and support threads
 * through the endpoints those pages already read. This file is only the
 * written half, and it is written for the same reason the admin index is:
 * the destinations are routes on pages that are not mounted, so there is
 * nothing to walk.
 *
 * ── Filtered by access, not greyed ──────────────────────────────────────────
 * An entry the visitor cannot reach is ABSENT from the list. A greyed "Sub-
 * users" row still tells a signed-out visitor that the store has such a
 * thing; a greyed "Lab results" row tells them a page exists that the
 * operator has not published. `visibleStoreEntries` applies the same three
 * gates the router applies — signed in, signed out, staff — plus the public
 * flag a page is published under.
 *
 * ── Checked both ways ───────────────────────────────────────────────────────
 * client/test/storeSearch.test.mjs proves every `path` here is a route the
 * storefront router mounts, and that every storefront route without a
 * parameter has an entry — so a page added to App.jsx and forgotten here
 * fails by name, and an entry left behind after a route is removed does
 * too. The failure that prevents is silent: a result that navigates to a
 * 404, or a page that simply cannot be found.
 */

/**
 * @typedef {Object} StoreSearchEntry
 * @property {string} id        stable, unique — the React key and the option id
 * @property {string} label     what the buyer is looking for
 * @property {string} [hint]    one short line under the label
 * @property {string} path      storefront route
 * @property {string} [keywords] words a buyer would type that the label lacks
 * @property {'in'|'out'|'staff'} [who]  who may see it: signed in, signed out, staff; omit for everyone
 * @property {boolean} [notSubUser]  hide from an account that is itself somebody's sub-user
 * @property {string} [flag]    a public setting that must read 'true' for the entry to exist
 * @property {string} [titleKey] a public setting that overrides the label when set
 * @property {string} group     the palette section it lists under
 */

/**
 * Storefront routes without a parameter, as the router mounts them. The test
 * checks this against App.jsx in both directions.
 */
export const STORE_PATHS = [
  '/', '/products', '/cart', '/checkout', '/orders', '/profile', '/support',
  '/wishlist', '/subusers', '/membership', '/login', '/register', '/canary',
  ...STORE_PAGES.map((p) => p.path),
];

/** @type {StoreSearchEntry[]} */
const WRITTEN = [
  { id: 'home', label: 'Home', path: '/', group: 'Go to', keywords: 'front start landing' },
  { id: 'products', label: 'Browse products', path: '/products', group: 'Go to',
    hint: 'The whole catalogue', keywords: 'catalog catalogue shop all items search' },
  { id: 'cart', label: 'Cart', path: '/cart', group: 'Go to', who: 'in',
    hint: 'What you are about to buy', keywords: 'basket bag' },
  { id: 'checkout', label: 'Checkout', path: '/checkout', group: 'Go to', who: 'in',
    hint: 'Pay for what is in your cart', keywords: 'pay buy order address' },
  { id: 'orders', label: 'Your orders', path: '/orders', group: 'Go to', who: 'in',
    hint: 'Every order, its status and its receipt', keywords: 'track tracking parcel shipped delivered receipt history purchases' },
  { id: 'support', label: 'Support', path: '/support', group: 'Go to', who: 'in',
    hint: 'Tickets and replies', keywords: 'help ticket contact problem dispute' },
  { id: 'wishlist', label: 'Wishlist', path: '/wishlist', group: 'Go to', who: 'in',
    hint: 'Saved items and price watches', keywords: 'saved hearts favourites favorites price watch alert' },
  // Hidden from an account that is itself somebody's sub-user: the panel
  // redirects them and every route behind it refuses them (one level, not a
  // tree — server/utils/subUserAccess.js), so listing it in the palette would
  // be offering a destination that bounces.
  { id: 'subusers', label: 'Sub-users', path: '/subusers', group: 'Go to', who: 'in', notSubUser: true,
    hint: 'People who buy through you', keywords: 'referral invite team credit markup' },
  { id: 'membership', label: 'Membership', path: '/membership', group: 'Go to', who: 'in',
    hint: 'Your tier and the window it is measured over', keywords: 'tier discount vip loyalty spend' },
  { id: 'profile', label: 'Profile & security', path: '/profile', group: 'Go to', who: 'in',
    hint: 'Password, PGP, two-factor, notifications, your data',
    keywords: 'account settings password pgp key totp 2fa two factor notifications export erase delete avatar telegram potato' },
  { id: 'login', label: 'Sign in', path: '/login', group: 'Go to', who: 'out', keywords: 'log in account' },
  { id: 'register', label: 'Create an account', path: '/register', group: 'Go to', who: 'out',
    flag: 'registration_enabled', keywords: 'sign up signup join invite' },
  { id: 'canary', label: 'Warrant canary', path: '/canary', group: 'Pages',
    flag: 'canary_enabled', hint: 'The store’s signed statement, and when it was last renewed',
    keywords: 'signed statement pgp seized warrant' },
  { id: 'admin', label: 'Admin panel', path: '/admin', group: 'Go to', who: 'staff',
    hint: 'Orders, products, settings', keywords: 'staff dashboard manage' },
];

/** The operator-authored pages, from the one roster that also mounts them. */
const PAGE_ENTRIES = STORE_PAGES.map((p) => ({
  id: `page-${p.key}`,
  label: p.label,
  path: p.path,
  group: 'Pages',
  flag: p.keys.enabled,
  titleKey: p.keys.title,
  hint: p.blurb ? p.blurb.split(/\s[—–-]\s|\.\s/)[0] : undefined,
  keywords: p.key,
}));

/** @type {StoreSearchEntry[]} */
export const STORE_SEARCH_ENTRIES = [...WRITTEN, ...PAGE_ENTRIES];

/**
 * The entries this visitor may reach, with operator titles applied.
 * @param {StoreSearchEntry[]} entries
 * @param {{ user?: object|null, settings?: Record<string,string> }} ctx
 */
export function visibleStoreEntries(entries, { user, settings = {} } = {}) {
  const staff = !!user && ['admin', 'manager'].includes(user.role);
  return entries
    .filter((e) => {
      if (e.who === 'in' && !user) return false;
      if (e.who === 'out' && user) return false;
      if (e.who === 'staff' && !staff) return false;
      if (e.notSubUser && user?.is_sub_user) return false;
      if (e.flag && settings[e.flag] !== 'true') return false;
      return true;
    })
    .map((e) => (e.titleKey && settings[e.titleKey] ? { ...e, label: settings[e.titleKey] } : e));
}

export function searchStoreEntries(entries, query) {
  return rankEntries(
    entries,
    query,
    (e) => `${e.label} ${e.group} ${e.hint || ''} ${e.keywords || ''}`,
    (e) => e.label,
  );
}
