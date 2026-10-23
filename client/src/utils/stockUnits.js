/**
 * Base units, on the client — the twin of `server/services/inventory.js`.
 *
 * A product with breakdown on has ONE balance of base units, and each variant
 * says how much of it a sale takes. That amount does not have to be whole: a
 * variant named "3.5g" takes three and a half grams out of a jar measured in
 * grams, which is precisely the case the editor's own placeholder ("e.g. 3.5g")
 * has always suggested and the form used to reject.
 *
 * The rules that matter, and why they are in a module rather than inline:
 *
 * - **Arithmetic happens in integer hundredths.** `0.1 + 0.2 !== 0.3`, and a
 *   pack count worked out from raw floats can differ from the server's by one
 *   at the exact moment it matters — the last pack in the pool. The server
 *   scales to hundredths for the same reason and with the same scale, so the
 *   two agree by construction rather than by luck.
 * - **Two decimal places, everywhere, full stop.** The column stores two, this
 *   accepts two, and the boxes step in two. There is no third place to lose:
 *   a value that passes here is a value Postgres stores back unchanged.
 *
 * ── Why two and not three ───────────────────────────────────────────────────
 *
 * The columns were NUMERIC(14,3) and this module scaled to thousandths, on the
 * argument that the trade states some pack sizes in thousandths. It cost more
 * than it bought. No scale an operator stocks a shelf from reads out a
 * milligram, so the third decimal was only ever a place for a typo to hide —
 * 3.5, 3.05 and 3.005 look alike at a glance, and the last one is a pack size
 * that sells 3.005 g for ever — and the spinner arrows walked a total a
 * thousandth at a time, which is 1000 presses to move a single gram.
 *
 * It was narrowed once before at the editor's boxes alone, which left the two
 * ends disagreeing: the boxes said two, the column said three, and everything
 * between them — the suggestion chips that FILL those boxes included — still
 * worked in thousandths and could hand the operator a number the form would
 * then refuse. One rule, held everywhere, is the point of this rewrite.
 *
 * `null` from `validUnits` means "do not send this" — the caller shows the
 * message. It never throws, because every caller is a form handler.
 */

/** Hundredths. Exported because anything dividing by it must use this one. */
export const UNIT_SCALE = 100;

/** The smallest amount the schema can hold, and the step on every stock box. */
export const UNIT_STEP = 0.01;

/** Decimal places the column holds, and what `validUnits` accepts. */
export const UNIT_DECIMALS = 2;

/** A stored NUMERIC (often a string from JSON) or a typed value → hundredths. */
export function toHundredths(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * UNIT_SCALE);
}

/**
 * Validate an amount of base units and return it as the server wants it.
 *
 * @returns {string|null} the amount to send, or null when it is not usable
 */
export function validUnits(value, { min = 0, allowZero = true } = {}) {
  const raw = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || (!allowZero && n === 0)) return null;
  const scaled = Math.round(n * UNIT_SCALE);
  // More precision than the column holds is refused rather than rounded: the
  // operator is about to rely on this number for every future sale, and a pack
  // size typed as 3.505 that becomes 3.51 changes all of them.
  if (Math.abs(n * UNIT_SCALE - scaled) > 1e-6) return null;
  if (!allowZero && scaled <= 0) return null;
  return (scaled / UNIT_SCALE).toFixed(UNIT_DECIMALS);
}

/**
 * Whole packs that fit in a balance — the client half of `availableStockSql`.
 *
 * Floored, because a pack is sold whole: 10 g of stock and a 3.5 g pack is two
 * available, with 3 g left in the pool for a smaller size.
 */
export function packsFrom(poolUnits, packUnits) {
  const size = toHundredths(packUnits);
  if (size <= 0) return 0;
  return Math.max(0, Math.floor(toHundredths(poolUnits) / size));
}

/** Base units taken by `packs` of a pack size. */
export function unitsFor(packs, packUnits) {
  return (Math.round(Number(packs) || 0) * toHundredths(packUnits)) / UNIT_SCALE;
}

/**
 * An amount of base units as a person would write it.
 *
 * Trailing zeros are dropped, because NUMERIC(14,2) hands back "3.50" and a
 * shelf label reading "3.50 g" is noise — but a genuine "0.5" keeps its digit.
 */
export function formatUnits(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Number(n.toFixed(UNIT_DECIMALS)));
}
