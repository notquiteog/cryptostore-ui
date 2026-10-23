// Extension included: this module is imported by a node test, and node's
// ESM resolver does not do Vite's extensionless lookup.
import { STORE_PAGES } from './storePages.js';

/**
 * Every destination inside this storefront that operator-authored content is
 * allowed to point at, once.
 *
 * ── Why a roster and not a URL field ───────────────────────────────────────
 *
 * Operators author two things that link: the footer, and the home page's
 * promises. Both store link IDS, never URLs — a stored URL is one typo'd
 * `javascript:` away from being a stored payload, and every destination worth
 * offering is a route this client already owns. `server/config/pageKeys.js`
 * owns the same id list (`FOOTER_LINK_IDS`) and enforces it on write, so the
 * two ends agree about what is linkable.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 *
 * The definitions and the three filters below lived inside StoreFooter, which
 * was fine until a second surface needed them. Copying them would have been
 * this repository's own recurring failure — the same rule implemented twice,
 * diverging the first time a page is renamed. The promises section and the
 * footer now resolve a link the same way, or neither of them does.
 */
const LINK_DEFS = {
  home: { to: '/', label: 'Home' },
  products: { to: '/products', label: 'Products' },
  support: { to: '/support', label: 'Support', needsAuth: true, note: 'signed-in visitors only' },
  // The KEY stays `referral`: it is what store_settings holds for operators
  // who already chose to show this link, and renaming it would silently
  // switch the link off on every store that had it on. Only the label and
  // the destination move.
  referral: { to: '/subusers', label: 'Sub-users', needsAuth: true, note: 'signed-in visitors only' },
  membership: { to: '/membership', label: 'Membership', needsAuth: true, note: 'signed-in visitors only' },
  wishlist: { to: '/wishlist', label: 'Wishlist', needsAuth: true, note: 'signed-in visitors only' },
  // The operator-authored pages, from the one roster that also builds their
  // routes and their admin editors (config/storePages.js). Listing them here
  // as well is how a page ends up linkable in the footer months before — or
  // after — it is reachable at all.
  ...Object.fromEntries(STORE_PAGES.map((p) => [p.key, {
    to: p.path,
    label: p.label,
    pageFlag: p.keys.enabled,
    titleKey: p.keys.title,
    note: 'shows once the page is published',
  }])),
  // The store's armored public key, served by the API itself — a buyer who
  // wants to encrypt to the store should never have to ask staff for it.
  pgp: { href: '/api/store-pgp/public', label: 'PGP Key', note: "the store's armored public key" },
};

/** Ids in the order the pickers offer them. */
export const STORE_LINK_IDS = Object.keys(LINK_DEFS);

/**
 * What an operator picking a destination is offered — the footer's link
 * checklist and the promises editor's dropdown read the same list, in the
 * same order, with the same caveats.
 *
 * `note` exists because two of the three filters below are invisible at
 * authoring time: a ticked box that renders nothing because the page is
 * unpublished, or because the visitor is a guest, is a bug report waiting to
 * be filed against a feature working exactly as intended.
 */
export const STORE_LINK_PICKER = STORE_LINK_IDS.map((id) => ({
  id,
  label: LINK_DEFS[id].label,
  note: LINK_DEFS[id].note,
}));

/** The label a picker shows for an id, before the operator has renamed the
 *  page it points at. */
export const storeLinkLabel = (id) => LINK_DEFS[id]?.label || id;

/**
 * Resolve one stored id against the live store.
 *
 * Returns null when the link should not be drawn at all:
 *
 *   - an id this build does not know (a blob written by an older client),
 *   - a destination that needs a session when there isn't one — a link that
 *     walks a guest into a login wall is an advertisement for a door they
 *     cannot open,
 *   - a custom page the operator has unpublished, so unchecking a page
 *     anywhere removes its links everywhere at once rather than publishing a
 *     link to a 404.
 *
 * The label follows the operator's own page title when they have set one.
 */
export function resolveStoreLink(id, { settings = {}, user = null } = {}) {
  const def = LINK_DEFS[id];
  if (!def) return null;
  if (def.needsAuth && !user) return null;
  if (def.pageFlag && settings[def.pageFlag] !== 'true') return null;
  return {
    id,
    to: def.to,
    href: def.href,
    label: (def.titleKey && (settings[def.titleKey] || '').trim()) || def.label,
  };
}
