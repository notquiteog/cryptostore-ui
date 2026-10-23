/**
 * The default theme, and the registry of every field the editor can write.
 *
 * This module is the ONLY place default colours are declared. The seed no
 * longer inserts theme colour rows at all: the database stores overrides, not
 * defaults. That is what stops the drift the old arrangement had, where the
 * seed shipped indigo (`#6c63ff`), ThemeContext shipped cyan, and the admin
 * editor shipped a third copy of cyan — three sources that could disagree, and
 * did.
 *
 * ── Per-mode palette ──────────────────────────────────────────────────────
 * Every core colour now has a light-mode twin under the same name plus
 * `_light`. A key with an empty light twin falls back to the dark value, which
 * is exactly the old behaviour, so an install that predates this file keeps
 * looking the way it did until someone edits the light palette.
 */

/** Core colours that exist once per mode. `key` is the dark/base key. */
export const PALETTE_ROLES = [
  { key: 'theme_primary', group: 'brand', label: 'Primary', hint: 'Buttons, links, focus' },
  { key: 'theme_secondary', group: 'brand', label: 'Secondary', hint: 'Supporting accent, info' },
  { key: 'theme_accent', group: 'brand', label: 'Accent', hint: 'Active nav, hover, highlights' },
  { key: 'theme_bg', group: 'ground', label: 'Background', hint: 'The page itself' },
  { key: 'theme_text', group: 'ground', label: 'Text', hint: 'Primary reading colour' },
  { key: 'theme_success', group: 'status', label: 'Success', hint: 'In stock, delivered, paid' },
  { key: 'theme_warning', group: 'status', label: 'Warning', hint: 'Pending, low stock' },
  { key: 'theme_danger', group: 'status', label: 'Danger', hint: 'Errors, out of stock' },
  { key: 'theme_glow_color', group: 'glow', label: 'Glow', hint: 'Ambient bloom and card glow' },
  { key: 'theme_glow_color_2', group: 'glow', label: 'Second glow', hint: 'The other half of the ambient wash' },
  // Not rendered with the palette groups: the editor shows this inside the
  // navbar section, gated on the recolor toggle, because it is meaningless
  // until a logo is being recoloured. It is still a palette role so it gets
  // the per-mode twin, the dark-fallback and the save/validate path for free.
  { key: 'theme_logo_color', group: 'navbar', label: 'Logo color', hint: 'Empty follows Primary' },
];

/** The light-mode twin of a base key. */
export const lightKey = (key) => `${key}_light`;

/** Every colour key, both modes, in editor order. */
export const COLOR_KEYS = PALETTE_ROLES.flatMap((r) => [r.key, lightKey(r.key)]);

/**
 * Scalars. These are mode-independent: a rounder corner or a stronger glow is
 * a property of the brand, not of the time of day. Anything that genuinely has
 * to differ per mode is damped inside `computeThemeVars` instead.
 */
