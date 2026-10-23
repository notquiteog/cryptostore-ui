/**
 * Everything an operator can search for from the admin nav.
 *
 * ── Half written down, half derived ─────────────────────────────────────────
 *
 * The search this replaces lived on the Settings page and built its index by
 * walking the rendered cards. That is the better technique when it is possible,
 * because an index derived from what actually rendered cannot go stale — and it
 * is exactly why the old one worked well for what it covered.
 *
 * It cannot work wholesale here. This search runs from the nav on every admin
 * page, and the settings it has to find are on twenty-eight pages that are NOT
 * mounted. There is nothing to walk. So the index is written down — except
 * where the PAGE is itself data-driven, and then it is derived from the same
 * data (see `GROUP_ENTRIES` at the bottom). Eleven Settings cards come from
 * `config/settingGroups.js`; they were missing from the written half for as
 * long as it existed, which is the argument for deriving whatever can be.
 *
 * The written half's one real weakness — drifting out of step with the pages
 * it describes — is answered by `client/test/adminSearch.test.mjs`, which
 * checks it in BOTH directions: every `path` against the router and every
 * `target` against the file it claims to live in, and every section and
 * addressable control on the Settings page against this index. An entry
 * pointing at a control that does not exist fails by name; so does a control
 * that exists and is not findable.
 *
 * ── Targets ────────────────────────────────────────────────────────────────
 *
 * `target` is what gets highlighted on arrival. The resolver in AdminLayout
 * tries three things in order, so an entry can be as precise as the page allows:
 *
 *   [data-search-target="x"]     an element annotated for this search
 *   [data-settings-section="x"]  a Settings page card, which already had these
 *   #x                            any control with that id — most of the
 *                                 Settings page's inputs already have one
 *
 * Prefer the narrowest target that exists. "Take me to the setting" beats "take
 * me to the page it is on", which is the whole point of the feature.
 *
 * `fallback` is for a target that renders CONDITIONALLY. The Monero daemon
 * fields only exist once XMR RPC is switched on — which is precisely the state
 * a store is NOT in when its operator goes looking for them — so pointing only
 * at `xmr-daemon-host` meant the search navigated correctly and then glowed
 * nothing, on the one visit where the help was needed. The resolver tries
 * `target`, then `fallback`, then gives up. A fallback should be something
 * structural that always renders: the card, not another field inside it.
 *
 * ── Keywords ───────────────────────────────────────────────────────────────
 *
 * `keywords` is for what an operator would TYPE, which is often not what the
 * label says: somebody looking for the age gate types "18", somebody looking
 * for `auto_cancel_hours` types "expire". Labels and page names are matched
 * automatically, so keywords should carry only the words that are missing.
 */

import { SETTING_GROUPS, groupKeywords } from '../config/settingGroups.js';
import { rankEntries } from './searchRank.js';

/** Admin routes, so an entry cannot point at a page that does not exist. */
export const ADMIN_PATHS = [
  '/admin/dashboard', '/admin/analytics', '/admin/risk', '/admin/audit-log',
  '/admin/products', '/admin/flash-sales', '/admin/coupons', '/admin/reviews', '/admin/catalog-health',
  '/admin/pack', '/admin/ship', '/admin/pull-list', '/admin/shelves', '/admin/warehouse',
  '/admin/stock', '/admin/manifest',
  '/admin/orders', '/admin/users', '/admin/support', '/admin/disputes',
  '/admin/tiers', '/admin/invite-links', '/admin/marketing',
  '/admin/cash-mail', '/admin/zelle', '/admin/store-credit', '/admin/nodes',
  '/admin/theme', '/admin/home', '/admin/settings', '/admin/limits', '/admin/ai', '/admin/pgp', '/admin/canary', '/admin/api-keys',
];

/**
 * @typedef {Object} AdminSearchEntry
 * @property {string} id        stable, unique — used as the React key
 * @property {string} label     what the operator is looking for
 * @property {string} [hint]    one short line of context, shown under the label
 * @property {string} path      admin route to navigate to
 * @property {string} [target]  element to scroll to and glow; omit for whole-page entries
 * @property {string} [fallback] coarser target for when `target` renders conditionally
 * @property {string} [keywords] extra words to match on, beyond label and page
 * @property {string} page      nav label of the page it lives on
 */

/**
 * The hand-written half: everything on a page whose controls are laid out one
 * by one, and so cannot be enumerated from data.
 *
 * @type {AdminSearchEntry[]}
 */
