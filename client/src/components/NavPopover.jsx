import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * The navbar's one popover engine: cart, orders, support, membership and the
 * mode menu all ride it. Five hand-rolled hover panels is the navbar version
 * of the web/bot split this repo already fights — the first timing tweak
 * would land on one panel and quietly miss the rest.
 *
 * `openOn`:
 *  - 'hover' — fine pointers get hover-intent (80ms open so a pointer flying
 *    across the bar doesn't strobe panels; 300ms close so the diagonal from
 *    trigger to panel, which briefly leaves both, doesn't slam it shut) plus
 *    focus-within for keyboards. Coarse pointers get the BARE trigger: a
 *    hover panel latched open behind a tap shadows the page the tap asked
 *    for.
 *  - 'auto' — hover on fine pointers, press-to-toggle on coarse. For
 *    triggers that are buttons rather than links (the mode menu), where a tap
 *    opening the panel IS the intended behaviour.
 *
 * The panel stays mounted while closed (`inert` keeps its controls out of the
 * tab order), so children that fetch lazily can key off the `open` flag they
 * receive: `children({ open, close })`.
 */
export default function NavPopover({
  trigger, children, ariaLabel, panelClassName = '', wrapClassName = '', openOn = 'hover',
}) {
  const [open, setOpen] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const timers = useRef({ open: null, close: null });
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setCanHover(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  const clearTimers = () => {
    clearTimeout(timers.current.open);
    clearTimeout(timers.current.close);
  };
  useEffect(() => clearTimers, []);

  const scheduleOpen = () => {
    clearTimers();
    timers.current.open = setTimeout(() => setOpen(true), 80);
  };
  const scheduleClose = () => {
    clearTimers();
    timers.current.close = setTimeout(() => setOpen(false), 300);
  };
  const close = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, []);

  const pressMode = openOn === 'auto' && !canHover;

  // Press mode has no "leave" event; the document is the outside.
  useEffect(() => {
    if (!pressMode || !open) return undefined;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [pressMode, open]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      close();
      wrapRef.current?.querySelector('a, button')?.focus();
    }
  }, [close]);

  // Hover-only popovers on a touch device are just their trigger.
  if (openOn === 'hover' && !canHover) return trigger;

  const hoverHandlers = pressMode ? {} : {
    onMouseEnter: scheduleOpen,
    onMouseLeave: scheduleClose,
    onFocus: scheduleOpen,
    onBlur: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) scheduleClose(); },
  };

  return (
    <div
      ref={wrapRef}
      className={`nav-pop-wrap ${wrapClassName}`.trim()}
      {...hoverHandlers}
      onKeyDown={onKeyDown}
    >
      <span
        className="nav-pop-trigger"
        // Press mode: the tap toggles. Hover mode: a click on a link trigger
        // navigates — close so the panel doesn't linger over the new page.
        onClick={pressMode ? () => setOpen((v) => !v) : close}
      >
        {trigger}
      </span>
      <div
        className={`nav-pop ${panelClassName}${open ? ' nav-pop-open' : ''}`.trim()}
        role="region"
        aria-label={ariaLabel}
        aria-hidden={!open}
        inert={!open}
      >
        {typeof children === 'function' ? children({ open, close }) : children}
      </div>
    </div>
  );
}
