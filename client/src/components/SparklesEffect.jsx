import { useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';
import { parseHex } from '../theme/color';
import { DEFAULT_THEME, lightKey } from '../theme/defaults';
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion';

/**
 * The sparkle colour, falling back through the live palette rather than a
 * hard-coded literal. The old copy of this fell back to `#22d3ee`, which stopped
 * being the brand colour when the palette moved to `#2dd4e8`.
 */
function resolveEffectHex(settings, resolvedMode, key) {
  const primaryKey = resolvedMode === 'light' ? lightKey('theme_primary') : 'theme_primary';
  const candidates = [settings[key], settings[primaryKey], DEFAULT_THEME[primaryKey]];
  for (const c of candidates) if (parseHex(c)) return c;
  return DEFAULT_THEME.theme_primary;
}

// Reference radius the sprites are drawn at. Particles top out around 3.3px, so
// every draw downscales the sprite and stays crisp even at DPR 2.
const SPRITE_S = 16;
// Star: outer point at `s`, shadowBlur at `s * 4` — 5s of half-extent, plus slack.
const STAR_UNIT = 5.5;
// Core dot: radius `s * 0.25`, shadowBlur `s * 2`.
const CORE_UNIT = 2.6;

/**
 * Pre-render the star and its bright core once per colour.
 *
 * The previous version ran `save`/`translate`/`shadowBlur` + two path fills per
 * particle per frame; at the 180 cap that is ~360 shadowed fills every frame,
 * and canvas shadows are the single most expensive thing in the 2D API. Two
 * `drawImage` calls with `globalAlpha` produce the same picture for free.
 */
function makeSprites(r, g, b) {
  const fill = `rgb(${r},${g},${b})`;
  const glow = `rgba(${r},${g},${b},0.9)`;

  const starPad = SPRITE_S * STAR_UNIT;
  const star = document.createElement('canvas');
  star.width = star.height = Math.ceil(starPad * 2);
  const sctx = star.getContext('2d');
  sctx.translate(starPad, starPad);
  sctx.fillStyle = fill;
  sctx.shadowColor = glow;
  sctx.shadowBlur = SPRITE_S * 4;
  sctx.beginPath();
  for (let i = 0; i < 4; i++) {
    const outer = (i * Math.PI) / 2;
    const inner = outer + Math.PI / 4;
    const ox = Math.cos(outer) * SPRITE_S;
    const oy = Math.sin(outer) * SPRITE_S;
    if (i === 0) sctx.moveTo(ox, oy);
    else sctx.lineTo(ox, oy);
    sctx.lineTo(Math.cos(inner) * (SPRITE_S * 0.3), Math.sin(inner) * (SPRITE_S * 0.3));
  }
  sctx.closePath();
  sctx.fill();

  const corePad = SPRITE_S * CORE_UNIT;
  const core = document.createElement('canvas');
  core.width = core.height = Math.ceil(corePad * 2);
  const cctx = core.getContext('2d');
  cctx.translate(corePad, corePad);
  cctx.shadowColor = glow;
  cctx.shadowBlur = SPRITE_S * 2;
  cctx.fillStyle = '#ffffff';
  cctx.beginPath();
  cctx.arc(0, 0, SPRITE_S * 0.25, 0, Math.PI * 2);
  cctx.fill();

  return { star, core };
}

class Sparkle {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.reset();
    // Start scattered across screen
    this.y = Math.random() * h;
    this.opacity = Math.random() * this.maxOpacity;
    this.phase = Math.random() > 0.5 ? 'hold' : 'out';
    this.holdCounter = Math.random() * this.holdTime;
  }

  reset() {
    this.x = Math.random() * this.w;
    this.y = this.h + Math.random() * 20;
    this.size = Math.random() * 2.5 + 0.8;
    this.opacity = 0;
    this.maxOpacity = Math.random() * 0.75 + 0.25;
    this.vy = -(Math.random() * 0.4 + 0.15);
    this.vx = (Math.random() - 0.5) * 0.3;
    this.phase = 'in';
    this.holdTime = Math.random() * 80 + 30;
    this.holdCounter = 0;
    this.twinkle = Math.random() * Math.PI * 2;
    this.twinkleSpeed = Math.random() * 0.08 + 0.03;
  }

  /**
   * Move the particle into a new viewport without restarting its life. Resize
   * fires continuously on mobile while the URL bar collapses; re-seeding there
   * made the whole field blink.
   */
  resize(w, h) {
    if (this.w > 0) this.x *= w / this.w;
    if (this.h > 0) this.y *= h / this.h;
    this.w = w;
    this.h = h;
  }

  /** @param {number} k frame-equivalents elapsed (1 === one frame at 60Hz). */
  update(k) {
    this.twinkle += this.twinkleSpeed * k;
    if (this.phase === 'in') {
      this.opacity += 0.025 * k;
      if (this.opacity >= this.maxOpacity) {
        this.opacity = this.maxOpacity;
        this.phase = 'hold';
      }
    } else if (this.phase === 'hold') {
      this.holdCounter += k;
      if (this.holdCounter >= this.holdTime) this.phase = 'out';
    } else {
      this.opacity -= 0.018 * k;
      if (this.opacity <= 0) {
        this.reset();
        return;
      }
    }
    this.y += this.vy * k;
    this.x += this.vx * k;
    if (this.y < -10) this.reset();
  }

  draw(ctx, sprites) {
    const alpha = this.opacity * (0.65 + 0.35 * Math.sin(this.twinkle));
    if (alpha <= 0) return;
    const s = this.size;

    const starHalf = s * STAR_UNIT;
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(sprites.star, this.x - starHalf, this.y - starHalf, starHalf * 2, starHalf * 2);

    // The original composed the white core twice — once via globalAlpha and once
    // via the fill's own alpha — so its effective alpha was `alpha² * 0.9`. Kept,
    // because that quadratic is what makes the core pop only at full twinkle.
    const coreHalf = s * CORE_UNIT;
    ctx.globalAlpha = Math.min(1, alpha * alpha * 0.9);
    ctx.drawImage(sprites.core, this.x - coreHalf, this.y - coreHalf, coreHalf * 2, coreHalf * 2);
  }
}

