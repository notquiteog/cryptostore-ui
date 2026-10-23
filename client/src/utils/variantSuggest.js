import { toHundredths, formatUnits, UNIT_SCALE } from './stockUnits.js';

/**
 * The next variant, proposed from the ones already on the product.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * Adding a second size to a product is the most repetitive thing in the editor
 * and the easiest to get subtly wrong. A breakdown product priced in grams
 * wants its pack sizes to divide cleanly — an operator who types 112 where a
 * quarter pound is 112 has done arithmetic that the shop already knows how to
 * do, and one who types 110 has made a pack that leaves 2 g stranded in the
 * pool on every sale. A counted product wants the usual steps below the one
 * that exists. And a product with neither wants the variant it already has,
 * again, with a different name.
 *
 * So this proposes; it never creates. Every suggestion is a pre-filled form
 * somebody still has to name, check and save.
 *
 * ── The one rule about money ────────────────────────────────────────────────
 *
 * A price is COPIED or it is BLANK. It is never derived.
 *
 * Copying is safe: a clone of a variant at $100 is a variant at $100, and the
 * operator can see that it is the same number. Deriving is not: a half-pound
 * suggestion priced at half the pound is a number this file invented, and it
 * would be invented in the currency the shop actually charges, on a screen
 * where the next press is Save. `CLAUDE.md` puts pricing in one engine for
 * exactly this reason, and a page that guesses at prices is a second pricing
 * author no matter how reasonable the guess. The fraction suggestions therefore
 * carry a size and no price, which is also the honest shape — half the weight
 * is rarely half the money, and every operator knows that.
 *
 * Discount tiers ride with the clone for the same reason the price does: they
 * are copied exactly, not scaled.
 *
 * ── Which existing variant is the source ────────────────────────────────────
 *
 * For a breakdown product, the LARGEST pack: you divide down from the pound,
 * not up from the eighth, and the largest is the only one every smaller size
 * divides cleanly out of. For everything else, the LAST one in the list, which
 * is what "make another one like that" means to somebody who has just added it.
 */

/**
 * Most suggestions offered at once.
 *
 * A backstop, not a curator. It was three, on the grounds that past three this
 * is a catalogue of guesses — but the ladders below stopped being guesses: they
 * are the rungs the shop actually sells, chosen deliberately, and a cap of
 * three meant a counted product offered 90, 80 and 75 and silently dropped the
 * eight steps underneath them. The longest ladder is eleven rungs and this sits
 * just above it, so the ladder is the limit and the cap only bites if somebody
 * lengthens one without looking at the row it renders into.
 */
const MAX_SUGGESTIONS = 12;

/**
 * The halving ladder, for a pack whose size came from a unit conversion.
 *
 * Half and quarter, and no further AS PREFIXES. "Half Pound" and "Quarter
 * Ounce" are what the trade calls those things; an eighth rung produced
 * "Eighth Pound", which is not a name anybody uses — an eighth means 3.5 g, an
 * eighth of an OUNCE, and an eighth of a pound is 56 g, which people call two
 * ounces. Worse, it appeared on a product that already had a variant called
 * "Eighth (3.5g)", so the suggestion was not merely unidiomatic, it collided
 * with a real name meaning something sixteen times smaller.
 *
 * The general lesson is in `prefixable` below: a word prefixed onto whatever
 * the source happens to be called only reads correctly one level deep. The
 * eighth and the ounce are still offered — by `WEIGHTS`, which names them at
 * the size they actually mean instead of deriving a name from the source.
 */
const FRACTIONS = [
  { over: 2, word: 'Half' },
  { over: 4, word: 'Quarter' },
];

/**
 * The pack sizes that carry their own name at a FIXED size.
 *
 * An ounce is 28 g and an eighth is 3.5 g, whatever the biggest pack on the
 * product happens to be. That is exactly why they cannot ride on `FRACTIONS`:
 * a sixteenth of a pound is an ounce, but a sixteenth of an ounce is 1.75 g,
 * and calling that an ounce would be the "Eighth Pound" mistake in a different
 * word. Named absolutely, and offered only when the pool divides into them
 * exactly — a pool that does not divide is not being measured in grams, and a
 * pack that leaves a remainder strands stock on every sale, which is the
 * arithmetic this whole helper exists to prevent.
 *
 * They are also why sizes are deduplicated across both ladders below: half of
 * 56 g is 28 g, which is an ounce, and it must be offered once, under the name
 * the trade uses rather than twice under two.
 */
const WEIGHTS = [
  { units: 28, name: 'Ounce' },
  { units: 3.5, name: 'Eighth' },
];

