/**
 * Turn stored settings into the custom-property map the stylesheet consumes.
 *
 * Pure on purpose. `applyTheme` used to compute and write in one pass, which
 * meant the palette could only ever exist on `<html>` — there was no way to
 * render a second mode for a side-by-side preview, and no way to test the
 * derivation without a DOM. Everything here is arithmetic; the only caller
 * that touches the document is `applyThemeVars`.
 */

import {
  parseHex, toHex, rgba, toRgbTriple, mix, composite, isLightGround,
  solveAlphaForContrast, contrastRatio,
} from './color.js';
import {
  DEFAULT_THEME, PALETTE_ROLES, lightKey, SCALAR_BY_KEY,
  FONT_ROSTER, FONT_KEYS, fontGroupFor,
} from './defaults.js';

export const THEME_MODES = ['dark', 'light', 'auto'];

/** `auto` resolved against the visitor's OS preference. */
export function resolveMode(mode) {
  if (mode === 'light' || mode === 'dark') return mode;
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  return 'dark';
}

/**
 * Which mode is actually in force: the visitor's own choice when the store
 * allows one, otherwise the store's setting. Returns an *unresolved* mode —
 * 'auto' comes back as 'auto' so callers that need to know the intent (the
 * pre-paint cache, the "re-resolve when the OS flips" listener) still can.
 *
 * Pure and separate from ThemeContext so the precedence rule is testable;
 * the localStorage read lives with the DOM code, not here.
 */
export function pickMode(storeMode, visitorMode, allowVisitor) {
  if (allowVisitor !== false && THEME_MODES.includes(visitorMode)) return visitorMode;
  return THEME_MODES.includes(storeMode) ? storeMode : DEFAULT_THEME.theme_mode;
}

const isSet = (v) => v !== undefined && v !== null && v !== '';

function scalar(settings, key) {
  const spec = SCALAR_BY_KEY[key];
  const raw = isSet(settings[key]) ? settings[key] : DEFAULT_THEME[key];
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return parseFloat(spec?.default ?? 0);
  if (!spec) return n;
  return Math.max(spec.min, Math.min(spec.max, n));
}

/**
 * Read a palette role for the mode in force.
 *
 * A light key that was never set falls back to its dark twin, so an install
 * from before the palette was split keeps rendering exactly as it did. Only
 * once someone edits the light palette does it diverge.
 */
function role(settings, key, isLightMode) {
  if (isLightMode) {
    const lk = lightKey(key);
    if (isSet(settings[lk]) && parseHex(settings[lk])) return settings[lk];
    if (isSet(DEFAULT_THEME[lk]) && !isSet(settings[key])) return DEFAULT_THEME[lk];
  }
  if (isSet(settings[key]) && parseHex(settings[key])) return settings[key];
  const fallback = isLightMode ? (DEFAULT_THEME[lightKey(key)] ?? DEFAULT_THEME[key]) : DEFAULT_THEME[key];
  return fallback;
}

/**
 * @param {Record<string,string>} settings raw store settings
 * @param {{mode?: string, reduceTransparency?: boolean, increaseContrast?: boolean}} [opts]
 *   `mode` overrides the stored one, for previewing the other palette.
 *   The two flags exist because ThemeContext writes this map as INLINE styles,
 *   which beat every stylesheet selector — so a `@media (prefers-contrast)`
 *   block that redeclares `--glass-bg` on `:root` silently loses the moment
 *   the theme applies. Any condition that must survive theming has to ride
 *   the derivation itself; the CSS blocks in 03-accessibility-overrides.css
 *   remain only as the floor for the frames before this runs.
 */
