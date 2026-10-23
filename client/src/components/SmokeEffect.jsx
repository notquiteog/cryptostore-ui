import { useEffect, useRef } from 'react';
import { useTheme } from '../context/ThemeContext';
import { parseHex } from '../theme/color';
import { DEFAULT_THEME, lightKey } from '../theme/defaults';
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion';

/**
 * The smoke colour, falling back through the live palette rather than a
 * hard-coded literal. The old copy of this fell back to `#22d3ee`, which stopped
 * being the brand colour when the palette moved to `#2dd4e8`.
 */
function resolveEffectHex(settings, resolvedMode, key) {
  const primaryKey = resolvedMode === 'light' ? lightKey('theme_primary') : 'theme_primary';
  const candidates = [settings[key], settings[primaryKey], DEFAULT_THEME[primaryKey]];
  for (const c of candidates) if (parseHex(c)) return c;
  return DEFAULT_THEME.theme_primary;
}

// Puffs render up to ~315 CSS px across, so a 256px source radius only ever
// upscales a smooth gradient — no banding worth a bigger sprite.
// (A puff's radius maxes at ~315 CSS px, so its drawn extent is ~630 CSS px,
//  i.e. ~1260 device px at DPR 2 against a 512px source — a ~2.5x upscale.
//  Fine here because the source has no high-frequency content; raise PUFF_R
//  if that ever stops being true.)
const PUFF_R = 256;

/**
 * One radial-gradient puff, pre-rendered per colour.
 *
 * `createRadialGradient` used to run once per cloud per frame — ~28 clouds ×
 * 60fps ≈ 1,680 gradient objects a second, all of them identical apart from
 * position, radius and alpha. Position and radius come free from `drawImage`
 * and alpha comes free from `globalAlpha`, so the breathing pulse now costs
 * nothing. The gradient's stops are baked at full strength and scaled by
 * `globalAlpha`, which is exactly what the per-frame stops computed.
 */
