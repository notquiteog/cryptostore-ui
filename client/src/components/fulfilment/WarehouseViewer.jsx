import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Grid2x2, Layers, MapPin, Package, X, Route as RouteIcon } from 'lucide-react';
import {
  useWarehouseLayout, shelfForBin, parseBinSlot, slotRect, resolveStop, floorsOf, floorSlice,
} from '../../utils/useWarehouseLayout';
import { useShelfContents } from '../../utils/shelfContents';
import { outlinePath, outlineSegments } from '../../utils/roomGeometry';
import useMapView from '../../utils/useMapView';
import MapZoom from './MapZoom';

/**
 * The big warehouse view: one floor plan, two projections, and what is on the
 * shelf you point at.
 *
 * ── Why this exists as one component ────────────────────────────────────────
 *
 * Three screens wanted the same thing and would otherwise have grown three
 * versions of it: `BinChip` needed "show me that shelf, bigger"; the pull list
 * needed the walk drawn as a route; the map editor needed a hover preview of
 * what is filed on a shelf. Those are one viewer with three sets of props, and
 * building them separately is how the isometric projection ends up rendered by
 * two different code paths that disagree about which way is north.
 *
 * ── Projections ────────────────────────────────────────────────────────────
 *
 * Top-down is the working view: it is the one where a shelf's position matches
 * where your feet go. The 2.5D view exists for reading the room's shape at a
 * glance — depth makes an L or a mezzanine legible in a way a flat plan does
 * not — and is read-only in both, because this component never edits anything.
 * The editor at /admin/warehouse owns editing; this owns looking.
 *
 * Everything is theme tokens and inline SVG. No canvas, no library, nothing
 * fetched from anywhere — the same constraint every other sheet in this app
 * works under.
 */

/* Isometric projection, matching the editor's so the two never disagree. */
const ISO_X = 0.866;
const ISO_Y = 0.5;
const isoPoint = (x, y, z = 0) => [(x - y) * ISO_X, (x + y) * ISO_Y - z];
const poly = (pts) => pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

/**
 * How big a stop's numbered badge may be: enough of the patch it marks to be
 * read, never so much that it swallows it.
 *
 * A slot is a fraction of a run — one sixth of eight feet — so the badge has to
 * answer to the slot's own size or it covers the section it is pointing at and
 * the two beside it.
 */
const stopRadius = (patch) => Math.max(
  0.28,
  Math.min(0.62, patch.w * 0.42, patch.h * 0.42),
);

/**
 * Stops that land on the same patch of the drawing share one badge.
 *
 * A flat plan has no height, so `A1-L1-S1` and `A1-L3-S1` are the same square
 * foot of floor: two badges there are one badge with another one hidden
 * underneath it, and the picker reads whichever number won the paint order.
 * They are also one PLACE TO STAND — the same reach, two boxes at different
 * heights — so one badge carrying the first of the numbers is not a
 * simplification, it is what the walk actually does. The rest are named in the
 * badge's tooltip and numbered on the sheet below.
 *
 * The 2.5D view keys the same grouping on the level as well, because there the
 * two boxes genuinely are drawn in different places.
 */
function groupStops(stops, keyOf) {
  const byKey = new Map();
  for (const r of stops) {
    const k = keyOf(r);
    const group = byKey.get(k);
    if (group) group.push(r); else byKey.set(k, [r]);
  }
  return [...byKey.values()];
}

const patchKey = (r) => `${r.patch.x},${r.patch.y},${r.patch.w},${r.patch.h}`;

/**
 * The rectangle the floor actually occupies, padded.
 *
 * The grid is whatever size the operator set it to, and most stores draw into
 * a corner of it. Showing the whole grid in a short, wide card letterboxes the
 * map down to a stamp with the useful part in the middle — so the inline card
 * fits to CONTENT. The dialog still shows the whole grid, because there you
 * are inspecting the floor and its empty space is information.
 *
 * Falls back to the full grid when nothing has been drawn yet.
 */
