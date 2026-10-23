/**
 * What an audit row means, in the operator's words rather than the codebase's.
 *
 * `admin_audit_log` stores an action as a dotted identifier — `order.refund_sent`,
 * `user.permissions_updated`, `store_pgp.exported` — and its payload as free-form
 * JSONB. Those are the right things to *store*: they are stable, greppable, and
 * they cost nothing to write from sixty call sites. They are the wrong things to
 * *show*. The page that printed `order.address_decrypted` in a badge and hid
 * `{"order_id":812,"order_uuid":"…"}` behind a "Details" button was asking the
 * person reading it to know the schema, and it gave the single most sensitive
 * event in the table — a buyer's real-world address being revealed — exactly the
 * same weight as `variant.bins_assigned`.
 *
 * This module is the translation layer. Three things live here:
 *
 *  1. **Families.** Twenty-plus action prefixes grouped into the eight things an
 *     operator actually comes here about. The grouping is deliberately task-shaped
 *     rather than schema-shaped (DESIGN §7): money is `payment.` *and* `wallet.`
 *     *and* `zelle.`, because "did anything move funds today" is one question, not
 *     three.
 *  2. **Severity.** Which actions are worth lighting up. DESIGN §3: glow means
 *     live, focused or dangerous — if everything glows, nothing is lit. So the set
 *     of severe actions is kept small and specific, and everything else is quiet.
 *  3. **Payload references.** The keys that name another record, so the feed can
 *     link to it (DESIGN §9: if a field names another record, it is a link).
 *
 * ─── On unknown actions ───
 *
 * Every lookup here falls back rather than throwing or rendering blank, and that
 * is not defensive habit — it is a known, reproduced condition. The seeded test
 * database holds `order.accepted`, `user.banned`, `stock.count_applied` and
 * `pgp_key.replaced`, none of which appear as a string literal anywhere in the
 * server: they are composed at their call sites
 * (`logAction(req, approve ? 'stock.count_approved' : 'stock.count_rejected', …)`,
 * and `botStaff.js` reading `def.audit` out of a table). A registry that only
 * knew the greppable names would silently render a fifth of the live log as
 * empty. Unknown actions get a humanised label and their family's tone, and the
 * raw identifier stays visible on the row so it is never lost.
 */

import {
  Package, Banknote, Boxes, Users, KeyRound, LogIn, SlidersHorizontal, LifeBuoy, Activity,
} from 'lucide-react';

/**
 * The filter chips, in reading order, each owning a set of action prefixes.
 *
 * `prefixes` is what goes to the API — `getAuditLog` takes a comma-separated
 * list of them — so this array is the only place the grouping exists. The
 * server deliberately does not know about families; it matches prefixes.
 */
export const AUDIT_FAMILIES = [
  {
    key: 'orders',
    label: 'Orders',
    icon: Package,
    prefixes: ['order.', 'return.'],
    blurb: 'Claiming, packing, shipping, tracking and returns.',
  },
  {
    key: 'money',
    label: 'Money',
    icon: Banknote,
    prefixes: ['payment.', 'wallet.', 'zelle.', 'store_credit.'],
    blurb: 'Payments confirmed by hand, refunds sent, store credit adjusted, wallet and Zelle operations.',
  },
  {
    key: 'catalog',
    label: 'Catalog',
    icon: Boxes,
    prefixes: ['product.', 'variant.', 'tier.', 'stock.', 'warehouse.'],
    blurb: 'Products, variants, tiers, stock counts and the shelf map.',
  },
  {
    key: 'people',
    label: 'People',
    icon: Users,
    prefixes: ['user.', 'avatar.'],
    blurb: 'Accounts created, banned, deleted; permissions and tiers.',
  },
  {
    key: 'access',
    label: 'Access',
    icon: KeyRound,
    prefixes: ['two_factor.', 'api_key.', 'store_pgp.', 'pgp_key.'],
    blurb: 'Second factors, API keys and the store PGP key.',
  },
  {
    // Staff only — `authController.recordSignIn` writes no row for a
    // buyer — and its own chip rather than a fourth prefix under Access,
    // because "who signed in last night" is the question an investigation
    // opens with, and it should not have to be dug out from between API-key
    // and store-key rows.
    key: 'signins',
    label: 'Sign-ins',
    icon: LogIn,
    prefixes: ['auth.'],
    blurb: 'Staff signing in, and how each proved it was them.',
  },
  {
    key: 'store',
    label: 'Store',
    icon: SlidersHorizontal,
    prefixes: ['settings.', 'node.', 'bot.', 'risk.'],
    blurb: 'Settings, node configuration, bots and risk rescans.',
  },
  {
    key: 'support',
    label: 'Support',
    icon: LifeBuoy,
    prefixes: ['support.', 'dispute.', 'review.', 'chat.'],
    blurb: 'Tickets, disputes, review moderation and chat removals.',
  },
];

