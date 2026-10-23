import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import { parseHex } from '../../theme/color';
import { DEFAULT_THEME } from '../../theme/defaults';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import { resolveEffectHex } from './AmbientCanvas';
import { buildProgram, wrapShader } from './glsl';

/**
 * The WebGL2 half of the ambient effects.
 *
 * `AmbientCanvas` runs particle systems on a 2D context: a spec creates
 * objects, each object moves itself, the engine draws them. That model is the
 * right one for snow and it is the wrong one for a field — anything where
 * every pixel is a function of position and time rather than a thing with a
 * position. Marble had to fake it, and the faking is instructive: it rendered
 * a noise field into an offscreen bitmap on the CPU, re-solved it whenever the
 * colour changed, and drew it as one "particle" that happened to be the whole
 * slab. That is a fragment shader written in JavaScript, running on one core.
 *
 * This is the same idea with the loop where it belongs. One full-screen
 * triangle, one fragment shader, four uniforms. What it buys is not only
 * speed: a shader can do things the particle model cannot express at all —
 * per-pixel refraction, volumetric marching, feedback — which is why the
 * roster gets genuinely new looks rather than more small bright things.
 *
 * ── What it shares with the 2D engine, deliberately ───────────────────────
 *
 * `resolveEffectHex` (colour-with-palette-fallback), `usePrefersReducedMotion`,
 * the hidden-tab pause, DPR-capped sizing, and silent no-op when a context
 * cannot be had. Those are the properties a decorative background must have,
 * and two copies of them would diverge on the first fix — the whole reason
 * AmbientCanvas exists. What is NOT shared is the draw loop, because it is a
 * different loop.
 *
 * ── One triangle, not two ─────────────────────────────────────────────────
 *
 * A full-screen quad is two triangles that share an edge, and the GPU
 * rasterises that shared diagonal twice. One oversized triangle covering the
 * viewport has no seam and costs one fewer primitive. Generated from
 * `gl_VertexID`, so there is no vertex buffer at all.
 */

/* Re-exported so the two call sites that had them from this module keep
   working; the definitions live in ./glsl.js — see the note there. */
export { SHADER_PREAMBLE, wrapShader, buildProgram } from './glsl';

const rgbTriple = (hex, fallback) => {
  const c = parseHex(hex) || parseHex(fallback) || { r: 126, g: 141, b: 255 };
  return [c.r / 255, c.g / 255, c.b / 255];
};

/**
 * @param {object}   props
 * @param {string}   props.source     Fragment shader body (mainImage or main).
 * @param {string}   props.colorKey   Theme key for the primary shader colour.
 * @param {string}   [props.colorKey2] Theme key for the second colour.
 * @param {boolean}  [props.pointer]  Track the pointer into `iMouse`.
 * @param {'fixed'|'absolute'} [props.position] Viewport field, or fill parent.
 * @param {(err: string|null) => void} [props.onStatus] Compile result, for the editor.
 */
