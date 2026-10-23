/**
 * The particle systems behind the new ambient effects, one spec per effect,
 * all run by AmbientCanvas. Constants are tuned per-frame-at-60Hz (`k` is
 * frame-equivalents), matching the originals.
 *
 * Every spec keeps alphas low. These are atmosphere: a visitor should feel
 * them before they can point at them.
 *
 * "Particle" is the engine's word, not a physical claim. A spec's unit of
 * work is whatever the engine can create, resize, update and draw
 * independently — a snowflake, an aurora curtain, a vein of stone. Keeping
 * field effects inside that same contract is why AmbientCanvas needs no
 * per-effect branch: the lifecycle fix that lands in the engine lands
 * everywhere, which was the whole reason the engine exists.
 */

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

const TAU = Math.PI * 2;

/* ── Snow ──
   Slow flakes with individual sway. Sway phase advances with time and the
   flake's own frequency, so no two flakes swing together — synchronized
   snow reads instantly as an animation loop, which is the one thing to
   avoid. Big flakes fall faster and blur less: cheap depth. */
class SnowFlake {
  constructor(w, h, initial) {
    this.w = w; this.h = h;
    this.reset(initial);
  }

  reset(initial = false) {
    this.x = Math.random() * this.w;
    this.y = initial ? Math.random() * this.h : -10 - Math.random() * 40;
    this.r = rand(0.8, 3.2);
    this.speed = 0.3 + this.r * 0.22;
    this.sway = rand(0.4, 1.4);
    this.swaySpeed = rand(0.008, 0.022);
    this.phase = Math.random() * Math.PI * 2;
    this.alpha = rand(0.25, 0.7) * (this.r / 3.2);
  }

  resize(w, h) {
    if (this.w > 0) this.x *= w / this.w;
    if (this.h > 0) this.y *= h / this.h;
    this.w = w; this.h = h;
  }

  update(k, w, h) {
    this.w = w; this.h = h;
    this.phase += this.swaySpeed * k;
    this.y += this.speed * k;
    this.x += Math.sin(this.phase) * this.sway * 0.3 * k;
    if (this.y - 4 > h) this.reset(false);
    if (this.x < -6) this.x = w + 4;
    if (this.x > w + 6) this.x = -4;
  }

  draw(ctx, rgb) {
    ctx.globalAlpha = Math.min(1, this.alpha);
    ctx.fillStyle = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export const snowSpec = {
  colorKey: 'theme_snow_color',
  count: (w, h) => Math.min(Math.floor((w * h) / 12000), 140),
  create: (w, h, initial) => new SnowFlake(w, h, initial),
};

/* ── Shared value noise ──
   Aurora's field. It was shared with Marble until that effect moved to the
   fragment stage (see the note at the foot of this file), and it stays up here
   rather than folded into AuroraRay for the reason it was hoisted originally:
   the next field effect on this engine will want it, and a copy is how two
   noise functions come to disagree. */

/** Deterministic hash → [0,1). imul keeps the mixing in int32 where it belongs. */
function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise with a smoothstep fade — cheaper than gradient noise and, at
    three octaves under a domain warp, indistinguishable in the result. */
function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * u;
  const bot = c + (d - c) * u;
  return top + (bot - top) * v;
}

/**
 * Three octaves, not four.
 *
 * The fourth octave is a quarter-amplitude wobble that the upscale from the
 * low-resolution buffer blurs away completely, and it costs a third of the
 * whole field's budget. Dropping it is invisible in the result and is what
 * keeps the recompute inside a frame.
 */
function fbm(x, y, seed) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < 3; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 101) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/* ── Aurora ──
   Hundreds of soft light columns drifting through a noise field.

   This replaces a curtain-based version — a handful of tall gradient sheets,
   each drawn as ~320 vertical slices under an accumulating transform. That
   one was built around the physics (a hot lower edge, ray texture inside the
   sheet, a violet fringe above the green) and it drew a recognisable aurora,
   but only four of them, so the page had four large objects moving across it.
   The look asked for here is the opposite trade: many small emitters instead
   of few large ones, which reads as atmosphere rather than as scenery.

   What each ray is: a vertical capsule of light, a few tens of pixels wide
   and a fifth of the viewport tall, that fades up from nothing, drifts, and
   fades back out. Nothing is ever drawn at full strength and nothing has an
   edge — a ray is two strokes, both carrying a gradient that reaches zero at
   both ends, so it has no cap to see.

   Three things do the work:

     1. **Noise steers them, not a velocity.** Each ray reads the shared fBm
        field at its own position and is pushed sideways by it. Neighbouring
        rays therefore lean together, which is what makes the whole field look
        like one moving thing rather than N independent streaks. The field
        itself advances with time, so the lean changes.

     2. **Every ray has a life.** It is born at a random phase, fades in,
        drifts, fades out, and is reborn somewhere else. Without this the
        field is static in composition — the same rays in the same places
        forever — and the eye finds them and stops seeing an aurora.

     3. **Two colours, derived.** Same reasoning the curtain version used and
        worth keeping: one flat colour cannot be an aurora. A fraction of the
        rays are drawn in a hue-rotated companion to the operator's colour, so
        a cyan store gets cyan-and-blue rather than cyan-and-hardcoded-purple.

   Rays are NOT additively composited. With this many overlapping emitters
   `lighter` saturates to white in a second; `screen` (and `multiply` on a
   pale ground, for the reason the blend comment gives) approaches the
   colour asymptotically instead. */

