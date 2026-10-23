import { STORE_PAGES, adminPagePath } from '../config/storePages.js';

/**
 * Client-side view of the manager permission model.
 *
 * `/auth/me` returns the *effective* permission set — prerequisites already
 * filled in — so everything here is a plain membership test. The server
 * enforces the same rules independently; this layer exists to keep the UI from
 * offering actions that would 403.
 */

/**
 * Permission required to open each admin route. An array means "any of these",
 * used where a page is useful under more than one grant.
 */
export const adminRoutePermissions = {
  '/admin/dashboard': 'analytics.dashboard',
  '/admin/products': 'products.view',
  '/admin/orders': 'orders.view',
  // Fulfilment. Every one of these must be listed: an unlisted path resolves
  // to "no permission required", which hasAdminPermission reads as yes.
  '/admin/pull-list': 'orders.pick',
  '/admin/stock': ['products.count', 'products.stock', 'products.receive', 'orders.returns'],
  '/admin/pack': 'orders.pick',
  '/admin/ship': ['orders.update_status', 'orders.tracking'],
  '/admin/manifest': ['orders.update_status', 'orders.tracking'],
  '/admin/shelves': 'products.stock',
  '/admin/warehouse': 'products.stock',
  '/admin/users': 'users.view',
  '/admin/disputes': 'disputes.view',
  '/admin/support': 'support.view',
  '/admin/cash-mail': 'orders.cash_mail',
  '/admin/zelle': 'orders.zelle',
  '/admin/theme': ['settings.theme', 'settings.view'],
  '/admin/settings': 'settings.view',
  '/admin/nodes': 'nodes.view',
  '/admin/risk': ['settings.advanced', 'nodes.view', 'orders.recipient_stats', 'settings.pgp', 'settings.bots', 'settings.security'],
  // Catalogue hygiene is the product list with filters on it: same grant.
  '/admin/catalog-health': 'products.view',
  // Every `ai_` key resolves to settings.security on write, and the page's
  // route says so; it was missing here, which "an unlisted path resolves to
  // no permission required" read as every manager seeing the link.
  '/admin/ai': 'settings.security',
  '/admin/audit-log': 'analytics.audit_log',
  '/admin/coupons': 'settings.coupons',
  '/admin/api-keys': 'settings.api_keys',
  '/admin/pgp': 'settings.pgp',
  '/admin/canary': 'settings.pgp',
  '/admin/invite-links': 'users.invite_links',
  '/admin/analytics': ['analytics.reports', 'analytics.revenue'],
  // Its own grant, not any-of with users.invite_links: reading what a campaign
  // did and being able to mint a link that changes what people pay are
  // different trusts, and a link-issuer without this would open a page whose
  // only fetch 403s. The page renders its create, edit and stop controls only
  // for somebody who also holds users.invite_links.
  '/admin/marketing': 'analytics.marketing',
  '/admin/flash-sales': 'products.flash_sales',
  '/admin/store-credit': 'analytics.store_credit',
  '/admin/tiers': 'users.tiers',
  '/admin/reviews': 'products.reviews',
  // Read with any settings scope, but the page renders read-only without
  // settings.security — every `rl_` key maps to it on write.
  '/admin/limits': ['settings.security', 'settings.view'],
  // Pages are store identity; every page_ key maps to settings.store on write,
  // so one grant covers the whole section. Each editor is listed as well as the
  // section itself: an unlisted path resolves to "no permission required",
  // which `hasAdminPermission` reads as yes — a map with holes in it hands out
  // access rather than withholding it.
  // The home page's promises band: store identity, same grant as the pages.
  '/admin/home': ['settings.store', 'settings.view'],
  '/admin/pages': ['settings.store', 'settings.view'],
  ...Object.fromEntries(
    STORE_PAGES.map((p) => [adminPagePath(p.key), ['settings.store', 'settings.view']])
  ),
};

// Order used to pick a landing page for a manager whose grants do not include
// the dashboard. Roughly "most likely to be their actual job" first.
const adminRouteOrder = [
  '/admin/dashboard',
  '/admin/orders',
  '/admin/pack',
  '/admin/ship',
  '/admin/pull-list',
  '/admin/products',
  '/admin/shelves',
  '/admin/warehouse',
  '/admin/users',
  '/admin/disputes',
  '/admin/support',
  '/admin/cash-mail',
  '/admin/zelle',
  '/admin/nodes',
  '/admin/risk',
  '/admin/audit-log',
  '/admin/coupons',
  '/admin/invite-links',
  '/admin/analytics',
  '/admin/marketing',
  '/admin/flash-sales',
  '/admin/store-credit',
  '/admin/tiers',
  '/admin/reviews',
  '/admin/catalog-health',
  '/admin/api-keys',
  '/admin/pgp',
  '/admin/canary',
  '/admin/theme',
  // The concrete editor, not the section: `/admin/pages` only redirects here,
  // and a landing page that immediately bounces is a landing page that flashes.
  adminPagePath(STORE_PAGES[0].key),
  '/admin/home',
  '/admin/limits',
  '/admin/settings',
];

/**
 * Does this user hold `permission`? Pass an array to test for any of them.
 * Admins hold everything; users hold nothing.
 */