/** prefix → family, built once. `order.` → the Orders family. */
const FAMILY_BY_PREFIX = new Map(
  AUDIT_FAMILIES.flatMap((f) => f.prefixes.map((p) => [p, f])),
);

/**
 * The family an unrecognised prefix lands in.
 *
 * Not one of the eight: a new prefix nobody has classified yet must not quietly
 * inflate the Store count and become invisible. It shows as itself.
 */
export const UNFILED_FAMILY = {
  key: 'other',
  label: 'Other',
  icon: Activity,
  prefixes: [],
  blurb: 'Actions from a prefix this page has not been taught to group.',
};

export function familyOf(action) {
  const prefix = String(action || '').split('.')[0] + '.';
  return FAMILY_BY_PREFIX.get(prefix) || UNFILED_FAMILY;
}

/**
 * Actions worth lighting.
 *
 * `severe` is money leaving the store, a buyer's real-world identity being
 * revealed, key material being destroyed or copied out, or someone's access
 * changing. Those are the rows an investigation is looking for and the rows a
 * compromise would produce, so they carry the danger tone and the only glow on
 * the page.
 *
 * `order.address_decrypted` is in here rather than filed under routine order
 * traffic on purpose. CLAUDE.md calls buyer identity the most damaging thing in
 * the schema; the moment it is decrypted is the moment it existed in plaintext,
 * and that belongs at the top of the severity scale even though the operator who
 * did it was almost certainly just packing a box.
 *
 * Everything absent from both sets is routine and stays quiet. Keep it that way:
 * the value of this list is entirely in what it leaves out.
 */
const SEVERE = new Set([
  'order.refund_sent',
  'order.items_refunded_credit',
  'order.address_decrypted',
  'order.address_decrypt_failed',
  'payment.manual_confirm',
  'order.payment_confirmed',
  'wallet.sent',
  // Credit issued by hand is the one balance in the store that is not
  // funded by something a buyer paid — CLAUDE.md's "rewards are funded,
  // never minted" is about exactly this — and a deduction takes money off
  // a customer. Both directions belong with money leaving the store.
  'store_credit.adjusted',
  'user.deleted',
  'user.banned',
  'user.permissions_updated',
  'user.two_factor_cleared',
  'store_pgp.revoked',
  'store_pgp.deleted',
  'store_pgp.exported',
  // Unlocking the store key to read a block somebody pasted is the same act
  // as reading an order's address back, and files beside it for the same
  // reason: sixty failed passphrases in a row is exactly what this log is for.
  'store_pgp.decrypted',
  'store_pgp.decrypt_failed',
  'pgp_key.replaced',
  'api_key.created',
]);

const NOTABLE = new Set([
  'user.created',
  'user.unbanned',
  'user.updated',
  'user.sessions_revoked',
  'user.tier_pinned',
  'api_key.deleted',
  'store_pgp.generated',
  'store_pgp.imported',
  'store_pgp.activated',
  'store_pgp.deactivated',
  'store_pgp.signed',
  'settings.updated',
  'node.config_updated',
  'bot.restarted',
  'wallet.opened',
  'wallet.closed',
  'wallet.locked',
  'wallet.unlocked',
  'zelle.account_created',
  'zelle.account_updated',
  'zelle.account_retired',
  'dispute.resolved',
  'order.cancelled',
  'avatar.unlock',
]);

/**
 * Settings that only change how the store looks.
 *
 * `settings.updated` is one action covering every knob in the console, and the
 * two ends of that range are nothing alike: `theme_glow_strength` is a
 * preference, `session_ip_logging` decides whether the store retains identity
 * data. Graded on its name alone the action has to pick one, and picking
 * "notable" is what the first version did — which on a real store, where
 * settings saves are 10% of the log and almost all of them are somebody nudging
 * the theme, lit 43 of 50 rows amber. That is DESIGN §3's stated failure
 * exactly: if everything glows, nothing is lit.
 *
 * So the grade reads the payload. A save whose keys are *all* cosmetic is
 * routine; anything else is notable. The list is of the cosmetic prefixes
 * rather than the sensitive ones deliberately — a settings key added next year
 * that nobody thought to classify then defaults to notable, which is the
 * direction it is safe to be wrong in.
 */