/**
 * Hue-rotate an {r,g,b}, keeping saturation and lightness.
 *
 * Here so the companion colour tracks whatever the operator chose, instead of
 * a hardcoded purple that clashes with every palette that is not the default.
 * +115° from the stock green lands on the violet of every aurora photograph
 * ever taken; from a cyan it lands on blue, from a magenta on amber — in each
 * case a warmer companion to the core, which is the structure being drawn
 * rather than the exact hue.
 */
function rotateHue({ r, g, b }, degrees) {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { r, g, b }; // grey has no hue to rotate
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  h = (h + degrees / 360) % 1;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const pp = 2 * l - q;
  const hue2 = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return pp + (q - pp) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return pp + (q - pp) * (2 / 3 - tt) * 6;
    return pp;
  };
  return {
    r: Math.round(hue2(h + 1 / 3) * 255),
    g: Math.round(hue2(h) * 255),
    b: Math.round(hue2(h - 1 / 3) * 255),
  };
}

/** Noise cells across the viewport. Low, so neighbouring rays agree. */
const AURORA_FIELD = 1.6;
/** How far the field can push a ray sideways, as a fraction of viewport width. */
const AURORA_PUSH = 0.055;
/** Field evolution, in noise cells per second — the same slow-drift rule the
    marble learned: fast enough to change, too slow to watch. */
const AURORA_FLOW_PER_SEC = 0.02;

class AuroraRay {
  constructor(w, h, initial) {
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
    this.seed = (Math.random() * 1e6) | 0;
    this.reset(initial);
    // Born mid-life on the first fill, so the effect does not open with every
    // ray at zero alpha and visibly swell in together.
    if (initial) this.life = rand(0, this.ttl);
  }

  reset(initial) {
    this.x = rand(-0.05, 1.05) * this.w;
    // Concentrated in the upper two-thirds. An aurora hangs; rays rooted at
    // the bottom of the page read as a fire.
    this.y = rand(-0.10, 0.72) * this.h;
    this.len = rand(0.16, 0.46) * this.h;
    // Width tracks the viewport so a phone gets proportionally fat rays
    // rather than 200 hairlines.
    this.width = rand(this.w / 190, this.w / 65);
    this.ttl = rand(160, 420);
    this.life = initial ? rand(0, this.ttl) : 0;
    this.rise = rand(0.02, 0.10);      // px/frame upward
    this.sway = rand(0.6, 1.5);        // how hard this ray answers the field
    // A minority wear the companion hue. Enough to be a second colour, not so
    // many that the field reads as two-tone.
    this.fringe = Math.random() < 0.34;
    this.peak = rand(0.05, 0.13);
  }

  resize(w, h) {
    // Re-proportion rather than re-roll: a resize must not replace the sky.
    const sx = w / this.w;
    const sy = h / this.h;
    this.x *= sx;
    this.y *= sy;
    this.len *= sy;
    this.width *= sx;
    this.w = Math.max(1, w);
    this.h = Math.max(1, h);
  }

