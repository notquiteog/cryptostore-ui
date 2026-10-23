import { toHundredths, UNIT_SCALE } from './stockUnits.js';

/**
 * What each pack on a breakdown product costs per base unit, and which packs
 * are out of order.
 *
 * ── The failure this catches ────────────────────────────────────────────────
 *
 * A breakdown product is one pool sold in several pack sizes, and the whole
 * point of the bigger pack is that it is cheaper per gram. When a smaller pack
 * undercuts a bigger one — a pound at $1200 beside a half pound at $500 — the
 * bigger pack is simply a worse deal, and a buyer who wants a pound buys two
 * halves for $1000 instead. Nobody is cheated and nothing breaks; the shop just
 * quietly stops selling its largest size, and the operator finds out from a
 * sales report rather than from the screen where the number was typed.
 *
 * It is almost always a typo. A price is typed into a box the width of two
 * words, next to four other boxes, on a card that is collapsed by default, and
 * nothing on that screen ever put the ladder side by side. So this states the
 * per-unit figure for every pack and points at the pair that disagrees.
 *
 * ── It states, and never blocks ─────────────────────────────────────────────
 *
 * Same line `MarginNote` takes, for the same reason: a shop may deliberately
 * price a small pack keenly — a sampler, a promotion, a size it wants to clear —
 * and a form that refused would be making a commercial decision that belongs to
 * the operator. `pricingService` is still the only thing that prices anything;
 * nothing here is charged to anybody. These are two numbers the operator typed,
 * divided, and shown back.
 *
 * ── Why "the pack above" is decided by SIZE, not by position ────────────────
 *
 * The obvious reading of "cheaper than the one above it" is the card above it
 * in the list, and it is wrong: the list is in `sort_order`, which an operator
 * is free to arrange smallest-first. On a smallest-first ladder every correctly
 * priced row is cheaper per unit than the row above it, so a positional check
 * would warn about all of them and mean nothing. The comparison that holds
 * whatever the order is the next LARGER pack, which is also what somebody means
 * by "the one above" when the ladder is arranged the usual way.
 *
 * ── Hidden packs are neither compared nor warned about ──────────────────────
 *
 * A warning here is a statement about what a buyer can do today, and a hidden
 * variant is not something they can do. It also keeps the create path quiet:
 * a new breakdown product is seeded with a hidden $0 placeholder variant, and
 * a $0 pack undercuts everything. Revealing a pack is what makes it part of
 * the ladder, and the warning appears at that moment — which is the moment it
 * becomes true.
 */

/**
 * A typed price → integer cents, by the same rounding the pricing engine uses.
 *
 * `Number(x.toFixed(2))` first, because the box accepts `step="0.01"` but a
 * pasted `19.999` is still a number this has to turn into one honest cent
 * figure rather than into 1999.9 and a float comparison downstream.
 */
export function priceCents(price) {
  if (price === '' || price === null || price === undefined) return null;
  const n = Number(price);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(Number(n.toFixed(2)) * 100);
}

/**
 * Cents per base unit, as a number for display only.
 *
 * Fractional on purpose — a $1200 pound is 267.857… cents a gram and there is
 * no honest way to round that to a cent. Nothing compares these; the comparison
 * below is done on integers precisely so that this figure never decides
 * anything.
 */
function perUnitCents(cents, hundredths) {
  // The scale, not a literal 1000. This used to carry the thousandths figure
  // written out, which was correct only while the column had three places —
  // the kind of constant that keeps returning the right answer for a year and
  // then quietly returns a tenth of it.
  return (cents * UNIT_SCALE) / hundredths;
}

/** The per-unit figure as money, with enough digits to not read as free. */
export function formatPerUnit(cents) {
  const dollars = cents / 100;
  // Two places is the house form and stays exactly two — "$2.90", never "$2.9",
  // because a price column that drops a digit stops lining up. The exception is
  // below a cent, where two places turns four tenths of a cent into "$0.00" and
  // reads as free beside prices that are not: a thousand-count pack at $5
  // genuinely is $0.005 a unit, and a warning about it needs the digits. Only
  // that branch trims, and only the zeros it added itself.
  if (dollars <= 0 || dollars >= 0.01) return `$${dollars.toFixed(2)}`;
  return `$${dollars.toFixed(5).replace(/0+$/, '')}`;
}

/**
 * Per-unit notes for a product's variants, one per input row, same order.
 *
 * @param {Array} variants  the variants as the editor holds them
 * @returns {Array<null | {
 *   perUnit: number,
 *   undercuts: null | { name: string, perUnit: number },
 * }>} null where there is nothing to say — no price yet, no size, or hidden
 */
export function unitPriceNotes(variants = []) {
  const notes = variants.map(() => null);

  const priced = [];
  variants.forEach((v, index) => {
    if (!v || v.active === false) return;
    const hundredths = toHundredths(v.stock_units ?? 0);
    const cents = priceCents(v.price);
    // A pack of nothing has no per-unit price, and a blank price box is a row
    // being typed rather than a row that is wrong.
    if (hundredths <= 0 || cents === null) return;
    priced.push({ index, hundredths, cents, name: String(v.name ?? '').trim() });
  });

  for (const row of priced) {
    // The next larger pack: the smallest one strictly above this size. Not the
    // largest — an inversion three rungs up is a different pair's problem, and
    // reporting it here would put the same warning on every row beneath it.
    let above = null;
    for (const other of priced) {
      if (other.hundredths <= row.hundredths) continue;
      if (above === null || other.hundredths < above.hundredths) above = other;
    }

    const note = { perUnit: perUnitCents(row.cents, row.hundredths), undercuts: null };
    notes[row.index] = note;
    if (!above) continue;

    // Cross-multiplied rather than divided. Two integers compared exactly is
    // the same rule the rest of this codebase applies to money, and it costs
    // nothing here: `cents / hundredths` would be a double whose last bit decides
    // whether a ladder priced at one flat rate throughout is reported as level
    // or as inverted, and no reader should have to work out which. There is no
    // rounding to reason about if there is no division.
    //
    // The guard is on the arithmetic, not on any catalogue that exists: the
    // products stay exact below 2^53, which a price and a pack size reach only
    // together at around ninety billion dollar-units. Past that this says
    // nothing rather than something it cannot stand behind.
    const mine = row.cents * above.hundredths;
    const theirs = above.cents * row.hundredths;
    if (!Number.isSafeInteger(mine) || !Number.isSafeInteger(theirs)) continue;
    if (mine < theirs) {
      note.undercuts = { name: above.name, perUnit: perUnitCents(above.cents, above.hundredths) };
    }
  }

  return notes;
}