export function computeThemeVars(settings = {}, opts = {}) {
  const mode = resolveMode(opts.mode ?? settings.theme_mode ?? DEFAULT_THEME.theme_mode);
  const wantLight = mode === 'light';

  const pal = {};
  for (const r of PALETTE_ROLES) pal[r.key] = role(settings, r.key, wantLight);

  const bg = pal.theme_bg;
  const text = pal.theme_text;

  // Keyed off what the background actually looks like, not the mode label. An
  // admin can pick a near-white background while the mode still says "dark",
  // and the stylesheet has to follow the pixels.
  const onLight = isLightGround(bg);

  const vars = {};
  const set = (k, v) => { if (v !== null && v !== undefined && v !== '') vars[k] = String(v); };

  // The tint is "this mode's ink": every border, well and light-mode shadow
  // is cast in it, so deriving it from the text colour keeps a warm palette
  // warm (slate-blue hairlines on warm paper read as a different, colder
  // product). But it must actually BE an ink — mid-retheme a light ground can
  // still carry a near-white text, and tinting with that would erase every
  // border at once, so the neutral slate stands in until the text is dark.
  //
  // Kept as a hex with the channel triple derived from it, rather than the
  // other way round: the degradation branch at the bottom of this function
  // has to composite the ink onto the ground, and `composite` parses hex.
  // Two spellings of the same ink drift apart the moment one is edited.
  const tintHex = onLight
    ? (isLightGround(text) ? '#0f172a' : text)
    : '#ffffff';
  const tintRgb = toRgbTriple(tintHex);

  // Ink at an alpha, clamped and rounded the way `rgba()` in color.js does it.
  // The tokens below used to hand-roll `rgba(${tintRgb},${expr})`, which skips
  // both: a multiplier chain like `0.05 * 2.2` emits
  // `rgba(23,21,15,0.11000000000000001)`, and anything that lands above 1
  // makes the whole declaration invalid, so the property silently keeps its
  // old value — the failure color.js's own comment describes as "reads as the
  // glow slider does nothing".
  const tint = (alpha) => `rgba(${tintRgb},${Number(Math.max(0, Math.min(1, alpha)).toFixed(4))})`;

  // ── Brand and status ────────────────────────────────────────────────────
  set('--primary', pal.theme_primary);
  set('--secondary', pal.theme_secondary);
  set('--accent', pal.theme_accent);
  set('--success', pal.theme_success);
  set('--warning', pal.theme_warning);
  set('--danger', pal.theme_danger);
  set('--info', pal.theme_secondary);
  // The recoloured navbar/age-gate logo. Falls back to the mode's primary,
  // which is the exact pre-key behaviour — the mask used to read `--primary`
  // directly, so a store that never sets this renders pixel-identical.
  set('--logo-color', pal.theme_logo_color || pal.theme_primary);

  // Channel triples for call sites that compose their own alpha in CSS.
  // Without these they fall back to whatever literal the stylesheet floor has,
  // which survives a re-theme and leaves the old brand colour behind.
  for (const [name, hex] of [
    ['primary', pal.theme_primary], ['secondary', pal.theme_secondary],
    ['accent', pal.theme_accent], ['success', pal.theme_success],
    ['warning', pal.theme_warning], ['danger', pal.theme_danger],
  ]) set(`--${name}-rgb`, toRgbTriple(hex));

  // ── Ground and ink ──────────────────────────────────────────────────────
  set('--bg', bg);
  set('--text', text);
  set('--tint-rgb', tintRgb);
  set('--text-rgb', toRgbTriple(text));

  // A scrim laid over imagery, which is the OPPOSITE polarity to `--tint-rgb`.
  // `--tint-rgb` tints a surface (lift a dark one with white, sink a light one
  // with ink); a scrim pushes the image toward the page ground so whatever sits
  // on it reads. Using `--tint-rgb` here would lighten in dark mode and darken
  // in light mode — exactly backwards, and the fixed `rgba(0,0,0,…)` it
  // replaces was the light-mode "black on grey" behind the featured badges.
  set('--scrim-rgb', onLight ? '255,255,255' : '0,0,0');

  // The ramp is solved against the real background instead of using fixed
  // alphas. The old 0.38 (dark) / 0.52 (light) muted steps shipped at 3.18:1
  // and 3.69:1 — both under the 4.5:1 AA floor on a stock install.
  //
  // `theme_text_contrast` lifts both targets together and CANNOT lower them:
  // the scalar's own range floors at 100, and the multiplier is clamped again
  // here rather than trusting that. Two guards for one rule, because this is
  // the number that decides whether the store's quiet text is legible, and the
  // field is exactly the kind an operator drags once and never revisits.
  const rampLift = Math.max(1, scalar(settings, 'theme_text_contrast') / 100);
  const secondaryAlpha = solveAlphaForContrast(text, bg, 7 * rampLift);
  const mutedAlpha = solveAlphaForContrast(text, bg, 4.5 * rampLift);
  set('--text-secondary', rgba(text, secondaryAlpha));
  set('--text-muted', rgba(text, mutedAlpha));

  // ── Glass ───────────────────────────────────────────────────────────────
  const rawOpacity = scalar(settings, 'theme_glass_opacity');
  const blur = scalar(settings, 'theme_glass_blur');
  const saturation = scalar(settings, 'theme_glass_saturation');
  const rim = scalar(settings, 'theme_glass_rim') / 100;

  const glowHex = role(settings, 'theme_glow_color', wantLight) || pal.theme_primary;
  const glow2Hex = role(settings, 'theme_glow_color_2', wantLight) || pal.theme_secondary;

  let surface;
  let surfaceHover;
  let surfaceActive;
  let borderAlpha;
  if (onLight) {
    // Light glass used to be `0.55 + raw * 1.6`, which turned the default into
    // a 61%-opaque white plate — the blur had nothing left to do and the
    // result read as a flat card, not glass. This keeps it genuinely
    // translucent and tints it very slightly toward the glow so it separates
    // from the page instead of disappearing into it.
    const base = Math.max(0.08, Math.min(0.62, 0.14 + rawOpacity * 1.2));
    const plate = mix('#ffffff', glowHex, 0.05);
    surface = rgba(plate, base);
    surfaceHover = rgba(plate, Math.min(base + 0.10, 0.82));
    surfaceActive = rgba(plate, Math.min(base + 0.18, 0.92));
    // The edge follows the plate, exactly as it does on the dark side.
    //
    // This was the literal `0.14` at every slider position, which meant the
    // glass-opacity knob moved the fill and left the border where it was: an
    // operator dialling a heavy, near-opaque light material got a hairline
    // tuned for the thinnest glass, and the flat high-opacity presets — the
    // Material family, Terracotta, Bullion, Newsprint — wore the same edge as
    // a 4%-alpha sheet. Derived from `base` rather than `rawOpacity` because
    // on this side `base` is the plate's real alpha; the floor keeps the
    // thinnest glass from losing its outline, and the ceiling stops a solid
    // light card acquiring a hard black rule.
    borderAlpha = Math.max(0.1, Math.min(base * 0.7, 0.38));
  } else {
    // Hover and active are the RESTING opacity plus a delta, not a multiple
    // capped at an absolute ceiling. The old form was `min(raw * 1.75, 0.16)`,
    // which is fine while raw is small and inverts once it is not: at a glass
    // opacity of 0.2 — well inside the range the slider offers — the hover
    // surface came out at 0.16, so pointing at a card made it MORE transparent
    // than leaving it alone. Every flat, high-opacity look walks straight into
    // that, which is exactly the direction the Material-style presets go.
    //
    // Capping the delta keeps the small end identical to what it always was
    // (at the 0.05 default these still resolve to 0.0875 and 0.1375 exactly)
    // while staying monotonic all the way up.
    surfaceHover = tint(rawOpacity + Math.min(rawOpacity * 0.75, 0.11));
    surfaceActive = tint(rawOpacity + Math.min(rawOpacity * 1.75, 0.19));
    surface = tint(rawOpacity);
    // Floored: the border used to be `raw * 2.5` with no minimum, so pulling
    // opacity to zero erased background AND edge and every card on the store
    // vanished at once.
    borderAlpha = Math.max(0.06, Math.min(rawOpacity * 2.5, 0.35));
  }

  // The operator's edge knob, applied AFTER both mode branches — one line for
  // both, rather than a multiplier inside each, which is how the light arms
  // came to ignore the opacity slider in the first place.
  //
  // The floors below are re-applied rather than skipped: pulling this to zero
  // must soften the room, never erase it. `--glass-border` at nothing means
  // every card on the store loses its outline at once, which is the failure
  // the dark-side floor was added for.
  const edgeStrength = scalar(settings, 'theme_border_strength') / 100;
  borderAlpha = onLight
    ? Math.max(0.05, Math.min(borderAlpha * edgeStrength, 0.55))
    : Math.max(0.035, Math.min(borderAlpha * edgeStrength, 0.5));

  // Written for inspection, not for consumption: no stylesheet reads
  // `--glass-opacity`, and none should — the knob's real effect is already
  // baked into --glass-bg, the --surface ramp and the border alphas below.
  // It stays because it is the one place the raw slider value is legible on
  // the element when debugging a themed store in devtools. Do not build a
  // surface on it; build on the derived tokens.
  set('--glass-opacity', rawOpacity);
  set('--glass-bg', surface);
  set('--surface', surface);
  set('--surface-hover', surfaceHover);
  set('--surface-active', surfaceActive);
  // Reading surfaces are opaque, so photos, effects and page grain cannot
  // compete with product information. They still follow the material slider.
  set('--surface-card', mix(bg, onLight ? '#ffffff' : tintHex, onLight ? 0.5 + rawOpacity : 0.025 + rawOpacity * 0.55));
  set('--surface-media', mix(bg, tintHex, onLight ? 0.025 + rawOpacity * 0.2 : 0.065 + rawOpacity * 0.3));
  set('--shadow-card', onLight
    ? `0 2px 4px rgba(${tintRgb},0.025), 0 8px 24px rgba(${tintRgb},0.045)`
    : '0 2px 4px rgba(0,0,0,0.12), 0 8px 24px rgba(0,0,0,0.16)');
  set('--glass-border', tint(borderAlpha));
  // Both modes now ride `borderAlpha`, so the one knob moves the whole edge
  // family. The light arms used to be the literals 0.13 and 0.24 — frozen for
  // the same reason the light `borderAlpha` was, and with the same result:
  // three of the four edge tokens ignored the slider entirely on a light
  // ground. The multipliers differ per mode because ink on paper reads harder
  // than white on graphite at equal alpha.
  set('--border', tint(onLight
    ? Math.max(0.09, Math.min(borderAlpha * 0.93, 0.32))
    : Math.max(0.06, borderAlpha * 0.7)));
  set('--border-hover', tint(onLight
    ? Math.min(borderAlpha * 1.7, 0.45)
    : Math.min(borderAlpha * 1.8, 0.4)));
  set('--glass-blur', `${blur}px`);
  // Elevation tiers derived from the one knob rather than stored as three.
  // sm sits under chips, dropdowns and sticky toolbars; md is the card
  // standard; lg backs modals and the navbar, where the page behind must
  // dissolve rather than distract. Derivation keeps the slider meaning one
  // thing — "how frosted is this store" — and makes the hierarchy between
  // depths impossible to configure away or invert.
  const blurSm = Math.round(blur * 0.45);
  const blurLg = Math.min(Math.round(blur * 1.5), 80);
  set('--glass-blur-sm', `${blurSm}px`);
  set('--glass-blur-lg', `${blurLg}px`);
  set('--glass-saturate', `${saturation}%`);

  // Shadow tiers are mode-pairs, not one set dimmed: light-mode shadows need
  // to be an order of magnitude softer or a floating panel reads as smudged
  // ink on the white page. `--glass-shadow` predates the tiers and stays as
  // the md alias so older call sites keep rendering identically.
  // Light shadows are cast in the mode's own ink (see tintRgb above), so a
  // warm paper page gets warm shade under its panels, not slate-blue smudge.
  const shadows = onLight
    ? {
      sm: `0 1px 2px rgba(${tintRgb},0.05), 0 3px 8px rgba(${tintRgb},0.05)`,
      md: `0 1px 2px rgba(${tintRgb},0.04), 0 10px 30px rgba(${tintRgb},0.09)`,
      lg: `0 2px 4px rgba(${tintRgb},0.05), 0 16px 44px rgba(${tintRgb},0.12), 0 34px 80px rgba(${tintRgb},0.08)`,
    }
    : {
      sm: '0 1px 2px rgba(0,0,0,0.16), 0 3px 10px rgba(0,0,0,0.10)',
      md: '0 2px 4px rgba(0,0,0,0.16), 0 10px 28px rgba(0,0,0,0.22)',
      lg: '0 4px 8px rgba(0,0,0,0.20), 0 18px 48px rgba(0,0,0,0.30)',
    };
  set('--shadow-sm', shadows.sm);
  set('--shadow-md', shadows.md);
  set('--shadow-lg', shadows.lg);
  set('--glass-shadow', shadows.md);

  // Specular edge. A lit top-left and a shadowed bottom-right is what makes a
  // panel read as a sheet of glass rather than a rectangle with a border.
  //
  // Both alphas go through `rgba()` from color.js rather than a hand-rolled
  // template literal, and that is half the fix: the helper clamps, and its own
  // comment warns that an out-of-range alpha "reads as the glow slider does
  // nothing".
  //
  // The other half is the light ramp. The edge-light knob runs to 200%, so
  // `rim` reaches 2 — and a flat `0.85 * rim` crossed alpha 1.0 at 118%.
  // Everything above that was pinned at opaque white, so the top 41% of the
  // slider did nothing on a light ground, while the dark twin (topping out at
  // 0.48) still had most of its range left.
  //
  // Straightening it into one gentler line would have fixed the dead travel by
  // moving the DEFAULT, which is the more expensive bug: 100% is where every
  // shipped preset sits. So the ramp is linear to 100% — leaving the default
  // at exactly the 0.85 it has always been — and spreads the remaining 0.15 of
  // headroom over the top half of the travel. Nothing below 100% changes at
  // all, and 200% is now distinguishable from 120%, which it was not.
  //
  // The ternary that used to pick between '255,255,255' and '255,255,255' has
  // gone too. Both arms were the same literal, so it read as a deliberate
  // per-mode channel choice — which every neighbouring line genuinely is —
  // and was not one. A specular highlight is white in both modes; what differs
  // is how hard it is driven, which is what these coefficients say.
  const rimLightAlpha = onLight
    ? (rim <= 1 ? 0.85 * rim : 0.85 + (rim - 1) * 0.15)
    : 0.24 * rim;
  // Same as --glass-opacity above: informational. The multiplier is already
  // inside the two alphas that follow, and nothing reads this token. It is
  // load-bearing in exactly one place — the `prefers-contrast` block in
  // 03-accessibility-overrides.css lists `--rim-strength: 0` beside two
  // `transparent` declarations, where it reads like the line doing the work.
  // It is not; the two beside it are. That block says so.
  set('--rim-strength', rim);
  set('--rim-light', rgba('#ffffff', rimLightAlpha));
  set('--rim-dark', rgba('#000000', (onLight ? 0.10 : 0.34) * rim));

  // ── Glow, decoupled from the palette ────────────────────────────────────
  // `--bg-tint` colours the room; `--glow-strength` lights the furniture. They
  // are separate knobs, so a store can have a completely flat background and
  // still glow, or a deeply tinted room with no bloom at all.
  const glowStrength = scalar(settings, 'theme_glow_strength');
  const bgTint = scalar(settings, 'theme_bg_tint') / 100;
  const damp = onLight ? 0.5 : 1;
  const g = (a) => rgba(glowHex, a * damp * glowStrength);

  set('--glow-strength', glowStrength);
  set('--primary-glow', g(0.4));
  set('--secondary-glow', rgba(glow2Hex, 0.3 * damp * glowStrength));
  set('--card-glow', g(0.18));
  set('--focus-ring', rgba(glowHex, Math.min(0.34, 0.28 * Math.max(glowStrength, 0.6))));
  set('--glow-sm', `0 0 12px ${g(0.22)}`);
  set('--glow-md', `0 0 22px ${g(0.3)}`);
  set('--glow-lg', `0 4px 34px ${g(0.38)}`);
  set('--text-glow', glowStrength > 0 ? `0 0 18px ${g(0.35)}` : 'none');

  // The ambient wash follows the background knob, not the glow knob — it is
  // part of the room. At tint 0 the page is exactly the colour that was picked.
  set('--bg-glow-1', rgba(glowHex, 0.16 * bgTint * damp));
  set('--bg-glow-2', rgba(glow2Hex, 0.12 * bgTint * damp));
  set('--bg-wash', mix(bg, glowHex, 0.14 * bgTint));

  // Grain rides the room too. Halved on a light ground: the same speckle that
  // just breaks banding on near-black reads as dirt on near-white.
  const grain = scalar(settings, 'theme_grain') / 100;
  set('--noise-opacity', +(grain * (onLight ? 0.5 : 1)).toFixed(4));

  set('--primary-border', rgba(pal.theme_primary, onLight ? 0.42 : 0.3));
  set('--btn-bg', rgba(pal.theme_primary, onLight ? 0.12 : 0.13));
  set('--btn-hover', rgba(pal.theme_primary, onLight ? 0.2 : 0.24));
  // On a light ground a white button label on a 12%-alpha tint is unreadable;
  // on a dark one it is the only thing that works.
  set('--btn-text', onLight ? text : '#ffffff');

  set('--nav-bg', rgba(bg, onLight ? 0.82 : 0.86));
  set('--overlay-bg', rgba(bg, onLight ? 0.94 : 0.95));
  // Sticky toolbars and dropdown panes: surfaces that float over *scrolling*
  // content. Built from the page ground rather than the tint because arbitrary
  // content passes beneath them — a 5%-alpha tint over a busy product image
  // leaves the toolbar's own text unreadable, which the card tokens never have
  // to survive.
  set('--surface-raised', rgba(bg, onLight ? 0.72 : 0.68));
  // Sunken wells — address blocks, armored keys, QR captions: content pressed
  // *into* the glass rather than floating on it. Dark mode sinks with black;
  // a light ground sinks with a whisper of ink, because a 25% black well on a
  // white page reads as a hole burnt in the paper.
  set('--well', onLight ? tint(0.05) : 'rgba(0,0,0,0.25)');

  // ── Shape ───────────────────────────────────────────────────────────────
  const radius = scalar(settings, 'theme_radius');
  set('--radius', `${radius}px`);
  set('--radius-sm', `${Math.max(2, Math.round(radius * 0.55))}px`);
  set('--radius-lg', `${Math.round(radius * 1.6)}px`);

  // ── Type roles ──────────────────────────────────────────────────────────
  // The stored value is a slug into FONT_ROSTER, never a family string — a
  // stored CSS fragment would be one sanitiser gap away from stylesheet
  // injection, and the server can validate a slug as a plain enum. An unknown
  // slug (a roster face removed in a later release) falls back to the default
  // face rather than emitting nothing and stranding the token on the floor
  // value for one mode but not the other.
  for (const key of FONT_KEYS) {
    const group = fontGroupFor(key);
    const slug = isSet(settings[key]) ? settings[key] : DEFAULT_THEME[key];
    const face = FONT_ROSTER[group][slug] || FONT_ROSTER[group][DEFAULT_THEME[key]];
    set(group === 'ui' ? '--font' : group === 'display' ? '--font-display' : '--font-mono', face.stack);
  }

  // ── Degradation modes, LAST so they win over everything above ──────────
  // reduceTransparency: the visitor asked for it, the engine cannot composite
  // backdrop-filter, or prefers-contrast implies it. Every translucent surface
  // is flattened onto the page ground at the same alpha it would have rendered
  // with — the colour survives, the see-through does not — and every blur tier
  // drops to zero together.
  if (opts.reduceTransparency || opts.increaseContrast) {
    // On a dark ground the plate is white, so compositing it onto the page at
    // the glass alpha lifts the card away from the background exactly as the
    // translucency did. On a light ground the same trick fails completely:
    // the plate was `mix('#ffffff', glowHex, 0.05)` — near-white — composited
    // onto near-white paper, so a card at the shipped Ledger light palette
    // resolved to #f7f6f4 against a #f7f6f2 page. That is 1.001:1. The blur
    // that normally does the separating has just been set to 0 three lines
    // below, so nothing was left holding the card together but the border.
    //
    // Hover and active collapsed with it: rest / +0.10 / +0.18 of nothing is
    // still nothing, and at the top of the opacity slider hover and active
    // resolved to the same hex, so pressing a control changed no pixels.
    //
    // A light surface has to sink, not lift. The plate is the page's own ink
    // at a low alpha, which is the same reasoning `--well` uses ten lines up,
    // and it separates in the one direction a white page leaves available.
    const plate = onLight ? tintHex : '#ffffff';
    const solid = (a) => composite(plate, a, bg);
    // Light alphas are far smaller than the dark ones because ink on paper
    // reads much harder than white on graphite: the ramp below lands the
    // shipped default at about a 4% ink wash, and keeps every step of the
    // opacity slider separable from its neighbours.
    const rest = onLight
      ? Math.max(0.03, Math.min(0.22, 0.02 + rawOpacity * 0.6))
      : rawOpacity;
    const step = onLight ? 0.04 : 0.10;
    set('--glass-bg', solid(rest));
    set('--surface', solid(rest));
    set('--surface-hover', solid(Math.min(rest + step, 0.9)));
    set('--surface-active', solid(Math.min(rest + step * 1.8, 0.95)));
    set('--glass-blur', '0px');
    set('--glass-blur-sm', '0px');
    set('--glass-blur-lg', '0px');
    set('--glass-saturate', '100%');
    set('--noise-opacity', '0');
    // Surfaces that float over *scrolling* content go fully opaque: with the
    // blur gone, an 86%-alpha navbar would let every scrolled line bleed
    // through its text.
    set('--nav-bg', bg);
    set('--overlay-bg', bg);
    set('--surface-raised', bg);
  }
  // increaseContrast: prefers-contrast beyond the palette. Decoration off,
  // every edge explicit, and the text ramp collapses to full ink — a solved
  // 4.5:1 muted step is exactly what this visitor asked to not be given.
  if (opts.increaseContrast) {
    set('--text-secondary', text);
    set('--text-muted', text);
    set('--glass-border', tint(0.6));
    set('--border', tint(0.6));
    set('--border-hover', tint(0.85));
    // A well is a boundary doing a border's job with fill instead of stroke,
    // and it was the one boundary this branch forgot. Left at its resting 5%
    // ink it measured about 1.01:1 on the now-opaque light card — invisible,
    // for the one visitor who explicitly asked for more contrast. It has 31
    // consumers, and several paint it bare with no edge beside it (the order
    // list's `.ordx-rows-head`, the box panels, the store pages), so there was
    // nothing else in those places to see.
    set('--well', tint(onLight ? 0.16 : 0.4));
    set('--glow-strength', 0);
    for (const k of ['--primary-glow', '--secondary-glow', '--card-glow', '--bg-glow-1', '--bg-glow-2']) {
      set(k, 'transparent');
    }
    set('--glow-sm', 'none');
    set('--glow-md', 'none');
    set('--glow-lg', 'none');
    set('--text-glow', 'none');
    set('--rim-strength', 0);
    set('--rim-light', 'transparent');
    set('--rim-dark', 'transparent');
    set('--bg-wash', bg);
    // Focus must get MORE visible here, not ride the zeroed glow strength.
    set('--focus-ring', rgba(pal.theme_primary, 0.8));
  }

  const cardGround = vars['--surface-card'];
  set('--card-text-secondary', opts.increaseContrast ? text : rgba(text, solveAlphaForContrast(text, cardGround, 7 * rampLift)));
  set('--card-text-muted', opts.increaseContrast ? text : rgba(text, solveAlphaForContrast(text, cardGround, 4.5 * rampLift)));

  // CSS resolves var() references where an alias is DECLARED, before it is
  // inherited. Leaving these composites on :root made an embedded light
  // preview inherit the dark page's already-resolved gradient and glass. Each
  // computed palette must own its aliases as well as their constituent tokens.
  set('--bg-gradient', 'linear-gradient(160deg, var(--bg) 0%, var(--bg-wash) 50%, var(--bg) 100%)');
  set('--glass-sm', 'blur(var(--glass-blur-sm)) saturate(var(--glass-saturate))');
  set('--glass-md', 'blur(var(--glass-blur)) saturate(var(--glass-saturate))');
  set('--glass-lg', 'blur(var(--glass-blur-lg)) saturate(var(--glass-saturate))');
  set('--rim-inset', 'inset 1px 1px 0 -0.5px var(--rim-light), inset -1px -1px 0 -0.5px var(--rim-dark)');

  return { vars, dataTheme: onLight ? 'light' : 'dark', mode, bg, text, isLight: onLight };
}