const COSMETIC_SETTING = /^(theme_|effects_|navbar_|footer_|pwa_|page_)/;

/**
 * `severe` | `notable` | `routine`.
 *
 * The trailing rule catches destruction the two lists above have not been
 * updated for. A `*.deleted` or `*.revoked` that nobody classified should read
 * as at least notable rather than as routine — the failure mode worth designing
 * against is a new destructive action shipping and rendering grey.
 *
 * @param {string} action
 * @param {object} [metadata] parsed payload, where one is needed to grade
 */
export function severityOf(action, metadata) {
  const name = String(action || '');
  if (SEVERE.has(name)) return 'severe';

  if (name === 'settings.updated') {
    const keys = metadata?.keys;
    if (Array.isArray(keys) && keys.length > 0 && keys.every((k) => COSMETIC_SETTING.test(String(k)))) {
      return 'routine';
    }
    return 'notable';
  }

  // A staff sign-in is routine — it is how every working day starts — with one
  // exception graded off the payload the way `settings.updated` is: a sign-in
  // by recovery code means the authenticator is gone or the printed sheet is
  // in somebody's hands, and either is worth an amber row. Lighting every
  // sign-in would put a glow on the first row of every day and teach the
  // reader to skip it.
  if (name === 'auth.login') {
    return metadata?.method === 'recovery_code' ? 'notable' : 'routine';
  }

  if (NOTABLE.has(name)) return 'notable';
  if (/(\.|_)(deleted|delete|removed|revoked|purged)$/.test(name)) return 'notable';
  return 'routine';
}

/**
 * Labels for the actions whose humanised form would be wrong or clumsy.
 *
 * Still partial, and the rule for what belongs here is: **does the humanised
 * suffix name its own subject?** `variant.bins_assigned` humanises to "Bins
 * assigned", which is complete, and writing it out below would only create a
 * second place to keep it in step. `product.created` humanises to "Created",
 * which is a verb with nothing attached — the prefix carried the noun and
 * dropping the prefix threw it away. DESIGN §1: write the noun. Every entry
 * that reads like a bare participle below is here for that reason.
 *
 * `support.priority` is the worst case the humaniser produces on its own: it
 * renders as "Priority", which is not even a verb, and reads as a label for a
 * column that is not there.
 */
