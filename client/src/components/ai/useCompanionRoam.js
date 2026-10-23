import { useCallback, useEffect, useRef, useState } from 'react';
import { motionAllowed } from '../../utils/companion';

/**
 * The companion wanders the navbar, and notices two things while it does.
 *
 * ── Why it is allowed to leave its button ───────────────────────────────────
 *
 * `docs/DESIGN.md` §10 asks for a small number of moments that could only
 * exist in this product, and §10's test is that a flourish must do a job. This
 * one's job is the same as the sprite's: it makes the assistant feel present
 * rather than parked, and it is the only thing on the page that reacts to the
 * person rather than to the data. It also makes the button findable — an
 * animal that walks off and comes back draws the eye to where it came from.
 *
 * What keeps that from being irritating is that it is bounded by rules, and
 * every rule below exists because breaking it would be worse than not having
 * the feature:
 *
 *   · **Never while anything real is happening.** Generating, speaking,
 *     unreachable, or the panel open — the animal goes straight home and stays
 *     there. Its position must never compete with its STATE, because the state
 *     is the AI system's only status light (docs/AI.md §9).
 *   · **Never during checkout.** docs/AI.md §9, rule 1: nothing may compete
 *     with a buyer completing a payment. That includes a cat walking past.
 *   · **Never under `prefers-reduced-motion`.** This is decoration; §2's
 *     exception is for loaders, and a wandering animal is not one.
 *   · **Never off the bar.** It walks inside the navbar and passes BEHIND the
 *     icons, which is a z-index of 0 against `.navbar-inner`'s 1 — the same
 *     layering `HeaderField` already uses.
 *   · **It always comes back.** Every path out has a path home, including the
 *     one where the tab was hidden for an hour.
 *
 * ── The two things it notices ───────────────────────────────────────────────
 *
 * **Somebody typing in the search field.** It walks over and props itself
 * against the field until they stop. That is the whole of its "intelligence"
 * and it is deliberately the whole of it: the companion reacts to what the
 * page is doing, never to what the person is looking for. It reads that
 * somebody is typing from `focus` and `input` events on the field. It never
 * reads the VALUE, and there is nowhere in this file it could send it.
 *
 * **Its own button being hovered.** It teleports back rather than walking,
 * because a hover is a person reaching for the control and a two-second walk
 * back would mean reaching for something that is not there yet. The teleport
 * is a dissolve out, a jump, and a dissolve in — see `dissolve` in sprites.js.
 *
 * ── Why the position is a CSS transition and not a ticker ───────────────────
 *
 * The walk is `transform: translate3d()` with a duration proportional to the
 * distance, so the whole journey is one style write and the compositor does
 * the rest. A `requestAnimationFrame` loop would have re-rendered a React
 * component sixty times a second, forever, on every page of the shop — the
 * same trade the sprite renderer already refused.
 */

/**
 * Pixels per second.
 *
 * The profile gait plants a foot as it sweeps back over six sprite pixels.
 * Keep travel near that stride rate; the old 66px/s pulled the body across
 * the bar much faster than its feet could follow. Species weight scales it.
 */
const SPEED = 32;

/** How long it holds still somewhere before deciding to move again. */
const PAUSE = [4200, 11000];
const HOME_PAUSE = [9000, 22000];

/** Somebody has stopped typing once this long has passed since a keystroke. */
const TYPING_IDLE = 3200;

/**
 * How long the companion stands looking at whatever it escorted somebody to.
 *
 * Long enough to read as "look, this thing" and short enough that it is on its
 * way home before the next click. It is not the `look` animation's own length
 * on purpose: that varies by animal, and a fast animal that left immediately
 * would read as having walked over for no reason.
 */
const LOOK_MS = 1400;

/**
 * How long the dissolve-out lasts, in ms.
 *
 * Passed in rather than a constant, because it is the animal's own `vanish`
 * duration and animals differ: the owl's tempo is nearly twice the dog's, so
 * one fixed number either cut the owl off mid-dissolve or left the dog
 * standing invisible waiting for it. `framesFor` is the only thing that knows,
 * and the caller asks it.
 */
