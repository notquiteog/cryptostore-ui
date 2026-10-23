import { useState } from 'react';
import BuddySprite from './BuddySprite';
import { ANIMALS, NAMES } from './sprites';
import { NONE } from '../../utils/companion';
import { useCompanionMotion } from './useCompanionAttention';

/**
 * The roster, as a grid of live sprites.
 *
 * ── Still until you look at it ──────────────────────────────────────────────
 *
 * Every tile draws one frame and nothing else; only the hovered, focused or
 * selected one animates. Two reasons, and both matter:
 *
 *   Twelve animals looping at once is not a choice, it is a wall of motion —
 *   `docs/DESIGN.md` §4 asks hover to REVEAL something, and what it reveals
 *   here is exactly the thing being chosen, which is the behaviour.
 *
 *   It is also the difference between ~400 `<rect>` elements on this page and
 *   about three thousand. The account page is not the admin panel; somebody
 *   opens it on a phone to change one switch.
 *
 * ── "None" is an option, not an absence ─────────────────────────────────────
 *
 * A store that wants no mascot anywhere near its checkout is a real store, and
 * a person who finds animals in a shop interface irritating is a real person.
 * Both are served by the same tile, and it sits in the grid with the others
 * rather than hiding behind a "disable" link, because it is a legitimate
 * answer rather than a way of switching the feature off.
 */
export default function CompanionPicker({ value, onChange, allowNone = true, idPrefix = 'cmp' }) {
  const [live, setLive] = useState(null);
  const motion = useCompanionMotion();

  const tile = (id, label, sprite) => {
    const selected = value === id;
    // The selected tile keeps moving so the page always says which one is
    // chosen even when the cursor is elsewhere; the rest wake on approach.
    const awake = motion && (selected || live === id);
    return (
      <button
        key={id}
        type="button"
        id={`${idPrefix}-${id}`}
        className={`cmp-tile${selected ? ' is-selected' : ''}`}
        aria-pressed={selected}
        onClick={() => onChange(id)}
        onPointerEnter={() => setLive(id)}
        onPointerLeave={() => setLive((v) => (v === id ? null : v))}
        onFocus={() => setLive(id)}
        onBlur={() => setLive((v) => (v === id ? null : v))}
        title={sprite ? ANIMALS[sprite].note : 'A plain button, and no animal at all'}
      >
        <span className="cmp-tile-art">
          {sprite
            ? <BuddySprite key={`${sprite}-${awake}`} animal={sprite} state={awake ? 'idle' : 'still'} size={64} />
            : <span className="cmp-tile-plain">Ask</span>}
        </span>
        <span className="cmp-tile-label">{label}</span>
      </button>
    );
  };

  return (
    <div className="cmp-grid" role="group" aria-label="Choose a companion">
      {allowNone && tile(NONE, 'None', null)}
      {NAMES.map((n) => tile(n, ANIMALS[n].label, n))}
    </div>
  );
}
