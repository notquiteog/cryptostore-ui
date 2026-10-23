/**
 * A tier's perks, in words — the one place the storefront and the console
 * spell "what does this tier get you".
 *
 * ── Why a module ────────────────────────────────────────────────────────────
 *
 * The membership page used to print a tier as "5% off every order · Valued
 * customer": the discount, then the operator's free-text description. The
 * description is a label, not a fact, and the fact it crowded out was the
 * other perk a tier carries — the head start on scheduled drops
 * (`early_access_minutes`) — which the customer could hold for a day without
 * the page ever saying so. The line now reads "5% discount · 2d early access",
 * with the description (when the operator wrote one) beneath it rather than
 * instead of it.
 *
 * Minutes are the right storage unit and the wrong reading unit: "1440" is a
 * number a person has to divide before they know whether it is a day or an
 * afternoon. `headStartLabel` is the same shape the console's tier table and
 * the product editor's go-live table use, so the same number reads the same
 * everywhere it appears — "1d 2h", "12h", "1h 30m", "45m".
 */

/** "2d 3h" — a head start in the units a person thinks in, or null for none. */
export function headStartLabel(minutes) {
  const total = Math.max(0, Math.floor(Number(minutes) || 0));
  if (total === 0) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  const days = Math.floor(h / 24);
  if (days >= 1) {
    const rh = h % 24;
    return `${days}d${rh ? ` ${rh}h` : ''}`;
  }
  if (h >= 1) return `${h}h${m ? ` ${m}m` : ''}`;
  return `${m}m`;
}

/**
 * The perks a tier carries, as a list of short phrases: the discount, then the
 * head start. Empty when the tier carries neither, so the caller decides what
 * "nothing" says on its own surface.
 */
export function tierPerkParts(tier) {
  const parts = [];
  const pct = Number(tier?.discount_pct) || 0;
  if (pct > 0) parts.push(`${pct}% discount`);
  const lead = headStartLabel(tier?.early_access_minutes);
  if (lead) parts.push(`${lead} early access`);
  return parts;
}

/**
 * "10% discount · 2d early access" — or the given fallback when a tier
 * carries neither perk. The separator is the storefront's middle dot, the
 * same one the rest of the membership page joins facts with.
 */
export function tierPerks(tier, { fallback = 'No discount' } = {}) {
  const parts = tierPerkParts(tier);
  return parts.length ? parts.join(' · ') : fallback;
}
