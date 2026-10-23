import { useState, useSyncExternalStore } from 'react';
import { motionAllowed } from '../../utils/companion';

/** Three deliberate glances, scoped to the companion's own hit target. No
 * document-wide pointer listener, coordinates stored between visits or ticker.
 * Functional updates bail out until the pointer crosses into another third.
 */
export default function useCompanionAttention() {
  const [attention, setAttention] = useState(0);
  const follow = (event) => {
    if (event.pointerType === 'touch' || !motionAllowed()) return;
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = (event.clientX - box.left) / box.width;
    const next = fraction < 0.38 ? -1 : fraction > 0.62 ? 1 : 0;
    setAttention(current => current === next ? current : next);
  };
  return { attention, follow, resetAttention: () => setAttention(0) };
}

const subscribeMotion = (notify) => {
  const query = window.matchMedia('(prefers-reduced-motion: reduce)');
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

// React to a preference changed while the page is open, including cancelling
// a preview or walk already in progress. CSS alone only freezes that journey.
export function useCompanionMotion() {
  return useSyncExternalStore(subscribeMotion, motionAllowed, () => false);
}