const countFor = (w, h) => Math.min(Math.floor((w * h) / 8000), 180);

export default function SparklesEffect() {
  const { settings, resolvedMode } = useTheme();
  const canvasRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  const sparkleHex = resolveEffectHex(settings, resolvedMode, 'theme_sparkle_color');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    // A decorative background is exactly the thing that should silently
    // no-op rather than throw and take the page's React subtree with it.
    if (!ctx) return undefined;

    const rgb = parseHex(sparkleHex) || parseHex(DEFAULT_THEME.theme_primary);
    const sprites = makeSprites(rgb.r, rgb.g, rgb.b);

    let particles = [];
    let animId = null;
    let last = 0;
    let resizeTimer = null;
    let w = 0;
    let h = 0;

    const applySize = () => {
      // Measure the element, not the window: `innerWidth` includes the
      // scrollbar but the CSS box is 100% of the containing block, which does
      // not — an ~8px / 0.6% horizontal stretch on a desktop with a classic
      // scrollbar.
      //
      // The CSS box stays at 100% rather than being pinned in pixels. Pinning
      // it would leave a bare strip during a window drag: the resize handler is
      // debounced and a continuous drag keeps restarting the timer, so the
      // canvas would hold its old pixel size for the whole gesture. At 100% the
      // browser stretches the stale bitmap to cover instead, which is invisible
      // on a soft particle field, and it means `clientWidth` always reports the
      // container rather than a value we wrote ourselves.
      w = canvas.clientWidth || window.innerWidth;
      h = canvas.clientHeight || window.innerHeight;
      if (w <= 0 || h <= 0) return false;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // Setting canvas.width resets the context transform, so this has to run
      // after every resize, not once at mount.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return true;
    };

    const seed = () => {
      particles = Array.from({ length: countFor(w, h) }, () => new Sparkle(w, h));
    };

    /** Grow or trim the field to the new viewport without disturbing survivors. */
    const fitCount = () => {
      const target = countFor(w, h);
      if (particles.length > target) {
        particles.length = target;
      } else {
        while (particles.length < target) {
          const p = new Sparkle(w, h);
          // Under reduced motion nothing ever calls update(), so a newcomer
          // parked below the viewport at zero opacity by reset() would stay
          // invisible forever — and since the trim branch discards *visible*
          // sparkles, a shrink-then-grow cycle would empty the field. The
          // constructor already scatters with a live opacity, so leave it be.
          if (!reduced) p.reset(); // otherwise they rise and fade in rather than popping
          particles.push(p);
        }
      }
    };

    const render = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) p.draw(ctx, sprites);
      ctx.globalAlpha = 1;
    };

    const step = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const k = dt * 60; // tuned constants below are per-frame-at-60Hz
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.update(k);
        p.draw(ctx, sprites);
      }
      ctx.globalAlpha = 1;
      animId = requestAnimationFrame(step);
    };

    const stop = () => {
      if (animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    };

    const start = () => {
      if (animId !== null || reduced || document.hidden) return;
      last = performance.now(); // fresh clock, so resuming does not jump
      animId = requestAnimationFrame(step);
    };

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!applySize()) return;
        if (particles.length === 0) seed();
        else {
          for (const p of particles) p.resize(w, h);
          fitCount();
        }
        // Resizing the backing store clears it; a running loop repaints on the
        // next frame, a parked one has to repaint here.
        if (animId === null) render();
      }, 150);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    // A canvas that is display:none or not yet laid out measures 0. Seeding
    // against that produces an empty field that nothing would ever refill, so
    // wait for the resize/observer path to deliver a real box instead.
    if (applySize()) {
      seed();
      if (reduced) render(); // one static frame, then nothing
      else start();
    }

    // `resize` only fires for the window. A canvas that mounts hidden, or whose
    // container changes size on its own, needs its own signal.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      clearTimeout(resizeTimer);
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sparkleHex, reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
