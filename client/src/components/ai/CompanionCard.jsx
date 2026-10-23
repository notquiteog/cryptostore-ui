import { useCallback, useEffect, useRef, useState } from 'react';
import BuddySprite from './BuddySprite';
import { animalFor, framesFor, NAMES } from './sprites';
import { motionAllowed } from '../../utils/companion';
import useCompanionAttention, { useCompanionMotion } from './useCompanionAttention';

/**
 * The companion, life size, with every status it can show.
 *
 * ── Why a preview card and not just a dropdown ──────────────────────────────
 *
 * `docs/DESIGN.md` §10: a flourish must do a job. The companion's job is that
 * it is the AI system's only visible status light — asleep means the model is
 * unreachable, thinking means it is generating, awake means ready. That is
 * only true if the person looking at it can TELL those apart, and a settings
 * page that offers "cat / dog / frog" in a `<select>` never once shows an
 * operator what "asleep" is going to look like on their own palette.
 *
 * So the card is a rehearsal. The chips along the bottom are the legend and
 * the control at the same time: click "asleep" and the animal dozes off in the
 * store's real colours, on the store's real background, at the size it will
 * actually be. An operator who cannot read the difference between two of them
 * has learned something worth knowing before a buyer does.
 *
 * The same card serves the admin panel and the account page, on purpose. The
 * operator choosing for the shop and the person choosing for themselves are
 * answering the same question and deserve the same answer.
 *
 * ── The interactions are the point, not decoration ──────────────────────────
 *
 * Hovering perks it up, clicking it makes it bounce. Both are one-shot or
 * hover-scoped states that hand control straight back, and both are declined
 * outright under `prefers-reduced-motion` rather than started and paused —
 * a companion frozen mid-bounce because the animation was paused is worse than
 * one that simply never bounced.
 */

/**
 * The statuses, in the order they matter, with what each one is bound to.
 *
 * The `means` line is the honest half: every one of these is read from
 * something real in `Buddy.jsx`, so the card can promise what it promises.
 */
const STATUSES = [
  { id: 'idle', label: 'Ready', means: 'The model answered its health check.' },
  { id: 'think', label: 'Thinking', means: 'A question is being generated right now.' },
  { id: 'talk', label: 'Speaking', means: 'An answer is being read aloud.' },
  { id: 'sleep', label: 'Asleep', means: 'The model cannot be reached.' },
];

/**
 * The audition: what this animal is like to have around, in twelve seconds.
 *
 * The statuses above answer "can I tell these apart". This answers the other
 * question somebody is actually asking, which the card could not previously
 * show at all: what does it DO. The note under each animal's name promises a
 * behaviour — "sits very still, then hops", "the brush never quite settles" —
 * and a still frame cannot keep that promise, so people were choosing an
 * animal by its silhouette and meeting its temperament afterwards.
 *
 * The script is the companion's own day, in order: a look about, a potter to
 * one side, a walk, propped against the search field while somebody types,
 * and back to resting. Every step is a state the animal really enters on a
 * store with the dial turned up, which is what keeps this a rehearsal rather
 * than a showreel.
 *
 * A one-shot holds for exactly as long as it lasts — `framesFor` knows, and
 * an animal's tempo makes that differ by nearly a factor of two — so a slow
 * animal is not cut off mid-stretch and a fast one does not stand still
 * waiting for its slot to end.
 */
const DAY = [
  { state: 'idle', hold: 1500 },
  { state: 'sniff' },
  { state: 'potter' },
  { state: 'walk', hold: 2200 },
  { state: 'lean', hold: 2600 },
  { state: 'stretch' },
  { state: 'idle', hold: 1200 },
];

