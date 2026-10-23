/**
 * Theme presets: complete looks an admin can apply to one mode or both.
 *
 * A preset may carry everything that makes a look: the PER-MODE colour keys
 * (brand, page, status, glow), the room scalars (tint, grain), the glass
 * material and shape, the ambient effects, and the font trio. Every BUILT-IN
 * declares all of it — a built-in is an art direction, and an art direction
 * with holes in it inherits whatever the last theme left behind, which is how
 * "apply Porcelain" once kept the previous look's smoke drifting through a
 * ceramic room. Custom presets carry only what they were captured with, and
 * a preset that doesn't declare a key never touches it.
 *
 * Applying to a single mode takes only that mode's half of the colour keys.
 * Everything mode-independent — fonts, room, material, effects (defaults.js
 * explains why they don't split by mode) — travels only with 'both': a store
 * cannot end up with a serif dark mode and a grotesk light mode, or capsule
 * corners at night and razor corners by day. That is a bug report, not a
 * feature. The preset card discloses material and effects with chips, so
 * what Both will do is a choice, never a side effect.
 *
 * The built-ins are the three candidate directions rendered for the operator
 * on 2026-08-26 (Ledger won and became the shipped default), the platform
 * interpretations that followed, the pre-Ledger cyan palette — kept so nobody
 * needs a database restore to get last month's look back — and the four looks
 * added on 2026-08-27 to break a roster that had quietly become one idea
 * rendered eight ways.
 *
 * That collapse is worth naming, because it happened by accretion rather than
 * by decision. Each preset was added on its own and each was defensible, and
 * the result was eight near-black neutral grounds each carrying exactly one
 * bright saturated signal: the picker offered a choice of accent colour
 * dressed up as a choice of room. Tidewater, Terracotta, Amethyst and Bullion
 * vary what was fixed — the ground carries colour, two or three hues do the
 * work instead of one, and between them they span the whole material range
 * from no frost at all to the heaviest glass on the board. Porcelain was
 * re-cut onto a warm clay body at the same time, for the same reason.
 *
 * There is a test that fails if that spread collapses again, and another that
 * grades every preset's palette. Every colour here was solved against WCAG at
 * 4.7:1 on its own ground, in both modes, with the utils in theme/color.js;
 * do not "tune" them here by eye.
 *
 * ── Fifty, and what that changed (2026-08-29) ─────────────────────────────
 *
 * The roster went from twenty-two to fifty. Two things follow from that size
 * and neither is optional:
 *
 * - **Every preset carries a `family`.** At fifty, a flat grid of swatch cards
 *   is not a choice an operator can make — it is three screens of scrolling in
 *   an order nobody can hold in their head. The gallery groups and filters on
 *   the family (see components/admin/PresetGallery.jsx), and the family lives
 *   beside `label`, never inside `settings`: it is metadata about the preset,
 *   not part of the look, and a settings key would ride `presetPatch` into the
 *   theme and be refused by the server's allowlist on the way to the database.
 * - **Every preset states what it is FOR.** The description is the product,
 *   not the swatch row. "Aubergine with orchid" is a colour scheme; "the
 *   heaviest glass here, for a store whose panels are the subject" is a
 *   decision somebody can agree or disagree with. A look with no answer to
 *   "who would run this" is the roster collapsing again in a new direction.
 *
 * The other half of the expansion lives in components/effects/shaders.js: the
 * shader rosters grew from five and three to twenty and ten, largely because
 * these looks needed fields that did not exist. A preset that names a field is
 * the only way most operators will ever meet one.
 */

/** The dark-side colour keys of a preset (base palette + glow pair). */
export const PRESET_DARK_KEYS = [
  'theme_bg', 'theme_text', 'theme_primary', 'theme_secondary', 'theme_accent',
  'theme_success', 'theme_warning', 'theme_danger',
  'theme_glow_color', 'theme_glow_color_2',
];

/** The light twins, in the same order. */
export const PRESET_LIGHT_KEYS = PRESET_DARK_KEYS.map((k) => `${k}_light`);

/** Mode-independent keys a preset carries; applied only with scope 'both'. */
export const PRESET_SHARED_KEYS = [
  'theme_bg_tint', 'theme_grain',
  'theme_font_ui', 'theme_font_display', 'theme_font_mono',
];

/**
 * Material keys — the glass physics. Originally presets could NOT carry
 * these ("applying a palette must not reshape the panels the operator
 * dialled in"), and for palettes that is still the behaviour: a preset that
 * doesn't declare them doesn't touch them. The rule was deliberately widened
 * when the Liquid Glass preset arrived, because that look IS its material —
 * heavy refraction, strong specular rim, capsule corners — and a "Liquid
 * Glass" that only changed colours would be the palette wearing a name it
 * cannot honour. The same logic then reached every built-in: Material without
 * its flat tonal surfaces, or Phosphor without its bare tube glass, is the
 * palette wearing the wrong body. Material still travels only with 'both',
 * and the preset card discloses it with a chip, so it is a choice, never a
 * side effect.
 */
export const PRESET_MATERIAL_KEYS = [
  'theme_glass_opacity', 'theme_glass_blur', 'theme_glass_saturation',
  'theme_glass_rim', 'theme_radius', 'theme_glow_strength',
  // The edge multiplier and the text-ramp lift. They belong with the material
  // rather than the palette for the same reason the rim does: they describe
  // how the surface is DRAWN, not what colour it is, so they travel only with
  // 'both' and a palette-only preset never touches them.
  'theme_border_strength', 'theme_text_contrast',
];

/**
 * Ambient-effect keys — the air in the room. A preset carries the on/off
 * state, not just the colours, and carries it in BOTH directions: Golden
 * Gate declares its fog on, and Ledger declares still air, because a look
 * that only ever switched effects on could never be applied over a smoky
 * store without inheriting the smoke. The colours are pre-tuned even where
 * the toggle is off, so an operator who enables an effect later lands on
 * that look's palette instead of a leftover. Effects travel only with
 * 'both' — starting a full-screen canvas is a whole-store decision, not a
 * per-mode one — and the card wears a chip for each effect a preset starts.
 */
export const PRESET_EFFECT_KEYS = [
  // Which engine each scope runs is part of the look, not a machine
  // preference: a preset that starts a shader has to be able to say so, or
  // applying it would switch the field on in a store whose selector still
  // said `canvas` and nothing would appear.
  'effects_bg_engine', 'effects_header_engine',
  'effects_sparkles', 'effects_smoke',
  'effects_snow', 'effects_aurora', 'effects_header',
  // The two WebGL2 slots carry their toggle and their CHOICE, never their
  // source. A preset is an art direction, and "which of the built-in fields
  // suits this room" is part of that; a blob of operator-written GLSL is
  // their work, and shipping it inside a look would mean applying a preset
  // could overwrite a shader somebody spent an evening on.
  'effects_shader', 'effects_shader_name',
  'effects_header_shader', 'effects_header_shader_name',
  'theme_sparkle_color', 'theme_smoke_color',
  'theme_snow_color', 'theme_aurora_color',
  'theme_header_color',
  'theme_shader_color', 'theme_shader_color_2',
  'theme_header_shader_color', 'theme_header_shader_color_2',
];

export const PRESET_KEYS = [
  ...PRESET_DARK_KEYS, ...PRESET_LIGHT_KEYS, ...PRESET_SHARED_KEYS,
  ...PRESET_MATERIAL_KEYS, ...PRESET_EFFECT_KEYS,
];

/** True when a preset reshapes the material itself, not only the colours. */
export const presetHasMaterial = (p) =>
  PRESET_MATERIAL_KEYS.some((k) => p?.settings?.[k] !== undefined);

/**
 * What that material actually is, in one word for the card's chip.
 *
 * The chip said "glass material" on every preset that carried these keys,
 * which was true about the KEYS and false about three of the looks: Material,
 * Terracotta and Bullion set the blur to zero precisely so their surfaces are
 * NOT glass, and labelling them glass told an operator the opposite of what
 * the preset would do. A chip exists to let somebody see what Both will do
 * before they click it, so it has to name the thing.
 *
 * Read off the blur, because that is the property that decides it: no frost is
 * an opaque tonal surface, a lot of frost is heavy glass, and in between is
 * the ordinary translucent plate the store ships with.
 */
export function presetMaterialLabel(p) {
  if (!presetHasMaterial(p)) return null;
  const blur = Number(p?.settings?.theme_glass_blur);
  if (!Number.isFinite(blur)) return 'material';
  if (blur === 0) return 'opaque material';
  if (blur >= 40) return 'heavy glass';
  return 'glass material';
}

/**
 * The ambient effects a preset switches ON — the ones its card must disclose.
 * Carried-but-off keys are deliberately not listed: "applies a palette and
 * stills the air" is the unsurprising case, "starts a canvas animation" is
 * the one an operator has to see coming.
 */
const EFFECT_TOGGLES = [
  ['effects_sparkles', 'sparkles'],
  ['effects_smoke', 'smoke'],
  ['effects_snow', 'snow'],
  ['effects_aurora', 'aurora'],
  ['effects_header', 'header field'],
  // The two WebGL2 slots disclose as "shader", without naming which one. The
  // chip answers "will applying this start a GPU effect I did not ask for",
  // and that answer is the same whichever field it is.
  ['effects_shader', 'background shader'],
  ['effects_header_shader', 'header shader'],
];
export const presetEffectsOn = (p) => EFFECT_TOGGLES
  .filter(([key]) => p?.settings?.[key] === 'true')
  .map(([, label]) => label);

/**
 * What a look is FOR, in one word — the axis the gallery groups on.
 *
 * Added when the roster reached fifty, because at that size a flat grid of
 * swatch cards stops being a choice and becomes a wall. The families are not
 * a tidying exercise: an operator arrives at this page knowing what KIND of
 * store they run, not which of fifty proper nouns matches it, and "machine" or
 * "print" is a question they can answer where "Substrate or Riso?" is not.
 *
 * Deliberately not stored inside `settings`. A family is metadata about the
 * preset, not part of the look — putting it in `settings` would send it
 * through `presetPatch` to the theme, the server's key validator would refuse
 * it, and every custom preset captured from the editor would carry a stale
 * copy of whichever family the operator had last applied.
 *
 * `custom` is not in this list. An operator's own presets are grouped by the
 * gallery under their own heading, because "mine" is the distinction that
 * matters about them and no automatic guess at a family would be right.
 */
export const PRESET_FAMILIES = [
  { id: 'quiet', label: 'Quiet', hint: 'Neutral rooms that stay out of the way of the catalogue.' },
  { id: 'material', label: 'Material', hint: 'Looks where the surface itself is the idea — glass, stone, tonal plate.' },
  { id: 'print', label: 'Print', hint: 'Ink and paper: screens, plates, tooth, and no gloss.' },
  { id: 'nature', label: 'Nature', hint: 'Landscape and weather — the ground carries a place.' },
  { id: 'machine', label: 'Machine', hint: 'Terminals, consoles, boards. Tight corners and little frost.' },
  { id: 'luxury', label: 'Luxury', hint: 'Jewel grounds and metal, usually under heavy glass.' },
  { id: 'signal', label: 'Signal', hint: 'Built to be read first: hard edges, wide text separation.' },
  /*
   * The one family with a date attached, and the only one an operator turns ON
   * and later turns OFF again. It is grouped rather than scattered for exactly
   * that reason: somebody putting the shop into Christmas in November wants to
   * find all five of these together in January, not remember which proper noun
   * they picked.
   */
  { id: 'seasonal', label: 'Seasonal', hint: 'Dated looks for a shop that dresses up: five holidays, each with its own field and header.' },
];

const FAMILY_LABELS = Object.fromEntries(PRESET_FAMILIES.map((f) => [f.id, f.label]));

/** The family's display name, or null for a preset that declares none. */
export const familyLabel = (id) => FAMILY_LABELS[id] || null;

