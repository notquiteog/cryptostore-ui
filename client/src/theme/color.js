/**
 * Colour maths for the theme system.
 *
 * One home for what used to be three copies of `hexToRgb` (ThemeContext,
 * SparklesEffect, SmokeEffect) and two copies of a `luminance()` that was not
 * measuring luminance at all — it used ITU-R BT.601 *perceived brightness* on
 * gamma-encoded sRGB, which is not a contrast metric and cannot be compared
 * against WCAG's thresholds. Everything here uses WCAG relative luminance.
 */

/** @param {string} hex @returns {{r:number,g:number,b:number}|null} */
export function parseHex(hex) {
  if (typeof hex !== 'string') return null;
  let clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) clean = clean.split('').map((c) => c + c).join('');
  if (clean.length === 8) clean = clean.slice(0, 6);
  if (!/^[0-9a-f]{6}$/i.test(clean)) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/** True when `value` is a colour this module can actually work with. */
export function isValidHex(value) {
  return parseHex(value) !== null;
}

/**
 * True when `value` is a colour the SERVER will also accept.
 *
 * Deliberately stricter than `isValidHex`. `parseHex` tolerates an 8-digit
 * hex by dropping the alpha pair, which is the right call for RENDERING —
 * whatever is already stored should still paint. It is the wrong call for an
 * input gate: `#7e8dffcc` is the standard copy format out of most design
 * tools, it drew a correct swatch with no error state, and then
 * `server/config/themeKeys.js` (which accepts only 3- and 6-digit) rejected
 * it — and `updateSettings` rejects the WHOLE request on one bad key, so
 * every other unsaved change in that save went with it.
 *
 * Keep this in step with HEX6_RE / HEX3_RE on the server.
 */
export function isStorableHex(value) {
  return typeof value === 'string' && /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.test(value.trim());
}

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

export function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('');
}

/** `"34,211,238"` — for call sites that compose their own alpha in CSS. */
export function toRgbTriple(hex) {
  const c = parseHex(hex);
  return c ? `${c.r},${c.g},${c.b}` : null;
}

export function rgba(hex, alpha) {
  const c = parseHex(hex);
  if (!c) return null;
  // Alphas here are composed from admin-driven multipliers. An alpha above 1
  // makes the whole declaration invalid and the property silently keeps its
  // previous value, which reads as "the glow slider does nothing".
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${c.r},${c.g},${c.b},${Number(a.toFixed(4))})`;
}

const channel = (v) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex) {
  const c = parseHex(hex);
  if (!c) return 0;
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG contrast ratio between two opaque colours, 1:1 to 21:1. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at `alpha` over an opaque `bg`, returning an opaque hex. */
export function composite(fg, alpha, bg) {
  const f = parseHex(fg);
  const b = parseHex(bg);
  if (!f || !b) return bg;
  const a = Math.max(0, Math.min(1, alpha));
  return toHex({
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a),
  });
}

/** Linear blend between two hexes, `t` from 0 (all `a`) to 1 (all `b`). */
export function mix(a, b, t) {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return a;
  const k = Math.max(0, Math.min(1, t));
  return toHex({
    r: x.r + (y.r - x.r) * k,
    g: x.g + (y.g - x.g) * k,
    b: x.b + (y.b - x.b) * k,
  });
}

/**
 * Is this background light enough that dark ink beats light ink on it?
 *
 * This replaces a `luminance(bg) > 140` cutoff on the BT.601 scale, which put
 * the boundary in the wrong place: `#808080` scored 128 and was therefore
 * treated as dark, so surfaces kept tinting with white and a 4% white wash on
 * mid-grey made every card on the store invisible. Asking which ink actually
 * wins has no arbitrary cliff — it is the same question the UI needs answered.
 */
export function isLightGround(bg) {
  return contrastRatio(bg, '#000000') > contrastRatio(bg, '#ffffff');
}

/** Whichever of black/white reads better on `bg`. */
export function bestInkOn(bg) {
  return isLightGround(bg) ? '#000000' : '#ffffff';
}

/**
 * The lowest alpha of `fg` over `bg` that still meets `target` contrast.
 *
 * Used to build the secondary/muted text ramp. The old ramp hard-coded 0.65 and
 * 0.38 (dark) / 0.72 and 0.52 (light) with no reference to the background at
 * all, so `--text-muted` shipped at 3.18:1 in dark and 3.69:1 in light — both
 * below the 4.5:1 AA floor, on every install, before an admin touched anything.
 *
 * Returns 1 when even full opacity cannot reach the target, which is the
 * caller's signal that the palette itself is the problem.
 */
export function solveAlphaForContrast(fg, bg, target) {
  if (!parseHex(fg) || !parseHex(bg)) return 1;
  if (contrastRatio(fg, bg) < target) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(composite(fg, mid, bg), bg) >= target) hi = mid;
    else lo = mid;
  }
  // Quantized UP to the 4 decimals rgba() actually writes. The search's
  // answer is exact at full float precision, but rgba() rounds to 4 places
  // and rounding DOWN can step the written alpha back under the target —
  // the Ledger dark ground shipped its muted step at 4.469:1 that way. More
  // alpha only ever means more contrast on an opaque ground, so ceiling is
  // always the safe direction.
  return Math.min(1, Math.ceil(hi * 10000) / 10000);
}

/** WCAG AA/AAA grade for a foreground/background pair at normal text size. */
export function grade(fg, bg) {
  const r = contrastRatio(fg, bg);
  if (r >= 7) return { ratio: r, level: 'AAA' };
  if (r >= 4.5) return { ratio: r, level: 'AA' };
  if (r >= 3) return { ratio: r, level: 'AA-large' };
  return { ratio: r, level: 'fail' };
}

/**
 * Nudge `color` toward black or white until it clears `target` against `bg`.
 *
 * Powers the editor's one-click "fix this pair" affordance. Hue and the ratio
 * between channels are preserved, so the result still reads as the colour the
 * admin picked rather than a different one.
 */
export function adjustForContrast(color, bg, target = 4.5) {
  if (!parseHex(color) || !parseHex(bg)) return color;
  if (contrastRatio(color, bg) >= target) return color;
  const toward = isLightGround(bg) ? '#000000' : '#ffffff';
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mix(color, toward, mid), bg) >= target) hi = mid;
    else lo = mid;
  }
  return mix(color, toward, hi);
}