const WRITTEN_ENTRIES = [
  // ── Store Settings ────────────────────────────────────────────────────────
  { id: 'branding', label: 'Branding & PWA', page: 'Settings', path: '/admin/settings', target: 'branding',
    hint: 'Store name, tagline, logo, install banner', keywords: 'name tagline icon favicon app install manifest' },
  { id: 'logo', label: 'Store logo', page: 'Settings', path: '/admin/settings', target: 'logo-upload',
    hint: 'Upload the image shown in the navbar', keywords: 'image upload picture brand' },

  { id: 'access', label: 'Access & registration', page: 'Settings', path: '/admin/settings', target: 'access',
    hint: 'Who may browse, who may sign up', keywords: 'signup sign up account invite guest visitor' },
  { id: 'registration-enabled', label: 'Allow new account registration', page: 'Settings', path: '/admin/settings',
    target: 'registration-enabled', keywords: 'signup sign up closed open new accounts' },
  { id: 'require-invite', label: 'Require an invite code', page: 'Settings', path: '/admin/settings',
    target: 'require-invite', fallback: 'registration-enabled',
    keywords: 'invitation referral code gated private' },
  { id: 'invite-source', label: 'Which invites are accepted', page: 'Settings', path: '/admin/settings',
    target: 'registration-invite-source', fallback: 'require-invite',
    hint: 'Staff-issued, customer, or both', keywords: 'admin staff customer subuser sub-user source referral gated' },
  { id: 'registration-closed-message', label: 'Message shown when signups are closed', page: 'Settings',
    path: '/admin/settings', target: 'registration-closed-message', fallback: 'registration-enabled',
    keywords: 'wording notice closed registration signup text explain' },
  { id: 'store-paused', label: 'Pause new orders', page: 'Settings', path: '/admin/settings',
    target: 'store-paused', hint: 'Stop taking orders without closing the shop',
    keywords: 'pause paused holiday vacation away break maintenance suspend stop taking orders checkout till closed' },
  { id: 'store-paused-message', label: 'Message shown while orders are paused', page: 'Settings',
    path: '/admin/settings', target: 'store-paused-message', fallback: 'store-paused',
    keywords: 'wording notice paused pause text explain holiday back' },
  { id: 'guest-browsing', label: 'Allow browsing without an account', page: 'Settings', path: '/admin/settings',
    target: 'allow-guest-browsing', keywords: 'visitor anonymous public catalog logged out' },
  { id: 'age-gate', label: 'Age verification gateway', page: 'Settings', path: '/admin/settings',
    target: 'age-gate-enabled', keywords: '18 21 over adult minimum age dob birth verify' },
  { id: 'age-gate-min', label: 'Minimum age', page: 'Settings', path: '/admin/settings',
    target: 'age-gate-min', fallback: 'age-gate-enabled', keywords: '18 21 years old adult age gate' },
  { id: 'age-gate-dob', label: 'Ask for a date of birth', page: 'Settings', path: '/admin/settings',
    target: 'age-gate-dob', fallback: 'age-gate-enabled', keywords: 'dob birthday born age gate' },
  { id: 'age-gate-remember', label: 'Remember the age check', page: 'Settings', path: '/admin/settings',
    target: 'age-gate-remember', fallback: 'age-gate-enabled', keywords: 'days cookie remember age gate' },
  { id: 'age-gate-decline', label: 'Where a declined visitor goes', page: 'Settings', path: '/admin/settings',
    target: 'age-gate-decline', fallback: 'age-gate-enabled', keywords: 'redirect url leave exit age gate decline' },
  { id: 'age-gate-title', label: 'Age gate headline', page: 'Settings', path: '/admin/settings',
    target: 'age-gate-title', fallback: 'age-gate-enabled',
    keywords: 'wording copy heading title age gate text' },
  { id: 'age-gate-message', label: 'Age gate message', page: 'Settings', path: '/admin/settings',
    target: 'age-gate-message', fallback: 'age-gate-enabled',
    keywords: 'wording copy body text explain age gate' },

  { id: 'payments', label: 'Payment methods', page: 'Settings', path: '/admin/settings', target: 'payments',
    hint: 'Which rails the storefront offers', keywords: 'btc bitcoin ltc litecoin xmr monero crypto coin rails' },
  { id: 'cash-in-mail', label: 'Cash in Mail', page: 'Settings', path: '/admin/settings', target: 'cash-in-mail-enabled',
    keywords: 'envelope post mail cash manual rail' },
  { id: 'cash-mail-hold', label: 'Cash in Mail hold window', page: 'Settings', path: '/admin/settings',
    target: 'cash-mail-hold-hours', keywords: 'hours reserve recipient address rotation hold' },
  { id: 'zelle', label: 'Zelle', page: 'Settings', path: '/admin/settings', target: 'zelle-enabled',
    keywords: 'bank transfer manual rail zelle' },
  { id: 'zelle-hold', label: 'Zelle hold window', page: 'Settings', path: '/admin/settings',
    target: 'zelle-hold-hours', keywords: 'hours reserve recipient account rotation hold' },
  { id: 'recipient-reveal-cap', label: 'Recipient reveal cap', page: 'Settings', path: '/admin/settings',
    target: 'recipient-reveal-cap', hint: 'How many drop accounts one buyer may be shown',
    keywords: 'enumeration harvest anti abuse reveal limit' },
  { id: 'default-cash-in-mail', label: 'New accounts get Cash in Mail', page: 'Settings', path: '/admin/settings',
    target: 'default-cash-in-mail', keywords: 'default signup eligibility per account' },
  { id: 'default-zelle', label: 'New accounts get Zelle', page: 'Settings', path: '/admin/settings',
    target: 'default-zelle', keywords: 'default signup eligibility per account' },
  { id: 'demo-payments', label: 'Demo payments', page: 'Settings', path: '/admin/settings', target: 'demo-enabled',
    hint: 'A rail that takes no money — test checkouts', keywords: 'test fake sandbox no money trial' },
  { id: 'demo-confirm', label: 'Demo confirm delay', page: 'Settings', path: '/admin/settings',
    target: 'demo-confirm-seconds', fallback: 'demo-enabled', keywords: 'seconds test fake sandbox delay' },
  { id: 'auto-cancel-hours', label: 'Auto-cancel unpaid orders', page: 'Settings', path: '/admin/settings',
    target: 'auto-cancel-hours', hint: 'How long an unpaid order survives',
    keywords: 'expire stale timeout unpaid abandoned hours sweep' },
  { id: 'manual-expiry-hours', label: 'Manual rail expiry', page: 'Settings', path: '/admin/settings',
    target: 'manual-expiry-hours', keywords: 'expire stale cash zelle hours timeout' },

  { id: 'features', label: 'Orders', page: 'Settings', path: '/admin/settings', target: 'features',
    hint: 'What happens between the money arriving and the parcel leaving',
    keywords: 'order lifecycle accept finalize finalise auto paid delivered' },
  { id: 'orders-auto-accept', label: 'Accept paid orders automatically', page: 'Settings', path: '/admin/settings',
    target: 'orders-auto-accept', hint: 'Skip the second pair of eyes between paid and accepted',
    keywords: 'auto accept confirm skip staff review paid ship desk' },
  { id: 'auto-finalize-days', label: 'Auto-finalize orders after (days)', page: 'Settings', path: '/admin/settings',
    target: 'auto-finalize-days', hint: 'When a shipped order becomes delivered on its own',
    keywords: 'finalise finalize delivered days shipped dispute complete' },

  { id: 'fulfilment', label: 'Fulfilment', page: 'Settings', path: '/admin/settings', target: 'fulfilment',
    hint: 'How orders are packed and handed over',
    keywords: 'packing pack bench claim tracking number seal box carriers dispatch ship desk parcel fulfillment' },
  { id: 'require-shipping-address', label: 'Ask buyers for a delivery address', page: 'Settings',
    path: '/admin/settings', target: 'require-shipping-address',
    hint: 'Off, checkout asks for no address and stores none — for a shop that does not ship',
    keywords: 'shipping address delivery destination require optional digital download postal recipient checkout fulfilment fulfillment' },
  { id: 'pack-claim-minutes', label: 'Packing claim (minutes)', page: 'Settings', path: '/admin/settings',
    target: 'pack-claim-minutes', hint: 'How long one packer holds an order before an idle claim frees itself',
    keywords: 'fulfilment fulfillment pack packing bench claim lock hold ttl expiry minutes picker' },
  { id: 'pack-require-tracking', label: 'Require box tracking', page: 'Settings', path: '/admin/settings',
    target: 'pack-require-tracking', hint: 'Gate every box on a tracking number before it ships',
    keywords: 'boxes box parcel dispatch tracked tracking label weight ship desk fulfilment fulfillment require' },
  { id: 'pack-seal-on-ship', label: 'Seal a box when it ships', page: 'Settings', path: '/admin/settings',
    target: 'pack-seal-on-ship', hint: 'A sealed box stops accepting changes to what is inside it',
    keywords: 'seal lock freeze contents box shipped fulfilment fulfillment' },
  { id: 'ship-carriers', label: 'Carriers', page: 'Settings', path: '/admin/settings',
    target: 'ship-carriers', hint: 'Suggestions on the Ship desk, so one carrier is not spelled three ways',
    keywords: 'carrier courier usps royal mail dpd ups fedex dispatch suggestions ship desk' },
  { id: 'box-presets', label: 'Box presets', page: 'Settings', path: '/admin/settings',
    target: 'box-presets', hint: 'The cartons you stock, and the weight of each one empty',
    keywords: 'carton mailer tare grams weight preset box packing bench reorder' },
  { id: 'staging-places', label: 'Staging places', page: 'Settings', path: '/admin/settings',
    target: 'staging-places', hint: 'Where a sealed carton is put down, so the Ship desk knows where to walk',
    keywords: 'staging stage bay shelf trolley pallet cage where put down sealed carton dispatch handoff hand off location' },

  { id: 'pricing', label: 'Pricing', page: 'Settings', path: '/admin/settings', target: 'pricing',
    hint: 'Sub-user price rounding, and whether store credit exists at all',
    keywords: 'sub-user subuser markup rounding price round mode charge credit' },
  { id: 'store-credit-enabled', label: 'Enable store credit', page: 'Settings', path: '/admin/settings',
    target: 'store-credit-enabled', hint: 'Sub-user rewards and coupon credit, on or off store-wide',
    keywords: 'balance reward referral coupon credit disable money' },
  { id: 'price-round-mode', label: 'Sub-user price rounding', page: 'Settings', path: '/admin/settings',
    target: 'price-round-mode', keywords: 'round rounding 99 50 whole dollar subuser sub-user price mode' },
  // The exchange-rate feed's route. On the Pricing card, where every other
  // key saves under settings.payments as this one does — it used to sit on
  // the Tor proxy card, whose other keys save under settings.security.
  { id: 'price-route', label: 'Price feed leaves via', page: 'Settings', path: '/admin/settings',
    target: 'price-route', hint: 'The exchange-rate lookup: direct, through Tor, or through the proxy pool',
    keywords: 'price feed exchange rate coin conversion route routing traffic tor proxy proxies direct' },
  { id: 'stock-alerts', label: 'Stock alerts', page: 'Settings', path: '/admin/settings', target: 'stock-alerts',
    hint: 'Tell staff before a line runs out', keywords: 'low stock reorder runway cover threshold notify' },
  // The card, and the two controls somebody is most likely to hunt for by name.
  // The fourteen thresholds are deliberately NOT listed one by one: they are
  // generated from `opsBriefing.THRESHOLDS`, and typing them out here would be
  // the duplicate the assistant's settings index and the settings page both
  // avoid. Anyone searching "unpaid alert" lands on the card that holds it.
  { id: 'ops-alerts', label: 'Operations alerts', page: 'Settings', path: '/admin/settings', target: 'ops-alerts',
    hint: 'The daily briefing, and the queue thresholds that cannot wait for it',
    keywords: 'ops operations alert alerts briefing daily summary morning threshold thresholds queue backlog notify staff' },
  { id: 'ops-briefing-enabled', label: 'Daily operations briefing', page: 'Settings', path: '/admin/settings',
    target: 'ops-briefing-enabled', hint: 'One plain-language note a day to every staff channel',
    keywords: 'ops operations briefing daily summary morning note staff bots' },
  { id: 'ops-hour', label: 'Hour the daily briefing is sent', page: 'Settings', path: '/admin/settings',
    target: 'ops-hour', hint: 'Same hour every day is a pattern — pick it deliberately',
    keywords: 'ops briefing hour time when daily morning schedule tor pattern' },
  { id: 'ops-alerts-enabled', label: 'Operations alerts', page: 'Settings', path: '/admin/settings',
    target: 'ops-alerts-enabled', hint: 'Message staff the moment a queue crosses a number',
    keywords: 'ops operations alert alerts threshold queue backlog immediate' },
  { id: 'low-stock-threshold', label: 'Low stock alert threshold', page: 'Settings', path: '/admin/settings',
    target: 'low-stock-threshold', hint: 'The flat quantity the dashboard badge uses',
    keywords: 'quantity flat floor dashboard badge reorder minimum units' },
  { id: 'stock-count-approval', label: 'Require approval for stock counts', page: 'Settings', path: '/admin/settings',
    target: 'stock-count-approval', hint: 'Four eyes on every counted adjustment',
    keywords: 'count approve approval adjustment audit stocktake four eyes queue' },
  { id: 'stock-alert-enabled', label: 'Alert staff when stock runs low', page: 'Settings', path: '/admin/settings',
    target: 'stock-alert-enabled', keywords: 'low stock notify staff enable' },
  { id: 'sa-window', label: 'Stock alert sales window', page: 'Settings', path: '/admin/settings', target: 'sa-window',
    keywords: 'days rolling velocity sales window stock' },
  { id: 'sa-cover', label: 'Days of cover', page: 'Settings', path: '/admin/settings', target: 'sa-cover',
    keywords: 'runway days remaining stock cover' },
  { id: 'sa-scan', label: 'Stock scan interval', page: 'Settings', path: '/admin/settings', target: 'sa-scan',
    keywords: 'minutes poll frequency scan stock' },

  { id: 'package-tracking', label: 'Package tracking', page: 'Settings', path: '/admin/settings', target: 'package-tracking',
    keywords: 'tracking track parcel package carrier usps ups fedex dhl royal mail delivery status lookup worker queue' },
  { id: 'tracking-enabled', label: 'Look parcels up automatically', page: 'Settings', path: '/admin/settings', target: 'tracking-enabled', fallback: 'package-tracking',
    keywords: 'tracking enable automatic carrier lookup parcel status' },
  { id: 'tracking-interval', label: 'Tracking interval', page: 'Settings', path: '/admin/settings', target: 'tracking-interval', fallback: 'package-tracking',
    keywords: 'tracking hours interval how often two hours floor spacing' },
  { id: 'tracking-auto-deliver', label: 'Mark delivered when every parcel is', page: 'Settings', path: '/admin/settings', target: 'tracking-auto-deliver', fallback: 'package-tracking',
    keywords: 'auto deliver delivered complete carrier tracking finalize' },
  { id: 'tracking-credentials', label: 'Carrier API credentials', page: 'Settings', path: '/admin/settings', target: 'tracking-credentials', fallback: 'package-tracking',
    keywords: 'usps ups fedex dhl royal mail api key secret client id consumer key credential' },
  { id: 'outbound-proxies', label: 'Outbound proxies', page: 'Settings', path: '/admin/settings', target: 'outbound-proxies',
    keywords: 'proxy proxies socks5 socks http connect chain rotate rotation pool residential exit tor route outbound' },
  { id: 'proxy-rotation', label: 'Proxy rotation', page: 'Settings', path: '/admin/settings', target: 'proxy-rotation', fallback: 'outbound-proxies',
    keywords: 'round robin random sticky rotation proxy' },
  { id: 'address-lookup', label: 'Address lookup', page: 'Settings', path: '/admin/settings', target: 'address-lookup',
    hint: 'Geocoder for the checkout address form, proxied', keywords: 'geocode nominatim photon google places address search autocomplete tor' },
  { id: 'geocode-provider', label: 'Address lookup provider', page: 'Settings', path: '/admin/settings', target: 'geocode-provider', fallback: 'address-lookup', keywords: 'nominatim photon google off' },
  { id: 'geocode-base-url', label: 'Address lookup base URL', page: 'Settings', path: '/admin/settings', target: 'geocode-base-url', fallback: 'address-lookup', keywords: 'self-hosted photon endpoint' },
  { id: 'geocode-route', label: 'Address lookup route', page: 'Settings', path: '/admin/settings', target: 'geocode-route', fallback: 'address-lookup', keywords: 'tor proxy onion route direct pool' },
  { id: 'geocode-api-key', label: 'Address lookup API key', page: 'Settings', path: '/admin/settings', target: 'geocode-api-key', fallback: 'address-lookup', keywords: 'google places key secret' },
  { id: 'geocode-countries', label: 'Address lookup countries', page: 'Settings', path: '/admin/settings', target: 'geocode-countries', fallback: 'address-lookup', keywords: 'country codes bias us ca region' },
  { id: 'payment-rail-adjustments', label: 'Price by payment method', page: 'Settings', path: '/admin/settings',
    target: 'payment-rail-adjustments', fallback: 'pricing', hint: 'A fee or discount per rail, applied before coupons',
    keywords: 'rail fee discount surcharge monero bitcoin zelle cash percent flat payment method pricing' },
  { id: 'mirrors', label: 'Mirrors', page: 'Settings', path: '/admin/settings', target: 'mirrors',
    hint: 'Every address the store is reachable at, signed', keywords: 'onion domain backup address mirror list signed clone phishing' },
  { id: 'store-mirrors', label: 'Mirror addresses', page: 'Settings', path: '/admin/settings',
    target: 'store-mirrors', fallback: 'mirrors', keywords: 'onion clearnet host domain list' },
  { id: 'store-mirrors-note', label: 'Mirror list note', page: 'Settings', path: '/admin/settings',
    target: 'store-mirrors-note', fallback: 'mirrors', keywords: 'verify fingerprint wording' },
  { id: 'clearnet-policy', label: 'Clearnet visitors (onion-only mode)', page: 'Settings', path: '/admin/settings',
    target: 'clearnet-policy', fallback: 'mirrors', keywords: 'onion only onion-only clearnet tor refuse redirect announce hidden service' },
  { id: 'footer', label: 'Footer', page: 'Settings', path: '/admin/settings', target: 'footer',
    hint: 'Links and text along the bottom of the store', keywords: 'links privacy about shipping legal bottom' },
  { id: 'footer-enabled', label: 'Show a footer on the storefront', page: 'Settings', path: '/admin/settings',
    target: 'footer-enabled', keywords: 'hide show bottom links' },
  { id: 'footer-text', label: 'Footer text', page: 'Settings', path: '/admin/settings', target: 'footer-text',
    fallback: 'footer-enabled', keywords: 'copyright legal notice bottom wording' },
  { id: 'footer-links', label: 'Footer links', page: 'Settings', path: '/admin/settings',
    target: 'footer-links', fallback: 'footer-enabled', hint: 'Which store pages the footer lists',
    keywords: 'privacy about shipping lab results pgp support wishlist membership subusers pages picker' },
  { id: 'seo', label: 'Search engines', page: 'Settings', path: '/admin/settings', target: 'seo',
    hint: 'Whether crawlers may index the store, and what they are told', keywords: 'seo search engine google bing index robots sitemap crawler findable open graph preview' },
  { id: 'seo-indexing', label: 'Let search engines index this store', page: 'Settings', path: '/admin/settings',
    target: 'seo-indexing', keywords: 'seo index indexing noindex robots.txt sitemap crawl google bing listed' },
  { id: 'seo-social-previews', label: 'Link previews in chat apps', page: 'Settings', path: '/admin/settings',
    target: 'seo-social-previews', keywords: 'open graph og twitter card unfurl preview telegram discord share' },
  { id: 'seo-description', label: 'Store description', page: 'Settings', path: '/admin/settings',
    target: 'seo-description', keywords: 'meta description seo snippet blurb search result' },
  { id: 'seo-canonical-host', label: 'Canonical address', page: 'Settings', path: '/admin/settings',
    target: 'seo-canonical-host', fallback: 'seo-indexing', keywords: 'canonical host domain primary www duplicate' },
  { id: 'seo-currency', label: 'Price currency', page: 'Settings', path: '/admin/settings',
    target: 'seo-currency', fallback: 'seo-indexing', keywords: 'currency usd eur gbp iso structured data price' },
  { id: 'seo-verification', label: 'Site verification tags', page: 'Settings', path: '/admin/settings',
    target: 'seo-verification', fallback: 'seo-indexing', keywords: 'google search console bing webmaster verification verify ownership token' },
  { id: 'csv', label: 'CSV import & export', page: 'Settings', path: '/admin/settings', target: 'csv',
    hint: 'Bulk load the catalogue from a file, or export orders',
    keywords: 'bulk upload download spreadsheet csv products orders export' },

  // ── Pages with their own settings ─────────────────────────────────────────
  { id: 'theme', label: 'Theme', page: 'Theme', path: '/admin/theme',
    hint: 'Palette, typography, effects and presets',
    keywords: 'colour color palette font dark light preset glass aurora appearance style' },
  { id: 'home-promises', label: 'Home promises', page: 'Home page', path: '/admin/home',
    hint: 'The claims under your featured products, and the pages that back them',
    keywords: 'why us value props usp selling points benefits trust badges guarantees reasons buy about claims section band' },
  { id: 'home-promises-on', label: 'Show the promises section', page: 'Home page', path: '/admin/home',
    target: 'promises-on', keywords: 'publish enable hide home page band why us' },
  { id: 'home-promises-eyebrow', label: 'Promises eyebrow', page: 'Home page', path: '/admin/home',
    target: 'promises-eyebrow', hint: 'The small line above the headline',
    keywords: 'kicker overline label small copy wording home' },
  { id: 'home-promises-heading', label: 'Promises heading', page: 'Home page', path: '/admin/home',
    target: 'promises-heading', hint: 'The headline beside the claims',
    keywords: 'headline title copy wording home' },
  { id: 'home-promises-lede', label: 'Promises standfirst', page: 'Home page', path: '/admin/home',
    target: 'promises-lede', hint: 'The sentence or two under the heading',
    keywords: 'lede lead standfirst intro paragraph subheading copy wording home' },
  { id: 'home-reviews', label: 'Home reviews band', page: 'Home page', path: '/admin/home',
    hint: "Buyers' own words on the home page, over your real rating spread",
    keywords: 'reviews testimonials ratings social proof stars quotes feedback comments customers band section home' },
  { id: 'home-reviews-on', label: 'Show the reviews band', page: 'Home page', path: '/admin/home',
    target: 'reviews-on', keywords: 'publish enable hide home page testimonials reviews social proof' },
  { id: 'home-reviews-attribution', label: 'How much of a reviewer to show', page: 'Home page', path: '/admin/home',
    target: 'reviews-attribution', hint: 'Initial only, nothing at all, or the full username',
    keywords: 'anonymous anonymise username handle name privacy initials identity attribution redact reviewer author' },
  { id: 'home-reviews-min-rating', label: 'Minimum rating to quote', page: 'Home page', path: '/admin/home',
    target: 'reviews-min-rating', hint: 'Which reviews get quoted — the tally still counts them all',
    keywords: 'filter stars rating floor threshold hide bad negative reviews quote' },
  { id: 'home-reviews-count', label: 'How many reviews to quote', page: 'Home page', path: '/admin/home',
    target: 'reviews-count', hint: 'Between three and twelve',
    keywords: 'how many number limit quotes reviews count band home' },
  { id: 'home-reviews-heading', label: 'Reviews heading', page: 'Home page', path: '/admin/home',
    target: 'reviews-heading', hint: 'The headline over the rating spread',
    keywords: 'headline title copy wording home reviews what buyers said' },
  { id: 'limits', label: 'Rate limits', page: 'Rate limits', path: '/admin/limits',
    hint: 'Per-endpoint budgets and how they are counted',
    keywords: 'throttle abuse budget window requests per minute captcha flood' },
  { id: 'ai', label: 'AI', page: 'AI', path: '/admin/ai',
    hint: 'Which machine answers, which models, and what each feature may do',
    keywords: 'assistant model ollama qdrant vector search meaning embedding gpu tunnel perch vast whisper kokoro voice dictation speech buddy recommend memory translate' },
  // No `target` on the AI entries, deliberately. Every field on that page has
  // its id GENERATED from config/aiKeys.js, so a setting added on the server
  // appears with the right control and no client edit — which is the point.
  // The cost is that this file cannot name a literal element id, and the
  // adminSearch test is right to refuse one it cannot find in the source.
  { id: 'ai-connection', label: 'Model server', page: 'AI', path: '/admin/ai',
    hint: 'The URL the shop asks — local, a rented GPU, or an SSH tunnel',
    keywords: 'base url endpoint ollama openai api key certificate tls tor' },
  { id: 'ai-capabilities', label: 'AI features', page: 'AI', path: '/admin/ai',
    hint: 'Which AI features this shop offers at all',
    keywords: 'capability switch consent gate assistant search recommend memory voice support ops translate describe tags' },
  { id: 'ai-budget', label: 'AI spending cap', page: 'AI', path: '/admin/ai',
    hint: 'Stop generating for the day once this many tokens are spent',
    keywords: 'tokens cost budget ceiling limit spend invoice gpu rented' },
  // No `target`, like the other AI entries: the panel lives in a component
  // the adminSearch test cannot read through this page, and a target it
  // cannot verify is the stale highlight that test exists to refuse.
  { id: 'ai-smoke', label: 'Assistant checks', page: 'AI', path: '/admin/ai',
    hint: 'Run the assistant\'s test questions every night and lamp a regression on the Risk Board',
    keywords: 'smoke test nightly scheduled regression evaluation questions coverage topics run now' },
  { id: 'catalog-health', label: 'Catalogue health', page: 'Catalogue health', path: '/admin/catalog-health',
    hint: 'Products with no description, tags, picture, shelf or recent sales — and a draft queue to fix the first two',
    keywords: 'hygiene missing incomplete undescribed untagged unfiled unsold dead stock no image draft queue' },
  { id: 'nodes', label: 'Coin nodes', page: 'Nodes', path: '/admin/nodes',
    hint: 'RPC connections, wallets and auto-withdraw',
    keywords: 'btc ltc xmr rpc daemon wallet sweep withdraw sync tor onion' },
  { id: 'xmr-daemon', label: 'Monero daemon RPC', page: 'Nodes', path: '/admin/nodes',
    target: 'xmr-daemon-host', fallback: 'nodes-xmr',
    hint: 'Separate from the wallet RPC — this is what reports chain sync',
    keywords: 'monerod xmr daemon height sync restricted rpc' },
  { id: 'xmr-wallet-password', label: 'Monero wallet password', page: 'Nodes', path: '/admin/nodes',
    target: 'xmr-wallet-password', fallback: 'nodes-xmr',
    keywords: 'xmr monero unlock passphrase wallet' },
  { id: 'btc-node', label: 'Bitcoin node', page: 'Nodes', path: '/admin/nodes', target: 'nodes-btc',
    hint: 'RPC connection, wallet and auto-withdraw', keywords: 'btc bitcoin rpc core daemon sweep' },
  { id: 'ltc-node', label: 'Litecoin node', page: 'Nodes', path: '/admin/nodes', target: 'nodes-ltc',
    hint: 'RPC connection, wallet and auto-withdraw', keywords: 'ltc litecoin rpc core daemon sweep' },
  { id: 'xmr-node', label: 'Monero node', page: 'Nodes', path: '/admin/nodes', target: 'nodes-xmr',
    hint: 'Wallet RPC, daemon and auto-withdraw', keywords: 'xmr monero rpc wallet daemon sweep' },
  { id: 'canary', label: 'Warrant canary', page: 'Canary', path: '/admin/canary',
    hint: 'A statement you affirm, re-signed on a schedule from a budget', keywords: 'warrant canary subpoena gag order signed statement transparency' },
  { id: 'pgp', label: 'Store PGP key', page: 'PGP key', path: '/admin/pgp',
    hint: 'The key buyers encrypt their address to',
    keywords: 'gpg encryption public private key address decrypt armored' },
  { id: 'pgp-verify', label: 'Verify a signed message', page: 'PGP key', path: '/admin/pgp', target: 'pgp-verify',
    hint: 'Check a signed block against the store keys, a customer’s key or a pasted key',
    keywords: 'gpg verify signature signed message check authenticate customer refund address' },
  { id: 'pgp-decrypt', label: 'Decrypt a message', page: 'PGP key', path: '/admin/pgp', target: 'pgp-decrypt',
    hint: 'Open a block encrypted to the store key — audited, by key and outcome',
    keywords: 'gpg decrypt encrypted message address unlock private key passphrase read' },
  { id: 'analytics-insights', label: 'Who buys, and what', page: 'Analytics', path: '/admin/analytics', target: 'analytics-insights',
    hint: 'Sign-up routes, storefronts, category mix, repeat buyers, bought together',
    keywords: 'analytics acquisition where customers come from invite links referral telegram potato storefront category brand repeat returning basket pairs' },
  { id: 'api-keys', label: 'API keys', page: 'API keys', path: '/admin/api-keys',
    hint: 'Keys for the product ingest API', keywords: 'token scrape import integration secret' },
  { id: 'tiers', label: 'VIP tiers', page: 'VIP tiers', path: '/admin/tiers',
    hint: 'Spend bands, discounts and drop head starts',
    keywords: 'discount loyalty vip band spend early access head start' },
  { id: 'cash-mail-addresses', label: 'Cash-in-mail addresses', page: 'Cash in Mail', path: '/admin/cash-mail',
    hint: 'The rotating drop addresses and their receive caps',
    keywords: 'drop address rotation limit daily monthly lifetime recipient' },
  { id: 'zelle-accounts', label: 'Zelle accounts', page: 'Zelle', path: '/admin/zelle',
    hint: 'Rotating bank recipients and their receive caps',
    keywords: 'bank recipient handle rotation limit daily monthly lifetime' },
  { id: 'invite-links', label: 'Invite links', page: 'Invite links', path: '/admin/invite-links',
    hint: 'Store-wide signup invitations', keywords: 'invitation code signup gated referral' },
  { id: 'marketing', label: 'Marketing', page: 'Marketing', path: '/admin/marketing',
    hint: 'Tracking links, arrivals and what each campaign converted',
    keywords: 'campaign tracking affiliate ref utm clicks conversion instagram channel funnel advert' },
  { id: 'marketing-new-link', label: 'New tracking link', page: 'Marketing', path: '/admin/marketing',
    hint: 'A ?ref= link you can post anywhere and measure',
    keywords: 'create campaign affiliate referral tag landing page channel' },
  { id: 'store-credit', label: 'Store credit ledger', page: 'Store credit', path: '/admin/store-credit',
    hint: 'Every credit movement across all accounts',
    keywords: 'balance refund reward referral ledger money adjust' },
  { id: 'risk', label: 'Risk board', page: 'Risk board', path: '/admin/risk',
    hint: 'Health checks across nodes, pools and disks',
    keywords: 'health ops alert warning degraded scan status' },
  { id: 'audit-log', label: 'Audit log', page: 'Audit log', path: '/admin/audit-log',
    hint: 'Record of privileged staff actions',
    keywords: 'history who did what trail refund permission grant' },
  { id: 'users-permissions', label: 'Staff permissions', page: 'Users', path: '/admin/users',
    hint: 'Roles and per-manager grants',
    keywords: 'role manager admin grant permission staff access ban' },
  { id: 'shelves', label: 'Shelf locations', page: 'Shelves', path: '/admin/shelves',
    hint: 'Bin locations that order the pull list',
    keywords: 'bin warehouse pick location aisle fulfilment' },
  { id: 'ship-desk', label: 'Ship desk', page: 'Ship desk', path: '/admin/ship',
    hint: 'Packed orders: accept, label, track and dispatch box by box',
    keywords: 'ship dispatch boxes parcel label tracking carrier packed fulfilment fulfillment send' },
  { id: 'warehouse-map', label: 'Warehouse map', page: 'Warehouse', path: '/admin/warehouse',
    hint: 'Draw rooms and shelves, set the walk order, file variants into slots',
    keywords: 'warehouse map floor plan rooms shelves slots walk order route 3d isometric layout aisle' },
];