export const BUILTIN_PRESETS = {
  studio: {
    label: 'Studio',
    family: 'quiet',
    description: 'A clean storefront with soft graphite, crisp white, and considered indigo accents. Spacious typography and quiet surfaces keep the collection in focus.',
    settings: {
      theme_bg: '#111318', theme_text: '#edeef2',
      theme_primary: '#9aa9ff', theme_secondary: '#a3b4c9', theme_accent: '#c0caff',
      theme_success: '#64d9a0', theme_warning: '#e7b963', theme_danger: '#ff8d94',
      theme_bg_light: '#f5f6f8', theme_text_light: '#19212f',
      theme_primary_light: '#4655bd', theme_secondary_light: '#50647c', theme_accent_light: '#33449f',
      theme_success_light: '#247448', theme_warning_light: '#825b13', theme_danger_light: '#b43444',
      theme_glow_color: '#9aa9ff', theme_glow_color_2: '#a3b4c9',
      theme_glow_color_light: '#4655bd', theme_glow_color_2_light: '#50647c',
      theme_bg_tint: '5', theme_grain: '0', theme_glow_strength: '0.2',
      theme_glass_opacity: '0.045', theme_glass_blur: '18', theme_glass_saturation: '110',
      theme_glass_rim: '35', theme_radius: '16', theme_border_strength: '85', theme_text_contrast: '105',
      theme_font_ui: 'geist', theme_font_display: 'schibsted', theme_font_mono: 'geist-mono',
      effects_sparkles: 'false', effects_smoke: 'false', effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil', effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_sparkle_color: '#c0caff', theme_smoke_color: '#a3b4c9', theme_snow_color: '#edeef2', theme_aurora_color: '#64d9a0', theme_header_color: '#9aa9ff',
      theme_shader_color: '#9aa9ff', theme_shader_color_2: '#a3b4c9', theme_header_shader_color: '#9aa9ff', theme_header_shader_color_2: '#a3b4c9',
    },
  },
  /*
   * The shipped default, declared in full. Its material and room ARE the
   * stock values — declared rather than omitted so that "apply Ledger" is a
   * way home: after a week of slider experiments it restores the tuned room,
   * not just the tuned palette. Matte paper physics — standard frost, honest
   * edge light, tooth in the grain — and still air: a ledger is a quiet
   * document, so both effects are declared off, in the house indigo and
   * steel should anyone switch them on.
   */
  ledger: {
    label: 'Ledger',
    family: 'quiet',
    description: 'Warm graphite & paper, electric indigo, brass. The shipped default, in its shipped material.',
    settings: {
      theme_bg: '#111113', theme_text: '#ecebe7',
      theme_primary: '#7e8dff', theme_secondary: '#8fa8bf', theme_accent: '#a5b0ff',
      theme_success: '#4fce8f', theme_warning: '#e0a84e', theme_danger: '#ff7368',
      theme_glow_color: '#7e8dff', theme_glow_color_2: '#8fa8bf',
      theme_bg_light: '#f7f6f2', theme_text_light: '#17150f',
      theme_primary_light: '#4453d6', theme_secondary_light: '#48657d', theme_accent_light: '#2e3cb8',
      theme_success_light: '#1c7a4e', theme_warning_light: '#7d5a10', theme_danger_light: '#bc3038',
      theme_glow_color_light: '#4453d6', theme_glow_color_2_light: '#48657d',
      theme_bg_tint: '10', theme_grain: '2',
      theme_glass_opacity: '0.05', theme_glass_blur: '22', theme_glass_saturation: '160',
      theme_glass_rim: '100', theme_radius: '14', theme_glow_strength: '0.35',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#a5b0ff', theme_smoke_color: '#8fa8bf',
      theme_snow_color: '#ecebe7', theme_aurora_color: '#4fce8f',
      theme_header_color: '#7e8dff',
      theme_shader_color: '#7e8dff', theme_shader_color_2: '#8fa8bf',
      theme_header_shader_color: '#7e8dff', theme_header_shader_color_2: '#8fa8bf',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },
  /*
   * Volcanic glass: dark, hard, polished. Thinner plates than Ledger with a
   * deeper polish behind them (lower opacity, higher blur), a harder specular
   * edge because obsidian is the one material here that genuinely shines,
   * corners cut tight rather than rounded, and the bloom held back so the
   * single cyan signal stays single. Effects off — a knapped edge doesn't
   * twinkle — with ice-glint and aurora colours banked for whoever flips them.
   */
  obsidian: {
    label: 'Obsidian Signal',
    family: 'material',
    description: 'Cool graphite, one cyan signal. Polished dark glass: tight corners, hard edge light, calm bloom.',
    settings: {
      theme_bg: '#0a0c0f', theme_text: '#e8ebee',
      theme_primary: '#35c9dd', theme_secondary: '#8d99f7', theme_accent: '#8be2ef',
      theme_success: '#2fd694', theme_warning: '#f5b950', theme_danger: '#ff6b7a',
      theme_glow_color: '#35c9dd', theme_glow_color_2: '#8d99f7',
      theme_bg_light: '#f5f6f8', theme_text_light: '#101419',
      theme_primary_light: '#0a7285', theme_secondary_light: '#4f46c8', theme_accent_light: '#085d6b',
      theme_success_light: '#0e7a52', theme_warning_light: '#8a5f12', theme_danger_light: '#c22f45',
      theme_glow_color_light: '#0a7285', theme_glow_color_2_light: '#4f46c8',
      theme_bg_tint: '14', theme_grain: '6',
      theme_glass_opacity: '0.04', theme_glass_blur: '26', theme_glass_saturation: '150',
      theme_glass_rim: '120', theme_radius: '10', theme_glow_strength: '0.8',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#8be2ef', theme_smoke_color: '#8d99f7',
      theme_snow_color: '#e8ebee', theme_aurora_color: '#2fd694',
      theme_header_color: '#35c9dd',
      theme_shader_color: '#35c9dd', theme_shader_color_2: '#8d99f7',
      theme_header_shader_color: '#35c9dd', theme_header_shader_color_2: '#8d99f7',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'space-grotesk', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * Fine ceramic, re-cut. The old Porcelain was a blue-black page with a sky
   * blue on it, which put it within a few percent of Liquid Glass and Ledger
   * on every axis that matters — same near-neutral ground, same single cool
   * signal, same weight. It wore a distinctive material and a palette that
   * was not.
   *
   * Porcelain is not blue-black. It is a warm clay body under a cool glaze,
   * so the ground is a warm neutral and the signal is celadon — the pale
   * jade a glaze goes when it pools. The plate still has more body than any
   * other translucent look here (highest opacity of them) and the least
   * happening inside it: shallow blur, backdrop vividness reined in because
   * an almost-achromatic room must not bloom colour it does not have, a soft
   * glaze sheen instead of a specular rim, and the faintest glow on the
   * board. Corners smoothed like a thrown pot. Still air, of course.
   */
  porcelain: {
    label: 'Porcelain',
    family: 'material',
    description: 'Warm clay under a celadon glaze. Milky plate, soft sheen, barely-there glow — the quietest room here.',
    settings: {
      theme_bg: '#151311', theme_text: '#efeae3',
      theme_primary: '#7fc9b4', theme_secondary: '#aaa79d', theme_accent: '#a8dcc9',
      theme_success: '#6cc48a', theme_warning: '#d9b264', theme_danger: '#ef7d72',
      theme_glow_color: '#7fc9b4', theme_glow_color_2: '#aaa79d',
      theme_bg_light: '#f6f4f0', theme_text_light: '#1b1815',
      theme_primary_light: '#116b58', theme_secondary_light: '#55524a', theme_accent_light: '#0d5546',
      theme_success_light: '#256d33', theme_warning_light: '#7a5713', theme_danger_light: '#b53229',
      theme_glow_color_light: '#116b58', theme_glow_color_2_light: '#55524a',
      theme_bg_tint: '9', theme_grain: '5',
      theme_glass_opacity: '0.08', theme_glass_blur: '16', theme_glass_saturation: '125',
      theme_glass_rim: '70', theme_radius: '18', theme_glow_strength: '0.5',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#a8dcc9', theme_smoke_color: '#aaa79d',
      theme_snow_color: '#efeae3', theme_aurora_color: '#6cc48a',
      // Celadon marble on a clay body is the one weather this look was
      // always going to wear best; pre-tinted, one toggle away.
      theme_header_color: '#7fc9b4',
      theme_shader_color: '#7fc9b4', theme_shader_color_2: '#aaa79d',
      theme_header_shader_color: '#7fc9b4', theme_header_shader_color_2: '#aaa79d',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'schibsted', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * Google Material 3, taken at its word: tonal surfaces, not glass. Blur,
   * saturation boost and specular rim all at their floors — an M3 surface is
   * an opaque tonal lift, so the opacity is the highest in the roster and the
   * "glass" reads as elevation overlay, not frost. Glow zeroed (M3 is flat;
   * the focus ring is floored in computeVars and survives), the room tint and
   * grain zeroed so the page is exactly its surface colour, and the grandest
   * corners on the board. The one look here with no atmosphere at all —
   * which is itself the atmosphere.
   *
   * The one place it does NOT take M3 at its word is the dark error colour.
   * Every value here is a baseline M3 token, and error80 (#f2b8b5) sits 22
   * away from tertiary80 (#efb8c8) — which is faithful, and which in THIS
   * store means the accent that drives active nav and every hover state is
   * indistinguishable from the colour that means the order failed. M3 gets
   * away with it because its error role arrives with a container, an icon and
   * a label; a bare hover tint has none of those. So the error steps down its
   * own ramp to error60 (#ff5449) — still an M3 token, four times further from
   * the accent, and a good deal more like an alarm.
   */
  material: {
    label: 'Material',
    family: 'material',
    description: 'Google Material 3 tonality: lavender on near-black, opaque tonal surfaces, zero glow, grand corners. The flat clean room.',
    settings: {
      theme_bg: '#141218', theme_text: '#e6e0e9',
      theme_primary: '#d0bcff', theme_secondary: '#ccc2dc', theme_accent: '#efb8c8',
      theme_success: '#6dd58c', theme_warning: '#f5c56b', theme_danger: '#ff5449',
      theme_glow_color: '#d0bcff', theme_glow_color_2: '#ccc2dc',
      theme_bg_light: '#fef7ff', theme_text_light: '#1d1b20',
      theme_primary_light: '#6750a4', theme_secondary_light: '#625b71', theme_accent_light: '#7d5260',
      theme_success_light: '#1e6b41', theme_warning_light: '#7a5900', theme_danger_light: '#b3261e',
      theme_glow_color_light: '#6750a4', theme_glow_color_2_light: '#625b71',
      theme_bg_tint: '0', theme_grain: '0',
      theme_glass_opacity: '0.12', theme_glass_blur: '0', theme_glass_saturation: '100',
      theme_glass_rim: '0', theme_radius: '24', theme_glow_strength: '0',
      theme_border_strength: '120', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#d0bcff', theme_smoke_color: '#ccc2dc',
      theme_snow_color: '#e6e0e9', theme_aurora_color: '#6dd58c',
      theme_header_color: '#d0bcff',
      theme_shader_color: '#d0bcff', theme_shader_color_2: '#ccc2dc',
      theme_header_shader_color: '#d0bcff', theme_header_shader_color_2: '#ccc2dc',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'inter', theme_font_display: 'schibsted', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * iOS 26's material, cool and exact: the heaviest refraction and the
   * brightest specular rim in the roster, capsule corners, backdrop colour
   * blooming through at double vividness. Grain low — Apple's glass is
   * optically clean, kept just above zero so wide gradients don't band.
   * No canvas effects: the liquid look moves when the page moves, and
   * nothing else moves.
   */
  'liquid-glass': {
    label: 'Liquid Glass',
    family: 'material',
    description: 'iOS 26 material: heavy refraction, vivid backdrop bloom, strong specular rim, capsule corners. Carries the glass itself, not just colours.',
    settings: {
      theme_bg: '#0a0a10', theme_text: '#f5f5f7',
      theme_primary: '#4a8cff', theme_secondary: '#9a9aa2', theme_accent: '#64d2ff',
      theme_success: '#32d74b', theme_warning: '#ffd60a', theme_danger: '#ff453a',
      theme_glow_color: '#4a8cff', theme_glow_color_2: '#9a9aa2',
      theme_bg_light: '#fbfbfd', theme_text_light: '#16161a',
      theme_primary_light: '#0a63d8', theme_secondary_light: '#55555e', theme_accent_light: '#0078b1',
      theme_success_light: '#1d8038', theme_warning_light: '#986800', theme_danger_light: '#d70015',
      theme_glow_color_light: '#0a63d8', theme_glow_color_2_light: '#55555e',
      theme_bg_tint: '14', theme_grain: '3',
      theme_glass_opacity: '0.09', theme_glass_blur: '46', theme_glass_saturation: '200',
      theme_glass_rim: '160', theme_radius: '22', theme_glow_strength: '0.9',
      theme_border_strength: '60', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#64d2ff', theme_smoke_color: '#9a9aa2',
      theme_snow_color: '#f5f5f7', theme_aurora_color: '#32d74b',
      theme_header_color: '#4a8cff',
      theme_shader_color: '#4a8cff', theme_shader_color_2: '#9a9aa2',
      theme_header_shader_color: '#4a8cff', theme_header_shader_color_2: '#9a9aa2',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'schibsted', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * Warm liquid glass under a marine layer. Softer refraction than Liquid
   * Glass (the fog diffuses everything), gold warmth in the glow, and the
   * one built-in whose air actually moves: the smoke effect is ON in
   * marine-layer steel, because the fog rolling under the bridge is the
   * whole point of the name — a Golden Gate with still air is a poster of
   * it. The canvas pauses on hidden tabs and stills under reduced motion,
   * so the cost is the look's, not the visitor's.
   */
  'golden-gate': {
    label: 'Golden Gate',
    family: 'nature',
    description: 'Warm liquid glass: International Orange signal, gold accents, and the marine layer itself — real fog drifts through.',
    settings: {
      theme_bg: '#131011', theme_text: '#f6f1ea',
      theme_primary: '#ff6b3d', theme_secondary: '#9fb0c0', theme_accent: '#e6b45a',
      theme_success: '#3fbf7f', theme_warning: '#f0b429', theme_danger: '#ff5d55',
      theme_glow_color: '#ff6b3d', theme_glow_color_2: '#e6b45a',
      theme_bg_light: '#f7f3ec', theme_text_light: '#1a140e',
      theme_primary_light: '#b33f1f', theme_secondary_light: '#51616f', theme_accent_light: '#8a6210',
      theme_success_light: '#1e7a4a', theme_warning_light: '#8a5a00', theme_danger_light: '#bd2f2a',
      theme_glow_color_light: '#b33f1f', theme_glow_color_2_light: '#8a6210',
      theme_bg_tint: '16', theme_grain: '5',
      theme_glass_opacity: '0.08', theme_glass_blur: '40', theme_glass_saturation: '185',
      theme_glass_rim: '140', theme_radius: '18', theme_glow_strength: '1.05',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'true',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#e6b45a', theme_smoke_color: '#9fb0c0',
      // Fog-paper snow, headland green aurora, gold marble — every optional
      // weather this look could wear, pre-tinted.
      theme_snow_color: '#f6f1ea', theme_aurora_color: '#3fbf7f',
      theme_header_color: '#ff6b3d',
      theme_shader_color: '#ff6b3d', theme_shader_color_2: '#e6b45a',
      theme_header_shader_color: '#ff6b3d', theme_header_shader_color_2: '#e6b45a',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'archivo', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * A CRT in a dark room. The tube is bare glass: almost no frost, no
   * backdrop saturation, a trace of curved-screen glare in the rim, corners
   * near square. What a CRT has instead of material is LIGHT — the hottest
   * glow on the board, phosphor bleeding into the room (highest tint), the
   * heaviest grain as broadcast static, and the green afterglow hanging in
   * the air: smoke ON in the phosphor primary.
   */
  phosphor: {
    label: 'Phosphor',
    family: 'machine',
    description: 'CRT terminal: phosphor green on near-black, bare tube glass, hot bloom, broadcast static, afterglow haze in the air.',
    settings: {
      theme_bg: '#0b0f0c', theme_text: '#d8eed8',
      theme_primary: '#53dd6c', theme_secondary: '#9dbfa4', theme_accent: '#86f09b',
      theme_success: '#43c96b', theme_warning: '#e0c36c', theme_danger: '#ff6d5a',
      theme_glow_color: '#53dd6c', theme_glow_color_2: '#9dbfa4',
      theme_bg_light: '#f3f6f2', theme_text_light: '#131a13',
      theme_primary_light: '#1f7a33', theme_secondary_light: '#4e6652', theme_accent_light: '#145c26',
      theme_success_light: '#1e7b3c', theme_warning_light: '#7c5d12', theme_danger_light: '#bb3a31',
      theme_glow_color_light: '#1f7a33', theme_glow_color_2_light: '#4e6652',
      theme_bg_tint: '18', theme_grain: '14',
      theme_glass_opacity: '0.03', theme_glass_blur: '6', theme_glass_saturation: '110',
      theme_glass_rim: '45', theme_radius: '5', theme_glow_strength: '1.6',
      theme_border_strength: '125', theme_text_contrast: '115',
      effects_sparkles: 'false', effects_smoke: 'true',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#86f09b', theme_smoke_color: '#53dd6c',
      // Aurora in the phosphor green is there for whoever wants the CRT sky —
      // declared off, one toggle away.
      theme_snow_color: '#d8eed8', theme_aurora_color: '#43c96b',
      theme_header_color: '#53dd6c',
      theme_shader_color: '#53dd6c', theme_shader_color_2: '#9dbfa4',
      theme_header_shader_color: '#53dd6c', theme_header_shader_color_2: '#9dbfa4',
      effects_bg_engine: 'canvas', effects_header_engine: 'webgl2',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'true', effects_header_shader_name: 'scanlines',
      theme_font_ui: 'geist', theme_font_display: 'space-grotesk', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * ── The four looks added on 2026-08-27, and why they exist ──────────────
   *
   * The roster had drifted into one idea rendered eight ways. Every built-in
   * put a near-black ground (every one between #08 and #14 in luminance) under
   * exactly one bright, saturated signal, so the picker read as a row of
   * accent-colour swatches rather than as a choice between rooms. What varied
   * was the hue of one colour; what did not vary was the ground, the number of
   * colours doing work, or the temperature.
   *
   * These four vary the things that were fixed:
   *
   *   · the GROUND moves off the house graphite — slate-teal, clay-brown,
   *     aubergine, true black. Measured with the crude chroma the roster guard
   *     uses (widest channel minus narrowest), only Tidewater at 21 and
   *     Amethyst at 13 actually clear its bar; Terracotta is 8 and Bullion,
   *     being true black, is 0. Do not read this bullet as "these four are the
   *     coloured grounds" — the guard's third qualifier was Classic Cyan, the
   *     capsule nobody may retune, and Lacquer was added below partly to stop
   *     the roster resting its own invariant on that;
   *   · two or three colours carry the look instead of one, so a page has a
   *     relationship in it rather than a highlight;
   *   · they span the whole material range on purpose. Amethyst is the
   *     heaviest glass on the board and Bullion has no glass at all.
   *
   * Every colour below was solved to at least 4.7:1 on its own ground, in both
   * modes, by utils in theme/color.js rather than by eye — and there is a test
   * that will fail if anybody edits one of them down. Do not "tune" them here.
   */

  /*
   * A cold coast at dusk: slate-teal water under steel light, with the one
   * warm thing in the frame being rust on a hull. The first look here whose
   * ground is a colour rather than a shade of black, and the complementary
   * pairing (cool primary, warm accent) is what gives it depth no single-hue
   * palette can reach.
   *
   * Material sits deliberately mid-range — real translucency, moderate
   * refraction, an honest edge — because this look is about the palette and a
   * heavy glass would take the attention.
   *
   * The danger colour is the one thing here that is not free to be whatever
   * suits the palette. "One rust signal" puts the ACCENT — active nav, hover,
   * every highlight in the store — at hue 22, which is exactly where a red
   * alarm wants to sit, and the two shipped 51 apart: close enough that
   * hovering a row looked like the row had failed. So the alarm is pushed
   * round to a cool rose that no part of the marine palette occupies. The same
   * collision, from the same cause, had to be solved in Terrace and Herbarium;
   * there is a test now.
   */
  tidewater: {
    label: 'Tidewater',
    family: 'nature',
    description: 'Slate-teal water, steel light, one rust signal. Coloured ground, complementary accent, honest glass.',
    settings: {
      theme_bg: '#0b1a20', theme_text: '#e4eef1',
      theme_primary: '#5fb6d4', theme_secondary: '#8fa9a4', theme_accent: '#e08a5f',
      theme_success: '#3fc79a', theme_warning: '#e3b25c', theme_danger: '#ed5a7c',
      theme_glow_color: '#5fb6d4', theme_glow_color_2: '#e08a5f',
      theme_bg_light: '#eef3f4', theme_text_light: '#0e1d22',
      theme_primary_light: '#186a8a', theme_secondary_light: '#3f5b58', theme_accent_light: '#a2482a',
      theme_success_light: '#0f7355', theme_warning_light: '#7a5510', theme_danger_light: '#ae1338',
      theme_glow_color_light: '#186a8a', theme_glow_color_2_light: '#a2482a',
      theme_bg_tint: '13', theme_grain: '6',
      theme_glass_opacity: '0.06', theme_glass_blur: '30', theme_glass_saturation: '170',
      theme_glass_rim: '110', theme_radius: '12', theme_glow_strength: '0.95',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      // The one look on the board that ships with weather ON besides Golden
      // Gate and Phosphor. An aurora over cold water is the picture this
      // palette is of; without it the name is doing all the work.
      effects_snow: 'false', effects_aurora: 'true', effects_header: 'false',
      theme_sparkle_color: '#e08a5f', theme_smoke_color: '#8fa9a4',
      theme_snow_color: '#e4eef1', theme_aurora_color: '#5fb6d4',
      theme_header_color: '#5fb6d4',
      theme_shader_color: '#5fb6d4', theme_shader_color_2: '#e08a5f',
      theme_header_shader_color: '#5fb6d4', theme_header_shader_color_2: '#e08a5f',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'caustics',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'schibsted', theme_font_mono: 'geist-mono',
    },
  },

  /*
   * Fired clay: a warm brown-black ground, rust, sage and brass. The warmest
   * room on the board by a distance — everything else here is neutral or cool,
   * and a store that wants to look like a workshop rather than a terminal had
   * nothing to reach for.
   *
   * FLAT AND UNFROSTED, which is what "opaque like Material" means here. Blur,
   * saturation boost and specular rim are all at their floors and the plate
   * opacity is near the top of its range, so a card reads as a slab of tinted
   * clay sitting on the page rather than as a window into it. The glow is
   * nearly off and the corners are cut small: this is a material with weight,
   * and weight does not bloom.
   *
   * Worth stating plainly rather than overclaiming: `theme_glass_opacity` tops
   * out at 0.3, so no preset can make a surface literally opaque — Material,
   * the look this one is modelled on, is 0.12. What "opaque" names on this
   * board is the treatment (no frost, no rim, no bloom), not an alpha of 1.
   * Raising that ceiling is a theme-engine change, not a palette one.
   *
   * Effects are declared OFF, including marble. A slowly-moving field behind a
   * translucent slab is visible THROUGH it, which is the one thing that undoes
   * a flat surface — the colour is banked for an operator who wants it anyway.
   */
  terracotta: {
    label: 'Terracotta',
    family: 'nature',
    description: 'Fired clay and sage under brass light. Flat unfrosted slabs — no blur, no bloom, all weight.',
    settings: {
      theme_bg: '#1a1512', theme_text: '#f0e7de',
      theme_primary: '#e0784f', theme_secondary: '#a3ab8e', theme_accent: '#d9a441',
      theme_success: '#78b569', theme_warning: '#dfae4d', theme_danger: '#ef6f63',
      theme_glow_color: '#e0784f', theme_glow_color_2: '#d9a441',
      theme_bg_light: '#f6efe7', theme_text_light: '#211913',
      theme_primary_light: '#a8451f', theme_secondary_light: '#4d5a3e', theme_accent_light: '#7d5710',
      theme_success_light: '#2c6f2a', theme_warning_light: '#7c560f', theme_danger_light: '#b32f24',
      theme_glow_color_light: '#a8451f', theme_glow_color_2_light: '#7d5710',
      theme_bg_tint: '15', theme_grain: '11',
      theme_glass_opacity: '0.15', theme_glass_blur: '0', theme_glass_saturation: '100',
      theme_glass_rim: '0', theme_radius: '8', theme_glow_strength: '0.2',
      theme_border_strength: '115', theme_text_contrast: '105',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#d9a441', theme_smoke_color: '#a3ab8e',
      theme_snow_color: '#f0e7de', theme_aurora_color: '#78b569',
      theme_header_color: '#e0784f',
      theme_shader_color: '#e0784f', theme_shader_color_2: '#d9a441',
      theme_header_shader_color: '#e0784f', theme_header_shader_color_2: '#d9a441',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },

  /*
   * Aubergine glass. The deepest colour on any ground here, three hues doing
   * real work (orchid, indigo, jade) instead of one, and the HEAVIEST material
   * on the board: the most refraction, the most backdrop vividness, the
   * strongest specular rim and the grandest corners of any translucent look.
   *
   * Where Liquid Glass is optically clean and cold, this is the same physics
   * warmed and pushed past it — glass with something dissolved in it. It is
   * the answer to "make one of them properly see-through", and the palette was
   * chosen to survive that treatment: a heavy blur over a near-neutral ground
   * has nothing to refract, which is exactly why the existing near-black
   * presets could not have been pushed this far.
   */
  amethyst: {
    label: 'Amethyst',
    family: 'material',
    description: 'Aubergine ground, orchid and jade. The heaviest glass here: deep refraction, vivid bloom, grand corners.',
    settings: {
      theme_bg: '#150f1c', theme_text: '#ece5f3',
      theme_primary: '#b98cf0', theme_secondary: '#7f8fd6', theme_accent: '#54cbc0',
      theme_success: '#4fc98d', theme_warning: '#dfae5b', theme_danger: '#f2718a',
      theme_glow_color: '#b98cf0', theme_glow_color_2: '#54cbc0',
      theme_bg_light: '#f4f1f8', theme_text_light: '#1a1222',
      theme_primary_light: '#6b3fb5', theme_secondary_light: '#3f4b9c', theme_accent_light: '#0d6a63',
      theme_success_light: '#14713f', theme_warning_light: '#7a5511', theme_danger_light: '#b32a4c',
      theme_glow_color_light: '#6b3fb5', theme_glow_color_2_light: '#0d6a63',
      theme_bg_tint: '20', theme_grain: '3',
      theme_glass_opacity: '0.05', theme_glass_blur: '52', theme_glass_saturation: '210',
      theme_glass_rim: '155', theme_radius: '24', theme_glow_strength: '1.25',
      theme_border_strength: '70', theme_text_contrast: '100',
      // Sparkles ON, in the jade accent. A stone with inclusions in it catches
      // the light; this is the one look whose material is heavy enough that a
      // few points of light read as depth rather than as decoration.
      effects_sparkles: 'true', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#54cbc0', theme_smoke_color: '#7f8fd6',
      theme_snow_color: '#ece5f3', theme_aurora_color: '#b98cf0',
      theme_header_color: '#b98cf0',
      theme_shader_color: '#b98cf0', theme_shader_color_2: '#54cbc0',
      theme_header_shader_color: '#b98cf0', theme_header_shader_color_2: '#54cbc0',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'nebula',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'jetbrains',
    },
  },

  /*
   * Gold on true black, and nothing else. The only genuinely achromatic ground
   * here — every other "black" on this board is tinted toward blue or brown —
   * with one metallic doing all the signalling and a cool grey carrying
   * everything it cannot.
   *
   * Flat and unfrosted like Terracotta (see there for what "opaque" can and
   * cannot mean on this board), but where that look is warm and heavy this one
   * is editorial: razor corners, no frost, no rim, almost no glow.
   * The restraint IS the look. Its closest relative on the board is Material,
   * which is the point of having both — same physics, opposite temperament,
   * and neither is a palette wearing the other's body.
   */
  bullion: {
    label: 'Bullion',
    family: 'luxury',
    description: 'Gold on true black, one cool grey beside it. Flat, razor-cornered, editorial restraint.',
    settings: {
      theme_bg: '#0a0a0a', theme_text: '#f2f0ea',
      theme_primary: '#d6a53c', theme_secondary: '#9aa0a6', theme_accent: '#e8cf87',
      theme_success: '#5cc47e', theme_warning: '#d8ae4e', theme_danger: '#e8695f',
      theme_glow_color: '#d6a53c', theme_glow_color_2: '#9aa0a6',
      theme_bg_light: '#faf8f3', theme_text_light: '#111110',
      theme_primary_light: '#7a5a0d', theme_secondary_light: '#4a4f55', theme_accent_light: '#5e4708',
      theme_success_light: '#186c3c', theme_warning_light: '#7a570f', theme_danger_light: '#b02e26',
      theme_glow_color_light: '#7a5a0d', theme_glow_color_2_light: '#4a4f55',
      // Zero tint and zero grain: the page is exactly its own colour, which is
      // the whole claim a true black makes. Any tint at all would make it a
      // dark grey with opinions.
      theme_bg_tint: '0', theme_grain: '0',
      theme_glass_opacity: '0.13', theme_glass_blur: '0', theme_glass_saturation: '100',
      theme_glass_rim: '0', theme_radius: '3', theme_glow_strength: '0.25',
      theme_border_strength: '140', theme_text_contrast: '110',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#e8cf87', theme_smoke_color: '#9aa0a6',
      theme_snow_color: '#f2f0ea', theme_aurora_color: '#5cc47e',
      theme_header_color: '#d6a53c',
      theme_shader_color: '#d6a53c', theme_shader_color_2: '#9aa0a6',
      theme_header_shader_color: '#d6a53c', theme_header_shader_color_2: '#9aa0a6',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'inter', theme_font_display: 'archivo', theme_font_mono: 'geist-mono',
    },
  },

  /*
   * A time capsule, not a design: the pre-Ledger store exactly as it
   * shipped. Palette, room, glass and effect colours are the values in
   * LEGACY_DEFAULTS (glass 0.04/20, tint 18, grain 6, cyan sparkle, violet
   * smoke — the effects existed then and defaulted off); rim, radius,
   * saturation and glow strength postdate that look, so they sit at the
   * neutral defaults the migration would have left them at. Nothing here is
   * "improved" on purpose — improving it would break the one promise this
   * preset makes, which is last month's look without a database restore.
   */
  classic: {
    label: 'Classic Cyan',
    family: 'quiet',
    description: 'The pre-Ledger look: cyan / violet / mint on deep blue-black, in its era’s exact glass and glow.',
    settings: {
      theme_bg: '#080b14', theme_text: '#e8ecf8',
      theme_primary: '#2dd4e8', theme_secondary: '#8b7cff', theme_accent: '#7df0dc',
      theme_success: '#34e39b', theme_warning: '#ffb84d', theme_danger: '#ff6b81',
      theme_glow_color: '#2dd4e8', theme_glow_color_2: '#8b7cff',
      theme_bg_light: '#f5f7fb', theme_text_light: '#0c1220',
      theme_primary_light: '#0c7281', theme_secondary_light: '#604fd9', theme_accent_light: '#08505e',
      theme_success_light: '#107652', theme_warning_light: '#8a5c14', theme_danger_light: '#bf3149',
      theme_glow_color_light: '#0c7281', theme_glow_color_2_light: '#604fd9',
      theme_bg_tint: '18', theme_grain: '6',
      theme_glass_opacity: '0.04', theme_glass_blur: '20', theme_glass_saturation: '160',
      theme_glass_rim: '100', theme_radius: '14', theme_glow_strength: '1',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#2dd4e8', theme_smoke_color: '#8b7cff',
      // These three postdate the era, like the rim and saturation scalars:
      // they sit at stillness with era colours, keeping the capsule complete.
      theme_snow_color: '#e8ecf8', theme_aurora_color: '#34e39b',
      theme_header_color: '#2dd4e8',
      theme_shader_color: '#2dd4e8', theme_shader_color_2: '#8b7cff',
      theme_header_shader_color: '#2dd4e8', theme_header_shader_color_2: '#8b7cff',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'inter', theme_font_display: 'space-grotesk', theme_font_mono: 'jetbrains',
    },
  },

  /*
   * Ink on newsprint. The one achromatic look on the board, and the only one
   * at radius 0 — a sheet of paper has no rounded corners.
   *
   * The room is genuinely monochrome: ground, text, primary, secondary and
   * accent are all pure greys, so the store's whole voice is a lightness
   * ramp. Opaque stock rather than glass (blur 0, rim 0), no glow at all, and
   * the heaviest grain in the roster because that is what newsprint IS — the
   * tooth is the material, not an effect over it.
   *
   * THE STATUS TRIO IS DELIBERATELY NOT GREY, and this is the interesting
   * decision in the preset. A fully achromatic success/warning/danger clears
   * AA without difficulty — greys at 11.62, 13.11 and 10.23 on this ground —
   * and is still wrong, because it makes "in stock", "low stock" and "out of
   * stock" the same colour. That is precisely the failure DESIGN §3 names
   * about glow: a channel carrying meaning with nothing behind it. So the
   * three states keep the least chroma that still separates them, and the
   * brand is where the monochrome actually lives. A black-and-white store
   * still has to be able to say something is wrong.
   */
  newsprint: {
    label: 'Newsprint',
    family: 'print',
    description: 'Ink on paper: pure greys, square corners, no glass and no glow, heavy tooth. Status colours kept, so stock states stay tellable apart.',
    settings: {
      theme_bg: '#0c0c0c', theme_text: '#e8e8e8',
      theme_primary: '#cfcfcf', theme_secondary: '#9a9a9a', theme_accent: '#ffffff',
      theme_success: '#7fbf9a', theme_warning: '#c9a765', theme_danger: '#e08076',
      theme_glow_color: '#cfcfcf', theme_glow_color_2: '#9a9a9a',
      theme_bg_light: '#fbfbfa', theme_text_light: '#131313',
      theme_primary_light: '#2b2b2b', theme_secondary_light: '#5c5c5c', theme_accent_light: '#000000',
      theme_success_light: '#1f6b47', theme_warning_light: '#6f5411', theme_danger_light: '#a72b2b',
      theme_glow_color_light: '#2b2b2b', theme_glow_color_2_light: '#5c5c5c',
      theme_bg_tint: '0', theme_grain: '16',
      theme_glass_opacity: '0.13', theme_glass_blur: '0', theme_glass_saturation: '100',
      theme_glass_rim: '0', theme_radius: '0', theme_glow_strength: '0',
      theme_border_strength: '150', theme_text_contrast: '120',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#ffffff', theme_smoke_color: '#9a9a9a',
      theme_snow_color: '#e8e8e8', theme_aurora_color: '#7fbf9a',
      theme_header_color: '#cfcfcf',
      theme_shader_color: '#cfcfcf', theme_shader_color_2: '#9a9a9a',
      theme_header_shader_color: '#cfcfcf', theme_header_shader_color_2: '#9a9a9a',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'inter', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },

  /*
   * Red lacquer over oxblood. The roster's first true red — every other look
   * signals in blue, violet, green, orange or gold, and red was missing
   * because it is the hardest hue to clear AA with on a dark ground.
   *
   * It also does the roster a structural favour. The anti-collapse guard in
   * the test suite wants at least three built-in grounds carrying real chroma,
   * and before this one there were exactly three — one of which is Classic
   * Cyan, the time capsule nobody may retune. This ground measures 14, so the
   * guard has somewhere to stand that is not the preset frozen by contract.
   *
   * Deep glass over a warm-black body: heavy-ish frost, a hard specular rim
   * because lacquer is a polished finish, corners cut close, and the highest
   * background tint on the board — the one knob the roster had never taken
   * past a fifth of its range, so the room here genuinely carries its colour
   * rather than being a neutral box with red furniture in it.
   *
   * A red room is the worst case for the alarm, and this one had it wrong in
   * both modes: the accent and the danger were 54 apart in dark and 34 in
   * light, so every hovered row looked like a failed one. They cannot be
   * separated by hue — everything here IS red — so they are separated by
   * SATURATION and warmth instead: the accent stays the hot orange-red of the
   * lacquer itself, and the alarm steps back to a cooler, less saturated true
   * red that no part of the finish occupies.
   */
  lacquer: {
    label: 'Lacquer',
    family: 'luxury',
    description: 'Red lacquer over oxblood: a polished dark body, hard edge light, and the most deeply tinted room in the roster.',
    settings: {
      theme_bg: '#1a0c0e', theme_text: '#f2e6e4',
      theme_primary: '#ff5a52', theme_secondary: '#c99a92', theme_accent: '#ff8f7d',
      theme_success: '#5fc98a', theme_warning: '#e8b45e', theme_danger: '#d4535b',
      theme_glow_color: '#ff5a52', theme_glow_color_2: '#c99a92',
      theme_bg_light: '#faf3f1', theme_text_light: '#1c100f',
      theme_primary_light: '#b32020', theme_secondary_light: '#7a4b45', theme_accent_light: '#8f1d1d',
      theme_success_light: '#1c7a4e', theme_warning_light: '#7d5a10', theme_danger_light: '#b42d36',
      theme_glow_color_light: '#b32020', theme_glow_color_2_light: '#7a4b45',
      theme_bg_tint: '34', theme_grain: '4',
      theme_glass_opacity: '0.06', theme_glass_blur: '30', theme_glass_saturation: '175',
      theme_glass_rim: '150', theme_radius: '6', theme_glow_strength: '1.1',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#ff8f7d', theme_smoke_color: '#c99a92',
      theme_snow_color: '#f2e6e4', theme_aurora_color: '#5fc98a',
      theme_header_color: '#ff5a52',
      theme_shader_color: '#ff5a52', theme_shader_color_2: '#c99a92',
      theme_header_shader_color: '#ff5a52', theme_header_shader_color_2: '#c99a92',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'space-grotesk', theme_font_mono: 'geist-mono',
    },
  },

  /*
   * Hazard yellow on charcoal — the warehouse look, for the half of this app
   * that is a pull list, a pack bench, a shelf and a box.
   *
   * Industrial rather than decorative, and the palette is doing a job rather
   * than a mood: safety yellow is the signal, and the status trio borrows the
   * actual vocabulary of a floor — go-green, amber, and a red that means stop.
   * Painted metal, not glass: no frost, no rim, corners barely broken, glow
   * held right down so a lit control means something on a screen someone is
   * reading under warehouse lighting. Grain stands in for the texture of a
   * powder-coated panel.
   *
   * The other missing hue this fills is yellow itself: the roster had two
   * golds sitting at 39-41°, both of them soft metallics, and nothing at all
   * in the high-visibility band.
   */
  hivis: {
    label: 'Hi-Vis',
    family: 'signal',
    description: 'Hazard yellow on charcoal. Painted metal rather than glass: no frost, no rim, barely-broken corners, glow held down.',
    settings: {
      theme_bg: '#141414', theme_text: '#ededea',
      theme_primary: '#f2c230', theme_secondary: '#a8ad9a', theme_accent: '#ffe066',
      theme_success: '#7ac943', theme_warning: '#ffa41f', theme_danger: '#ff5f4d',
      theme_glow_color: '#f2c230', theme_glow_color_2: '#a8ad9a',
      theme_bg_light: '#f7f6f0', theme_text_light: '#171612',
      theme_primary_light: '#6b5300', theme_secondary_light: '#4e5240', theme_accent_light: '#4f3d00',
      theme_success_light: '#2f6b12', theme_warning_light: '#7d4b00', theme_danger_light: '#b32d1c',
      theme_glow_color_light: '#6b5300', theme_glow_color_2_light: '#4e5240',
      theme_bg_tint: '4', theme_grain: '10',
      theme_glass_opacity: '0.15', theme_glass_blur: '0', theme_glass_saturation: '100',
      theme_glass_rim: '0', theme_radius: '2', theme_glow_strength: '0.4',
      theme_border_strength: '180', theme_text_contrast: '135',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#ffe066', theme_smoke_color: '#a8ad9a',
      theme_snow_color: '#ededea', theme_aurora_color: '#7ac943',
      theme_header_color: '#f2c230',
      theme_shader_color: '#f2c230', theme_shader_color_2: '#a8ad9a',
      theme_header_shader_color: '#f2c230', theme_header_shader_color_2: '#a8ad9a',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'archivo', theme_font_mono: 'jetbrains',
    },
  },

  /*
   * The first look on this board designed light-first.
   *
   * Every other preset is a dark room with a light twin derived afterwards,
   * which DESIGN §11 warns against in as many words — "light mode is not a
   * filter". Here the paper came first: a warm near-white ground, a solved
   * navy-blue signal with enough weight to hold its own against it, and the
   * dark twin built afterwards as the secondary artefact. A daylit counter in
   * a shop with a window is a real deployment, and the roster had nothing
   * that was drawn for it.
   *
   * Ordinary plate glass, medium corners, gentle bloom — the material is
   * deliberately the least opinionated thing here, because the point of the
   * preset is the ground, not the physics.
   */
  daylight: {
    label: 'Daylight',
    family: 'signal',
    description: 'Drawn light-first: warm paper, a solved navy signal, ordinary plate glass. The dark twin is the derived half for once.',
    settings: {
      theme_bg: '#16181b', theme_text: '#eceef0',
      theme_primary: '#6fb3e8', theme_secondary: '#9aa8b5', theme_accent: '#8fd0f0',
      theme_success: '#57c98a', theme_warning: '#dfae5c', theme_danger: '#f2796f',
      theme_glow_color: '#6fb3e8', theme_glow_color_2: '#9aa8b5',
      theme_bg_light: '#fdfcfa', theme_text_light: '#14181c',
      theme_primary_light: '#1f6fb2', theme_secondary_light: '#4a5b6b', theme_accent_light: '#12557f',
      theme_success_light: '#1c7a4e', theme_warning_light: '#7a5610', theme_danger_light: '#bb2f34',
      theme_glow_color_light: '#1f6fb2', theme_glow_color_2_light: '#4a5b6b',
      theme_bg_tint: '8', theme_grain: '4',
      theme_glass_opacity: '0.07', theme_glass_blur: '18', theme_glass_saturation: '140',
      theme_glass_rim: '90', theme_radius: '12', theme_glow_strength: '0.65',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#8fd0f0', theme_smoke_color: '#9aa8b5',
      theme_snow_color: '#eceef0', theme_aurora_color: '#57c98a',
      theme_header_color: '#6fb3e8',
      theme_shader_color: '#6fb3e8', theme_shader_color_2: '#9aa8b5',
      theme_header_shader_color: '#6fb3e8', theme_header_shader_color_2: '#9aa8b5',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'space-grotesk', theme_font_mono: 'plex',
    },
  },

  /*
   * Serpentine marble under heavy glass — and the first built-in that ships
   * one of the ambient canvases switched ON.
   *
   * Two of the five effects, marble and snow, were shipped and then
   * demonstrated by no preset at all, so the only way an operator ever met
   * them was flipping an unlabelled toggle and hoping. A canvas nobody is
   * shown is a feature nobody has. This one starts the marble, veined in its
   * own celadon over a deep green-black body, and the preset card wears the
   * effect chip so it is disclosed before it is applied — never a side
   * effect, exactly as PRESET_EFFECT_KEYS above requires.
   *
   * The material is the polished-slab end of the range: heavy frost, high
   * vividness so the veining blooms through the plates, a strong specular
   * rim, and the grandest corners short of Material's.
   */
  carrara: {
    label: 'Carrara',
    family: 'material',
    description: 'Serpentine marble under heavy polished glass. Ships with the marble canvas running — the effect chip says so before you apply it.',
    settings: {
      theme_bg: '#101413', theme_text: '#e9efec',
      theme_primary: '#7fd4c0', theme_secondary: '#a9b8b2', theme_accent: '#a5e6d6',
      theme_success: '#5cc98d', theme_warning: '#dcb266', theme_danger: '#f0827a',
      theme_glow_color: '#7fd4c0', theme_glow_color_2: '#a9b8b2',
      theme_bg_light: '#f8f8f6', theme_text_light: '#121614',
      theme_primary_light: '#0f6f5c', theme_secondary_light: '#4b5a54', theme_accent_light: '#0b5749',
      theme_success_light: '#1d7146', theme_warning_light: '#775711', theme_danger_light: '#b32f2f',
      theme_glow_color_light: '#0f6f5c', theme_glow_color_2_light: '#4b5a54',
      theme_bg_tint: '12', theme_grain: '3',
      theme_glass_opacity: '0.05', theme_glass_blur: '44', theme_glass_saturation: '195',
      theme_glass_rim: '145', theme_radius: '20', theme_glow_strength: '0.9',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#a5e6d6', theme_smoke_color: '#a9b8b2',
      theme_snow_color: '#e9efec', theme_aurora_color: '#5cc98d',
      theme_header_color: '#7fd4c0',
      theme_shader_color: '#7fd4c0', theme_shader_color_2: '#a9b8b2',
      theme_header_shader_color: '#7fd4c0', theme_header_shader_color_2: '#a9b8b2',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'ink-drift',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'archivo', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * ── The round-edge neutrals ───────────────────────────────────────────
   *
   * Added because the roster had tipped the other way. Counting corners, six
   * of the fifteen built-ins sat at 8px or under and only four at 18 or over,
   * so an operator who wanted a soft room had Porcelain, Carrara and two
   * strongly-coloured looks to choose from — and the two neutrals among those
   * are both cool. "Neutral and round" was effectively one option wearing two
   * names.
   *
   * These three are neutral in the ground and round in the corner, and they
   * differ from each other on the axis that actually separates soft rooms:
   * temperature and material. Alabaster is warm stone under ordinary glass,
   * Driftwood is a grey-green matte with no frost at all, Nimbus is cool and
   * heavily frosted. Nothing here is deleted to make room — a built-in an
   * operator has already applied should not vanish under them on deploy, and
   * every card carries a hide button that tombstones the ones they do not
   * want (see isPresetTombstone).
   *
   * Every colour below was solved against WCAG on its own ground with
   * theme/color.js, targeting the band the existing roster already occupies
   * (~7.6:1 dark, ~6.0:1 light) rather than the 4.5 floor. Do not tune them
   * here by eye.
   */
  alabaster: {
    label: 'Alabaster',
    family: 'quiet',
    description: 'Warm stone and toasted almond, corners thrown soft. Ordinary glass over a warm neutral — the quiet room, in the other temperature.',
    settings: {
      theme_bg: '#1b1917', theme_text: '#efe9de',
      theme_primary: '#cba380', theme_secondary: '#c3a398', theme_accent: '#c9a65e',
      theme_success: '#5cbc89', theme_warning: '#d8a24f', theme_danger: '#e39991',
      theme_glow_color: '#cba380', theme_glow_color_2: '#c3a398',
      theme_bg_light: '#f6f3ec', theme_text_light: '#221d16',
      theme_primary_light: '#7b5432', theme_secondary_light: '#775346', theme_accent_light: '#735926',
      theme_success_light: '#2b6948', theme_warning_light: '#7d561c', theme_danger_light: '#a7362a',
      theme_glow_color_light: '#7b5432', theme_glow_color_2_light: '#775346',
      theme_bg_tint: '8', theme_grain: '10',
      theme_glass_opacity: '0.06', theme_glass_blur: '20', theme_glass_saturation: '150',
      theme_glass_rim: '90', theme_radius: '22', theme_glow_strength: '0.7',
      theme_border_strength: '80', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#c9a65e', theme_smoke_color: '#c3a398',
      theme_snow_color: '#efe9de', theme_aurora_color: '#5cbc89',
      theme_header_color: '#cba380',
      theme_shader_color: '#cba380', theme_shader_color_2: '#c3a398',
      theme_header_shader_color: '#cba380', theme_header_shader_color_2: '#c3a398',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * Weathered wood: grey-green, matte, and the only round preset on the board
   * with no frost at all. Material and Terracotta already prove an opaque
   * surface can work, but both are square-ish — this is what a soft corner
   * looks like on a flat tonal panel, which is a genuinely different room from
   * a soft corner on glass. Grain runs high because the whole look is texture.
   */
  driftwood: {
    label: 'Driftwood',
    family: 'nature',
    description: 'Sun-bleached grey-green on weathered board. Flat tonal panels, soft corners, plenty of tooth — round without the glass.',
    settings: {
      theme_bg: '#1e1f1c', theme_text: '#e9e8e0',
      theme_primary: '#a1b785', theme_secondary: '#baaf97', theme_accent: '#8dbb7c',
      theme_success: '#61c29b', theme_warning: '#d8a664', theme_danger: '#e2a092',
      theme_glow_color: '#a1b785', theme_glow_color_2: '#baaf97',
      theme_bg_light: '#f2f1ec', theme_text_light: '#1f211c',
      theme_primary_light: '#4f6039', theme_secondary_light: '#655b43', theme_accent_light: '#416534',
      theme_success_light: '#28674e', theme_warning_light: '#7a531f', theme_danger_light: '#9d3d2a',
      theme_glow_color_light: '#4f6039', theme_glow_color_2_light: '#655b43',
      theme_bg_tint: '6', theme_grain: '14',
      theme_glass_opacity: '0.07', theme_glass_blur: '0', theme_glass_saturation: '120',
      theme_glass_rim: '55', theme_radius: '20', theme_glow_strength: '0.45',
      theme_border_strength: '95', theme_text_contrast: '110',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#8dbb7c', theme_smoke_color: '#baaf97',
      theme_snow_color: '#e9e8e0', theme_aurora_color: '#61c29b',
      theme_header_color: '#a1b785',
      theme_shader_color: '#a1b785', theme_shader_color_2: '#baaf97',
      theme_header_shader_color: '#a1b785', theme_header_shader_color_2: '#baaf97',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'inter', theme_font_display: 'schibsted', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * The softest thing on the board: the largest radius the scalar allows,
   * heavy frost, cool grey-blue, and the bloom held right back so a room made
   * almost entirely of edges does not turn into a haze. Where Amethyst is
   * heavy glass carrying a strong hue, this is heavy glass carrying almost
   * none — which is the version an operator actually reaches for when they
   * want soft rather than dramatic.
   */
  nimbus: {
    label: 'Nimbus',
    family: 'material',
    description: 'Cloud grey behind deep frost, corners at their softest. Heavy glass with the colour turned down — soft, not dramatic.',
    settings: {
      theme_bg: '#171a20', theme_text: '#e6ebf2',
      theme_primary: '#8daed3', theme_secondary: '#8bb2c1', theme_accent: '#9da9d7',
      theme_success: '#50be96', theme_warning: '#d3a445', theme_danger: '#e5958f',
      theme_glow_color: '#8daed3', theme_glow_color_2: '#8bb2c1',
      theme_bg_light: '#f3f5f8', theme_text_light: '#141922',
      theme_primary_light: '#38618f', theme_secondary_light: '#3d6371', theme_accent_light: '#4458a7',
      theme_success_light: '#276850', theme_warning_light: '#78591c', theme_danger_light: '#a93028',
      theme_glow_color_light: '#38618f', theme_glow_color_2_light: '#3d6371',
      theme_bg_tint: '11', theme_grain: '2',
      theme_glass_opacity: '0.05', theme_glass_blur: '46', theme_glass_saturation: '170',
      theme_glass_rim: '115', theme_radius: '26', theme_glow_strength: '0.6',
      theme_border_strength: '55', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#9da9d7', theme_smoke_color: '#8bb2c1',
      theme_snow_color: '#e6ebf2', theme_aurora_color: '#50be96',
      theme_header_color: '#8daed3',
      theme_shader_color: '#8daed3', theme_shader_color_2: '#8bb2c1',
      theme_header_shader_color: '#8daed3', theme_header_shader_color_2: '#8bb2c1',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'space-grotesk', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * ── The two that are not trying to be quiet ───────────────────────────
   *
   * Both carry real colour in the GROUND, which is the axis the roster keeps
   * collapsing on — there is a test that fails if fewer than three built-in
   * grounds are chromatic, and it exists because eight near-black neutrals
   * each with one bright accent had once been offered as eight choices of
   * room.
   *
   * Solstice runs a violet night against a warm low sun: two hues doing the
   * work rather than one signal on grey, and it starts the aurora, because a
   * look named for the longest night that ships with still air is a look
   * wearing a name it cannot honour.
   */
  solstice: {
    label: 'Solstice',
    family: 'nature',
    description: 'Violet midwinter night with a low amber sun. Starts the aurora — the effect chip says so before you apply it.',
    settings: {
      theme_bg: '#161226', theme_text: '#ece7f5',
      theme_primary: '#ba9adf', theme_secondary: '#d8996e', theme_accent: '#da90c4',
      theme_success: '#3ebb7d', theme_warning: '#cf9e2a', theme_danger: '#e49286',
      theme_glow_color: '#ba9adf', theme_glow_color_2: '#d8996e',
      theme_bg_light: '#f7f4ef', theme_text_light: '#1a1330',
      theme_primary_light: '#793cbe', theme_secondary_light: '#894d24', theme_accent_light: '#9d347d',
      theme_success_light: '#246b47', theme_warning_light: '#775a18', theme_danger_light: '#a73625',
      theme_glow_color_light: '#793cbe', theme_glow_color_2_light: '#894d24',
      theme_bg_tint: '18', theme_grain: '5',
      theme_glass_opacity: '0.05', theme_glass_blur: '32', theme_glass_saturation: '185',
      theme_glass_rim: '110', theme_radius: '18', theme_glow_strength: '1.15',
      theme_border_strength: '90', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'true', effects_header: 'false',
      theme_sparkle_color: '#da90c4', theme_smoke_color: '#d8996e',
      theme_snow_color: '#ece7f5', theme_aurora_color: '#ba9adf',
      theme_header_color: '#da90c4',
      theme_shader_color: '#da90c4', theme_shader_color_2: '#d8996e',
      theme_header_shader_color: '#da90c4', theme_header_shader_color_2: '#d8996e',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'space-grotesk', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * The loudest thing on the board, on purpose. A near-black violet cabinet
   * with magenta and cyan running against each other — three saturated hues
   * sharing the work instead of one accent on grey — the strongest bloom the
   * roster carries, and the header constellation running, which is the one
   * effect that only appears under a pointer and so reads as a machine
   * responding rather than a screensaver.
   *
   * The status trio stays chromatic and far apart despite all that: an arcade
   * cabinet is allowed to be loud, and "out of stock" is not allowed to look
   * like "in stock".
   */
  arcade: {
    label: 'Neon Arcade',
    family: 'machine',
    description: 'Cabinet black, magenta and cyan at full tilt, bloom turned up. Runs the header constellation under the pointer.',
    settings: {
      theme_bg: '#120c1c', theme_text: '#eee6f6',
      theme_primary: '#e977e9', theme_secondary: '#26b5c5', theme_accent: '#ba91e8',
      theme_success: '#2cba60', theme_warning: '#c59c16', theme_danger: '#eb8884',
      theme_glow_color: '#e977e9', theme_glow_color_2: '#26b5c5',
      theme_bg_light: '#f6f2fa', theme_text_light: '#170c22',
      theme_primary_light: '#a21aa2', theme_secondary_light: '#15666f', theme_accent_light: '#7a2bd4',
      theme_success_light: '#196b37', theme_warning_light: '#735b0d', theme_danger_light: '#b4221d',
      theme_glow_color_light: '#a21aa2', theme_glow_color_2_light: '#15666f',
      theme_bg_tint: '22', theme_grain: '4',
      theme_glass_opacity: '0.04', theme_glass_blur: '18', theme_glass_saturation: '210',
      theme_glass_rim: '135', theme_radius: '20', theme_glow_strength: '1.6',
      theme_border_strength: '130', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'true',
      theme_sparkle_color: '#ba91e8', theme_smoke_color: '#26b5c5',
      theme_snow_color: '#eee6f6', theme_aurora_color: '#2cba60',
      theme_header_color: '#26b5c5',
      theme_shader_color: '#26b5c5', theme_shader_color_2: '#26b5c5',
      theme_header_shader_color: '#26b5c5', theme_header_shader_color_2: '#26b5c5',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'warp-field',
      effects_header_shader: 'false', effects_header_shader_name: 'pulse-grid',
      theme_font_ui: 'geist', theme_font_display: 'space-grotesk', theme_font_mono: 'geist-mono',
    },
  },

  /*
   * ── The twenty-eight looks added on 2026-08-29, and the shape of the roster
   *    they complete ────────────────────────────────────────────────────────
   *
   * Twenty-two presets was already past the point where a flat grid of cards
   * is browsable, and fifty is well past it — which is why every preset from
   * here down carries a `family`, and why the gallery groups and filters by
   * it rather than growing a longer wall. The families are not decoration:
   * they are the answer to "what is this look FOR", which is the question the
   * roster exists to answer and the one a swatch cannot.
   *
   * The other thing that changed underneath these is the shader roster. There
   * were five background fields and three header ones; there are twenty and
   * ten now, and a preset is the only place an operator ever meets most of
   * them — nobody browses a chip strip looking for `truchet`. So a majority of
   * the looks below name a field, each chosen because it is the same idea as
   * the palette rather than because it was next in the list: Substrate routes
   * traces because it IS a board, Sandstorm runs dunes and then leaves the sky
   * transparent so the operator's own ground is the sky.
   *
   * Every colour below was solved, not picked. The intent was declared as a
   * hue, a saturation and roughly how light, and `adjustForContrast` pushed it
   * onto its own ground at 4.7:1 in both modes — margin over the 4.5 AA floor,
   * because the floor is where a later rounding change eats the difference.
   * The status trios were checked for the 60-apart guard at the same time. Do
   * not retune any of them here by eye; there is a test that grades all fifty.
   */
  /*
   * A cyanotype is a contact print: white lines where the drawing blocked
   * the light, prussian everywhere else. So the ground carries the colour
   * and the brand colours are the chalk, which inverts the usual
   * arrangement here — the room is the saturated thing and the signals are
   * pale. Barely-rounded corners and a hard edge because a drawing is drawn
   * with a pen, and the contour field behind it is the same idea made
   * continuous.
   */
  blueprint: {
    label: 'Blueprint',
    family: 'print',
    description: 'Cyanotype: prussian ground, chalk line work, survey contours behind the page. For a store selling parts, where the drawing is the product.',
    settings: {
      theme_bg: '#0a1a30', theme_text: '#e4edfa',
      theme_primary: '#73afde', theme_secondary: '#9bacbf', theme_accent: '#8ed2eb',
      theme_success: '#64cea7', theme_warning: '#e4b558', theme_danger: '#ec7765',
      theme_glow_color: '#73afde', theme_glow_color_2: '#9bacbf',
      theme_bg_light: '#eef2f9', theme_text_light: '#0a1a30',
      theme_primary_light: '#17598c', theme_secondary_light: '#3d5571', theme_accent_light: '#0a5d7b',
      theme_success_light: '#13724f', theme_warning_light: '#84540b', theme_danger_light: '#af261d',
      theme_glow_color_light: '#17598c', theme_glow_color_2_light: '#3d5571',
      theme_bg_tint: '16', theme_grain: '9',
      theme_glass_opacity: '0.05', theme_glass_blur: '14', theme_glass_saturation: '140',
      theme_glass_rim: '85', theme_radius: '6', theme_glow_strength: '0.8',
      theme_border_strength: '130', theme_text_contrast: '110',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#8ed2eb', theme_smoke_color: '#9bacbf',
      theme_snow_color: '#e4edfa', theme_aurora_color: '#73afde',
      theme_header_color: '#73afde',
      theme_shader_color: '#73afde', theme_shader_color_2: '#9bacbf',
      theme_header_shader_color: '#9bacbf', theme_header_shader_color_2: '#73afde',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'contours',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'inter', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },
  /*
   * Everything about this look is dry. Still air is not an omission — a
   * shelf of pressed specimens does not move, and any drift over it would
   * be the one thing in the frame contradicting the subject. The heavy
   * grain is the card stock; the greens are separated by temperature rather
   * than by lightness, so sage and moss read as two plants and not as one
   * colour at two brightnesses.
   *
   * The accent used to be a third green while the description promised "one
   * dried-petal red", which is the palette version of a parameter named for
   * something it does not do: the card said the look had a warm signal in it
   * and the look did not. It is a real brick-rose now — and the danger red was
   * pushed brighter and more saturated at the same time, because those two
   * were then 48 apart and an ACCENT that reads as an alarm is worse than no
   * accent at all. They are separated by chroma, not by hue: a pressed petal
   * has lost its saturation and an error has not, which is the difference the
   * eye actually uses here.
   */
  herbarium: {
    label: 'Herbarium',
    family: 'nature',
    description: 'Pressed leaves on cream card: forest ground, sage and moss, one dried-petal red. Still air, soft corners — a shelf of dried things does not move.',
    settings: {
      theme_bg: '#0f1710', theme_text: '#e8eee2',
      theme_primary: '#7dbf86', theme_secondary: '#acb587', theme_accent: '#bc8476',
      theme_success: '#60c790', theme_warning: '#dab662', theme_danger: '#e56166',
      theme_glow_color: '#7dbf86', theme_glow_color_2: '#acb587',
      theme_bg_light: '#f4f2e6', theme_text_light: '#141a10',
      theme_primary_light: '#206529', theme_secondary_light: '#545f25', theme_accent_light: '#7a3929',
      theme_success_light: '#156640', theme_warning_light: '#77500d', theme_danger_light: '#b81e23',
      theme_glow_color_light: '#206529', theme_glow_color_2_light: '#545f25',
      theme_bg_tint: '12', theme_grain: '13',
      theme_glass_opacity: '0.06', theme_glass_blur: '16', theme_glass_saturation: '130',
      theme_glass_rim: '80', theme_radius: '16', theme_glow_strength: '0.75',
      theme_border_strength: '105', theme_text_contrast: '105',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#bc8476', theme_smoke_color: '#acb587',
      theme_snow_color: '#e8eee2', theme_aurora_color: '#7dbf86',
      theme_header_color: '#7dbf86',
      theme_shader_color: '#7dbf86', theme_shader_color_2: '#acb587',
      theme_header_shader_color: '#acb587', theme_header_shader_color_2: '#7dbf86',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * The only look here whose ground goes nearly to black on purpose: a long
   * exposure has no shadow detail, and giving this one a lifted ground
   * would make the starfield sit on grey fog. It runs both scopes, which
   * most presets do not — the field behind the page and a curtain across
   * the bar — because the two are the same photograph at two scales.
   */
  'deep-field': {
    label: 'Deep Field',
    family: 'nature',
    description: 'A long exposure: near-black indigo, star white, a red-shift danger. Runs the starfield behind the page and an aurora across the nav bar.',
    settings: {
      theme_bg: '#06070f', theme_text: '#e9ecf6',
      theme_primary: '#8794e8', theme_secondary: '#b197ce', theme_accent: '#96d0ee',
      theme_success: '#66d6b5', theme_warning: '#e7c35f', theme_danger: '#e8737a',
      theme_glow_color: '#8794e8', theme_glow_color_2: '#b197ce',
      theme_bg_light: '#f2f3f8', theme_text_light: '#0a0c16',
      theme_primary_light: '#2437b2', theme_secondary_light: '#633597', theme_accent_light: '#0a5085',
      theme_success_light: '#106a4f', theme_warning_light: '#7f540b', theme_danger_light: '#b22433',
      theme_glow_color_light: '#2437b2', theme_glow_color_2_light: '#633597',
      theme_bg_tint: '20', theme_grain: '4',
      theme_glass_opacity: '0.04', theme_glass_blur: '24', theme_glass_saturation: '170',
      theme_glass_rim: '110', theme_radius: '20', theme_glow_strength: '1.25',
      theme_border_strength: '85', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#96d0ee', theme_smoke_color: '#b197ce',
      theme_snow_color: '#e9ecf6', theme_aurora_color: '#8794e8',
      theme_header_color: '#8794e8',
      theme_shader_color: '#8794e8', theme_shader_color_2: '#b197ce',
      theme_header_shader_color: '#b197ce', theme_header_shader_color_2: '#8794e8',
      effects_bg_engine: 'webgl2', effects_header_engine: 'webgl2',
      effects_shader: 'true', effects_shader_name: 'warp-field',
      effects_header_shader: 'true', effects_header_shader_name: 'aurora-bar',
      theme_font_ui: 'geist', theme_font_display: 'space-grotesk', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * Zero blur, and that is the whole argument. This is a look made of wood,
   * anodised aluminium and printed silkscreen, none of which is
   * translucent, and a frosted panel would turn a hi-fi front into a phone
   * UI wearing a walnut colour scheme. The level meter belongs to the same
   * object and is the only thing in the room allowed to move.
   */
  'tape-deck': {
    label: 'Tape Deck',
    family: 'machine',
    description: 'Seventies hi-fi: walnut and brushed aluminium, amber VU needles, no frost anywhere. A level meter runs along the nav bar.',
    settings: {
      theme_bg: '#1c150f', theme_text: '#f0e7db',
      theme_primary: '#e4ac58', theme_secondary: '#beac9d', theme_accent: '#edd46e',
      theme_success: '#63c583', theme_warning: '#e0d75c', theme_danger: '#e3756d',
      theme_glow_color: '#e4ac58', theme_glow_color_2: '#beac9d',
      theme_bg_light: '#f4eee3', theme_text_light: '#1c150f',
      theme_primary_light: '#8e4d0b', theme_secondary_light: '#634836', theme_accent_light: '#7e5a07',
      theme_success_light: '#11693a', theme_warning_light: '#746206', theme_danger_light: '#ab2521',
      theme_glow_color_light: '#8e4d0b', theme_glow_color_2_light: '#634836',
      theme_bg_tint: '14', theme_grain: '12',
      theme_glass_opacity: '0.09', theme_glass_blur: '0', theme_glass_saturation: '120',
      theme_glass_rim: '60', theme_radius: '6', theme_glow_strength: '0.85',
      theme_border_strength: '145', theme_text_contrast: '110',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#edd46e', theme_smoke_color: '#beac9d',
      theme_snow_color: '#f0e7db', theme_aurora_color: '#e4ac58',
      theme_header_color: '#e4ac58',
      theme_shader_color: '#e4ac58', theme_shader_color_2: '#beac9d',
      theme_header_shader_color: '#beac9d', theme_header_shader_color_2: '#e4ac58',
      effects_bg_engine: 'canvas', effects_header_engine: 'webgl2',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'true', effects_header_shader_name: 'equalizer',
      theme_font_ui: 'inter', theme_font_display: 'archivo', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * Deliberately unwelcoming. Tight corners, a hard edge at 165%, a wide
   * text ramp and almost no bloom — the design brief is a rack in a cold
   * aisle, not a shop window. The header grid answers a pointer and rests
   * at nothing, which is the right amount of life for a machine somebody
   * administers rather than shops in.
   */
  'cold-storage': {
    label: 'Cold Storage',
    family: 'machine',
    description: 'Steel and frost: hard edges, tight corners, nothing decorative. For an operator whose store is infrastructure, not a shop window.',
    settings: {
      theme_bg: '#0d1114', theme_text: '#e6ecef',
      theme_primary: '#7bc6d5', theme_secondary: '#a2adb9', theme_accent: '#90e0da',
      theme_success: '#64ceae', theme_warning: '#e0c15c', theme_danger: '#e37886',
      theme_glow_color: '#7bc6d5', theme_glow_color_2: '#a2adb9',
      theme_bg_light: '#eff2f4', theme_text_light: '#0d1114',
      theme_primary_light: '#07627e', theme_secondary_light: '#3e5265', theme_accent_light: '#066b6b',
      theme_success_light: '#0d6d4d', theme_warning_light: '#7b5509', theme_danger_light: '#a92339',
      theme_glow_color_light: '#07627e', theme_glow_color_2_light: '#3e5265',
      theme_bg_tint: '8', theme_grain: '5',
      theme_glass_opacity: '0.06', theme_glass_blur: '10', theme_glass_saturation: '115',
      theme_glass_rim: '55', theme_radius: '4', theme_glow_strength: '0.55',
      theme_border_strength: '165', theme_text_contrast: '125',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#90e0da', theme_smoke_color: '#a2adb9',
      theme_snow_color: '#e6ecef', theme_aurora_color: '#7bc6d5',
      theme_header_color: '#7bc6d5',
      theme_shader_color: '#7bc6d5', theme_shader_color_2: '#a2adb9',
      theme_header_shader_color: '#a2adb9', theme_header_shader_color_2: '#7bc6d5',
      effects_bg_engine: 'canvas', effects_header_engine: 'webgl2',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'true', effects_header_shader_name: 'pulse-grid',
      theme_font_ui: 'geist', theme_font_display: 'space-grotesk', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * The heaviest frost outside Glacier, because the look is literally glass
   * with liquid behind it — an amber bottle IS a blurred saturated ground
   * seen through a curved wall. The lamp field is the tincture turning
   * over. Two of the three warm hues are separated by saturation rather
   * than hue so the labels stay legible against the bottles.
   */
  apothecary: {
    label: 'Apothecary',
    family: 'luxury',
    description: 'Amber bottle glass and label cream, with something turning over slowly behind the shelf. Heavy frost, because the whole look is glass with liquid in it.',
    settings: {
      theme_bg: '#151007', theme_text: '#f2e9d8',
      theme_primary: '#e0b05c', theme_secondary: '#c29b84', theme_accent: '#ead77b',
      theme_success: '#60c78d', theme_warning: '#d6da62', theme_danger: '#e26f73',
      theme_glow_color: '#e0b05c', theme_glow_color_2: '#c29b84',
      theme_bg_light: '#f6f0e2', theme_text_light: '#1a1308',
      theme_primary_light: '#884c07', theme_secondary_light: '#733d26', theme_accent_light: '#765705',
      theme_success_light: '#0f663e', theme_warning_light: '#6c6504', theme_danger_light: '#a9232c',
      theme_glow_color_light: '#884c07', theme_glow_color_2_light: '#733d26',
      theme_bg_tint: '20', theme_grain: '8',
      theme_glass_opacity: '0.05', theme_glass_blur: '38', theme_glass_saturation: '195',
      theme_glass_rim: '120', theme_radius: '20', theme_glow_strength: '1.2',
      theme_border_strength: '90', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#ead77b', theme_smoke_color: '#c29b84',
      theme_snow_color: '#f2e9d8', theme_aurora_color: '#e0b05c',
      theme_header_color: '#e0b05c',
      theme_shader_color: '#e0b05c', theme_shader_color_2: '#c29b84',
      theme_header_shader_color: '#c29b84', theme_header_shader_color_2: '#e0b05c',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'lamp',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * A cool room with exactly one warm thing in it, which is the same
   * complementary trick Tidewater uses and the reason both have depth a
   * single-hue palette cannot reach. The rain runs on the glass, not in the
   * air: the drops are on the pane between the viewer and the store, which
   * is why the material is real translucent glass rather than an opaque
   * surface.
   */
  monsoon: {
    label: 'Monsoon',
    family: 'nature',
    description: 'Slate under rain, seen through the window it is running down. Cool ground, one warm lamp, and drops on the glass.',
    settings: {
      theme_bg: '#0e1418', theme_text: '#e3ebee',
      theme_primary: '#82b8ce', theme_secondary: '#9aa6b6', theme_accent: '#deaf73',
      theme_success: '#66ccb1', theme_warning: '#debc5e', theme_danger: '#e3796d',
      theme_glow_color: '#82b8ce', theme_glow_color_2: '#9aa6b6',
      theme_bg_light: '#eef2f4', theme_text_light: '#0e1418',
      theme_primary_light: '#0e5a81', theme_secondary_light: '#3c4f67', theme_accent_light: '#954d0f',
      theme_success_light: '#0f6c50', theme_warning_light: '#7b5209', theme_danger_light: '#ab2a21',
      theme_glow_color_light: '#0e5a81', theme_glow_color_2_light: '#3c4f67',
      theme_bg_tint: '16', theme_grain: '7',
      theme_glass_opacity: '0.05', theme_glass_blur: '28', theme_glass_saturation: '165',
      theme_glass_rim: '105', theme_radius: '18', theme_glow_strength: '1',
      theme_border_strength: '95', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#deaf73', theme_smoke_color: '#9aa6b6',
      theme_snow_color: '#e3ebee', theme_aurora_color: '#82b8ce',
      theme_header_color: '#82b8ce',
      theme_shader_color: '#82b8ce', theme_shader_color_2: '#9aa6b6',
      theme_header_shader_color: '#9aa6b6', theme_header_shader_color_2: '#82b8ce',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'rain-glass',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * The one preset that runs a warm field AND a warm header, and it needs
   * the bloom turned up to 1.35 to do it, because heat is the subject
   * rather than the decoration. Tight corners and a heavy edge keep the
   * cast-iron half honest — without them the orange takes over and it
   * becomes a sunset.
   */
  foundry: {
    label: 'Foundry',
    family: 'machine',
    description: 'Cast iron with something molten still in it: charcoal, orange heat, embers rising and a filament strung across the nav bar.',
    settings: {
      theme_bg: '#131110', theme_text: '#efe8e3',
      theme_primary: '#ed8345', theme_secondary: '#b6a89a', theme_accent: '#f3c15e',
      theme_success: '#60c790', theme_warning: '#e4d158', theme_danger: '#e87382',
      theme_glow_color: '#ed8345', theme_glow_color_2: '#b6a89a',
      theme_bg_light: '#f3efec', theme_text_light: '#131110',
      theme_primary_light: '#a3380a', theme_secondary_light: '#645040', theme_accent_light: '#895006',
      theme_success_light: '#106a3d', theme_warning_light: '#745e06', theme_danger_light: '#ab2138',
      theme_glow_color_light: '#a3380a', theme_glow_color_2_light: '#645040',
      theme_bg_tint: '18', theme_grain: '14',
      theme_glass_opacity: '0.06', theme_glass_blur: '8', theme_glass_saturation: '130',
      theme_glass_rim: '70', theme_radius: '4', theme_glow_strength: '1.35',
      theme_border_strength: '140', theme_text_contrast: '110',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#f3c15e', theme_smoke_color: '#b6a89a',
      theme_snow_color: '#efe8e3', theme_aurora_color: '#ed8345',
      theme_header_color: '#ed8345',
      theme_shader_color: '#ed8345', theme_shader_color_2: '#b6a89a',
      theme_header_shader_color: '#b6a89a', theme_header_shader_color_2: '#ed8345',
      effects_bg_engine: 'webgl2', effects_header_engine: 'webgl2',
      effects_shader: 'true', effects_shader_name: 'embers',
      effects_header_shader: 'true', effects_header_shader_name: 'filament',
      theme_font_ui: 'geist', theme_font_display: 'archivo', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * The highest grain on the board at 18%. That is not texture for its own
   * sake: an old chart is a physical object whose surface you can see, and
   * a perfectly smooth parchment colour reads as a beige rectangle. Still
   * air, because a map does not move, and a low-frost surface because the
   * sheet is opaque.
   */
  cartograph: {
    label: 'Cartograph',
    family: 'print',
    description: 'An old chart: parchment, sepia ink, a compass-rose red. Still air and a heavy grain — this look is paper, and paper has tooth.',
    settings: {
      theme_bg: '#171310', theme_text: '#ece2d2',
      theme_primary: '#cca97b', theme_secondary: '#b4a193', theme_accent: '#d5937b',
      theme_success: '#67c194', theme_warning: '#dabe62', theme_danger: '#dc6e6a',
      theme_glow_color: '#cca97b', theme_glow_color_2: '#b4a193',
      theme_bg_light: '#f4ecdc', theme_text_light: '#1d160f',
      theme_primary_light: '#74471b', theme_secondary_light: '#624837', theme_accent_light: '#90341d',
      theme_success_light: '#12643d', theme_warning_light: '#75520a', theme_danger_light: '#bc2f38',
      theme_glow_color_light: '#74471b', theme_glow_color_2_light: '#624837',
      theme_bg_tint: '10', theme_grain: '18',
      theme_glass_opacity: '0.07', theme_glass_blur: '6', theme_glass_saturation: '118',
      theme_glass_rim: '55', theme_radius: '10', theme_glow_strength: '0.6',
      theme_border_strength: '120', theme_text_contrast: '115',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#d5937b', theme_smoke_color: '#b4a193',
      theme_snow_color: '#ece2d2', theme_aurora_color: '#cca97b',
      theme_header_color: '#cca97b',
      theme_shader_color: '#cca97b', theme_shader_color_2: '#b4a193',
      theme_header_shader_color: '#b4a193', theme_header_shader_color_2: '#cca97b',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },
  /*
   * Three hues carrying the work — gold, plum, jade — rather than one
   * accent on a neutral, which is the failure mode the 2026-08-27 additions
   * were written against. Heavy frost and a 22px corner because the subject
   * is cloth and cloth has no hard edges. Both shader scopes are woven,
   * which is the one case where running two fields is a single idea rather
   * than two.
   */
  'silk-road': {
    label: 'Silk Road',
    family: 'luxury',
    description: 'Plum, gold and jade — three colours doing the work, not one. Woven fibres behind the page and threads across the nav bar that part around the pointer.',
    settings: {
      theme_bg: '#17101a', theme_text: '#f0e7f0',
      theme_primary: '#e5c261', theme_secondary: '#c292c9', theme_accent: '#77cfaf',
      theme_success: '#5ccc94', theme_warning: '#e4a758', theme_danger: '#e7748b',
      theme_glow_color: '#e5c261', theme_glow_color_2: '#c292c9',
      theme_bg_light: '#f6f1f5', theme_text_light: '#1c1120',
      theme_primary_light: '#7f5705', theme_secondary_light: '#7d2e8a', theme_accent_light: '#08684b',
      theme_success_light: '#106a40', theme_warning_light: '#814508', theme_danger_light: '#ab2141',
      theme_glow_color_light: '#7f5705', theme_glow_color_2_light: '#7d2e8a',
      theme_bg_tint: '20', theme_grain: '6',
      theme_glass_opacity: '0.05', theme_glass_blur: '36', theme_glass_saturation: '190',
      theme_glass_rim: '115', theme_radius: '22', theme_glow_strength: '1.2',
      theme_border_strength: '90', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#77cfaf', theme_smoke_color: '#c292c9',
      theme_snow_color: '#f0e7f0', theme_aurora_color: '#e5c261',
      theme_header_color: '#e5c261',
      theme_shader_color: '#e5c261', theme_shader_color_2: '#c292c9',
      theme_header_shader_color: '#c292c9', theme_header_shader_color_2: '#e5c261',
      effects_bg_engine: 'webgl2', effects_header_engine: 'webgl2',
      effects_shader: 'true', effects_shader_name: 'silk',
      effects_header_shader: 'true', effects_header_shader_name: 'threads',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * Built for reading across a room, so it takes the text ramp to 145% and
   * the edge to 175% — the two knobs that were only reachable through a
   * preset before they became editable. Smoke rather than a shader, because
   * the canvas family is the one that runs on a browser with no WebGL2 at
   * all, and a store that needs to be legible in a warehouse should not
   * lose its atmosphere on a locked-down machine.
   */
  flare: {
    label: 'Signal Flare',
    family: 'signal',
    description: 'Safety orange on ink, hard borders, wide text separation. Built for a store where somebody has to see the state of an order across a warehouse.',
    settings: {
      theme_bg: '#0f0f10', theme_text: '#f4f2ee',
      theme_primary: '#f99243', theme_secondary: '#95b6c6', theme_accent: '#fad457',
      theme_success: '#5cd699', theme_warning: '#f1e14b', theme_danger: '#ef6c7e',
      theme_glow_color: '#f99243', theme_glow_color_2: '#95b6c6',
      theme_bg_light: '#f6f5f1', theme_text_light: '#111111',
      theme_primary_light: '#a84105', theme_secondary_light: '#2f5d74', theme_accent_light: '#815704',
      theme_success_light: '#0c6a3e', theme_warning_light: '#765b05', theme_danger_light: '#a91931',
      theme_glow_color_light: '#a84105', theme_glow_color_2_light: '#2f5d74',
      theme_bg_tint: '6', theme_grain: '6',
      theme_glass_opacity: '0.08', theme_glass_blur: '4', theme_glass_saturation: '115',
      theme_glass_rim: '45', theme_radius: '6', theme_glow_strength: '0.7',
      theme_border_strength: '175', theme_text_contrast: '145',
      effects_sparkles: 'false', effects_smoke: 'true',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#fad457', theme_smoke_color: '#95b6c6',
      theme_snow_color: '#f4f2ee', theme_aurora_color: '#f99243',
      theme_header_color: '#f99243',
      theme_shader_color: '#f99243', theme_shader_color_2: '#95b6c6',
      theme_header_shader_color: '#95b6c6', theme_header_shader_color_2: '#f99243',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'archivo', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * Risograph ink sits ON the paper and has no gloss, so the blur is zero
   * and the grain is high. The two spot colours are deliberately unmixable
   * — fluorescent pink and reflex blue do not blend into a third, they
   * overprint — and the halftone field behind the page is the actual
   * reproduction method rather than a decoration referencing it.
   */
  riso: {
    label: 'Riso',
    family: 'print',
    description: 'Two spot inks overprinted on off-white — fluorescent pink and reflex blue — with a real halftone screen behind the page. No frost: risograph has no gloss.',
    settings: {
      theme_bg: '#121016', theme_text: '#f2edf2',
      theme_primary: '#f467ad', theme_secondary: '#7b99ea', theme_accent: '#cf8be4',
      theme_success: '#5cd6a5', theme_warning: '#f2d354', theme_danger: '#ef796c',
      theme_glow_color: '#f467ad', theme_glow_color_2: '#7b99ea',
      theme_bg_light: '#faf7f0', theme_text_light: '#151119',
      theme_primary_light: '#b40e61', theme_secondary_light: '#1440b8', theme_accent_light: '#841fa3',
      theme_success_light: '#0c6e44', theme_warning_light: '#7a5705', theme_danger_light: '#b42318',
      theme_glow_color_light: '#b40e61', theme_glow_color_2_light: '#1440b8',
      theme_bg_tint: '14', theme_grain: '16',
      theme_glass_opacity: '0.09', theme_glass_blur: '0', theme_glass_saturation: '120',
      theme_glass_rim: '40', theme_radius: '12', theme_glow_strength: '0.9',
      theme_border_strength: '135', theme_text_contrast: '105',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#cf8be4', theme_smoke_color: '#7b99ea',
      theme_snow_color: '#f2edf2', theme_aurora_color: '#f467ad',
      theme_header_color: '#f467ad',
      theme_shader_color: '#f467ad', theme_shader_color_2: '#7b99ea',
      theme_header_shader_color: '#7b99ea', theme_header_shader_color_2: '#f467ad',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'halftone',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'space-grotesk', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * The most restrained look here and the hardest to leave alone. Zero
   * radius, zero blur, zero rim, glow at 0.2: everything that makes a
   * surface feel like a material is switched off, so what is left is flat
   * colour, weight and position. Every effect is declared off rather than
   * omitted, which is what stops it inheriting somebody's smoke.
   */
  bauhaus: {
    label: 'Bauhaus',
    family: 'print',
    description: 'Red, blue and yellow on bone, square corners, no frost and no glow. The most deliberately undecorated look here — every effect declared off.',
    settings: {
      theme_bg: '#161514', theme_text: '#f2f0ea',
      theme_primary: '#ec5b51', theme_secondary: '#6aa0e7', theme_accent: '#f8d04f',
      theme_success: '#58d094', theme_warning: '#f1ba4b', theme_danger: '#ed6e7f',
      theme_glow_color: '#ec5b51', theme_glow_color_2: '#6aa0e7',
      theme_bg_light: '#f4f1e8', theme_text_light: '#141310',
      theme_primary_light: '#b01c11', theme_secondary_light: '#0d47ab', theme_accent_light: '#815704',
      theme_success_light: '#0c6a3b', theme_warning_light: '#7f4a05', theme_danger_light: '#a91931',
      theme_glow_color_light: '#b01c11', theme_glow_color_2_light: '#0d47ab',
      theme_bg_tint: '0', theme_grain: '4',
      theme_glass_opacity: '0.10', theme_glass_blur: '0', theme_glass_saturation: '100',
      theme_glass_rim: '0', theme_radius: '0', theme_glow_strength: '0.2',
      theme_border_strength: '160', theme_text_contrast: '115',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#f8d04f', theme_smoke_color: '#6aa0e7',
      theme_snow_color: '#f2f0ea', theme_aurora_color: '#ec5b51',
      theme_header_color: '#ec5b51',
      theme_shader_color: '#ec5b51', theme_shader_color_2: '#6aa0e7',
      theme_header_shader_color: '#6aa0e7', theme_header_shader_color_2: '#ec5b51',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'inter', theme_font_display: 'archivo', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * Dim on purpose. The ground is the darkest coloured one on the board and
   * the palette is nearly monochrome cyan, so the status trio is the only
   * chromatic information on a page — which is exactly right for a look
   * whose premise is that there is almost no light. The caustics come from
   * above, because that is where the surface is.
   */
  submarine: {
    label: 'Submarine',
    family: 'nature',
    description: 'Below the light: abyss blue, one sonar green, caustics moving overhead. Dim on purpose, and the only bright thing in the room is the state of an order.',
    settings: {
      theme_bg: '#07131a', theme_text: '#dde9ee',
      theme_primary: '#5ed4c4', theme_secondary: '#83a4b9', theme_accent: '#6fe2b0',
      theme_success: '#51d68f', theme_warning: '#e4c358', theme_danger: '#e76a72',
      theme_glow_color: '#5ed4c4', theme_glow_color_2: '#83a4b9',
      theme_bg_light: '#eaf1f4', theme_text_light: '#07131a',
      theme_primary_light: '#066b6b', theme_secondary_light: '#325267', theme_accent_light: '#086845',
      theme_success_light: '#0d6838', theme_warning_light: '#785208', theme_danger_light: '#ab212f',
      theme_glow_color_light: '#066b6b', theme_glow_color_2_light: '#325267',
      theme_bg_tint: '24', theme_grain: '6',
      theme_glass_opacity: '0.05', theme_glass_blur: '30', theme_glass_saturation: '175',
      theme_glass_rim: '100', theme_radius: '18', theme_glow_strength: '1.1',
      theme_border_strength: '90', theme_text_contrast: '105',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#6fe2b0', theme_smoke_color: '#83a4b9',
      theme_snow_color: '#dde9ee', theme_aurora_color: '#5ed4c4',
      theme_header_color: '#5ed4c4',
      theme_shader_color: '#5ed4c4', theme_shader_color_2: '#83a4b9',
      theme_header_shader_color: '#83a4b9', theme_header_shader_color_2: '#5ed4c4',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'caustics',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'space-grotesk', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * Bokeh needs somewhere to be out of focus, so this carries real
   * translucency and a generous corner: the panels are the thing in focus
   * and the field behind them is not. The warm/pink pair is a street of lit
   * stalls rather than one lamp, which is why the secondary is chromatic
   * instead of the usual neutral steel.
   */
  'night-market': {
    label: 'Night Market',
    family: 'luxury',
    description: 'Warm lanterns out of focus down a dark street. Soft corners, generous frost, and the bokeh field drifting up behind the page.',
    settings: {
      theme_bg: '#150f0d', theme_text: '#f2e9e2',
      theme_primary: '#e7965f', theme_secondary: '#d18995', theme_accent: '#f0c86a',
      theme_success: '#5ec997', theme_warning: '#e4cd58', theme_danger: '#e7726a',
      theme_glow_color: '#e7965f', theme_glow_color_2: '#d18995',
      theme_bg_light: '#f7f1ec', theme_text_light: '#191110',
      theme_primary_light: '#993a0a', theme_secondary_light: '#9d253d', theme_accent_light: '#7f4e05',
      theme_success_light: '#106a40', theme_warning_light: '#745706', theme_danger_light: '#ad231f',
      theme_glow_color_light: '#993a0a', theme_glow_color_2_light: '#9d253d',
      theme_bg_tint: '22', theme_grain: '7',
      theme_glass_opacity: '0.05', theme_glass_blur: '26', theme_glass_saturation: '185',
      theme_glass_rim: '115', theme_radius: '22', theme_glow_strength: '1.3',
      theme_border_strength: '85', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#f0c86a', theme_smoke_color: '#d18995',
      theme_snow_color: '#f2e9e2', theme_aurora_color: '#e7965f',
      theme_header_color: '#e7965f',
      theme_shader_color: '#e7965f', theme_shader_color_2: '#d18995',
      theme_header_shader_color: '#d18995', theme_header_shader_color_2: '#e7965f',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'bokeh',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * Glow at exactly 0 and an edge at 190%, which together are the strongest
   * statement the material system can make: no bloom anywhere, every panel
   * a drawn rectangle. It exists as the honest opposite of Liquid Glass,
   * and as the thing to reach for when an operator says the store looks
   * like every other store.
   */
  brutalist: {
    label: 'Brutalist',
    family: 'quiet',
    description: 'Poured concrete: square, unfrosted, unglowing, framed hard. Nothing in this look is trying to be pleasant, which is exactly the point of it.',
    settings: {
      theme_bg: '#232323', theme_text: '#eeeeec',
      theme_primary: '#bfb8b0', theme_secondary: '#a7adb4', theme_accent: '#d4d1ce',
      theme_success: '#65c38e', theme_warning: '#debc5e', theme_danger: '#de7a73',
      theme_glow_color: '#bfb8b0', theme_glow_color_2: '#a7adb4',
      theme_bg_light: '#e9e8e4', theme_text_light: '#151514',
      theme_primary_light: '#49423c', theme_secondary_light: '#48525b', theme_accent_light: '#312e2b',
      theme_success_light: '#106038', theme_warning_light: '#724f09', theme_danger_light: '#a12521',
      theme_glow_color_light: '#49423c', theme_glow_color_2_light: '#48525b',
      theme_bg_tint: '0', theme_grain: '15',
      theme_glass_opacity: '0.12', theme_glass_blur: '0', theme_glass_saturation: '100',
      theme_glass_rim: '0', theme_radius: '0', theme_glow_strength: '0',
      theme_border_strength: '190', theme_text_contrast: '130',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#d4d1ce', theme_smoke_color: '#a7adb4',
      theme_snow_color: '#eeeeec', theme_aurora_color: '#bfb8b0',
      theme_header_color: '#bfb8b0',
      theme_shader_color: '#bfb8b0', theme_shader_color_2: '#a7adb4',
      theme_header_shader_color: '#a7adb4', theme_header_shader_color_2: '#bfb8b0',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'inter', theme_font_display: 'archivo', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * Warm all the way through, including the ink — the text colour is
   * brown-black rather than neutral, because a manuscript has no true black
   * in it. Light frost rather than none: vellum is translucent, which is
   * the one physical property that separates it from paper and the reason
   * this is not simply Cartograph in another colour.
   */
  vellum: {
    label: 'Vellum',
    family: 'print',
    description: 'A manuscript: cream stock, oxblood rubrication, gilt initials. Warm, quiet, and lightly frosted — the look for a store whose catalogue reads as a document.',
    settings: {
      theme_bg: '#191512', theme_text: '#f0e8db',
      theme_primary: '#d0796c', theme_secondary: '#bdac93', theme_accent: '#e3c46d',
      theme_success: '#65c391', theme_warning: '#dac662', theme_danger: '#e26f7b',
      theme_glow_color: '#d0796c', theme_glow_color_2: '#bdac93',
      theme_bg_light: '#f7f1e4', theme_text_light: '#1d1710',
      theme_primary_light: '#89221a', theme_secondary_light: '#675032', theme_accent_light: '#795306',
      theme_success_light: '#10653b', theme_warning_light: '#735607', theme_danger_light: '#ab2133',
      theme_glow_color_light: '#89221a', theme_glow_color_2_light: '#675032',
      theme_bg_tint: '12', theme_grain: '14',
      theme_glass_opacity: '0.06', theme_glass_blur: '12', theme_glass_saturation: '128',
      theme_glass_rim: '70', theme_radius: '14', theme_glow_strength: '0.75',
      theme_border_strength: '110', theme_text_contrast: '110',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#e3c46d', theme_smoke_color: '#bdac93',
      theme_snow_color: '#f0e8db', theme_aurora_color: '#d0796c',
      theme_header_color: '#d0796c',
      theme_shader_color: '#d0796c', theme_shader_color_2: '#bdac93',
      theme_header_shader_color: '#bdac93', theme_header_shader_color_2: '#d0796c',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * The heaviest glass on the board at 50, past Amethyst, and the palette
   * is deliberately thin so there is something for that much frost to do.
   * Ice is not blue because it is dyed blue; it is blue because thick ice
   * absorbs red, so the saturation rises with depth — which is why the
   * vividness runs at 205 rather than the palette carrying more chroma.
   */
  glacier: {
    label: 'Glacier',
    family: 'material',
    description: 'Ice: the heaviest frost on the board over a cold ground, with a crystal fracture moving behind it. Material first — this look IS its glass.',
    settings: {
      theme_bg: '#0c141a', theme_text: '#e4eef4',
      theme_primary: '#83cfe2', theme_secondary: '#9cafc9', theme_accent: '#9ee5e1',
      theme_success: '#68d4b4', theme_warning: '#e3c563', theme_danger: '#e57685',
      theme_glow_color: '#83cfe2', theme_glow_color_2: '#9cafc9',
      theme_bg_light: '#eff5f8', theme_text_light: '#0c141a',
      theme_primary_light: '#075e7e', theme_secondary_light: '#374e6c', theme_accent_light: '#066b6b',
      theme_success_light: '#0d6d4d', theme_warning_light: '#7b5509', theme_danger_light: '#a92339',
      theme_glow_color_light: '#075e7e', theme_glow_color_2_light: '#374e6c',
      theme_bg_tint: '22', theme_grain: '3',
      theme_glass_opacity: '0.04', theme_glass_blur: '50', theme_glass_saturation: '205',
      theme_glass_rim: '135', theme_radius: '24', theme_glow_strength: '1.15',
      theme_border_strength: '80', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#9ee5e1', theme_smoke_color: '#9cafc9',
      theme_snow_color: '#e4eef4', theme_aurora_color: '#83cfe2',
      theme_header_color: '#83cfe2',
      theme_shader_color: '#83cfe2', theme_shader_color_2: '#9cafc9',
      theme_header_shader_color: '#9cafc9', theme_header_shader_color_2: '#83cfe2',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'crystal',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'schibsted', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * The one look that goes to a near-true-black ground, and the bloom at
   * 1.4 is what stops that reading as a dead screen. Two-pixel corners and
   * a 4px blur: a terminal has no material. The falling stream is the
   * field, and the store it suits is one reached over an address nobody
   * typed from memory.
   */
  cipher: {
    label: 'Cipher',
    family: 'machine',
    description: 'Acid green on true black with the stream falling behind it. The loudest of the terminal looks, and the one that most obviously belongs to an onion address.',
    settings: {
      theme_bg: '#050705', theme_text: '#dcf0dc',
      theme_primary: '#50e268', theme_secondary: '#9ebb81', theme_accent: '#6eedad',
      theme_success: '#5ad884', theme_warning: '#ecd751', theme_danger: '#ea6674',
      theme_glow_color: '#50e268', theme_glow_color_2: '#9ebb81',
      theme_bg_light: '#f1f4f0', theme_text_light: '#050705',
      theme_primary_light: '#08681b', theme_secondary_light: '#425f25', theme_accent_light: '#056133',
      theme_success_light: '#0c6a2e', theme_warning_light: '#765b05', theme_danger_light: '#ab1c2f',
      theme_glow_color_light: '#08681b', theme_glow_color_2_light: '#425f25',
      theme_bg_tint: '12', theme_grain: '11',
      theme_glass_opacity: '0.05', theme_glass_blur: '4', theme_glass_saturation: '110',
      theme_glass_rim: '40', theme_radius: '2', theme_glow_strength: '1.4',
      theme_border_strength: '130', theme_text_contrast: '115',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#6eedad', theme_smoke_color: '#9ebb81',
      theme_snow_color: '#dcf0dc', theme_aurora_color: '#50e268',
      theme_header_color: '#50e268',
      theme_shader_color: '#50e268', theme_shader_color_2: '#9ebb81',
      theme_header_shader_color: '#9ebb81', theme_header_shader_color_2: '#50e268',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'datastream',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'space-grotesk', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * Light-first in spirit even though both modes are solved: the putty
   * ground and blue key are a console, and a console was a beige object
   * under fluorescent light. Zero blur, 2px corners, mono in the type
   * stack. The nav-bar ticker is where a status line used to live, which is
   * the only reason it is allowed to move.
   */
  mainframe: {
    label: 'Mainframe',
    family: 'machine',
    description: 'Putty panels and a blue key: the console look, mono-forward, flat and tight. A ticker runs along the nav bar the way a status line used to.',
    settings: {
      theme_bg: '#1a1a17', theme_text: '#eeece2',
      theme_primary: '#73a1de', theme_secondary: '#b9b0a2', theme_accent: '#8ec5e1',
      theme_success: '#5ec994', theme_warning: '#e0bd5c', theme_danger: '#e36d75',
      theme_glow_color: '#73a1de', theme_glow_color_2: '#b9b0a2',
      theme_bg_light: '#eeebe0', theme_text_light: '#1a1a17',
      theme_primary_light: '#0c48a1', theme_secondary_light: '#5a4b35', theme_accent_light: '#064f79',
      theme_success_light: '#0f663b', theme_warning_light: '#785208', theme_danger_light: '#a7202d',
      theme_glow_color_light: '#0c48a1', theme_glow_color_2_light: '#5a4b35',
      theme_bg_tint: '6', theme_grain: '8',
      theme_glass_opacity: '0.10', theme_glass_blur: '0', theme_glass_saturation: '105',
      theme_glass_rim: '35', theme_radius: '2', theme_glow_strength: '0.5',
      theme_border_strength: '150', theme_text_contrast: '120',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#8ec5e1', theme_smoke_color: '#b9b0a2',
      theme_snow_color: '#eeece2', theme_aurora_color: '#73a1de',
      theme_header_color: '#73a1de',
      theme_shader_color: '#73a1de', theme_shader_color_2: '#b9b0a2',
      theme_header_shader_color: '#b9b0a2', theme_header_shader_color_2: '#73a1de',
      effects_bg_engine: 'canvas', effects_header_engine: 'webgl2',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'true', effects_header_shader_name: 'ticker',
      theme_font_ui: 'inter', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },
  /*
   * Green over green with one bark-orange accent, and the shafts entering
   * from off the top corner rather than radiating from a visible sun — a
   * sun disc would be a bright object the catalogue then has to sit next
   * to. The ground is dark enough that the beams are the brightest thing in
   * the room, which is what late light through trees actually looks like.
   */
  sequoia: {
    label: 'Sequoia',
    family: 'nature',
    description: 'Late light through tall trees: green-black ground, bark orange, and shafts coming in from off the top corner.',
    settings: {
      theme_bg: '#0c120e', theme_text: '#e5ece4',
      theme_primary: '#75c793', theme_secondary: '#a0b691', theme_accent: '#e2a16f',
      theme_success: '#58d098', theme_warning: '#e2be5a', theme_danger: '#d4545c',
      theme_glow_color: '#75c793', theme_glow_color_2: '#a0b691',
      theme_bg_light: '#eff3ed', theme_text_light: '#0c120e',
      theme_primary_light: '#0d6330', theme_secondary_light: '#43602f', theme_accent_light: '#983f0b',
      theme_success_light: '#0d683e', theme_warning_light: '#784f08', theme_danger_light: '#ab2a21',
      theme_glow_color_light: '#0d6330', theme_glow_color_2_light: '#43602f',
      theme_bg_tint: '18', theme_grain: '9',
      theme_glass_opacity: '0.05', theme_glass_blur: '24', theme_glass_saturation: '160',
      theme_glass_rim: '100', theme_radius: '18', theme_glow_strength: '1.1',
      theme_border_strength: '95', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#e2a16f', theme_smoke_color: '#a0b691',
      theme_snow_color: '#e5ece4', theme_aurora_color: '#75c793',
      theme_header_color: '#75c793',
      theme_shader_color: '#75c793', theme_shader_color_2: '#a0b691',
      theme_header_shader_color: '#a0b691', theme_header_shader_color_2: '#75c793',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'shafts',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * Architectural rather than atmospheric: the field behind the page is a
   * floor pattern, not weather. The largest corner radius on the board at
   * 26 pairs with the arcs, and the pointer wake on the nav bar is the same
   * geometry answering a person — which is the whole difference between a
   * building and a photograph of one.
   */
  atrium: {
    label: 'Atrium',
    family: 'material',
    description: 'Pale stone and a patterned floor: the Truchet maze behind the page, ripples leaving the pointer on the nav bar. Architectural rather than atmospheric.',
    settings: {
      theme_bg: '#14161a', theme_text: '#e9eaee',
      theme_primary: '#98aacd', theme_secondary: '#bead9d', theme_accent: '#a8c5dc',
      theme_success: '#66cca3', theme_warning: '#e0b85c', theme_danger: '#e37882',
      theme_glow_color: '#98aacd', theme_glow_color_2: '#bead9d',
      theme_bg_light: '#f2f2f0', theme_text_light: '#14161a',
      theme_primary_light: '#2a4884', theme_secondary_light: '#634d36', theme_accent_light: '#144e7b',
      theme_success_light: '#106a43', theme_warning_light: '#7b5209', theme_danger_light: '#a92335',
      theme_glow_color_light: '#2a4884', theme_glow_color_2_light: '#634d36',
      theme_bg_tint: '10', theme_grain: '6',
      theme_glass_opacity: '0.05', theme_glass_blur: '20', theme_glass_saturation: '150',
      theme_glass_rim: '95', theme_radius: '26', theme_glow_strength: '0.85',
      theme_border_strength: '95', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#a8c5dc', theme_smoke_color: '#bead9d',
      theme_snow_color: '#e9eaee', theme_aurora_color: '#98aacd',
      theme_header_color: '#98aacd',
      theme_shader_color: '#98aacd', theme_shader_color_2: '#bead9d',
      theme_header_shader_color: '#bead9d', theme_header_shader_color_2: '#98aacd',
      effects_bg_engine: 'webgl2', effects_header_engine: 'webgl2',
      effects_shader: 'true', effects_shader_name: 'truchet',
      effects_header_shader: 'true', effects_header_shader_name: 'wake',
      theme_font_ui: 'instrument', theme_font_display: 'archivo', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * Almost nothing, by design. This is the look for a store whose
   * photographs are the content, so the palette is nearly achromatic, the
   * bloom is low, and both fields are the two quietest in their rosters — a
   * four-point wash with no edges and a sun that takes minutes to cross.
   * The status trio stays fully chromatic, because 'nearly no colour' must
   * never reach the part that carries meaning.
   */
  'salt-flat': {
    label: 'Salt Flat',
    family: 'quiet',
    description: 'A gallery wall: almost no colour, almost no motion, a four-point wash and a sun crossing the nav bar over minutes. For a store whose photographs are the content.',
    settings: {
      theme_bg: '#191a1a', theme_text: '#f0f0ee',
      theme_primary: '#abbcc4', theme_secondary: '#bab3ab', theme_accent: '#bfd0d9',
      theme_success: '#63c594', theme_warning: '#dcbb60', theme_danger: '#de737a',
      theme_glow_color: '#abbcc4', theme_glow_color_2: '#bab3ab',
      theme_bg_light: '#fafaf8', theme_text_light: '#161717',
      theme_primary_light: '#375462', theme_secondary_light: '#574d42', theme_accent_light: '#254556',
      theme_success_light: '#10653b', theme_warning_light: '#775209', theme_danger_light: '#a32431',
      theme_glow_color_light: '#375462', theme_glow_color_2_light: '#574d42',
      theme_bg_tint: '8', theme_grain: '5',
      theme_glass_opacity: '0.05', theme_glass_blur: '18', theme_glass_saturation: '135',
      theme_glass_rim: '75', theme_radius: '20', theme_glow_strength: '0.6',
      theme_border_strength: '85', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#bfd0d9', theme_smoke_color: '#bab3ab',
      theme_snow_color: '#f0f0ee', theme_aurora_color: '#abbcc4',
      theme_header_color: '#abbcc4',
      theme_shader_color: '#abbcc4', theme_shader_color_2: '#bab3ab',
      theme_header_shader_color: '#bab3ab', theme_header_shader_color_2: '#abbcc4',
      effects_bg_engine: 'webgl2', effects_header_engine: 'webgl2',
      effects_shader: 'true', effects_shader_name: 'mesh-wash',
      effects_header_shader: 'true', effects_header_shader_name: 'horizon',
      theme_font_ui: 'hanken', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },
  /*
   * Gold in the fractures, not gold everywhere: the primary is the repair
   * and the ground is the vessel, which is why the secondary is a
   * near-neutral warm and does almost nothing. Ink drift behind the page
   * draws the veins, and it is the one existing field whose shape — a
   * bright filament where the noise crosses its own mean — is already the
   * subject.
   */
  kintsugi: {
    label: 'Kintsugi',
    family: 'luxury',
    description: 'Charcoal ceramic repaired in gold: a dark body, gold in the fractures, and the ink-drift veins moving slowly behind the page.',
    settings: {
      theme_bg: '#131212', theme_text: '#eeeae4',
      theme_primary: '#e8c054', theme_secondary: '#b6a49a', theme_accent: '#e2bc83',
      theme_success: '#60c794', theme_warning: '#e2d95a', theme_danger: '#e36d7d',
      theme_glow_color: '#e8c054', theme_glow_color_2: '#b6a49a',
      theme_bg_light: '#f4f2ee', theme_text_light: '#131212',
      theme_primary_light: '#7a5305', theme_secondary_light: '#5f463a', theme_accent_light: '#8a510f',
      theme_success_light: '#0f663b', theme_warning_light: '#6f5e06', theme_danger_light: '#a72036',
      theme_glow_color_light: '#7a5305', theme_glow_color_2_light: '#5f463a',
      theme_bg_tint: '14', theme_grain: '10',
      theme_glass_opacity: '0.06', theme_glass_blur: '20', theme_glass_saturation: '150',
      theme_glass_rim: '100', theme_radius: '20', theme_glow_strength: '1.05',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#e2bc83', theme_smoke_color: '#b6a49a',
      theme_snow_color: '#eeeae4', theme_aurora_color: '#e8c054',
      theme_header_color: '#e8c054',
      theme_shader_color: '#e8c054', theme_shader_color_2: '#b6a49a',
      theme_header_shader_color: '#b6a49a', theme_header_shader_color_2: '#e8c054',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'ink-drift',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * Solder mask and immersion gold, which is a real two-colour system
   * rather than a chosen pairing. Low frost and a 4px corner because a
   * board is a flat rigid object. The circuit field is the same object
   * continued behind the page, and its pulse hops cell to cell rather than
   * sweeping, so it reads as signalling rather than as a progress bar.
   */
  substrate: {
    label: 'Substrate',
    family: 'machine',
    description: 'Solder mask green and gold pads, with routed traces carrying a charge behind the page. For a store that ships hardware and wants to say so.',
    settings: {
      theme_bg: '#0a120c', theme_text: '#e2ece4',
      theme_primary: '#64ce99', theme_secondary: '#d3b973', theme_accent: '#7cdec8',
      theme_success: '#56d28c', theme_warning: '#e6d356', theme_danger: '#e76a7b',
      theme_glow_color: '#64ce99', theme_glow_color_2: '#d3b973',
      theme_bg_light: '#eef3ef', theme_text_light: '#0a120c',
      theme_primary_light: '#0b653b', theme_secondary_light: '#80590a', theme_accent_light: '#096351',
      theme_success_light: '#0d6832', theme_warning_light: '#745e06', theme_danger_light: '#a91e35',
      theme_glow_color_light: '#0b653b', theme_glow_color_2_light: '#80590a',
      theme_bg_tint: '12', theme_grain: '8',
      theme_glass_opacity: '0.06', theme_glass_blur: '6', theme_glass_saturation: '125',
      theme_glass_rim: '55', theme_radius: '4', theme_glow_strength: '1',
      theme_border_strength: '135', theme_text_contrast: '110',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#7cdec8', theme_smoke_color: '#d3b973',
      theme_snow_color: '#e2ece4', theme_aurora_color: '#64ce99',
      theme_header_color: '#64ce99',
      theme_shader_color: '#64ce99', theme_shader_color_2: '#d3b973',
      theme_header_shader_color: '#d3b973', theme_header_shader_color_2: '#64ce99',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'circuit',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'space-grotesk', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * Everything rounded: a 22px corner, soft frost, no hard edge anywhere,
   * because there is no straight line in the subject and a square panel
   * would fight the lattice behind it. The wave lights whole cells, which
   * is what makes the field read as a structure being traversed rather than
   * as a gradient passing over a texture.
   */
  honeycomb: {
    label: 'Honeycomb',
    family: 'nature',
    description: 'Wax and honey: warm amber over a hex lattice that lights whole cells as a wave crosses it. Round corners, soft frost, nothing sharp anywhere.',
    settings: {
      theme_bg: '#171208', theme_text: '#f1e9d6',
      theme_primary: '#eabc53', theme_secondary: '#c2a78e', theme_accent: '#f0de6a',
      theme_success: '#5ec98d', theme_warning: '#d6de5e', theme_danger: '#e36d71',
      theme_glow_color: '#eabc53', theme_glow_color_2: '#c2a78e',
      theme_bg_light: '#f7f0dd', theme_text_light: '#1a1408',
      theme_primary_light: '#7f5305', theme_secondary_light: '#6e482b', theme_accent_light: '#725804',
      theme_success_light: '#0f663b', theme_warning_light: '#676404', theme_danger_light: '#ab212a',
      theme_glow_color_light: '#7f5305', theme_glow_color_2_light: '#6e482b',
      theme_bg_tint: '20', theme_grain: '9',
      theme_glass_opacity: '0.05', theme_glass_blur: '18', theme_glass_saturation: '170',
      theme_glass_rim: '105', theme_radius: '22', theme_glow_strength: '1.15',
      theme_border_strength: '90', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#f0de6a', theme_smoke_color: '#c2a78e',
      theme_snow_color: '#f1e9d6', theme_aurora_color: '#eabc53',
      theme_header_color: '#eabc53',
      theme_shader_color: '#eabc53', theme_shader_color_2: '#c2a78e',
      theme_header_shader_color: '#c2a78e', theme_header_shader_color_2: '#eabc53',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'hexcells',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * Heavy glass and complete stillness together, which no other preset does
   * — the others that frost this hard all run a field. The point is a room
   * that is obviously expensive and obviously not doing anything to get
   * your attention. Burgundy and brass rather than black and gold, because
   * black and gold is the version of this that looks like a casino.
   */
  'velvet-rope': {
    label: 'Velvet Rope',
    family: 'luxury',
    description: 'Burgundy and brass under heavy glass, and completely still. The look for a store that wants to feel closed to the public even while it is open.',
    settings: {
      theme_bg: '#160b0e', theme_text: '#f1e4e5',
      theme_primary: '#d9788e', theme_secondary: '#d5b77b', theme_accent: '#d798b8',
      theme_success: '#60c794', theme_warning: '#e2c25a', theme_danger: '#ea8171',
      theme_glow_color: '#d9788e', theme_glow_color_2: '#d5b77b',
      theme_bg_light: '#f7eff0', theme_text_light: '#1a0c10',
      theme_primary_light: '#951835', theme_secondary_light: '#7d5208', theme_accent_light: '#8f285c',
      theme_success_light: '#0f663b', theme_warning_light: '#785608', theme_danger_light: '#ab2a1c',
      theme_glow_color_light: '#951835', theme_glow_color_2_light: '#7d5208',
      theme_bg_tint: '24', theme_grain: '5',
      theme_glass_opacity: '0.05', theme_glass_blur: '44', theme_glass_saturation: '200',
      theme_glass_rim: '125', theme_radius: '24', theme_glow_strength: '1.2',
      theme_border_strength: '85', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#d798b8', theme_smoke_color: '#d5b77b',
      theme_snow_color: '#f1e4e5', theme_aurora_color: '#d9788e',
      theme_header_color: '#d9788e',
      theme_shader_color: '#d9788e', theme_shader_color_2: '#d5b77b',
      theme_header_shader_color: '#d5b77b', theme_header_shader_color_2: '#d9788e',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'schibsted', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * The horizon is left transparent, so the sky in this look is whatever
   * the operator set their background to — which makes it the one field on
   * the board that genuinely composes WITH the palette rather than over it.
   * Medium frost and a 12px corner: warm, but not soft enough to lose the
   * ridge lines the whole effect is built on.
   */
  sandstorm: {
    label: 'Sandstorm',
    family: 'nature',
    description: 'Ochre dunes running toward the viewer under a sky the operator owns. Warm ground, low frost, and the horizon left to the background colour.',
    settings: {
      theme_bg: '#1c1710', theme_text: '#f0e8d9',
      theme_primary: '#d7ad70', theme_secondary: '#bba495', theme_accent: '#de9d7c',
      theme_success: '#63c594', theme_warning: '#decd5e', theme_danger: '#d65c64',
      theme_glow_color: '#d7ad70', theme_glow_color_2: '#bba495',
      theme_bg_light: '#f5eede', theme_text_light: '#1c1710',
      theme_primary_light: '#814b0e', theme_secondary_light: '#654634', theme_accent_light: '#993815',
      theme_success_light: '#10653d', theme_warning_light: '#745b06', theme_danger_light: '#a5222f',
      theme_glow_color_light: '#814b0e', theme_glow_color_2_light: '#654634',
      theme_bg_tint: '16', theme_grain: '12',
      theme_glass_opacity: '0.06', theme_glass_blur: '12', theme_glass_saturation: '140',
      theme_glass_rim: '75', theme_radius: '12', theme_glow_strength: '0.9',
      theme_border_strength: '110', theme_text_contrast: '105',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#de9d7c', theme_smoke_color: '#bba495',
      theme_snow_color: '#f0e8d9', theme_aurora_color: '#d7ad70',
      theme_header_color: '#d7ad70',
      theme_shader_color: '#d7ad70', theme_shader_color_2: '#bba495',
      theme_header_shader_color: '#bba495', theme_header_shader_color_2: '#d7ad70',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'dunes',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },

  /*
   * ── The fourteen sourced from trending palettes, 2026-08-29 ─────────────
   *
   * The previous fifty were designed from the inside: a subject, then a
   * palette that serves it. These start from the other end — real palettes
   * people are actually picking right now — and the interesting part was
   * measuring the roster against them rather than admiring them.
   *
   * Two findings, one of which was the opposite of the expected answer:
   *
   * - **Chroma was fine.** The assumption going in was that these fifty were
   *   too muted next to what is trending. They are not: mean brand-trio chroma
   *   here is 86.7 against 85.1 across 166 trending palettes. That critique was
   *   wrong and no preset was "brightened" on the strength of it.
   * - **Rose was a genuine hole.** Binning every saturated swatch by hue, pink
   *   and magenta (300°–360°) are about 17% of the trending set and were under
   *   5% of this roster — a whole quarter of the wheel the fifty could not
   *   reach. Four of the fourteen below are there for that reason, and they are
   *   four different structures rather than four pinks.
   * - **Half of what is trending is light-first**, against two of the fifty.
   *   Several below are drawn light-first and say so.
   *
   * ── What a five-swatch palette cannot give you ──────────────────────────
   *
   * A trending palette is five colours chosen to look good in a row. A
   * storefront needs eleven, and three of them mean "in stock", "pending" and
   * "gone" — so they must be tellable apart at a glance, which almost none of
   * these sources can supply because most are one mood swept across five
   * steps. The ground and the brand trio come from the source; the status trio
   * is supplied at the source's own saturation and checked for the 60-apart
   * guard, and Harbour is called out below as the rare exception that already
   * contained one.
   *
   * ── The guard this exercise added ───────────────────────────────────────
   *
   * The shipped test checks that success, warning and danger are 60 apart from
   * each other. It cannot see the failure that actually kept happening: an
   * ACCENT that reads as the danger state. Herbarium shipped promising "one
   * dried-petal red" with three greens in it, and Terrace's coral landed 40
   * from its own alarm. Both are fixed, and the generator now refuses any
   * preset whose accent is within 60 of its danger, in either mode.
   *
   * Every source palette is recorded on its preset so the provenance is not
   * folklore.
   */
  /*
   * Sourced from the trending peach-to-plum ramp, and drawn light-first:
   * the source is five tints of one warm sweep with no dark member at all,
   * so the pale mode is the faithful one and the graphite ground is the
   * derived half. What makes it a ramp rather than a palette is that every
   * step shares a hue and loses saturation as it darkens — the plum at the
   * end is the peach at the start, cooled. Bokeh behind the page because
   * out-of-focus warm lights are the same photograph.
   *
   * Source palette: #ffcdb2 #ffb4a2 #e5989b #b5838d #6d6875
   */
  'blush-hour': {
    label: 'Blush Hour',
    family: 'luxury',
    description: 'Peach through rose to plum — one warm sweep, five steps. Drawn light-first, with defocused lights drifting behind the page.',
    settings: {
      theme_bg: '#191315', theme_text: '#f7e9e3',
      theme_primary: '#e5989b', theme_secondary: '#b5838d', theme_accent: '#ffb4a2',
      theme_success: '#68ca9c', theme_warning: '#deb35e', theme_danger: '#e87773',
      theme_glow_color: '#e5989b', theme_glow_color_2: '#b5838d',
      theme_bg_light: '#fbf1ec', theme_text_light: '#2c2024',
      theme_primary_light: '#88626a', theme_secondary_light: '#6d6875', theme_accent_light: '#905f61',
      theme_success_light: '#116940', theme_warning_light: '#7d4e08', theme_danger_light: '#ad1f28',
      theme_glow_color_light: '#88626a', theme_glow_color_2_light: '#6d6875',
      theme_bg_tint: '18', theme_grain: '8',
      theme_glass_opacity: '0.05', theme_glass_blur: '28', theme_glass_saturation: '180',
      theme_glass_rim: '110', theme_radius: '22', theme_glow_strength: '1.1',
      theme_border_strength: '85', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#ffb4a2', theme_smoke_color: '#b5838d',
      theme_snow_color: '#f7e9e3', theme_aurora_color: '#e5989b',
      theme_header_color: '#e5989b',
      theme_shader_color: '#e5989b', theme_shader_color_2: '#b5838d',
      theme_header_shader_color: '#b5838d', theme_header_shader_color_2: '#e5989b',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'bokeh',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * Measured against the trending set, rose was the roster's one real hole:
   * pink and magenta are about seventeen per cent of the saturated swatches
   * out there and were under four per cent of ours, which is a whole
   * quarter of the wheel the fifty presets could not reach. This is the
   * plainest possible answer — one pink at five strengths, still air,
   * ordinary glass. The secondary is deliberately NOT from the source: five
   * tints of one hue leave nothing to be a second voice, so a cool
   * plum-grey stands in and the pink stays the only chromatic thing on the
   * page.
   *
   * Source palette: #ffe5ec #ffc2d1 #ffb3c6 #ff8fab #fb6f92
   */
  rosewater: {
    label: 'Rosewater',
    family: 'quiet',
    description: 'One pink at five strengths on near-white. The plainest look here, and the one that fills the roster’s biggest hue gap.',
    settings: {
      theme_bg: '#171014', theme_text: '#f9e9ee',
      theme_primary: '#ff8fab', theme_secondary: '#b9a2ad', theme_accent: '#ffb3c6',
      theme_success: '#66cca0', theme_warning: '#e0b85c', theme_danger: '#e8686c',
      theme_glow_color: '#ff8fab', theme_glow_color_2: '#b9a2ad',
      theme_bg_light: '#fff5f8', theme_text_light: '#2a1620',
      theme_primary_light: '#b24e67', theme_secondary_light: '#654957', theme_accent_light: '#a05a6c',
      theme_success_light: '#106a40', theme_warning_light: '#7d5208', theme_danger_light: '#af1d26',
      theme_glow_color_light: '#b24e67', theme_glow_color_2_light: '#654957',
      theme_bg_tint: '14', theme_grain: '6',
      theme_glass_opacity: '0.05', theme_glass_blur: '18', theme_glass_saturation: '150',
      theme_glass_rim: '90', theme_radius: '20', theme_glow_strength: '0.85',
      theme_border_strength: '90', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#ffb3c6', theme_smoke_color: '#b9a2ad',
      theme_snow_color: '#f9e9ee', theme_aurora_color: '#ff8fab',
      theme_header_color: '#ff8fab',
      theme_shader_color: '#ff8fab', theme_shader_color_2: '#b9a2ad',
      theme_header_shader_color: '#b9a2ad', theme_header_shader_color_2: '#ff8fab',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * The source runs plum-navy to blush across five steps, and unusually for
   * a trending palette it has BOTH ends — a real dark and a real near-white
   * — so this is the one here that needs no invented ground in either mode.
   * The hue rotates as it lightens, navy through mauve to warm blush, which
   * is what stops it reading as a tint ramp: the light end is a different
   * temperature from the dark end rather than the same colour with the
   * contrast turned down.
   *
   * Source palette: #22223b #4a4e69 #9a8c98 #c9ada7 #f2e9e4
   */
  heirloom: {
    label: 'Heirloom',
    family: 'quiet',
    description: 'Plum-navy through mauve to blush. The rare source palette that ships its own dark ground and its own paper.',
    settings: {
      theme_bg: '#1a1a2e', theme_text: '#f2e9e4',
      theme_primary: '#c9ada7', theme_secondary: '#9a8c98', theme_accent: '#ddc5bb',
      theme_success: '#70cda1', theme_warning: '#e0bb67', theme_danger: '#e7747c',
      theme_glow_color: '#c9ada7', theme_glow_color_2: '#9a8c98',
      theme_bg_light: '#f2e9e4', theme_text_light: '#22223b',
      theme_primary_light: '#4a4e69', theme_secondary_light: '#685045', theme_accent_light: '#22223b',
      theme_success_light: '#116940', theme_warning_light: '#7b5209', theme_danger_light: '#ab212f',
      theme_glow_color_light: '#4a4e69', theme_glow_color_2_light: '#685045',
      theme_bg_tint: '16', theme_grain: '9',
      theme_glass_opacity: '0.06', theme_glass_blur: '20', theme_glass_saturation: '145',
      theme_glass_rim: '90', theme_radius: '18', theme_glow_strength: '0.8',
      theme_border_strength: '100', theme_text_contrast: '105',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#ddc5bb', theme_smoke_color: '#9a8c98',
      theme_snow_color: '#f2e9e4', theme_aurora_color: '#c9ada7',
      theme_header_color: '#c9ada7',
      theme_shader_color: '#c9ada7', theme_shader_color_2: '#9a8c98',
      theme_header_shader_color: '#9a8c98', theme_header_shader_color_2: '#c9ada7',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },
  /*
   * Four steps of crimson into pink and then, at the end, a pale mint that
   * belongs to none of them. That last swatch is the entire palette:
   * without it this is a monochrome red study, and with it the reds become
   * a warm mass with one cold thing sitting against them. It is also the
   * hardest brief for the status trio, because the brand is already
   * occupying red — so danger is pushed hot and orange-ward while the
   * primary stays on the pink side of crimson, and they are 90-odd apart
   * rather than the 60 the guard requires.
   *
   * Source palette: #880d1e #dd2d4a #f26a8d #f49cbb #cbeef3
   */
  bougainvillea: {
    label: 'Bougainvillea',
    family: 'luxury',
    description: 'Crimson through pink against one cold mint. Four warm steps and a single cool one, which is what stops it being a red study.',
    settings: {
      theme_bg: '#1b0a10', theme_text: '#f9e7eb',
      theme_primary: '#f26a8d', theme_secondary: '#cbeef3', theme_accent: '#f49cbb',
      theme_success: '#64cea4', theme_warning: '#e4bf58', theme_danger: '#ee6e4f',
      theme_glow_color: '#f26a8d', theme_glow_color_2: '#cbeef3',
      theme_bg_light: '#fdf1f4', theme_text_light: '#2a0a12',
      theme_primary_light: '#ce2a45', theme_secondary_light: '#19606b', theme_accent_light: '#880d1e',
      theme_success_light: '#0f6c47', theme_warning_light: '#795306', theme_danger_light: '#a72511',
      theme_glow_color_light: '#ce2a45', theme_glow_color_2_light: '#19606b',
      theme_bg_tint: '22', theme_grain: '6',
      theme_glass_opacity: '0.05', theme_glass_blur: '34', theme_glass_saturation: '190',
      theme_glass_rim: '115', theme_radius: '22', theme_glow_strength: '1.25',
      theme_border_strength: '90', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#f49cbb', theme_smoke_color: '#cbeef3',
      theme_snow_color: '#f9e7eb', theme_aurora_color: '#f26a8d',
      theme_header_color: '#f26a8d',
      theme_shader_color: '#f26a8d', theme_shader_color_2: '#cbeef3',
      theme_header_shader_color: '#cbeef3', theme_header_shader_color_2: '#f26a8d',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'silk',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * The source is five neutrals and nothing else — no signal anywhere in it
   * — which is exactly why it is worth taking. A poster can be five warm
   * greys; a storefront cannot, because something has to say which button
   * submits and which line is a total. So the deepest taupe is pushed until
   * it is a colour rather than a shade, and the status trio carries every
   * bit of chroma on the page. That distribution is the look: a room with
   * no accent, and meaning wherever meaning is genuinely needed.
   *
   * Source palette: #edede9 #d6ccc2 #f5ebe0 #e3d5ca #d5bdaf
   */
  sandbar: {
    label: 'Sandbar',
    family: 'quiet',
    description: 'Five warm neutrals and no accent at all — the signal is pushed into the status colours, where meaning actually lives.',
    settings: {
      theme_bg: '#1d1a17', theme_text: '#f0eae2',
      theme_primary: '#c6a995', theme_secondary: '#bcb3a9', theme_accent: '#dcc0b2',
      theme_success: '#64ce9d', theme_warning: '#e2b95a', theme_danger: '#e56c74',
      theme_glow_color: '#c6a995', theme_glow_color_2: '#bcb3a9',
      theme_bg_light: '#f5ebe0', theme_text_light: '#2b211a',
      theme_primary_light: '#674732', theme_secondary_light: '#5f5245', theme_accent_light: '#573523',
      theme_success_light: '#0f663e', theme_warning_light: '#784f08', theme_danger_light: '#a91e2c',
      theme_glow_color_light: '#674732', theme_glow_color_2_light: '#5f5245',
      theme_bg_tint: '10', theme_grain: '12',
      theme_glass_opacity: '0.06', theme_glass_blur: '14', theme_glass_saturation: '130',
      theme_glass_rim: '70', theme_radius: '16', theme_glow_strength: '0.6',
      theme_border_strength: '100', theme_text_contrast: '110',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#dcc0b2', theme_smoke_color: '#bcb3a9',
      theme_snow_color: '#f0eae2', theme_aurora_color: '#c6a995',
      theme_header_color: '#c6a995',
      theme_shader_color: '#c6a995', theme_shader_color_2: '#bcb3a9',
      theme_header_shader_color: '#bcb3a9', theme_header_shader_color_2: '#c6a995',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },
  /*
   * Two olives, a cream and two rusts — the temperature split Herbarium
   * deliberately does not have. Herbarium is three greens on a dark ground
   * and stays a study; this puts the warm pair against them and gets a
   * landscape instead. Light-first, because the cream in the source is a
   * page rather than a highlight and demoting it to an accent throws away
   * the palette's centre. Dunes behind it: the same rolling ground the
   * colours describe.
   *
   * Source palette: #606c38 #283618 #fefae0 #dda15e #bc6c25
   */
  sagebrush: {
    label: 'Sagebrush',
    family: 'nature',
    description: 'Olive and rust against cream — the warm/cool split done properly. Light-first, with a dune field receding behind the page.',
    settings: {
      theme_bg: '#141a10', theme_text: '#f2f0dc',
      theme_primary: '#7e885e', theme_secondary: '#dda15e', theme_accent: '#be712c',
      theme_success: '#64ce99', theme_warning: '#e2cb5a', theme_danger: '#e56c70',
      theme_glow_color: '#7e885e', theme_glow_color_2: '#dda15e',
      theme_bg_light: '#fefae0', theme_text_light: '#232f16',
      theme_primary_light: '#606c38', theme_secondary_light: '#a45e20', theme_accent_light: '#283618',
      theme_success_light: '#0e673b', theme_warning_light: '#765705', theme_danger_light: '#a91e27',
      theme_glow_color_light: '#606c38', theme_glow_color_2_light: '#a45e20',
      theme_bg_tint: '14', theme_grain: '12',
      theme_glass_opacity: '0.06', theme_glass_blur: '12', theme_glass_saturation: '140',
      theme_glass_rim: '75', theme_radius: '14', theme_glow_strength: '0.8',
      theme_border_strength: '110', theme_text_contrast: '105',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#be712c', theme_smoke_color: '#dda15e',
      theme_snow_color: '#f2f0dc', theme_aurora_color: '#7e885e',
      theme_header_color: '#7e885e',
      theme_shader_color: '#7e885e', theme_shader_color_2: '#dda15e',
      theme_header_shader_color: '#dda15e', theme_header_shader_color_2: '#7e885e',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'dunes',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },
  /*
   * A split complement with a white in the middle of it, which is the
   * arrangement that makes orange and teal legible against each other
   * instead of vibrating. Filed under signal rather than nature for that
   * reason: two hues this far apart, at this saturation, with a hard white
   * between them, is the most separable pair on the board — an operator can
   * tell an orange state from a teal one across a room. The edge and the
   * text ramp are pushed up to match.
   *
   * Source palette: #ff9f1c #ffbf69 #ffffff #cbf3f0 #2ec4b6
   */
  citrus: {
    label: 'Citrus',
    family: 'signal',
    description: 'Orange against teal with a white between them. The most separable pair here, for a store whose states get read at a distance.',
    settings: {
      theme_bg: '#0f1413', theme_text: '#eefaf8',
      theme_primary: '#2ec4b6', theme_secondary: '#ff9f1c', theme_accent: '#cbf3f0',
      theme_success: '#58d08c', theme_warning: '#eccd51', theme_danger: '#ea666f',
      theme_glow_color: '#2ec4b6', theme_glow_color_2: '#ff9f1c',
      theme_bg_light: '#fbfdfc', theme_text_light: '#10201e',
      theme_primary_light: '#1e7f76', theme_secondary_light: '#a16412', theme_accent_light: '#056161',
      theme_success_light: '#0c6a34', theme_warning_light: '#765405', theme_danger_light: '#ad1a29',
      theme_glow_color_light: '#1e7f76', theme_glow_color_2_light: '#a16412',
      theme_bg_tint: '10', theme_grain: '6',
      theme_glass_opacity: '0.07', theme_glass_blur: '10', theme_glass_saturation: '135',
      theme_glass_rim: '60', theme_radius: '10', theme_glow_strength: '0.85',
      theme_border_strength: '150', theme_text_contrast: '130',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#cbf3f0', theme_smoke_color: '#ff9f1c',
      theme_snow_color: '#eefaf8', theme_aurora_color: '#2ec4b6',
      theme_header_color: '#2ec4b6',
      theme_shader_color: '#2ec4b6', theme_shader_color_2: '#ff9f1c',
      theme_header_shader_color: '#ff9f1c', theme_header_shader_color_2: '#2ec4b6',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'caustics',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'archivo', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * Five pastels that cross from lavender through pink to sky, which is a
   * hue journey of about two hundred degrees at a saturation low enough
   * that none of them shouts. It is the hardest kind of palette to make
   * work on a dark ground — pastels ARE their lightness, and darkening one
   * leaves a muddy mid-tone — so the light mode is the real one and the
   * dark mode keeps the tints and lets the ground do the work instead. The
   * mesh wash behind it is the only field quiet enough not to fight five
   * soft colours.
   *
   * Source palette: #cdb4db #ffc8dd #ffafcc #bde0fe #a2d2ff
   */
  periwinkle: {
    label: 'Periwinkle',
    family: 'quiet',
    description: 'Lavender through pink to sky, all pastel. Light-first, over the softest field on the board.',
    settings: {
      theme_bg: '#16131c', theme_text: '#f0ebf6',
      theme_primary: '#a2d2ff', theme_secondary: '#cdb4db', theme_accent: '#ffafcc',
      theme_success: '#6ecfa5', theme_warning: '#e2c065', theme_danger: '#e77480',
      theme_glow_color: '#a2d2ff', theme_glow_color_2: '#cdb4db',
      theme_bg_light: '#f8f6fb', theme_text_light: '#241d2e',
      theme_primary_light: '#235895', theme_secondary_light: '#673b7d', theme_accent_light: '#972b56',
      theme_success_light: '#106a40', theme_warning_light: '#7d5208', theme_danger_light: '#b02134',
      theme_glow_color_light: '#235895', theme_glow_color_2_light: '#673b7d',
      theme_bg_tint: '18', theme_grain: '5',
      theme_glass_opacity: '0.05', theme_glass_blur: '24', theme_glass_saturation: '165',
      theme_glass_rim: '100', theme_radius: '24', theme_glow_strength: '0.9',
      theme_border_strength: '85', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#ffafcc', theme_smoke_color: '#cdb4db',
      theme_snow_color: '#f0ebf6', theme_aurora_color: '#a2d2ff',
      theme_header_color: '#a2d2ff',
      theme_shader_color: '#a2d2ff', theme_shader_color_2: '#cdb4db',
      theme_header_shader_color: '#cdb4db', theme_header_shader_color_2: '#a2d2ff',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'mesh-wash',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * A single hue at five lightnesses, which is a structure none of the
   * other sixty-three presets uses: every one of them separates its brand
   * roles by HUE, and this one separates them only by depth. That changes
   * what the page can say — primary, secondary and accent stop being three
   * voices and become one voice at three distances — so the entire
   * chromatic budget moves to the status trio, and 'in stock' is the only
   * coloured thing on a product row. The contour field behind it is the
   * same idea drawn: a depth chart is a contour map.
   *
   * Source palette: #0d1b2a #1b263b #415a77 #778da9 #e0e1dd
   */
  'depth-chart': {
    label: 'Depth Chart',
    family: 'quiet',
    description: 'One navy at five depths — the only brand trio here separated by lightness rather than hue. All the colour goes to the status states.',
    settings: {
      theme_bg: '#0d1b2a', theme_text: '#e0e1dd',
      theme_primary: '#778da9', theme_secondary: '#74879c', theme_accent: '#b9c7d4',
      theme_success: '#60d2a4', theme_warning: '#e4bf58', theme_danger: '#e76a72',
      theme_glow_color: '#778da9', theme_glow_color_2: '#74879c',
      theme_bg_light: '#eef0f2', theme_text_light: '#0d1b2a',
      theme_primary_light: '#415a77', theme_secondary_light: '#1b263b', theme_accent_light: '#1b4774',
      theme_success_light: '#0d6844', theme_warning_light: '#785208', theme_danger_light: '#ad1f2d',
      theme_glow_color_light: '#415a77', theme_glow_color_2_light: '#1b263b',
      theme_bg_tint: '14', theme_grain: '7',
      theme_glass_opacity: '0.06', theme_glass_blur: '16', theme_glass_saturation: '135',
      theme_glass_rim: '80', theme_radius: '8', theme_glow_strength: '0.7',
      theme_border_strength: '120', theme_text_contrast: '115',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#b9c7d4', theme_smoke_color: '#74879c',
      theme_snow_color: '#e0e1dd', theme_aurora_color: '#778da9',
      theme_header_color: '#778da9',
      theme_shader_color: '#778da9', theme_shader_color_2: '#74879c',
      theme_header_shader_color: '#74879c', theme_header_shader_color_2: '#778da9',
      effects_bg_engine: 'webgl2', effects_header_engine: 'webgl2',
      effects_shader: 'true', effects_shader_name: 'contours',
      effects_header_shader: 'true', effects_header_shader_name: 'horizon',
      theme_font_ui: 'inter', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },
  /*
   * The green counterpart to Depth Chart, and the pair is worth having
   * because a tonal ramp behaves differently at each end of the wheel: the
   * navy ramp reads as distance, and this one — where the hue drifts from
   * grey-green toward slate as it darkens — reads as damp. Still air on
   * purpose. A ramp has no focal point, so anything moving behind it
   * becomes the focal point, and the room stops being the subject.
   *
   * Source palette: #cad2c5 #84a98c #52796f #354f52 #2f3e46
   */
  wintergreen: {
    label: 'Wintergreen',
    family: 'nature',
    description: 'Grey-green cooling to slate across five steps. A tonal ramp like Depth Chart, but damp rather than deep — and completely still.',
    settings: {
      theme_bg: '#1e2a27', theme_text: '#e7ede7',
      theme_primary: '#84a98c', theme_secondary: '#cad2c5', theme_accent: '#a2cdc3',
      theme_success: '#60d286', theme_warning: '#e4bf58', theme_danger: '#e7747c',
      theme_glow_color: '#84a98c', theme_glow_color_2: '#cad2c5',
      theme_bg_light: '#eef1ec', theme_text_light: '#22302c',
      theme_primary_light: '#4d7168', theme_secondary_light: '#354f52', theme_accent_light: '#206555',
      theme_success_light: '#0e672c', theme_warning_light: '#785208', theme_danger_light: '#ab212f',
      theme_glow_color_light: '#4d7168', theme_glow_color_2_light: '#354f52',
      theme_bg_tint: '16', theme_grain: '10',
      theme_glass_opacity: '0.06', theme_glass_blur: '22', theme_glass_saturation: '140',
      theme_glass_rim: '85', theme_radius: '20', theme_glow_strength: '0.7',
      theme_border_strength: '100', theme_text_contrast: '105',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#a2cdc3', theme_smoke_color: '#cad2c5',
      theme_snow_color: '#e7ede7', theme_aurora_color: '#84a98c',
      theme_header_color: '#84a98c',
      theme_shader_color: '#84a98c', theme_shader_color_2: '#cad2c5',
      theme_header_shader_color: '#cad2c5', theme_header_shader_color_2: '#84a98c',
      effects_bg_engine: 'canvas', effects_header_engine: 'canvas',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'instrument', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * Five saturated hues at even spacing and nearly equal lightness — no
   * ground, no neutral, nothing to rest on. It is the opposite of a tonal
   * ramp and the opposite of everything else on this board, and it only
   * works because the ground is supplied from outside the palette and kept
   * nearly black. The accent is the violet rather than the yellow on
   * purpose: the yellow sits where the warning does, and a brand colour
   * that looks like a state is the failure the status guard cannot catch.
   *
   * Source palette: #ffbe0b #fb5607 #ff006e #8338ec #3a86ff
   */
  poster: {
    label: 'Poster',
    family: 'print',
    description: 'Five saturated hues, evenly spaced, on a ground the palette does not supply. Screen-printed rather than lit.',
    settings: {
      theme_bg: '#121118', theme_text: '#f4f2f7',
      theme_primary: '#ff006e', theme_secondary: '#3a86ff', theme_accent: '#9b5ff0',
      theme_success: '#51d694', theme_warning: '#f3cc49', theme_danger: '#f1674b',
      theme_glow_color: '#ff006e', theme_glow_color_2: '#3a86ff',
      theme_bg_light: '#fbfaf7', theme_text_light: '#16141a',
      theme_primary_light: '#de0060', theme_secondary_light: '#306ed1', theme_accent_light: '#8338ec',
      theme_success_light: '#0b6b3b', theme_warning_light: '#775404', theme_danger_light: '#ab220d',
      theme_glow_color_light: '#de0060', theme_glow_color_2_light: '#306ed1',
      theme_bg_tint: '12', theme_grain: '14',
      theme_glass_opacity: '0.08', theme_glass_blur: '0', theme_glass_saturation: '120',
      theme_glass_rim: '40', theme_radius: '4', theme_glow_strength: '1.15',
      theme_border_strength: '140', theme_text_contrast: '105',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#9b5ff0', theme_smoke_color: '#3a86ff',
      theme_snow_color: '#f4f2f7', theme_aurora_color: '#ff006e',
      theme_header_color: '#ff006e',
      theme_shader_color: '#ff006e', theme_shader_color_2: '#3a86ff',
      theme_header_shader_color: '#3a86ff', theme_header_shader_color_2: '#ff006e',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'halftone',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'space-grotesk', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * Probably the most-used palette on the internet, and it earns it: a cool
   * anchor, a green-teal, a sand and two corals, which is a complete
   * warm-to-cool run with a ground included. The danger red had to be
   * pushed cool and pink-ward, because the palette's own coral already sits
   * where an alarm normally goes and an ACCENT that reads as an error is
   * worse than no accent. Tidewater is the roster's other teal-and-rust
   * look and stays a two-colour idea on a slate ground — this is the
   * five-colour version where the sand in the middle is what lets the coral
   * and the teal sit next to each other. Quiet header, no field: a palette
   * this complete does not need help.
   *
   * Source palette: #264653 #2a9d8f #e9c46a #f4a261 #e76f51
   */
  terrace: {
    label: 'Terrace',
    family: 'nature',
    description: 'Teal, sand and coral — a full warm-to-cool run with its own ground. The five-colour answer to Tidewater’s two.',
    settings: {
      theme_bg: '#132329', theme_text: '#e8eff0',
      theme_primary: '#2a9d8f', theme_secondary: '#e9c46a', theme_accent: '#e76f51',
      theme_success: '#5ace7d', theme_warning: '#e6d356', theme_danger: '#ee527b',
      theme_glow_color: '#2a9d8f', theme_glow_color_2: '#e9c46a',
      theme_bg_light: '#f2f5f4', theme_text_light: '#16262c',
      theme_primary_light: '#21796f', theme_secondary_light: '#7f6b3a', theme_accent_light: '#ac533c',
      theme_success_light: '#0e6729', theme_warning_light: '#765b05', theme_danger_light: '#a5123a',
      theme_glow_color_light: '#21796f', theme_glow_color_2_light: '#7f6b3a',
      theme_bg_tint: '16', theme_grain: '8',
      theme_glass_opacity: '0.06', theme_glass_blur: '20', theme_glass_saturation: '155',
      theme_glass_rim: '90', theme_radius: '18', theme_glow_strength: '0.95',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#e76f51', theme_smoke_color: '#e9c46a',
      theme_snow_color: '#e8eff0', theme_aurora_color: '#2a9d8f',
      theme_header_color: '#2a9d8f',
      theme_shader_color: '#2a9d8f', theme_shader_color_2: '#e9c46a',
      theme_header_shader_color: '#e9c46a', theme_header_shader_color_2: '#2a9d8f',
      effects_bg_engine: 'canvas', effects_header_engine: 'webgl2',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'true', effects_header_shader_name: 'aurora-bar',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  /*
   * Navy, signal red, two ambers and a cream — a working palette rather
   * than a decorative one, which is why it lands in machine. Almost
   * uniquely among the sources it already CONTAINS a usable status trio, so
   * the amber becomes the warning and the red becomes the danger rather
   * than both being invented; the green is the only thing that had to be
   * supplied. Body text is the cream, not a white, because the palette's
   * own paper is warmer than any neutral would be. A ticker on the nav bar:
   * a harbour has a departures board.
   *
   * Source palette: #003049 #d62828 #f77f00 #fcbf49 #eae2b7
   */
  harbour: {
    label: 'Harbour',
    family: 'machine',
    description: 'Navy, signal red, amber and cream — one of the few sources that already contains a usable status trio. Departures board on the nav bar.',
    settings: {
      theme_bg: '#071824', theme_text: '#ece6cf',
      theme_primary: '#fcbf49', theme_secondary: '#89b7d1', theme_accent: '#f77f00',
      theme_success: '#58d098', theme_warning: '#fcbf49', theme_danger: '#de5454',
      theme_glow_color: '#fcbf49', theme_glow_color_2: '#89b7d1',
      theme_bg_light: '#f4f6f8', theme_text_light: '#002333',
      theme_primary_light: '#003049', theme_secondary_light: '#1c6087', theme_accent_light: '#aa5800',
      theme_success_light: '#0d683e', theme_warning_light: '#815b04', theme_danger_light: '#d32828',
      theme_glow_color_light: '#003049', theme_glow_color_2_light: '#1c6087',
      theme_bg_tint: '12', theme_grain: '9',
      theme_glass_opacity: '0.07', theme_glass_blur: '8', theme_glass_saturation: '125',
      theme_glass_rim: '60', theme_radius: '6', theme_glow_strength: '0.8',
      theme_border_strength: '140', theme_text_contrast: '115',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#f77f00', theme_smoke_color: '#89b7d1',
      theme_snow_color: '#ece6cf', theme_aurora_color: '#fcbf49',
      theme_header_color: '#fcbf49',
      theme_shader_color: '#fcbf49', theme_shader_color_2: '#89b7d1',
      theme_header_shader_color: '#89b7d1', theme_header_shader_color_2: '#fcbf49',
      effects_bg_engine: 'canvas', effects_header_engine: 'webgl2',
      effects_shader: 'false', effects_shader_name: 'aurora-veil',
      effects_header_shader: 'true', effects_header_shader_name: 'ticker',
      theme_font_ui: 'inter', theme_font_display: 'archivo', theme_font_mono: 'jetbrains',
    },
  },
  /*
   * The source's second swatch is a near-pure blue so dark it cannot be a
   * brand colour on a dark ground and cannot be a ground either — it is a
   * pigment, and it behaves like one. So it is the LIGHT mode's primary,
   * where a deep saturated blue on near-white is exactly what ultramarine
   * on gesso looks like, and the dark mode uses the two lifted blues
   * instead. Heavy glass and a large radius: this is filed under material
   * because the point is a deep colour seen through a thick surface, and
   * the ink-drift veins behind it are the pigment being ground.
   *
   * Source palette: #3c3744 #090c9b #3066be #b4c5e4 #fbfff1
   */
  ultramarine: {
    label: 'Ultramarine',
    family: 'material',
    description: 'True ultramarine on a barely-green white, under heavy glass. The pigment is the light mode’s primary; the dark mode uses the lifted blues.',
    settings: {
      theme_bg: '#101018', theme_text: '#f4f6ee',
      theme_primary: '#517fc8', theme_secondary: '#b4c5e4', theme_accent: '#8ba6e4',
      theme_success: '#62d0a4', theme_warning: '#e4bf58', theme_danger: '#e76a72',
      theme_glow_color: '#517fc8', theme_glow_color_2: '#b4c5e4',
      theme_bg_light: '#fbfff1', theme_text_light: '#14131a',
      theme_primary_light: '#090c9b', theme_secondary_light: '#3c3744', theme_accent_light: '#3066be',
      theme_success_light: '#0d6844', theme_warning_light: '#795306', theme_danger_light: '#ad1f2d',
      theme_glow_color_light: '#090c9b', theme_glow_color_2_light: '#3c3744',
      theme_bg_tint: '20', theme_grain: '4',
      theme_glass_opacity: '0.04', theme_glass_blur: '42', theme_glass_saturation: '195',
      theme_glass_rim: '125', theme_radius: '24', theme_glow_strength: '1.15',
      theme_border_strength: '80', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#8ba6e4', theme_smoke_color: '#b4c5e4',
      theme_snow_color: '#f4f6ee', theme_aurora_color: '#517fc8',
      theme_header_color: '#517fc8',
      theme_shader_color: '#517fc8', theme_shader_color_2: '#b4c5e4',
      theme_header_shader_color: '#b4c5e4', theme_header_shader_color_2: '#517fc8',
      effects_bg_engine: 'webgl2', effects_header_engine: 'canvas',
      effects_shader: 'true', effects_shader_name: 'ink-drift',
      effects_header_shader: 'false', effects_header_shader_name: 'ribbon',
      theme_font_ui: 'geist', theme_font_display: 'schibsted', theme_font_mono: 'geist-mono',
    },
  },
  /*
   * ── The seasonal five (2026-09-09) ──────────────────────────────────────
   *
   * New Year, Christmas, Halloween, Lunar New Year, Easter. The first looks on
   * this board that a store is expected to take OFF again, which changes two
   * things about how they are built.
   *
   * **Each one declares the whole look, effects included.** That matters more
   * here than anywhere else on the roster: a seasonal preset is applied over
   * whatever the shop was wearing and removed a month later by applying
   * something else, so any key it leaves undeclared is a piece of December
   * still sitting in the store in February. All five state their canvas
   * effects OFF explicitly for the same reason.
   *
   * **Each one owns a background field and a header strip that exist for it.**
   * Ten new shaders in components/effects/shaders.js — fireworks over champagne
   * fizz, a garland over icicles, wisps over something dripping, lanterns over
   * blossom, dye and craquelure under bunting. A holiday palette on a field
   * borrowed from another look is a recoloured shop; the field is the part that
   * says what day it is.
   *
   * They are deliberately not five versions of one idea, and the axis they
   * vary on is the material as much as the palette: Lunar New Year is the
   * deepest polish here (44 blur, 195 vividness, lacquer), Halloween the
   * hardest and driest (18 blur, 10px corners, the most grain on the board),
   * Easter the roundest at 24 and the only one of the five solved for light
   * mode first. Their grounds run navy, spruce, bruise, lacquer red and warm
   * eggshell — no two of them are the same near-black, which is the trap the
   * roster fell into once already and has a test against it.
   *
   * Every colour below was solved against WCAG at 4.7:1 on its own ground, in
   * both modes, with theme/color.js. The worst of the fifty is 4.71:1. Do not
   * hand-tune them here by eye.
   */
  'new-year': {
    label: "New Year's Day",
    family: 'seasonal',
    description: "Midnight navy under champagne and cold silver, in the heaviest glass on the board. Ships with shells going up over the catalogue and champagne rising through the navbar.",
    settings: {
      theme_bg: '#0b0e1c', theme_text: '#eef1fa',
      theme_primary: '#e8c77a', theme_secondary: '#9fb4d8', theme_accent: '#f3dca6',
      theme_success: '#5fd0a0', theme_warning: '#e6b95c', theme_danger: '#ff7a86',
      theme_glow_color: '#e8c77a', theme_glow_color_2: '#9fb4d8',
      theme_bg_light: '#f3f5fb', theme_text_light: '#12162a',
      theme_primary_light: '#896912', theme_secondary_light: '#3d5480', theme_accent_light: '#6d5410',
      theme_success_light: '#12775a', theme_warning_light: '#7a5810', theme_danger_light: '#b52d45',
      theme_glow_color_light: '#896912', theme_glow_color_2_light: '#3d5480',
      theme_bg_tint: '16', theme_grain: '4',
      theme_glass_opacity: '0.05', theme_glass_blur: '42', theme_glass_saturation: '180',
      theme_glass_rim: '140', theme_radius: '20', theme_glow_strength: '1.25',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#f3dca6', theme_smoke_color: '#9fb4d8',
      theme_snow_color: '#eef1fa', theme_aurora_color: '#5fd0a0',
      theme_header_color: '#e8c77a',
      theme_shader_color: '#e8c77a', theme_shader_color_2: '#9fb4d8',
      theme_header_shader_color: '#e8c77a', theme_header_shader_color_2: '#dfe7f7',
      effects_bg_engine: 'webgl2', effects_header_engine: 'webgl2',
      effects_shader: 'true', effects_shader_name: 'fireworks',
      effects_header_shader: 'true', effects_header_shader_name: 'fizz',
      theme_font_ui: 'instrument', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  christmas: {
    label: "Christmas",
    family: 'seasonal',
    description: "Spruce black, candle gold and a green that is a colour rather than a signal. Light strings swagged across the room and ice off the top of the bar.",
    settings: {
      theme_bg: '#0d1512', theme_text: '#eaf0ea',
      theme_primary: '#e8b96a', theme_secondary: '#7fc496', theme_accent: '#f3d49a',
      theme_success: '#5cc98d', theme_warning: '#e0a84e', theme_danger: '#ff7a6e',
      theme_glow_color: '#e8b96a', theme_glow_color_2: '#7fc496',
      theme_bg_light: '#f7f4ec', theme_text_light: '#131a15',
      theme_primary_light: '#7d5713', theme_secondary_light: '#1c6d43', theme_accent_light: '#5f4310',
      theme_success_light: '#166b45', theme_warning_light: '#7b5510', theme_danger_light: '#b3302c',
      theme_glow_color_light: '#7d5713', theme_glow_color_2_light: '#1c6d43',
      theme_bg_tint: '12', theme_grain: '7',
      theme_glass_opacity: '0.06', theme_glass_blur: '24', theme_glass_saturation: '165',
      theme_glass_rim: '110', theme_radius: '18', theme_glow_strength: '1.1',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#f3d49a', theme_smoke_color: '#7fc496',
      theme_snow_color: '#eaf0ea', theme_aurora_color: '#5cc98d',
      theme_header_color: '#e8b96a',
      theme_shader_color: '#e8b96a', theme_shader_color_2: '#7fc496',
      theme_header_shader_color: '#dff0ff', theme_header_shader_color_2: '#7fa8cc',
      effects_bg_engine: 'webgl2', effects_header_engine: 'webgl2',
      effects_shader: 'true', effects_shader_name: 'garland',
      effects_header_shader: 'true', effects_header_shader_name: 'icicles',
      theme_font_ui: 'hanken', theme_font_display: 'archivo', theme_font_mono: 'plex',
    },
  },
  halloween: {
    label: "Halloween",
    family: 'seasonal',
    description: "Bruise purple, pumpkin and a toxic green. The hardest corners and the least frost of the five, with wisps over a ground mist and something viscous coming off the navbar.",
    settings: {
      theme_bg: '#120b16', theme_text: '#f0e9ee',
      theme_primary: '#ff9a3c', theme_secondary: '#8fe39b', theme_accent: '#ffc07a',
      theme_success: '#6fd68f', theme_warning: '#f5b950', theme_danger: '#ff6f7d',
      theme_glow_color: '#ff9a3c', theme_glow_color_2: '#8fe39b',
      theme_bg_light: '#f6f1e8', theme_text_light: '#1a1220',
      theme_primary_light: '#8f4a08', theme_secondary_light: '#1f6d3c', theme_accent_light: '#6d3a06',
      theme_success_light: '#1a6f45', theme_warning_light: '#7d5610', theme_danger_light: '#b32f3c',
      theme_glow_color_light: '#8f4a08', theme_glow_color_2_light: '#1f6d3c',
      theme_bg_tint: '18', theme_grain: '10',
      theme_glass_opacity: '0.05', theme_glass_blur: '18', theme_glass_saturation: '150',
      theme_glass_rim: '95', theme_radius: '10', theme_glow_strength: '1.15',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#ffc07a', theme_smoke_color: '#8fe39b',
      theme_snow_color: '#f0e9ee', theme_aurora_color: '#6fd68f',
      theme_header_color: '#ff9a3c',
      theme_shader_color: '#8ff0a0', theme_shader_color_2: '#9a63c8',
      theme_header_shader_color: '#7ee08a', theme_header_shader_color_2: '#d9ffe2',
      effects_bg_engine: 'webgl2', effects_header_engine: 'webgl2',
      effects_shader: 'true', effects_shader_name: 'witchlight',
      effects_header_shader: 'true', effects_header_shader_name: 'drip',
      theme_font_ui: 'geist', theme_font_display: 'space-grotesk', theme_font_mono: 'jetbrains',
    },
  },
  'lunar-new-year': {
    label: "Lunar New Year",
    family: 'seasonal',
    description: "Lacquer red and gold under the deepest polish here. Paper lanterns climbing the page and plum blossom crossing the bar.",
    settings: {
      theme_bg: '#1a0b0c', theme_text: '#fbeee9',
      theme_primary: '#f0c860', theme_secondary: '#ff8a76', theme_accent: '#ffd98a',
      theme_success: '#5fcb93', theme_warning: '#f0b355', theme_danger: '#ff7166',
      theme_glow_color: '#f0c860', theme_glow_color_2: '#ff8a76',
      theme_bg_light: '#fbf3f1', theme_text_light: '#22100f',
      theme_primary_light: '#8a5c0c', theme_secondary_light: '#a83526', theme_accent_light: '#6d4708',
      theme_success_light: '#136a48', theme_warning_light: '#7c5410', theme_danger_light: '#b02a20',
      theme_glow_color_light: '#8a5c0c', theme_glow_color_2_light: '#a83526',
      theme_bg_tint: '20', theme_grain: '3',
      theme_glass_opacity: '0.05', theme_glass_blur: '44', theme_glass_saturation: '195',
      theme_glass_rim: '150', theme_radius: '22', theme_glow_strength: '1.2',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#ffd98a', theme_smoke_color: '#ff8a76',
      theme_snow_color: '#fbeee9', theme_aurora_color: '#5fcb93',
      theme_header_color: '#f0c860',
      theme_shader_color: '#ff6b5a', theme_shader_color_2: '#ffd98a',
      theme_header_shader_color: '#ffb3c1', theme_header_shader_color_2: '#fff0f3',
      effects_bg_engine: 'webgl2', effects_header_engine: 'webgl2',
      effects_shader: 'true', effects_shader_name: 'lanterns',
      effects_header_shader: 'true', effects_header_shader_name: 'blossom',
      theme_font_ui: 'hanken', theme_font_display: 'schibsted', theme_font_mono: 'plex',
    },
  },
  easter: {
    label: "Easter",
    family: 'seasonal',
    description: "Pastels on a warm eggshell ground, the roundest corners on the board, and the one seasonal look built for light mode first. Dye and craquelure behind the shelf, bunting over the bar.",
    settings: {
      theme_bg: '#17141c', theme_text: '#efeaf2',
      theme_primary: '#c4a6f0', theme_secondary: '#8fd8bd', theme_accent: '#f5c9dd',
      theme_success: '#6fd3a3', theme_warning: '#e8c56a', theme_danger: '#ff8494',
      theme_glow_color: '#c4a6f0', theme_glow_color_2: '#8fd8bd',
      theme_bg_light: '#faf7f2', theme_text_light: '#1c1723',
      theme_primary_light: '#6b46b0', theme_secondary_light: '#1f7159', theme_accent_light: '#a3376a',
      theme_success_light: '#177a52', theme_warning_light: '#7a5a12', theme_danger_light: '#bb3145',
      theme_glow_color_light: '#6b46b0', theme_glow_color_2_light: '#1f7159',
      theme_bg_tint: '10', theme_grain: '6',
      theme_glass_opacity: '0.07', theme_glass_blur: '30', theme_glass_saturation: '155',
      theme_glass_rim: '105', theme_radius: '24', theme_glow_strength: '0.85',
      theme_border_strength: '100', theme_text_contrast: '100',
      effects_sparkles: 'false', effects_smoke: 'false',
      effects_snow: 'false', effects_aurora: 'false', effects_header: 'false',
      theme_sparkle_color: '#f5c9dd', theme_smoke_color: '#8fd8bd',
      theme_snow_color: '#efeaf2', theme_aurora_color: '#6fd3a3',
      theme_header_color: '#c4a6f0',
      theme_shader_color: '#f3d7e6', theme_shader_color_2: '#9a7fbe',
      theme_header_shader_color: '#c4a6f0', theme_header_shader_color_2: '#8fd8bd',
      effects_bg_engine: 'webgl2', effects_header_engine: 'webgl2',
      effects_shader: 'true', effects_shader_name: 'eggshell',
      effects_header_shader: 'true', effects_header_shader_name: 'bunting',
      theme_font_ui: 'instrument', theme_font_display: 'schibsted', theme_font_mono: 'geist-mono',
    },
  },
};

/**
 * A tombstone hides a built-in preset. Built-ins live in code, so "delete"
 * and "edit" cannot touch them directly — the stored blob carries either an
 * override (same id, new label/settings) or this marker, and resolvePresets
 * folds them together. Removing the entry restores the stock built-in, which
 * is also why the marker is stored rather than the built-in being copied out:
 * a copy would go stale the release the built-in improves.
 */
export function isPresetTombstone(p) {
  return !!p && typeof p === 'object' && p.deleted === true;
}

/**
 * The presets the editor actually shows: built-ins with any operator override
 * or tombstone applied, then the operator's own, in saved order.
 */
export function resolvePresets(custom = {}) {
  const presets = [];
  const hiddenBuiltins = [];
  for (const [id, base] of Object.entries(BUILTIN_PRESETS)) {
    const stored = custom[id];
    if (isPresetTombstone(stored)) {
      hiddenBuiltins.push(id);
      continue;
    }
    if (stored) {
      presets.push({
        id, builtin: true, overridden: true,
        // `family` comes from the BUILT-IN, never from the stored override.
        // An override carries a label and a settings blob and nothing else —
        // reading the family off `stored` would drop every edited built-in out
        // of its group and into the ungrouped tail, so editing Blueprint's
        // primary colour would make it vanish from Print.
        label: stored.label, description: base.description, family: base.family,
        settings: stored.settings,
      });
    } else {
      presets.push({ id, builtin: true, overridden: false, ...base });
    }
  }
  for (const [id, p] of Object.entries(custom)) {
    if (BUILTIN_PRESETS[id] || isPresetTombstone(p)) continue;
    // No family: an operator's own preset is grouped as theirs. Guessing one
    // from the settings would be a guess shown as a fact.
    presets.push({ id, builtin: false, overridden: false, label: p.label, settings: p.settings });
  }
  return { presets, hiddenBuiltins };
}

/**
 * The patch that applying `preset` with `scope` produces.
 * @param {{settings: Record<string,string>}} preset
 * @param {'dark'|'light'|'both'} scope
 */
export function presetPatch(preset, scope) {
  const keys = scope === 'dark' ? PRESET_DARK_KEYS
    : scope === 'light' ? PRESET_LIGHT_KEYS
      : PRESET_KEYS;
  const patch = {};
  for (const k of keys) {
    if (preset.settings[k] !== undefined) patch[k] = preset.settings[k];
  }
  return patch;
}

/**
 * Capture the editor's current state as a custom preset's settings blob.
 * Reads through the same dark-fallback the renderer uses, so what gets saved
 * is what the operator is looking at, not a pile of empty strings.
 */
export function captureAsPreset(colors, defaults) {
  const settings = {};
  for (const k of PRESET_KEYS) {
    const isLightTwin = k.endsWith('_light') && PRESET_LIGHT_KEYS.includes(k);
    const base = isLightTwin ? k.slice(0, -'_light'.length) : k;
    settings[k] = colors[k] || (isLightTwin ? (colors[base] || defaults[k] || defaults[base]) : defaults[k]);
  }
  return settings;
}

/** Parse the stored custom-presets JSON defensively; bad blob = no presets. */
export function parseCustomPresets(raw) {
  if (!raw) return {};
  try {
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {};
    const out = {};
    for (const [id, p] of Object.entries(obj)) {
      // Tombstones survive the parse: dropping them here would resurrect
      // every built-in the operator deleted, on the next load.
      if (isPresetTombstone(p)) {
        out[id] = { deleted: true };
        // `typeof [] === 'object'`, so an array-shaped `settings` used to walk
        // straight through this guard and become a preset card: swatches all
        // transparent, and Apply a silent no-op, because `presetPatch` finds
        // none of the keys it reads and returns `{}`. The server has always
        // refused exactly this shape (`Array.isArray` in themeKeys.js), so the
        // two defensive parsers disagreed about the same blob — which is worse
        // than either being wrong, because it only shows up after a round trip.
      } else if (p && typeof p.label === 'string'
        && p.settings && typeof p.settings === 'object' && !Array.isArray(p.settings)) {
        out[id] = { label: p.label, settings: p.settings };
      }
    }
    return out;
  } catch {
    return {};
  }
}