const LABELS = {
  // The humaniser would say "Login", a noun that reads as a column heading;
  // the row is a thing that happened. The payload's `method` sits beside it.
  'auth.login': 'Signed in',
  'api_key.created': 'API key created',
  'api_key.deleted': 'API key deleted',
  'avatar.remove': 'Avatar removed',
  'avatar.unlock': 'Avatar unlocked',
  'bot.restarted': 'Bot restarted',
  'dispute.resolved': 'Dispute resolved',
  'order.accepted': 'Order accepted',
  'order.cancelled': 'Order cancelled',
  'order.claimed': 'Order claimed',
  'order.delivered': 'Order delivered',
  'order.shipped': 'Order shipped',
  'product.created': 'Product created',
  'product.deleted': 'Product deleted',
  'product.updated': 'Product edited',
  'return.cancelled': 'Return cancelled',
  'return.closed': 'Return closed',
  'return.opened': 'Return opened',
  'return.received': 'Return received',
  'review.deleted': 'Review deleted',
  'review.moderated': 'Review moderated',
  'risk.rescan': 'Risk rescan',
  'risk.acknowledge': 'Risk acknowledged',
  'stock.count_approved': 'Stock count approved',
  'stock.count_rejected': 'Stock count rejected',
  'stock.received': 'Stock received',
  'store_pgp.activated': 'Store key activated',
  'store_pgp.deactivated': 'Store key deactivated',
  'store_pgp.deleted': 'Store key deleted',
  'store_pgp.generated': 'Store key generated',
  'store_pgp.imported': 'Store key imported',
  'support.priority': 'Ticket priority changed',
  'support.status': 'Ticket status changed',
  'tier.created': 'Tier created',
  'tier.deleted': 'Tier deleted',
  'tier.updated': 'Tier edited',
  'two_factor.disabled': 'Second factor disabled',
  'two_factor.enabled': 'Second factor enabled',
  'user.banned': 'Account banned',
  'user.created': 'Account created',
  'user.deleted': 'Account deleted',
  'user.note_updated': 'Account note edited',
  'user.unbanned': 'Account unbanned',
  'user.updated': 'Account edited',
  'variant.created': 'Variant created',
  'variant.deleted': 'Variant deleted',
  'variant.updated': 'Variant edited',
  'wallet.closed': 'Wallet closed',
  'wallet.locked': 'Wallet locked',
  'wallet.opened': 'Wallet opened',
  'wallet.unlocked': 'Wallet unlocked',
  'zelle.account_created': 'Zelle account added',
  'zelle.account_deleted': 'Zelle account deleted',
  'zelle.account_retired': 'Zelle account retired',
  'zelle.account_updated': 'Zelle account edited',
  'order.status_changed': 'Status changed',
  'order.packed': 'Order packed',
  'order.payment_method_changed': 'Payment rail changed',
  'voucher.issued': 'Credit voucher issued',
  'voucher.voided': 'Credit voucher cancelled',
  'voucher.redeemed': 'Credit voucher redeemed',
  'canary.issued': 'Warrant canary signed',
  'account.exported': 'Account data exported',
  'account.erased': 'Account erased',
  'order.picked_all': 'All lines picked',
  'order.batch_claimed': 'Batch claimed',
  'order.claim_extended': 'Claim hold extended',
  'order.claim_broken': 'Claim released',
  'order.box_shipped': 'Box shipped',
  'order.refund_sent': 'Refund sent',
  'order.items_refunded_credit': 'Items refunded to credit',
  'order.address_decrypted': 'Shipping address decrypted',
  'order.address_decrypt_failed': 'Address decrypt failed',
  'order.auto_accepted': 'Auto-accepted',
  'order.shipping_details_updated': 'Shipping details edited',
  'order.swap_offered': 'Swap offered',
  'order.swap_withdrawn': 'Swap withdrawn',
  'order.swap_accepted': 'Swap accepted',
  'order.swap_declined': 'Swap declined',
  'payment.manual_confirm': 'Payment confirmed by hand',
  'order.payment_confirmed': 'Payment confirmed',
  'wallet.sent': 'Funds sent',
  'store_credit.adjusted': 'Store credit adjusted',
  'user.permissions_updated': 'Permissions changed',
  'user.sessions_revoked': 'Sessions revoked',
  'user.two_factor_cleared': 'Second factor cleared',
  'user.tier_pinned': 'Tier pinned',
  'user.tier_automatic': 'Tier set automatic',
  'two_factor.enrollment_discarded': 'Enrolment discarded',
  'two_factor.recovery_codes_regenerated': 'Recovery codes regenerated',
  'store_pgp.exported': 'Store key exported',
  'store_pgp.revoked': 'Store key revoked',
  'store_pgp.signed': 'Message signed',
  'store_pgp.decrypted': 'Message decrypted with the store key',
  'store_pgp.decrypt_failed': 'Store key decrypt failed',
  'pgp_key.replaced': 'PGP key replaced',
  'settings.updated': 'Settings saved',
  'node.config_updated': 'Node config changed',
  'variant.location_set': 'Shelf location set',
  'warehouse.layout_saved': 'Warehouse layout saved',
  'stock.count_applied': 'Stock count applied',
  'stock.count_filed': 'Stock count filed',
  'support.link_order': 'Order linked to ticket',
  'chat.message_delete': 'Chat message removed',
  'chat.attachment_delete': 'Chat attachment removed',
  'review.media_removed': 'Review media removed',
};

