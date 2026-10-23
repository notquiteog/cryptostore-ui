import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Tracks the visitor's `prefers-reduced-motion` setting.
 *
 * Subscribes to the media query rather than sampling it once: the preference
 * can be toggled while the tab is open (macOS and Windows both apply it live),
 * and an effect that only read it at mount would keep animating.
 *
 * Starts at `false` and syncs inside the effect so server-rendered and
 * client-rendered first paints agree.
 */
export default function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(QUERY);
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  return reduced;
}

export { usePrefersReducedMotion };
