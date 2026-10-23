import { useEffect, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { parseHex } from '../../theme/color';
import { DEFAULT_THEME, lightKey } from '../../theme/defaults';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';

/**
 * The shared engine behind the ambient effects.
 *
 * SparklesEffect and SmokeEffect each carry a copy of the same lifecycle —
 * DPR-capped sizing, debounced resize that preserves survivors, pause on a
 * hidden tab, a single static frame under prefers-reduced-motion, silent
 * no-op when a context can't be had. When the roster grew past two, copying
 * that block per effect stopped being a style choice and became four places
 * for the next lifecycle fix to miss. The two originals predate this engine
 * and keep their tuned copies; every NEW effect is a spec object instead:
 *
 *   { colorKey, count(w, h), create(w, h, initial), blend? }
 *
 * where each particle the spec creates implements update(k, w, h),
 * draw(ctx, rgb) and resize(w, h). `k` is frame-equivalents at 60Hz, so
 * specs tune constants per-frame like the originals do. `blend` is a
 * composite-operation name, or a function of the resolved mode returning one
 * — see applySize for why an effect may need a different operator on a pale
 * ground than on a dark one.
 */

/** Effect colour, falling back through the live palette (same as the originals).
    Exported because HeaderField resolves its colour by the same rule — two
    copies of this fallback chain would disagree the first time one is edited. */
export function resolveEffectHex(settings, resolvedMode, key) {
  const primaryKey = resolvedMode === 'light' ? lightKey('theme_primary') : 'theme_primary';
  const candidates = [settings[key], settings[primaryKey], DEFAULT_THEME[primaryKey]];
  for (const c of candidates) if (parseHex(c)) return c;
  return DEFAULT_THEME.theme_primary;
}

export default function AmbientCanvas({ spec }) {
  const { settings, resolvedMode } = useTheme();
  const canvasRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  const hex = resolveEffectHex(settings, resolvedMode, spec.colorKey);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    // A decorative background is exactly the thing that should silently
    // no-op rather than throw and take the page's React subtree with it.
    if (!ctx) return undefined;

    const rgb = parseHex(hex) || parseHex(DEFAULT_THEME.theme_primary);

    let particles = [];
    let animId = null;
    let last = 0;
    let resizeTimer = null;
    let w = 0;
    let h = 0;

    const applySize = () => {
      // Element, not window: innerWidth includes the scrollbar the CSS box
      // does not (see SparklesEffect for the full story).
      w = canvas.clientWidth || window.innerWidth;
      h = canvas.clientHeight || window.innerHeight;
      if (w <= 0 || h <= 0) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // Setting canvas.width resets the transform and all context state, so
      // both are re-armed after every resize, not once at mount.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // `blend` may be a function of the resolved mode, not just a string.
      // An effect that adds light (`screen`) is the right operator on a dark
      // ground and the wrong one on a pale one, where adding to something
      // already near-white does almost nothing — the aurora went from curtains
      // of light to a barely-there wash the moment a store switched to light
      // mode. Letting the spec pick per mode is what stops an effect being a
      // dark-mode-only feature.
      const blend = typeof spec.blend === 'function' ? spec.blend(resolvedMode) : spec.blend;
      if (blend) ctx.globalCompositeOperation = blend;
      return true;
    };

    const seed = () => {
      particles = Array.from({ length: spec.count(w, h) }, () => spec.create(w, h, true));
    };

    /** Grow or trim to the new viewport without disturbing survivors. */
    const fitCount = () => {
      const target = spec.count(w, h);
      if (particles.length > target) particles.length = target;
      // Newcomers under reduced motion must be born visible: nothing will
      // ever call update() to fade them in.
      else while (particles.length < target) particles.push(spec.create(w, h, true));
    };

    const render = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) p.draw(ctx, rgb);
      ctx.globalAlpha = 1;
    };

    const step = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const k = dt * 60;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.update(k, w, h);
        p.draw(ctx, rgb);
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
        // Resizing clears the backing store; a parked loop repaints here.
        if (animId === null) render();
      }, 150);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    // A canvas that is display:none or not yet laid out measures 0; wait for
    // the observer to deliver a real box rather than seeding an empty field.
    if (applySize()) {
      seed();
      if (reduced) render(); // one static frame, then nothing
      else start();
    }

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
    // `resolvedMode` is a dependency because the blend operator above is
    // chosen from it. Without it, switching mode kept the composite operation
    // the previous ground had asked for.
  }, [hex, reduced, spec, resolvedMode]);

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