export const SCALAR_FIELDS = [
  {
    key: 'theme_glow_strength', group: 'glow', label: 'Glow strength', unit: '×',
    min: 0, max: 2.5, step: 0.05, default: '0.35',
    hint: 'Scales every glow in the store at once. 0 is completely flat.',
  },
  {
    key: 'theme_bg_tint', group: 'glow', label: 'Background tint', unit: '%',
    min: 0, max: 100, step: 1, default: '10',
    hint: 'How much of the glow colour bleeds into the page itself. At 0 the background is exactly the colour you picked and nothing else.',
  },
  {
    key: 'theme_grain', group: 'glow', label: 'Grain', unit: '%',
    min: 0, max: 20, step: 1, default: '2',
    hint: 'Subtle texture over the page. A low value keeps surfaces clean; 0 removes it entirely.',
  },
  {
    key: 'theme_glass_opacity', group: 'glass', label: 'Glass opacity', unit: '',
    min: 0.01, max: 0.3, step: 0.005, default: '0.05',
    hint: 'Translucency of cards, inputs and panels',
  },
  {
    key: 'theme_glass_blur', group: 'glass', label: 'Glass blur', unit: 'px',
    min: 0, max: 60, step: 1, default: '22',
    hint: 'Backdrop blur strength',
  },
  {
    key: 'theme_glass_saturation', group: 'glass', label: 'Backdrop vividness', unit: '%',
    min: 100, max: 220, step: 5, default: '160',
    hint: 'Colour behind a panel blooms through it. This is what separates glass from frosted plastic.',
  },
  {
    key: 'theme_glass_rim', group: 'glass', label: 'Edge light', unit: '%',
    min: 0, max: 200, step: 5, default: '100',
    hint: 'A lit top-left edge and a shadowed bottom-right one, so panels read as sheets of glass rather than outlined boxes.',
  },
  {
    /*
     * The edge family, as one knob.
     *
     * Every border token in the store — `--glass-border`, `--border`,
     * `--border-hover` and the light-mode arms of all three — is derived from
     * one alpha inside computeThemeVars, and until now that alpha's only input
     * was the glass-opacity slider. So an operator who wanted crisper edges had
     * to make their panels more opaque to get them, and an operator who wanted
     * a nearly frameless room had to make the panels vanish. Two different
     * decisions sharing one control is how a preset ends up being the only way
     * to reach a look: the built-ins vary the edge freely because they write
     * the derived result, and the editor could not.
     *
     * A multiplier rather than a colour, because the edge is not a colour: it
     * is the theme's own tint at some strength, and `--tint-rgb` flips polarity
     * between modes so the same alpha lifts a dark surface and cuts into a
     * light one. Handing an operator a raw border colour would break exactly
     * that, and it is the property that makes glass read as glass.
     */
    key: 'theme_border_strength', group: 'glass', label: 'Edge strength', unit: '%',
    min: 0, max: 200, step: 5, default: '100',
    hint: 'How hard every border in the store is drawn. 100% is the edge your glass opacity implies; below that the room goes frameless, above it every panel gets a defined outline. The floor that keeps cards from vanishing entirely still applies.',
  },
  {
    /*
     * The text ramp is SOLVED, not picked: `--text-secondary` and
     * `--text-muted` are alphas found by binary search against the operator's
     * real background, targeting 7:1 and 4.5:1. That fixed the old shipped
     * ramp, which sat at 3.18:1 and failed AA on a stock install.
     *
     * What it left is a hierarchy nobody can adjust. Twelve fields at three
     * weights is a record and twelve at one is noise (DESIGN §7), and how far
     * apart those three steps sit is a real design decision — on a dense
     * operator console the muted step often wants to be further from the body
     * text than the AA floor puts it.
     *
     * It only goes UP. 100% is the AA floor and the minimum, because a knob
     * that could lower it would be a knob that ships an inaccessible store —
     * and this is exactly the class of setting an operator turns down once and
     * never revisits. The accessibility overrides in
     * 03-accessibility-overrides.css still win over whatever is set here.
     */
    key: 'theme_text_contrast', group: 'glass', label: 'Text separation', unit: '%',
    min: 100, max: 170, step: 5, default: '100',
    hint: 'How far secondary and muted text sit from your body text. 100% is the WCAG AA floor and is as low as this goes; raising it pushes the quieter two steps further apart, which reads denser on a screen full of fields.',
  },
  {
    key: 'theme_radius', group: 'shape', label: 'Roundness', unit: 'px',
    min: 0, max: 26, step: 1, default: '14',
    hint: 'Drives every corner in the store, from razor-sharp to fully soft.',
  },
];

export const SCALAR_BY_KEY = Object.fromEntries(SCALAR_FIELDS.map((f) => [f.key, f]));

/**
 * ── Fonts ─────────────────────────────────────────────────────────────────
 * Every face here is vendored in client/public/fonts (OFL-licensed, subset,
 * variable where the family ships one) and declared in
 * styles/core/00-self-hosted-fonts.css. Browsers only download a declared
 * face when something renders with it, so carrying the whole roster costs a
 * fresh visitor exactly three files — the three the store has selected.
 *
 * The slug, not the family name, is what gets stored: family names contain
 * spaces and quotes, and a stored CSS fragment is one sanitiser bug away from
 * being a stylesheet injection. The server validates against these slugs as an
 * enum (see server/config/themeKeys.js, kept in step by hand).
 */