/**
 * One entry per data-driven Settings card, derived rather than written down.
 *
 * These eleven — Product import, both bots, staff-in-chat, live chat, push,
 * security, the Tor proxy, reviews, shipping, developer mode — were absent
 * from this file for as long as it has existed, and the absence was completely
 * silent. adminSearch.test.mjs checks that every entry points at something
 * real; nothing checked that everything real had an entry. So "telegram",
 * "potato", "tor proxy", "2fa", "authenticator" and "developer" all returned
 * nothing, and the worked example in the ranking notes below — "'tor port'
 * should find the Tor proxy" — was describing a search that did not happen.
 *
 * Writing the eleven out by hand would have fixed those eleven. Deriving them
 * from `config/settingGroups.js`, which is the same array the page maps over
 * to render the cards, fixes the twelfth as well: a group added there is
 * searchable the moment it renders, because there is no second list to update.
 *
 * `target` is `group.title` because that is what `SettingsSection` already
 * receives as its `data-settings-section` — the address the card has, not a
 * new one invented for the search. Titles carry spaces and capitals, which the
 * resolver handles: it runs every target through `CSS.escape`.
 *
 * The card, never a field inside it. These groups render their fields from
 * data with no per-control ids, so the card is the narrowest thing that
 * exists — and a card is the right grain here anyway, because the hint under
 * a bot token is the half that says what turning it on costs.
 */
