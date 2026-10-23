/**
 * The built-in WebGL2 effects, as fragment-shader bodies.
 *
 * Each entry is the body only — `ShaderCanvas` compiles it behind
 * `SHADER_PREAMBLE`, which declares `iResolution`, `iTime`, `iMouse`,
 * `uColor`, `uColor2`, `uAlpha` and `uIsLight`. Writing them this way is not
 * only brevity: it is the same surface an operator gets in the custom-shader
 * box, so every built-in here is a worked example of the thing they are being
 * asked to write, and a starting point they can copy into the box and edit.
 *
 * ── House rules, which are the ordinary ones applied to a fragment stage ──
 *
 * - **Never hard-code a colour.** Everything tints from `uColor`/`uColor2`,
 *   which are the operator's own effect colours resolved through the palette
 *   fallback. A shader with a baked hue is the GLSL version of a hard-coded
 *   hex, and it will fight every preset on the board.
 * - **Return low alpha.** These sit behind the whole store. The canvas
 *   composites over the operator's background, so a shader returning opaque
 *   pixels has replaced their theme rather than lit it. Alphas here top out
 *   around 0.5 and mostly sit far below.
 * - **Answer `uIsLight`.** A field that adds light is right on a dark ground
 *   and nearly invisible on a pale one — the same trap the 2D aurora hit when
 *   a store switched to light mode. Every effect below either damps or
 *   inverts on light.
 * - **Cheap noise.** Value noise with a smoothstep fade, three or four
 *   octaves. Gradient noise looks marginally better under a domain warp and
 *   costs roughly double; nobody is looking at a background closely enough to
 *   tell.
 * - **Judge it at the size it runs.** Almost every effect here sizes its
 *   features off `iResolution.y`, so a field tuned against a 225px preview is
 *   tuned at a QUARTER of the scale it will ever be seen at. Five of these
 *   shipped their first draft that way and every one of them was wrong in the
 *   same direction: rain drops three pixels across, metaballs that filled the
 *   page with two, a halftone screen of 26px polka dots. Look at a new field
 *   at 1440×900 before believing anything about it.
 * - **A pitch that is physical is measured in pixels.** The corollary. A
 *   halftone screen has a dot pitch a printer chose; it does not get coarser
 *   because the window got bigger, so that one divides `frag` by a constant
 *   and every other field divides by `iResolution.y`. Getting this backwards
 *   is what made the screen invisible on a phone and enormous on a desktop.
 *
 * ── The roster, and why it is this large ──────────────────────────────────
 *
 * Twenty background fields and ten header ones. That is far more than a
 * picker needs if the picker were the point, and it is not: a preset is where
 * most operators meet a field, and a look is only worth shipping if the field
 * behind it is the same idea as the palette. Substrate needed routed traces,
 * Sandstorm needed a ground plane whose sky it could leave transparent, Riso
 * needed an actual halftone. So the roster grew to fit the looks rather than
 * the looks being fitted to the roster, and every entry below is the answer to
 * a specific preset's question. `client/src/theme/presets.js` names them.
 *
 * Anything added here has to be added to `ENUM_KEYS` in
 * `server/config/themeKeys.js` as well — two files, two reflexes, and the
 * failure is silent in the worse direction: a name the server accepts and the
 * client cannot resolve saves cleanly and renders nothing. There is a test.
 */

/* Shared GLSL, prepended to the effects that use it. Kept as one string rather
   than repeated per shader so a fix to the hash lands everywhere at once. */
const NOISE = `
/* The hashes below are integer arithmetic on the bit patterns of their inputs,
   and that is a portability fix rather than a preference.
 *
 * Every hash here used to be the usual float one — multiply by a couple of
 * large irrational-looking constants, take fract, multiply the lanes together,
 * take fract again. It is the shape every shader on the internet uses and it
 * works perfectly on a desktop GPU, because a desktop GPU's 'highp float' is
 * fp32 and fp32 has 24 bits of mantissa.
 *
 * GLSL ES does not promise that. 'precision highp float' promises a RELATIVE
 * precision of 2^-16 — sixteen bits — and several mobile drivers give exactly
 * that, or quietly relax the fragment stage to fp16. Follow the old hash
 * through at sixteen bits: a cell index of 200 times 456.21 is 91,000, where
 * one unit in the last place is about 1.4, so 'fract' of it was not a
 * pseudo-random fraction — it was whatever remained of a number whose integer
 * part had already eaten the whole mantissa. Neighbouring cells hashed to the
 * same value, then to zero. On a phone the fields broke into blocks, whole
 * regions of the screen went flat, and the noise-driven ones (nebula, bokeh,
 * embers, aurora-veil) rendered as very nearly nothing.
 *
 * No choice of constants fixes that; the technique needs a mantissa the
 * hardware is not obliged to have. Integers are, though: GLSL ES 3.00 requires
 * 'highp uint' to be exactly 32 bits with wrapping arithmetic, so 'uhash'
 * computes the same bits on a phone as it does on a workstation, by
 * specification rather than by luck. WebGL2 is already the floor for this
 * whole engine, so the integer path costs nothing to reach.
 *
 * 'floatBitsToUint' rather than flooring the input: hash21 is called with
 * fractional salts all over this file ('hash21(id + 5.3)', 'hash21(id + 1.1)')
 * and an operator's own shader may call it with anything at all. Hashing the
 * bits keeps every distinct input distinct, which flooring would not.
 *
 * The outputs are different values from the old hash's — the same character of
 * noise, a different particular arrangement. That is unavoidable when the hash
 * changes, and it is the trade: an operator's field looks slightly unlike the
 * one they picked last week, and it looks like ITSELF on every device. */
highp uint uhash(highp uvec2 v) {
  /* Two LCG-and-shift rounds, cross-fed so a change in either lane reaches
     every bit of the result. Integer multiply-add and shift are single-cycle
     on every GPU that runs this, so it is no more expensive than the float
     hash it replaces.

     The 'highp' on the parameter and on the return type is not decoration, and
     leaving it off cost an afternoon. A driver is allowed to RELAX a value it
     decides does not need range — ANGLE does, aggressively, choosing by what
     CONSUMES the result rather than by how it was produced — and a 32-bit
     hash relaxed to a 16-bit lane is not a weaker hash, it is zero. The tell
     was a Voronoi field that came out as a perfect rectangular grid: every
     cell's seed had collapsed to (0,0), but only when the seed fed a distance
     test. Assigning it to a variable that also reached the colour output made
     the same expression work. An explicit precision qualifier is the only
     thing in the language that a relaxation pass may not overrule. */
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  v.x += v.y * 1664525u;
  v.y += v.x * 1664525u;
  v ^= v >> 16u;
  return v.x;
}
/* Fifteen bits of the hash, brought back to 0..1 by two divisions.
 *
 * Every part of that sentence is load-bearing, and the reason is a driver that
 * does not keep the promise the preamble asks for.
 *
 * FIFTEEN BITS, not thirty-two: a stage relaxed to fp16 cannot represent 2^32
 * at all — the largest fp16 is 65504 — so the full hash would convert to
 * infinity and the field would render as a flat sheet. 32767 fits everywhere,
 * and a device with a short mantissa then loses resolution in the noise rather
 * than structure in it. Four octaves of smoothstep-interpolated value noise do
 * not miss the other seventeen bits.
 *
 * TWO DIVISIONS, not one multiply by a reciprocal, and this was measured
 * rather than reasoned. The obvious '* (1.0 / 32768.0)' returns exactly ZERO
 * on ANGLE/NVIDIA — a mainstream desktop stack — while the arithmetically
 * identical '/ 32768.0' returns the right answer. 1/32768 is 3.05e-5, and the
 * smallest NORMAL fp16 is 6.1e-5: the reciprocal is subnormal there, and a
 * stage that has been relaxed to fp16 flushes it to zero. So the constant
 * itself was the bug, in a shader that had asked for highp and been given
 * something else — the same disease as the hash above, one line further down.
 * Splitting the divide keeps both constants (256 and 128) comfortably normal
 * even if a compiler turns them back into reciprocal multiplies.
 *
 * Do not fold these two divisions into one, and do not "optimise" either into
 * a multiply. A GPU divide is not the expense here; a silently black
 * background is. */
float hash21(vec2 p) {
  highp uint h = uhash(floatBitsToUint(p));
  highp float v = float(h >> 17u);
  return v / 256.0 / 128.0;
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.03;   // not exactly 2: an integer lacunarity aligns the octaves
    a *= 0.5;    // and prints a visible grid through the sum
  }
  return v;
}
`;

/* The second shared block, for the effects that need more than a scalar field.
   Separate from NOISE rather than merged into it because a shader that only
   wants fbm should not carry a 2D hash and two matrices it never calls: the
   compiler strips them, but the operator reading a built-in as a worked example
   should not have to scroll past helpers the effect below does not use.

   NOISE2 includes NOISE — `ridged` is built on `vnoise`, so the two cannot be
   pasted in either order and only one of them being present is a link error
   nobody would enjoy debugging in a textarea. */
const NOISE2 = `${NOISE}
/* A vec2 of hash, for anything that needs a POSITION rather than a value —
   cell seeds, jitter, per-tile offsets. hash21 called twice with different
   salts correlates visibly along the diagonal; this does not, because the
   second lane is seeded by xoring the INPUT with two odd constants rather than
   by nudging it, so the two lanes take different paths through the avalanche
   from the first round on. Integer for the reason given above hash21. */
vec2 hash22(vec2 p) {
  highp uvec2 v = floatBitsToUint(p);
  /* Both lanes salted, including the first. Returning uhash(v) bare made
     hash22(x).x identical to hash21(x), so a shader that asked for a value AND
     a position at the same coordinate — which is most of the cell-based ones
     — silently got the same number twice and correlated its own jitter with
     its own brightness. */
  highp uint a = uhash(v ^ uvec2(0x2545f491u, 0x9e3779b1u));
  highp uint b = uhash(v ^ uvec2(0x9e3779b9u, 0x85ebca6bu));
  highp vec2 r = vec2(a >> 17u, b >> 17u);
  return r / 256.0 / 128.0;   // see hash21 on the split
}
mat2 rot2(float a) {
  float s = sin(a);
  float c = cos(a);
  return mat2(c, -s, s, c);
}
/* Ridged fbm: fold each octave around its own mean and invert. Ordinary fbm
   is a field of rolling hills; folding it puts a CREASE at every zero crossing,
   which is the sharp crest a dune, a mountain ridge or a wave has and that a
   smooth sum can never produce however many octaves you spend on it. */
float ridged(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * (1.0 - abs(vnoise(p) * 2.0 - 1.0));
    p *= 2.07;
    a *= 0.5;
  }
  return v;
}
`;

/* ── Background ─────────────────────────────────────────────────────────── */

/**
 * Aurora Veil — replaces the CPU marble slab.
 *
 * Domain-warped fbm read as height, then sliced into bands. The bands are what
 * makes it read as curtains of light rather than as fog: a smooth noise field
 * is featureless at this alpha, and the slicing gives the eye an edge to
 * follow. Two colours, mixed by the warp itself, so the operator's pair
 * actually does something instead of one tinting and one sitting unused.
 */