/** `order.tracking_added` → `Tracking added`. */
export function labelOf(action) {
  if (LABELS[action]) return LABELS[action];
  const suffix = String(action || '').split('.').slice(1).join('.') || String(action || '');
  const words = suffix.replace(/[._]/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '—';
}

/**
 * Payload keys that name another record, and where that record lives.
 *
 * Two things are being decided per key: what to call it on screen, and whether
 * there is a route that can show it. `variant_id` has no admin route of its own
 * — variants are edited inside their product group — so it renders as a
 * reference with no link rather than as a link to somewhere that does not exist,
 * which is the more annoying of the two failures.
 *
 * `to` receives the whole metadata object, not just its own value, because the
 * useful link often needs a sibling key: an order is addressed by uuid on the
 * Orders page (`?search=`), but the payload's primary key is `order_id`, and
 * only rows written since the uuid column exists carry both.
 *
 * `consumes` lists the sibling keys a reference has already spoken for, so they
 * do not also appear as loose fields below it. It is per-reference and applied
 * only when that reference actually fires — a blanket "never show `name` as a
 * field" list was the first version of this and it silently swallowed the entire
 * payload of `api_key.created`, whose metadata is `{name}` and nothing else.
 */
const REFERENCES = [
  {
    key: 'order_id',
    label: 'order',
    text: (v, m) => (m.order_uuid ? String(m.order_uuid).split('-')[0].toUpperCase() : `#${v}`),
    to: (v, m) => `/admin/orders?search=${encodeURIComponent(m.order_uuid || v)}`,
    consumes: ['order_uuid'],
    mono: true,
  },
  {
    // Rows that carry only the uuid. Listed after `order_id` so an entry with
    // both renders one reference, not two pointing at the same order.
    key: 'order_uuid',
    label: 'order',
    text: (v) => String(v).split('-')[0].toUpperCase(),
    to: (v) => `/admin/orders?search=${encodeURIComponent(v)}`,
    skipIf: (m) => m.order_id != null,
    mono: true,
  },
  {
    key: 'target_username',
    label: 'account',
    text: (v) => v,
    to: (v, m) => (m.target_id || m.target_user_id
      ? `/admin/users?id=${m.target_id || m.target_user_id}`
      : `/admin/users?search=${encodeURIComponent(v)}`),
    consumes: ['target_id', 'target_user_id'],
  },
  {
    key: 'target_id',
    label: 'account',
    text: (v) => `#${v}`,
    to: (v) => `/admin/users?id=${v}`,
    skipIf: (m) => m.target_username != null,
  },
  {
    key: 'target_user_id',
    label: 'account',
    text: (v) => `#${v}`,
    to: (v) => `/admin/users?id=${v}`,
    skipIf: (m) => m.target_username != null,
  },
  {
    // `user.created` names its new account with `username` + `new_user_id`.
    key: 'new_user_id',
    label: 'account',
    text: (v, m) => m.username || `#${v}`,
    to: (v) => `/admin/users?id=${v}`,
    consumes: ['username'],
  },
  {
    key: 'group_id',
    label: 'product',
    text: (v, m) => m.name || `#${v}`,
    to: (v) => `/admin/products/${v}/edit`,
    consumes: ['name'],
  },
  { key: 'variant_id', label: 'variant', text: (v, m) => m.sku || `#${v}`, consumes: ['sku'] },
  { key: 'dispute_id', label: 'dispute', text: (v) => `#${v}`, to: () => '/admin/disputes' },
  { key: 'ticket_id', label: 'ticket', text: (v) => `#${v}`, to: (v) => `/admin/support/${v}` },
  { key: 'review_id', label: 'review', text: (v) => `#${v}`, to: () => '/admin/reviews' },
  {
    key: 'tier_id',
    label: 'tier',
    text: (v, m) => m.name || `#${v}`,
    to: () => '/admin/tiers',
    consumes: ['name'],
  },
  { key: 'return_id', label: 'return', text: (v) => `#${v}`, to: () => '/admin/stock' },
  {
    key: 'fingerprint',
    label: 'key',
    // The last sixteen hex characters are the short form every PGP tool prints,
    // and the end is the half that differs between two of the store's own keys.
    text: (v) => String(v).replace(/\s/g, '').slice(-16).toUpperCase(),
    to: () => '/admin/pgp',
    mono: true,
  },
  { key: 'coin', label: 'coin', text: (v) => String(v).toUpperCase(), to: () => '/admin/nodes' },
  {
    key: 'box_id',
    label: 'box',
    text: (v, m) => (m.box_number ? `${m.box_number}` : `#${v}`),
    consumes: ['box_number'],
  },
  { key: 'tracking_id', label: 'tracking', text: (v) => `#${v}`, mono: true },
  // The account keys the tier and chat paths use instead of `target_*`. Both
  // guard against a second account chip: `user.tier_pinned` carries `user_id`
  // beside a `tier_id`, and a row claiming two different accounts is worse than
  // one that leaves the id in the payload below.
  {
    key: 'user_id',
    label: 'account',
    text: (v) => `#${v}`,
    to: (v) => `/admin/users?id=${v}`,
    skipIf: (m) => m.target_username != null || m.target_id != null || m.target_user_id != null,
  },
  {
    key: 'author_user_id',
    label: 'author',
    text: (v) => `#${v}`,
    to: (v) => `/admin/users?id=${v}`,
  },
  // A bare name, for the records that have one and no id to hang it on:
  // `product.created` logs `{name, publish_at, announced}` and nothing else, so
  // without this the only human-readable thing about the row — what was
  // created — sat in the payload behind a disclosure. Rendered with no noun
  // label, because the label would be guessing which noun: the action already
  // said "Product created", and "product Cascade Kush" repeats it.
  {
    key: 'name',
    label: '',
    text: (v) => v,
    skipIf: (m) => m.group_id != null || m.tier_id != null || m.variant_id != null,
  },
  { key: 'label', label: '', text: (v) => v },
];

/**
 * The money keys, so an amount renders as `$42.00` rather than as `42.00`.
 *
 * Every NUMERIC column arrives from the API as a string (see `adminFormat.js`),
 * and metadata written from a JS number arrives as a number, so the formatter
 * has to accept both — which `money()` already does through `num()`.
 */
const MONEY_KEYS = new Set([
  'refund_amount', 'amount', 'price', 'total', 'credit', 'value',
  // `store_credit.adjusted` carries all three, and a balance rendered as a
  // bare `386` in a row about money reads as a count of something.
  'requested', 'previous_balance', 'new_balance',
]);

/**
 * Split a payload into the two or three references worth putting on the summary
 * line, and everything else for the expanded view.
 *
 * The split is the whole point of the redesign. An audit payload is
 * heterogeneous — `settings.updated` carries a fifty-element `keys` array,
 * `order.batch_claimed` carries a list of order ids, `user.updated` carries a
 * nested before/after diff — so a fixed column for "details" can only ever hold
 * a JSON dump. Naming the handful of keys that identify a record, and letting
 * the rest fall through to a labelled grid, gets a readable line for actions
 * this file has never heard of.
 *
 * @param {object|string|null} metadata the row's JSONB, parsed or not
 * @returns {{refs: Array, fields: Array, raw: object|string|null}}
 */
export function readPayload(metadata) {
  const meta = parseMetadata(metadata);
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { refs: [], fields: [], raw: meta };
  }

  const refs = [];
  const consumed = new Set();
  for (const ref of REFERENCES) {
    const value = meta[ref.key];
    if (value === undefined || value === null || value === '') continue;
    if (ref.skipIf?.(meta)) continue;
    refs.push({
      key: ref.key,
      label: ref.label,
      text: String(ref.text(value, meta)),
      to: ref.to ? ref.to(value, meta) : null,
      mono: !!ref.mono,
    });
    consumed.add(ref.key);
    for (const sibling of ref.consumes || []) consumed.add(sibling);
  }

  const fields = Object.entries(meta)
    .filter(([key, value]) => !consumed.has(key) && value !== undefined)
    .map(([key, value]) => ({
      key,
      label: key.replace(/_/g, ' '),
      value,
      money: MONEY_KEYS.has(key),
    }));

  return { refs, fields, raw: meta };
}

/**
 * `{from: 'paid', to: 'accepted'}` is the single most common payload shape in
 * the table, and it reads as a transition rather than as two fields. Pulled out
 * so the summary line can show `paid → accepted` inline.
 */
export function readTransition(fields) {
  const from = fields.find((f) => f.key === 'from');
  const to = fields.find((f) => f.key === 'to');
  if (!from || !to) return null;
  return { from: String(from.value ?? '—'), to: String(to.value ?? '—') };
}

/**
 * JSONB arrives parsed through the `pg` driver, but `logAction` stringifies the
 * metadata before inserting it, so a column written by an older path can hold a
 * JSON *string* inside the JSONB. Both shapes are live in the seeded database.
 */
export function parseMetadata(metadata) {
  if (!metadata) return null;
  if (typeof metadata === 'string') {
    try { return JSON.parse(metadata); } catch { return metadata; }
  }
  return metadata;
}
