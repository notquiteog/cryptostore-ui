import { useEffect, useId, useMemo, useRef } from 'react';
import { framesFor, gaze, pathsOf, SIZE } from './sprites';

/**
 * One pixel companion, drawn as inline SVG, animated by CSS.
 *
 * ── How the animation works, and why it is not JavaScript ───────────────────
 *
 * Every frame is laid out side by side in one wide group, and the group is
 * walked left by exactly one frame width per step by a CSS `steps()`
 * animation. The SVG's own viewBox is one frame wide, so it clips to whichever
 * frame is currently in front of it. There is no ticker, no
 * `requestAnimationFrame`, no state update per frame — the sprite costs
 * nothing while it runs and nothing when the tab is backgrounded, because the
 * browser stops compositing an animation it is not showing.
 *
 * A JS ticker would have re-rendered a React component several times a second,
 * forever, on every page of the shop. For a decoration in the corner of the
 * navbar that is not a trade worth making.
 *
 * ── Why the frames are `<use>` rather than copies ───────────────────────────
 *
 * Timing is expressed by REPEATING a pose in the sequence (see sprites.js): an
 * owl that holds still for ten ticks is the same array ten times, and a pose
 * used in three different states is one array as well. Drawn literally, a
 * 55-frame idle is 55 copies of a whole animal in the navbar of every page in
 * the shop, almost all of them identical to one already on screen.
 *
 * So each DISTINCT frame is drawn once into `<defs>` and the strip is 55
 * `<use>` elements pointing at the ten that actually differ. The dedupe is by
 * array identity, which works precisely because the pose cache in sprites.js
 * returns the same array for a repeat rather than a copy — the two files agree
 * on that on purpose, and the comment is in both.
 *
 * Together with one path per palette index (`pathsOf`), that is what made a
 * 32x32 sprite affordable: about sixty DOM nodes behind the navbar instead of
 * the seven thousand `<rect>` elements the obvious version produces.
 *
 * `<use>` also keeps the theme working: custom properties inherit into the
 * shadow tree from the referencing element, so `var(--primary)` inside a
 * defs'd frame still resolves against the page's live palette.
 *
 * See `pathsOf` in sprites.js for why the rectangles are still the model and
 * no longer the element.
 *
 * ── Colour ─────────────────────────────────────────────────────────────────
 *
 * Every pixel is a theme token, never a literal. `docs/DESIGN.md` §11: the
 * palette is operator-owned and solved against WCAG on their background, so a
 * sprite with baked colours would clash with half the presets and be invisible
 * on some. `--primary` for the body means the companion is the shop's own
 * colour wherever it is shown.
 *
 * ── Reduced motion ─────────────────────────────────────────────────────────
 *
 * Handled in CSS (100-ai-buddy.css), not here, so that the rule sits beside
 * every other motion rule in the codebase. The idle, sleep and one-shot loops
 * stop; the THINKING loop does not, by the same rule that leaves loaders alone
 * — a frozen spinner reads as a hung page. Callers additionally decline to
 * ENTER the decorative states at all (see `motionAllowed` in
 * utils/companion.js), so a hover does not queue an animation nobody will see.
 */

/** Palette index → theme token. The only place a pixel becomes a colour. */
const PALETTE = {
  o: 'color-mix(in srgb, var(--primary) 35%, var(--bg))',
  b: 'var(--primary)',
  d: 'color-mix(in srgb, var(--primary) 62%, var(--bg))',
  s: 'var(--secondary)',
  e: 'var(--bg)',
  // Eye reflections share the outline's existing theme colour, but have their
  // own index so blinks and glances carry them along with the pupil.
  h: 'var(--text)',
  n: 'var(--accent)',
  // The mouth is the same colour as any other accent detail. It is a separate
  // palette index only so `openMouth` can find it — see sprites.js.
  m: 'var(--accent)',
};