const AURORA_VEIL = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution.y;
  float t = iTime * 0.045;

  // Two-stage domain warp. One stage gives waves; two gives the folded,
  // sheeted look a curtain has.
  vec2 q = vec2(fbm(p * 1.6 + vec2(0.0, t)), fbm(p * 1.6 + vec2(4.3, -t)));
  vec2 r = vec2(fbm(p * 2.1 + 3.0 * q + vec2(1.7, 9.2) + t * 0.6),
                fbm(p * 2.1 + 3.0 * q + vec2(8.3, 2.8) - t * 0.4));
  float f = fbm(p * 1.9 + 2.4 * r);

  // Bands. fract() of a scaled height, softened so the seams do not alias.
  float band = fract(f * 3.2 - t * 2.0);
  float curtain = smoothstep(0.0, 0.45, band) * smoothstep(1.0, 0.55, band);
  curtain *= smoothstep(0.15, 0.75, f);

  // Vertical falloff: an aurora hangs from the top and thins toward the floor.
  float fall = smoothstep(0.0, 0.85, 1.0 - p.y / max(iResolution.x / iResolution.y, 0.6));

  vec3 col = mix(uColor, uColor2, clamp(r.x * 1.4, 0.0, 1.0));
  float a = curtain * fall * 0.34;
  // On a pale ground an additive veil does almost nothing, so it is darkened
  // into the page instead of added to it, at a lower alpha.
  a *= mix(1.0, 0.55, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Nebula — volumetric-looking cloud, marched in 2D.
 *
 * Not a real volume: it is four fbm samples at different scales and offsets,
 * accumulated with a falloff that mimics depth. A genuine raymarch through 3D
 * noise looks better and costs thirty-odd texture-free noise samples per
 * pixel, which on an integrated GPU at 1440p is a background that heats the
 * laptop. This reads the same at 0.3 alpha.
 */
const NEBULA = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = (frag - 0.5 * iResolution) / iResolution.y;
  float t = iTime * 0.03;

  float acc = 0.0;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float scale = 1.4 + fi * 0.9;
    vec2 off = vec2(fi * 3.7, -fi * 2.1) + vec2(t * (1.0 + fi * 0.3), t * 0.4);
    float d = fbm(p * scale + off);
    d = pow(smoothstep(0.35, 0.95, d), 1.6);
    // Nearer layers are brighter and tint toward the second colour.
    float w = (1.0 - fi * 0.2);
    acc += d * w;
    col += mix(uColor, uColor2, fi / 3.0) * d * w;
  }
  col /= max(acc, 0.001);

  // A soft vignette keeps the cloud off the edges, where the store's own
  // chrome lives and a busy background is worst.
  float vig = smoothstep(1.25, 0.15, length(p));
  float a = clamp(acc * 0.30, 0.0, 0.44) * vig;
  a *= mix(1.0, 0.5, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Caustics — light through moving water.
 *
 * The classic sum-of-sines trick: iterate a point through a cheap chaotic map
 * and accumulate the reciprocal distance to the fold lines. It produces the
 * bright interlocking web a pool floor has, which is a shape none of the
 * particle effects can make — the lines are where the field is *thin*, not
 * where a particle is.
 */
const CAUSTICS = `
// The reciprocal-distance term needs a SMALL divisor to produce bright lines:
// sin()/INTENSITY is large, the coordinate over it is small, and one over that
// small length is the brightness. Getting this the wrong way round is not a
// dim effect, it is a black one — 1/large is zero everywhere and the shader
// renders nothing at all, which is exactly what the first version of this did.
const float INTENSITY = 0.012;

void mainImage(out vec4 o, in vec2 frag) {
  vec2 uvp = (frag - 0.5 * iResolution) / iResolution.y;
  vec2 p = uvp * 4.2;
  float t = iTime * 0.22;

  float acc = 0.0;
  vec2 q = p;
  for (int i = 0; i < 5; i++) {
    float fi = float(i) + 1.0;
    q = vec2(
      q.x + 0.62 / fi * sin(fi * q.y + t + 0.3 * fi) + 0.9,
      q.y + 0.62 / fi * cos(fi * q.x + t * 0.9 - 0.2 * fi) + 1.4
    );
    // Bright where the map compresses — the fold lines a pool floor draws.
    acc += 1.0 / length(vec2(
      q.x / (sin(q.x + t) / INTENSITY),
      q.y / (cos(q.y + t) / INTENSITY)
    ));
  }
  acc = 1.0 - acc / 5.0;

  // Raised to a high power so the web is thin lines rather than a wash: the
  // shape IS the effect, and a soft version of it is just fog.
  float web = pow(abs(acc), 7.0);

  vec3 col = mix(uColor, uColor2, clamp(1.0 - abs(acc), 0.0, 1.0));
  float vig = smoothstep(1.45, 0.15, length(uvp));
  float a = clamp(web, 0.0, 1.0) * 0.34 * vig;
  a *= mix(1.0, 0.45, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Ink Drift — slow marbling, and the honest successor to the retired 2D
 * marble slab.
 *
 * Marble's whole idea was veins of stone swirled through the page, solved on
 * the CPU into a bitmap and re-solved whenever the colour changed. The same
 * thing per-pixel is both cheaper and no longer frozen: the veins actually
 * move, which is what the CPU version could never afford.
 *
 * `abs(f - 0.5)` inverted is the trick that turns a smooth field into
 * filaments — the thin bright line is where the noise crosses its own mean.
 */
const INK_DRIFT = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution.y;
  float t = iTime * 0.02;

  vec2 warp = vec2(fbm(p * 2.2 + t), fbm(p * 2.2 + vec2(5.2, 1.3) - t));
  float f = fbm(p * 3.1 + warp * 2.6);

  // Filaments: bright where the field crosses its mean, dark elsewhere.
  float vein = 1.0 - smoothstep(0.0, 0.055, abs(f - 0.5));
  // A second, finer set at a different phase so the stone has grain inside
  // the veins rather than a single clean line.
  float grain = 1.0 - smoothstep(0.0, 0.16, abs(fbm(p * 7.0 + warp * 1.2) - 0.5));

  vec3 col = mix(uColor, uColor2, clamp(warp.y * 1.6, 0.0, 1.0));
  float a = (vein * 0.30 + grain * 0.07);
  a *= mix(1.0, 0.6, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Warp Field — a starfield with depth, running toward the viewer.
 *
 * Cell noise rather than a particle list: each screen cell holds one star at a
 * hashed position, so a thousand stars cost the same as one. Streaking comes
 * from sampling the same cell at three points along the travel direction,
 * which is motion blur done as a shape rather than as an accumulation buffer.
 */
const WARP_FIELD = `${NOISE}
float layer(vec2 p, float t, float density) {
  vec2 g = floor(p * density);
  vec2 f = fract(p * density);
  float star = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = vec2(float(x), float(y));
      float h = hash21(g + cell);
      // Only a fraction of cells hold a star; the rest stay empty sky.
      if (h > 0.90) {
        vec2 pos = cell + vec2(hash21(g + cell + 7.1), hash21(g + cell + 3.3));
        float d = length(f - pos);
        float tw = 0.6 + 0.4 * sin(t * 2.0 + h * 30.0);
        star += tw * smoothstep(0.09, 0.0, d);
      }
    }
  }
  return star;
}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = (frag - 0.5 * iResolution) / iResolution.y;
  float t = iTime * 0.12;

  // Three depths, each drifting at its own rate — parallax without a camera.
  float s = 0.0;
  s += layer(p + vec2(t * 0.35, t * 0.10), iTime, 6.0)  * 1.00;
  s += layer(p + vec2(t * 0.20, t * 0.06), iTime, 11.0) * 0.55;
  s += layer(p + vec2(t * 0.11, t * 0.03), iTime, 18.0) * 0.30;

  // The faintest possible wash between the stars, so the field is not pure
  // black-and-points on a themed ground.
  float haze = fbm(p * 1.3 + t * 0.2) * 0.06;

  vec3 col = mix(uColor, uColor2, clamp(length(p) * 0.8, 0.0, 1.0));
  float a = clamp(s * 0.5 + haze, 0.0, 0.5);
  a *= mix(1.0, 0.35, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Survey Lines — the page as a contour map.
 *
 * A height field, sliced at even intervals, drawn as isolines. The reason it
 * belongs on a storefront is that it is the one field here that reads as a
 * DOCUMENT rather than as weather: an operator running a ledger-shaped store
 * wants a ground with a drawn quality, and every other option is atmospheric.
 *
 * The line width comes from `fwidth` — the field's own screen-space derivative
 * — rather than from a constant. That is not polish: a fixed width draws hairs
 * where the slope is steep and floods whole regions solid where it is gentle,
 * because the same 0.02 of field height covers two pixels in one place and two
 * hundred in another. Dividing by the derivative asks "how far is this pixel
 * from the line, measured in pixels", which is the only question with a
 * stable answer.
 */
const CONTOURS = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution.y;
  float t = iTime * 0.011;

  vec2 warp = vec2(fbm(p * 1.05 + t), fbm(p * 1.05 + vec2(3.7, 1.9) - t));
  float h = fbm(p * 1.55 + warp * 0.75);

  float lines = h * 26.0;
  /* The floor on fwidth is 1e-4 and must not be tightened. It exists to stop a
     divide by zero where the field is locally flat, and 1e-5 — the obvious
     smaller number — is SUBNORMAL in fp16: a driver that has relaxed this
     stage flushes it to zero and the guard it was written to be is not there
     any more. 1e-4 is the smallest round value that is normal everywhere, and
     a real derivative here is two orders of magnitude larger, so the floor
     only ever fires in the degenerate case it is for. */
  float d = abs(fract(lines) - 0.5) / max(fwidth(lines), 1e-4);
  float ink = 1.0 - smoothstep(0.6, 1.7, d);

  // Every fifth contour heavier — the index line a real survey prints so the
  // eye can count altitude without following every thread.
  float major = 1.0 - step(0.5, mod(floor(lines), 5.0));
  ink *= 0.45 + 0.6 * major;

  vec3 col = mix(uColor, uColor2, clamp(h * 1.7 - 0.35, 0.0, 1.0));
  float a = ink * 0.26;
  a *= mix(1.0, 0.75, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Rain Glass — the store seen through a wet window.
 *
 * Each cell holds one drop that slides down its own path, with a chain of
 * beads left in the track behind it. The beads are the part that sells it: a
 * drop on real glass does not fall, it hangs until its own weight beats the
 * surface tension, runs, and leaves the trail it could not carry with it.
 * `sin(t + sin(t + sin(t)))` is that stutter in one cheap expression — nested
 * sines spend most of their range near the turning points, so the drop dwells
 * and then bolts.
 */
const RAIN_GLASS = `${NOISE}
float pane(vec2 p, float t, float scale) {
  vec2 st = p * scale;
  vec2 id = floor(st);
  st = fract(st) - 0.5;
  float n = hash21(id);
  // Most of the pane stays dry. A drop in every cell is a shower curtain.
  if (n < 0.42) return 0.0;

  float ty = t * (0.30 + n * 0.35) + n * 24.0;
  float y = -sin(ty + sin(ty + sin(ty) * 0.5)) * 0.38;
  float x = sin(n * 31.0 + ty * 0.4) * 0.16;

  // The cell scale is low — around three drops across the viewport height —
  // and that is deliberate. The first version ran at 5.5 and the drops came
  // out three pixels wide, which is not rain: it is the warp-field starfield
  // with extra steps. A drop has to be big enough to read as a lens.
  float len = length((st - vec2(x, y)) * vec2(1.0, 1.25));
  float r = 0.11 + 0.05 * n;
  // And it IS a lens: bright at the rim where it bends the light hardest,
  // hollow in the middle. A filled disc reads as a dot of paint.
  float head = smoothstep(r, r * 0.55, len) * 0.45
    + max(smoothstep(r * 1.05, r * 0.80, len) - smoothstep(r * 0.80, r * 0.50, len), 0.0);

  vec2 tr = vec2(st.x - x, fract((st.y - y) * 4.0) - 0.5);
  float beads = smoothstep(0.075, 0.010, length(tr * vec2(1.0, 0.28)));
  // Beads exist only ABOVE the head — the track is where the drop has been —
  // and fade out along it.
  beads *= smoothstep(-0.02, 0.08, st.y - y) * smoothstep(0.5, 0.0, st.y - y);

  return head + beads * 0.45;
}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution.y;
  float d = pane(p, iTime, 2.6) + pane(p + vec2(0.4, 0.1), iTime * 0.8, 4.3) * 0.6;

  // A breath of condensation, so the drops are sitting ON something rather
  // than floating in the operator's background.
  float mist = fbm(p * 2.5 + iTime * 0.01) * 0.09;

  vec3 col = mix(uColor, uColor2, clamp(d * 0.8, 0.0, 1.0));
  float a = clamp(d * 0.34 + mist, 0.0, 0.42);
  a *= mix(1.0, 0.55, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Slow Lamp — six metaballs in a jar.
 *
 * Metaballs rather than sprites, and the difference is the entire effect: two
 * discs that overlap are two discs, while two inverse-square fields that
 * overlap are one shape with a NECK stretched between them. The neck is what
 * makes a lava lamp worth watching, and no particle system can draw it.
 *
 * Slower than anything else on the board on purpose. This is the field for a
 * store that wants warmth in the room without giving the eye a job.
 */
const LAMP = `
float field(vec2 p, float t) {
  float f = 0.0;
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    // Incommensurate periods, so the six never return to the same arrangement
    // and the loop has no visible seam.
    vec2 c = vec2(
      sin(t * (0.17 + fi * 0.031) + fi * 2.1) * 0.62,
      sin(t * (0.13 + fi * 0.027) + fi * 1.3) * 0.42
    );
    float r = 0.16 + 0.07 * sin(fi * 3.7);
    vec2 d = p - c;
    f += r * r / max(dot(d, d), 1e-4);
  }
  return f;
}
void mainImage(out vec4 o, in vec2 frag) {
  // Scaled up so the six blobs are six. Judged in a 225px preview the field
  // looked right at 1.0, and at a real 900px viewport the same numbers put two
  // blobs across the whole page — a lamp you are standing inside rather than
  // looking at.
  vec2 p = (frag - 0.5 * iResolution) / iResolution.y * 1.75;
  float f = field(p, iTime * 0.5);

  // Two cuts through the same field: the body, and a thin rim just outside it.
  // A single threshold is a paper cut-out; the rim gives the surface a turn.
  float body = smoothstep(0.90, 1.35, f);
  float rim = smoothstep(0.78, 0.95, f) - smoothstep(0.95, 1.25, f);

  vec3 col = mix(uColor, uColor2, clamp(f * 0.5, 0.0, 1.0));
  float a = body * 0.22 + max(rim, 0.0) * 0.30;
  a *= mix(1.0, 0.55, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Crystal — a Voronoi fracture that shears as it moves.
 *
 * The edges are drawn from `F2 - F1`, the gap between the distances to the
 * two nearest seeds. That expression is zero exactly on the boundary between
 * two cells, which is a genuine fracture line — where the field is undecided
 * — and not a distance to any point. Drawing cells as "close to a seed"
 * instead gives circles, which is the mistake that makes most Voronoi
 * backgrounds look like bubble wrap.
 *
 * Each seed orbits its own home, so neighbouring facets shear against one
 * another instead of the whole lattice sliding as one plate.
 */
const CRYSTAL = `${NOISE2}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = (frag - 0.5 * iResolution) / iResolution.y * 3.4;
  float t = iTime * 0.10;

  vec2 g = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = vec2(float(x), float(y));
      vec2 seed = hash22(g + cell);
      vec2 pos = cell + 0.5 + 0.42 * sin(t * 6.2831 + seed * 6.2831);
      float d = length(f - pos);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }

  float edge = 1.0 - smoothstep(0.0, 0.075, f2 - f1);
  float facet = smoothstep(0.9, 0.0, f1);

  vec3 col = mix(uColor, uColor2, clamp(f1 * 1.4, 0.0, 1.0));
  float a = edge * 0.28 + facet * 0.05;
  a *= mix(1.0, 0.55, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Halftone — the page as a printed screen.
 *
 * A tone field reproduced as a grid of dots whose radius follows it. The one
 * decision that matters is the 15° screen angle: an axis-aligned dot grid
 * beats against the pixel grid and prints a coarse moire that is not in the
 * field at all, and it is worst at exactly the resolutions a laptop uses.
 * Fifteen degrees is what a printer rotates the black plate to, for the same
 * reason.
 *
 * The dot edge is derivative-softened rather than smoothstepped at a constant
 * width, so the screen stays crisp on a phone and does not turn to porridge
 * on a 4K panel.
 */
const HALFTONE = `${NOISE2}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution.y;
  float t = iTime * 0.02;

  float tone = smoothstep(0.25, 0.85, fbm(p * 1.7 + vec2(t, -t * 0.6)));

  // The screen is measured in PIXELS, not as a fraction of the viewport, and
  // that is the one thing about this effect that is not a matter of taste. A
  // halftone has a physical dot pitch — a printer picks lines per inch and the
  // image size does not change it. Sizing the grid off iResolution.y instead
  // made a screen that was invisible fabric noise on a phone and a wall of
  // 26px polka dots on a desktop, from the same number. Nine pixels is a
  // coarse newspaper screen at 1×, and it stays that at every window size.
  vec2 s = rot2(0.2618) * frag / 9.0;
  vec2 cell = fract(s) - 0.5;
  float r = tone * 0.60;
  float len = length(cell);
  float w = fwidth(len) + 0.001;
  float ink = 1.0 - smoothstep(r - w, r + w, len);

  vec3 col = mix(uColor, uColor2, tone);
  float a = ink * 0.30;
  // Barely damped on light: this is the one field that was designed on paper,
  // and ink on a pale ground is the case it is FOR.
  a *= mix(1.0, 0.85, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Circuit — routing, with a charge on it.
 *
 * Three tile kinds — a horizontal run, a vertical run, and a corner drawn as
 * two quarter arcs — picked per cell by a hash. Straights alone read as graph
 * paper; the corners are what make the grid read as something ROUTED, because
 * a route is defined by the fact that it turns.
 *
 * The pulse is phased per cell rather than per pixel, so the charge hops from
 * cell to cell like a signal on a bus instead of sweeping across the board
 * like a torch. A continuous sweep is the version of this that looks like a
 * loading bar.
 */
const CIRCUIT = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  // 16 cells across the viewport height. Routing is fine work: at 9 the traces
  // came out 100px apart on a desktop, which reads as pipework.
  vec2 gp = frag / iResolution.y * 16.0;
  vec2 id = floor(gp);
  vec2 f = fract(gp) - 0.5;

  float h = hash21(id);
  float d;
  if (h < 0.30) d = abs(f.y);
  else if (h < 0.60) d = abs(f.x);
  else d = min(abs(length(f - 0.5) - 0.5), abs(length(f + 0.5) - 0.5));

  float trace = 1.0 - smoothstep(0.012, 0.045, d);

  // Vias, sparsely. A board's density is at its junctions, and a grid with no
  // pads on it is a maze rather than a circuit.
  float pad = hash21(id + 5.3) > 0.86
    ? (1.0 - smoothstep(0.055, 0.10, length(f)))
    : 0.0;

  float phase = fract(hash21(id + 1.1) + iTime * 0.11);
  float pulse = exp(-pow((phase - 0.5) * 6.0, 2.0));

  vec3 col = mix(uColor, uColor2, hash21(id + 9.7));
  float a = trace * (0.06 + pulse * 0.30) + pad * 0.20;
  a *= mix(1.0, 0.6, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Silk — two sets of fibres, and a sheen crossing them.
 *
 * A warp and a weft at different angles, each a high-power sine so the fibres
 * are thin bright threads rather than a corduroy of fat stripes, both bent by
 * their own noise field. Without the bend this is a barcode.
 *
 * The sheen is the reason it reads as cloth. Silk is only silk because the
 * highlight MOVES across it when the fabric turns, so the fibre brightness
 * rides a slow band travelling over the weave rather than being uniform.
 */
const SILK = `${NOISE2}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution.y;
  float t = iTime * 0.05;

  float w1 = fbm(p * 1.4 + vec2(t, 0.0));
  float w2 = fbm(p * 1.4 + vec2(0.0, -t) + 4.7);

  // 46 fibres across the height, not 110. At the finer pitch the two sets beat
  // against each other AND against the pixel grid, and the cloth came out as a
  // steel mesh with a moire crawling over it — the exact artefact the 15°
  // screen angle exists to avoid over in Halftone. A thread you can resolve is
  // the whole difference between fabric and window screen.
  vec2 a1 = rot2(0.35) * p;
  vec2 a2 = rot2(-1.15) * p;
  float warp = pow(0.5 + 0.5 * sin(a1.y * 46.0 + w1 * 34.0), 6.0);
  float weft = pow(0.5 + 0.5 * sin(a2.y * 40.0 + w2 * 34.0), 6.0);

  float sheen = 0.30 + 0.70 * smoothstep(0.2, 1.0, fbm(p * 0.8 + vec2(-t * 2.0, t)));

  vec3 col = mix(uColor, uColor2, clamp(w1 * 1.5, 0.0, 1.0));
  float a = (warp * 0.8 + weft * 0.5) * sheen * 0.28;
  a *= mix(1.0, 0.6, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Shafts — light coming in from off the top corner.
 *
 * The occluder is 1D noise sampled along the ANGLE from the source, which is
 * the whole idea: a shaft is a direction in which nothing up there is blocking
 * the light, so the gaps must be a function of direction and never of
 * position. Noise over position gives blotches that happen to be elongated;
 * noise over angle gives genuine beams that stay parallel as they cross the
 * page, because they are.
 *
 * The source sits outside the frame deliberately. A visible sun is a bright
 * disc the store's own content then has to live next to.
 */
const SHAFTS = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = (frag - 0.5 * iResolution) / iResolution.y;
  vec2 d = p - vec2(-0.20, 0.95);
  float r = length(d);
  float ang = atan(d.x, -d.y);

  // Thresholded low and raised gently. Cutting at 0.35 and squaring left the
  // beams so thin and so dim that the whole field read as an empty frame with
  // a smudge in one corner — the shafts have to be the brightest thing here or
  // there is no reason to run this instead of the aurora.
  float beam = pow(smoothstep(0.22, 0.85, fbm(vec2(ang * 4.0, iTime * 0.035))), 1.7);
  float fine = pow(smoothstep(0.35, 0.88, fbm(vec2(ang * 12.0, iTime * 0.05))), 2.5);

  float fall = exp(-r * 0.70) * smoothstep(2.3, 0.05, r);
  float dust = fbm(p * 5.0 - iTime * 0.02) * 0.06;

  vec3 col = mix(uColor, uColor2, clamp(r * 0.7, 0.0, 1.0));
  float a = (beam * 0.50 + fine * 0.20 + dust) * fall;
  a *= mix(1.0, 0.5, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Dunes — a ground plane in fake perspective, lit from the side.
 *
 * Dividing the horizontal coordinate by the distance below the horizon IS the
 * projection: no matrix, no camera, one divide. Everything above the horizon
 * is left alone, so the operator's own background is the sky.
 *
 * Two extra height samples give a cheap normal, and the normal is what makes a
 * dune a dune rather than a stain — a dune is read entirely from its lit crest
 * and its dark slip face, and an unlit heightfield has neither. `ridged`
 * rather than plain fbm for the same reason: sand has a crease at the top, and
 * a smooth sum never grows one however many octaves it is given.
 */
const DUNES = `${NOISE2}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = (frag - 0.5 * iResolution) / iResolution.y;

  float below = 0.30 - p.y;
  // Above the horizon the divide would explode and then wrap. Returning a
  // transparent pixel is not a bail-out — the sky genuinely belongs to the
  // operator's background here.
  if (below <= 0.004) { o = vec4(uColor, 0.0); return; }

  vec2 g = vec2(p.x / below, 1.0 / below) * 0.55;
  g.y -= iTime * 0.05;

  float h = ridged(g * vec2(1.0, 0.55));
  float hx = ridged((g + vec2(0.07, 0.0)) * vec2(1.0, 0.55));
  float hy = ridged((g + vec2(0.0, 0.07)) * vec2(1.0, 0.55));
  float lit = clamp(0.5 + (h - hx) * 2.4 + (h - hy) * 1.4, 0.0, 1.0);

  // Distance haze. The far dunes wash out, which is what gives the plane depth
  // without a second pass over the geometry.
  float haze = smoothstep(0.0, 0.34, below);

  vec3 col = mix(uColor, uColor2, lit);
  float a = (0.09 + lit * 0.26) * haze;
  a *= mix(1.0, 0.55, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Bokeh — defocused lights drifting up through three depths.
 *
 * The rim is the point. A defocused highlight is a DISC with a bright edge —
 * that edge is the shape of the aperture — and rendering it as a soft gaussian
 * blob instead gives fog with lumps in it. Every out-of-focus light anybody
 * has actually seen has a hard-ish circular boundary, and leaving it out is
 * why most attempts at this look like a smudge.
 *
 * The near layer is bigger and slower than the far ones, which is the only
 * depth cue available without a camera.
 */
const BOKEH = `${NOISE}
float layer(vec2 p, float t, float scale, float radius) {
  vec2 st = p * scale;
  vec2 id = floor(st);
  vec2 f = fract(st) - 0.5;
  float acc = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = vec2(float(x), float(y));
      float h = hash21(id + cell);
      if (h < 0.72) continue;   // most cells are empty air
      vec2 c = cell + vec2(hash21(id + cell + 3.1), hash21(id + cell + 8.4)) - 0.5;
      float r = radius * (0.55 + 0.75 * hash21(id + cell + 5.5));
      float d = length(f - c);
      float disc = smoothstep(r, r * 0.72, d);
      float rim = smoothstep(r * 1.02, r * 0.90, d) - smoothstep(r * 0.90, r * 0.72, d);
      float flicker = 0.75 + 0.25 * sin(t * (0.6 + h) + h * 40.0);
      acc += (disc * 0.35 + max(rim, 0.0) * 0.9) * flicker;
    }
  }
  return acc;
}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution.y;
  float t = iTime;
  float s = layer(p + vec2(0.0, -t * 0.012), t, 2.6, 0.30)
          + layer(p + vec2(1.7, -t * 0.020), t, 4.4, 0.24) * 0.65
          + layer(p + vec2(4.1, -t * 0.031), t, 7.1, 0.18) * 0.40;

  vec3 col = mix(uColor, uColor2, clamp(p.y * 0.9 + 0.1, 0.0, 1.0));
  float a = clamp(s * 0.32, 0.0, 0.42);
  a *= mix(1.0, 0.45, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Data Rain — columns of falling glyphs.
 *
 * The glyphs are a 3×5 block mask reshuffled a few times a second, not
 * letters, and that is a constraint rather than a shortcut: a font here would
 * mean a texture, a texture means a fetch, and nothing in this store is
 * allowed to depend on an asset arriving. Blocks at this alpha read as
 * characters anyway — the eye supplies the alphabet.
 *
 * The row index is counted from the TOP, because the stream falls. Counting
 * from the bottom is the version of this that runs upward, which reads as a
 * rendering error rather than as rain.
 */
const DATASTREAM = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution;
  float cols = 44.0;
  float rows = 30.0;
  vec2 cell = floor(vec2(p.x * cols, p.y * rows));
  vec2 f = fract(vec2(p.x * cols, p.y * rows));

  float h = hash21(vec2(cell.x, 3.0));
  float speed = 5.0 + h * 11.0;
  float rowFromTop = rows - 1.0 - cell.y;
  float behind = mod(iTime * speed + h * 97.0, rows + 18.0) - rowFromTop;

  float tail = exp(-max(behind, 0.0) * 0.30) * step(0.0, behind);
  float bright = smoothstep(1.4, 0.0, abs(behind));

  vec2 b = floor(f * vec2(3.0, 5.0));
  float on = step(0.42, hash21(cell * 17.0 + b * 3.3 + floor(iTime * 3.0 + h * 20.0)));
  // Gutters, or the columns fuse into solid bars and the glyphs disappear.
  on *= step(0.10, f.x) * step(f.x, 0.90) * step(0.06, f.y) * step(f.y, 0.94);

  vec3 col = mix(uColor2, uColor, clamp(bright * 1.5, 0.0, 1.0));
  float a = on * (tail * 0.20 + bright * 0.30);
  a *= mix(1.0, 0.55, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Truchet — a maze of arcs from one coin flip per tile.
 *
 * Each tile holds two quarter-arcs joining opposite pairs of edge midpoints,
 * and a single hashed bit decides which diagonal they take. That bit is the
 * whole trick: because the arcs always meet the edges at the same four points,
 * neighbouring tiles connect no matter what either of them rolled — so a grid
 * of independent coin flips comes out as one continuous, unplanned network of
 * curves. There is no path-finding here and there never was.
 *
 * The pulse runs along the arc's own angular parameter, so it follows the
 * curve around the corner rather than crossing the tile in a straight line.
 */
const TRUCHET = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution.y * 9.0;
  vec2 id = floor(p);
  vec2 f = fract(p) - 0.5;

  if (hash21(id) < 0.5) f.x = -f.x;

  vec2 c = length(f - 0.5) < length(f + 0.5) ? vec2(0.5) : vec2(-0.5);
  float ring = abs(length(f - c) - 0.5);
  float line = 1.0 - smoothstep(0.028, 0.075, ring);
  float hair = 1.0 - smoothstep(0.0, 0.012, abs(ring - 0.11));

  float s = atan(f.y - c.y, f.x - c.x) / 6.2831853;
  float phase = fract(s * 0.5 + hash21(id) * 3.7 - iTime * 0.10);
  float pulse = exp(-pow((phase - 0.5) * 7.0, 2.0));

  vec3 col = mix(uColor, uColor2, hash21(id + 4.2));
  float a = line * (0.07 + pulse * 0.34) + hair * 0.05;
  a *= mix(1.0, 0.6, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Mesh Wash — four colour centres, weighted.
 *
 * The "mesh gradient" a design tool makes by blurring four points, done as the
 * weighted average it actually is. Deliberately the quietest field on the
 * board: no edges, no particles, no cycle short enough to notice. It exists
 * because every other shader here gives the eye something to follow, and a
 * storefront that is mostly product photography usually wants a ground that
 * gives it nothing at all — but still wants colour in the room.
 *
 * The 0.06 floor in each weight is load-bearing. Without it the weight goes to
 * infinity as a pixel reaches a centre, and the "soft gradient" grows four
 * blown-out highlights that follow the mouse of anyone who resizes the window.
 */
const MESH_WASH = `
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = (frag - 0.5 * iResolution) / iResolution.y;
  float t = iTime * 0.08;

  vec2 c0 = vec2(sin(t * 0.90) * 0.55, cos(t * 0.70) * 0.35);
  vec2 c1 = vec2(cos(t * 0.60 + 1.7) * 0.62, sin(t * 1.10 + 0.4) * 0.40);
  vec2 c2 = vec2(sin(t * 0.50 + 3.1) * 0.48, cos(t * 0.80 + 2.2) * 0.44);
  vec2 c3 = vec2(cos(t * 1.00 + 4.4) * 0.58, sin(t * 0.40 + 5.0) * 0.33);

  float w0 = 1.0 / (0.06 + dot(p - c0, p - c0));
  float w1 = 1.0 / (0.06 + dot(p - c1, p - c1));
  float w2 = 1.0 / (0.06 + dot(p - c2, p - c2));
  float w3 = 1.0 / (0.06 + dot(p - c3, p - c3));
  float sum = w0 + w1 + w2 + w3;

  vec3 mid = mix(uColor, uColor2, 0.5);
  vec3 col = (uColor * w0 + uColor2 * w1 + mid * w2 + uColor2 * w3) / sum;
  float a = 0.19 + 0.11 * (w0 + w2) / sum;
  a *= mix(1.0, 0.45, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Embers — sparks rising off a floor that is still warm.
 *
 * The sway is what stops this being snow played backwards. A rising ember is
 * pushed sideways by the air it is rising through, so each spark carries its
 * own lateral oscillation at its own rate; without that they travel in
 * straight vertical lines and the eye reads falling, not rising, whatever
 * direction they are actually going.
 *
 * The heat at the bottom is the other half: sparks with no source are
 * fireflies, and fireflies do not belong over a checkout.
 */
const EMBERS = `${NOISE}
float sparks(vec2 p, float t, float scale, float speed) {
  vec2 st = vec2(p.x, p.y - t * speed) * scale;
  vec2 id = floor(st);
  vec2 f = fract(st) - 0.5;
  float h = hash21(id);
  if (h < 0.72) return 0.0;
  float sway = sin(t * (0.8 + h * 1.6) + h * 30.0) * 0.28;
  vec2 c = vec2(hash21(id + 2.7) - 0.5 + sway, hash21(id + 6.1) - 0.5);
  float flare = 0.55 + 0.45 * sin(t * (4.0 + h * 8.0) + h * 60.0);
  // A core with a halo around it. The core alone is a one-pixel dot that
  // disappears at any sensible alpha — an ember is small, but it is small AND
  // glowing, and the glow is the part that survives being drawn faintly.
  float d = length((f - c) * vec2(1.0, 0.75));
  return (smoothstep(0.07, 0.0, d) + smoothstep(0.24, 0.0, d) * 0.40) * flare;
}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution.y;
  float t = iTime;
  float s = sparks(p, t, 4.0, 0.055)
          + sparks(p + 3.1, t, 7.0, 0.085) * 0.6
          + sparks(p + 7.4, t, 11.0, 0.120) * 0.35;

  // Embers cool on the way up. Without this fade they are the same brightness
  // at the top of a 1400px page as they are at the source, which reads as a
  // field of static rather than as something rising off a fire.
  s *= smoothstep(1.15, 0.02, p.y);

  float heat = smoothstep(0.62, 0.0, p.y);
  float glow = fbm(vec2(p.x * 2.0, p.y * 4.0 - t * 0.05)) * heat * 0.17;

  vec3 col = mix(uColor2, uColor, clamp(s * 1.8 + heat * 0.35, 0.0, 1.0));
  float a = clamp(s * 0.46 + glow, 0.0, 0.44);
  a *= mix(1.0, 0.45, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Hex Cells — a lattice with a signal crossing it.
 *
 * Finding which hexagon a pixel belongs to takes no trigonometry at all: a hex
 * tiling is the union of two rectangular lattices offset by half a cell, so
 * testing the pixel against both and keeping the nearer centre answers it in
 * four lines. Everything else here is the consequence of having the cell id.
 *
 * The wave lights whole CELLS, never parts of them. The cell is the unit of
 * this field, and a wavefront that cuts through the middle of one reads as a
 * clipping bug rather than as a signal propagating.
 */
const HEXCELLS = `${NOISE}
vec4 hexCell(vec2 p) {
  vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5;
  vec2 b = mod(p - s * 0.5, s) - s * 0.5;
  return dot(a, a) < dot(b, b)
    ? vec4(a, floor(p / s))
    : vec4(b, floor((p - s * 0.5) / s) + 0.5);
}
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = (frag - 0.5 * iResolution) / iResolution.y * 7.0;
  vec4 h = hexCell(p);
  float edge = smoothstep(0.44, 0.50, hexDist(h.xy));

  float d = length(h.zw);
  // The sweep is sized to the id range the viewport actually holds. At ten it
  // spent most of its cycle out past the corner of the screen, so the lattice
  // sat dark and the effect looked broken rather than idle.
  float wave = exp(-pow((fract(iTime * 0.055) * 5.5 - d) * 1.1, 2.0));
  float lit = wave * (0.4 + 0.6 * hash21(h.zw));

  vec3 col = mix(uColor, uColor2, clamp(d * 0.16, 0.0, 1.0));
  float a = edge * (0.09 + lit * 0.45) + lit * 0.06;
  a *= mix(1.0, 0.6, uIsLight);
  o = vec4(col, a);
}`;

const SEASON = `
/* Shared by the seasonal ten, and the reason it exists is worth stating before
   the code that uses it.

   The rest of the roster answers uIsLight by DAMPING: multiply the alpha by
   about 0.6 and a field tuned for a dark room stops blowing out a pale page.
   That is right for them, because they are light added to a room.

   It is exactly wrong for these. Every one of the five carries a holiday
   palette, which means light, saturated, cheerful colours - champagne, candle
   gold, pumpkin, vermilion, pastel - and a light colour composited over a light
   ground at ANY alpha is nothing at all. All ten shipped their first draft that
   way and all ten rendered light mode as a blank page. Damping made it worse:
   the fix for too much was being applied to a field that had already vanished.

   So on a pale ground the same shapes are drawn as INK instead of as light.
   The hue is kept and the value is dropped, and the field composites DOWN onto
   the page the way a printed decoration would. A garland photographed in
   daylight IS a string of dark warm beads rather than a string of glows, so
   this is the honest picture of the same object rather than a compromise. */
vec3 seasonalInk(vec3 c) {
  /* Saturate BEFORE darkening, or the ink comes out grey.

     A flat multiply preserves the hue ratios exactly, which sounds like it
     should be enough and is not: dropping the value of a pale, low-chroma
     holiday colour and compositing the result onto a pale page at a third of
     an alpha gives a warm-ish grey. Christmas came out as pencil. Pushing each
     channel away from the colour's own mean first buys back the chroma that
     the darkening is about to spend, so gold stays gold and vermilion stays
     red. */
  float m = (c.r + c.g + c.b) / 3.0;
  vec3 ink = clamp((c - m) * 1.9 + m, 0.0, 1.0) * 0.30;
  return mix(c, ink, uIsLight);
}
`;

/* ── The seasonal five ────────────────────────────────────────────────────
 *
 * Five dated looks — New Year, Christmas, Halloween, Lunar New Year, Easter —
 * each with a background field and a header strip of its own, named by the
 * five presets in client/src/theme/presets.js.
 *
 * A seasonal field has one problem the rest of the roster does not: the
 * imagery is fixed before the work starts, and the obvious drawing of it is
 * always a clip-art shape. A pumpkin outline, a Christmas tree, a bunny. Every
 * one of those is a picture pasted behind a shop rather than a room the shop
 * stands in, and the store still has to be legible over it in both modes at
 * six in the morning.
 *
 * So each of these is a MECHANISM the holiday actually contains, drawn the way
 * the rest of the roster draws things: a shell that climbs before it opens, a
 * string of bulbs on a catenary, a wisp that wanders because it is following a
 * noise field, paper stretched over a lantern frame, a shell that has dried and
 * split. The holiday is legible from the behaviour, not from a silhouette.
 */

/**
 * Fireworks — shells that climb, open, and sag under their own weight.
 *
 * The ascent is half of it. A burst that simply appears is a decoration; an
 * ember that climbs for three quarters of a second and THEN opens is an event,
 * and the eye follows it up before there is anything at the top to look at.
 * Cutting the ascent was tried first, on the grounds that nobody watches a
 * background closely — and the result read as flashbulbs going off behind the
 * catalogue, which is a different and much worse thing to put behind a shop.
 *
 * Gravity is applied to the SAMPLE point rather than to each spark: one add,
 * and the whole shell droops exactly the way a real one does. Fifty-four
 * spokes each with their own reach, because equal reach is a ring and a ring
 * is a smoke signal — and fifty-four rather than the thirty-four it was
 * drawn with first, where the streaks were wide enough to meet each other and
 * the shell came out as a handful of chopped wedges.
 */
const FIREWORKS = `${NOISE2}${SEASON}
void mainImage(out vec4 o, in vec2 frag) {
  float aspect = iResolution.x / max(iResolution.y, 1.0);
  vec2 p = (frag - 0.5 * iResolution) / max(iResolution.y, 1.0);

  float spark = 0.0;
  float halo = 0.0;
  float warm = 0.0;

  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    /* Incommensurate periods. Six shells on one clock is a metronome, and a
       metronome overhead is the thing people close a tab to escape. */
    float period = 2.3 + fi * 0.41;
    float phase = iTime / period + fi * 0.41;
    float shot = floor(phase);
    float age = fract(phase) * period;

    vec2 h = hash22(vec2(shot, fi * 7.0 + 1.0));
    vec2 c = vec2((h.x - 0.5) * aspect * 0.95, h.y * 0.34 - 0.02);

    float RISE = 0.75;
    float climb = clamp(age / RISE, 0.0, 1.0);
    /* Decelerating: the shell is coasting by the time it opens. */
    vec2 tail = vec2(c.x, mix(-0.62, c.y, climb * (2.0 - climb)));
    float rising = (1.0 - step(RISE, age))
      * exp(-length((p - tail) * vec2(1.0, 0.42)) * 80.0);

    float bt = max(age - RISE, 0.0);
    float live = step(RISE, age);

    vec2 q = p - c + vec2(0.0, 0.26 * bt * bt);
    float d = length(q);
    float ang = atan(q.y, q.x);

    float spokes = 54.0;
    float slot = (ang + 3.14159) / 6.28318 * spokes;
    float k = floor(slot);
    /* Concentrate each spark toward the MIDDLE of its angular slot. Without
       this every spark is a full arc segment the width of its slot, and at
       fifty-four spokes on a shell 0.3 across that is a rectangle about as
       wide as its streak is long: the burst came out as a ring of confetti
       rather than as a spray of sparks. */
    float across = exp(-pow((fract(slot) - 0.5) * 3.4, 2.0));
    float reach = 0.28 + 0.22 * hash21(vec2(k, shot + fi));
    float r = reach * (1.0 - exp(-bt * 2.4));
    float fade = exp(-bt * 1.05) * live;

    float head = exp(-pow((d - r) * 210.0, 2.0)) * across;
    /* The streak each spark leaves BEHIND it, decaying inward from the head.
       Written first as a filled disc out to the head radius, which is what a
       shell looks like in a photograph taken with a long exposure and nothing
       like one in the air: it read as a solid star and the spokes disappeared
       into it. A streak has to start at the spark and fall off backwards. */
    float trail = exp(-max(r - d, 0.0) * 14.0) * step(d, r) * 0.30 * across;
    float ragged = 0.5 + 0.5 * hash21(vec2(k, shot));

    /* The flash at the moment the shell opens, before the spokes have gone
       anywhere. Half a beat long. */
    float flash = exp(-bt * 8.0) * exp(-d * 22.0) * live;

    spark += (head + trail) * ragged * fade + flash;
    halo += exp(-d * 7.0) * fade * 0.55 + rising * 0.40;
    warm += fade * h.x;
  }

  vec3 col = mix(uColor, uColor2, clamp(warm * 1.6, 0.0, 1.0));
  // The halo is the shell's own light. See the note in Garland: on a pale
  // ground it is ink, and ink has no halo.
  float a = spark * 0.52 + halo * 0.13 * mix(1.0, 0.22, uIsLight);
  a *= mix(1.0, 0.95, uIsLight);
  o = vec4(seasonalInk(col), min(a, 0.5));
}`;

/**
 * Garland — four strings of bulbs swagged across the room.
 *
 * The catenary is the whole effect. A straight string of lights is a ceiling
 * fitting; a string that hangs is a decoration somebody put up, and the sag is
 * what tells you which. It is drawn as the absolute value of a sine rather
 * than a real cosh — the difference is a few percent of curvature at this size
 * and one transcendental per pixel per string.
 *
 * Every bulb twinkles on its OWN slow clock. A synchronised string is a
 * warning light: hazard beacons flash together and fairy lights do not, and
 * the eye knows the difference long before the brain names it.
 */
const GARLAND = `${NOISE}${SEASON}
void mainImage(out vec4 o, in vec2 frag) {
  float aspect = iResolution.x / max(iResolution.y, 1.0);
  vec2 p = frag / iResolution;

  float wire = 0.0;
  float bulb = 0.0;
  float spill = 0.0;
  float warm = 0.0;

  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float y0 = 0.94 - fi * 0.25;
    float spans = 2.0 + fi;
    float ph = fi * 1.3;
    /* Each string breathes on its own period, so four of them never hang as
       one shape. */
    float sag = 0.085 + 0.014 * sin(iTime * 0.21 + ph);

    float sw = y0 - sag * abs(sin(3.14159 * (p.x * spans) + ph));
    float ww = fwidth(sw) + 0.0012;
    wire += 1.0 - smoothstep(0.0, ww * 2.0 + 0.0015, abs(p.y - sw));

    float bulbs = 9.0 + fi * 4.0;
    float k = floor(p.x * bulbs);
    /* Three cells, so a bulb's spill reaches into its neighbours instead of
       stopping dead on a cell boundary. One cell leaves a visible grid of
       square haloes, which is the tell that a lattice is being drawn. */
    for (int j = -1; j <= 1; j++) {
      float kk = k + float(j);
      float bx = (kk + 0.5) / bulbs;
      float by = y0 - sag * abs(sin(3.14159 * (bx * spans) + ph)) - 0.017;
      vec2 d = vec2((p.x - bx) * aspect, p.y - by);
      float h = hash21(vec2(kk, fi));
      float tw = 0.55 + 0.45 * sin(iTime * (0.5 + h * 0.8) + h * 24.0);
      float dd = length(d);
      bulb += exp(-dd * 85.0) * (0.4 + 0.6 * tw);
      spill += exp(-dd * 15.0) * tw;
      /* Alternating colours down the string, from the bulb's own hash rather
         than from its index: strict alternation prints a two-tone barber pole
         once four strings line up. */
      warm += exp(-dd * 15.0) * step(0.5, fract(h * 4.0));
    }
  }

  vec3 col = mix(uColor, uColor2, clamp(warm * 1.1, 0.0, 1.0));
  /* The spill is a LIGHT SOURCE's halo, so it is nearly withdrawn on a pale
     ground where the same shapes are ink. Ink does not glow: kept at full
     strength it turned every bulb into a soft grey smudge and the page into
     fog, which is the one thing a background may not do to a catalogue. */
  float a = bulb * 0.40 + spill * 0.070 * mix(1.0, 0.22, uIsLight) + wire * 0.05;
  a *= mix(1.0, 0.85, uIsLight);
  o = vec4(seasonalInk(col), min(a, 0.5));
}`;

/**
 * Witchlight — wisps wandering over a ground mist.
 *
 * The path is the point. A wisp driven by two sines traces the same closed
 * Lissajous loop for ever and the eye learns it in about ten seconds, at which
 * point the thing stops being a will-o'-the-wisp and becomes a screensaver.
 * Each axis here is driven by two sines at an irrational-ish frequency ratio,
 * so the path is quasi-periodic: it never closes, and it never looks steered.
 *
 * The tail is four samples down the SAME path at four lags, which means it is
 * literally where the wisp was. A tail drawn as a stretched blob points the
 * wrong way every time the wisp turns, which is exactly when anyone is
 * looking at it.
 *
 * The mist is held to the bottom third. A full-screen fog is a grey filter
 * over the catalogue, and no operator switched that on deliberately.
 */
const WITCHLIGHT = `${NOISE}${SEASON}
vec2 wispAt(float fi, float tl) {
  return vec2(
    0.5 + 0.40 * sin(tl * 0.63 + fi * 2.1) + 0.11 * sin(tl * 1.47 + fi * 5.3),
    0.46 + 0.26 * sin(tl * 0.51 + fi * 3.7) + 0.09 * sin(tl * 1.13 + fi * 1.9));
}
void mainImage(out vec4 o, in vec2 frag) {
  float aspect = iResolution.x / max(iResolution.y, 1.0);
  vec2 p = frag / iResolution;

  /* Two mist layers crossing at different speeds and directions, so the bank
     curls rather than sliding past as one sheet. */
  float m1 = fbm(vec2(p.x * 2.6 + iTime * 0.035, p.y * 3.4 - iTime * 0.020));
  float m2 = fbm(vec2(p.x * 1.7 - iTime * 0.022, p.y * 2.1 + iTime * 0.030));
  float mist = smoothstep(0.34, 0.95, m1 * 0.65 + m2 * 0.52)
    * smoothstep(0.52, 0.0, p.y);

  float core = 0.0;
  float wisp = 0.0;

  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float tt = iTime * (0.42 + fi * 0.07) + fi * 13.7;
    /* Flicker, not pulse. A wisp that fades smoothly in and out reads as a
       lamp on a dimmer; a flame gutters. */
    float fl = 0.55 + 0.45 * sin(tt * 5.3 + sin(tt * 2.1) * 2.0);
    for (int j = 0; j < 4; j++) {
      float fj = float(j);
      vec2 c = wispAt(fi, tt - fj * 0.30);
      vec2 d = vec2((p.x - c.x) * aspect, p.y - c.y);
      float dd = length(d);
      float dim = exp(-fj * 0.9);
      /* Two radii, not one. A single soft falloff is a blurred blob and reads
         as a smudge on the glass; a tight core inside a wide one reads as a
         flame with air around it. */
      core += (exp(-dd * 38.0) + exp(-dd * 150.0) * 1.3) * dim * fl;
      wisp += exp(-dd * 7.0) * dim * fl;
    }
  }

  vec3 col = mix(uColor2, uColor, clamp(core * 2.5 + wisp * 0.7, 0.0, 1.0));
  // Halo down on a pale ground, mist UP: the mist is the one part of this
  // field that is a substance rather than a light, so it is the one part that
  // gets stronger when the field turns to ink.
  float a = core * 0.50 + wisp * 0.13 * mix(1.0, 0.25, uIsLight) + mist * mix(0.24, 0.28, uIsLight);
  a *= mix(1.0, 0.80, uIsLight);
  o = vec4(seasonalInk(col), min(a, 0.5));
}`;

/**
 * Lanterns — paper lanterns climbing and leaning.
 *
 * Two details do all the work and both are about the paper. The RIBS: a
 * lantern is paper stretched over a frame and the frame shows through it, so
 * the body is banded rather than smooth — without that it is a glowing pill.
 * And the SWAY is tied to height as well as to time, so a lantern leans as it
 * climbs instead of swinging on the spot, which is what a pendulum on a nail
 * does and what nothing rising through still air does.
 *
 * They fade in low and out high. A lantern that pops into existence at the
 * frame edge tells you the frame is there, and the whole job of a background
 * is to not do that.
 */
const LANTERNS = `${NOISE2}${SEASON}
void mainImage(out vec4 o, in vec2 frag) {
  float aspect = iResolution.x / max(iResolution.y, 1.0);
  vec2 p = frag / iResolution;

  float body = 0.0;
  float glow = 0.0;
  float warm = 0.0;

  for (int i = 0; i < 8; i++) {
    float fi = float(i);
    vec2 h = hash22(vec2(fi, 3.0));
    float speed = 0.024 + h.x * 0.024;
    float y = fract(h.y * 3.7 + iTime * speed);
    float x = h.x * 1.06 - 0.03 + 0.045 * sin(iTime * 0.35 + fi * 2.3 + y * 5.0);
    float sz = 0.046 + h.y * 0.036;

    vec2 d = vec2((p.x - x) * aspect, p.y - y);
    /* Taller than wide: a paper lantern is a barrel, not a balloon. */
    float r = length(d / vec2(sz, sz * 1.15));
    float shell = smoothstep(1.02, 0.74, r);
    float ribs = 0.72 + 0.28 * cos(d.x / sz * 15.0);
    /* The candle. Lit from inside, or the lantern is a sticker. */
    float flame = exp(-length(d / vec2(sz * 0.45, sz * 0.55)) * 2.2);
    /* The tassel, swaying a beat behind the body it hangs from. */
    float tx = d.x + 0.006 * sin(iTime * 1.1 + fi * 2.0);
    float tass = step(-sz * 2.05, d.y) * step(d.y, -sz * 1.04)
      * exp(-abs(tx) * 190.0);

    float life = smoothstep(0.0, 0.17, y) * smoothstep(1.0, 0.74, y);

    body += (shell * ribs + flame * 0.8 + tass * 0.6) * life;
    glow += exp(-r * 1.5) * life;
    warm += flame * life;
  }

  vec3 col = mix(uColor, uColor2, clamp(warm * 2.2, 0.0, 1.0));
  // See Garland: the lantern's spill is light, and light is not what this
  // draws on a pale page.
  float a = body * 0.34 + glow * 0.10 * mix(1.0, 0.22, uIsLight);
  a *= mix(1.0, 0.85, uIsLight);
  o = vec4(seasonalInk(col), min(a, 0.5));
}`;

/**
 * Eggshell — dye, speckle and craquelure on a pale ground.
 *
 * The second field on the board built for LIGHT mode rather than damped into
 * it, and only the second after Halftone. Everything else here adds light to a
 * dark room; this one is a pale surface with darker marks on it, so it barely
 * damps when a store switches grounds — the cracks and flecks composite DOWN
 * onto a pale page, which is the only way a pastel look survives daylight.
 *
 * Three mechanisms, in the order the eye reads them:
 *
 * - **The dye.** Two slow noise fields crossing, which is what gives a dipped
 *   egg its uneven blush instead of a flat wash.
 * - **The speckle.** One fleck per cell on a jittered lattice, with the size
 *   distribution cubed so most are small and a few are much larger. That
 *   distribution IS the tell: uniform flecks read as a printed dot screen,
 *   which the roster already has and calls Halftone.
 * - **The craquelure.** Voronoi, like Crystal, and deliberately drawn as the
 *   opposite of it: dark hairlines where two cells are equidistant, rather
 *   than lit shearing facets. One is a shell that dried and split; the other
 *   is a fracture with light coming through. Same distance function, and
 *   nobody would guess they were related.
 */
const EGGSHELL = `${NOISE2}${SEASON}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / max(iResolution.y, 1.0);
  float t = iTime * 0.012;

  float w1 = fbm(p * 1.35 + vec2(t, -t * 0.6));
  float w2 = fbm(p * 2.10 + vec2(-t * 0.7, t * 0.4) + w1 * 0.8);
  float wash = clamp(w1 * 0.70 + w2 * 0.55, 0.0, 1.0);

  vec2 g = p * 34.0;
  vec2 sid = floor(g);
  vec2 sf = fract(g) - 0.5;
  vec2 jit = hash22(sid) - 0.5;
  float hs = hash21(sid + 0.5);
  float rad = 0.05 + 0.34 * hs * hs * hs;
  float speck = step(0.42, hash21(sid * 1.7))
    * smoothstep(rad, rad * 0.35, length(sf - jit * 0.72));

  vec2 cg = p * 7.0;
  vec2 cid = floor(cg);
  vec2 cf = fract(cg);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cell = vec2(float(x), float(y));
      float dist = length(cell + hash22(cid + cell) - cf);
      if (dist < f1) { f2 = f1; f1 = dist; }
      else if (dist < f2) { f2 = dist; }
    }
  }
  float crack = 1.0 - smoothstep(0.0, 0.042, f2 - f1);

  vec3 col = mix(uColor, uColor2, clamp(wash * 0.75 + crack * 0.9, 0.0, 1.0));
  float a = wash * 0.11 + speck * 0.26 + crack * 0.15;
  /* Damped far less than the rest of the roster but not left alone: this one
     is a surface rather than a light, so inking it onto a pale page is the
     right picture, and at full strength the crack network was a second grid
     over the shelf competing with the product cards for the eye. */
  a *= mix(1.0, 0.72, uIsLight);
  o = vec4(seasonalInk(col), min(a, 0.5));
}`;

/* ── Header ─────────────────────────────────────────────────────────────── */

/**
 * Pulse Grid — a lit grid behind the navbar that answers the pointer.
 *
 * The header's existing constellation rests at nothing and only moves under a
 * cursor, and that rule is worth keeping for anything that lives in the one
 * element visible on every page. This does the same: at rest it is a barely
 * visible grid, and the pointer lights a travelling ring through it.
 */
const PULSE_GRID = `
void mainImage(out vec4 o, in vec2 frag) {
  vec2 px = frag;
  float cell = 26.0;
  vec2 g = fract(px / cell) - 0.5;
  // Distance to the nearer of the two axes — a cross-hatch, not a box outline.
  float line = min(abs(g.x), abs(g.y));
  float grid = 1.0 - smoothstep(0.0, 0.06, line);

  float d = length(px - iMouse) / max(iResolution.y, 1.0);
  // A ring rather than a blob: the wave leaves the pointer and fades outward,
  // which reads as the surface responding rather than as a torch shining.
  float ring = exp(-pow((d - fract(iTime * 0.35) * 0.9) * 7.0, 2.0));
  float near = exp(-d * 4.5);

  vec3 col = mix(uColor, uColor2, clamp(d * 2.2, 0.0, 1.0));
  float a = grid * (0.05 + near * 0.5 + ring * 0.35);
  a *= mix(1.0, 0.6, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Ribbon — a slow band of light that crosses the header and comes back.
 *
 * The one header effect that runs without a pointer, because a storefront
 * header is also seen on a phone, where nothing hover-driven ever starts. It
 * is deliberately slow and low-alpha: this is the strip above every page on
 * the site, and a fast bright thing there is the single most annoying element
 * it is possible to ship.
 */
const RIBBON = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution;
  float t = iTime * 0.08;

  // A wave whose height wanders, so the band is not a clean sine.
  float wobble = fbm(vec2(p.x * 2.4, t * 2.0)) - 0.5;
  float centre = 0.5 + sin(p.x * 3.1 + t * 2.2) * 0.12 + wobble * 0.22;
  float band = exp(-pow((p.y - centre) * 7.5, 2.0));

  // A slow travelling brightness along the band's length.
  float travel = 0.55 + 0.45 * sin(p.x * 4.0 - t * 5.0);

  vec3 col = mix(uColor, uColor2, p.x);
  float a = band * travel * 0.3;
  a *= mix(1.0, 0.6, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Scanlines — a phosphor sweep.
 *
 * Pairs with the Phosphor preset, and is the header effect for a store that
 * wants the machine to look like a machine. Fine horizontal lines with a
 * brighter bar sweeping down through them.
 */
const SCANLINES = `
void mainImage(out vec4 o, in vec2 frag) {
  float lines = 0.5 + 0.5 * sin(frag.y * 1.6);
  lines = pow(lines, 3.0);

  // The sweep, wrapping. Taken from the position rather than from time alone,
  // so it enters at the top edge instead of appearing mid-header.
  float sweep = fract(frag.y / iResolution.y + iTime * 0.09);
  float bar = exp(-pow((sweep - 0.5) * 6.0, 2.0));

  vec3 col = mix(uColor, uColor2, sweep);
  float a = lines * (0.05 + bar * 0.30);
  a *= mix(1.0, 0.55, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Aurora Bar — the background curtain, compressed into a 60px strip.
 *
 * The same banded domain warp as Aurora Veil, sampled on a coordinate
 * stretched hard along x. That stretch is the only interesting part: a curtain
 * rendered at the header's aspect ratio without it is a single vertical smear,
 * because the field's features are round and the element is not. Anything
 * ported from a full-viewport effect to this strip needs the same treatment.
 */
const AURORA_BAR = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution;
  float t = iTime * 0.05;

  vec2 q = vec2(p.x * 2.2, p.y * 0.5);
  float f = fbm(q * 2.0 + vec2(t, -t * 0.5));
  float g = fbm(q * 3.1 + f * 1.6 + vec2(-t * 0.7, t));

  float band = fract(g * 2.6 - t * 3.0);
  float curtain = smoothstep(0.0, 0.5, band) * smoothstep(1.0, 0.55, band);
  // Hangs from the top of the strip, the way the full-page version hangs from
  // the top of the viewport.
  float fall = smoothstep(0.0, 1.0, p.y);

  vec3 col = mix(uColor, uColor2, clamp(g * 1.4, 0.0, 1.0));
  float a = curtain * fall * 0.30;
  a *= mix(1.0, 0.55, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Level Meter — a row of bars with caps.
 *
 * Each bar carries three incommensurate rhythms rather than one, and the
 * reason is the failure the single-sine version has: a row of bars driven by
 * one frequency with a phase offset per bar is a travelling wave, and a
 * travelling wave in the navbar is a barber's pole. Beat two unrelated periods
 * against each other and the row never falls into step with itself.
 *
 * The cap — the bright line riding the top of each bar — is what makes this
 * read as a level rather than as a bar chart. It is also the only part bright
 * enough to notice, which is the correct budget for the one element on screen
 * on every page.
 */
const EQUALIZER = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution;
  float bars = 64.0;
  float i = floor(p.x * bars);
  float f = fract(p.x * bars);

  float h = hash21(vec2(i, 3.0));
  float lvl = 0.16 + 0.40
    * (0.5 + 0.5 * sin(iTime * (0.5 + h * 0.9) + h * 30.0))
    * (0.5 + 0.5 * sin(iTime * 0.21 + i * 0.15));

  float gutter = step(0.14, f) * step(f, 0.86);
  float bar = step(p.y, lvl) * gutter;
  float cap = smoothstep(0.035, 0.0, abs(p.y - lvl)) * gutter;

  vec3 col = mix(uColor, uColor2, clamp(p.y / max(lvl, 0.001), 0.0, 1.0));
  float a = bar * 0.13 + cap * 0.36;
  a *= mix(1.0, 0.6, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Wake — ripples leaving the pointer.
 *
 * A train of three rings at even phase offsets, which is one expression and
 * costs what one ring costs. They thin AND dim as they travel: a ring that
 * keeps its brightness all the way out reads as a targeting reticle following
 * the cursor, where one that decays reads as a disturbance spreading through a
 * surface — which is the thing the header is meant to be.
 *
 * Desktop pointers only. `iMouse` parks far off-canvas when the pointer leaves,
 * so every distance goes large and the whole field resolves to nothing without
 * needing a special case.
 */
const WAKE = `
void mainImage(out vec4 o, in vec2 frag) {
  float d = length(frag - iMouse) / max(iResolution.y, 1.0);

  float rings = 0.0;
  for (int i = 0; i < 3; i++) {
    float ph = fract(iTime * 0.55 + float(i) / 3.0);
    rings += exp(-pow((d - ph * 1.6) * (16.0 - ph * 8.0), 2.0)) * (1.0 - ph);
  }

  float near = exp(-d * 6.0);

  vec3 col = mix(uColor, uColor2, clamp(d * 2.5, 0.0, 1.0));
  float a = rings * 0.30 + near * 0.10;
  a *= mix(1.0, 0.6, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Threads — strings across the bar that the pointer pushes apart.
 *
 * The displacement falls off with distance from the pointer and pushes each
 * thread AWAY from it, which is the difference between the bar reacting to
 * being touched and a cursor-shaped hole being punched through it. Sign of the
 * offset, not magnitude alone: threads above move up, threads below move down.
 *
 * It keeps a slow breath when nothing is pointing at it, because this is one
 * of the two header fields a phone will ever see and a dead strip on mobile is
 * a setting the operator switched on for nothing.
 */
const THREADS = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution;
  vec2 m = iMouse / max(iResolution, vec2(1.0));
  float aspect = iResolution.x / max(iResolution.y, 1.0);

  float dx = (p.x - m.x) * aspect;
  float dy = p.y - m.y;
  float pull = exp(-(dx * dx + dy * dy * 4.0) * 9.0);
  float y = p.y + sign(dy) * pull * 0.22;

  // Six threads, not nine, and drawn wider than a hairline. The nav bar is
  // about sixty pixels tall: nine periods across it put the threads seven
  // pixels apart and under a pixel wide, which at this alpha is not a set of
  // strings being pushed aside — it is a faint grey texture that happens to
  // dent. The thread has to be a THING for the displacement to read.
  float lines = 6.0;
  float f = abs(fract(y * lines) - 0.5);
  float w = fwidth(y * lines) + 0.001;
  float thread = 1.0 - smoothstep(0.0, 0.075 + w * 2.0, f);

  float drift = 0.85 + 0.15 * sin(p.x * 6.0 + iTime * 0.5);

  vec3 col = mix(uColor, uColor2, clamp(pull * 1.6, 0.0, 1.0));
  float a = thread * (0.07 + pull * 0.36) * drift;
  a *= mix(1.0, 0.65, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Ticker — a split-flap board going past.
 *
 * Sparse on purpose: a solid wall of lit blocks is a texture, and a board with
 * most of its cells dark reads as information moving. Three rows rather than
 * one, because a single row of blocks in a navbar is a progress bar and
 * everyone will read it as one.
 *
 * Blocks, not letters, for the same reason Data Rain uses them — a font here
 * means a texture, a texture means a fetch, and no part of this store is
 * allowed to wait on an asset arriving.
 */
const TICKER = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution;
  float cols = 70.0;
  float rows = 3.0;

  float x = p.x + iTime * 0.06;
  float cx = floor(x * cols);
  float fx = fract(x * cols);
  float cy = floor(p.y * rows);
  float fy = fract(p.y * rows);

  float h = hash21(vec2(cx, cy));
  float block = step(0.62, h)
    * step(0.12, fx) * step(fx, 0.88)
    * step(0.28, fy) * step(fy, 0.72);

  // The flap: a cell brightens as it turns over, on its own clock.
  float flip = smoothstep(0.0, 1.0, fract(h * 9.7 + iTime * 0.35));

  vec3 col = mix(uColor, uColor2, cy / max(rows - 1.0, 1.0));
  float a = block * (0.09 + flip * 0.22);
  a *= mix(1.0, 0.6, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Horizon — dawn across the strip, and nothing else.
 *
 * The quietest header on the board, and the one to reach for when the answer
 * to "should the navbar move" is really "no, but the room wants warmth". The
 * sun's traverse takes minutes; nothing here has a cycle short enough to
 * catch the eye of somebody reading the page underneath it.
 */
const HORIZON = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution;
  float t = iTime * 0.02;

  float sun = 0.35 + 0.30 * sin(t);
  float glow = exp(-distance(vec2(p.x, p.y * 0.6), vec2(sun, 0.15)) * 3.2);
  float sky = smoothstep(0.0, 1.4, p.y);
  float haze = fbm(vec2(p.x * 3.0, p.y * 1.5 + t)) * 0.10;

  vec3 col = mix(uColor, uColor2, clamp(glow * 1.4, 0.0, 1.0));
  float a = glow * 0.28 + (1.0 - sky) * 0.05 + haze * glow;
  a *= mix(1.0, 0.55, uIsLight);
  o = vec4(col, a);
}`;

/**
 * Filament — a wire strung along the bar that heats where you point at it.
 *
 * Heat, not light. The colour runs from the second colour to the first as the
 * wire gets hotter, which is what a filament does; brightening a fixed hue is
 * what a torch does, and the header already has a torch-shaped effect in Pulse
 * Grid. Two effects that differ only in geometry are one effect.
 *
 * The wire sags, and the sag wanders on a noise field, so the strip is not a
 * perfectly straight rule across the top of the store — a dead-straight line
 * there reads as a border somebody forgot to style.
 */
const FILAMENT = `${NOISE}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution;

  float sag = 0.5 - 0.06 * sin(p.x * 3.14159)
    - 0.02 * (fbm(vec2(p.x * 3.0, iTime * 0.15)) - 0.5);
  // Wide enough to see cold. At 42 the wire was a sub-pixel line on a 60px
  // bar and the only visible part was the heated spot, which made the effect
  // read as a glow following the pointer rather than as a wire being heated —
  // and left a phone, which never heats it, with nothing at all.
  float wire = exp(-pow((p.y - sag) * 24.0, 2.0));

  vec2 m = iMouse / max(iResolution, vec2(1.0));
  float heat = exp(-abs(p.x - m.x) * (iResolution.x / max(iResolution.y, 1.0)) * 3.0);

  // A travelling shimmer so the wire is alive on a phone, where no pointer
  // will ever heat it.
  float idle = 0.5 + 0.5 * sin(p.x * 8.0 - iTime * 0.8);

  vec3 col = mix(uColor2, uColor, clamp(heat * 1.3, 0.0, 1.0));
  float a = wire * (0.13 + idle * 0.07 + heat * 0.42);
  a *= mix(1.0, 0.6, uIsLight);
  o = vec4(col, a);
}`;

/* ── The seasonal five, header side ───────────────────────────────────────
 *
 * Every one of these works in units of BAR HEIGHT rather than in normalised
 * screen coordinates, and that is not a preference. The header is a strip
 * roughly sixty pixels tall and often fifteen hundred wide, so anything round
 * built on frag / iResolution ships as an ellipse fifteen times wider than it
 * is tall. Dividing by iResolution.y alone gives x running 0..aspect and y
 * running 0..1, in which a circle is a circle and a lane is a real distance.
 * Four of the five below would be unrecognisable without it.
 */

/**
 * Fizz — champagne rising through the bar.
 *
 * A bubble is its RIM. Filled discs read as a dot screen sliding upward; a
 * hollow ring with a lit edge reads as gas in a glass, and it costs the same
 * Gaussian either way — around the radius instead of around the centre.
 *
 * They wobble as they climb, because a column of perfectly vertical bubbles is
 * a string of pearls, and they thin out toward the top of the strip where they
 * would otherwise collide with the store's own chrome.
 */
const FIZZ = `${NOISE}${SEASON}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 u = frag / max(iResolution.y, 1.0);

  float rim = 0.0;
  float body = 0.0;
  float lane = 1.1;
  float i = floor(u.x / lane);

  for (int n = -1; n <= 1; n++) {
    float ci = i + float(n);
    for (int j = 0; j < 3; j++) {
      float fj = float(j);
      float h = hash21(vec2(ci, fj));
      float h2 = hash21(vec2(ci, fj + 21.0));
      float sp = 0.22 + h * 0.50;
      float y = fract(h2 * 5.3 + iTime * sp);
      float x = (ci + 0.5) * lane + (h - 0.5) * lane * 0.7
        + 0.035 * sin(iTime * (1.1 + h) + y * 9.0);
      float r = 0.048 + h2 * 0.075;
      float dd = length(vec2(u.x - x, u.y - y));
      /* Bubbles fade as they near the top rather than popping at it: a ring
         that vanishes on a hard edge draws attention to the edge. */
      float live = smoothstep(1.02, 0.72, y);
      rim += exp(-pow((dd - r) * 90.0, 2.0)) * live;
      body += exp(-dd * 24.0) * live * 0.5;
    }
  }

  vec3 col = mix(uColor, uColor2, clamp(u.y, 0.0, 1.0));
  float a = rim * 0.32 + body * 0.05;
  a *= mix(1.0, 0.85, uIsLight);
  o = vec4(seasonalInk(col), min(a, 0.45));
}`;

/**
 * Icicles — ice hanging from the top edge of the bar.
 *
 * The taper is a square root, not a line. An icicle is fat at the eaves and
 * draws to a long fine point; a linear taper gives you a row of isosceles
 * triangles, which is bunting, which is the effect four entries down.
 *
 * A fifth of the columns carry no icicle at all. An even row of equal spikes
 * is a comb, and a comb across the top of a navbar reads as a border that
 * failed to render rather than as weather.
 */
const ICICLES = `${NOISE}${SEASON}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = frag / iResolution;
  float depth = 1.0 - p.y;

  float n = 46.0;
  float i = floor(p.x * n);
  float f = fract(p.x * n) - 0.5;

  float ice = 0.0;
  float edge = 0.0;
  float tip = 0.0;

  for (int k = -1; k <= 1; k++) {
    float ii = i + float(k);
    float ff = f - float(k);
    float h = hash21(vec2(ii, 2.0));
    float h2 = hash21(vec2(ii, 9.0));
    float len = (0.18 + h * 0.62) * step(0.22, h2);
    float w = 0.42 * sqrt(max(1.0 - depth / max(len, 0.001), 0.0));
    float inside = step(abs(ff), w) * step(depth, len);
    ice += inside;
    /* Ice is bright at its edges and hollow in the middle — the light goes
       round the outside of it, which is why a solid wedge reads as plastic. */
    edge += inside * smoothstep(w * 0.35, w, abs(ff));
    tip += exp(-pow((depth - len) * 26.0, 2.0)) * step(abs(ff), 0.12) * step(0.05, len);
  }

  /* A glint travelling along the row: the ice is being LIT, not drawn. */
  float glint = exp(-pow((p.x - fract(iTime * 0.09)) * 5.0, 2.0));

  vec3 col = mix(uColor2, uColor, clamp(edge + glint * 0.7, 0.0, 1.0));
  float a = ice * 0.06 + edge * 0.15 + tip * 0.24 + ice * glint * 0.20;
  a *= mix(1.0, 0.85, uIsLight);
  o = vec4(seasonalInk(col), min(a, 0.45));
}`;

/**
 * Drip — something viscous coming off the top edge.
 *
 * The cycle is the effect: swell, hang, stretch, release, reset — each lane on
 * its own slow clock. A row of static drips is a decorative border; a row
 * where one lane is always about to let go is unpleasant in exactly the way
 * the season wants.
 *
 * The released bead keeps falling after the stem snaps back, which is the
 * detail that sells it. Snapping both at once reads as the whole thing
 * blinking.
 */
const DRIP = `${NOISE}${SEASON}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 u = frag / max(iResolution.y, 1.0);
  float depth = 1.0 - u.y;

  float lane = 0.62;
  float i = floor(u.x / lane);

  float goo = 0.0;
  float lit = 0.0;

  for (int k = -1; k <= 1; k++) {
    float ii = i + float(k);
    float h = hash21(vec2(ii, 4.0));
    float h2 = hash21(vec2(ii, 17.0));
    float cx = (ii + 0.5) * lane + (h - 0.5) * lane * 0.45;
    float dx = u.x - cx;

    float cyc = fract(iTime * (0.045 + h * 0.05) + h2 * 3.1);
    float len = (0.10 + 0.52 * smoothstep(0.0, 0.80, cyc)) * step(0.25, h2);

    /* The stem narrows as it stretches — surface tension, and the reason the
       bead at the end looks heavy. */
    float stem = 0.105 * (1.0 - 0.55 * clamp(depth / max(len, 0.001), 0.0, 1.0));
    float body = step(depth, len) * step(0.0, depth)
      * smoothstep(stem, stem * 0.5, abs(dx));

    float br = 0.075 + 0.055 * smoothstep(0.30, 1.0, cyc);
    float bead = smoothstep(br, br * 0.55, length(vec2(dx, depth - len)));

    /* Released, and still falling while the stem has already recoiled. */
    float fall = max(cyc - 0.86, 0.0) * 7.5;
    float drop = step(0.86, cyc)
      * smoothstep(br * 0.9, br * 0.45, length(vec2(dx, depth - len - fall)));

    goo += body + bead + drop;
    /* A highlight down one side, so the goo has a volume. */
    lit += (bead + drop) * smoothstep(0.0, br * 0.8, dx + br * 0.30);
  }

  vec3 col = mix(uColor, uColor2, clamp(lit * 0.9, 0.0, 1.0));
  float a = goo * 0.22 + lit * 0.16;
  a *= mix(1.0, 0.9, uIsLight);
  o = vec4(seasonalInk(col), min(a, 0.45));
}`;

/**
 * Blossom — plum petals crossing the bar.
 *
 * Drift, not fall. The header is wide and shallow: anything moving downward
 * leaves it in under a second, so a falling-petal field in a navbar is a
 * flicker. These cross it instead, tumbling on their own axes as they go, and
 * the tumble is what stops the row reading as one texture sliding sideways.
 *
 * The petal is an ellipse with a taper along x, which is the cheapest shape
 * that is not a lozenge. Under half the cells carry one — a wall of petals is
 * confetti, and confetti is a different holiday.
 */
const BLOSSOM = `${NOISE2}${SEASON}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 u = frag / max(iResolution.y, 1.0);

  float cell = 0.52;
  vec2 g = vec2(u.x + iTime * 0.055, u.y) / cell;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;

  float petals = 0.0;
  float tint = 0.0;

  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 cid = vec2(float(x), float(y));
      vec2 nid = id + cid;
      vec2 h = hash22(nid);
      float on = step(0.45, hash21(nid + 7.0));

      vec2 d = f - cid - (h - 0.5) * 0.6;
      d.y += 0.09 * sin(iTime * (0.6 + h.x) + h.y * 12.0);
      d = rot2(h.x * 6.28318 + iTime * (0.25 + h.y * 0.4)) * d;

      /* Clamped, because the taper multiplies the half-height and a half-height
         that reaches zero is a divide by zero straight down the middle of every
         petal on screen. */
      float taper = 0.098 * clamp(1.0 - d.x * 1.7, 0.28, 1.6);
      float pd = length(d / vec2(0.21, taper));
      float m = smoothstep(1.0, 0.55, pd) * on;
      petals += m;
      tint += m * h.y;
    }
  }

  vec3 col = mix(uColor, uColor2, clamp(tint * 1.4, 0.0, 1.0));
  float a = petals * 0.32;
  a *= mix(1.0, 0.9, uIsLight);
  o = vec4(seasonalInk(col), min(a, 0.45));
}`;

/**
 * Bunting — triangular flags on a sagging line.
 *
 * The flutter is a SHEAR, not a rotation. Cloth pinned along its top edge
 * bends away from the pin and the point swings furthest; a flag rotated about
 * its centre swings its top edge off the string it is supposedly tied to, and
 * once you have seen that you cannot unsee it.
 *
 * Flags alternate the operator's two colours, which is the one place on this
 * board where strict alternation is right: bunting is made that way, and the
 * regularity is the charm rather than the tell.
 */
const BUNTING = `${NOISE}${SEASON}
void mainImage(out vec4 o, in vec2 frag) {
  vec2 u = frag / max(iResolution.y, 1.0);
  float aspect = iResolution.x / max(iResolution.y, 1.0);
  float nx = u.x / max(aspect, 0.001);

  /* The line, pinned off both edges and sagging in between. */
  float sag = 0.10 + 0.012 * sin(iTime * 0.4);
  float lineAt = 0.94 - sag * (1.0 - cos(nx * 6.28318)) * 0.5;
  float wire = 1.0 - smoothstep(0.0, fwidth(lineAt) * 2.0 + 0.006, abs(u.y - lineAt));

  float lane = 0.78;
  float i = floor(u.x / lane);

  float flag = 0.0;
  float edge = 0.0;
  float alt = 0.0;

  for (int k = -1; k <= 1; k++) {
    float ii = i + float(k);
    float cx = (ii + 0.5) * lane;
    float snx = cx / max(aspect, 0.001);
    float sy = 0.94 - sag * (1.0 - cos(snx * 6.28318)) * 0.5;

    float h = hash21(vec2(ii, 5.0));
    float len = 0.46 + h * 0.12;
    float depth = sy - u.y;

    float bend = 0.13 * sin(iTime * 1.4 + ii * 0.8);
    float dx = (u.x - cx) + bend * depth;
    /* Named 'hw', not 'half': GLSL ES reserves 'half' and the compiler's
       complaint is a syntax error two tokens later, which sends you looking at
       the wrong line. */
    float hw = 0.30 * (1.0 - depth / len);

    float inFlag = step(0.0, depth) * step(depth, len) * step(abs(dx), max(hw, 0.0));
    flag += inFlag;
    edge += inFlag * smoothstep(hw * 0.5, hw, abs(dx));
    alt += inFlag * mod(ii, 2.0);
  }

  vec3 col = mix(uColor, uColor2, clamp(alt, 0.0, 1.0));
  float a = flag * 0.16 + edge * 0.11 + wire * 0.12;
  /* Not damped at all. Bunting is cloth over a pale sky at least as often as
     over a dark one, and this is the strip a light-mode store runs. */
  o = vec4(seasonalInk(col), min(a, 0.45));
}`;

/**
 * The roster the admin editor renders from.
 *
 * `custom` is not in here: it is the absence of a built-in, and the editor
 * reads the operator's own source instead. Keeping it out of the map means
 * `SHADERS[name]` returning undefined is exactly the "they wrote their own"
 * case rather than an error state to special-case.
 */
export const BACKGROUND_SHADERS = {
  'aurora-veil': {
    label: 'Aurora veil',
    hint: 'Curtains of light folded through a domain-warped noise field, sliced into bands so the eye has an edge to follow.',
    source: AURORA_VEIL,
  },
  nebula: {
    label: 'Nebula',
    hint: 'Four layers of cloud at different depths, vignetted off the edges where the store\'s own chrome lives.',
    source: NEBULA,
  },
  caustics: {
    label: 'Caustics',
    hint: 'Light through moving water — the bright interlocking web a pool floor has. Lines where the field is thin, not where a particle is.',
    source: CAUSTICS,
  },
  'ink-drift': {
    label: 'Ink drift',
    hint: 'Slow marbling: filaments where the noise crosses its own mean. The successor to the old CPU marble, and this one actually moves.',
    source: INK_DRIFT,
  },
  'warp-field': {
    label: 'Warp field',
    hint: 'A starfield with three depths of parallax. Cell noise, so a thousand stars cost what one does.',
    source: WARP_FIELD,
  },
  contours: {
    label: 'Survey lines',
    hint: 'A contour map of a slowly bending height field, with every fifth line drawn heavier. The one field that reads as a drawn document rather than as weather.',
    source: CONTOURS,
  },
  'rain-glass': {
    label: 'Rain glass',
    hint: 'Drops sliding down a pane, each leaving a chain of beads in its track. They hang, then run — surface tension, not gravity.',
    source: RAIN_GLASS,
  },
  lamp: {
    label: 'Slow lamp',
    hint: 'Six metaballs merging and parting in a jar. The neck that stretches between two of them is the part no particle system can draw.',
    source: LAMP,
  },
  crystal: {
    label: 'Crystal',
    hint: 'A Voronoi fracture whose facets shear against each other. Edges where the field cannot decide which seed owns the pixel.',
    source: CRYSTAL,
  },
  halftone: {
    label: 'Halftone',
    hint: 'A printed dot screen at 15°, dot size following a slow tone. The one field designed for a pale ground — it barely damps in light mode.',
    source: HALFTONE,
  },
  circuit: {
    label: 'Circuit',
    hint: 'Routed traces with vias, and a charge that hops cell to cell along them rather than sweeping across like a torch.',
    source: CIRCUIT,
  },
  silk: {
    label: 'Silk',
    hint: 'A warp and a weft of fine fibres, bent by their own noise, under a sheen that travels across the cloth.',
    source: SILK,
  },
  shafts: {
    label: 'Light shafts',
    hint: 'Beams entering from off the top corner. The occluder is noise over ANGLE, so the shafts stay parallel the way real ones do.',
    source: SHAFTS,
  },
  dunes: {
    label: 'Dunes',
    hint: 'A ground plane in fake perspective, lit from the side so the crests read. Everything above the horizon is left to your background.',
    source: DUNES,
  },
  bokeh: {
    label: 'Bokeh',
    hint: 'Defocused lights drifting up through three depths, each a disc with a lit rim — the aperture\'s shape, which is what makes it bokeh and not fog.',
    source: BOKEH,
  },
  datastream: {
    label: 'Data rain',
    hint: 'Columns of falling glyphs, reshuffled a few times a second. Block masks rather than letters: a font would mean a fetch.',
    source: DATASTREAM,
  },
  truchet: {
    label: 'Truchet',
    hint: 'One coin flip per tile builds a single continuous maze of arcs, with a pulse that follows the curve around each corner.',
    source: TRUCHET,
  },
  'mesh-wash': {
    label: 'Mesh wash',
    hint: 'Four colour centres, weighted and blended. The quietest field here: colour in the room with nothing for the eye to follow.',
    source: MESH_WASH,
  },
  embers: {
    label: 'Embers',
    hint: 'Sparks rising off a floor that is still warm, each swaying at its own rate. Without the sway it is snow played backwards.',
    source: EMBERS,
  },
  hexcells: {
    label: 'Hex cells',
    hint: 'A honeycomb lattice with a wave that lights whole cells, never parts of them.',
    source: HEXCELLS,
  },
  fireworks: {
    label: 'Fireworks',
    hint: 'Shells that climb before they open, then sag under their own weight. The ascent is half of it — without it they read as flashbulbs going off behind the shop.',
    source: FIREWORKS,
  },
  garland: {
    label: 'Garland',
    hint: 'Four strings of bulbs swagged across the room, every bulb twinkling on its own clock. A synchronised string is a hazard beacon.',
    source: GARLAND,
  },
  witchlight: {
    label: 'Witchlight',
    hint: 'Wisps wandering a quasi-periodic path over a low ground mist, each trailing four samples of where it actually was.',
    source: WITCHLIGHT,
  },
  lanterns: {
    label: 'Lanterns',
    hint: 'Paper lanterns climbing and leaning, ribbed where the frame shows through the paper and lit from the candle inside.',
    source: LANTERNS,
  },
  eggshell: {
    label: 'Eggshell',
    hint: 'Dye, speckle and craquelure on a pale ground. The second field here built FOR light mode rather than damped into it.',
    source: EGGSHELL,
  },
};

export const HEADER_SHADERS = {
  'pulse-grid': {
    label: 'Pulse grid',
    hint: 'A grid that rests almost invisible and sends a ring travelling out from the pointer. Desktop pointers only — it has nothing to answer on a phone.',
    source: PULSE_GRID,
    pointer: true,
  },
  ribbon: {
    label: 'Ribbon',
    hint: 'A slow band of light crossing the header. The one header effect that runs without a pointer, so it is also the one a phone sees.',
    source: RIBBON,
    pointer: false,
  },
  scanlines: {
    label: 'Scanlines',
    hint: 'Phosphor lines with a bar sweeping down through them. Pairs with the Phosphor preset.',
    source: SCANLINES,
    pointer: false,
  },
  'aurora-bar': {
    label: 'Aurora bar',
    hint: 'The background curtain compressed into the strip, stretched along x so it reads as bands rather than one vertical smear. No pointer needed.',
    source: AURORA_BAR,
    pointer: false,
  },
  equalizer: {
    label: 'Level meter',
    hint: 'Bars with bright caps, each on three unrelated rhythms so the row never falls into step and becomes a barber\'s pole.',
    source: EQUALIZER,
    pointer: false,
  },
  wake: {
    label: 'Wake',
    hint: 'A train of ripples leaving the pointer, thinning and dimming as they go. Desktop pointers only.',
    source: WAKE,
    pointer: true,
  },
  threads: {
    label: 'Threads',
    hint: 'Strings across the bar that the pointer pushes apart and that settle back. Keeps a slow breath where there is no pointer at all.',
    source: THREADS,
    pointer: true,
  },
  ticker: {
    label: 'Ticker',
    hint: 'A sparse split-flap board going past on three rows. Sparse is the point — a solid wall of blocks is a texture.',
    source: TICKER,
    pointer: false,
  },
  horizon: {
    label: 'Horizon',
    hint: 'A sun crossing the strip over minutes. The quietest header here, for when the honest answer is "the navbar should not move".',
    source: HORIZON,
    pointer: false,
  },
  filament: {
    label: 'Filament',
    hint: 'A sagging wire that heats toward your first colour where you point at it. Heat rather than light, so it is not Pulse Grid in another shape.',
    source: FILAMENT,
    pointer: true,
  },
  fizz: {
    label: 'Fizz',
    hint: 'Champagne rising through the bar. A bubble is its rim — filled discs read as a dot screen sliding upward.',
    source: FIZZ,
    pointer: false,
  },
  icicles: {
    label: 'Icicles',
    hint: 'Ice off the top edge, tapering on a square root so it draws to a point rather than to a triangle, with a glint travelling the row.',
    source: ICICLES,
    pointer: false,
  },
  drip: {
    label: 'Drip',
    hint: 'Something viscous swelling, stretching and letting go, each lane on its own slow clock. The bead keeps falling after the stem recoils.',
    source: DRIP,
    pointer: false,
  },
  blossom: {
    label: 'Blossom',
    hint: 'Plum petals crossing the strip and tumbling as they go. They drift rather than fall — a navbar is too shallow for anything to fall through.',
    source: BLOSSOM,
    pointer: false,
  },
  bunting: {
    label: 'Bunting',
    hint: 'Triangular flags on a sagging line, alternating your two colours. The flutter is a shear, because cloth pinned along its top edge bends.',
    source: BUNTING,
    pointer: false,
  },
};

/** Resolve a stored name to its source, or null when the operator wrote it. */
export function shaderSource(roster, name) {
  return roster[name]?.source || null;
}

/** A starting point for the custom box — a real, working shader to edit. */
export const STARTER_SHADER = `// Runs once per pixel, every frame.
//
// Available to you:
//   iResolution  canvas size in pixels
//   iTime        seconds since the effect started
//   iMouse       pointer position in pixels (header effects)
//   uColor       your effect colour, as rgb 0-1
//   uColor2      the second glow colour
//   uIsLight     1.0 in light mode, 0.0 in dark
//
// Keep the alpha low — this draws OVER your background, it does not replace it.

void mainImage(out vec4 o, in vec2 frag) {
  vec2 p = (frag - 0.5 * iResolution) / iResolution.y;

  float rings = sin(length(p) * 18.0 - iTime * 1.4);
  float a = smoothstep(0.7, 1.0, rings) * 0.18;

  // Fade out toward the edges so it does not fight the page furniture.
  a *= smoothstep(1.1, 0.1, length(p));
  a *= mix(1.0, 0.6, uIsLight);

  o = vec4(mix(uColor, uColor2, length(p)), a);
}`;