const GROUP_ENTRIES = SETTING_GROUPS.map((group) => ({
  id: `group-${group.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
  label: group.title,
  page: 'Settings',
  path: '/admin/settings',
  target: group.title,
  // Field keys, labels, hints, placeholders and option labels — so
  // `totp_window_steps` is found by "code tolerance", by "authenticator", and
  // by "±30 seconds", none of which is the card's title.
  keywords: groupKeywords(group),
}));

/**
 * The whole index: what has to be written, plus what can be derived.
 *
 * Order matters only as a tiebreak — `searchAdminEntries` sorts by rank and
 * label length — so the derived half goes last for readability rather than for
 * precedence.
 */
export const ADMIN_SEARCH_ENTRIES = [...WRITTEN_ENTRIES, ...GROUP_ENTRIES];

/**
 * Rank entries against a query.
 *
 * Every term must match somewhere — AND, not OR — for the same reason the
 * Settings page's filter did it: "tor port" should find the Tor proxy, not
 * every setting that mentions a port.
 *
 * The ordering matters more here than it did there, because this returns a
 * short list to pick from rather than hiding cards. A label that starts with
 * what you typed comes first, then a label that contains it, then everything
 * matched only through keywords or the page name. Within a rank, shorter labels
 * win: "Zelle" should outrank "New accounts get Zelle" for the query "zelle".
 *
 * @param {AdminSearchEntry[]} entries
 * @param {string} query
 * @returns {AdminSearchEntry[]}
 */
/**
 * Does `term` begin a word in `text`?
 *
 * A plain `includes` was the first version and it was too loose in a way that
 * makes a search feel stupid: typing "age" offered "Store logo" and "Staff
 * permissions", because "image" and "manage" both contain it. Requiring the
 * term to start a word drops both while keeping the type-ahead — "zell" still
 * finds "Zelle", "recip" still finds "Recipient reveal cap" — because it is a
 * word-PREFIX test, not a whole-word one.
 *
 * Non-alphanumeric characters count as boundaries, so "sub-user" is two words
 * and "auto-cancel" is findable by "cancel".
 */
/**
 * Rank the reachable entries against what the operator typed. The matching
 * rules live in utils/searchRank.js, shared with the storefront palette, so
 * the two lists narrow the same way for the same keystrokes.
 */
export function searchAdminEntries(entries, query) {
  return rankEntries(
    entries,
    query,
    (e) => `${e.label} ${e.page} ${e.hint || ''} ${e.keywords || ''}`,
    (e) => e.label,
  );
}