/**
 * The usual steps below a round count, as fractions of it.
 *
 * Eleven rungs — 90, 80, 75, 70, 60, 50, 40, 30, 25, 20 and 10 percent — because
 * a counted product is where an operator lays out a whole shelf of sizes in one
 * sitting, and the four this used to offer meant typing the rest by hand. Steps
 * that do not come out whole are dropped where they are worked out, not argued
 * with here: 75% of 50 is 37.5, and nobody sells half a box.
 */
const STEPS = [0.9, 0.8, 0.75, 0.7, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2, 0.1];

/**
 * Is this pack size a round COUNT rather than a converted measure?
 *
 * 100, 50 and 250 are counts somebody chose; 448, 28 and 3.5 are what a pound,
 * an ounce and an eighth come to in grams. The two want different ladders —
 * nobody sells 403.2 g and nobody sells an eighth of a hundred — and this is
 * the cheapest question that separates them reliably: a converted measure is
 * almost never a clean multiple of ten.
 */
const COUNTED_STEP = 10 * UNIT_SCALE;
function looksCounted(units) {
  const scaled = toHundredths(units);
  return scaled >= COUNTED_STEP && scaled % COUNTED_STEP === 0;
}

/** A number as a variant name, if the source's own name was one. */
function numericName(sourceName) {
  const n = Number(String(sourceName ?? '').trim());
  return Number.isFinite(n) && String(sourceName ?? '').trim() !== '';
}

/**
 * May "Half " be put in front of this name?
 *
 * Only when the name is a bare unit — "Pound", "Oz", "Jar". A name that already
 * carries a fraction word or a number is one this ladder has been down before,
 * and prefixing it again compounds: halving "Quarter pound" would offer "Half
 * Quarter pound", and halving "Eighth (3.5g)" would offer "Half Eighth (3.5g)".
 *
 * When it is not prefixable the suggestion still stands — the SIZE is the part
 * that is worth getting right, and it is arithmetic rather than a guess — but
 * it arrives with the name box empty. An empty name is a prompt, and the editor
 * already refuses to save a variant without one; a wrong name is something
 * somebody saves.
 */
function prefixable(sourceName) {
  const name = String(sourceName ?? '').trim();
  if (!name) return false;
  if (/\d/.test(name)) return false;
  return !/\b(half|quarter|eighth|third|sixteenth)\b/i.test(name);
}

/**
 * Suggestions for the next variant.
 *
 * @param {object}  opts
 * @param {Array}   opts.variants   the variants on the product, as the editor holds them
 * @param {boolean} opts.breakdown  whether the product shares one pool of base units
 * @returns {Array<{key: string, label: string, hint: string, patch: object}>}
 */