export default function ShaderCanvas({
  source,
  colorKey,
  colorKey2 = 'theme_glow_color_2',
  pointer = false,
  position = 'fixed',
  onStatus,
}) {
  const { settings, resolvedMode } = useTheme();
  const canvasRef = useRef(null);
  const reduced = usePrefersReducedMotion();
  const [failed, setFailed] = useState(false);

  const hex = resolveEffectHex(settings, resolvedMode, colorKey);
  const hex2 = resolveEffectHex(settings, resolvedMode, colorKey2);
  // Reported through a ref so a compile result does not have to be a render
  // dependency — the editor's status callback changes identity every render,
  // and depending on it would recompile the shader on every keystroke
  // elsewhere on the page.
  const statusRef = useRef(onStatus);
  statusRef.current = onStatus;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !source) return undefined;

    // `alpha: true` and a premultiplied composite: this canvas sits over the
    // page background, not instead of it, so a shader that returns a low alpha
    // lets the operator's own ground through. `antialias: false` because there
    // is no geometry to alias — it would cost a multisample buffer the size of
    // the screen for nothing.
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      // The compositor may keep the drawing buffer or discard it after each
      // frame; discarding is cheaper and this effect redraws entirely every
      // frame anyway.
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });

    // No WebGL2 — an old browser, a blocked GPU, or a hardened profile with it
    // switched off. Decoration must not be a requirement: this returns and the
    // store renders exactly as it does with the effect turned off. Reported so
    // the admin editor can say why the preview is empty rather than leaving
    // the operator to wonder.
    if (!gl) {
      setFailed(true);
      statusRef.current?.('This browser has no WebGL2, so shader effects cannot run here.');
      return undefined;
    }

    const built = buildProgram(gl, wrapShader(source));
    if (built.error) {
      setFailed(true);
      statusRef.current?.(built.error);
      return undefined;
    }
    setFailed(false);
    statusRef.current?.(null);

    const prog = built.program;
    gl.useProgram(prog);

    const u = {
      res: gl.getUniformLocation(prog, 'iResolution'),
      time: gl.getUniformLocation(prog, 'iTime'),
      mouse: gl.getUniformLocation(prog, 'iMouse'),
      color: gl.getUniformLocation(prog, 'uColor'),
      color2: gl.getUniformLocation(prog, 'uColor2'),
      alpha: gl.getUniformLocation(prog, 'uAlpha'),
      isLight: gl.getUniformLocation(prog, 'uIsLight'),
    };

    const c1 = rgbTriple(hex, DEFAULT_THEME.theme_primary);
    const c2 = rgbTriple(hex2, DEFAULT_THEME.theme_glow_color_2);
    gl.uniform3f(u.color, c1[0], c1[1], c1[2]);
    gl.uniform3f(u.color2, c2[0], c2[1], c2[2]);
    gl.uniform1f(u.isLight, resolvedMode === 'light' ? 1 : 0);
    gl.uniform1f(u.alpha, 1);

    gl.disable(gl.DEPTH_TEST);
    /*
     * Blending is OFF, and that is the fix for "the shader colour does not
     * work — it comes out white".
     *
     * There is nothing inside this canvas to blend against: every frame is one
     * triangle drawn over a buffer that was just cleared to (0,0,0,0). The
     * compositing that matters happens LATER, in the browser, between this
     * canvas and the page behind it — and `premultipliedAlpha: false` above is
     * the promise that the buffer holds plain, unpremultiplied (colour, alpha).
     *
     * `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)` broke that promise twice
     * over, because blendFunc applies to the alpha channel as well as to RGB:
     *
     *   RGB_out = colour × a + 0 × (1-a)  = colour × a   → premultiplied
     *   A_out   = a      × a + 0 × (1-a)  = a²           → squared
     *
     * So a shader emitting pure red at a = 0.10 stored `r = 26, a = 3` instead
     * of `r = 255, a = 26`. The browser then drew that dark, desaturated red at
     * a hundredth of the intended opacity: invisible on a dark ground, and a
     * faint colourless haze on a pale one. Every field looked washed out and
     * the colour pickers looked like they did nothing, because the colour was
     * being multiplied into the background before the page ever saw it.
     *
     * Do not re-enable this to "make the effect blend with the page". It
     * already does — that is the compositor's job, and it needs the raw values.
     */
    gl.disable(gl.BLEND);

    // A vertex array object is required in WebGL2 even when nothing is bound
    // to it — the triangle comes from gl_VertexID, but a draw call with no VAO
    // bound is an error on some drivers.
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    let raf = null;
    let resizeTimer = null;
    let w = 0;
    let h = 0;
    let start = performance.now();
    let mouse = [-1e4, -1e4];

    const applySize = () => {
      w = canvas.clientWidth || window.innerWidth;
      h = canvas.clientHeight || window.innerHeight;
      if (w <= 0 || h <= 0) return false;
      // Capped harder than the 2D engine's 2×. A fragment shader is per-pixel
      // work by definition, so a 3× phone display would be running nine times
      // the fragments of a 1× one for a background nobody looks at directly.
      // 1.5 keeps the noise fine enough not to read as blocky and keeps a
      // mid-range phone off its thermal limit.
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      gl.viewport(0, 0, bw, bh);
      gl.uniform2f(u.res, bw, bh);
      return true;
    };

    const draw = (t) => {
      gl.uniform1f(u.time, t);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const step = (now) => {
      if (pointer) gl.uniform2f(u.mouse, mouse[0], mouse[1]);
      draw((now - start) / 1000);
      raf = requestAnimationFrame(step);
    };

    const stop = () => {
      if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
    };
    const play = () => {
      if (raf !== null || reduced || document.hidden) return;
      // Fresh clock, so resuming after a hidden tab does not jump the
      // animation forward by however long the tab was away.
      start = performance.now();
      raf = requestAnimationFrame(step);
    };

    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!applySize()) return;
        // A parked loop still has to repaint: resizing reallocates the drawing
        // buffer and leaves it cleared.
        if (raf === null) draw(0);
      }, 150);
    };

    const onMove = (e) => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      mouse = [(e.clientX - r.left) * dpr, (r.height - (e.clientY - r.top)) * dpr];
    };
    const onLeave = () => { mouse = [-1e4, -1e4]; };

    const onVisibility = () => { if (document.hidden) stop(); else play(); };

    if (applySize()) {
      if (reduced) draw(0); // one still frame, then nothing
      else play();
    }

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
    ro?.observe(canvas);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    if (pointer) {
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerleave', onLeave);
    }

    return () => {
      stop();
      clearTimeout(resizeTimer);
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (pointer) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerleave', onLeave);
      }
      // Release the GPU objects explicitly. An operator flipping between
      // shaders in the editor would otherwise accumulate a program and a VAO
      // per flip until the driver drops the context.
      //
      // What must NOT happen here is `WEBGL_lose_context.loseContext()`. It
      // was the obvious companion to these deletes and it broke the component
      // outright: React runs effects twice on mount in development, so the
      // sequence is mount → cleanup → mount, and a canvas whose context has
      // been force-lost returns null from `getContext` until the context is
      // restored. The second mount therefore saw "this browser has no WebGL2"
      // and latched the failure. The same thing happens in production on any
      // genuine remount — every shader change in the editor.
      //
      // The context does not need force-losing anyway: it belongs to the
      // canvas element, which React is about to drop, and the browser collects
      // it with the element.
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
    };
  }, [source, hex, hex2, reduced, resolvedMode, pointer]);

  /*
   * A failed compile hides the canvas; it does not unmount it.
   *
   * `return null` was the first shape and it is a trap: unmounting the canvas
   * clears `canvasRef`, and the effect that would recover — a corrected
   * shader, a different one picked in the editor — needs that ref to do
   * anything. So the first failure was permanent for the life of the
   * component, which on the admin page meant one typo took the preview out
   * until a reload.
   *
   * `display: none` costs no compositing layer and no paint, which was the
   * whole reason to prefer unmounting.
   */
  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position,
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        display: failed ? 'none' : 'block',
      }}
    />
  );
}
