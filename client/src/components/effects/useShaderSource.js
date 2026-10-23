import { useEffect, useState } from 'react';

/**
 * A built-in shader's source, fetched only if one is actually selected.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * `components/effects/shaders.js` is the shader library — roughly 95 KB of GLSL
 * as string literals. Two components in the SHOPPER's entry chunk imported it
 * statically: `BackgroundEffects`, for the page background, and `Navbar`, for
 * the header field. Both then checked a setting and, on a store that had not
 * picked a shader, rendered nothing.
 *
 * So every visitor to every store downloaded the whole library before the app
 * could start, and the default store ran none of it. `CLAUDE.md` names the
 * deployment that makes this a feature rather than a micro-optimisation: a
 * buyer on a hostile or filtered network, on a connection the operator does not
 * control, paying for bytes in latency. A library for a feature that is off is
 * the cheapest kind of byte to not send.
 *
 * ── Why a hook rather than `lazy()` on the canvas ───────────────────────────
 *
 * Because the thing that is big is the DATA, not the component. `ShaderCanvas`
 * is small and is also what draws a CUSTOM shader, whose source comes from the
 * settings and needs no library at all — so lazily loading the canvas would
 * defer the wrong thing and delay the one case that needs no deferring.
 *
 * ── It never blocks a render ────────────────────────────────────────────────
 *
 * `null` until the import resolves, which both callers already handle: "no
 * source" is their existing render-nothing path. The background appears a tick
 * late on a store that has chosen one, which is the correct trade — an effect
 * arriving imperceptibly late against a library nobody uses arriving before the
 * page can paint.
 *
 * @param {'background'|'header'} table  which library to read
 * @param {string|null} name   the stored shader name, or null when none is set
 * @returns {{source: string, pointer?: boolean} | null}
 */
export function useShaderSource(table, name) {
  const [entry, setEntry] = useState(null);

  useEffect(() => {
    if (!name) { setEntry(null); return undefined; }
    let alive = true;
    import('./shaders')
      .then((m) => {
        if (!alive) return;
        const lib = table === 'header' ? m.HEADER_SHADERS : m.BACKGROUND_SHADERS;
        // A stored name this build does not know renders nothing rather than
        // falling back to another shader — the same rule both call sites
        // already applied, kept here so there is one copy of it.
        setEntry(lib?.[name] || null);
      })
      // A chunk that will not load is a background that does not draw. There is
      // nothing useful to say to a buyer about that, and nothing to retry.
      .catch(() => { if (alive) setEntry(null); });
    return () => { alive = false; };
  }, [table, name]);

  return entry;
}

export default useShaderSource;