const PORT_FALLBACK = 240;

const rand = ([lo, hi]) => lo + Math.random() * (hi - lo);

/**
 * Only one companion may roam, ever.
 *
 * The navbar renders Buddy three times — desktop-signed-in, desktop-signed-out
 * and the mobile icon row — and shows one. Usually the other two have
 * zero-width buttons and measure to nothing, but "usually" produced the bug
 * this exists to stop: on a width where two of them are laid out, both
 * portalled a roaming layer into the same `<nav>`, both heard the same focus
 * event on the same search field, and the shop grew a second animal that
 * walked to the search bar and stayed there.
 *
 * So the first instance that can actually measure its own button claims the
 * roam and the rest render nothing. Module scope rather than context because
 * there is exactly one navbar and this is a fact about the DOM, not about the
 * React tree.
 */
let ROAMER = null;
let NEXT_ID = 0;
const CLAIM_LISTENERS = new Set();
const releaseClaim = (id) => {
  if (ROAMER !== id) return;
  ROAMER = null;
  // The desktop owner can become hidden without unmounting. Tell the mobile
  // instance now, rather than waiting for an unrelated resize to wake it.
  CLAIM_LISTENERS.forEach(sync => queueMicrotask(sync));
};

export default function useCompanionRoam({
  boundsEl, homeRef, searchSelector = '.navbar-search input', enabled, paused,
  vanishMs = PORT_FALLBACK,
  speed = SPEED,
}) {
  // `home` is where the button is; `x` is where the animal is walking to or
  // standing, and stays null until it first leaves. Rendering falls back to
  // `home` while parked, so the two never have to be kept in step — the first
  // version did keep them in step, by calling `setX` inside `setHome`'s
  // updater, and React calls updaters twice in development precisely to catch
  // that. The symptom was a companion that never measured its own button and
  // sat invisible at the left edge of the bar.
  const [home, setHome] = useState(null);
  const [x, setX] = useState(null);
  const [act, setAct] = useState('home');
  const [facing, setFacing] = useState(1);
  const [dur, setDur] = useState(0);
  // Where it is RIGHT NOW, for working out the next journey's length. A ref
  // rather than the state, because `walkTo` needs it during the same tick it
  // is being set in.
  const posRef = useRef(null);
  const journey = useRef(null);
  const homeRef2 = useRef(null);
  const idRef = useRef(null);
  if (idRef.current === null) { NEXT_ID += 1; idRef.current = NEXT_ID; }
  const [owns, setOwns] = useState(false);
  const timers = useRef([]);
  // The wander loop's own timer, deliberately NOT in the shared pool. It used
  // to be, and the effect that owns it re-runs on every activity change — so
  // its cleanup cleared the whole pool, including the arrival timer `walkTo`
  // had just scheduled. The animal walked to the search field and then stayed
  // in the walking state forever, marching on the spot, because nothing was
  // left to tell it that it had got there.
  const wanderTimer = useRef(null);
  // When the last keystroke stops counting as "still typing". A deadline
  // rather than a timer, because the timer version was armed the moment
  // somebody started typing and expired while the animal was still walking
  // over — so it arrived, leaned, and stayed leaning after they had finished.
  const typingUntil = useRef(0);

  const clearTimers = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }, []);

  const later = useCallback((fn, ms) => {
    const id = setTimeout(() => {
      timers.current = timers.current.filter(t => t !== id);
      fn();
    }, ms);
    timers.current.push(id);
  }, []);

  /*
   * Where the button is, in bar coordinates. Re-measured, never cached.
   *
   * Measured against the NAVBAR, not against the roaming layer. The layer
   * shares its horizontal bounds but is only as tall as the top navigation
   * row. It only exists after this instance claims the roam, so measuring
   * the layer itself would deadlock before the companion could appear.
   */
  const measure = useCallback(() => {
    const btn = homeRef.current;
    if (!boundsEl || !btn) return null;
    const l = boundsEl.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    // A button with no width is one of the hidden Buddy instances — the navbar
    // renders three and shows one. Roaming from a hidden one would put a
    // second animal on the bar walking a different route.
    if (!b.width || !l.width) return null;
    return { home: Math.round(b.left - l.left), width: Math.round(l.width) };
  }, [boundsEl, homeRef]);

  useEffect(() => {
    let frame = 0;
    let tries = 0;
    let active = true;
    const sync = () => {
      if (!active) return;
      cancelAnimationFrame(frame);
      const m = measure();
      if (!m) {
        releaseClaim(idRef.current);
        setOwns(false);
        /*
         * Nothing to measure YET.
         *
         * The layer is portalled into `.navbar`, and the navbar element is
         * only found by the button's own ref callback — so on the render this
         * effect first runs, the layer does not exist. Depending on `enabled`
         * below re-runs it once it does, and this retry covers the rest: a
         * button inside a popover that has not opened, a font still loading,
         * a navbar mid-reflow.
         *
         * Bounded, because a Buddy rendered somewhere with no navbar at all
         * must not spin a rAF loop for the life of the page — it simply never
         * roams, which is the correct outcome.
         */
        if (tries < 40) { tries += 1; frame = requestAnimationFrame(sync); }
        return;
      }
      tries = 0;
      if (homeRef2.current !== null && homeRef2.current !== m.home) {
        clearTimers();
        cancelAnimationFrame(frameRef.current);
        journey.current = null; posRef.current = null;
        setX(null); setDur(0); setAct('home');
      }
      setHome(m.home);
      homeRef2.current = m.home;
      // Claim the roam, or stand down for whoever already has it.
      if (ROAMER === null || ROAMER === idRef.current) {
        ROAMER = idRef.current;
        setOwns(true);
      }
    };
    CLAIM_LISTENERS.add(sync);
    sync();
    // The bar changes shape on resize, on sign-in, and when a popover opens.
    // Re-measuring is cheap; assuming is how the animal ends up standing in
    // the wishlist icon.
    const ro = new ResizeObserver(sync);
    if (boundsEl) ro.observe(boundsEl);
    window.addEventListener('resize', sync);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      ro.disconnect();
      CLAIM_LISTENERS.delete(sync);
      window.removeEventListener('resize', sync);
    };
  }, [measure, boundsEl, enabled, clearTimers]);

  // Hand the claim back when this instance goes away, so the next navbar (or
  // the mobile one after a resize) can take it.
  useEffect(() => () => {
    releaseClaim(idRef.current);
  }, []);

  /*
   * Move, in two frames, and always in this order.
   *
   * A CSS transition only runs if the duration was ALREADY in effect when the
   * position changed. Setting both in one commit means the browser compares a
   * before-style whose `transition-duration` is still the old value — and the
   * old value, on the very first journey out of a parked state, is zero. The
   * animal teleported to the search bar instead of walking to it, every time,
   * and only on the first move, which is what made it look like a deliberate
   * feature rather than a bug.
   *
   * So: duration this frame, position the next. `frameRef` holds the pending
   * one so a second move cancels the first rather than racing it.
   */
  const frameRef = useRef(0);
  const currentPosition = useCallback(() => {
    const j = journey.current;
    if (!j) return posRef.current ?? homeRef2.current;
    const progress = j.ms ? Math.min(1, Math.max(0, (performance.now() - j.start) / j.ms)) : 1;
    return j.from + (j.to - j.from) * progress;
  }, []);
  const move = useCallback((to, ms) => {
    cancelAnimationFrame(frameRef.current);
    setDur(ms);
    frameRef.current = requestAnimationFrame(() => {
      journey.current = { from: currentPosition() ?? to, to, ms, start: performance.now() };
      posRef.current = to;
      setX(to);
    });
  }, [currentPosition]);

  /**
   * Walk to a place on the bar. Duration follows distance, so speed is real.
   *
   * Returns how long the journey will take, because `escortTo` has to know
   * when the animal has arrived in order to schedule the walk home. Reading
   * that back off the state was the alternative, and it cannot be done: the
   * arrival is a `setAct` inside a timer, so a caller watching `act` sees the
   * arrival one render after it happened and only if nothing else moved first.
   */
  const walkTo = useCallback((to, next = 'away') => {
    const m = measure();
    const target = Math.max(4, Math.min(to, (m?.width || 40) - 36));
    const from = currentPosition() ?? target;
    const ms = Math.round((Math.abs(target - from) / speed) * 1000);
    setFacing(target >= from ? 1 : -1);
    setAct(ms > 60 ? 'walk' : next);
    move(target, ms);
    later(() => setAct(next), ms + 80);
    return ms;
  }, [later, move, measure, currentPosition, speed]);

  /**
   * Walk over to something else on the bar, look at it, and come back.
   *
   * The one piece of MEANING the companion's position is allowed to carry, and
   * it is the same idea as leaning on the search field: the animal reacts to
   * what the page just did. Something landed in the cart, so it goes and looks
   * at the cart — which is also `docs/DESIGN.md`'s rule that a page should
   * point at wherever the person goes next, said by an animal instead of by a
   * banner over the content.
   *
   * Three things keep it from becoming a nuisance, and each is load-bearing:
   *
   *   · It is only ever called when roaming is allowed AND nothing real is
   *     happening — the caller checks, exactly as the wander loop does. Its
   *     position must never compete with its state.
   *   · It always comes home, on a timer set at departure. An escort that
   *     ended by leaving the animal standing next to the cart would have moved
   *     the companion's button as far as anybody looking for it is concerned.
   *   · It refuses to escort to something it cannot measure. A hidden icon (a
   *     phone, a signed-out visitor) yields a zero-width box, and walking to a
   *     zero-width box means walking to the left edge of the bar.
   */
  const escortTo = useCallback((selector) => {
    if (!enabled || !owns || paused || !boundsEl || home === null) return;
    const el = document.querySelector(selector);
    if (!el) return;
    const l = boundsEl.getBoundingClientRect();
    const t = el.getBoundingClientRect();
    if (!t.width || !l.width) return;
    // Beside it rather than under it: the animal stands where it can be seen
    // against the bar, not on top of the icon it is pointing at.
    const to = Math.round(Math.max(4, Math.min(t.left - l.left - 34, l.width - 40)));
    clearTimers();
    const out = walkTo(to, 'look');
    later(() => { walkTo(homeRef2.current, 'home'); }, out + LOOK_MS);
  }, [enabled, owns, paused, boundsEl, home, clearTimers, walkTo, later]);

  /** Home in one jump, with a dissolve at each end. For a hover. */
  const teleportHome = useCallback(() => {
    clearTimers();
    setAct('vanish');
    later(() => {
      setFacing(1);
      setAct('arrive');
      // Zero duration through the same two-frame path, so the jump is a jump
      // and not a very fast walk.
      move(homeRef2.current, 0);
      later(() => setAct('home'), 400);
    }, vanishMs);
  }, [clearTimers, later, move, vanishMs]);

  // ── The wander loop ───────────────────────────────────────────────────────
  //
  // One timer at a time, re-armed on arrival. Not an interval: an interval
  // keeps firing while the tab is hidden and the companion arrives having
  // "walked" a hundred journeys nobody saw.
  useEffect(() => {
    // `paused` is the pointer resting on the button. Without it the two halves
    // of this feature fight each other: the wander sends the animal off, the
    // hover-teleport yanks it straight back, and it flickers between the two
    // for as long as somebody leaves their mouse there.
    if (!enabled || !owns || paused || home === null) return undefined;
    if (act !== 'home' && act !== 'away') return undefined;
    const arm = (ms) => { wanderTimer.current = setTimeout(wander, ms); };
    function wander() {
      if (document.hidden) { arm(4000); return; }
      const m = measure();
      if (!m) return;
      // Home a third of the time, so it is usually where its button is.
      const goHome = act === 'away' && Math.random() < 0.34;
      const to = goHome
        ? m.home
        : Math.round(Math.max(24, Math.min(m.width - 56, (currentPosition() ?? m.home) + (Math.random() - 0.5) * 280)));
      walkTo(to, goHome ? 'home' : 'away');
    }
    arm(rand(act === 'home' ? HOME_PAUSE : PAUSE));
    return () => clearTimeout(wanderTimer.current);
  }, [enabled, owns, paused, home, act, measure, walkTo, currentPosition]);

  // ── Somebody is typing ────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !owns) return undefined;
    const field = document.querySelector(searchSelector);
    if (!field || !boundsEl) return undefined;

    const goLean = () => {
      const l = boundsEl.getBoundingClientRect();
      const f = field.getBoundingClientRect();
      if (!f.width || !l.width) return;
      // Propped against the right-hand end of the field.
      const to = Math.round(Math.max(4, Math.min(f.right - l.left - 34, l.width - 40)));
      typingUntil.current = Date.now() + TYPING_IDLE;
      /*
       * Already there, or already on the way: refresh the deadline and stop.
       *
       * The guard is on the DESTINATION, not on the activity. `focus` and
       * `input` both fire for the first keystroke, in the same tick, and the
       * first version checked a stale `act` from the effect's closure — so the
       * second call re-issued the walk with `from` already set to `to`, got a
       * zero-length journey, and the animal blinked across the navbar instead
       * of walking. Every keystroke after that would have done it again.
       */
      if (posRef.current === to) {
        setAct((a) => (a === 'away' || a === 'home' ? 'lean' : a));
        return;
      }
      clearTimers();
      walkTo(to, 'lean');
    };

    field.addEventListener('focus', goLean);
    field.addEventListener('input', goLean);
    return () => {
      field.removeEventListener('focus', goLean);
      field.removeEventListener('input', goLean);
    };
  }, [enabled, owns, searchSelector, boundsEl, clearTimers, walkTo]);

  // It stops leaning when the typing actually stops, which is checked from the
  // deadline rather than from a timer set when the typing STARTED — see
  // `typingUntil`. Polling once a second while leaning is cheaper than
  // re-arming a timeout on every keystroke, and it is the only poll here.
  useEffect(() => {
    if (act !== 'lean') return undefined;
    const id = setInterval(() => {
      if (Date.now() >= typingUntil.current) setAct('away');
    }, 900);
    return () => clearInterval(id);
  }, [act]);

  // Everything stops and goes home the moment roaming is switched off — a
  // status change, the panel opening, checkout, or the preference changing
  // under it. Snapping rather than walking, because whatever switched it off
  // is more important than the journey.
  useEffect(() => {
    if (enabled && owns) return;
    clearTimers();
    clearTimeout(wanderTimer.current);
    cancelAnimationFrame(frameRef.current);
    typingUntil.current = 0;
    posRef.current = null;
    journey.current = null;
    setDur(0);
    setAct('home');
    setX(null);
    setFacing(1);
  }, [enabled, owns, clearTimers]);

  useEffect(() => () => {
    clearTimers();
    clearTimeout(wanderTimer.current);
    cancelAnimationFrame(frameRef.current);
  }, [clearTimers]);

  const parked = act === 'home';
  const pos = parked && x === null ? home : (x ?? home);

  return {
    // Null until this instance owns the roam AND has measured its button —
    // the caller renders no layer at all until then, so a hidden Buddy never
    // puts a second animal on the bar.
    x: owns ? pos : null,
    owns,
    home,
    facing,
    dur,
    // `null` means "parked, and the caller decides the state" — everything
    // else is a state name the sprite understands directly.
    roamState: parked || act === 'away' ? null : act,
    away: !parked && pos !== null && home !== null && Math.abs(pos - home) > 2,
    teleportHome,
    escortTo,
    canRoam: motionAllowed(),
  };
}

export { SPEED, PORT_FALLBACK, TYPING_IDLE, LOOK_MS };
