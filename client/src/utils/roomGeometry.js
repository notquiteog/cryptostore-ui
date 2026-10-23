/**
 * Room footprints in the editor: the same canonical form the server stores,
 * plus the outline maths only a renderer needs.
 *
 * ── Why this is restated here ───────────────────────────────────────────────
 *
 * `server/utils/roomGeometry.js` is the AUTHORITY: it normalises on write and
 * again on read, so whatever this file computes, the stored blob is the
 * server's answer and the editor adopts it from the PUT response. A divergence
 * here can therefore make the canvas briefly disagree with what will be saved —
 * it cannot corrupt a layout, strand a shelf, or survive a reload. Keep the two
 * in step anyway; `npm run test:warehouse` pins the server half, and
 * `test:room-geometry` pins this one against the same cases.
 *
 * The reason for a local copy at all is that canonicalisation has to run per
 * EDIT, not per save. Cutting a rect out of a rect yields up to four pieces,
 * so an editor that only tidied up on save would grow the footprint 4× a cut
 * and hit the parts cap after three notches — with no way back, because the
 * shape the user drew is fine and only its description exploded. Re-deriving
 * from cells after each edit keeps an L at two parts however it was carved.
 *
 * `outlinePath` has no server counterpart: the server never draws.
 */

/** Matches the server's stride; only has to exceed the 200-unit grid cap. */
const GRID_STRIDE = 256;

const cellsOf = (parts) => {
  const cells = new Set();
  for (const p of parts) {
    for (let y = p.y; y < p.y + p.h; y += 1) {
      for (let x = p.x; x < p.x + p.w; x += 1) cells.add(y * GRID_STRIDE + x);
    }
  }
  return cells;
};

/**
 * Cells → canonical parts: maximal horizontal runs per row, merged downward
 * where an identical run sits directly above. Emitted in (y, x) order, which
 * is what lets callers treat byte-equality as "the shape did not change" —
 * and what makes `parts[0]` a stable anchor for the room's name label.
 */
export function partsFromCells(cells) {
  const rows = new Map();
  for (const k of cells) {
    const y = Math.floor(k / GRID_STRIDE);
    const xs = rows.get(y);
    if (xs) xs.push(k % GRID_STRIDE);
    else rows.set(y, [k % GRID_STRIDE]);
  }

  const out = [];
  let open = new Map();
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = rows.get(y).sort((a, b) => a - b);
    const next = new Map();
    let start = xs[0];
    for (let i = 0; i <= xs.length; i += 1) {
      if (i < xs.length && (i === 0 || xs[i] === xs[i - 1] + 1)) continue;
      const w = xs[i - 1] - start + 1;
      const key = `${start},${w}`;
      const above = open.get(key);
      if (above && above.y + above.h === y) {
        above.h += 1;
        next.set(key, above);
      } else {
        const rect = { x: start, y, w, h: 1 };
        out.push(rect);
        next.set(key, rect);
      }
      start = xs[i];
    }
    open = next;
  }
  return out;
}

