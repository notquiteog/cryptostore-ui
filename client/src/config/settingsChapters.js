/**
 * The chapters of the Settings page, and which card sits in which.
 *
 * ── Why the page needs a table of contents at all ──────────────────────────
 *
 * The page holds twenty-seven cards. Before this file they rendered in the
 * order they had been written, which was the order the features had been
 * built: Branding, then Access, then Payments, then Orders, then Fulfilment —
 * and then the thirteen data-driven cards as one block, so Catalog sat after
 * the Tor proxy, the shipping tiers sat between Address privacy and Developer
 * mode, and the two alert cards were nine cards apart from the bots that
 * deliver them. The rail listed all twenty-seven as one flat column. An
 * operator looking for "where do I set what a shelf-tracking shop does about
 * low stock" had no way to narrow twenty-seven to four.
 *
 * A chapter is that narrowing: "which of eight" and then "which of three or
 * four". Grouped by what the operator is doing — dressing the storefront,
 * describing the catalogue, taking money, packing, deciding what the shop
 * holds about a buyer, talking to staff and buyers, routing traffic — rather
 * than by which file the card happens to live in or which permission saves it.
 *
 * ── One list, two readers ──────────────────────────────────────────────────
 *
 * Pure data, in its own module, because the Settings page renders from it and
 * `client/test/adminSearch.test.mjs` checks it: every card the page draws must
 * be placed here exactly once, and nothing may be placed here that the page
 * does not draw. A card added to the page and forgotten here still renders —
 * the page appends it under a trailing chapter rather than dropping it — but
 * the test names it, so it is filed properly before it ships.
 *
 * A section id is either the `data-settings-section` of a hand-written card
 * in `pages/admin/Settings.jsx` (and the two cards it renders from their own
 * components, `TrackingSettings` and `ProxyPoolSettings`), or the `title` of a
 * data-driven group in `config/settingGroups.js`, which is the id that card
 * already carries. Both are the addresses the admin search's `?hl=` deep
 * links use, so nothing here invents a second naming scheme.
 *
 * Order within a chapter is by how often the card is reached, not by name.
 */

/**
 * @typedef {Object} SettingsChapter
 * @property {string}   id        stable; used as the React key and the heading id
 * @property {string}   label     the chapter heading, in the rail and on the page
 * @property {string}   lede      one line under the heading: what the chapter decides
 * @property {string[]} sections  section ids, in the order they render
 */

/** @type {SettingsChapter[]} */
export const SETTINGS_CHAPTERS = [
  {
    id: 'storefront',
    label: 'Storefront',
    lede: 'What a visitor meets before signing in: the name on the tab, the footer, the addresses this store answers at, and whether search engines may find it.',
    sections: ['branding', 'footer', 'mirrors', 'seo'],
  },
  {
    id: 'catalogue',
    label: 'Catalogue',
    lede: 'What is for sale and how it gets here: product rules, reviews, the import feed and the spreadsheets.',
    sections: ['Catalog', 'Reviews', 'Product import', 'csv'],
  },
  {
    id: 'orders',
    label: 'Orders & payment',
    lede: 'How money is taken, what a delivery costs, and how an order moves once it is placed.',
    sections: ['payments', 'pricing', 'Shipping', 'features'],
  },
  {
    id: 'fulfilment',
    label: 'Fulfilment',
    lede: 'The pack bench, the carriers, the tracking worker, the address builder, and when stock is low enough to say so.',
    sections: ['fulfilment', 'package-tracking', 'address-lookup', 'stock-alerts'],
  },
  {
    // `access` (who may enter) sits with the two privacy cards rather than
    // with the storefront it guards: registration, the age gate, PGP and the
    // address policy are all one question — what does this shop ask of, and
    // keep about, the people who use it — and they save under one grant.
    id: 'privacy',
    label: 'Access & privacy',
    lede: 'Who may enter, what the store holds about a buyer, and how long it keeps it.',
    sections: ['access', 'Security', 'Address privacy'],
  },
  {
    id: 'messaging',
    label: 'Messaging',
    lede: 'The two bot storefronts, live chat, push, and what staff are told and where.',
    sections: [
      'Telegram', 'Potato chat', 'Staff actions on the bots', 'Live chat', 'Push notifications', 'ops-alerts',
    ],
  },
  {
    id: 'network',
    label: 'Network',
    lede: 'How outbound traffic leaves this server: the Tor client, and the proxy pool for the services that refuse it.',
    sections: ['Tor proxy', 'outbound-proxies'],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    lede: 'Switches for a developer or a test install. Nothing here is for a running store.',
    sections: ['Developer'],
  },
];

/** Every placed section id, in page order. */
export const SETTINGS_SECTION_ORDER = SETTINGS_CHAPTERS.flatMap((c) => c.sections);

/** The same, as a set, for "is this card filed anywhere". */
export const PLACED_SECTIONS = new Set(SETTINGS_SECTION_ORDER);

/** The chapter a section is filed under, or null. */
export const chapterOf = (sectionId) => SETTINGS_CHAPTERS.find((c) => c.sections.includes(sectionId)) || null;