function makePuffSprite(r, g, b) {
  const c = document.createElement('canvas');
  c.width = c.height = PUFF_R * 2;
  const x = c.getContext('2d');
  const grad = x.createRadialGradient(PUFF_R, PUFF_R, 0, PUFF_R, PUFF_R, PUFF_R);
  grad.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grad.addColorStop(0.55, `rgba(${r},${g},${b},0.35)`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grad;
  // Fill the square rather than an arc: past the last stop the gradient is
  // fully transparent anyway, and this avoids an anti-aliased circle edge.
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

// Slow-drifting ambient cloud. Spawned randomly anywhere on the viewport,
// drifts, fades in, lingers, fades out, recycles. Pointer events are ignored.
class SmokeCloud {
  constructor(w, h, initial = false) {
    this.w = w;
    this.h = h;
    this.reset(initial);
  }

  reset(initial = false) {
    // Bias spawn points to the edges a bit so clouds drift across the screen,
    // but allow center spawns as well for a dense atmosphere.
    this.x = Math.random() * this.w;
    this.y = Math.random() * this.h;

    this.size = Math.random() * 180 + 120;           // large, soft puffs
    this.maxOpacity = Math.random() * 0.09 + 0.04;   // subtle
    this.opacity = initial ? Math.random() * this.maxOpacity : 0;
    this.phase = initial ? 'hold' : 'in';

    // Very slow, meandering drift
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 0.18 + 0.06;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed * 0.6; // damp vertical

    this.lifespan = Math.random() * 360 + 260;
    this.age = initial ? Math.random() * this.lifespan * 0.5 : 0;

    // Subtle breathing pulse
    this.pulse = Math.random() * Math.PI * 2;
    this.pulseSpeed = Math.random() * 0.005 + 0.002;
    // Set here as well as in update() so a single static frame — the
    // reduced-motion path — has something to draw.
    this.renderSize = this.size;
  }

  /**
   * Move the cloud into a new viewport without restarting its life. Resize
   * fires continuously on mobile while the URL bar collapses; re-seeding there
   * dumped the whole field and started every fade over.
   */
  resize(w, h) {
    if (this.w > 0) this.x *= w / this.w;
    if (this.h > 0) this.y *= h / this.h;
    this.w = w;
    this.h = h;
  }

  /** @param {number} k frame-equivalents elapsed (1 === one frame at 60Hz). */
  update(k) {
    this.pulse += this.pulseSpeed * k;
    this.x += this.vx * k;
    this.y += this.vy * k;
    this.age += k;

    // Fade in / hold / fade out lifecycle
    const fadeIn = 90;
    const fadeOut = 140;
    if (this.age < fadeIn) {
      this.opacity = (this.age / fadeIn) * this.maxOpacity;
    } else if (this.age > this.lifespan - fadeOut) {
      const t = Math.max(0, (this.lifespan - this.age) / fadeOut);
      this.opacity = t * this.maxOpacity;
    } else {
      this.opacity = this.maxOpacity;
    }

    // Gentle size breathing
    const breathing = 1 + Math.sin(this.pulse) * 0.05;
    this.renderSize = this.size * breathing;

    // Respawn somewhere else when the cloud has drifted off or finished its lifespan
    const margin = 300;
    const offscreen =
      this.x < -margin || this.x > this.w + margin ||
      this.y < -margin || this.y > this.h + margin;
    if (this.age >= this.lifespan || offscreen) {
      this.reset(false);
    }
  }

  draw(ctx, sprite) {
    if (this.opacity <= 0) return;
    const rad = this.renderSize;
    ctx.globalAlpha = Math.min(1, this.opacity);
    ctx.drawImage(sprite, this.x - rad, this.y - rad, rad * 2, rad * 2);
  }
}

// ~1 cloud per ~70k px² — capped reasonably for performance
const countFor = (w, h) => Math.min(Math.max(Math.floor((w * h) / 70000), 8), 28);

export default function SmokeEffect() {
  const { settings, resolvedMode } = useTheme();
  const canvasRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  const smokeHex = resolveEffectHex(settings, resolvedMode, 'theme_smoke_color');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    // A decorative background is exactly the thing that should silently
    // no-op rather than throw and take the page's React subtree with it.
    if (!ctx) return undefined;

    const rgb = parseHex(smokeHex) || parseHex(DEFAULT_THEME.theme_primary);
    const sprite = makePuffSprite(rgb.r, rgb.g, rgb.b);

    let clouds = [];
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
      // browser stretches the stale bitmap to cover instead.
      w = canvas.clientWidth || window.innerWidth;
      h = canvas.clientHeight || window.innerHeight;
      if (w <= 0 || h <= 0) return false;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // Setting canvas.width resets the context transform, so this has to run
      // after every resize, not once at mount.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Resizing the backing store resets context state, so re-arm the blend.
      ctx.globalCompositeOperation = 'screen';
      return true;
    };

    const seed = () => {
      clouds = Array.from({ length: countFor(w, h) }, () => new SmokeCloud(w, h, true));
    };

    /** Grow or trim the field to the new viewport without disturbing survivors. */
    const fitCount = () => {
      const target = countFor(w, h);
      if (clouds.length > target) clouds.length = target;
      // Under reduced motion nothing calls update(), so a cloud created in the
      // fade-in state (opacity 0) would never become visible and draw() would
      // early-return on it forever. Seed newcomers live instead.
      else while (clouds.length < target) clouds.push(new SmokeCloud(w, h, reduced));
    };

    /** Hold every cloud at full strength — the single frame reduced motion gets. */
    const makeStatic = () => {
      for (const c of clouds) c.opacity = c.maxOpacity;
    };

    const render = () => {
      ctx.clearRect(0, 0, w, h);
      for (const c of clouds) c.draw(ctx, sprite);
      ctx.globalAlpha = 1;
    };

    const step = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const k = dt * 60; // tuned constants above are per-frame-at-60Hz
      ctx.clearRect(0, 0, w, h);
      for (const c of clouds) {
        c.update(k);
        c.draw(ctx, sprite);
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
        if (clouds.length === 0) seed();
        else {
          for (const c of clouds) c.resize(w, h);
          fitCount();
        }
        // Resizing the backing store clears it; a running loop repaints on the
        // next frame, a parked one has to repaint here.
        if (animId === null) {
          if (reduced) makeStatic();
          render();
        }
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
      if (reduced) {
        // One static frame and no rAF at all. Seeded clouds sit at a random
        // point in their fade, which at these alphas (0.04–0.13) can be
        // invisible — hold them at full strength, otherwise "reduced motion"
        // reads as "broken".
        makeStatic();
        render();
      } else {
        start();
      }
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
  }, [smokeHex, reduced]);

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
