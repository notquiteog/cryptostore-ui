import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Map as MapIcon, Save, Square, Package, MousePointer2, Trash2, ListOrdered,
  RotateCcw, Box, Printer, AlertTriangle, X, Search, MapPin, PlusSquare, Scissors,
  Layers, Plus, Undo2, Redo2,
} from 'lucide-react';
import { api } from '../../utils/api';
import { writeBins } from '../../utils/binWrites';
import PageHeader from '../../components/admin/PageHeader';
import { refreshWarehouseLayout, floorsOf, floorSlice } from '../../utils/useWarehouseLayout';
import useMapView from '../../utils/useMapView';
import MapZoom from '../../components/fulfilment/MapZoom';
import SlotGrid from '../../components/fulfilment/SlotGrid';
import { orderWalk, WALK_MODES } from '../../utils/walkOrder';
import {
  addPart, cutPart, normaliseParts, outlinePath, outlineSegments, partsArea, partsBounds,
  partsContain, roomAtRect,
} from '../../utils/roomGeometry';

/**
 * The warehouse map: draw the rooms, place the shelves, own the walk.
 *
 * ── What this edits, and what it never touches ──────────────────────────────
 *
 * The map is a PICTURE over `bin_location` strings — the strings stay
 * canonical, exactly as config/warehouseKeys.js insists. Drawing, moving or
 * deleting a shelf here changes geometry and walk order only; the one thing
 * that writes actual bin strings is the slot grid, and it does so through the
 * same `PUT /fulfilment/bins` the Shelves page uses — audited, normalised,
 * products.stock. Delete the whole map and every screen falls back to the
 * alphabetical walk; no stock is stranded.
 *
 * ── Editor mechanics ────────────────────────────────────────────────────────
 *
 * Hand-rolled SVG, zero dependencies. Grid units are the coordinate system
 * (viewBox = grid), pointer events with capture do drag/draw/resize, and
 * every coordinate snaps with Math.round — a shelf at x 3.7 is a shelf
 * nobody can name out loud. The whole layout saves as one blob with a rev
 * handshake: built on a stale read, the save loses politely ("someone saved
 * a newer map") instead of silently overwriting a colleague's aisle.
 *
 * The isometric view is the SAME data through a projection — a render-path
 * toggle, deliberately read-only. Editing wants orthogonal drag math;
 * inspecting wants depth. Combining them buys a diagonal-drag headache for
 * zero information.
 *
 * ── Rooms are shapes ────────────────────────────────────────────────────────
 *
 * A room owns a LIST of rects (`parts`) and is drawn as one filled footprint
 * under one outline. L, U, T, plus and donut shapes are built with Add part
 * and Cut, both of which act on the SELECTED room — nothing about the shape
 * is carried by the name any more. Before, the only way to say "L-shaped" was
 * to draw two rooms and type the same name into both, which meant the shelf
 * inspector offered "Main" twice, a shelf could point at just one leg, and a
 * rename split the room in half without saying so.
 *
 * Every edit re-derives the canonical parts (utils/roomGeometry.js) rather
 * than accumulating the rects the drags happened to produce — see that file
 * for why doing it per-edit rather than per-save is what keeps a cut from
 * quadrupling the room's description.
 */

const newId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_LAYOUT = { version: 1, rev: 0, grid: { w: 48, h: 32 }, rooms: [], shelves: [] };

/** The two tools that reshape an existing room rather than creating anything. */
const SHAPE_TOOLS = new Set(['room-add', 'room-cut']);

/**
 * Fallbacks for the caps, used only until `GET /fulfilment/warehouse` answers.
 * The server sends its own numbers with the layout precisely so raising a cap
 * there does not leave this screen refusing at the old one — these are the
 * shape of the object, not a second opinion about the values.
 */
const DEFAULT_LIMITS = { floors: 8, rooms: 20, room_parts: 24, shelves: 400 };

/* Isometric projection: grid (x,y) → screen, z lifts. cos30/sin30. */
const ISO_X = 0.866;
const ISO_Y = 0.5;
const isoPoint = (x, y, z = 0) => [(x - y) * ISO_X, (x + y) * ISO_Y - z];
const poly = (pts) => pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

