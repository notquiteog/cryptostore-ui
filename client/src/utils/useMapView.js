import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Zoom and pan for an SVG floor plan — wheel, pinch, drag, keyboard.
 *
 * ── One implementation, four surfaces ───────────────────────────────────────
 *
 * The map editor, the viewer dialog, the inline map card and the pull list's
 * next-stop card all draw the same plan and all wanted the same gesture. Four
 * copies of anchored zoom is four chances to disagree about which direction
 * the wheel goes and where the cursor ends up pointing, so it is one hook and
 * the host supplies only what differs: whether a given pointer gesture is a
 * pan or something the host wants for itself.
 *
 * ── Why the browser does the coordinate maths ───────────────────────────────
 *
 * `getScreenCTM()` already accounts for `preserveAspectRatio`, which these
 * plans all use — the plan is letterboxed inside its box whenever the two
 * aspect ratios disagree. Deriving client→content by hand from the element's
 * bounding rect ignores that letterbox and puts the anchor point progressively
 * further from the cursor the more the box is out of square. That is the bug
 * that makes a zoom feel like it is fighting you.
 *
 * ── Coexisting with an editor that has its own drags ────────────────────────
 *
 * The editor draws rooms by dragging, moves shelves by dragging and resizes by
 * dragging a corner. So this hook never claims a gesture on its own: it asks
 * `isPanGesture(event)` and takes the pointer only if the host says yes. The
 * one exception is the SECOND finger — a pinch is unambiguous, so when it
 * starts the host is told to abandon whatever it had in flight rather than
 * having a shelf dragged across the map while somebody is trying to zoom.
 */

const MIN_SPAN = 4;     // grid units across; below this a shelf fills the frame
const MAX_SPAN_MULT = 1.6; // how far out you can go past the whole plan
const WHEEL_STEP = 1.0015; // per wheel delta unit — smooth on a trackpad

/**
 * How far a pointer must travel before a press becomes a pan.
 *
 * This is not a nicety. `setPointerCapture` RETARGETS the click that follows
 * to the capturing element, so a map that captures on `pointerdown` swallows
 * every click on everything inside it — which is exactly how pressing a shelf
 * on the Shelves page stopped opening its slot grid. A press that never moves
 * is a click and the map must not touch it.
 *
 * Four pixels is below the tremor of a deliberate click and well under any
 * intentional drag.
 */
const PAN_SLOP = 4;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** Client point → content (viewBox) coordinates, letterboxing included. */
function toContent(svg, clientX, clientY) {
  const ctm = svg?.getScreenCTM?.();
  if (!ctm) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}

/** Content units per screen pixel, for turning a drag into a pan. */
function unitsPerPixel(svg) {
  const ctm = svg?.getScreenCTM?.();
  // `a` is the horizontal scale; these plans are uniformly scaled, so it is
  // also the vertical one. A detached node has no CTM — pan nothing rather
  // than divide by zero.
  return ctm && ctm.a ? 1 / ctm.a : 0;
}

/**
 * @param {object}   opts
 * @param {{x:number,y:number,w:number,h:number}} opts.home  the resting view
 * @param {Function} [opts.isPanGesture]  (event) => boolean
 * @param {Function} [opts.onGestureTakeover]  called when a pinch begins
 * @param {boolean}  [opts.enabled=true]
 */
