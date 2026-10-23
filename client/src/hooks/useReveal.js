import { useEffect } from 'react';
import usePrefersReducedMotion from './usePrefersReducedMotion';

/**
 * Reveal-on-scroll for a whole subtree, from one observer.
 *
 * Anything inside `rootRef` carrying `data-reveal` starts hidden (see the
 * `[data-reveal]` rule in global.css) and is marked `data-revealed` when it
 * first crosses into the viewport. One observer per page rather than one per
 * element, and each element is unobserved once it has arrived: a section that
 * re-hides when scrolled past and re-animates on the way back is a novelty the
 * second time and an irritation the fifth.
 *
 * The mark is an attribute, deliberately, and not a class. React owns
 * `className` and rewrites the whole string whenever any part of it changes —
 * so a component whose class depends on state (`pd-buybox` gains `on-sale`)
 * silently dropped a class added from outside, and the panel faded itself back
 * out mid-session. React never removes an attribute it has no prop for, so
 * `data-revealed` cannot be clobbered the same way.
 *
 * Being marked is what makes the content readable, so every path out of here
 * has to end with the mark applied. Three things would otherwise leave a
 * section permanently invisible, and all three are handled:
 *
 *   - Sections that mount later than this effect — the related-products and
 *     recently-viewed rails arrive from their own fetches — would never be
 *     observed at all. A MutationObserver picks them up, so the hook does not
 *     depend on the caller remembering to list every async section as a dep.
 *   - A document that is hidden skips the rendering step IntersectionObserver
 *     is driven by, so nothing is ever delivered. Opening a product in a
 *     background tab is half of how shopping works. The observer delivers an
 *     initial batch for everything it observes, so "nothing arrived at all" is
 *     a reliable signal that it is not running; the failsafe below then drops
 *     the choreography and just shows the content.
 *   - Reduced motion, or no IntersectionObserver at all: revealed immediately.
 */
export default function useReveal(rootRef, deps = []) {
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const seen = new WeakSet();
    let delivered = false;
    let giveUp = reduced || typeof IntersectionObserver === 'undefined';

    const reveal = (el) => el.setAttribute('data-revealed', '');

    const io = giveUp ? null : new IntersectionObserver((entries) => {
      delivered = true;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal(entry.target);
        io.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    const attach = (el) => {
      if (seen.has(el)) return;
      seen.add(el);
      if (giveUp) reveal(el);
      else io.observe(el);
    };
    const scan = () => root.querySelectorAll('[data-reveal]:not([data-revealed])').forEach(attach);

    scan();
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true });

    const failsafe = giveUp ? null : setTimeout(() => {
      if (delivered) return;
      giveUp = true;
      io.disconnect();
      root.querySelectorAll('[data-reveal]').forEach(reveal);
    }, 2500);

    return () => {
      if (failsafe) clearTimeout(failsafe);
      mo.disconnect();
      io?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced, ...deps]);
}
