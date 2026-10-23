import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useWarehouseLayout, shelfForBin } from '../../utils/useWarehouseLayout';
import { useShelfContents } from '../../utils/shelfContents';
import { outlinePath } from '../../utils/roomGeometry';
import WarehouseViewer from './WarehouseViewer';

/**
 * A postage-stamp warehouse map locating one bin: room footprints, every shelf
 * faint, the matched shelf filled. Renders nothing when the store has no map
 * or the bin matches no shelf — the map is garnish over the bin STRING, which
 * remains the real answer printed beside it.
 *
 * ── Now also a door ─────────────────────────────────────────────────────────
 *
 * A stamp this size can say "over there, on the left" and nothing more, which
 * is exactly what a picker who does not know the floor needs more of. Hovering
 * (or focusing) shows what else is on that shelf; pressing opens the full
 * viewer with a top-down and a 2.5D projection.
 *
 * The hover card is deliberately not a `title` attribute: those take a second
 * to appear, cannot be styled to the theme, and are invisible to touch. The
 * chip is a real <button> so tapping works, keyboard focus works, and the same
 * gesture serves both.
 *
 * ── Why the card is portalled ───────────────────────────────────────────────
 *
 * It is rendered into `document.body`, positioned fixed from a measured button
 * rect. Both halves of that are load-bearing, and each was arrived at by
 * watching the simpler version fail:
 *
 *   - Absolute positioning inside the chip vanished, because `.pull-bin` sets
 *     `overflow: hidden`.
 *   - Switching to `position: fixed` did NOT fix it. `.pull-bin` also carries
 *     `backdrop-filter` and a `transform` keyframe, and any of transform,
 *     filter, backdrop-filter, perspective, will-change or contain makes an
 *     ancestor the containing block for its fixed descendants. The card was
 *     laid out against the card-sized box instead of the viewport and landed
 *     hundreds of pixels off (`style.top: 548px` measuring at 897px).
 *
 * A portal to body is the only placement that is immune to both, and this is a
 * glassmorphic app — every panel this chip could ever be dropped into is
 * likely to blur its backdrop. It flips above or below depending on which side
 * has room, and `pointer-events: none` keeps it from ever eating the pointer
 * that summoned it.
 *
 * Pure inline SVG in theme tokens; hidden in print (the sheets keep the text).
 */
export default function BinChip({ bin }) {
  const layout = useWarehouseLayout();
  const shelf = shelfForBin(layout, bin);
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(null); // null = hidden, else {top,left,below}
  const btnRef = useRef(null);

  const showPeek = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Roughly the card's tallest form. Precise enough to choose a side; the
    // card is short enough that being a few pixels out never matters.
    const CARD = 220;
    const below = r.top < CARD + 12;
    setPeek({
      top: below ? r.bottom + 6 : r.top - 6,
      // Clamped so a chip near the right edge does not push the card off it.
      left: Math.min(r.left, window.innerWidth - 260),
      below,
    });
  }, []);
  // Only fetched once the pointer is actually on the chip: a pull list of
  // forty rows must not issue forty shelf reads on mount.
  const contents = useShelfContents(peek && shelf ? shelf.name : null);

  if (!layout || !shelf) return null;

  const { w, h } = layout.grid;

  return (
    <span className="binchip-wrap">
      <button
        ref={btnRef}
        type="button"
        className="binchip-btn"
        onClick={() => setOpen(true)}
        onPointerEnter={showPeek}
        onPointerLeave={() => setPeek(null)}
        onFocus={showPeek}
        onBlur={() => setPeek(null)}
        aria-label={`${bin} is on shelf ${shelf.name}. Open the warehouse map.`}
      >
        <svg
          className="binchip"
          viewBox={`-0.5 -0.5 ${w + 1} ${h + 1}`}
          preserveAspectRatio="xMidYMid meet"
          aria-hidden="true"
        >
          {layout.rooms.map((r) => (
            <g key={r.id}>
              {r.parts.map((p, i) => (
                <rect key={`${r.id}:${i}`} x={p.x} y={p.y} width={p.w} height={p.h} className="binchip-room" />
              ))}
              <path d={outlinePath(r.parts)} className="binchip-room-edge" />
            </g>
          ))}
          {layout.shelves.map((s) => (
            <rect
              key={s.id}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              className={s.id === shelf.id ? 'binchip-shelf is-here' : 'binchip-shelf'}
            />
          ))}
        </svg>
      </button>

      {peek && createPortal((
        <span
          className={`binchip-peek${peek.below ? ' is-below' : ''}`}
          role="tooltip"
          style={{ top: `${peek.top}px`, left: `${peek.left}px` }}
        >
          <span className="binchip-peek-head">
            Shelf {shelf.name}
            {contents && (
              <em>
                {contents.totals.variants} item{contents.totals.variants === 1 ? '' : 's'}
                <span aria-hidden="true"> · </span>
                {contents.totals.units} unit{contents.totals.units === 1 ? '' : 's'}
              </em>
            )}
          </span>
          {!contents && <span className="binchip-peek-loading">Reading the shelf…</span>}
          {contents && contents.entries.length === 0 && (
            <span className="binchip-peek-loading">Nothing else filed here.</span>
          )}
          {contents && contents.entries.length > 0 && (
            <span className="binchip-peek-list">
              {contents.entries.slice(0, 6).map((e) => (
                <span
                  key={`${e.variant_id}:${e.bin_location}`}
                  className={e.bin_location === bin ? 'is-here' : undefined}
                >
                  <code>{e.bin_location}</code>
                  <span>{e.variant_name}</span>
                  <em>{e.quantity}</em>
                </span>
              ))}
              {contents.entries.length > 6 && (
                <span className="binchip-peek-more">+{contents.entries.length - 6} more — press to open</span>
              )}
            </span>
          )}
        </span>
      ), document.body)}

      {open && <WarehouseViewer bin={bin} onClose={() => setOpen(false)} />}
    </span>
  );
}