export default function useMapView({ home, isPanGesture, onGestureTakeover, enabled = true }) {
  const svgRef = useRef(null);
  const [view, setView] = useState(home);
  const [panning, setPanning] = useState(false);

  // The gesture in flight: one pointer panning, or two pinching.
  const gesture = useRef(null);
  const pointers = useRef(new Map());

  // `home` is rebuilt on every render by most callers (it is derived from the
  // layout), so it is compared by value — depending on the object identity
  // would reset the view on every keystroke in the editor's name field.
  const homeKey = `${home.x},${home.y},${home.w},${home.h}`;
  const homeRef = useRef(home);
  homeRef.current = home;

  // Re-home when the plan itself changes shape (a new floor, a resized grid),
  // but never merely because the component re-rendered.
  const settled = useRef(homeKey);
  useEffect(() => {
    if (settled.current !== homeKey) {
      settled.current = homeKey;
      setView(homeRef.current);
    }
  }, [homeKey]);

  const spans = useMemo(() => ({
    min: MIN_SPAN,
    max: Math.max(home.w, home.h) * MAX_SPAN_MULT,
  }), [home.w, home.h]);

  /**
   * Zoom by `k` about a content point, keeping that point under the cursor.
   *
   * Clamped on the SPAN rather than on a zoom factor, so "how far can I go"
   * is expressed in the units the plan is drawn in and cannot drift as the
   * plan is redrawn at a different size.
   */
  const zoomAbout = useCallback((k, anchor) => {
    setView((v) => {
      const wanted = v.w / k;
      const w = clamp(wanted, spans.min, spans.max);
      const scale = w / v.w;               // what actually happened after clamping
      const h = v.h * scale;
      const a = anchor || { x: v.x + v.w / 2, y: v.y + v.h / 2 };
      return {
        x: a.x - (a.x - v.x) * scale,
        y: a.y - (a.y - v.y) * scale,
        w,
        h,
      };
    });
  }, [spans.min, spans.max]);

  const reset = useCallback(() => setView(homeRef.current), []);
  const zoomIn = useCallback(() => zoomAbout(1.35, null), [zoomAbout]);
  const zoomOut = useCallback(() => zoomAbout(1 / 1.35, null), [zoomAbout]);

  /**
   * Wheel to zoom, anchored under the pointer.
   *
   * Bound through `addEventListener` with `passive: false` rather than as a
   * React `onWheel` prop: React attaches wheel listeners passively, and a
   * passive listener cannot `preventDefault`, so the page scrolls away
   * underneath the map while it zooms.
   *
   * `ctrlKey` is how a trackpad pinch arrives, and it deliberately takes the
   * same path — the gesture means the same thing, it just carries a much
   * larger delta, which the exponential below absorbs.
   */
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !enabled) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const anchor = toContent(el, e.clientX, e.clientY);
      zoomAbout(WHEEL_STEP ** -e.deltaY, anchor);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [enabled, zoomAbout]);

  /*
   * `+`, `-` and `0`.
   *
   * The wheel and the pinch are both pointer gestures, and a keyboard user has
   * neither. Guarded against firing while somebody is typing — the editor has
   * a floor-name field and a grid-size input, and "0" is a character you type
   * into one of those far more often than it is a command.
   */
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (document.activeElement?.isContentEditable) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); }
      else if (e.key === '0') { e.preventDefault(); reset(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, zoomIn, zoomOut, reset]);

  const onPointerDown = useCallback((e) => {
    if (!enabled) return;
    const el = svgRef.current;
    if (!el) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Two fingers is a pinch, always — whatever the host thought it was doing
    // with the first one. Told rather than asked: by the time a second finger
    // lands, nobody is still drawing a room.
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = toContent(el, (a.x + b.x) / 2, (a.y + b.y) / 2);
      gesture.current = {
        kind: 'pinch',
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        anchor: mid,
        startView: view,
      };
      setPanning(true);
      onGestureTakeover?.();
      return;
    }

    if (pointers.current.size !== 1) return;
    if (!isPanGesture?.(e)) return;

    // A CANDIDATE, not a pan. Nothing is captured and nothing moves until the
    // pointer has travelled past the slop above — see PAN_SLOP for what
    // capturing too early costs.
    gesture.current = {
      kind: 'maybe-pan',
      pointerId: e.pointerId,
      startClient: { x: e.clientX, y: e.clientY },
      startView: view,
      upp: unitsPerPixel(el),
    };
  }, [enabled, isPanGesture, onGestureTakeover, view]);

  const onPointerMove = useCallback((e) => {
    if (!enabled) return;
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const g = gesture.current;
    if (!g) return;

    if (g.kind === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const k = dist / g.startDist;
      const v = g.startView;
      const w = clamp(v.w / k, spans.min, spans.max);
      const scale = w / v.w;
      const a = g.anchor || { x: v.x + v.w / 2, y: v.y + v.h / 2 };
      setView({
        x: a.x - (a.x - v.x) * scale,
        y: a.y - (a.y - v.y) * scale,
        w,
        h: v.h * scale,
      });
      return;
    }

    if (g.kind === 'maybe-pan') {
      const moved = Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y);
      if (moved < PAN_SLOP) return;
      // Promoted. Capture NOW, which is late enough that the click this
      // gesture will never produce was never at risk, and early enough that
      // the rest of the drag survives leaving the element.
      g.kind = 'pan';
      try { svgRef.current?.setPointerCapture(g.pointerId); } catch { /* gone */ }
      setPanning(true);
    }

    // Pan. The scale is the one captured at gesture start, not the live one:
    // the view is moving as the finger moves, so re-reading the CTM each frame
    // would measure the drag against a frame the drag itself just changed.
    const v = g.startView;
    setView({
      ...v,
      x: v.x - (e.clientX - g.startClient.x) * g.upp,
      y: v.y - (e.clientY - g.startClient.y) * g.upp,
    });
  }, [enabled, spans.min, spans.max]);

  const endPointer = useCallback((e) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2 && gesture.current?.kind === 'pinch') {
      // Lifting one finger of a pinch ends the gesture rather than demoting it
      // to a pan: the remaining finger has not moved deliberately, and turning
      // its position into a pan origin makes the plan jump.
      gesture.current = null;
      setPanning(false);
      return;
    }
    if (pointers.current.size === 0 && gesture.current) {
      gesture.current = null;
      setPanning(false);
    }
  }, []);

  /**
   * Props for the `<svg>`.
   *
   * `touchAction: 'none'` is on the canvas only. The page around it still
   * scrolls normally — it is this element that has to receive the second
   * finger instead of handing it to the browser's own pinch-zoom.
   */
  const bind = {
    ref: svgRef,
    onPointerDown,
    onPointerMove,
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    style: enabled ? { touchAction: 'none' } : undefined,
  };

  const viewBox = `${view.x} ${view.y} ${view.w} ${view.h}`;
  // Anything drawn at a fixed on-screen size — a stroke, a label — has to be
  // divided by this or it grows with the zoom and a plan at 4× is a plan made
  // of fat lines. Relative to `home` so 1 is "as first drawn".
  const zoom = home.w / view.w;

  return {
    svgRef, bind, viewBox, view, zoom, panning,
    zoomIn, zoomOut, reset, zoomAbout, toContent,
    /** True once the view has moved off its resting position. */
    moved: Math.abs(view.x - home.x) > 0.01 || Math.abs(view.w - home.w) > 0.01,
  };
}
