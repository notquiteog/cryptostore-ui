/**
 * The eleven data-driven cards on the Settings page.
 *
 * Pure data, in its own module, because it has two readers and used to have
 * one. The Settings page maps over it to render the cards; the admin nav's
 * search index (`utils/adminSearchIndex.js`) maps over the same array to
 * generate one search entry per group.
 *
 * That second reader is the reason this moved out of Settings.jsx. Every one
 * of these eleven sections — Telegram, Potato, the Tor proxy, the TOTP
 * tolerance, developer mode — was unreachable from the search for as long as
 * the search has existed, because the index is hand-written and nobody thought
 * to write them down. Searching "telegram", "tor proxy", "2fa" or "authenticator"
 * returned nothing at all, and the index's own worked example ("'tor port'
 * should find the Tor proxy") returned nothing either.
 *
 * A hand-written list would have fixed those eleven and left the twelfth to
 * happen again. Deriving the entries from the array the page actually renders
 * means a group added here is searchable the moment it exists, with no second
 * place to remember. `id` on the card is `group.title`, which is also the
 * search target — one addressing scheme, not two.
 *
 * Icons deliberately stayed behind in Settings.jsx: they are lucide components,
 * and importing them here would pull the icon set into the nav's bundle for the
 * sake of a search index that only ever reads strings.
 */

/** @typedef {{ value: string, label: string }} FieldOption */
/**
 * @typedef {Object} SettingField
 * @property {string} key         the store_settings key this writes
 * @property {string} label       what the operator sees above the control
 * @property {'text'|'password'|'toggle'|'select'|'route'|'shipping_tiers'} type
 * @property {string} [placeholder]
 * @property {string} [hint]
 * @property {FieldOption[]} [options]
 */
/**
 * @typedef {Object} SettingGroup
 * @property {string} title   the card's heading, its `data-settings-section`
 *                            id, and the search target that addresses it
 * @property {SettingField[]} fields
 */

