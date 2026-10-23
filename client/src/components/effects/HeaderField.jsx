import { useEffect, useRef } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { parseHex } from '../../theme/color';
import { DEFAULT_THEME } from '../../theme/defaults';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import { resolveEffectHex } from './AmbientCanvas';

/**
 * A constellation field behind the navbar, which is invisible until you point
 * at it.
 *
 * Not an `AmbientCanvas` spec, and the difference is not cosmetic. Every
 * ambient effect is a full-screen field of INDEPENDENT particles that runs
 * whether or not anyone is looking at it. This is the opposite on all three
 * counts: it is sized to one element rather than the viewport, its points are
 * a connected graph rather than independent, and it exists only while the
 * pointer is over the header. Bending the shared engine around those would
 * have put three `if (isHeader)` branches in the one file that exists so
 * effects do not each carry their own lifecycle.
 *
 * What it shares instead is the parts that must not diverge: `resolveEffectHex`
 * (the colour-with-palette-fallback rule), `usePrefersReducedMotion`, the
 * hidden-tab pause, and DPR-capped sizing.
 *
 * **It rests at nothing.** DESIGN §2 rules out decoration that repeats, and a
 * permanent animation in the navbar — the one element on every page, in view
 * at all times — is the worst possible place for one. Gated on hover it is not
 * decoration at all: it only moves while a pointer is on it, which makes it a
 * response rather than a loop. The `hover: hover` guard matters for the same
 * reason it does everywhere else in this codebase — a touch device has no
 * hover, so on a phone this never starts and never costs a frame.
 */

/** Spacing between points, in px. Larger than it looks right at: the lines are
    the object, and a dense grid draws a mesh rather than a constellation. */
const CELL = 92;
/** How many neighbours each point links to. Above four it becomes a fabric. */
const LINKS = 4;
/** Radius the cursor lights, in px. */
const REACH = 190;
/** Seconds for the field to fade in on enter and out on leave. */
const FADE = 0.42;