/** Clamp one rect into the grid, or null when nothing of it lands inside. */
export function clampRect(r, gw, gh) {
  const x0 = Math.max(0, Math.min(gw, Math.round(Number(r?.x))));
  const y0 = Math.max(0, Math.min(gh, Math.round(Number(r?.y))));
  const x1 = Math.max(0, Math.min(gw, Math.round(Number(r?.x) + Number(r?.w))));
  const y1 = Math.max(0, Math.min(gh, Math.round(Number(r?.y) + Number(r?.h))));
  if (!Number.isFinite(x0 + y0 + x1 + y1) || x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Any rects → the canonical parts of the footprint they cover. */
export function normaliseParts(parts, gw, gh) {
  if (!Array.isArray(parts) || parts.length === 0) return [];
  const clamped = [];
  for (const p of parts) {
    const r = clampRect(p, gw, gh);
    if (r) clamped.push(r);
  }
  return clamped.length === 0 ? [] : partsFromCells(cellsOf(clamped));
}

/** The footprint plus one rect. */
export const addPart = (parts, rect, gw, gh) => normaliseParts([...parts, rect], gw, gh);

/** The footprint minus one rect; [] means the room has no floor left. */
export function cutPart(parts, rect, gw, gh) {
  const cut = clampRect(rect, gw, gh);
  if (!cut) return normaliseParts(parts, gw, gh);
  const cells = cellsOf(normaliseParts(parts, gw, gh));
  for (let y = cut.y; y < cut.y + cut.h; y += 1) {
    for (let x = cut.x; x < cut.x + cut.w; x += 1) cells.delete(y * GRID_STRIDE + x);
  }
  return partsFromCells(cells);
}

/** Bounding box of a footprint, or null when it has none. */
export function partsBounds(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of parts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x + p.w > x1) x1 = p.x + p.w;
    if (p.y + p.h > y1) y1 = p.y + p.h;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Total floor area in grid cells. */
export const partsArea = (parts) => (Array.isArray(parts) ? parts.reduce((n, p) => n + p.w * p.h, 0) : 0);

/** Does this footprint contain the cell at (x, y)? */
export const partsContain = (parts, x, y) => Array.isArray(parts)
  && parts.some((p) => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h);

/**
 * Which room a freshly drawn rect belongs to: the one covering most of it.
 * Ties go to the earlier room so the answer never depends on iteration order.
 */
export function roomAtRect(rooms, rect) {
  let best = null;
  let bestCovered = 0;
  for (const room of rooms) {
    let covered = 0;
    for (let y = rect.y; y < rect.y + rect.h; y += 1) {
      for (let x = rect.x; x < rect.x + rect.w; x += 1) {
        if (partsContain(room.parts, x, y)) covered += 1;
      }
    }
    if (covered > bestCovered) { best = room; bestCovered = covered; }
  }
  return best;
}

/** span minus every interval in `covers`, as a list of surviving spans. */
function subtractSpans(span, covers) {
  let out = [span];
  for (const c of covers) {
    const next = [];
    for (const s of out) {
      if (c[1] <= s[0] || c[0] >= s[1]) { next.push(s); continue; }
      if (c[0] > s[0]) next.push([s[0], c[0]]);
      if (c[1] < s[1]) next.push([c[1], s[1]]);
    }
    out = next;
    if (out.length === 0) break;
  }
  return out;
}

/**
 * One SVG path tracing only the OUTSIDE of a footprint.
 *
 * Stroking the parts themselves would draw the seams between them, and an
 * L-shaped room with a line across its elbow reads as two rooms — which is
 * precisely the confusion the parts model exists to end. So parts are filled
 * without a stroke and the boundary is drawn from this path instead.
 *
 * An edge segment is on the boundary exactly when the cells on its far side
 * are outside the footprint. Because every coordinate is an integer, "the far
 * side" is one whole cell, and the test is an interval subtraction rather than
 * anything approximate: a part's left edge at x survives wherever no part
 * covers the cell column [x-1, x]. That rule needs no special case for parts
 * that abut, overlap, or nest.
 */
export function outlineSegments(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return [];
  const seg = [];
  const spansY = (test) => parts.filter(test).map((q) => [q.y, q.y + q.h]);
  const spansX = (test) => parts.filter(test).map((q) => [q.x, q.x + q.w]);

  for (const p of parts) {
    const ySpan = [p.y, p.y + p.h];
    const xSpan = [p.x, p.x + p.w];
    const right = p.x + p.w;
    const bottom = p.y + p.h;

    for (const [a, b] of subtractSpans(ySpan, spansY((q) => q.x <= p.x - 1 && q.x + q.w >= p.x))) {
      seg.push([p.x, a, p.x, b]);
    }
    for (const [a, b] of subtractSpans(ySpan, spansY((q) => q.x <= right && q.x + q.w >= right + 1))) {
      seg.push([right, a, right, b]);
    }
    for (const [a, b] of subtractSpans(xSpan, spansX((q) => q.y <= p.y - 1 && q.y + q.h >= p.y))) {
      seg.push([a, p.y, b, p.y]);
    }
    for (const [a, b] of subtractSpans(xSpan, spansX((q) => q.y <= bottom && q.y + q.h >= bottom + 1))) {
      seg.push([a, bottom, b, bottom]);
    }
  }
  return seg;
}

/**
 * The same outline as an SVG path, for the flat plan.
 *
 * Split from `outlineSegments` when the isometric views needed the outline
 * too: they have to project every endpoint before drawing it, and a path
 * string in grid coordinates cannot be projected without parsing it back
 * apart. One edge rule, two renderings — the alternative was the 2.5D view
 * deciding for itself which edges are interior, which is exactly the kind of
 * second opinion that ends with two views of one room disagreeing about its
 * shape.
 */
export function outlinePath(parts) {
  return outlineSegments(parts).map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join('');
}
