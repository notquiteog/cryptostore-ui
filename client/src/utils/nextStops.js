/**
 * Where an operator goes after each admin page — the data half.
 *
 * ── Why the map is a `.js` module and the strip is a `.jsx` component ───────
 *
 * The same split `utils/riskChecks.js` makes, for the same reason: the map is
 * the part worth testing, and `client/test/nextStops.test.mjs` runs under bare
 * `node --test`, which cannot import JSX. A map living inside its own component
 * is a map no test can read — and an untested map is exactly how the seven dead
 * ends this feature exists to close came about in the first place.
 *
 * `components/admin/NextStops.jsx` renders it, and carries the audit that
 * produced it and the rule about permission-filtering.
 */

import { STORE_PAGES, adminPagePath } from '../config/storePages.js';

/**
 * Per route: the two or three things somebody does immediately after being
 * here.
 *
 * Kept to three. §9 asks for "the two or three things a person does
 * immediately after" — a strip of nine is a second navigation menu, and the
 * sidebar is already that.
 */
export const NEXT_STOPS = {
  '/admin/pgp': [
    // The number the page already prints and could not reach. `sealed=other`
    // is the order list's filter for orders whose address is encrypted to a
    // key that is not the active one.
    { to: '/admin/orders?sealed=other', label: 'Orders sealed to another key' },
    { to: '/admin/canary', label: 'Warrant canary' },
    { to: '/admin/settings?hl=Address privacy', label: 'Address privacy' },
  ],
  '/admin/canary': [
    { to: '/admin/pgp', label: 'Store PGP key' },
    { to: '/admin/risk', label: 'Risk board' },
  ],
  '/admin/theme': [
    // The storefront it themes. Not an admin route, so it is the one entry
    // here that leaves the console — which is exactly the point of it: the
    // only way to judge a palette is to look at the shop wearing it.
    { to: '/', label: 'View the storefront' },
    { to: '/admin/home', label: 'Home page' },
    { to: '/admin/settings?hl=Catalog', label: 'Store settings' },
  ],
  '/admin/nodes': [
    { to: '/admin/orders?status=pending_payment', label: 'Orders awaiting payment' },
    { to: '/admin/risk', label: 'Risk board' },
    { to: '/admin/settings?hl=payments', label: 'Payment settings' },
  ],
  '/admin/ai': [
    { to: '/admin/risk', label: 'Risk board' },
    { to: '/admin/analytics', label: 'Analytics' },
    { to: '/admin/settings?hl=Live chat', label: 'Live chat settings' },
  ],
  '/admin/tiers': [
    // A tier is a set of accounts and a discount. Both halves were unreachable.
    { to: '/admin/users', label: 'Accounts and their tiers' },
    { to: '/admin/coupons', label: 'Coupons' },
    { to: '/admin/flash-sales', label: 'Flash sales' },
  ],
  '/admin/cash-mail': [
    { to: '/admin/orders?method=cash_in_mail', label: 'Cash-in-mail orders' },
    { to: '/admin/risk', label: 'Pool capacity' },
  ],
  '/admin/zelle': [
    { to: '/admin/orders?method=zelle', label: 'Zelle orders' },
    { to: '/admin/risk', label: 'Pool capacity' },
  ],
  '/admin/store-credit': [
    { to: '/admin/users', label: 'Accounts' },
    { to: '/admin/audit-log?action=credit', label: 'Credit adjustments' },
  ],
  '/admin/audit-log': [
    { to: '/admin/users', label: 'Accounts' },
    { to: '/admin/risk', label: 'Risk board' },
  ],
  '/admin/catalog-health': [
    { to: '/admin/products', label: 'Products' },
    { to: '/admin/analytics', label: 'Analytics' },
  ],

};

/**
 * Routes that are deliberately terminal, with the reason.
 *
 * Read by the test rather than by the component: its job is to make "this page
 * has no onward path" a decision somebody wrote down, rather than the default
 * that happens when nobody thought about it. That distinction is the whole of
 * what §9 asks for.
 */
export const TERMINAL_ROUTES = {
  // Every list page: its rows ARE its outbound links, which is the shape §9
  // actually wants. A strip under a table of orders would be a second, worse
  // navigation for a page whose first column is already a link.
  '/admin/orders': 'rows link to orders',
  '/admin/products': 'rows link to products',
  '/admin/users': 'rows link to accounts',
  '/admin/support': 'rows link to tickets',
  '/admin/disputes': 'rows link to claims',
  '/admin/reviews': 'rows link to products',
  '/admin/risk': 'every check carries its own links — see utils/riskChecks.js',
  '/admin/marketing': 'rows link to campaigns',
  '/admin/analytics': 'the demand band links to the editor for each product',
  '/admin/coupons': 'rows link to their scope',
  '/admin/flash-sales': 'rows link to products',
  '/admin/invite-links': 'rows link to the accounts that used them',
  '/admin/api-keys': 'rows link to nothing — a key is not a record elsewhere',
  // The console's own hub and its editors.
  '/admin/dashboard': 'the whole page is links',
  '/admin/settings': 'the search and the card rail are its navigation',
  '/admin/limits': 'a registry of numbers; the pages they throttle are in the nav',
  '/admin/home': 'edits the page it links from its own preview',
  '/admin/pages': 'rows link to each editor',
  /**
   * The five store-page editors, generated from the same list every other
   * surface reads rather than typed out five times — `config/storePages.js`'s
   * own header is about exactly that failure, and there is no reason for this
   * map to be the sixth place it happens.
   *
   * Terminal because each editor ALREADY links to the public page it writes,
   * inline beside the content field where somebody deciding to look at it is
   * standing. A strip at the foot repeating that link would be the same
   * destination twice on one screen, which is worse than the dead end this
   * feature exists to close — DESIGN §7: every control must justify its pixels.
   */
  ...Object.fromEntries(STORE_PAGES.map((page) => [
    adminPagePath(page.key),
    'the editor links to the public page inline, next to the content it writes',
  ])),
  // Fulfilment. Every one of these is a queue somebody works down, and the
  // work IS the next step: the whole screen is the action.
  '/admin/pack': 'the queue is the next step',
  '/admin/ship': 'the queue is the next step',
  '/admin/pull-list': 'the list is the next step',
  '/admin/manifest': 'a sheet that gets printed',
  '/admin/stock': 'rows link to variants',
  '/admin/shelves': 'shelves link to their contents',
  '/admin/warehouse': 'the map links to every shelf on it',
};
