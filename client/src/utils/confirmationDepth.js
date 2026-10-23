/**
 * The client's read of the confirmation-depth policy — for SAYING what a rail
 * costs in waiting, never for deciding anything.
 *
 * The authority is server/utils/confirmationDepth.js, which stamps
 * `required_confirmations` onto every payment row and is the only place a
 * depth is ever decided. This mirrors its ladder walk so the checkout can
 * print "settles in about 20–40 min" beside each coin BEFORE an order exists —
 * there is no payment row yet to read the stamped value from. The two walks
 * agree by construction (same rules: floor, then the deepest matching rung;
 * an unknown value takes the deepest rung), and a disagreement would only
 * ever mis-state an estimate, not a settlement.
 *
 * `payment_confirmation_depth` rides the public settings payload for exactly
 * this. Hardcoding btc 2 / ltc 2 / xmr 20 here instead would make the copy
 * lie the moment an operator tuned the policy.
 */

export const DEFAULT_DEPTHS = { btc: 2, ltc: 2, xmr: 20 };

/** Mean block interval per chain, in seconds. Physics, not policy. */
export const BLOCK_SECONDS = { btc: 600, ltc: 150, xmr: 120 };

/** Parse the stored blob defensively; a bad row falls back to the defaults. */
export function parseDepthPolicy(raw) {
  const out = {};
  let data = null;
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { data = null; }
  for (const coin of Object.keys(DEFAULT_DEPTHS)) {
    const entry = data && typeof data === 'object' ? data[coin] : null;
    const floor = Number(entry?.floor);
    const tiers = Array.isArray(entry?.tiers)
      ? entry.tiers
        .map((t) => ({ min_usd: Number(t?.min_usd), depth: Number(t?.depth) }))
        .filter((t) => Number.isFinite(t.min_usd) && Number.isFinite(t.depth))
        .sort((a, b) => a.min_usd - b.min_usd)
      : [];
    out[coin] = {
      floor: Number.isFinite(floor) && floor >= 1 ? Math.round(floor) : DEFAULT_DEPTHS[coin],
      tiers,
    };
  }
  return out;
}

/** The depth this store would require for `coin` on an order worth `usd`. */
export function depthFor(policy, coin, usd) {
  const entry = policy?.[coin];
  if (!entry) return DEFAULT_DEPTHS[coin] ?? 1;
  let depth = entry.floor;
  const value = Number(usd);
  if (!Number.isFinite(value) || value < 0) {
    for (const t of entry.tiers) depth = Math.max(depth, t.depth);
    return depth;
  }
  for (const t of entry.tiers) {
    if (t.min_usd > value) break;
    depth = Math.max(depth, t.depth);
  }
  return depth;
}

/**
 * How long `depth` blocks usually take on `coin`, as a range in minutes.
 *
 * Block arrival is a Poisson process, so the honest answer is a spread, not
 * a number: the low end is a run of quick blocks, the high end a slow one.
 * The factors (0.7× to 1.6× the mean) cover the bulk of what a buyer will
 * actually watch — printing the mean alone reads as a promise the chain does
 * not make.
 */
export function settleWindowMinutes(coin, depth) {
  const secs = BLOCK_SECONDS[coin];
  if (!secs || !depth) return null;
  const mean = (secs * depth) / 60;
  return { lo: Math.max(1, Math.round(mean * 0.7)), hi: Math.max(2, Math.round(mean * 1.6)), mean };
}

/** "about 20–40 min" / "about 2–4 h", for a window from settleWindowMinutes. */
export function formatWindow(win) {
  if (!win) return null;
  if (win.hi < 90) return `${win.lo}–${win.hi} min`;
  const h = (m) => (m / 60).toFixed(m % 60 === 0 ? 0 : 1).replace(/\.0$/, '');
  return `${h(win.lo)}–${h(win.hi)} h`;
}