export default function HeaderField() {
  const { settings, resolvedMode } = useTheme();
  const reduced = usePrefersReducedMotion();
  const canvasRef = useRef(null);
  const hex = resolveEffectHex(settings, resolvedMode, 'theme_header_color');

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return undefined;
    // A decorative background silently no-ops rather than throwing and taking
    // the navbar's React subtree with it.
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    // No hover, no effect. Not a width test: a laptop at 700px has a mouse and
    // a tablet at 1024px does not.
    if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return undefined;

    const rgb = parseHex(hex) || parseHex(DEFAULT_THEME.theme_primary);
    let points = [];
    let w = 0;
    let h = 0;
    let animId = null;
    let last = 0;
    let resizeTimer = null;
    // 0 while the pointer is away, 1 while it is over the header. Everything
    // the field draws is multiplied by it, so "hidden" is genuinely nothing
    // painted rather than something drawn at low alpha.
    let presence = 0;
    let want = 0;
    const pointer = { x: -9999, y: -9999 };

    const build = () => {
      points = [];
      const cols = Math.ceil(w / CELL) + 1;
      const rows = Math.max(2, Math.ceil(h / CELL) + 1);
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          // Jittered off the lattice, or the "constellation" is a grid with
          // the corners joined — which reads as a table, not a sky.
          const x = cx * CELL + (Math.random() - 0.5) * CELL * 0.85;
          const y = cy * (h / (rows - 1)) + (Math.random() - 0.5) * CELL * 0.5;
          points.push({
            x, y, ox: x, oy: y,
            // Its own slow ellipse around home. Independent periods, so the
            // field never pulses together.
            px: Math.random() * Math.PI * 2,
            py: Math.random() * Math.PI * 2,
            sx: 0.13 + Math.random() * 0.22,
            sy: 0.11 + Math.random() * 0.20,
            ax: 4 + Math.random() * 9,
            ay: 2 + Math.random() * 5,
            near: [],
          });
        }
      }
      // Nearest neighbours, resolved once. Recomputing per frame is O(n²) on
      // every frame for a set that barely moves — the points drift a dozen
      // pixels around a fixed home, so the graph they form does not change.
      for (const p of points) {
        p.near = points
          .filter((q) => q !== p)
          .sort((a, b) => ((a.x - p.x) ** 2 + (a.y - p.y) ** 2) - ((b.x - p.x) ** 2 + (b.y - p.y) ** 2))
          .slice(0, LINKS);
      }
    };

    const applySize = () => {
      const rect = host.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      // Capped at 2: past that a wide navbar is millions of pixels of canvas
      // for a decoration nobody is looking closely at.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      // Setting width/height resets the transform and every context property.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      build();
    };

    const render = (k) => {
      ctx.clearRect(0, 0, w, h);
      if (presence <= 0.001) return;

      const base = `${rgb.r},${rgb.g},${rgb.b}`;
      for (const p of points) {
        p.px += p.sx * k * 0.02;
        p.py += p.sy * k * 0.02;
        p.x = p.ox + Math.cos(p.px) * p.ax;
        p.y = p.oy + Math.sin(p.py) * p.ay;
      }

      for (const p of points) {
        const dx = p.x - pointer.x;
        const dy = p.y - pointer.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > REACH) continue;
        // Squared falloff: a linear one lights a disc with a visible rim,
        // which reads as a spotlight rather than as proximity.
        const prox = (1 - dist / REACH) ** 2;
        const a = prox * presence;

        ctx.strokeStyle = `rgba(${base},${(a * 0.42).toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const q of p.near) {
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
        }
        ctx.stroke();

        ctx.fillStyle = `rgba(${base},${(a * 0.75).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.6 + prox * 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const step = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const k = dt * 60;
      // Ease toward the wanted presence rather than snapping, so leaving the
      // header fades the field out instead of deleting it.
      const rate = Math.min(1, dt / FADE);
      presence += (want - presence) * rate;
      render(k);
      // Stop entirely once faded out and the pointer is away: an idle rAF in
      // the navbar would run on every page of the store forever.
      if (presence <= 0.002 && want === 0) {
        presence = 0;
        ctx.clearRect(0, 0, w, h);
        animId = null;
        return;
      }
      animId = requestAnimationFrame(step);
    };

    const kick = () => {
      if (animId !== null || document.hidden) return;
      last = performance.now();
      animId = requestAnimationFrame(step);
    };

    const onMove = (e) => {
      const rect = host.getBoundingClientRect();
      pointer.x = e.clientX - rect.left;
      pointer.y = e.clientY - rect.top;
      want = 1;
      kick();
    };
    const onLeave = () => {
      // The pointer stays exactly where it was last seen. Moving it off to
      // (-9999, -9999) here is what made the field cut out rather than fade:
      // `render` skips any point further than REACH from the pointer, so
      // teleporting it put every point out of range on the very next frame
      // and there was nothing left on screen for `presence` to fade. The
      // ease-out below was real and never visible.
      //
      // Leaving the position alone means the same constellation that was lit
      // under the cursor is the one that dims, which is what a fade is.
      want = 0;
      kick();
    };

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(applySize, 120);
    };
    const onVisibility = () => {
      if (document.hidden) {
        if (animId !== null) cancelAnimationFrame(animId);
        animId = null;
      } else if (want || presence > 0) kick();
    };

    applySize();

    // Under reduced motion the field is drawn once at full presence while the
    // pointer is inside, and never animates. It still answers the cursor —
    // the information is the proximity, not the movement — but nothing drifts.
    if (reduced) {
      const still = (e) => {
        const rect = host.getBoundingClientRect();
        pointer.x = e.clientX - rect.left;
        pointer.y = e.clientY - rect.top;
        presence = 1;
        want = 1;
        render(0);
      };
      const stillLeave = () => { presence = 0; want = 0; ctx.clearRect(0, 0, w, h); };
      host.addEventListener('pointermove', still);
      host.addEventListener('pointerleave', stillLeave);
      window.addEventListener('resize', onResize);
      return () => {
        host.removeEventListener('pointermove', still);
        host.removeEventListener('pointerleave', stillLeave);
        window.removeEventListener('resize', onResize);
        clearTimeout(resizeTimer);
      };
    }

    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(host);

    return () => {
      if (animId !== null) cancelAnimationFrame(animId);
      clearTimeout(resizeTimer);
      ro?.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [hex, reduced]);

  return <canvas ref={canvasRef} className="header-field" aria-hidden="true" />;
}
