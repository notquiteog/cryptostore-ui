/**
 * Which pages the introduction actually has, given what this shop is.
 *
 * ── Why this is a module and not an `&&` in the component ───────────────────
 *
 * The introduction describes features. A shop that has switched the assistant
 * off must not be shown two pages explaining one, and a shop with no PGP key
 * must not offer to encrypt an address to a key that does not exist — those
 * are not cosmetic slips, they are the screen making promises the install
 * cannot keep, which is the failure `CLAUDE.md` cares about most. Every page
 * below is therefore conditional on something read from the server, and the
 * conditions are here, as data, where a test can walk all of them.
 *
 * The component then renders a list rather than deciding anything: it cannot
 * put up a page the plan did not include, and it cannot count its own steps
 * wrong, because the count IS the plan's length.
 *
 * ── The two pages that are never conditional ────────────────────────────────
 *
 * `ordering` and `recovery`. Every install has orders and every install has
 * accounts with no email or phone on them, so the two things they say — what
 * the shop keeps about where a parcel goes, and that there is no reset link —
 * are true of the most permissive clearnet deployment and the most hostile
 * one alike. A store that offers nothing else still owes somebody those.
 */

/**
 * The pages, in order. `id` is what the component switches on; `title` is what
 * the rail prints beside the number.
 *
 *   when(ctx)  decides whether this page exists for this install at all.
 *
 * `ctx` is `{ ai, hasKey, storeKeyReady }`:
 *   ai            the `/api/ai/status` payload (or null while it is loading)
 *   hasKey        does this account already have a public key on file
 *   storeKeyReady can the store encrypt an address right now
 */
const STEPS = [
  {
    id: 'finding',
    title: 'Finding things',
    lede: 'Search, and the assistant behind it',
    // Only where the shop has AI switched on AND offers something a buyer can
    // see. A store using the model purely for staff copywriting has nothing to
    // tell a buyer here, and a page describing a search that ranks by meaning
    // would be describing search this install does not do.
    when: (ctx) => buyerCapabilities(ctx.ai).length > 0,
  },
  {
    id: 'switches',
    title: 'Switching it on',
    lede: 'What you are agreeing to, per feature',
    // Needs at least one capability that consent is a real question for. On a
    // shop offering only semantic search there is nothing to ask: it reads
    // nothing about the person, and a consent toggle for it would teach people
    // that the toggles are decoration.
    when: (ctx) => consentableCapabilities(ctx.ai).length > 0,
  },
  {
    id: 'ordering',
    title: 'Placing an order',
    lede: 'What the shop keeps, and for how long',
    when: () => true,
  },
  {
    id: 'recovery',
    title: 'Your key, and getting back in',
    lede: 'There is no reset link — this is what replaces it',
    when: () => true,
  },
];

/** Buyer-facing capabilities this shop actually offers, in registry order. */
function buyerCapabilities(ai) {
  if (!ai?.enabled) return [];
  return (ai.capabilities || []).filter((c) => c.audience === 'buyer' && c.offered);
}

/**
 * The subset the introduction's checkbox governs: offered, buyer-facing, and
 * needing consent.
 *
 * `needs_consent` comes from the server rather than being inferred from a list
 * here, so a capability that changes its mind about reading somebody's data
 * changes it in one place.
 */
function consentableCapabilities(ai) {
  return buyerCapabilities(ai).filter((c) => c.needs_consent);
}

/** The pages this install has, in order. Never empty. */
function planSteps(ctx) {
  const steps = STEPS.filter((s) => s.when(ctx));
  // The finale is not conditional and is not in the table above, because it is
  // not a page somebody reads — it is what happens after the last one, and
  // giving it a `when` would invite somebody to switch it off and leave the
  // flow with no ending.
  return [...steps, { id: 'done', title: 'Done', lede: '' }];
}

/**
 * Is this a page the person can still be on after the answers are saved?
 *
 * Only the finale. Used to decide whether a back button exists — going back
 * out of the finale would mean un-finishing something already written down.
 */
function isFinale(step) {
  return step?.id === 'done';
}

export {
  STEPS, planSteps, isFinale, buyerCapabilities, consentableCapabilities,
};
