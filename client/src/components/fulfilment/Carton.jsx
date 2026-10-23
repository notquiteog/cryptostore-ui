import { useEffect, useId, useRef, useState } from 'react';

/**
 * The box that fills.
 *
 * DESIGN §10 names this: a carton drawn open, its contents rising as units go
 * in, instead of a percentage bar that says "62%" about a thing that is
 * physically a box with things in it. Three places draw it — the queue card,
 * the bench header and each box row — from this one component, so the carton
 * a packer sees in the queue is the carton they meet at the bench.
 *
 * ── Why it exists beyond looking right ─────────────────────────────────────
 * PackOrder's claim guard stops two packers half-filling one box, and until
 * now the guard was a sentence: "somebody else is packing this". A drawn
 * carton that is already a third full IS the explanation — there is a box on
 * a bench with things in it — which no lock message managed to say.
 *
 * ── What "full" means ──────────────────────────────────────────────────────
 * `filled` of `capacity` units. In the queue and at the bench the capacity is
 * the order's units, a one-carton picture of the whole job; in a box row it
 * is the order's units too, so the three cartons of a split order visibly add
 * up to one. Presets carry no volume — only an empty weight — so there is
 * nothing truer to fill against.
 *
 * ── Units drop in ──────────────────────────────────────────────────────────
 * When `filled` rises, one unit falls into the box and the level rises with a
 * settle. The level is a CSS variable so the rise is the browser's transition,
 * and the drop is a keyed element so a second unit re-runs it. Under reduced
 * motion the level moves without the drop and without the transition
 * (55-reduced-motion.css). SVG rather than divs because the open flaps and
 * the body are one shape and it scales from 20px in a row head to 60px at the
 * bench without a second drawing.
 */
export default function Carton({
  filled, capacity, size = 44, label, sealed = false, held = false, className = '',
}) {
  const cap = Math.max(1, Number(capacity) || 0);
  const have = Math.max(0, Math.min(Number(filled) || 0, cap));
  const level = have / cap;
  const full = have >= cap;

  // A drop per rise. The previous value lives in a ref so a re-render with
  // the same figure (a weight save, a note) drops nothing.
  const prev = useRef(have);
  const [drop, setDrop] = useState(0);
  useEffect(() => {
    if (have > prev.current) setDrop((d) => d + 1);
    prev.current = have;
  }, [have]);

  const uid = useId();
  const clipId = `carton-well-${uid}`;
  const text = label || `${have} of ${cap} unit${cap === 1 ? '' : 's'} in the box${full ? ' — full' : ''}`;
  const cls = ['carton', full ? 'is-full' : '', sealed ? 'is-sealed' : '', held ? 'is-held' : '', className]
    .filter(Boolean).join(' ');

  return (
    <span className={cls} style={{ '--level': level, '--size': `${size}px` }} role="img" aria-label={text} title={text}>
      <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false">
        <defs>
          <clipPath id={clipId}><rect x="11" y="19" width="26" height="23" rx="1" /></clipPath>
        </defs>
        {/* Back flaps stand up behind the mouth; they read as "open" from
            any distance, which is the whole point of drawing them. */}
        <path className="carton-flap carton-flap-back" d="M10 18 L5 6 L24 9 L43 6 L38 18 Z" />
        {/* The well: everything inside is clipped to the body. */}
        <g clipPath={`url(#${clipId})`}>
          <rect className="carton-well" x="11" y="19" width="26" height="23" />
          <rect className="carton-fill" x="11" y="19" width="26" height="23" />
          {drop > 0 && !full && (
            <rect key={drop} className="carton-unit" x="20" y="14" width="8" height="8" rx="1.5" />
          )}
          {drop > 0 && full && (
            <rect key={drop} className="carton-unit" x="20" y="14" width="8" height="8" rx="1.5" />
          )}
        </g>
        {/* The body, drawn last so its edge sits over the fill. */}
        <rect className="carton-body" x="10" y="18" width="28" height="24" rx="1.5" />
        {/* Front flaps folded down and out. Sealed: they close over the mouth
            and a strip of tape runs across. */}
        <path className="carton-flap carton-flap-front carton-flap-left" d="M10 18 L2 26 L14 30 L18 18 Z" />
        <path className="carton-flap carton-flap-front carton-flap-right" d="M38 18 L46 26 L34 30 L30 18 Z" />
        <g className="carton-lid">
          <rect x="10" y="14" width="28" height="5" rx="1" />
          <rect className="carton-tape" x="22" y="12" width="4" height="9" rx="0.8" />
        </g>
      </svg>
    </span>
  );
}