export default function BuddySprite({
  animal = 'cat',
  state = 'idle',
  size = 32,
  title,
  onDone,
  attention = 0,
}) {
  // Ids have to be unique per instance: the admin picker draws the whole
  // roster at once, and twelve `<defs>` sharing `#f0` would all render the
  // first one's cat. `useId` is stripped of its punctuation because React's format
  // (`:r7:`) is legal in an id and unpleasant in a URL fragment.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');

  const profile = ['walk', 'fly', 'potter'].includes(state);
  const gazeOffset = profile ? 0 : attention;
  const { frames, duration, loop } = useMemo(() => framesFor(animal, state), [animal, state]);

  // Distinct frames, and the strip written as indices into them.
  const { unique, strip } = useMemo(() => {
    const seen = new Map();
    const order = [];
    const indices = frames.map((frame) => {
      if (!seen.has(frame)) {
        seen.set(frame, order.length);
        order.push(frame);
      }
      return seen.get(frame);
    });
    return { unique: order.map(frame => pathsOf(gazeOffset ? gaze(frame, gazeOffset) : frame)), strip: indices };
  }, [frames, gazeOffset]);

  /*
   * A one-shot hands control back when it is finished.
   *
   * The timer is here rather than in the caller because only this component
   * knows how long the state actually lasts — the duration is the animal's
   * tempo times its frame count, and a caller guessing "about a second" would
   * cut a slow animal off mid-stretch and leave a fast one standing still.
   *
   * It fires even when the animation is paused for reduced motion. That is
   * deliberate: a paused one-shot never ends on its own, and a companion stuck
   * in its greeting pose forever is the worst of both.
   */
  // Pointer attention and streamed text can re-render a caller. A fresh
  // callback must not restart the clock and trap a one-shot in its last pose.
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    if (loop || !duration) return undefined;
    const t = setTimeout(() => doneRef.current?.(), duration * 1000);
    return () => clearTimeout(t);
  }, [loop, duration, state, animal]);

  return (
    <svg
      className={`buddy-sprite buddy-sprite-${state}`}
      data-animal={animal}
      data-view={profile ? 'profile' : 'front'}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={size}
      height={size}
      role={title ? 'img' : 'presentation'}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : 'true'}
      // shape-rendering is what keeps a 32-unit grid scaled to 64px looking
      // like pixel art rather than a blurred one: without it the renderer
      // antialiases every rectangle edge and the whole thing goes soft.
      shapeRendering="crispEdges"
    >
      <defs>
        {unique.map((frame, i) => (
          // eslint-disable-next-line react/no-array-index-key
          <g key={i} id={`${uid}f${i}`}>
            {frame.map((layer) => (
              <path key={layer.ch} d={layer.d} fill={PALETTE[layer.ch]} />
            ))}
          </g>
        ))}
      </defs>

      {/*
        The strip, scrolled one frame at a time.

        The first version of this stacked the frames and cycled their opacity,
        with each frame's visible window written as `calc(100% / frames)` in
        the KEYFRAME SELECTOR. That is not valid CSS — a keyframe selector must
        be a literal percentage — and the browser silently dropped both rules,
        leaving every frame at opacity 1. All six drew on top of each other and
        nothing moved. It looked like a slightly muddy sprite rather than a
        broken animation, which is why it is worth the comment.

        The animation is set inline because `steps()` needs the frame count as
        a literal, and only this component knows it.
      */}
      <g
        className="buddy-strip"
        style={duration ? {
          animation: `buddy-scroll ${duration}s steps(${strip.length}) ${loop ? 'infinite' : '1'}`,
          '--buddy-shift': `${-SIZE * strip.length}px`,
        } : undefined}
      >
        {strip.map((frameIndex, i) => (
          <use
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            href={`#${uid}f${frameIndex}`}
            transform={`translate(${i * SIZE} 0)`}
          />
        ))}
      </g>
    </svg>
  );
}

export { PALETTE };