/**
 * Every foreground/background pair an admin can break, graded.
 * Drives the editor's scorecard and the server-side save check.
 */
export function contrastReport(settings, mode, { components = false, ...flags } = {}) {
  const { bg, text, vars } = computeThemeVars(settings, { mode, ...flags });
  const pairs = [
    ['Body text', text],
    ['Primary / links', vars['--primary']],
    ['Secondary', vars['--secondary']],
    ['Accent', vars['--accent']],
    ['Success', vars['--success']],
    ['Warning', vars['--warning']],
    ['Danger', vars['--danger']],
  ];
  // Only when a recoloured logo has its OWN colour for this mode. When it
  // rides primary the row would duplicate "Primary / links", and its Fix
  // button would write an explicit logo colour — silently decoupling the two
  // for an admin who never asked for that.
  const explicitLogo = mode === 'light'
    ? (settings.theme_logo_color_light || settings.theme_logo_color)
    : settings.theme_logo_color;
  if (settings.navbar_logo_dynamic_color === 'true' && explicitLogo) {
    pairs.push(['Logo', vars['--logo-color']]);
  }
  const palette = pairs.map(([label, fg]) => {
    const ratio = contrastRatio(fg, bg);
    return {
      label,
      scope: 'palette', target: 4.5,
      fg,
      bg,
      ratio,
      level: ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'large' : 'fail',
    };
  });
  if (!components) return palette;
  // Composite translucent tokens over the surface they actually sit on.
  // These checks model a flat page backdrop; the preview also lets operators
  // inspect real controls over the chosen material and accessibility conditions.
  const flatten = (color, ground) => {
    if (parseHex(color)) return color;
    const m = String(color).match(/^rgba?\(([^)]+)\)$/);
    if (!m) return ground;
    const n = m[1].split(',').map(Number);
    return composite(toHex({ r: n[0], g: n[1], b: n[2] }), n[3] ?? 1, ground);
  };
  const card = flatten(vars['--surface'], bg);
  const input = flatten(vars['--glass-bg'], card);
  const checks = [
    ['Product surface / body text', text, vars['--surface-card']],
    ['Product surface / muted text', vars['--card-text-muted'], vars['--surface-card']],
    ['Storefront action / text', bg, vars['--primary']],
    ['Storefront action / hover', bg, vars['--accent']],
    ['Card / body text', text, card],
    ['Card / muted text', vars['--text-muted'], card],
    ['Input / text', text, input],
    ['Input / placeholder', vars['--text-muted'], input],
    ['Primary button / text', vars['--btn-text'], flatten(vars['--btn-bg'], card)],
    ['Primary button / hover', vars['--btn-text'], flatten(vars['--btn-hover'], card)],
    ['Input / focus indicator', vars['--primary'], flatten(vars['--surface-hover'], card), 3],
    ...['success', 'warning', 'danger'].map(name => [`${name} badge / text`, vars[`--${name}`], composite(vars[`--${name}`], 0.12, card)]),
  ];
  return [...palette, ...checks.map(([label, raw, ground, target = 4.5]) => {
    const fg = flatten(raw, ground), ratio = contrastRatio(fg, ground);
    return { label, fg, bg: ground, ratio, target, scope: 'component', level: ratio >= target ? 'AA' : 'fail' };
  })];
}
