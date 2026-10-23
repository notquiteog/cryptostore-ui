/**
 * What to offer somebody who has opened the assistant and not yet typed.
 *
 * ── Why these are not four constants any more ───────────────────────────────
 *
 * They were: "What's new in the store?", "Anything I should know about?", the
 * PGP one, and "How long will my order take to deliver?". Those were written
 * when the assistant could answer roughly those four things. It now answers
 * twenty-three topics and can set and cancel alerts, and the opening prompt
 * still advertised the original four — so the half of the feature a buyer
 * would most obviously want (their balance, their tier, their cart, whether
 * they can still cancel) was reachable only by guessing it existed.
 *
 * ── And why they follow the page ────────────────────────────────────────────
 *
 * The buddy now tells the server which page it is on
 * (`utils/pageContext.js`), which is what makes "is this in stock?" resolve at
 * all. A suggestion list that ignores the same fact is offering a buyer on a
 * product page the chance to ask about their membership tier. The strongest
 * question to offer is almost always the one about the thing they are already
 * looking at.
 *
 * ── The rules ───────────────────────────────────────────────────────────────
 *
 *  - Signed out, nothing about "my" anything. Those answers are a sign-in
 *    prompt, and a suggestion that cannot be answered is worse than none.
 *  - Staff in the console get the STAFF topics, not the buyer ones. This file
 *    was buyer-only, so the one person who could ask "what is stuck" was
 *    offered "how do I pay with Monero?" in their own admin panel — and the
 *    six operational topics behind `analytics.dashboard` were discoverable
 *    only by guessing they existed. See `ADMIN` below.
 *  - At most four. This is a hint, not a menu.
 *  - A different set each time the panel opens. The pool is bigger than the
 *    slot, so somebody who opens the assistant twice sees two different
 *    prompts — the cheapest way to show it does more than the four things they
 *    saw first. `seed` rotates it; the caller bumps that on open rather than
 *    randomising, so the sequence is deterministic in a test and never repeats
 *    itself back to back.
 *  - Every one of them is a question some topic or tool actually answers —
 *    `client/test/suggestedQuestions.test.mjs` is what keeps that true as the
 *    registry changes.
 *
 * Pure, so the list can be asserted without a browser.
 */

/** Asked wherever you are, when nothing more specific applies. */
const GENERAL = [
  "What's new in the store?",
  'How do I pay with Monero?',
  'How much does shipping cost?',
];

/** Only meaningful once the shop knows who is asking. */
const MINE = {
  product: [
    'Is this in stock?',
    'What do people say about it?',
    'Tell me when it is back in stock',
  ],
  products: ["What's popular right now?", 'What is on sale?'],
  cart: ['What is in my cart?', 'How much does shipping cost?'],
  orders: ['Where is my order?', 'Can I cancel my order?'],
  order: ['Where is this order?', 'How much did it cost?', 'Can I cancel it?'],
  // "What am I watching?" is here because the Watching tab is on this page:
  // the hint and the surface answer the same question, and `my-alerts` is the
  // topic behind it.
  wishlist: ['What is on my wishlist?', 'What am I watching?', 'Tell me when these are back in stock'],
  membership: ['What tier am I on?', 'What do I need for the next tier?'],
  subusers: ['How much store credit do I have?', 'How much have my sub-users earned me?'],
  support: ['Do I have any unread replies?', 'How do I get a refund?'],
  profile: ['How do I use the Telegram bot?', 'How do restock alerts work?', 'What am I watching?'],
  home: ['Anything I should know about?', 'What is popular right now?'],
};

/**
 * What somebody RUNNING the shop is offered, by where in the console they are.
 *
 * ── Why these are not the buyer list with different words ───────────────────
 *
 * Because they are answered by different code. Every string here matches an
 * `audience: 'staff'` topic in `server/services/ai/topics/` — the queue ages,
 * the stock split, the carrier exceptions, the rails, the catalogue gaps — and
 * each of those is gated on a named permission the server re-checks per
 * request. A suggestion is a hint about what exists, never a grant: a manager
 * without `analytics.dashboard` who presses one gets the model's answer, the
 * same as if they had typed it.
 *
 * ── Why the area and not the exact path ─────────────────────────────────────
 *
 * These strings are chosen client-side from the path; the server learns only
 * whichever question gets pressed. So the granularity is "which desk is this
 * person standing at", which is as much as a four-item hint can use anyway.
 *
 * `utils/pageContext.js` now names the desk to the server as well — a literal
 * like `admin-pack`, never a fact off the page — but the two lists stay
 * separate on purpose. `adminArea` groups thirty-odd routes into six desks
 * because that is the resolution a hint needs, and `pageContext`'s set is
 * per-page because that is the resolution a PROMPT needs. Deriving one from
 * the other would mean every new console page silently joining a suggestion
 * bucket somebody did not choose for it.
 *
 * The first entry in each list is the question that desk exists to answer, and
 * it never rotates away — the same rule as the buyer's page-specific questions.
 */