export function suggestVariants({ variants = [], breakdown = false } = {}) {
  // Unsaved rows are not a basis for anything: their fields are half-typed by
  // definition, and suggesting a clone of a blank row would offer a blank row.
  const saved = variants.filter((v) => v && !v.isNew);
  if (!saved.length) return [];

  if (!breakdown) return [cloneSuggestion(saved[saved.length - 1])];

  // Largest pack first. `toHundredths` rather than a float compare, for the
  // reason stockUnits gives: the last pack in the pool is decided in hundredths
  // and a float comparison can disagree with the server about which is biggest.
  const source = saved.reduce(
    (biggest, v) => (toHundredths(v.stock_units) > toHundredths(biggest.stock_units) ? v : biggest),
    saved[0],
  );
  const sourceScaled = toHundredths(source.stock_units);
  if (sourceScaled <= 0) return [];

  // Sizes already on the product, so a suggestion is never a size that exists.
  const taken = new Set(saved.map((v) => toHundredths(v.stock_units)));

  const out = [];
  const asNumber = numericName(source.name);

  if (looksCounted(source.stock_units)) {
    for (const step of STEPS) {
      const scaled = Math.round(sourceScaled * step);
      // A step that lands between hundredths is not a pack size the column can
      // hold, and one that is already on the product is not a suggestion.
      if (scaled <= 0 || taken.has(scaled)) continue;
      // Whole sizes stay whole. 75% of 50 is 37.5, and offering a fractional
      // count of a thing that is counted in boxes is the suggestion that makes
      // an operator distrust all of them.
      if (sourceScaled % UNIT_SCALE === 0 && scaled % UNIT_SCALE !== 0) continue;
      // Taken from here on, so two steps that round onto the same size offer it
      // once. Eleven rungs are enough for that to be reachable on a small
      // source in a way four never were.
      taken.add(scaled);
      const units = scaled / UNIT_SCALE;
      out.push({
        key: `step-${scaled}`,
        label: formatUnits(units),
        hint: `${Math.round(step * 100)}% of ${source.name || formatUnits(source.stock_units)}`,
        patch: { name: asNumber ? formatUnits(units) : '', stock_units: formatUnits(units) },
      });
      if (out.length >= MAX_SUGGESTIONS) break;
    }
    return out;
  }

  const canPrefix = prefixable(source.name);
  const sourceLabel = source.name || formatUnits(source.stock_units);

  // Both ladders write into one map keyed by SIZE, because they can land on the
  // same one: half of 56 g and an ounce are both 28 g, and two buttons that
  // create the same pack under two names is a form asking which one you meant.
  // Weights go in first so the size that has a name of its own keeps it —
  // "Ounce" beats "Half 56g", and beats an empty name outright.
  const bySize = new Map();

  for (const { units: size, name: weightName } of WEIGHTS) {
    const scaled = toHundredths(size);
    // Smaller than the source, and an exact division of it. A pound holds
    // sixteen ounces and a hundred and twenty-eight eighths; an ounce holds
    // eight eighths and no ounces. Anything counted never reaches here at all —
    // `looksCounted` returned above — so a source that divides by 28 or 3.5 is
    // a pool measured in grams, and one that does not is left alone rather than
    // handed a weight name for a size it is not.
    if (scaled <= 0 || scaled >= sourceScaled || sourceScaled % scaled !== 0) continue;
    if (taken.has(scaled) || bySize.has(scaled)) continue;
    const units = scaled / UNIT_SCALE;
    // A number when the source was a number, for the same reason as below; the
    // weight's own name otherwise. Never a prefix: these are absolute.
    const name = asNumber ? formatUnits(units) : weightName;
    bySize.set(scaled, {
      key: `weight-${scaled}`,
      label: name,
      hint: `${formatUnits(units)} — one ${weightName.toLowerCase()} out of ${sourceLabel}`,
      patch: { name, stock_units: formatUnits(units) },
    });
  }

  for (const { over, word } of FRACTIONS) {
    // Exact division only. 448 halves to 224 and 28 halves to 14; a size that
    // does not divide cleanly would produce a pack that leaves a remainder
    // stranded in the pool on every single sale, which is the arithmetic
    // mistake this whole helper exists to prevent rather than to make.
    if (sourceScaled % over !== 0) continue;
    const scaled = sourceScaled / over;
    if (taken.has(scaled) || bySize.has(scaled)) continue;
    const units = scaled / UNIT_SCALE;
    // Three ways to name it, in order of how much this file actually knows:
    // the number, when the source was a number; "Half Pound", when the source
    // is a bare unit; nothing at all otherwise. The size is filled in either
    // way — that part is arithmetic, not naming.
    const name = asNumber ? formatUnits(units) : (canPrefix ? `${word} ${source.name}` : '');
    bySize.set(scaled, {
      key: `frac-${over}`,
      label: name || formatUnits(units),
      hint: `${formatUnits(units)} — ${word.toLowerCase()} of ${sourceLabel}`,
      patch: { name, stock_units: formatUnits(units) },
    });
  }

  // Biggest first, so the row reads as a ladder down from the pack that exists
  // rather than as the order two separate rules happened to run in.
  return [...bySize.entries()]
    .sort(([a], [b]) => b - a)
    .slice(0, MAX_SUGGESTIONS)
    .map(([, suggestion]) => suggestion);
}

/**
 * The plain clone: same price, same ladder, no name.
 *
 * No name on purpose. A variant called "Cherry Reign copy" that somebody saves
 * without reading is worse than an empty box that will not save until it is
 * named — the editor already refuses a nameless variant, so the blank is a
 * prompt with a guard behind it.
 *
 * Tiers are copied WITHOUT their ids, because they are new rows on a new
 * variant; carrying an id through would make the save path look like an edit to
 * the tier it was copied from.
 */
function cloneSuggestion(source) {
  return {
    key: 'clone',
    label: 'Another like this one',
    hint: source.tiers?.length
      ? `Same price and the same ${source.tiers.length} discount tier${source.tiers.length === 1 ? '' : 's'} as ${source.name || 'it'}`
      : `Same price as ${source.name || 'it'}`,
    patch: {
      name: '',
      price: source.price ?? '',
      tiers: (source.tiers || []).map((t) => ({
        price: t.price,
        min_qty_label: t.min_qty_label,
      })),
    },
  };
}

export { MAX_SUGGESTIONS, looksCounted, prefixable };