function contentBounds(layout, pad = 1.5) {
  const xs = [];
  const ys = [];
  for (const r of layout.rooms) {
    for (const q of r.parts) { xs.push(q.x, q.x + q.w); ys.push(q.y, q.y + q.h); }
  }
  for (const sh of layout.shelves) { xs.push(sh.x, sh.x + sh.w); ys.push(sh.y, sh.y + sh.h); }
  if (xs.length === 0) return { x: 0, y: 0, w: layout.grid.w, h: layout.grid.h };
  const x0 = Math.max(0, Math.min(...xs) - pad);
  const y0 = Math.max(0, Math.min(...ys) - pad);
  const x1 = Math.min(layout.grid.w, Math.max(...xs) + pad);
  const y1 = Math.min(layout.grid.h, Math.max(...ys) + pad);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * The box the isometric projection needs, for the same reason `contentBounds`
 * exists for the flat one.
 *
 * Lifted out of the `Iso` component when zoom arrived: the view is state now,
 * and state cannot be derived inside the thing that renders from it. `maxZ`
 * leaves headroom for the tallest shelf's lift, which is drawn upward from the
 * floor and would otherwise be cropped at the top of the frame.
 */
function isoBounds(layout, fit) {
  const { w, h } = layout.grid;
  const b = fit ? contentBounds(layout) : { x: 0, y: 0, w, h };
  const corners = [
    isoPoint(b.x, b.y), isoPoint(b.x + b.w, b.y),
    isoPoint(b.x + b.w, b.y + b.h), isoPoint(b.x, b.y + b.h),
  ];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const minX = Math.min(...xs) - 1;
  const maxZ = 3;
  return {
    x: minX,
    y: Math.min(...ys) - maxZ - 1,
    w: Math.max(...xs) - minX + 2,
    h: Math.max(...ys) - Math.min(...ys) + maxZ + 2,
  };
}

function TopDown({ layout, highlight, highlightBin, routeStops, onPick, onSelect, hovered, view }) {
  const { w, h } = layout.grid;
  return (
    <svg
      className={`whv-canvas${view.panning ? ' is-panning' : ''}`}
      viewBox={view.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Warehouse floor plan"
      {...view.bind}
    >
      <defs>
        <pattern id="whv-grid" width="1" height="1" patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" className="whv-gridline" />
        </pattern>
      </defs>
      <rect x="0" y="0" width={w} height={h} fill="url(#whv-grid)" className="whv-floor" />

      {layout.rooms.map((r) => (
        <g key={r.id}>
          {r.parts.map((p, i) => (
            <rect key={`${r.id}:${i}`} x={p.x} y={p.y} width={p.w} height={p.h} className="whv-room" />
          ))}
          <path d={outlinePath(r.parts)} className="whv-room-edge" />
          {r.name && r.parts[0] && (
            <text x={r.parts[0].x + 0.4} y={r.parts[0].y + 1.1} className="whv-room-name">{r.name}</text>
          )}
        </g>
      ))}

      {/* The route, drawn under the shelves so it never hides a label, and
          through the SLOTS rather than through the middles of the shelves —
          two stops on one run are two corners of this path, and the leg into
          a shelf arrives at the end of it the box is actually on. */}
      {routeStops.length > 1 && (
        <polyline
          className="whv-route"
          points={routeStops.map((r) => r.at.map((n) => n.toFixed(2)).join(',')).join(' ')}
        />
      )}

      {layout.shelves.map((s) => {
        const isHit = highlight === s.name;
        // Every stop standing on THIS shelf, not the first one found: a walk
        // that visits A2-L1-S2 and A2-L4-S6 is two numbered stops on one run,
        // and drawing one badge for the shelf pointed at neither of them.
        const stops = routeStops.filter((r) => r.shelf.id === s.id);
        // The exact section, when the bin names one. Pointing at a six-foot
        // shelf and saying "it is on there somewhere" is the difference
        // between a map and a map that saves a walk down the aisle.
        const section = isHit && highlightBin ? slotRect(s, parseBinSlot(s, highlightBin).slot) : null;
        return (
          <g
            key={s.id}
            className={`whv-shelf-g${isHit ? ' is-hit' : ''}${hovered === s.name ? ' is-hovered' : ''}`}
            onPointerEnter={() => onPick(s.name)}
            onFocus={() => onPick(s.name)}
            onClick={() => onSelect?.(s.name)}
            onKeyDown={(e) => { if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(s.name); } }}
            tabIndex={0}
            role="button"
            aria-label={`Shelf ${s.name}`}
          >
            <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="0.15" className="whv-shelf" />
            {/* The patch each numbered stop refers to, drawn under the badge
                that names it. A number floating over an eight-foot run says
                "somewhere here"; a number over a lit section says which end to
                walk to. Quiet on purpose — the accent section below is the
                stop you are ON, these are the ones still ahead. */}
            {stops.map((r) => (
              r.slot ? (
                <rect
                  key={`slot:${r.bin}`}
                  x={r.patch.x}
                  y={r.patch.y}
                  width={r.patch.w}
                  height={r.patch.h}
                  rx="0.1"
                  className="whv-stop-slot"
                />
              ) : null
            ))}
            {section && (
              <rect
                x={section.x}
                y={section.y}
                width={section.w}
                height={section.h}
                rx="0.1"
                className="whv-shelf-section"
              />
            )}
            <text
              x={s.x + s.w / 2}
              y={s.y + s.h / 2 + 0.3}
              textAnchor="middle"
              className="whv-shelf-name"
            >
              {s.name}
            </text>
            {groupStops(stops, patchKey).map((group) => {
              const [first] = group;
              // Sized to the patch it stands on, not to a fixed 0.75 that was
              // chosen when a badge marked a whole shelf from its corner. A
              // slot is a sixth of a run: a badge drawn at shelf scale covers
              // its own target and both of its neighbours.
              const rad = stopRadius(first.patch);
              return (
                <g
                  className={`whv-stop${group.length > 1 ? ' is-stacked' : ''}`}
                  key={`stop:${first.bin}`}
                  style={{ '--stop-r': rad }}
                >
                  <title>{group.map((r) => `${r.n}. ${r.bin}`).join(' · ')}</title>
                  {group.length > 1 && (
                    <circle className="whv-stop-stack" cx={first.at[0]} cy={first.at[1]} r={rad + 0.14} />
                  )}
                  <circle cx={first.at[0]} cy={first.at[1]} r={rad} />
                  <text x={first.at[0]} y={first.at[1] + rad * 0.37} textAnchor="middle">{first.n}</text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

function Iso({ layout, highlight, highlightBin, routeStops, onPick, onSelect, hovered, view }) {
  // Painter's algorithm: back to front, or a near shelf renders behind a far one.
  const shelves = [...layout.shelves].sort((a, b) => (a.x + a.y) - (b.x + b.y));

  return (
    <svg
      className={`whv-canvas${view.panning ? ' is-panning' : ''}`}
      viewBox={view.viewBox}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Isometric warehouse view"
      {...view.bind}
    >
      {/* Parts fill, the OUTLINE strokes — the same split the flat plan makes.
          Stroking each part drew the seam across an L's elbow, and a room with
          a line through it reads as two rooms. The edge rule is
          `outlineSegments`, shared with the flat plan, so the two projections
          cannot disagree about which edges a room has; only the projection of
          the endpoints differs. */}
      {layout.rooms.map((r) => (
        <g key={r.id}>
          {r.parts.map((p, i) => (
            <polygon
              key={`${r.id}:${i}`}
              className="whv-iso-room"
              points={poly([
                isoPoint(p.x, p.y), isoPoint(p.x + p.w, p.y),
                isoPoint(p.x + p.w, p.y + p.h), isoPoint(p.x, p.y + p.h),
              ])}
            />
          ))}
          {outlineSegments(r.parts).map(([x1, y1, x2, y2], i) => {
            const a = isoPoint(x1, y1);
            const b = isoPoint(x2, y2);
            return (
              <line
                key={`${r.id}:e${i}`}
                className="whv-iso-room-edge"
                x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              />
            );
          })}
        </g>
      ))}

      {shelves.map((s) => {
        const z = 0.8 + 0.35 * ((s.levels || 1) - 1);
        const isHit = highlight === s.name;
        const stops = routeStops.filter((r) => r.shelf.id === s.id);
        const A = isoPoint(s.x, s.y); const B = isoPoint(s.x + s.w, s.y);
        const C = isoPoint(s.x + s.w, s.y + s.h); const D = isoPoint(s.x, s.y + s.h);
        const At = isoPoint(s.x, s.y, z); const Bt = isoPoint(s.x + s.w, s.y, z);
        const Ct = isoPoint(s.x + s.w, s.y + s.h, z); const Dt = isoPoint(s.x, s.y + s.h, z);
        const label = isoPoint(s.x + s.w / 2, s.y + s.h / 2, z);

        /* The level, drawn as the slice of the box it actually is.
           Top-down can say WHICH SECTION of a shelf a thing is in but not how
           high up — that is the whole reason this projection exists, and until
           now it drew the same solid block whatever the bin said. The band
           spans the level's share of the shelf's height and the slot's share
           of its length, so what lights up is the box you reach for. */
        const marks = parseBinSlot(s, isHit ? highlightBin : null);
        const levels = Math.max(1, s.levels || 1);
        const sec = marks.slot ? slotRect(s, marks.slot) : null;
        let band = null;
        if (isHit && marks.level) {
          const lo = ((marks.level - 1) / levels) * z;
          const hi = (marks.level / levels) * z;
          const r = sec || { x: s.x, y: s.y, w: s.w, h: s.h };
          const p1 = [r.x, r.y]; const p2 = [r.x + r.w, r.y];
          const p3 = [r.x + r.w, r.y + r.h]; const p4 = [r.x, r.y + r.h];
          band = {
            left: poly([
              isoPoint(p4[0], p4[1], lo), isoPoint(p3[0], p3[1], lo),
              isoPoint(p3[0], p3[1], hi), isoPoint(p4[0], p4[1], hi),
            ]),
            right: poly([
              isoPoint(p3[0], p3[1], lo), isoPoint(p2[0], p2[1], lo),
              isoPoint(p2[0], p2[1], hi), isoPoint(p3[0], p3[1], hi),
            ]),
            top: poly([
              isoPoint(p1[0], p1[1], hi), isoPoint(p2[0], p2[1], hi),
              isoPoint(p3[0], p3[1], hi), isoPoint(p4[0], p4[1], hi),
            ]),
            label: isoPoint(r.x + r.w / 2, r.y + r.h / 2, hi),
            level: marks.level,
            slot: marks.slot,
          };
        }

        return (
          <g
            key={s.id}
            className={`whv-iso-shelf${isHit ? ' is-hit' : ''}${hovered === s.name ? ' is-hovered' : ''}`}
            onPointerEnter={() => onPick(s.name)}
            onFocus={() => onPick(s.name)}
            onClick={() => onSelect?.(s.name)}
            onKeyDown={(e) => { if (onSelect && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onSelect(s.name); } }}
            tabIndex={0}
            role="button"
            aria-label={`Shelf ${s.name}`}
          >
            <polygon className="whv-iso-left" points={poly([D, C, Ct, Dt])} />
            <polygon className="whv-iso-right" points={poly([C, B, Bt, Ct])} />
            <polygon className="whv-iso-top" points={poly([At, Bt, Ct, Dt])} />
            {/* The slice of the top face each numbered stop stands on, so the
                badge above it is pointing at a section of the run rather than
                at the run. Drawn on the top face because that is the one
                surface of a solid that is never occluded by the solid. */}
            {stops.map((r) => (
              r.slot ? (
                <polygon
                  key={`slot:${r.bin}`}
                  className="whv-iso-stop-slot"
                  points={poly([
                    isoPoint(r.patch.x, r.patch.y, z),
                    isoPoint(r.patch.x + r.patch.w, r.patch.y, z),
                    isoPoint(r.patch.x + r.patch.w, r.patch.y + r.patch.h, z),
                    isoPoint(r.patch.x, r.patch.y + r.patch.h, z),
                  ])}
                />
              ) : null
            ))}
            {band && (
              <g className="whv-iso-band">
                <polygon className="whv-iso-band-left" points={band.left} />
                <polygon className="whv-iso-band-right" points={band.right} />
                <polygon className="whv-iso-band-top" points={band.top} />
                <text className="whv-iso-band-label" x={band.label[0]} y={band.label[1] - 0.15} textAnchor="middle">
                  L{band.level}{band.slot ? `·S${band.slot}` : ''}
                </text>
              </g>
            )}
            <text className="whv-iso-name" x={label[0]} y={label[1] - 0.25} textAnchor="middle">{s.name}</text>
            {groupStops(stops, patchKey).map((group) => {
              // Over the slot's own column, not over the middle of the shelf,
              // and floated above the solid because a badge drawn on a face is
              // a badge the next shelf along can stand in front of.
              //
              // Two stops on one column are two boxes at different heights, so
              // here — unlike the flat plan, which has no height to spend —
              // they stack in level order and both keep their number.
              const column = [...group].sort((a, b) => (a.level || 0) - (b.level || 0));
              const pin = isoPoint(column[0].at[0], column[0].at[1], z);
              const rad = 0.62;
              return column.map((r, i) => {
                const cy = pin[1] - 1.2 - i * (rad * 2 + 0.12);
                return (
                  <g className="whv-stop" key={`stop:${r.bin}`} style={{ '--stop-r': rad }}>
                    <title>{`${r.n}. ${r.bin}`}</title>
                    <circle cx={pin[0]} cy={cy} r={rad} />
                    <text x={pin[0]} y={cy + rad * 0.37} textAnchor="middle">{r.n}</text>
                  </g>
                );
              });
            })}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * The floor plan itself, in whichever projection is asked for.
 *
 * Exported because three surfaces now draw the same map — this dialog, the
 * walk card on the pull list, and the shelf picker on the Shelves page — and a
 * second copy of the isometric maths is how two screens end up disagreeing
 * about which way is north.
 */
export function WarehouseCanvas({
  layout, iso, highlight, highlightBin, floorId, routeStops = [], onPick, onSelect, hovered,
  fit = false,
}) {
  const View = iso ? Iso : TopDown;
  // Sliced here rather than by each caller, so "draw one floor" cannot be
  // something a surface forgets and quietly renders the whole building with
  // two floors of shelves on top of each other. A single-floor store gets the
  // layout back untouched.
  const shown = floorSlice(layout, floorId);

  const { w, h } = shown.grid;
  const home = useMemo(
    () => (iso
      ? isoBounds(shown, fit)
      : (fit ? contentBounds(shown) : { x: -0.5, y: -0.5, w: w + 1, h: h + 1 })),
    // Keyed on what actually changes the frame. The layout object is rebuilt
    // by `floorSlice` on every render, so depending on it would re-home the
    // view — and throw away the operator's zoom — on every pointer move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [iso, fit, w, h, floorId, shown.shelves.length, shown.rooms.length],
  );

  // Read-only surfaces: any drag is a pan, because there is nothing else a
  // drag could mean here. The editor supplies its own predicate.
  const view = useMapView({ home, isPanGesture: () => true });

  // Only the stops standing on the floor being drawn. Their numbers are
  // assigned before this filter, by the caller, so a walk that goes upstairs
  // between stops 2 and 4 still calls the mezzanine one "3" — the route is one
  // walk however many floors it crosses, and renumbering per floor would hand
  // two different stops the same badge.
  const onThisFloor = useMemo(
    () => routeStops.filter((r) => shown.shelves.some((s) => s.id === r.shelf.id)),
    [routeStops, shown],
  );

  return (
    <div className="whv-canvas-wrap">
      <View
        layout={shown}
        highlight={highlight}
        highlightBin={highlightBin}
        routeStops={onThisFloor}
        onPick={onPick || (() => {})}
        onSelect={onSelect}
        hovered={hovered}
        view={view}
      />
      <MapZoom
        onIn={view.zoomIn}
        onOut={view.zoomOut}
        onReset={view.reset}
        moved={view.moved}
        zoom={view.zoom}
      />
    </div>
  );
}

/**
 * An INLINE map card with its own projection toggle.
 *
 * The dialog below is for "show me that, bigger". This is for a map that lives
 * on a page as a permanent panel — the pull list's next-stop card, the Shelves
 * page's shelf picker. Same canvas, no modal, and the caller owns what a shelf
 * press means.
 */
export function WarehouseCard({
  title, highlight, highlightBin, route, onPickShelf, footer, aside, emptyNote,
  defaultIso = false,
}) {
  const layout = useWarehouseLayout();
  const [iso, setIso] = useState(defaultIso);
  const [hovered, setHovered] = useState(null);
  const [floorId, setFloorId] = useState(null);

  const floors = floorsOf(layout);
  // The floor the highlighted shelf actually stands on, unless somebody has
  // since picked a different one by hand. A card that opens on floor 1 while
  // the shelf it is pointing at is on floor 2 is a map showing the wrong
  // building — so the highlight wins until the operator overrides it, and the
  // override resets whenever the highlight moves to another floor.
  const targetFloor = useMemo(() => {
    if (!layout || !highlight) return null;
    const sh = layout.shelves.find((s) => s.name === highlight);
    return sh?.floor_id || null;
  }, [layout, highlight]);

  useEffect(() => { setFloorId(targetFloor); }, [targetFloor]);
  const shownFloor = floorId || targetFloor || floors[0].id;

  // Callers pass BINS in walk order (a bare shelf name still works — see
  // `resolveStop`), and each one resolves to the slot it names so the map can
  // draw the number, the path and the lit patch on the same spot. Numbered
  // here, before anything is filtered by floor, so the badges match the order
  // the sheet lists. Unknown codes are dropped rather than drawn at the
  // origin: a stale bin cannot move the walk to the corner of the grid.
  const stops = useMemo(() => {
    if (!layout || !Array.isArray(route) || route.length === 0) return [];
    return route
      .map((code) => resolveStop(layout, code))
      .filter(Boolean)
      .map((r, i) => ({ ...r, n: i + 1 }));
  }, [layout, route]);

  if (!layout || layout.shelves.length === 0) {
    return emptyNote ? <div className="whc glass-card"><p className="whc-empty">{emptyNote}</p></div> : null;
  }

  return (
    <section className="whc glass-card" aria-label={title || 'Warehouse'}>
      <header className="whc-head">
        <span className="whc-title"><MapPin size={13} aria-hidden="true" /> {title || 'Warehouse'}</span>
        <div className="segmented whc-seg" role="group" aria-label="Projection">
          <button
            type="button"
            className={`segmented-option${!iso ? ' active' : ''}`}
            onClick={() => setIso(false)}
            aria-pressed={!iso}
          >
            <Grid2x2 size={12} aria-hidden="true" /> Top down
          </button>
          <button
            type="button"
            className={`segmented-option${iso ? ' active' : ''}`}
            onClick={() => setIso(true)}
            aria-pressed={iso}
          >
            <Box size={12} aria-hidden="true" /> 2.5D
          </button>
        </div>
      </header>

      {/* Only when there is a choice to make. A single-floor store — which is
          most of them — never learns that floors exist. */}
      {floors.length > 1 && (
        <div className="whc-floors" role="group" aria-label="Floor">
          {floors.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`whc-floor${f.id === shownFloor ? ' is-on' : ''}${f.id === targetFloor ? ' is-target' : ''}`}
              onClick={() => setFloorId(f.id)}
              aria-pressed={f.id === shownFloor}
              title={f.id === targetFloor ? `${f.name} — the highlighted shelf is on this floor` : f.name}
            >
              <Layers size={11} aria-hidden="true" />
              {f.name}
            </button>
          ))}
        </div>
      )}

      {/* Map and detail side by side once there is room. A floor plan in a
          full-width card is otherwise letterboxed down to a stamp with empty
          gutters either side — the width is better spent saying what is at the
          stop than on blank floor. */}
      <div className={`whc-body${aside ? ' has-aside' : ''}`}>
      <div className={`whc-stage${onPickShelf ? ' is-clickable' : ''}`}>
        <WarehouseCanvas
          layout={layout}
          iso={iso}
          highlight={highlight}
          highlightBin={highlightBin}
          floorId={shownFloor}
          routeStops={stops}
          hovered={hovered}
          onPick={setHovered}
          onSelect={onPickShelf}
          fit
        />
      </div>
        {aside && <div className="whc-aside">{aside}</div>}
      </div>

      {footer}
    </section>
  );
}

/** What is filed on the pointed-at shelf. Its own component so the fetch
 *  re-runs on shelf change without re-rendering the whole floor plan. */
function ShelfPanel({ shelf, highlightBin }) {
  const data = useShelfContents(shelf);

  if (!shelf) {
    return (
      <div className="whv-panel-empty">
        <MapPin size={18} aria-hidden="true" />
        <p>Point at a shelf to see what is filed on it.</p>
      </div>
    );
  }
  if (!data) {
    return <div className="whv-panel-loading"><span className="pkq-skel" style={{ height: '6rem' }} aria-hidden="true" /></div>;
  }

  return (
    <>
      <header className="whv-panel-head">
        <h4>Shelf {shelf}</h4>
        <span className="whv-panel-counts">
          {data.totals.variants} item{data.totals.variants === 1 ? '' : 's'}
          <span aria-hidden="true"> · </span>
          {data.totals.units} unit{data.totals.units === 1 ? '' : 's'}
        </span>
      </header>
      {data.entries.length === 0 ? (
        <p className="whv-panel-none">Nothing filed here yet.</p>
      ) : (
        <ul className="whv-contents">
          {data.entries.map((e) => (
            <li
              key={`${e.variant_id}:${e.bin_location}`}
              className={e.bin_location === highlightBin ? 'is-here' : undefined}
            >
              <code className="whv-bin">{e.bin_location}</code>
              <span className="whv-item">
                <span className="whv-group">{e.group_name}</span>
                <span className="whv-variant">{e.variant_name}</span>
              </span>
              <span className="whv-qty" title={`${e.quantity} recorded here, ${e.on_hand} on hand in total`}>
                {e.quantity}
                {e.on_hand !== e.quantity && <em>/{e.on_hand}</em>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * @param {object}   props
 * @param {string}   [props.bin]        A bin string to locate and highlight.
 * @param {string[]} [props.route]      Bins in walk order (a bare shelf name also
 *                                      resolves), drawn as a numbered route through
 *                                      the slot each one names.
 * @param {string}   [props.title]
 * @param {Function} props.onClose
 */
export default function WarehouseViewer({ bin, route, title, onClose }) {
  const layout = useWarehouseLayout();
  const dialogRef = useRef(null);
  const [iso, setIso] = useState(false);
  const target = useMemo(() => shelfForBin(layout, bin), [layout, bin]);
  // Opens focused on the shelf the caller cares about, so the panel is useful
  // before the pointer has moved.
  const [hovered, setHovered] = useState(target?.name || null);
  const [floorId, setFloorId] = useState(null);

  const floors = floorsOf(layout);
  // Opens on the floor the bin is actually on. "Where does A1-L2-S3 live" that
  // opens on the ground floor while A1 is on the mezzanine is a dialog
  // answering a question nobody asked.
  useEffect(() => { setFloorId(target?.floor_id || null); }, [target]);
  const shownFloor = floorId || target?.floor_id || floors[0].id;

  // Which part of the shelf, in words, for the panel beside the plan. The
  // drawing says it too, but a sentence is what somebody reads out to the
  // person actually standing in the aisle.
  const where = useMemo(() => parseBinSlot(target, bin), [target, bin]);

  useEffect(() => {
    const el = dialogRef.current;
    if (el && !el.open) el.showModal();
  }, []);
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return undefined;
    const onCancel = (e) => { e.preventDefault(); onClose(); };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [onClose]);

  // Same resolution the card does, and for the same reason: a stop is a slot,
  // not a shelf. See `WarehouseCard`.
  const routeStops = useMemo(() => {
    if (!layout || !Array.isArray(route) || route.length === 0) return [];
    return route
      .map((code) => resolveStop(layout, code))
      .filter(Boolean)
      .map((r, i) => ({ ...r, n: i + 1 }));
  }, [layout, route]);

  if (!layout) return null;

  return (
    <dialog ref={dialogRef} className="whv-dialog" aria-label={title || 'Warehouse view'}>
      <header className="whv-head">
        <h3>
          <MapPin size={15} aria-hidden="true" />
          {title || (bin ? `Where ${bin} lives` : 'Warehouse')}
        </h3>
        <div className="whv-head-tools">
          <div className="segmented" role="group" aria-label="Projection">
            <button
              type="button"
              className={`segmented-option${!iso ? ' active' : ''}`}
              onClick={() => setIso(false)}
              aria-pressed={!iso}
            >
              <Grid2x2 size={13} aria-hidden="true" /> Top down
            </button>
            <button
              type="button"
              className={`segmented-option${iso ? ' active' : ''}`}
              onClick={() => setIso(true)}
              aria-pressed={iso}
            >
              <Box size={13} aria-hidden="true" /> 2.5D
            </button>
          </div>
          <button type="button" className="glass-btn glass-btn-sm" onClick={onClose} aria-label="Close">
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      {routeStops.length > 1 && (
        <p className="whv-route-note">
          <RouteIcon size={13} aria-hidden="true" />
          {routeStops.length} stops in walk order — follow the numbers.
        </p>
      )}

      {floors.length > 1 && (
        <div className="whv-floors" role="group" aria-label="Floor">
          {floors.map((f) => (
            <button
              key={f.id}
              type="button"
              className={`whc-floor${f.id === shownFloor ? ' is-on' : ''}${f.id === target?.floor_id ? ' is-target' : ''}`}
              onClick={() => setFloorId(f.id)}
              aria-pressed={f.id === shownFloor}
            >
              <Layers size={11} aria-hidden="true" />
              {f.name}
            </button>
          ))}
        </div>
      )}

      <div className="whv-body">
        <div className="whv-stage">
          <WarehouseCanvas
            layout={layout}
            iso={iso}
            highlight={target?.name || null}
            highlightBin={bin}
            floorId={shownFloor}
            routeStops={routeStops}
            onPick={setHovered}
            hovered={hovered}
          />
        </div>
        <aside className="whv-panel">
          {bin && target && (
            <p className="whv-target">
              <Package size={13} aria-hidden="true" />
              {/* Built as one run rather than as stacked conditionals on
                  separate lines: JSX turns each newline between them into a
                  space, which printed "section 3 , level 2". */}
              <code>{bin}</code> is on shelf <strong>{target.name}</strong>
              {where.slot ? <>{' — section '}<strong>{where.slot}</strong></> : null}
              {where.level ? <>{where.slot ? ', ' : ' — '}level <strong>{where.level}</strong></> : null}
              {floors.length > 1
                ? <>{' on '}<strong>{(floors.find((f) => f.id === target.floor_id) || floors[0]).name}</strong></>
                : null}
              {where.level && !iso && (
                /* The level is a height, and a flat plan has no height to draw
                   it in. Rather than leave the sentence naming something the
                   picture does not show, the note points at the projection
                   that does. */
                <button type="button" className="whv-target-hint" onClick={() => setIso(true)}>
                  see the level in 2.5D
                </button>
              )}
            </p>
          )}
          {bin && !target && (
            <p className="whv-target is-missing">
              <code>{bin}</code> does not match any shelf on the map.
            </p>
          )}
          <ShelfPanel shelf={hovered} highlightBin={bin} />
        </aside>
      </div>
    </dialog>
  );
}