export default function CompanionCard({
  animal,
  name,
  size = 128,
  note,
  children,
}) {
  // What the chips have pinned. Separate from the one-shots below so that a
  // greeting played while "asleep" is pinned returns to asleep, not to ready.
  const [pinned, setPinned] = useState('idle');
  const [burst, setBurst] = useState(null);
  const [hovered, setHovered] = useState(false);
  // A pet while it is already bouncing has to restart the animation, and the
  // state name alone does not change — so the sprite is remounted by key.
  const [nonce, setNonce] = useState(0);
  const { attention, follow, resetAttention } = useCompanionAttention();
  const motion = useCompanionMotion();

  const settle = useCallback(() => setBurst(null), []);

  // The audition's timer, and whether it is running. One timer at a time,
  // re-armed per step: an interval would keep firing while the tab is hidden
  // and the animal would arrive at the end of its day having done none of it.
  const [day, setDay] = useState(false);
  const dayTimer = useRef(null);

  const stopDay = useCallback((reset = true) => {
    clearTimeout(dayTimer.current);
    dayTimer.current = null;
    setDay(false);
    if (reset) setPinned('idle');
  }, []);

  // Unmount stops it. Without this the card can be swapped for another
  // animal's — the picker does exactly that — and the old script keeps
  // driving state into a component nobody is looking at.
  useEffect(() => () => clearTimeout(dayTimer.current), []);

  // The picker reuses this card. Cancel the old animal's audition before its
  // next timer can give the newly selected companion the wrong behaviour.
  useEffect(() => {
    stopDay(); setBurst(null); setHovered(false);
  }, [animal, stopDay]);

  useEffect(() => {
    if (motion) return;
    stopDay(false); setBurst(null);
    setPinned(current => STATUSES.some(status => status.id === current) ? current : 'idle');
  }, [motion, stopDay]);

  useEffect(() => {
    const hide = () => { if (document.hidden) { stopDay(); setBurst(null); } };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [stopDay]);

  const playDay = useCallback(() => {
    if (!motionAllowed()) return;
    clearTimeout(dayTimer.current);
    let i = 0;
    setDay(true);
    const step = () => {
      if (i >= DAY.length) { stopDay(); setPinned('idle'); return; }
      const { state: planned, hold } = DAY[i];
      const next = planned === 'walk' && animalFor(animal).airborne ? 'fly' : planned;
      i += 1;
      setBurst(null);
      setPinned(next);
      setNonce((n) => n + 1);
      // A one-shot lasts as long as its own frames say; a loop is held.
      const ms = hold ?? Math.round(framesFor(animal, next).duration * 1000) + 120;
      dayTimer.current = setTimeout(step, ms);
    };
    step();
  }, [animal, stopDay]);

  const play = useCallback((state) => {
    if (!motionAllowed()) return;
    stopDay(day);
    setBurst(state);
    setNonce((n) => n + 1);
  }, [stopDay, day]);

  if (!animal || !NAMES.includes(animal)) {
    return (
      <div className="cmp-card cmp-card-none">
        <div className="cmp-stage cmp-stage-none">
          <span className="cmp-plain">Ask</span>
        </div>
        <div className="cmp-body">
          <h4 className="cmp-name">{name || 'The assistant'}</h4>
          <p className="cmp-species">No companion</p>
          <p className="cmp-note">
            A plain button opens the assistant. Nothing animates, and the panel
            behaves exactly the same.
          </p>
          {children}
        </div>
      </div>
    );
  }

  const character = animalFor(animal);
  const state = !motion && pinned === 'idle' ? 'still'
    : burst || (hovered && pinned === 'idle' ? 'perk' : pinned);

  return (
    <div className="cmp-card">
      {/*
        The stage is a button because everything on it is reachable from the
        keyboard: focus perks it up the same way hover does, and Enter pets it.
        A companion you can only interact with using a mouse is a companion
        half the people looking at this page cannot interact with.
      */}
      <button
        type="button"
        className="cmp-stage"
        onPointerEnter={() => setHovered(true)}
        onPointerMove={follow}
        onPointerLeave={() => { setHovered(false); resetAttention(); }}
        onFocus={() => setHovered(true)}
        onBlur={() => { setHovered(false); resetAttention(); }}
        onClick={() => play('happy')}
        aria-label={`Pet ${name || character.label}`}
        title="Pet your companion"
      >
        <BuddySprite
          key={`${animal}-${state}-${nonce}`}
          animal={animal}
          state={state}
          size={size}
          onDone={settle}
          attention={motion && !day && pinned === 'idle' && !burst ? attention : 0}
        />
        {/* A contact shadow, so the animal sits on something rather than
            floating. It is an ellipse of the page's own scrim, not a colour,
            and it survives an opaque preset because it is only an alpha. */}
        <span className="cmp-ground" aria-hidden="true" />
      </button>

      <div className="cmp-body">
        <h4 className="cmp-name">{name || character.label}</h4>
        <p className="cmp-species">
          {name ? character.label : 'Companion'}
        </p>
        <p className="cmp-note">{note || character.note}</p>

        <div className="cmp-states" role="group" aria-label="Preview each status">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`cmp-chip${pinned === s.id ? ' is-on' : ''}`}
              aria-pressed={pinned === s.id}
              onClick={() => { stopDay(); setBurst(null); setPinned(s.id); }}
              title={s.means}
            >
              {s.label}
            </button>
          ))}
          {!character.airborne && <button type="button" className={`cmp-chip${pinned === 'walk' ? ' is-on' : ''}`}
            disabled={!motion} aria-pressed={pinned === 'walk'}
            onClick={() => { stopDay(); setBurst(null); setPinned('walk'); }}>
            {animal === 'slime' ? 'Rolling' : 'Walking'}
          </button>}
          {character.airborne && <button type="button" className={`cmp-chip${pinned === 'fly' ? ' is-on' : ''}`}
            disabled={!motion} aria-pressed={pinned === 'fly'}
            onClick={() => { stopDay(); setBurst(null); setPinned('fly'); }}>
            Flying
          </button>}
          <button
            type="button"
            className="cmp-chip cmp-chip-do"
            disabled={!motion}
            onClick={() => play('greet')}
            title="Play its greeting — the one-shot it does when the panel opens"
          >
            Say hello
          </button>
          {/* The whole temperament, in twelve seconds. See DAY above. */}
          <button
            type="button"
            className={`cmp-chip cmp-chip-do${day ? ' is-on' : ''}`}
            disabled={!motion}
            aria-pressed={day}
            onClick={() => (day ? stopDay() : playDay())}
            title="Watch what it does on a bar it is allowed to wander"
          >
            {day ? 'Stop' : 'A day of it'}
          </button>
        </div>
        <p className="cmp-interaction">{motion ? 'Move your pointer to catch its eye. Tap or press Enter to pet it.' : 'Reduced motion is on. You can still preview the assistant’s statuses.'}</p>

        {/* The legend, spelled out rather than left in a tooltip: the whole
            argument for the companion is that its state means something, and a
            meaning only a mouse can reach is not much of one. */}
        <p className="cmp-legend">
          {day
            ? 'A day of it: everything this one does on a store with the dial turned up.'
            : STATUSES.find((s) => s.id === pinned)?.means
              || (['walk', 'fly'].includes(pinned) ? 'Just exploring — a preview of how this companion travels.' : '')}
        </p>

        {children}
      </div>
    </div>
  );
}

export { STATUSES };