/**
 * May this viewer unlock the store key to read an encrypted block?
 *
 * One answer for every surface that shows one — an order's address, a
 * support message, a dispute, the chat — so a staff member who can decrypt
 * an address on the order page is never told they cannot decrypt the same
 * block pasted into a ticket. The server enforces the same grant on the
 * decrypt route; this only decides whether to draw the button.
 */
export function canDecryptBlocks(user) {
  return hasAdminPermission(user, 'orders.decrypt_address');
}

export function hasAdminPermission(user, permission) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role !== 'manager') return false;
  if (!permission) return true;

  const held = Array.isArray(user.permissions) ? user.permissions : [];
  const wanted = Array.isArray(permission) ? permission : [permission];
  return wanted.some((p) => held.includes(p));
}

/** Does this user hold every one of `permissions`? */
export function hasAllAdminPermissions(user, permissions) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const held = Array.isArray(user.permissions) ? user.permissions : [];
  return (permissions || []).every((p) => held.includes(p));
}

export function canAccessAdminPath(user, path) {
  return hasAdminPermission(user, adminRoutePermissions[path]);
}

export function getDefaultAdminPath(user) {
  return adminRouteOrder.find((path) => canAccessAdminPath(user, path)) || null;
}

/**
 * Convenience bundle for pages that gate several controls at once, so a
 * component reads `can.cancelOrder` instead of repeating the string.
 */
export function adminCapabilities(user) {
  const has = (p) => hasAdminPermission(user, p);
  return {
    isAdmin: user?.role === 'admin',
    isStaff: user?.role === 'admin' || user?.role === 'manager',
    has,

    // Orders
    viewOrders: has('orders.view'),
    seeCustomer: has('orders.view_customer'),
    seeShipping: has('orders.view_shipping'),
    seePayment: has('orders.view_payment'),
    seeTotals: has('orders.view_totals'),
    // The fulfilment pair, so the order page can offer a route to the bench
    // and the desk instead of only the status buttons. Same grants the two
    // screens themselves are gated on above.
    pickOrders: has('orders.pick'),
    // Supervising the bench: see who holds which order, and hand a claim back.
    // Its own grant precisely so it is NOT implied by picking — a packer who
    // could break claims could take any order off any colleague.
    superviseBench: has('orders.pick_supervise'),
    // The stock-operations trio. `adjustStock` already existed and now also
    // decides whether a shelf count applies on the spot or waits for approval.
    countStock: has('products.count'),
    receiveStock: has('products.receive'),
    manageReturns: has('orders.returns'),
    updateOrderStatus: has('orders.update_status'),
    bulkUpdateOrders: has('orders.bulk_update'),
    manageTracking: has('orders.tracking'),
    confirmPayment: has('orders.confirm_payment'),
    forceConfirmPayment: has('orders.force_confirm'),
    cancelOrder: has('orders.cancel'),
    // Two separate money grants on purpose. `refundOrder` unlocks a crypto
    // payout; `refundToCredit` only hands back store credit on the store's own
    // books, which is a materially smaller decision an operator should be able
    // to delegate on its own. The order page reads the server's own answer via
    // `order.item_actions`, so these are for surfaces that decide before an
    // order is loaded.
    refundOrder: has('orders.refund'),
    refundToCredit: has('orders.refund_credit'),
    swapOrderItems: has('orders.swap_items'),
    // Writing the shop's own note on an order. Its own grant because the desk
    // that most needs it — support, which takes the call — deliberately holds
    // no fulfilment permission; see 20261113000000_order_staff_note.js.
    noteOrders: has('orders.note'),
    exportOrders: has('orders.export'),
    manageCashMail: has('orders.cash_mail'),
    manageZelle: has('orders.zelle'),
    viewRecipientStats: has('orders.recipient_stats'),

    // Catalog
    createProduct: has('products.create'),
    editProduct: has('products.edit'),
    deleteProduct: has('products.delete'),
    manageMedia: has('products.media'),
    adjustStock: has('products.stock'),
    importProducts: has('products.import'),

    // Users
    createUser: has('users.create'),
    editUser: has('users.edit'),
    banUser: has('users.ban'),
    setPassword: has('users.set_password'),
    deleteUser: has('users.delete'),
    grantPermissions: user?.role === 'admin',
    adjustCredit: has('users.store_credit'),
    seeUserContacts: has('users.view_contact'),

    // Nodes
    viewNodes: has('nodes.view'),
    configureNodes: has('nodes.configure'),
    viewBalances: has('nodes.balance'),
    unlockWallets: has('nodes.unlock'),
    manageWallets: has('nodes.wallet_manage'),
    sendFunds: has('nodes.send'),
  };
}

/**
 * A value the server redacted comes back as null with a `redacted` marker on
 * the record. Rendering that as an empty cell looks like missing data, so give
 * it a visible, explainable placeholder instead.
 */
export const REDACTED_LABEL = 'Hidden';

export function isRedacted(record, field) {
  if (!record?.redacted) return false;
  if (Array.isArray(record.redacted_fields) && record.redacted_fields.includes(field)) return true;
  return record[field] === null || record[field] === undefined;
}
