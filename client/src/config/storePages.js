import { ShieldCheck, Store, Truck, FlaskConical, MessagesSquare } from 'lucide-react';

/**
 * The operator-authored pages, once, for every surface that needs to know
 * they exist.
 *
 * Five things have to agree about this list: the admin sidebar, the admin
 * routes, the storefront routes, the storefront footer, and the footer's
 * link picker on the Settings page. They used to agree by being edited five
 * times, which is the shape of a bug that ships — a page that appears in the
 * sidebar, has no route, and 404s when the operator clicks the link they
 * just published.
 *
 * The server's half of this is `server/config/pageKeys.js`, which owns the
 * same slugs and key names and enforces them on write. The two are kept in
 * step by hand, on purpose: this file carries React components and lucide
 * icons and cannot be required by the API.
 *
 * Order here is the order everything renders in — sidebar, footer picker, and
 * the footer itself.
 */
export const STORE_PAGES = [
  {
    // `key` names the admin route segment AND the public route: /about is
    // both the storefront path and the admin editor's tail. `slug` is what
    // GET /api/settings/pages/:slug answers to, and is only different where
    // the public path reads better than the key would.
    key: 'about',
    slug: 'about',
    path: '/about',
    label: 'About Us',
    icon: Store,
    defaultTitle: 'About Us',
    // What the operator is being asked to write, in one line, at the top of
    // the editor. Deliberately about the reader, not about the feature.
    blurb: 'Who runs this store and how it works — the page a visitor reads before deciding to trust you.',
    keys: {
      enabled: 'page_about_enabled',
      title: 'page_about_title',
      md: 'page_about_md',
    },
  },
  {
    key: 'privacy',
    slug: 'privacy',
    path: '/privacy',
    label: 'Privacy Policy',
    icon: ShieldCheck,
    defaultTitle: 'Privacy Policy',
    blurb: 'What you collect, what you keep, and for how long. Public without a login on purpose — a privacy policy exists for exactly the visitor who has not signed up yet.',
    keys: {
      enabled: 'page_privacy_enabled',
      title: 'page_privacy_title',
      md: 'page_privacy_md',
    },
  },
  {
    key: 'shipping',
    slug: 'shipping',
    path: '/shipping',
    label: 'Shipping Policy',
    icon: Truck,
    defaultTitle: 'Shipping Policy',
    blurb: 'How orders are packed, how they travel, and what happens when one does not arrive. This is prose, not pricing — shipping charges are the tiers on the Settings page.',
    keys: {
      enabled: 'page_shipping_enabled',
      title: 'page_shipping_title',
      md: 'page_shipping_md',
    },
  },
  {
    key: 'faq',
    slug: 'faq',
    path: '/faq',
    label: 'FAQ',
    icon: MessagesSquare,
    defaultTitle: 'FAQ',
    // Two audiences, and the blurb says so because the second one is not
    // obvious: this page is also the assistant's corpus. Every heading here
    // becomes a chunk the assistant can retrieve and answer from
    // (server/services/ai/embedSweeper.js), so an operator who writes an
    // answer down once has taught both the page and the assistant. That is
    // the lever for everything the code cannot know — this shop's own rules
    // about substitutions, reshipping, packaging, whatever it is.
    blurb: 'The questions you answer over and over. Write each one under its own heading — the assistant reads this page too, and answers from it.',
    keys: {
      enabled: 'page_faq_enabled',
      title: 'page_faq_title',
      md: 'page_faq_md',
    },
  },
  {
    key: 'lab-results',
    slug: 'lab-results',
    path: '/lab-results',
    label: 'Lab Results',
    icon: FlaskConical,
    defaultTitle: 'Lab Results',
    blurb: 'Certificates of analysis, one drawer per batch. The markdown here is the introduction above them.',
    // Lab results are structured, not prose: the editor grows a
    // certificate-of-analysis builder and the public page renders drawers
    // rather than markdown alone.
    lab: true,
    keys: {
      enabled: 'page_lab_enabled',
      title: 'page_lab_title',
      md: 'page_lab_intro_md',
      results: 'page_lab_results',
    },
  },
];

/** Admin editor route for one page. */
export const adminPagePath = (key) => `/admin/pages/${key}`;

export const findStorePage = (key) => STORE_PAGES.find((p) => p.key === key) || null;

/** Every setting key the four editors between them own. */
export const STORE_PAGE_KEYS = STORE_PAGES.flatMap((p) => Object.values(p.keys));