export const FONT_ROSTER = {
  ui: {
    hanken: { label: 'Hanken Grotesk', stack: "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
    inter: { label: 'Inter', stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
    geist: { label: 'Geist', stack: "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
    instrument: { label: 'Instrument Sans', stack: "'Instrument Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  },
  display: {
    archivo: { label: 'Archivo', stack: "'Archivo', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif" },
    'space-grotesk': { label: 'Space Grotesk', stack: "'Space Grotesk', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif" },
    schibsted: { label: 'Schibsted Grotesk', stack: "'Schibsted Grotesk', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif" },
  },
  mono: {
    plex: { label: 'IBM Plex Mono', stack: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace" },
    jetbrains: { label: 'JetBrains Mono', stack: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace" },
    'geist-mono': { label: 'Geist Mono', stack: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace" },
  },
};

export const FONT_KEYS = ['theme_font_ui', 'theme_font_display', 'theme_font_mono'];

/** The roster group a font key selects from. */
export const fontGroupFor = (key) => (
  key === 'theme_font_ui' ? 'ui' : key === 'theme_font_display' ? 'display' : 'mono'
);

/**
 * ── The default palettes ──────────────────────────────────────────────────
 *
 * Both modes were solved against WCAG rather than picked by eye. Every colour
 * below clears 4.5:1 as text on its own ground — the old defaults did not: the
 * brand cyan sat at 1.69:1 on the light background, which made every link,
 * primary badge and active nav item near-invisible the moment a store switched
 * to light mode.
 *
 * The palette also has an actual hue relationship now. The old one was three
 * shades of the same cyan, so `--accent` was indistinguishable from
 * `--primary`. This one runs cyan → violet → mint, which gives the rim light
 * and the two ambient washes something to disperse between.
 */
/*
 * "Ledger" (2026-08-26, operator-chosen from three rendered candidates): warm
 * graphite and paper grounds, electric indigo as the one signal hue, brass
 * warning, steel secondary. Neutral rooms, colour only where it means
 * something. Every value was solved with adjustForContrast at a 4.7:1 target
 * (margin over the 4.5 AA floor) against its own ground — the ratios below are
 * measured, not aspirational.
 */
const DARK = {
  theme_bg: '#111113',      // warm neutral graphite; off pure black so gradients have somewhere to go
  theme_text: '#ecebe7',    // warm paper-white, 15.81:1
  theme_primary: '#7e8dff',   //  6.41:1 — electric indigo, the signal
  theme_secondary: '#8fa8bf', //  7.65:1 — quiet steel; also drives info
  theme_accent: '#a5b0ff',    //  9.21:1 — lighter indigo for active/hover emphasis
  theme_success: '#4fce8f',   //  9.48:1
  theme_warning: '#e0a84e',   //  8.87:1 — brass, not alarm-yellow
  theme_danger: '#ff7368',    //  7.10:1
};

const LIGHT = {
  theme_bg_light: '#f7f6f2',        // warm paper, not clinical white
  theme_text_light: '#17150f',      // warm ink, 16.88:1
  theme_primary_light: '#4453d6',   // 5.62:1
  theme_secondary_light: '#48657d', // 5.66:1
  theme_accent_light: '#2e3cb8',    // 7.91:1 — darker than primary, so it still reads as emphasis
  theme_success_light: '#1c7a4e',   // 4.92:1
  theme_warning_light: '#7d5a10',   // 5.81:1
  theme_danger_light: '#bc3038',    // 5.37:1
};

export const DEFAULT_THEME = {
  store_name: 'CryptoStore',
  store_tagline: 'Your Trusted Marketplace',

  theme_mode: 'dark',
  // Visitors may pick their own mode unless the operator turns this off. A
  // string like every other stored setting; only the literal 'false' locks
  // the store, so an install that predates the key keeps the toggle.
  theme_allow_visitor_mode: 'true',

  ...DARK,
  ...LIGHT,

  // Ambient glow defaults to the brand colours. Setting either of these makes
  // the bloom independent of the palette, which is the point: a store can run
  // a cyan brand over a violet room.
  theme_glow_color: '#7e8dff',
  theme_glow_color_light: '#4453d6',
  theme_glow_color_2: '#8fa8bf',
  theme_glow_color_2_light: '#48657d',

  // Empty means "ride the mode's primary" — the behaviour every store had
  // before this key existed. A hex here decouples the recoloured logo from the
  // brand colour without changing anyone's install until they set it.
  theme_logo_color: '',
  theme_logo_color_light: '',

  ...Object.fromEntries(SCALAR_FIELDS.map((f) => [f.key, f.default])),

  theme_font_ui: 'hanken',
  theme_font_display: 'archivo',
  theme_font_mono: 'plex',

  // Custom presets, stored as JSON. Empty = none saved yet.
  theme_presets: '',

  pwa_theme_color: '#111113',

  /*
   * ── Which ENGINE each scope runs ──
   *
   * Background and header each pick one family, never both. Two full-screen
   * canvases and a fragment shader compositing over each other is a cost with
   * no readable result, and an interface that lets you switch both on is an
   * interface that invites it.
   *
   * The selector is a VIEW over two independent sets of settings rather than
   * a destructive switch: flipping to `webgl2` does not clear the canvas
   * toggles, and flipping back restores exactly what was running before. An
   * operator trying the two against each other should not lose their canvas
   * setup to a click.
   *
   * The two scopes are independent of each other on purpose — a shader
   * background under a canvas constellation header is a perfectly good store,
   * and the header is a 60px strip whose cost has nothing to do with the
   * viewport-sized field behind it.
   *
   * `canvas` is the default because it is what every store had before the
   * shaders existed, and because it is the family that runs everywhere: a
   * browser with no WebGL2 renders no shader at all.
   */
  effects_bg_engine: 'canvas',
  effects_header_engine: 'canvas',

  // ── Background effects: the whole viewport, behind every page ──
  effects_sparkles: 'false',
  effects_smoke: 'false',
  effects_snow: 'false',
  effects_aurora: 'false',
  /*
   * The WebGL2 background.
   *
   * One toggle and one name rather than a toggle per shader, because unlike
   * the canvas effects these are mutually exclusive in practice: two
   * full-screen fragment shaders compositing over each other is twice the
   * per-pixel cost for a result nobody can read. The canvas effects stack
   * because a snowflake and a smoke cloud are sparse; a shader fills every
   * pixel by definition.
   *
   * `custom` means the operator wrote their own, and `effects_shader_source`
   * holds it. Empty by default — the box shows a starter shader instead, so
   * nobody is asked to write GLSL against a blank page.
   */
  effects_shader: 'false',
  effects_shader_name: 'aurora-veil',
  effects_shader_source: '',

  // ── Header effects: the navbar strip only ──
  //
  // Scoped to one element rather than the room. `effects_header` is the
  // constellation, which rests at nothing and answers the pointer — see
  // components/effects/HeaderField.jsx for why anything living in the one
  // element visible on every page must not animate on its own.
  effects_header: 'false',
  effects_header_shader: 'false',
  effects_header_shader_name: 'ribbon',
  effects_header_shader_source: '',

  theme_sparkle_color: '#a5b0ff',
  theme_smoke_color: '#8fa8bf',
  // Each effect's colour defaults to the Ledger voice that suits its physics:
  // paper snow, green aurora, indigo light. All are live even while the toggle
  // is off, so switching one on lands on-palette.
  theme_snow_color: '#ecebe7',
  theme_aurora_color: '#4fce8f',
  theme_header_color: '#7e8dff',
  /*
   * Each WebGL2 slot gets a PAIR, and the second one is not a luxury.
   *
   * Every built-in field mixes `uColor` and `uColor2` across its own gradient,
   * so a slot with one editable colour has half of every pixel decided by
   * something the operator cannot see from that card. `uColor2` used to ride
   * `theme_glow_color_2` — a palette key three sections away, set for an
   * entirely different reason — which made the shader's own colour control
   * look like it barely did anything. Two knobs on the card, both belonging to
   * the effect, is the honest arrangement.
   */
  theme_shader_color: '#7e8dff',
  theme_shader_color_2: '#8fa8bf',
  theme_header_shader_color: '#8fa8bf',
  theme_header_shader_color_2: '#7e8dff',

  navbar_logo_size: 'standard',
  navbar_logo_dynamic_color: 'false',
  navbar_show_store_name: 'false',

  age_gate_enabled: 'false',
  allow_guest_browsing: 'false',
};

/**
 * Every value that was ever a shipped default, keyed for the migrations that
 * move untouched installs onto the current palette (theme_palette_v2 handled
 * the indigo/cyan generations; theme_palette_v3_ledger handles the 2026-08
 * cyan-on-blue-black one). Anything an admin actually customised is left
 * alone. Order within each list is oldest first.
 */
export const LEGACY_DEFAULTS = {
  theme_primary: ['#22d3ee', '#6c63ff', '#2dd4e8'],
  theme_secondary: ['#38bdf8', '#8b7cff'],
  theme_accent: ['#67e8f9', '#7c4dff', '#7df0dc'],
  theme_bg: ['#04060d', '#0a0a1a', '#080b14'],
  theme_text: ['#eef0ff', '#ffffff', '#e8ecf8'],
  theme_bg_light: ['#f5f7fc', '#f5f7fb'],
  theme_text_light: ['#0c1222', '#0c1220'],
  theme_primary_light: ['#0c7281'],
  theme_secondary_light: ['#604fd9'],
  theme_accent_light: ['#08505e'],
  theme_success: ['#10d98a', '#00e676', '#34e39b'],
  theme_warning: ['#f59e0b', '#ffab40', '#ffb84d'],
  theme_danger: ['#f43f5e', '#ff5252', '#ff6b81'],
  theme_success_light: ['#107652'],
  theme_warning_light: ['#8a5c14'],
  theme_danger_light: ['#bf3149'],
  theme_glow_color: ['#2dd4e8'],
  theme_glow_color_light: ['#0c7281'],
  theme_glow_color_2: ['#8b7cff'],
  theme_glow_color_2_light: ['#604fd9'],
  theme_glass_opacity: ['0.04'],
  theme_glass_blur: ['20'],
  theme_bg_tint: ['18'],
  theme_grain: ['6'],
  pwa_theme_color: ['#04060d', '#080b14'],
  theme_sparkle_color: ['#22d3ee', '#2dd4e8'],
  theme_smoke_color: ['#22d3ee', '#8b7cff'],
};

/** Keys the editor owns. Everything here is sent on save. */
export const EDITABLE_KEYS = [
  'theme_mode',
  'theme_allow_visitor_mode',
  ...COLOR_KEYS,
  ...SCALAR_FIELDS.map((f) => f.key),
  ...FONT_KEYS,
  // The custom-presets blob (JSON). Rides the same save so "tweak, save as
  // preset, Save" is one persistence path, not two that can disagree.
  'theme_presets',
  'pwa_theme_color',
  'effects_bg_engine', 'effects_header_engine',
  'effects_sparkles', 'effects_smoke',
  'effects_snow', 'effects_aurora', 'effects_header',
  'effects_shader', 'effects_shader_name', 'effects_shader_source',
  'effects_header_shader', 'effects_header_shader_name', 'effects_header_shader_source',
  'theme_sparkle_color', 'theme_smoke_color',
  'theme_snow_color', 'theme_aurora_color',
  'theme_header_color',
  'theme_shader_color', 'theme_shader_color_2',
  'theme_header_shader_color', 'theme_header_shader_color_2',
  'navbar_logo_size', 'navbar_logo_dynamic_color', 'navbar_show_store_name',
];
