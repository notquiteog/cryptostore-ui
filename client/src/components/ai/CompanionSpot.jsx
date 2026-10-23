import { lazy, Suspense, useEffect, useState } from 'react';

/* The sprite, and with it the animation tables and the drawing code, fetched
   only once the shop turns out to have a companion at all.
   `BuddySprite` reaches `sprites.js` and `spriteArt.js` — ~54 KB — and this
   component is imported by Cart, Products and Wishlist, two of which are in the
   shopper's entry chunk. So a store with the assistant off was shipping the
   whole sprite atlas to every visitor in order to render a lucide icon.
   It costs nothing to defer here, because this component's documented
   behaviour is already "render the caller's icon whenever there is no
   companion to draw" — a chunk still in flight is one more case of that. */
const BuddySprite = lazy(() => import('./BuddySprite'));
import { getAiStatus, peekAiStatus } from '../../utils/aiStatus';
import { resolveCompanion } from '../../utils/companion';

/**
 * The companion, standing in the hole where a page has nothing to show.
 *
 * ── Why an empty state and not a new surface ────────────────────────────────
 *
 * `docs/AI.md` §9 asks a flourish to do a job, and the jobs so far are all
 * status. This one is different and smaller: an empty cart, an empty wishlist
 * and a search that matched nothing are the three places in the shop that are
 * deliberately blank, and they already draw an emblem in the middle of that
 * blankness. Swapping the emblem for the shop's own animal costs no space, no
 * request and no new component on the page — the companion turns up where
 * there was already a picture of nothing.
 *
 * It replaces the icon rather than joining it, and it inherits `.empty-state >
 * svg` — the same medallion, the same ring, the same glow the lucide icon got.
 * That is the point: it should look like the store drew it, not like a mascot
 * was pasted on top of one page.
 *
 * ── What it will not do ─────────────────────────────────────────────────────
 *
 * It renders the caller's own icon whenever there is no companion to draw: the
 * feature off, the operator on `none`, or the status not read yet. A page must
 * never end up with a hole where an emblem was because a request was slow, so
 * the fallback renders FIRST and is replaced, rather than the other way round.
 *
 * It is `idle` and never a one-shot. A one-shot in an empty state plays once
 * and leaves a still picture — worse than the icon it replaced, because a
 * frozen animal reads as broken where a frozen icon reads as an icon. The idle
 * loop is the state everything else in the product uses for "nothing is
 * happening", and it pins to frame one under reduced motion like the rest.
 */
export default function CompanionSpot({ fallback }) {
  // Seeded from the cache so the common case — anywhere below a navbar that
  // already asked — draws the animal on the first paint rather than swapping
  // an icon for it a moment later.
  const [status, setStatus] = useState(peekAiStatus);

  useEffect(() => {
    let alive = true;
    if (!status) getAiStatus().then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, [status]);

  const { animal } = resolveCompanion(status?.enabled ? status.buddy : null);
  if (!animal) return fallback;

  // The caller's own emblem is the fallback while the sprite chunk arrives, so
  // the hole is never empty — the same rule the header comment states for a
  // slow status request, applied to a slow chunk.
  return (
    <Suspense fallback={fallback}>
      <BuddySprite animal={animal} state="idle" size={34} />
    </Suspense>
  );
}