/** @type {SettingGroup[]} */
export const SETTING_GROUPS = [
  {
    title: 'Product import',
    fields: [
      { key: 'scrape_url', label: 'Import API URL', type: 'text' },
      { key: 'scrape_api_key', label: 'Import API Key', type: 'password' },
      // A route, not a Tor toggle: direct, Tor, or the outbound proxy pool
      // (Settings → Outbound proxies). A boolean could not name the pool,
      // which is why every one of these is an enum.
      { key: 'scrape_route', label: 'Import Leaves Via', type: 'route' },
      { key: 'import_schedule_enabled', label: 'Auto-Import Enabled', type: 'toggle' },
      { key: 'import_schedule_interval_hours', label: 'Import Interval (hours)', type: 'text' },
      // The value key keeps its historical name so an operator's saved number
      // survives; `import_price_markup_kind` says how to read it.
      { key: 'import_price_markup_kind', label: 'Markup Is', type: 'select', options: [
        { value: 'percent', label: 'A percentage of each price' },
        { value: 'amount', label: 'A flat amount per item' },
      ]},
      { key: 'import_price_markup_pct', label: 'Price Markup', type: 'text' },
      { key: 'import_price_round_mode', label: 'Round Prices Up To', type: 'select', options: [
        { value: 'none', label: 'No rounding' },
        { value: '99', label: 'X.99' },
        { value: '50', label: 'X.50' },
        { value: '00', label: 'X.00' },
      ]},
      // The same card as the import, because it is the same integration seen
      // from the other end: the URL and key below are what another store types
      // into the two fields at the top of this card.
      { key: 'catalog_feed_access', label: 'Serve Our Catalog To Others', type: 'select', options: [
        { value: 'off', label: 'Off — the endpoint does not answer' },
        { value: 'key', label: 'With a key — only callers who have the secret below' },
        { value: 'public', label: 'Public — anyone may read it' },
      ], hint: 'Publishes every listed product, its stock, its media and its price ladder at GET /api/products/scrape, in the format this store imports — so another operator can point their Import API URL here. Off by default: a machine-readable inventory is a useful document to hand a stranger and an extremely useful one to hand an adversary. Unlisted, inactive and unreleased products are never included.' },
      { key: 'catalog_feed_secret', label: 'Catalog Feed Key', type: 'password',
        hint: 'Required when the setting above is "With a key". The consumer puts this in their Import API Key field. Unrelated to the keys on the API Keys page — those authorise writing this catalog, this one only reads it.' },
    ]
  },
  {
    title: 'Telegram',
    fields: [
      { key: 'telegram_enabled', label: 'Telegram Bot Enabled', type: 'toggle' },
      { key: 'telegram_bot_token', label: 'Bot Token', type: 'password',
        hint: 'From @BotFather — /newbot, then the token it hands back. The command menu behind a '
          + 'client\u2019s "/" button is registered for you when the bot starts. Inline mode (BotFather '
          + '/setinline) is optional and off by default: it lets a buyer search by typing @yourbot in any '
          + 'chat, and nothing is lost without it — /search asks for a name and answers in the chat either way.' },
      { key: 'telegram_route', label: 'Telegram Traffic Leaves Via', type: 'route', hint: 'Takes effect when the bot restarts — the button above does that.' },
    ]
  },
  {
    title: 'Potato chat',
    fields: [
      { key: 'potato_enabled', label: 'Potato Bot Enabled', type: 'toggle' },
      { key: 'potato_bot_token', label: 'Bot Token', type: 'password',
        hint: 'From Potato\u2019s bot platform. This API has no command menu, so buyers discover commands '
          + 'through /help and the buttons. Inline search exists here as it does on Telegram and is off '
          + 'until you enable it for the bot; /search works either way.' },
      { key: 'potato_route', label: 'Potato Traffic Leaves Via', type: 'route', hint: 'Takes effect when the bot restarts — the button above does that.' },
    ]
  },
  {
    title: 'Staff actions on the bots',
    fields: [
      {
        key: 'bot_staff_enabled', label: 'Let staff act from a chat', type: 'toggle',
        hint: 'Adds /queue, /o and /pull for linked staff accounts, and puts buttons on staff alerts so an '
          + 'order can be confirmed or shipped without opening this panel. Every press re-checks the '
          + 'account and its permissions, so a demoted staff member cannot use an old button. Off by default.',
      },
      {
        key: 'bot_staff_sensitive_verbs', label: 'Allow cancelling from a chat', type: 'toggle',
        hint: 'A tap in a chat app is a much weaker authorisation than a browser session on a machine '
          + 'somebody chose to open — a pocket, a shoulder, a synced tablet. With this off, the bots offer '
          + 'only the routine steps. With it on, cancelling still needs a typed confirmation naming the '
          + 'order, never a second button.',
      },
    ]
  },
  {
    title: 'Live chat',
    fields: [
      { key: 'live_chat_enabled', label: 'Enable Live Chat', type: 'toggle' },
    ]
  },
  {
    title: 'Push notifications',
    fields: [
      { key: 'push_route', label: 'Push Traffic Leaves Via', type: 'route' },
    ]
  },
  {
    title: 'Security',
    fields: [
      { key: 'pgp_required', label: 'Require PGP', type: 'toggle' },
      { key: 'pgp_2fa_enabled', label: 'PGP 2FA Enabled', type: 'toggle' },
      // Both of these were read on every authenticator request and appeared in
      // no interface at all — reachable only by typing the key into psql. A
      // setting nobody can find is not a setting, and this one in particular is
      // the string that leaves the server: it is what an authenticator app
      // labels the entry, so it lands in whatever cloud backup that app keeps.
      // The default is deliberately anonymous, which is only a safe default if
      // an operator who wants their store name there can actually put it there.
      {
        key: 'totp_issuer_label',
        label: 'Authenticator label',
        type: 'text',
        placeholder: 'Account',
        hint: 'Shown beside the code in the customer\'s authenticator app, and carried into that app\'s backups. '
          + 'Defaults to the anonymous "Account" — name the store here only if your buyers are not at risk from it.',
      },
      {
        key: 'totp_window_steps',
        label: 'Code tolerance',
        type: 'select',
        // The first option is the server-side default, so an unset key renders
        // as the value that is actually in force rather than as whatever
        // happened to be listed first.
        options: [
          { value: '1', label: '±1 step (±30 seconds) — default' },
          { value: '0', label: 'Exact step only — strictest, unforgiving of clock drift' },
          { value: '2', label: '±2 steps (±60 seconds)' },
          { value: '3', label: '±3 steps (±90 seconds)' },
        ],
        hint: 'How far a customer\'s device clock may drift and still be accepted. Wider is kinder to phones with '
          + 'no network time and to buyers on slow circuits; it also widens the window a shoulder-surfed code stays '
          + 'usable in. Each step is 30 seconds.',
      },
    ]
  },
  {
    // Stays "Tor proxy", not "Arti". Arti is an implementation of Tor, not a
    // different feature, and renaming the section would read to an operator as
    // a new setting unrelated to the one their nodes already use. The
    // implementation is named only in the port hint, which is the one place it
    // changes what they have to type.
    title: 'Tor proxy',
    fields: [
      {
        key: 'tor_host',
        label: 'Tor SOCKS5 Host',
        type: 'text',
        placeholder: '127.0.0.1',
        hint: 'Where the Tor client runs. Almost always this machine. Leave blank for 127.0.0.1.',
      },
      {
        key: 'tor_port',
        label: 'Tor SOCKS5 Port',
        type: 'text',
        placeholder: '9150',
        // The single most likely support question after the move to Arti. An
        // operator upgrading from C tor sees every .onion node go unreachable
        // with an error naming 127.0.0.1, and nothing on this page told them
        // the two implementations listen on different ports by default.
        hint: 'The SOCKS5 port of the Tor client this store dials. Arti listens on 9150; the older C tor '
          + 'daemon listens on 9050. Blank means 9150. TOR_HOST / TOR_PORT in the environment override '
          + 'whatever is set here — Admin → Nodes probes the port, says which value won, and tells you if '
          + 'it finds a Tor client on the other port.',
      },
    ]
  },
  {
    title: 'Catalog',
    fields: [
      {
        key: 'bundles_enabled', label: 'Sell bundles', type: 'toggle',
        hint: 'A bundle is a kit assembled from other products. Turn this on and a product can be '
          + 'marked as one, given a recipe, and built: building takes the components off their '
          + 'shelves and puts finished boxes on the kit\'s. From then on it sells like any other '
          + 'product. Off, none of that appears anywhere.',
      },
      {
        key: 'category_normalize_enabled', label: 'Tidy category names', type: 'toggle',
        hint: 'Categories are free text, so "Flower", "flower", "FLOWER" and "Flower " are four '
          + 'shelves, four entries in the filter and four things to rename later. With this on, a '
          + 'name that matches a category you already have is stored as that one, and a genuinely '
          + 'new name gets its capitals tidied — short all-caps words like CBD and THC are left '
          + 'alone. It also turns on the autofill list of existing categories in the product '
          + 'editor. Applies to imports and the bulk category tools too, not just the editor.',
      },
      {
        key: 'warehouse_enabled', label: 'Track stock by shelf', type: 'toggle',
        hint: 'Shelves, bin locations, the warehouse map, shelf counts and the walk order the pull list picks in. '
          + 'On, a variant\'s stock is spread across named locations and the pull list routes a picker through them. '
          + 'Off, a variant\'s quantity is the whole truth: no bin field in the editor, no map, no counts to approve, '
          + 'and the catalogue health report stops reporting missing shelf locations. Nothing is deleted — the '
          + 'locations you have recorded stay in the database and come back if you switch it on again.',
      },
      {
        key: 'variant_suggestions_enabled', label: 'Suggest the next variant', type: 'toggle',
        hint: 'The product editor proposes the next variant from the ones already there: the '
          + 'halves and quarters of a breakdown pack, the usual steps below a numeric one, or a '
          + 'blank clone carrying the same price and discount tiers. They are pre-filled forms — '
          + 'nothing is created until you press one and save it.',
      },
      {
        key: 'catalog_hide_sold_out', label: 'Hide sold-out products', type: 'toggle',
        hint: 'A product with no variant left to sell is hidden from lists and search; it still '
          + 'opens by direct link so restock alerts keep working. Off, sold-out products stay on '
          + 'the shelf greyed out, and a buyer can ask to be told when they are back. The bots\' '
          + 'shelf is in-stock only either way. Staff see the full catalogue whichever way this is set.',
      },
    ],
  },
  {
    title: 'Reviews',
    fields: [
      { key: 'review_media_enabled', label: 'Allow photos & video on reviews', type: 'toggle' },
    ]
  },
  {
    /**
     * The three decisions about the one column `services/addressCrypto.js`
     * calls the most damaging thing in the schema.
     *
     * Its own card rather than three fields on Shipping, and the split is the
     * one `config/permissions.js` makes: `require_shipping_address` asks
     * whether the shop SELLS something that needs delivering, which a
     * dispatcher may answer; these ask what the shop HOLDS about a buyer and
     * for how long, which is `settings.security`. A card whose keys need two
     * grants is a card nobody holding one of them can save.
     */
    title: 'Address privacy',
    fields: [
      {
        key: 'address_encryption_required', label: 'Encrypt every delivery address', type: 'toggle',
        hint: 'Addresses are encrypted to the store PGP key whether or not the customer asked. Without this, '
          + 'encryption is per-customer opt-in from their profile — so the people with the most to lose are the '
          + 'ones who have to go looking for it. With it on, an order cannot be placed at all while the store key '
          + 'is missing or expired: a requirement that quietly fell back to plaintext would be worse than none. '
          + 'Check the Store PGP key page before switching this on.',
      },
      {
        key: 'address_retention_days', label: 'Forget addresses after', type: 'select',
        options: [
          { value: '0', label: 'Never — keep them forever' },
          { value: '30', label: '30 days after the order finishes' },
          { value: '90', label: '90 days after the order finishes' },
          { value: '180', label: '180 days after the order finishes' },
          { value: '365', label: 'A year after the order finishes' },
          { value: '730', label: 'Two years after the order finishes' },
        ],
        hint: 'A delivered, cancelled or refunded order has no further use for the address, the order notes, the '
          + 'refund address or the Zelle sender name — but it keeps them forever unless you say otherwise, and a '
          + 'seized or copied database hands over every address the shop has ever shipped to. This clears those '
          + 'fields once the order has been finished for that long. Money, line items and the order history are '
          + 'untouched. Orders in flight, and orders in dispute, are never touched.',
      },
      {
        key: 'address_auto_decrypt', label: 'Open encrypted addresses in the browser', type: 'toggle',
        hint: 'Staff who may decrypt addresses see them already open, decrypted in their own browser — so the '
          + 'plaintext is never produced on the server and never crosses the wire. The store key is released to '
          + 'that session once and the release is audited. Off, each address is unwrapped by the server when '
          + 'somebody presses Decrypt, and each read is audited individually. A passphrase-protected key is never '
          + 'released to a browser, so those stores always use the server path whatever this says.',
      },
    ]
  },
  {
    title: 'Shipping',
    fields: [
      { key: 'shipping_tiers', label: 'Shipping Tiers', type: 'shipping_tiers' },
    ]
  },
  {
    title: 'Developer',
    fields: [
      { key: 'developer_mode', label: 'Developer Mode', type: 'toggle' },
    ]
  },
];

/**
 * Everything a group can be found by, straight from its own field data.
 *
 * Derived rather than hand-listed for the reason the whole module is: a
 * keyword list written beside the fields is a list that stops describing them.
 * Option labels are in here because they are often the thing an operator
 * actually remembers — somebody looking for `import_price_round_mode` types
 * "round up to .99", which is an option label and appears in no field name.
 */
export function groupKeywords(group) {
  return [
    group.title,
    ...group.fields.flatMap((f) => [
      f.key, f.label, f.hint, f.placeholder,
      ...(f.options || []).map((o) => o.label),
    ]),
  ].filter(Boolean).join(' ');
}
