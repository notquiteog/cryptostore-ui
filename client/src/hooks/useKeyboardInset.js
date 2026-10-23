import { useEffect, useState } from 'react';

/**
 * How much of the bottom of the layout viewport something is covering, and how
 * tall the part a person can actually see is. In practice: the on-screen
 * keyboard.
 *
 * ── Why a hook and not a media query ────────────────────────────────────────
 *
 * There is no CSS for "the keyboard is up". A panel docked to the bottom edge
 * with `position: fixed` is positioned against the LAYOUT viewport, and on iOS
 * the keyboard does not change the layout viewport at all — it slides over the
 * visual one. So a sheet at `bottom: 0` is behind the keyboard the moment
 * somebody taps the field inside it, and because Safari then scrolls the visual
 * viewport around to reveal the focused input, the sheet also drifts: the panel
 * appears to slide off the screen while the person is typing into it.
 *
 * Android is the other model — `interactive-widget` defaults to resizing the
 * visual viewport too, but a page that opted into `resizes-content`, or an
 * older Chrome, shrinks the layout viewport instead and needs no correction.
 * The subtraction below is zero in that case on its own, so one formula covers
 * both rather than a browser test choosing between two.
 *
 *   inset  = layout height − (visible height + how far the visible box has
 *            been scrolled down inside it)
 *          = the strip along the bottom of the layout viewport that the person
 *            cannot see, which is exactly how far a docked sheet has to lift.
 *
 *   height = the visible height, so a sheet can cap itself to the room that is
 *            left rather than to `70vh` of a viewport that is mostly keyboard.
 *
 * ── Two things that are not a keyboard ──────────────────────────────────────
 *
 * A pinch-zoom shrinks the visual viewport as surely as a keyboard does, and
 * lifting the sheet by the difference would fling it into the middle of a
 * zoomed page. `scale` rules that out.
 *
 * The other is browser chrome settling. Collapsing a URL bar changes both
 * heights, but not in the same frame, so the subtraction passes through a few
 * tens of pixels of nonsense on the way. `FLOOR` is above anything a toolbar
 * transition produces and far below any soft keyboard, so the sheet does not
 * hop while the page is being scrolled.
 *
 * Subscribed only while the caller says it needs it (`enabled`). The navbar
 * mounts its assistant TWICE — the desktop row and the phone row are both in
 * the document, hidden from each other by a media query — so a hook that
 * listened unconditionally would listen twice on every page of the shop, for a
 * panel that is shut.
 */

/* Below this, it is a toolbar animation rather than a keyboard. */
const FLOOR = 80;

export default function useKeyboardInset(enabled) {
  const [geometry, setGeometry] = useState({ inset: 0, height: 0 });

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      // Reset rather than leave the last reading behind: the sheet is shut, and
      // reopening it with a stale lift would put it in mid-air for a frame.
      setGeometry({ inset: 0, height: 0 });
      return undefined;
    }
    const vv = window.visualViewport;
    // No API, no correction. The CSS fallbacks are the pre-existing behaviour,
    // so an engine without this is exactly as it was rather than broken.
    if (!vv) return undefined;

    let frame = 0;
    const read = () => {
      frame = 0;
      const layout = document.documentElement.clientHeight;
      const covered = layout - (vv.height + vv.offsetTop);
      setGeometry({
        inset: vv.scale > 1.01 || covered < FLOOR ? 0 : Math.round(covered),
        height: Math.round(vv.height),
      });
    };
    // Coalesced to a frame. Android fires `resize` continuously for the whole
    // length of the keyboard's slide-in animation, and a `setState` per event
    // re-renders the panel thirty times for one gesture.
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read); };

    read();
    vv.addEventListener('resize', schedule);
    // `scroll` as well as `resize`, because on iOS the keyboard's arrival is
    // followed by the browser scrolling the visual viewport down to reveal the
    // focused field — the height stops changing but `offsetTop` does not.
    vv.addEventListener('scroll', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
    };
  }, [enabled]);

  return geometry;
}

export { useKeyboardInset };