function IsoView({ layout }) {
  const { w, h } = layout.grid;
  // Corners of the whole grid decide the viewBox.
  const corners = [isoPoint(0, 0), isoPoint(w, 0), isoPoint(w, h), isoPoint(0, h)];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const minX = Math.min(...xs) - 1;
  const maxZ = 3; // tallest shelf lift
  const vb = `${minX} ${Math.min(...ys) - maxZ - 1} ${Math.max(...xs) - minX + 2} ${Math.max(...ys) - Math.min(...ys) + maxZ + 2}`;

  const shelves = [...layout.shelves].sort((a, b) => (a.x + a.y) - (b.x + b.y));

  return (
    <svg className="wh-iso" viewBox={vb} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Isometric warehouse view">
      {/* Parts fill, the OUTLINE strokes — see the same split in
          WarehouseViewer's Iso. Stroking each part drew the seam across an L's
          elbow, and a room with a line through it reads as two rooms. */}
      {layout.rooms.map((r) => (
        <g key={r.id}>
          {r.parts.map((p, i) => (
            <polygon
              key={`${r.id}:${i}`}
              className="wh-iso-room"
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
                className="wh-iso-room-edge"
                x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
              />
            );
          })}
        </g>
      ))}
      {shelves.map((s) => {
        const z = 0.8 + 0.35 * ((s.levels || 1) - 1);
        const A = isoPoint(s.x, s.y); const B = isoPoint(s.x + s.w, s.y);
        const C = isoPoint(s.x + s.w, s.y + s.h); const D = isoPoint(s.x, s.y + s.h);
        const At = isoPoint(s.x, s.y, z); const Bt = isoPoint(s.x + s.w, s.y, z);
        const Ct = isoPoint(s.x + s.w, s.y + s.h, z); const Dt = isoPoint(s.x, s.y + s.h, z);
        const label = isoPoint(s.x + s.w / 2, s.y + s.h / 2, z);
        return (
          <g key={s.id} className="wh-iso-shelf">
            <polygon className="wh-iso-left" points={poly([D, C, Ct, Dt])} />
            <polygon className="wh-iso-right" points={poly([C, B, Bt, Ct])} />
            <polygon className="wh-iso-top" points={poly([At, Bt, Ct, Dt])} />
            <text className="wh-iso-name" x={label[0]} y={label[1] - 0.25} textAnchor="middle">{s.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

export default function WarehouseMap() {
  const [layout, setLayout] = useState(null);
  const [baseRev, setBaseRev] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [tool, setTool] = useState('select');
  const [iso, setIso] = useState(false);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [selected, setSelected] = useState(null); // {type:'room'|'shelf', id}
  const [slotShelf, setSlotShelf] = useState(null);
  const [walkMenu, setWalkMenu] = useState(false);
  const [variants, setVariants] = useState([]);
  const [stagedBins, setStagedBins] = useState(() => new Map());
  // Which floor is being edited. Null until the layout loads, then the first.
  const [floorId, setFloorId] = useState(null);
  // No local ref: `useMapView` owns the element, so the gesture handlers and
  // the editor's own coordinate maths cannot end up reading two nodes.
  const drag = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [wh, bins] = await Promise.all([
        api.get('/fulfilment/warehouse'),
        api.get('/fulfilment/bins'),
      ]);
      setLayout(wh.layout || { ...DEFAULT_LAYOUT });
      setBaseRev(wh.layout?.rev || 0);
      if (wh.limits) setLimits({ ...DEFAULT_LIMITS, ...wh.limits });
      setVariants(bins.variants || []);
      // A reload is a new document: undoing back past it would restore a plan
      // this editor is no longer holding.
      history.current = { past: [], future: [], lock: false };
      setDepth({ past: 0, future: 0 });
      setDirty(false);
      setConflict(false);
      setStagedBins(new Map());
    } catch (err) {
      toast.error(err.message || 'Could not load the warehouse');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Filing a warehouse outlives most tabs. Same discipline as Shelves.
  useEffect(() => {
    if (!dirty && stagedBins.size === 0) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, stagedBins]);

  /*
   * Floors.
   *
   * The editor works on ONE floor at a time — drawing, selecting, deleting and
   * the slot grid all operate on the slice below, never on the whole building.
   * That is what makes floors cheap: no drawing code had to learn about them,
   * because it is handed a layout that only ever contains one floor's worth of
   * rooms and shelves.
   *
   * The walk order deliberately stays global. A picker walks a building, not a
   * floor, and `walk_rank` is one sequence over every shelf in it — renumbering
   * per floor would make the stairs a place where the numbering restarts.
   */
  const floors = useMemo(() => floorsOf(layout), [layout]);
  const activeFloor = floors.some((f) => f.id === floorId) ? floorId : floors[0].id;
  const floorLayout = useMemo(() => floorSlice(layout, activeFloor), [layout, activeFloor]);

  const addFloor = () => {
    if (floors.length >= (limits.floors || 8)) {
      toast.error(`This map already has its ${limits.floors || 8} floors.`);
      return;
    }
    const id = newId('f');
    mutate((prev) => ({
      ...prev,
      floors: [...floorsOf(prev), { id, name: `Floor ${floorsOf(prev).length + 1}` }],
    }));
    setSelected(null);
    setFloorId(id);
  };

  const renameFloor = (id, name) => mutate((prev) => ({
    ...prev,
    floors: floorsOf(prev).map((f) => (f.id === id ? { ...f, name } : f)),
  }));

  /**
   * Remove a floor, and everything standing on it.
   *
   * Refused while it holds anything. Moving its rooms to another floor would
   * drop them on top of whatever is already drawn there — two floor plans
   * share one grid, so "move" means "overlap" — and deleting the contents
   * silently is how somebody loses an afternoon of drawing to one click. Empty
   * it first, deliberately, or keep it.
   */
  const removeFloor = (id) => {
    if (floors.length <= 1) {
      toast.error('A map has at least one floor.');
      return;
    }
    const held = layout.rooms.filter((r) => (r.floor_id || floors[0].id) === id).length
      + layout.shelves.filter((sh) => (sh.floor_id || floors[0].id) === id).length;
    if (held > 0) {
      toast.error(`${held} room${held === 1 ? '' : 's'}/shelves are still on this floor — clear it first.`);
      return;
    }
    mutate((prev) => ({ ...prev, floors: floorsOf(prev).filter((f) => f.id !== id) }));
    setFloorId(floors.find((f) => f.id !== id)?.id || null);
  };

  /*
   * ── Undo ──────────────────────────────────────────────────────────────────
   *
   * A drawing tool where Delete removes a shelf and a stray drag moves one,
   * with no way back, is a tool people are right to be nervous of. The stack
   * holds whole layouts: they are a few kilobytes of plain JSON at the size
   * cap, fifty of them is nothing, and snapshotting the document sidesteps
   * every question about how to invert a cut or an L-shaped reshape.
   *
   * ── Why the lock ──────────────────────────────────────────────────────────
   *
   * `mutate` runs on every pointermove of a drag — a shelf dragged across the
   * plan is a hundred calls. Undo has to step back over the whole gesture, not
   * one frame of it, so a gesture snapshots ONCE at `pointerdown` and then
   * locks; `endDrag` releases. Discrete edits (delete, add a floor, renumber
   * the walk) are unlocked and snapshot normally.
   *
   * What it does NOT cover: staged slot assignments. Those are a separate
   * map of variant → bin that the slot grid fills in, they are not part of the
   * layout document, and quietly rolling one back with a geometry undo would
   * unfile a variant somebody had just filed. They are cleared by Save or by
   * reloading, and that is stated on screen rather than being a surprise.
   */
  const history = useRef({ past: [], future: [], lock: false });
  // The stacks live in a ref (they must be readable synchronously mid-gesture)
  // and their DEPTHS in state, because the two buttons have to re-render when
  // the depths change and a ref does not cause that.
  const [depth, setDepth] = useState({ past: 0, future: 0 });
  const syncDepth = () => setDepth({
    past: history.current.past.length,
    future: history.current.future.length,
  });
  const HISTORY_MAX = 50;

  const snapshot = useCallback(() => {
    const h = history.current;
    if (h.lock || !layout) return;
    h.past.push(layout);
    if (h.past.length > HISTORY_MAX) h.past.shift();
    // A new edit forks the timeline: whatever had been undone is no longer
    // reachable, exactly as every other editor behaves.
    h.future.length = 0;
    syncDepth();
  }, [layout]);

  const mutate = (fn) => {
    snapshot();
    setLayout((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
  };

  const undo = useCallback(() => {
    const h = history.current;
    if (h.past.length === 0) return;
    h.future.push(layout);
    setLayout(h.past.pop());
    setDirty(true);
    // The selection may name a shape the restored layout does not have.
    setSelected(null);
    syncDepth();
  }, [layout]);

  const redo = useCallback(() => {
    const h = history.current;
    if (h.future.length === 0) return;
    h.past.push(layout);
    setLayout(h.future.pop());
    setDirty(true);
    setSelected(null);
    syncDepth();
  }, [layout]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      // Shift+Z redoes, matching the platform convention; Ctrl+Y is handled
      // below for the Windows habit.
      if (e.shiftKey) redo(); else undo();
    };
    const onRedoKey = (e) => {
      if (!(e.ctrlKey && e.key.toLowerCase() === 'y')) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      redo();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keydown', onRedoKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onRedoKey);
    };
  }, [undo, redo]);

  /**
   * Add a rect to the selected room, or cut one out of it.
   *
   * This is the whole answer to L-, U- and T-shaped rooms: two drags, no
   * naming, one room. Cutting the last of a room's floor away deletes it —
   * a room with no cells is not something the canvas can draw or a shelf can
   * sit in, and leaving an invisible husk behind would only be a thing to
   * trip over later. Its shelves are unfiled the same way Delete does it,
   * because their bin strings are untouched either way.
   */
  const reshapeRoom = (which, rect) => {
    if (!layout || selected?.type !== 'room') return;
    const room = layout.rooms.find((r) => r.id === selected.id);
    if (!room) return;
    const { w: gw, h: gh } = layout.grid;
    const parts = which === 'room-cut'
      ? cutPart(room.parts, rect, gw, gh)
      : addPart(room.parts, rect, gw, gh);

    if (parts.length === 0) {
      mutate((prev) => ({
        ...prev,
        rooms: prev.rooms.filter((r) => r.id !== room.id),
        shelves: prev.shelves.map((sh) => (sh.room_id === room.id ? { ...sh, room_id: null } : sh)),
      }));
      setSelected(null);
      setTool('select');
      toast(`${room.name || 'The room'} had its last floor cut away — removed`);
      return;
    }
    if (parts.length > limits.room_parts) {
      // Refused rather than truncated: half a cut is a shape nobody drew.
      toast.error(`That leaves ${room.name || 'the room'} in more than ${limits.room_parts} pieces to describe.`);
      return;
    }
    mutate((prev) => ({
      ...prev,
      rooms: prev.rooms.map((r) => (r.id === room.id ? { ...r, parts } : r)),
    }));
  };

  /*
   * Pointer → grid.
   *
   * Through the view's own client→content transform, which is
   * `getScreenCTM()` and therefore already knows about the current zoom, the
   * pan offset AND the letterboxing `preserveAspectRatio` introduces. The
   * arithmetic this replaced — pointer offset within the bounding rect, scaled
   * by the grid size — assumed the viewBox was always the whole grid and the
   * element was always exactly its shape. Both stopped being true the moment
   * the plan could be zoomed, and a room drawn at 3× would have landed
   * somewhere else entirely.
   */
  const gridPoint = (e) => {
    const { w, h } = layout.grid;
    const p = mapView.toContent(mapView.svgRef.current, e.clientX, e.clientY);
    if (!p) return { x: 0, y: 0 };
    return { x: Math.max(0, Math.min(w, p.x)), y: Math.max(0, Math.min(h, p.y)) };
  };

  /*
   * Which drags belong to the map rather than to the editor.
   *
   * The editor draws with a drag, moves a shelf with a drag and resizes with a
   * drag, so panning cannot simply claim every pointer. It gets:
   *
   *   · the middle button — the universal "pan" on anything with a plan,
   *   · space held — the same, for a trackpad with no middle button,
   *   · a drag on EMPTY FLOOR while the select tool is active, which is what
   *     the select tool leaves unused anyway.
   *
   * A shelf, a room and every drawing tool keep their own gestures. Pinch is
   * not consulted: two fingers is unambiguous, and `useMapView` takes it and
   * tells us to drop whatever was in flight.
   */
  const spaceHeld = useRef(false);
  useEffect(() => {
    const down = (e) => { if (e.code === 'Space') spaceHeld.current = true; };
    const up = (e) => { if (e.code === 'Space') spaceHeld.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  /*
   * "Empty floor" is asked as "not on anything that owns its own drag", NOT as
   * `e.target === e.currentTarget`.
   *
   * That identity test looks equivalent and never fired: the floor rect — the
   * grid pattern, drawn across the whole plan — is a hit-testable element, so
   * every press inside the drawing reported the RECT as its target and only
   * the half-unit margin outside it was ever the `<svg>` itself. Pan by drag
   * was therefore dead everywhere anybody would think to drag, while middle
   * button and space (which never look at the target) kept working, which is
   * what made it look like a partial failure rather than a broken predicate.
   *
   * Written as a negative, it stays true as decoration is added — a legend, a
   * ruler, a second pattern layer are all things somebody will draw across
   * this canvas, and none of them should silently take the pan back.
   */
  const isPanGesture = useCallback((e) => {
    if (e.button === 1 || spaceHeld.current) return true;
    if (tool !== 'select') return false;
    // The shapes that own a press: rooms and shelves move, handles resize.
    return !e.target?.closest?.('.wh-room-part, .wh-shelf, .wh-handle');
  }, [tool]);

  /* The plan's home frame: the whole grid, with half a unit of margin so a
     room drawn hard against the edge is not clipped by its own stroke. */
  const home = useMemo(
    () => ({ x: -0.5, y: -0.5, w: (layout?.grid.w || 1) + 1, h: (layout?.grid.h || 1) + 1 }),
    [layout?.grid.w, layout?.grid.h],
  );
  const mapView = useMapView({
    home,
    isPanGesture,
    // A pinch means the second finger has landed; whatever the first one was
    // drawing is abandoned rather than being dragged around under a zoom.
    onGestureTakeover: () => { drag.current = null; },
    enabled: !iso,
  });

  const startDraw = (e) => {
    if (tool === 'select' || iso) return;
    // Add part and Cut reshape the SELECTED room, so they are the two tools
    // that must not drop the selection the moment the drag begins.
    if (SHAPE_TOOLS.has(tool) && selected?.type !== 'room') return;
    // One snapshot for the whole gesture — see the note on `history`.
    snapshot();
    history.current.lock = true;
    const p = gridPoint(e);
    drag.current = { kind: 'draw', start: p, rect: { x: Math.round(p.x), y: Math.round(p.y), w: 1, h: 1 } };
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!SHAPE_TOOLS.has(tool)) setSelected(null);
  };

  const startMove = (e, type, shape) => {
    if (tool !== 'select' || iso) return;
    e.stopPropagation();
    snapshot();
    history.current.lock = true;
    const p = gridPoint(e);
    const origin = type === 'room' ? partsBounds(shape.parts) : shape;
    drag.current = { kind: 'move', type, id: shape.id, dx: p.x - origin.x, dy: p.y - origin.y, moved: false };
    mapView.svgRef.current.setPointerCapture(e.pointerId);
    setSelected({ type, id: shape.id });
  };

  const startResize = (e, type, shape) => {
    e.stopPropagation();
    snapshot();
    history.current.lock = true;
    drag.current = { kind: 'resize', type, id: shape.id };
    mapView.svgRef.current.setPointerCapture(e.pointerId);
  };

  const onMove = (e) => {
    const d = drag.current;
    if (!d || !layout) return;
    const p = gridPoint(e);
    if (d.kind === 'draw') {
      const x = Math.round(Math.min(d.start.x, p.x));
      const y = Math.round(Math.min(d.start.y, p.y));
      d.rect = {
        x, y,
        w: Math.max(1, Math.round(Math.abs(p.x - d.start.x))),
        h: Math.max(1, Math.round(Math.abs(p.y - d.start.y))),
      };
      // Live preview via state-free trick would skip re-render; simplest is a
      // tiny state bump. The draw preview rides on layout state untouched.
      setLayout((prev) => ({ ...prev }));
    } else if (d.kind === 'move' && d.type === 'room') {
      d.moved = true;
      // The whole footprint slides together, clamped by its bounding box so a
      // room dragged at the wall stops with every part still on the grid. A
      // rigid translation cannot change which cells neighbour which, so the
      // parts stay canonical without being re-derived on every pointer move.
      mutate((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) => {
          if (r.id !== d.id) return r;
          const b = partsBounds(r.parts);
          if (!b) return r;
          const ox = Math.max(0, Math.min(prev.grid.w - b.w, Math.round(p.x - d.dx))) - b.x;
          const oy = Math.max(0, Math.min(prev.grid.h - b.h, Math.round(p.y - d.dy))) - b.y;
          if (!ox && !oy) return r;
          return { ...r, parts: r.parts.map((q) => ({ ...q, x: q.x + ox, y: q.y + oy })) };
        }),
      }));
    } else if (d.kind === 'move') {
      d.moved = true;
      mutate((prev) => ({
        ...prev,
        shelves: prev.shelves.map((s) => (s.id === d.id
          ? {
            ...s,
            x: Math.max(0, Math.min(prev.grid.w - s.w, Math.round(p.x - d.dx))),
            y: Math.max(0, Math.min(prev.grid.h - s.h, Math.round(p.y - d.dy))),
          }
          : s)),
      }));
    } else if (d.kind === 'resize' && d.type === 'room') {
      // Offered on one-part rooms only (see the handle below), so there is
      // exactly one rect to stretch and no question of which corner moved.
      mutate((prev) => ({
        ...prev,
        rooms: prev.rooms.map((r) => {
          if (r.id !== d.id || r.parts.length !== 1) return r;
          const q = r.parts[0];
          return {
            ...r,
            parts: [{
              ...q,
              w: Math.max(1, Math.min(prev.grid.w - q.x, Math.round(p.x - q.x))),
              h: Math.max(1, Math.min(prev.grid.h - q.y, Math.round(p.y - q.y))),
            }],
          };
        }),
      }));
    } else if (d.kind === 'resize') {
      mutate((prev) => ({
        ...prev,
        shelves: prev.shelves.map((s) => (s.id === d.id
          ? {
            ...s,
            w: Math.max(1, Math.min(prev.grid.w - s.x, Math.round(p.x - s.x))),
            h: Math.max(1, Math.min(prev.grid.h - s.y, Math.round(p.y - s.y))),
          }
          : s)),
      }));
    }
  };

  /* Wrapped so the history lock is released down every path — `endDragInner`
     returns early in several places, and a lock left set turns undo into a
     no-op for the rest of the session. */
  const endDrag = (...args) => {
    try { endDragInner(...args); } finally { history.current.lock = false; }
  };

  const endDragInner = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !layout) return;
    if (d.kind === 'draw') {
      const r = d.rect;
      if (tool === 'room') {
        if (layout.rooms.length >= limits.rooms) {
          toast.error(`This map already has its ${limits.rooms} rooms.`);
          setTool('select');
          return;
        }
        const id = newId('r');
        mutate((prev) => ({
          ...prev,
          // On the floor being drawn, not on floor one. Everything the editor
          // creates inherits the active floor; nothing else in here has to
          // think about floors at all.
          rooms: [...prev.rooms, { id, name: `Room ${prev.rooms.length + 1}`, parts: [r], floor_id: activeFloor }],
        }));
        setSelected({ type: 'room', id });
      } else if (SHAPE_TOOLS.has(tool)) {
        reshapeRoom(tool, r);
        return; // sticky: carving usually takes more than one drag
      } else if (tool === 'shelf') {
        const id = newId('s');
        mutate((prev) => {
          // First free spreadsheet-style name: A, B … Z, AA…
          // Across every floor, because a shelf name IS the bin prefix and bin
          // strings are flat: two shelves called "A" on different floors would
          // be one stop on the walk and one place in the catalogue.
          const used = new Set(prev.shelves.map((s) => s.name));
          let name = ''; let n = prev.shelves.length;
          do {
            name = ''; let k = n;
            do { name = String.fromCharCode(65 + (k % 26)) + name; k = Math.floor(k / 26) - 1; } while (k >= 0);
            n++;
          } while (used.has(name));
          const rank = prev.shelves.length ? Math.max(...prev.shelves.map((s) => s.walk_rank)) + 10 : 10;
          // Filed into the room it was drawn on. The dropdown is still there to
          // correct it; what this removes is the silent case where every shelf
          // on the map reads "Room: —" because nobody knew to set it. Only
          // rooms on THIS floor are candidates — a shelf drawn over where a
          // floor-2 room happens to sit is not in that room.
          const here = prev.rooms.filter((rm) => (rm.floor_id || activeFloor) === activeFloor);
          const room = roomAtRect(here, r);
          return {
            ...prev,
            shelves: [...prev.shelves, {
              id, name, room_id: room?.id || null, floor_id: activeFloor, ...r, rotation: 0, walk_rank: rank,
            }],
          };
        });
        setSelected({ type: 'shelf', id });
      }
      setTool('select');
    }
  };

  // Delete key removes the selection — with the same guard every other bench
  // keyboard handler uses against typing into a field.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!selected) return;
      e.preventDefault();
      removeSelected();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const removeSelected = () => {
    if (!selected) return;
    mutate((prev) => (selected.type === 'room'
      ? {
        ...prev,
        rooms: prev.rooms.filter((r) => r.id !== selected.id),
        shelves: prev.shelves.map((s) => (s.room_id === selected.id ? { ...s, room_id: null } : s)),
      }
      : { ...prev, shelves: prev.shelves.filter((s) => s.id !== selected.id) }));
    setSelected(null);
  };

  /**
   * Assign walk ranks from a route.
   *
   * ×10 so a shelf can be slotted between two others later without
   * renumbering the world. The route itself comes from utils/walkOrder — see
   * there for why reading order was the wrong default and what replaced it.
   */
  const renumberWalk = (mode) => {
    mutate((prev) => {
      const ordered = orderWalk(prev.shelves, prev.rooms, mode);
      const ranks = new Map(ordered.map((s, i) => [s.id, (i + 1) * 10]));
      return { ...prev, shelves: prev.shelves.map((s) => ({ ...s, walk_rank: ranks.get(s.id) })) };
    });
    setWalkMenu(false);
    toast(`Walk renumbered — ${WALK_MODES.find((m) => m.key === mode)?.label.toLowerCase()}`);
  };

  const save = async () => {
    if (!layout) return;
    setSaving(true);
    try {
      // The map itself…
      const res = await api.put('/fulfilment/warehouse', {
        layout: { ...layout, rev: baseRev + 1 },
      });
      setLayout(res.layout);
      setBaseRev(res.layout?.rev || 0);
      setDirty(false);
      refreshWarehouseLayout(res.layout);

      // …then any slot assignments staged in the grid, through the same
      // endpoint the Shelves page uses (audited, normalised, ≤500).
      if (stagedBins.size > 0) {
        // Chunked, through the module the Shelves page uses: the endpoint
        // refuses more than 500 rows at once and a renumbered walk can stage
        // far more than that. See client/src/utils/binWrites.js.
        const bins = [...stagedBins.entries()].map(([variant_id, bin_location]) => ({ variant_id, bin_location }));
        const result = await writeBins(bins, (body) => api.put('/fulfilment/bins', body));
        // Only what the server refused stays staged; anything before it is on
        // the shelves whether or not the rest of this save succeeded.
        setStagedBins(new Map(result.remaining.map((r) => [r.variant_id, r.bin_location])));
        const fresh = await api.get('/fulfilment/bins');
        setVariants(fresh.variants || []);
        if (result.error) throw result.error;
      }
      toast.success('Warehouse saved');
    } catch (err) {
      if (/newer map/i.test(err.message || '')) {
        setConflict(true);
        toast.error(err.message);
      } else {
        toast.error(err.message || 'Could not save the warehouse');
      }
    } finally {
      setSaving(false);
    }
  };

  const stageBin = (variantId, bin) => {
    setStagedBins((prev) => {
      const next = new Map(prev);
      next.set(variantId, bin);
      return next;
    });
  };

  /**
   * Who is in each bin, with STAGED assignments winning over stored ones.
   *
   * The editor batches slot edits into the layout's own Save, so the grid has
   * to show what the operator has just done rather than what the server last
   * confirmed — otherwise a variant reads as still on its old shelf until the
   * whole map is saved.
   */
  const stagedOccupants = useMemo(() => {
    const map = new Map();
    for (const v of variants) {
      const bin = stagedBins.has(v.variant_id) ? stagedBins.get(v.variant_id) : v.bin_location;
      if (!bin) continue;
      if (!map.has(bin)) map.set(bin, []);
      map.get(bin).push(v);
    }
    return map;
  }, [variants, stagedBins]);

  const selectedShape = useMemo(() => {
    if (!selected || !layout) return null;
    const list = selected.type === 'room' ? layout.rooms : layout.shelves;
    return list.find((s) => s.id === selected.id) || null;
  }, [selected, layout]);

  /** The rect a corner handle would stretch, or null when there isn't one. */
  const handleAt = useMemo(() => {
    if (!selectedShape) return null;
    if (selected.type === 'shelf') return selectedShape;
    return selectedShape.parts?.length === 1 ? selectedShape.parts[0] : null;
  }, [selectedShape, selected]);

  const patchSelected = (patch) => {
    if (!selected) return;
    const list = selected.type === 'room' ? 'rooms' : 'shelves';
    mutate((prev) => ({
      ...prev,
      [list]: prev[list].map((s) => (s.id === selected.id ? { ...s, ...patch } : s)),
    }));
  };

  if (loading || !layout) {
    return (
      <div className="admin-page wh-page">
        <PageHeader icon={MapIcon} title="Warehouse" subtitle="Loading the floor…" />
        <div className="pkq-skel" style={{ height: '24rem' }} aria-hidden="true" />
      </div>
    );
  }

  const { w, h } = layout.grid;
  const empty = layout.rooms.length === 0 && layout.shelves.length === 0;
  const drawPreview = drag.current?.kind === 'draw' ? drag.current.rect : null;

  return (
    <div className="admin-page wh-page">
      <PageHeader
        icon={MapIcon}
        title="Warehouse"
        subtitle={empty ? 'Draw a room to start — until then the pull list walks alphabetically'
          : `${layout.shelves.length} shel${layout.shelves.length === 1 ? 'f' : 'ves'} across ${layout.rooms.length} room${layout.rooms.length === 1 ? '' : 's'}${floors.length > 1 ? ` on ${floors.length} floors` : ''}${dirty || stagedBins.size ? ' · unsaved changes' : ''}`}
      >
        <Link to="/admin/shelves" className="glass-btn glass-btn-sm" title="Bulk shelf codes, spreadsheet-style">
          <MapPin size={14} aria-hidden="true" /> Shelves
        </Link>
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => window.print()} disabled={iso}>
          <Printer size={14} aria-hidden="true" /> Print
        </button>
        {(dirty || stagedBins.size > 0) && (
          <button type="button" className="glass-btn glass-btn-sm" onClick={load} disabled={saving} title="Throw away unsaved changes">
            <RotateCcw size={14} aria-hidden="true" /> Discard
          </button>
        )}
        <button
          type="button"
          className="glass-btn glass-btn-sm glass-btn-primary"
          onClick={save}
          disabled={saving || (!dirty && stagedBins.size === 0)}
        >
          <Save size={14} aria-hidden="true" />
          {saving ? 'Saving…' : `Save${stagedBins.size ? ` +${stagedBins.size} slots` : ''}`}
        </button>
      </PageHeader>

      {conflict && (
        <div className="glass-card pull-empty">
          <AlertTriangle size={20} aria-hidden="true" />
          <p>Someone saved a newer map while you were editing. Reload to pick up their changes — your unsaved edits will be lost.</p>
          <button type="button" className="glass-btn glass-btn-sm" onClick={load}>Reload the map</button>
        </div>
      )}

      <div className="wh-toolbar admin-toolbar">
        <div className="segmented" role="group" aria-label="Editor tool">
          <button type="button" className={`segmented-option${tool === 'select' && !iso ? ' active' : ''}`} onClick={() => { setTool('select'); setIso(false); }} aria-pressed={tool === 'select' && !iso}>
            <MousePointer2 size={13} aria-hidden="true" /> Select
          </button>
          <button type="button" className={`segmented-option${tool === 'room' ? ' active' : ''}`} onClick={() => { setTool('room'); setIso(false); }} aria-pressed={tool === 'room'} title="Drag on the canvas to draw a room">
            <Square size={13} aria-hidden="true" /> Room
          </button>
          <button type="button" className={`segmented-option${tool === 'shelf' ? ' active' : ''}`} onClick={() => { setTool('shelf'); setIso(false); }} aria-pressed={tool === 'shelf'} title="Drag on the canvas to place a shelf">
            <Package size={13} aria-hidden="true" /> Shelf
          </button>
        </div>

        <div className="segmented" role="group" aria-label="Reshape the selected room">
          <button
            type="button"
            className={`segmented-option${tool === 'room-add' ? ' active' : ''}`}
            onClick={() => { setTool('room-add'); setIso(false); }}
            aria-pressed={tool === 'room-add'}
            disabled={selected?.type !== 'room' || iso}
            title="Drag to add a wing to the selected room — this is how an L or T is built"
          >
            <PlusSquare size={13} aria-hidden="true" /> Add part
          </button>
          <button
            type="button"
            className={`segmented-option${tool === 'room-cut' ? ' active' : ''}`}
            onClick={() => { setTool('room-cut'); setIso(false); }}
            aria-pressed={tool === 'room-cut'}
            disabled={selected?.type !== 'room' || iso}
            title="Drag to cut a notch out of the selected room — this is how a U or a courtyard is built"
          >
            <Scissors size={13} aria-hidden="true" /> Cut
          </button>
        </div>

        <button type="button" className={`pull-chip${iso ? ' is-active' : ''}`} onClick={() => setIso((v) => !v)} aria-pressed={iso} title="A read-only 3D view of the same floor">
          <Box size={13} aria-hidden="true" /> 3D view
        </button>

        {/* Three routes, not one. Serpentine leads because it is the right
            answer for almost every floor; reading order stays because a store
            with one long aisle genuinely wants it. */}
        <span className="wh-walkmenu">
          {/* Undo sits with the tools rather than with Save, because it is a
              drawing control: the thing you reach for mid-gesture, not on the
              way out. */}
          <button
            type="button"
            className="pull-chip"
            onClick={undo}
            disabled={depth.past === 0}
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            <Undo2 size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="pull-chip"
            onClick={redo}
            disabled={depth.future === 0}
            title="Redo (Ctrl+Shift+Z)"
            aria-label="Redo"
          >
            <Redo2 size={13} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="pull-chip"
            onClick={() => setWalkMenu((v) => !v)}
            disabled={layout.shelves.length === 0}
            aria-expanded={walkMenu}
            title="Assign walk order across every shelf"
          >
            <ListOrdered size={13} aria-hidden="true" /> Renumber walk
          </button>
          {walkMenu && (
            <span className="wh-walkmenu-list" role="menu">
              {WALK_MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="menuitem"
                  onClick={() => renumberWalk(m.key)}
                  title={m.hint}
                >
                  <strong>{m.label}</strong>
                  <em>{m.hint}</em>
                </button>
              ))}
            </span>
          )}
        </span>

        <span className="admin-toolbar-spacer" />

        <label className="wh-grid-size">
          Grid
          <input
            className="glass-input" type="number" min="8" max="200" value={w}
            onChange={(e) => mutate((prev) => ({ ...prev, grid: { ...prev.grid, w: Math.max(8, Math.min(200, parseInt(e.target.value, 10) || prev.grid.w)) } }))}
            aria-label="Grid width"
          />
          ×
          <input
            className="glass-input" type="number" min="8" max="200" value={h}
            onChange={(e) => mutate((prev) => ({ ...prev, grid: { ...prev.grid, h: Math.max(8, Math.min(200, parseInt(e.target.value, 10) || prev.grid.h)) } }))}
            aria-label="Grid height"
          />
        </label>
      </div>

      {/* ── Floors ──
          A tab per floor, an inline rename, and an add. One floor draws
          nothing at all, so a single-level store never meets the feature; the
          "+" is always there because that is how a second floor gets made.

          Everything below the tabs — the canvas, the selection, the slot grid
          — sees `floorLayout`, one floor's worth of rooms and shelves. That is
          what kept floors cheap: no drawing code learned about them. */}
      <div className="wh-floors" role="tablist" aria-label="Floors">
        {floors.map((f) => (
          <div key={f.id} className={`wh-floor${f.id === activeFloor ? ' is-on' : ''}`}>
            {/* The active tab BECOMES the rename field rather than growing one
                beside its own label — a tab that reads "Ground floor" next to a
                box reading "Ground floor" is the same word twice, and the one
                you can edit is the one that looks like a mistake. */}
            {f.id === activeFloor ? (
              <span className="wh-floor-tab is-editing">
                <Layers size={12} aria-hidden="true" />
                <input
                  className="wh-floor-name"
                  value={f.name}
                  maxLength={24}
                  onChange={(e) => renameFloor(f.id, e.target.value)}
                  aria-label="Floor name"
                />
                <span className="wh-floor-n">
                  {layout.shelves.filter((sh) => (sh.floor_id || floors[0].id) === f.id).length}
                </span>
              </span>
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={false}
                className="wh-floor-tab"
                onClick={() => { setFloorId(f.id); setSelected(null); }}
              >
                <Layers size={12} aria-hidden="true" />
                {f.name}
                <span className="wh-floor-n">
                  {layout.shelves.filter((sh) => (sh.floor_id || floors[0].id) === f.id).length}
                </span>
              </button>
            )}
            {f.id === activeFloor && floors.length > 1 && (
              <button
                type="button"
                className="wh-floor-del"
                onClick={() => removeFloor(f.id)}
                title="Remove this floor — it has to be empty first"
                aria-label={`Remove ${f.name}`}
              >
                <Trash2 size={12} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
        <button type="button" className="wh-floor-add" onClick={addFloor} title="Add a floor">
          <Plus size={13} aria-hidden="true" /> Floor
        </button>
      </div>

      <div className="wh-editor">
        <div className="wh-canvas-wrap glass-card">
          {iso ? (
            <IsoView layout={floorLayout} />
          ) : (
            <svg
              {...mapView.bind}
              className={`wh-canvas is-tool-${tool}${mapView.panning ? ' is-panning' : ''}`}
              viewBox={mapView.viewBox}
              preserveAspectRatio="xMidYMid meet"
              /* Both handlers run: the hook decides whether the gesture is a
                 pan (see `isPanGesture`) and the editor decides whether it is a
                 draw. Exactly one of them claims any given pointer. */
              onPointerDown={(e) => { mapView.bind.onPointerDown(e); startDraw(e); }}
              onPointerMove={(e) => { mapView.bind.onPointerMove(e); onMove(e); }}
              onPointerUp={(e) => { mapView.bind.onPointerUp(e); endDrag(e); }}
              onPointerCancel={mapView.bind.onPointerCancel}
              role="application"
              aria-label="Warehouse floor plan editor"
            >
              <defs>
                <pattern id="wh-grid" width="1" height="1" patternUnits="userSpaceOnUse">
                  <path d="M 1 0 L 0 0 0 1" className="wh-gridline" />
                </pattern>
              </defs>
              <rect x="0" y="0" width={w} height={h} fill="url(#wh-grid)" className="wh-plan-floor" />

              {floorLayout.rooms.map((r) => {
                // Parts fill, the outline strokes. Stroking each part would
                // draw the seam across an L's elbow, and a room with a line
                // through it reads as two rooms — the exact confusion the
                // parts model exists to end.
                const sel = selected?.type === 'room' && selected.id === r.id;
                const anchor = r.parts[0];
                return (
                  <g key={r.id} onPointerDown={(e) => startMove(e, 'room', r)}>
                    {r.parts.map((q, i) => (
                      <rect
                        key={`${r.id}:${i}`}
                        x={q.x} y={q.y} width={q.w} height={q.h}
                        className={`wh-room-part${sel ? ' is-selected' : ''}`}
                      />
                    ))}
                    <path d={outlinePath(r.parts)} className={`wh-room-edge${sel ? ' is-selected' : ''}`} />
                    {r.name && anchor && (
                      <text x={anchor.x + 0.4} y={anchor.y + 1.1} className="wh-room-name">{r.name}</text>
                    )}
                  </g>
                );
              })}

              {floorLayout.shelves.map((s) => (
                <g key={s.id} onPointerDown={(e) => startMove(e, 'shelf', s)}>
                  <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="0.15" className={`wh-shelf${selected?.id === s.id ? ' is-selected' : ''}`} />
                  <text x={s.x + s.w / 2} y={s.y + s.h / 2 + 0.28} textAnchor="middle" className="wh-shelf-name">{s.name}</text>
                  <text x={s.x + s.w / 2} y={s.y + s.h / 2 + 1.0} textAnchor="middle" className="wh-shelf-rank">#{s.walk_rank}</text>
                </g>
              ))}

              {/* A corner handle only means something where one rect defines the
                  shape. A multi-part room is resized by adding and cutting —
                  there is no single corner whose drag has an obvious result. */}
              {handleAt && (
                <rect
                  x={handleAt.x + handleAt.w - 0.45}
                  y={handleAt.y + handleAt.h - 0.45}
                  width="0.9"
                  height="0.9"
                  className="wh-handle"
                  onPointerDown={(e) => startResize(e, selected.type, selectedShape)}
                />
              )}

              {drawPreview && (
                <rect x={drawPreview.x} y={drawPreview.y} width={drawPreview.w} height={drawPreview.h} className="wh-preview" />
              )}
            </svg>
          )}
          {/* Not in 2.5D: that projection is read-only here and has its own
              frame, so a zoom control on it would be a control for a view the
              editor does not let you work in. */}
          {!iso && (
            <MapZoom
              onIn={mapView.zoomIn}
              onOut={mapView.zoomOut}
              onReset={mapView.reset}
              moved={mapView.moved}
              zoom={mapView.zoom}
            />
          )}
        </div>

        <aside className="wh-panel glass-card">
          {!selectedShape && (
            <div className="wh-panel-empty">
              <p>
                {empty
                  ? 'Pick the Room tool and drag out your floor, then place shelves on it. A room need not be a rectangle — select it and use Add part or Cut. The walk rank on each shelf decides the pull list’s route.'
                  : 'Select a room or shelf to edit it. Drag to move; Delete removes. Rooms reshape with Add part and Cut; shelves and one-piece rooms have a corner handle.'}
              </p>
            </div>
          )}

          {selectedShape && selected.type === 'room' && (
            <>
              <h3 className="wh-panel-title">Room</h3>
              <label className="wh-field">
                <span>Name</span>
                <input
                  className="glass-input"
                  value={selectedShape.name}
                  maxLength={24}
                  onChange={(e) => patchSelected({ name: e.target.value })}
                />
              </label>

              <p className="wh-room-stats">
                {partsArea(selectedShape.parts)} squares
                <span aria-hidden="true"> · </span>
                {selectedShape.parts.length} piece{selectedShape.parts.length === 1 ? '' : 's'}
                {selectedShape.parts.length === 1 && <span className="wh-room-stats-note"> — drag the corner to resize</span>}
              </p>

              <div className="wh-field-row">
                <button
                  type="button"
                  className={`glass-btn glass-btn-sm${tool === 'room-add' ? ' glass-btn-primary' : ''}`}
                  onClick={() => setTool(tool === 'room-add' ? 'select' : 'room-add')}
                  aria-pressed={tool === 'room-add'}
                >
                  <PlusSquare size={13} aria-hidden="true" /> Add part
                </button>
                <button
                  type="button"
                  className={`glass-btn glass-btn-sm${tool === 'room-cut' ? ' glass-btn-primary' : ''}`}
                  onClick={() => setTool(tool === 'room-cut' ? 'select' : 'room-cut')}
                  aria-pressed={tool === 'room-cut'}
                >
                  <Scissors size={13} aria-hidden="true" /> Cut
                </button>
              </div>
              <p className="wh-hint">
                {tool === 'room-add' && 'Drag anywhere on the canvas to add that area to this room.'}
                {tool === 'room-cut' && 'Drag over this room to cut that area away.'}
                {!SHAPE_TOOLS.has(tool)
                  && 'One room, any shape: add a wing for an L or a T, cut a notch for a U or a courtyard. Both stay on until you turn them off.'}
              </p>

              <button type="button" className="glass-btn glass-btn-sm glass-btn-danger" onClick={removeSelected}>
                <Trash2 size={13} aria-hidden="true" /> Delete room
              </button>
              <p className="wh-hint">
                Deleting a room only removes it from the picture — its shelves keep their
                names, their bin strings and their place on the walk.
              </p>
            </>
          )}

          {selectedShape && selected.type === 'shelf' && (
            <>
              <h3 className="wh-panel-title">Shelf</h3>
              <label className="wh-field">
                <span>Name (bin prefix)</span>
                <input
                  className="glass-input"
                  value={selectedShape.name}
                  maxLength={24}
                  onChange={(e) => patchSelected({ name: e.target.value.toUpperCase() })}
                />
              </label>
              <label className="wh-field">
                <span>Walk rank</span>
                <input
                  className="glass-input"
                  type="number"
                  min="0"
                  max="100000"
                  value={selectedShape.walk_rank}
                  onChange={(e) => patchSelected({ walk_rank: Math.max(0, parseInt(e.target.value, 10) || 0) })}
                />
              </label>
              <div className="wh-field-row">
                <label className="wh-field">
                  <span>Levels</span>
                  <input
                    className="glass-input" type="number" min="1" max="10"
                    value={selectedShape.levels || ''}
                    placeholder="—"
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      patchSelected({ levels: Number.isInteger(n) && n >= 1 ? Math.min(10, n) : undefined });
                    }}
                  />
                </label>
                <label className="wh-field">
                  <span>Slots / level</span>
                  <input
                    className="glass-input" type="number" min="1" max="50"
                    value={selectedShape.slots_per_level || ''}
                    placeholder="—"
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      patchSelected({ slots_per_level: Number.isInteger(n) && n >= 1 ? Math.min(50, n) : undefined });
                    }}
                  />
                </label>
              </div>
              <label className="wh-field">
                <span>Room</span>
                <select
                  className="glass-input"
                  value={selectedShape.room_id || ''}
                  onChange={(e) => patchSelected({ room_id: e.target.value || null })}
                >
                  <option value="">—</option>
                  {/* Only rooms on this shelf's own floor. A shelf inside a
                      room takes that room's floor (the validator enforces it),
                      so offering a room upstairs would be offering to teleport
                      the shelf. */}
                  {floorLayout.rooms.map((r) => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}
                </select>
              </label>

              {selectedShape.levels && selectedShape.slots_per_level ? (
                <button type="button" className="glass-btn glass-btn-sm glass-btn-primary" onClick={() => setSlotShelf(selectedShape)}>
                  <Box size={13} aria-hidden="true" /> Open slot grid
                </button>
              ) : (
                <p className="wh-hint">Set levels and slots to file variants onto this shelf square by square.</p>
              )}

              <button type="button" className="glass-btn glass-btn-sm glass-btn-danger" onClick={removeSelected}>
                <Trash2 size={13} aria-hidden="true" /> Delete shelf
              </button>
              <p className="wh-hint">
                Deleting a shelf only removes it from the picture — variants keep their bin strings
                and fall back to the alphabetical walk.
              </p>
            </>
          )}
        </aside>
      </div>

      {slotShelf && (
        <SlotGrid
          shelf={slotShelf}
          variants={variants}
          occupantsByBin={stagedOccupants}
          lede="They are staged here and written with the map's Save button."
          onAssign={stageBin}
          onClose={() => setSlotShelf(null)}
        />
      )}
    </div>
  );
}
