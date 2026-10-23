import { Minus, Plus, Maximize2 } from 'lucide-react';

/**
 * The zoom cluster that sits on a floor plan.
 *
 * Every gesture this offers is available another way — wheel, pinch, and the
 * `+ - 0` keys all do the same three things. It exists because none of those
 * are discoverable and two of them are unavailable: a keyboard user has no
 * wheel, and a touch user has no way to learn that pinch works except by
 * trying it. DESIGN §4's rule about hover-revealed controls applies to
 * gestures too — a capability with no visible affordance is a capability most
 * people never find.
 *
 * "Fit" only appears once the view has actually moved. A reset button on a
 * plan that is already at rest is a button that does nothing, and a control
 * that does nothing is one more thing to read before finding the one that
 * does something.
 */
export default function MapZoom({ onIn, onOut, onReset, moved, zoom }) {
  return (
    <div className="mapzoom" role="group" aria-label="Zoom">
      <button type="button" className="mapzoom-btn" onClick={onOut} aria-label="Zoom out" title="Zoom out (−)">
        <Minus size={13} aria-hidden="true" />
      </button>
      {/* Not a control — the readout is how you tell 2× from 4× when the plan
          is a repeating grid of shelves and every zoom level looks plausible. */}
      <span className="mapzoom-level" aria-hidden="true">{Math.round(zoom * 100)}%</span>
      <button type="button" className="mapzoom-btn" onClick={onIn} aria-label="Zoom in" title="Zoom in (+)">
        <Plus size={13} aria-hidden="true" />
      </button>
      {moved && (
        <button type="button" className="mapzoom-btn is-fit" onClick={onReset} aria-label="Fit the whole plan" title="Fit (0)">
          <Maximize2 size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