  update(k) {
    this.life += k;
    if (this.life >= this.ttl) {
      this.reset(false);
      return;
    }
    // `k` is frame-equivalents at 60Hz, so `k / 60` is seconds — the unit the
    // flow constant is named in. (The marble shipped this conversion the wrong
    // way round once and crossed the screen every second for it.)
    this.t = (this.t || 0) + AURORA_FLOW_PER_SEC * (k / 60);
    const n = fbm(
      (this.x / this.w) * AURORA_FIELD + this.t,
      (this.y / this.h) * AURORA_FIELD,
      this.seed,
    );
    this.x += (n - 0.5) * 2 * AURORA_PUSH * this.w * this.sway * k * 0.06;
    this.y -= this.rise * k;
    // Wrap generously, so a ray never appears or vanishes at a screen edge.
    if (this.x < -0.12 * this.w) this.x += 1.24 * this.w;
    if (this.x > 1.12 * this.w) this.x -= 1.24 * this.w;
    if (this.y + this.len < -0.1 * this.h) this.y = 1.05 * this.h;
  }

  draw(ctx, rgb) {
    // Sine over the life: zero at both ends, so a ray has no birth or death
    // to catch, only a presence that comes and goes.
    const fade = Math.sin(Math.PI * (this.life / this.ttl));
    const a = this.peak * fade * fade;
    if (a <= 0.002) return;

    const c = this.fringe ? rotateHue(rgb, 115) : rgb;
    const rs = `${c.r},${c.g},${c.b}`;
    const y0 = this.y;
    const y1 = this.y + this.len;

    // Transparent at both ends: this is what removes the cap. A round-capped
    // stroke is still a hard-edged circle, and at this size that reads as a
    // lozenge rather than as light.
    const grad = ctx.createLinearGradient(0, y0, 0, y1);
    grad.addColorStop(0, `rgba(${rs},0)`);
    grad.addColorStop(0.35, `rgba(${rs},1)`);
    grad.addColorStop(0.62, `rgba(${rs},0.85)`);
    grad.addColorStop(1, `rgba(${rs},0)`);
    ctx.strokeStyle = grad;

    ctx.beginPath();
    ctx.moveTo(this.x, y0);
    ctx.lineTo(this.x, y1);

    // Two passes, wide-and-faint under narrow-and-brighter. The wide pass is
    // the halo that a blur would otherwise have to produce — and `ctx.filter`
    // costs a full-canvas filter pass per frame, which is the thing that puts
    // an effect like this outside a phone's budget.
    ctx.globalAlpha = a * 0.45;
    ctx.lineWidth = this.width * 2.6;
    ctx.stroke();

    ctx.globalAlpha = a;
    ctx.lineWidth = this.width;
    ctx.stroke();
  }
}

export const auroraSpec = {
  colorKey: 'theme_aurora_color',
  // Many small emitters, capped so a 4K monitor does not quietly ask for
  // three thousand strokes a frame. At 1440x900 this is ~185.
  count: (w, h) => Math.max(40, Math.min(Math.round((w * h) / 7000), 240)),
  create: (w, h, initial) => new AuroraRay(w, h, initial),
  // An aurora is light being ADDED to a dark sky, so `screen` is the operator
  // that describes it — on a dark ground. On a pale one it describes nothing:
  // screening green onto near-white leaves near-white, and the whole effect
  // faded to a mint smudge the moment a store ran in light mode. `multiply`
  // is the same physical idea seen the other way round on a bright ground —
  // the light tints what is behind it.
  blend: (mode) => (mode === 'light' ? 'multiply' : 'screen'),
};

/* ── Marble, retired ────────────────────────────────────────────────────
   The marble slab lived here until 2026-08-29. It was a fragment shader
   written in JavaScript: three octaves of value noise under a domain warp,
   solved on the CPU into an offscreen bitmap, re-solved from scratch whenever
   the resolved colour changed, and drawn as one "particle" that happened to be
   the whole slab.

   It worked, and the shape of it was the argument for the WebGL2 engine that
   replaced it. Two things the CPU version could never afford:

     - The veins were FROZEN. Re-solving a full-viewport noise field per frame
       is not affordable on one core, so the slab shimmered in place and the
       stone never actually moved. `ink-drift` in components/effects/shaders.js
       is the same idea in the fragment stage, where per-frame is the only mode
       there is.
     - It re-solved on a colour change, which meant dragging the colour picker
       in the admin editor rebuilt a full-screen bitmap per input event.

   `effects_marble` and `theme_marble_color` are gone: any store that had it
   switched on was moved to the shader, and 20260917000000 deleted the rows.
   Nothing here is coming back — this note exists so the next person who finds
   `warpField` referenced in an old comment knows where it went and why. */