const ADMIN = {
  // The dashboard is where somebody lands, so it gets the broad ones.
  dashboard: ['What needs doing?', 'How are we doing today?', 'How is stock?'],
  orders: ['What is stuck?', 'Anything flagged by a carrier?', 'Which payment rails are moving?'],
  // The pick, pack and ship desks all ask the same question from three
  // positions: what is waiting on somebody, and which parcels have gone wrong.
  fulfilment: ['What is stuck?', 'Anything flagged by a carrier?'],
  stock: ['How is stock?', 'Which products are missing a description?'],
  support: ['What needs doing?', 'How are we doing today?'],
  payments: ['Which payment rails are moving?', 'What is stuck?'],
};

/** Asked anywhere in the console when the desk has nothing more specific. */
const ADMIN_GENERAL = [
  'What is stuck?',
  'How is stock?',
  'How are we doing today?',
  'Anything flagged by a carrier?',
];

/**
 * Which desk a console path belongs to.
 *
 * Pure and exported so `client/test/suggestedQuestions.test.mjs` can walk every
 * area against the server's own staff matchers — the same guarantee the buyer
 * routes get. A path nobody has classified falls back to `ADMIN_GENERAL`
 * rather than to the buyer list, which is the failure this whole addition
 * exists to fix and would be an embarrassing way to reintroduce it.
 */
export function adminArea(pathname) {
  const parts = String(pathname || '').split('/').filter(Boolean);
  if (parts[0] !== 'admin') return null;
  const head = parts[1] || '';
  if (!head) return 'dashboard';
  if (['orders', 'disputes', 'cash-mail', 'zelle-accounts'].includes(head)) return 'orders';
  if (['pull-list', 'ship', 'pack', 'shelves', 'warehouse', 'manifest'].includes(head)) return 'fulfilment';
  if (['products', 'stock', 'catalog-health', 'tiers', 'reviews'].includes(head)) return 'stock';
  if (head === 'support') return 'support';
  if (['nodes', 'payments'].includes(head)) return 'payments';
  return 'general';
}

/** The public half of each page's list, for a visitor with no account. */
const PUBLIC = {
  product: ['Is this in stock?', 'What do people say about it?'],
  products: ["What's popular right now?", 'What is on sale?'],
  home: ["What's new in the store?"],
};

/**
 * @param {{route?:string}|null} page from `utils/pageContext`
 * @param {{signedIn?:boolean, seed?:number, adminPath?:string}} viewer
 *   `adminPath` is the console pathname, when the assistant is being opened
 *   from inside `/admin` by somebody who is staff. It is passed rather than
 *   read from `page` so this list keeps its own six-desk grouping — see
 *   `ADMIN` above. The list is chosen here either way, and the server learns
 *   nothing from it but whichever question gets pressed.
 * @returns {string[]} at most four
 */
export default function suggestedQuestions(page, { signedIn = false, seed = 0, adminPath = null } = {}) {
  // Staff in the console get the operational list. Gated on `signedIn` as well
  // as on the path, which is belt and braces — a signed-out visitor cannot
  // reach an admin path — but the alternative is a function whose output
  // depends on a path alone, and that is the kind of thing that ends up being
  // called from the wrong place.
  const area = signedIn && adminPath ? adminArea(adminPath) : null;
  if (area) return assemble(ADMIN[area] ?? [], ADMIN_GENERAL, seed);

  const route = page?.route ?? 'home';
  const specific = (signedIn ? MINE[route] : PUBLIC[route]) ?? [];
  const filler = signedIn ? GENERAL : GENERAL.filter((q) => !/\bmy\b/i.test(q));
  return assemble(specific, filler, seed);
}

/**
 * The page's own questions, then rotated filler, capped at four.
 *
 * Extracted so the staff list and the buyer list cannot rotate differently.
 * They were one function body, and a second copy for staff would have been a
 * second rotation rule — which is how two lists that look the same start
 * behaving differently for no stated reason.
 */
function assemble(specific, filler, seed) {

  // The page's own questions ALWAYS lead and are never rotated away: what
  // somebody is looking at is the most useful thing to offer every single
  // time, and cycling it out for the sake of variety would be trading the good
  // suggestion for a worse one. Only the filler rotates.
  const pool = [];
  for (const q of specific) if (!pool.includes(q)) pool.push(q);

  const rotatable = filler.filter((q) => !pool.includes(q));
  const room = Math.max(0, 4 - pool.length);
  const offset = rotatable.length ? ((seed % rotatable.length) + rotatable.length) % rotatable.length : 0;
  for (let i = 0; i < Math.min(room, rotatable.length); i += 1) {
    pool.push(rotatable[(offset + i) % rotatable.length]);
  }
  return pool.slice(0, 4);
}
