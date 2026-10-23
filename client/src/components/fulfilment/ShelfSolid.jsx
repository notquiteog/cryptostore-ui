/**
 * One shelf, drawn as the object it is.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * The slot grid is a table of codes: `A1-L3-S4` in a cell in row three,
 * column four. That is precise and completely abstract — it tells you the
 * arithmetic of the shelf, not what to look at when you are standing in front
 * of it. Pointing at a cell now lights the same box on a picture of the shelf,
 * so "level 3, section 4" resolves into "second shelf down, two along" without
 * anybody having to count.
 *
 * The projection is the same isometric one the warehouse map uses — same
 * constants, same direction of north. A second, subtly different 3D in the
 * same feature would be worse than none.
 *
 * ── Why levels are drawn top-down ───────────────────────────────────────────
 *
 * L1 is the bottom shelf, and the grid above lists levels highest-first
 * because that is how a shelf reads when you face it. The drawing agrees: the
 * highest level is at the top of the picture. If the two disagreed, the whole
 * point — recognising a cell in one from a cell in the other — would be lost.
 */

/* Shared with the warehouse map so the two never disagree about which way is
   north. cos30 / sin30. */
const ISO_X = 0.866;
const ISO_Y = 0.5;
const iso = (x, y, z) => [(x - y) * ISO_X, (x + y) * ISO_Y - z];
const poly = (pts) => pts.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ');

/** Depth and level pitch in the same units as the slot width. */
const DEPTH = 1.1;
const PITCH = 0.62;

/** The six faces of one cell — only the three that face the viewer are drawn. */
function cellFaces(x0, x1, z0, z1) {
  const A = iso(x0, 0, z1); const B = iso(x1, 0, z1);
  const C = iso(x1, DEPTH, z1); const D = iso(x0, DEPTH, z1);
  const Af = iso(x0, 0, z0); const Bf = iso(x1, 0, z0);
  const Cf = iso(x1, DEPTH, z0);
  return {
    top: poly([A, B, C, D]),
    left: poly([A, Af, Bf, B]),
    right: poly([B, Bf, Cf, C]),
  };
}

/**
 * @param {object} props
 * @param {{name:string, levels?:number, slots_per_level?:number}} props.shelf
 * @param {Map<string, Array>} props.occupants   bin → variants filed there
 * @param {{level:number, slot:number}|null} props.active  the lit cell
 * @param {Function} [props.onPick]  (level, slot) => void
 */
export default function ShelfSolid({ shelf, occupants, active, onPick }) {
  const levels = Math.max(1, shelf?.levels || 1);
  const slots = Math.max(1, shelf?.slots_per_level || 1);

  const cells = [];
  // Back to front, bottom to top: a cell drawn later paints over the one
  // behind and below it, which is what makes the stack read as solid.
  for (let lvl = 1; lvl <= levels; lvl += 1) {
    for (let s = 1; s <= slots; s += 1) {
      const z0 = (lvl - 1) * PITCH;
      const faces = cellFaces(s - 1, s, z0, z0 + PITCH * 0.72);
      const code = `${shelf.name}-L${lvl}-S${s}`;
      const here = occupants?.get(code) || [];
      const isActive = active && active.level === lvl && active.slot === s;
      cells.push({ lvl, s, code, faces, filled: here.length, isActive });
    }
  }

  // The frame, from the extremes of the drawn geometry rather than from a
  // guess: a ten-slot shelf and a two-level one are very different shapes and
  // a fixed viewBox letterboxes one of them into a stamp.
  const xs = [];
  const ys = [];
  for (const c of cells) {
    for (const face of [c.faces.top, c.faces.left, c.faces.right]) {
      for (const pair of face.split(' ')) {
        const [px, py] = pair.split(',').map(Number);
        xs.push(px); ys.push(py);
      }
    }
  }
  const pad = 0.25;
  const vb = `${Math.min(...xs) - pad} ${Math.min(...ys) - pad} ${Math.max(...xs) - Math.min(...xs) + pad * 2} ${Math.max(...ys) - Math.min(...ys) + pad * 2}`;

  return (
    <svg
      className="shelfsolid"
      viewBox={vb}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`Shelf ${shelf.name}, ${levels} level${levels === 1 ? '' : 's'} of ${slots} slot${slots === 1 ? '' : 's'}`}
    >
      {cells.map((c) => (
        <g
          key={c.code}
          className={`shelfsolid-cell${c.filled ? ' is-filled' : ''}${c.isActive ? ' is-active' : ''}`}
          onPointerEnter={() => onPick?.(c.lvl, c.s)}
          onClick={() => onPick?.(c.lvl, c.s)}
        >
          <polygon className="shelfsolid-left" points={c.faces.left} />
          <polygon className="shelfsolid-right" points={c.faces.right} />
          <polygon className="shelfsolid-top" points={c.faces.top} />
        </g>
      ))}

      {/* The level rails, so the picture reads as shelving rather than as a
          heap of blocks, and the level numbers, so it reads as THIS shelving.
          Without them the drawing is a rack somebody has to count up from the
          bottom of before it tells them anything — which is the counting the
          picture exists to save. Drawn after the cells and un-hittable,
          because they are scenery. */}
      {Array.from({ length: levels }, (_, i) => i + 1).map((lvl) => {
        const z = (lvl - 1) * PITCH;
        const label = iso(-0.15, DEPTH, z + PITCH * 0.3);
        return (
          <g key={`rail-${lvl}`} pointerEvents="none">
            <polyline
              className="shelfsolid-rail"
              points={poly([iso(0, DEPTH, z), iso(0, 0, z), iso(slots, 0, z)])}
            />
            <text className="shelfsolid-lvl" x={label[0]} y={label[1]} textAnchor="end">
              L{lvl}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
