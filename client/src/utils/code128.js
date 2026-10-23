/**
 * Code 128, subset B — a barcode a scanner can actually read.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Both printed sheets that carried a "barcode" said in their own comments that
 * it encoded nothing: a repeating gradient derived from the characters of the
 * id, decorative, hidden from assistive tech for that reason. Meanwhile the
 * packing bench describes its keyboard path as "the fast one at a desk with a
 * scanner" — the bench accepted scanner input and nothing the store printed
 * could be scanned. This is the missing half.
 *
 * No dependency. Code 128 is a lookup table of 107 six-element patterns, a
 * start code, a weighted modulo-103 checksum, and a stop pattern; the whole
 * thing is under a hundred lines and there is nothing a package would add
 * except supply-chain surface on a project whose users care about exactly
 * that.
 *
 * ── Subset B only ───────────────────────────────────────────────────────────
 *
 * B covers ASCII 32–126: the short order reference (hex), a box number, a
 * coupon code. Subset C would halve the width of a long all-digit run, but
 * nothing this store prints is a long all-digit run, and the subset switch is
 * where hand-rolled encoders go wrong. Characters outside 32–126 throw rather
 * than being silently dropped — a barcode that scans as a different string
 * from the one printed beneath it is worse than no barcode.
 *
 * ── Output ──────────────────────────────────────────────────────────────────
 *
 * `encode()` returns module widths: `[bar, space, bar, space, …]` starting
 * with a bar, with a 10-module quiet zone on each side folded in as leading
 * and trailing spaces. Two renderers consume it: `Barcode` (SVG rects, crisp
 * at any print size) and `gradientStops()` (colour stops for the CSS gradient
 * the receipt and coupon already paint with).
 */

/* Each entry is the six bar/space widths of one symbol, values 0–102, then
   the three special codes 103–105 (Start A/B/C) and 106 (Stop, seven widths). */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;
const QUIET = 10;

/** Subset B value of one character, or -1 if it cannot be encoded. */
function valueOf(ch) {
  const code = ch.charCodeAt(0);
  return code >= 32 && code <= 126 ? code - 32 : -1;
}

/**
 * Encode `text` as Code 128 B.
 *
 * @returns {{ widths: number[], total: number }}  alternating bar/space module
 *   widths (starting with the leading quiet-zone SPACE, so `widths[0]` is a
 *   space of QUIET modules), and the total width in modules.
 */
export function encode(text) {
  const str = String(text ?? '');
  if (!str.length) throw new Error('Nothing to encode');
  const values = [];
  for (const ch of str) {
    const v = valueOf(ch);
    if (v < 0) throw new Error(`Code 128 B cannot encode "${ch}"`);
    values.push(v);
  }

  // Weighted checksum: start value + Σ (value_i × i), mod 103.
  let checksum = START_B;
  values.forEach((v, i) => { checksum += v * (i + 1); });
  checksum %= 103;

  const symbols = [START_B, ...values, checksum, STOP];
  const widths = [QUIET];
  for (const sym of symbols) {
    for (const d of PATTERNS[sym]) widths.push(Number(d));
  }
  widths.push(QUIET);
  const total = widths.reduce((s, w) => s + w, 0);
  return { widths, total };
}

/**
 * The bars as colour stops for a horizontal `linear-gradient`, in percent of
 * the element's width so the barcode scales with its container.
 *
 * `widths[0]` is the leading quiet-zone space, so bars are the odd indexes.
 * Consumers paint with `background-image: linear-gradient(90deg, var(--x))`
 * on a `background-size: 100% 100%; background-repeat: no-repeat` box — the
 * old decorative gradients repeated a tile; a real code must not.
 */
export function gradientStops(text) {
  const { widths, total } = encode(text);
  const stops = [];
  let x = 0;
  widths.forEach((w, i) => {
    const from = (x / total) * 100;
    x += w;
    const to = (x / total) * 100;
    const color = i % 2 === 1 ? 'currentColor' : 'transparent';
    stops.push(`${color} ${from.toFixed(3)}% ${to.toFixed(3)}%`);
  });
  return { stops: stops.join(','), modules: total };
}

/** Can this string be encoded at all? For a control that might disable itself. */
export function encodable(text) {
  const str = String(text ?? '');
  return str.length > 0 && [...str].every((ch) => valueOf(ch) >= 0);
}

export { PATTERNS as CODE128_PATTERNS, QUIET as QUIET_ZONE };
