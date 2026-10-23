/**
 * The price sheet's arithmetic, on the client — the twin of
 * `server/utils/priceSheet.js`.
 *
 * Everything the sheet works out BEFORE the server sees it lives here: what
 * a usable price is, whether a ladder changed, how a percentage fills the
 * price column, and which rows are worth sending. It is a module rather than
 * component state because these are the answers the page shows the operator
 * ("3 prices and 1 ladder changed") and they have to be the same answers the
 * server gives when the sheet is sent, or the count on the button and the
 * count in the toast disagree.
 *
 * Money is integer cents throughout, for the reason `CLAUDE.md` gives: a
 * percentage applied as `price * 0.9` is a float, and the sheet would show a
 * cent that does not exist. `movePriceCents` is the server's function, copied
 * line for line, so a fill previewed here lands on exactly the number the
 * percentage tool would have written.
 */

/** As high as a list price may go. Mirrors the server's bound. */
export const MAX_PRICE = 1000000;

/**
 * How the fill row can pre-fill the list-price column. Tiers are never filled:
 * a ladder is authored per size, and a percentage applied to every band of
 * forty ladders is precisely the kind of edit nobody reads before saving.
 */
export const FILL_MODES = [
  { key: 'percent', label: 'By a percentage', unit: '%', hint: 'Negative takes money off: −10 fills every list price 10% lower than it is now.' },
  { key: 'amount', label: 'By an amount', unit: '$', hint: 'Negative takes money off: −2.50 fills every list price $2.50 lower than it is now.' },
  { key: 'set', label: 'Set every list price to', unit: '$', hint: 'Every list price on the sheet becomes this. Volume tiers are left for you to check.' },
];

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * A typed amount → whole cents, or null when it is not a price.
 *
 * Two decimal places at most, refused rather than rounded: a sheet is the one
 * place forty prices get typed in a row, and a 12.345 that quietly became
 * 12.35 is a price the operator never chose.
 */
export function parseMoney(value) {
  const raw = typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
  if (raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_PRICE) return null;
  const cents = Math.round(n * 100);
  if (Math.abs(n * 100 - cents) > 1e-6) return null;
  return cents;
}

/** Cents → the string a price box and the wire both carry. */
export function moneyFromCents(cents) {
  return (cents / 100).toFixed(2);
}

/**
 * One price, moved. The server's `movePriceCents`, copied so a fill previewed
 * here is the number the server would compute.
 *
 * Clamped at zero rather than refused: "take $5 off everything" over a $3
 * item is a sensible instruction with an obvious answer, and the sheet shows
 * the 0.00 for the operator to fix before anything is saved.
 */
export function movePriceCents(cents, mode, value) {
  if (mode === 'set') return Math.max(0, Math.round(round2(value) * 100));
  if (mode === 'amount') return Math.max(0, cents + Math.round(round2(value) * 100));
  return Math.max(0, Math.round((cents * (100 + Number(value))) / 100));
}

/** Is a fill value usable for its mode? The message is what the button shows. */
export function fillProblem(mode, value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return 'Enter a number';
  const n = Number(raw);
  if (!Number.isFinite(n)) return 'Enter a number';
  if (mode === 'percent' && (n <= -100 || n > 1000)) return 'A percentage must be above −100 and at most 1000';
  if (mode !== 'percent' && Math.abs(n) > MAX_PRICE) return `That is more than ${MAX_PRICE}`;
  if (mode === 'set' && n < 0) return 'A price cannot be negative';
  if (mode !== 'set' && n === 0) return 'That would change nothing';
  return null;
}

/**
 * The leading quantity of a tier label, the way the pricing engine reads it:
 * "3+", "3 or more" and "3" all mean three; "bulk" means nothing and would be
 * a band the engine skips — which is why the sheet refuses it.
 */
export function tierQty(label) {
  const n = parseInt(String(label ?? '').trim(), 10);
  return Number.isNaN(n) || n < 1 ? null : n;
}

/** The same ladder? Same bands, same prices, same order. */
export function tiersEqual(a, b) {
  const x = a || [];
  const y = b || [];
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i++) {
    if (String(x[i].min_qty_label ?? '').trim() !== String(y[i].min_qty_label ?? '').trim()) return false;
    const p = parseMoney(x[i].price);
    const q = parseMoney(y[i].price);
    if (p === null || q === null || p !== q) return false;
  }
  return true;
}

/**
 * What is wrong with one variant's row, in the words the row shows, or null.
 *
 * The same refusals the server makes, made here first so the operator reads
 * them beside the box rather than in a toast naming a row they have to find.
 */
export function rowProblem(edit) {
  if (!edit) return null;
  if (parseMoney(edit.price) === null) return 'The list price needs a number with at most two decimal places';
  const seen = new Map();
  for (let i = 0; i < (edit.tiers || []).length; i++) {
    const t = edit.tiers[i];
    const label = String(t.min_qty_label ?? '').trim();
    if (!label) return `Tier ${i + 1} needs a quantity, like 3+`;
    if (label.length > 32) return `Tier ${i + 1} label is too long`;
    const qty = tierQty(label);
    if (qty === null) return `Tier ${i + 1} has to start with the quantity it applies from, like 3+`;
    if (seen.has(qty)) return `Tiers ${seen.get(qty)} and ${i + 1} both start at ${qty}`;
    seen.set(qty, i + 1);
    if (parseMoney(t.price) === null) return `Tier ${i + 1} needs a price with at most two decimal places`;
  }
  return null;
}

/**
 * The sheet, reduced to what changed.
 *
 * `products` is the server's sheet; `edits` maps variant id → `{ price, tiers }`
 * as typed. Returns the rows worth sending, the `expect` that guards them,
 * the counts the summary line prints, and every row that cannot be sent yet.
 */
export function sheetChanges(products, edits) {
  const rows = [];
  const expect = [];
  const invalid = [];
  let prices = 0;
  let ladders = 0;
  const touched = new Set();
  for (const p of products || []) {
    for (const v of p.variants || []) {
      const edit = edits[v.id];
      if (!edit) continue;
      const problem = rowProblem(edit);
      if (problem) { invalid.push({ id: v.id, name: `${p.name}${v.name ? ` — ${v.name}` : ''}`, problem }); continue; }
      const priceChanged = parseMoney(edit.price) !== parseMoney(v.price);
      const ladderChanged = !tiersEqual(edit.tiers, v.tiers);
      if (!priceChanged && !ladderChanged) continue;
      if (priceChanged) prices += 1;
      if (ladderChanged) ladders += 1;
      touched.add(p.id);
      rows.push({
        variant_id: v.id,
        ...(priceChanged ? { price: moneyFromCents(parseMoney(edit.price)) } : {}),
        ...(ladderChanged ? { tiers: edit.tiers.map((t) => ({ min_qty_label: String(t.min_qty_label).trim(), price: moneyFromCents(parseMoney(t.price)) })) } : {}),
      });
      expect.push({ variant_id: v.id, from: v.price, tiers_from: v.tiers });
    }
  }
  return { rows, expect, changed: rows.length, prices, ladders, products: touched.size, invalid };
}
