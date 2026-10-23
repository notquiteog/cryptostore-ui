/**
 * Turning a floor plan into a route somebody can actually walk.
 *
 * ── What was wrong with reading order ───────────────────────────────────────
 *
 * "Renumber walk" sorted shelves by `(y, x)` — left to right, top to bottom,
 * like text. A person following that route walks the full width of the floor,
 * then teleports back to the left wall to start the next row, and does it once
 * per row. On a wide floor that is roughly double the distance of the obvious
 * alternative, and the picker notices immediately, which is why they stop
 * trusting the numbers.
 *
 * A serpentine (boustrophedon) route walks up one aisle and back down the
 * next, so consecutive stops are adjacent. Same set of shelves, same start,
 * about half the walking.
 *
 * ── Rows are bands, not coordinates ─────────────────────────────────────────
 *
 * Shelves in one aisle rarely share an exact `y`: they are drawn by hand and
 * land a unit apart. Sorting on raw `y` therefore treats one aisle as several
 * rows and serpentines *within* it, which is worse than reading order. So
 * shelves are grouped into BANDS — runs of shelves whose vertical positions
 * are within a tolerance of each other — and the alternation happens between
 * bands. The tolerance is derived from the shelves themselves (their median
 * height) rather than hardcoded, because a store drawing 1-unit shelves on a
 * 200-unit grid and one drawing 6-unit shelves both have to work.
 *
 * ── Rooms come first ────────────────────────────────────────────────────────
 *
 * A route that crosses between two rooms three times is wrong however tidy its
 * numbers look — there is a door, and possibly a staircase. Room-aware mode
 * finishes one room before starting the next, ordering rooms by their
 * top-left corner, and serpentines within each. Shelves with no room are
 * walked last as their own group.
 *
 * Pure and non-mutating: it takes shelves and returns an ordered array. The
 * caller assigns ranks, which is the only thing that touches the layout.
 */

/** Median shelf height, the natural scale for "same row". */
function bandTolerance(shelves) {
  const heights = shelves.map((s) => s.h).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 1;
  // 1.5 medians: tight enough that two genuine aisles stay apart, loose enough
  // that a shelf nudged half a unit out of line stays with its neighbours.
  return Math.max(1, median * 1.5);
}

/** Group shelves into horizontal bands, top down. */
function bandsOf(shelves) {
  const tol = bandTolerance(shelves);
  const byY = [...shelves].sort((a, b) => a.y - b.y || a.x - b.x);
  const bands = [];
  let current = [];
  let anchor = null;
  for (const s of byY) {
    if (anchor === null || s.y - anchor <= tol) {
      if (anchor === null) anchor = s.y;
      current.push(s);
    } else {
      bands.push(current);
      current = [s];
      anchor = s.y;
    }
  }
  if (current.length) bands.push(current);
  return bands;
}

/**
 * Serpentine one set of shelves: first band left→right, next right→left, and
 * so on, so the end of each band is next to the start of the following one.
 */
function serpentine(shelves) {
  return bandsOf(shelves).flatMap((band, i) => {
    const row = [...band].sort((a, b) => a.x - b.x);
    return i % 2 === 1 ? row.reverse() : row;
  });
}

/**
 * @param {Array} shelves            layout.shelves
 * @param {Array} rooms              layout.rooms (for room-aware mode)
 * @param {'reading'|'serpentine'|'rooms'} mode
 * @returns {Array} the same shelf objects, in walk order
 */
export function orderWalk(shelves, rooms, mode) {
  const list = Array.isArray(shelves) ? shelves : [];
  if (list.length === 0) return [];

  if (mode === 'reading') {
    return [...list].sort((a, b) => (a.y - b.y) || (a.x - b.x));
  }

  if (mode === 'rooms' && Array.isArray(rooms) && rooms.length > 0) {
    // Rooms in reading order of their own top-left corner, so the route starts
    // where a person walking in would start.
    const corner = (r) => {
      const p = r.parts?.[0];
      return p ? [p.y, p.x] : [Infinity, Infinity];
    };
    const ordered = [...rooms].sort((a, b) => {
      const [ay, ax] = corner(a);
      const [by, bx] = corner(b);
      return ay - by || ax - bx;
    });

    const out = [];
    const taken = new Set();
    for (const room of ordered) {
      const mine = list.filter((s) => s.room_id === room.id);
      if (mine.length === 0) continue;
      for (const s of serpentine(mine)) { out.push(s); taken.add(s.id); }
    }
    // Unfiled shelves last, serpentined among themselves — they are real
    // stops, they just do not belong to a room yet.
    const orphans = list.filter((s) => !taken.has(s.id));
    if (orphans.length) out.push(...serpentine(orphans));
    return out;
  }

  return serpentine(list);
}

/** Human label for a mode, used by the editor's control and its toast. */
export const WALK_MODES = [
  { key: 'serpentine', label: 'Serpentine', hint: 'Up one aisle and back down the next — the shortest sensible route' },
  { key: 'rooms', label: 'Room by room', hint: 'Finish one room before starting the next, serpentine inside each' },
  { key: 'reading', label: 'Reading order', hint: 'Left to right, top to bottom. Tidy numbers, longer walk' },
];
