import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Store, Settings2, Sparkle } from 'lucide-react';
import BuddySprite from '../ai/BuddySprite';
import { motionAllowed } from '../../utils/companion';

/**
 * The end of the introduction: the shop's own companion walks on and says the
 * one thing left to say.
 *
 * ── Why a walk-on and not a tick ────────────────────────────────────────────
 *
 * `docs/DESIGN.md` §10 — a flourish must do a job, and the job here is
 * introduction rather than celebration. The animal in the navbar is the AI
 * system's only status light (docs/AI.md §9), and somebody who has just read
 * four pages about a model has been told about it entirely in words. This is
 * the moment they meet the thing they will actually be looking at: it walks in
 * from the left, exactly the way it walks the navigation bar, and it stops
 * where its button is going to be. A tick in a circle would have said "saved",
 * which they already know, and taught them nothing about where to look next.
 *
 * The walk is `walk` → `greet` → `idle`, the same three states the bar uses,
 * so nothing here invents a pose the companion cannot do in real life.
 *
 * ── When there is no animal ─────────────────────────────────────────────────
 *
 * A shop can have the whole AI feature switched off, or have chosen `none` for
 * its companion. Then there is no companion to introduce and drawing one
 * anyway would be introducing a thing the person will never see again. The
 * fallback is the other true ending of this flow — the seal — because on a
 * store with no assistant the introduction was entirely about what the shop
 * keeps and what it encrypts.
 *
 * ── Reduced motion ──────────────────────────────────────────────────────────
 *
 * The travel is declined outright rather than played and paused: an animal
 * frozen half way across the screen reads as a broken page. It arrives already
 * standing where it was walking to, and the sprite's own frames are stopped by
 * `100-ai-buddy.css` as they are everywhere else.
 */

/** How long the walk-on takes. Long enough to read as a walk, short enough not to be a wait. */
const WALK_MS = 1500;

export default function Finale({ animal, companionName, granted, keyAdded, hasKey, storeName, onLeave }) {
  const moving = motionAllowed();
  // 'off' → the animal is at the left edge, not yet started.
  // 'walk' → travelling.
  // 'greet'/'idle' → arrived.
  const [phase, setPhase] = useState(moving && animal ? 'off' : 'idle');
  const timers = useRef([]);

  useEffect(() => {
    if (!moving || !animal) return undefined;
    // One frame at the start position before the transition is armed, or the
    // element mounts already in place and the walk never happens — the same
    // "duration one frame ahead of the position" rule useCompanionRoam.js
    // records for the navbar walk.
    const start = requestAnimationFrame(() => setPhase('walk'));
    timers.current.push(window.setTimeout(() => setPhase('greet'), WALK_MS));
    return () => {
      cancelAnimationFrame(start);
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, [moving, animal]);

  /**
   * What to say about what they just did — from what was actually saved, never
   * from what the screen offered.
   *
   * A finale that said "your assistant is ready" to somebody who had turned
   * every switch off would be the interface lying on the last page, which is
   * the page people remember.
   */
  const line = useMemo(() => {
    if (granted.length > 0) {
      return granted.includes('assistant')
        ? 'I am in the bar at the top of every page. Ask me anything about the shop — I know the catalogue, the store pages, and your own orders.'
        : 'What you switched on is ready. You can change any of it from your account page, at any time.';
    }
    if (keyAdded) {
      return 'Your key is on file. Nothing here reads a model until you say so — the switches are on your account page when you want them.';
    }
    return 'Nothing is switched on, which is a perfectly good answer. The switches are on your account page if you ever change your mind.';
  }, [granted, keyAdded]);

  const called = companionName || 'The assistant';

  return (
    <div className="onb-finale">
      <div className={`onb-stagefloor is-${phase}`}>
        {animal ? (
          <div
            className="onb-walker"
            style={{ '--onb-walk-dur': `${WALK_MS}ms` }}
            aria-hidden="true"
          >
            <BuddySprite
              animal={animal}
              // `greet` is a one-shot; it hands control back through onDone and
              // the animal settles into the idle loop it will hold in the bar.
              state={phase === 'walk' ? 'walk' : phase === 'greet' ? 'greet' : 'idle'}
              size={96}
              onDone={phase === 'greet' ? () => setPhase('idle') : undefined}
            />
          </div>
        ) : (
          <div className="onb-seal" aria-hidden="true">
            <ShieldCheck size={44} />
          </div>
        )}
      </div>

      <h2 className="onb-finale-title">
        {animal ? `${called} will take it from here` : 'That is everything'}
      </h2>

      {/* A speech bubble only when there is somebody to be speaking. Without
          the animal it is a note from the shop, and a tail pointing at nothing
          would be a decoration pretending to be a mechanism. */}
      <p className={animal ? 'onb-say' : 'onb-finale-note'}>{line}</p>

      <ul className="onb-recap">
        <li>
          <Sparkle size={13} aria-hidden="true" />
          <span>
            {granted.length > 0
              ? `${granted.length} AI ${granted.length === 1 ? 'feature' : 'features'} on. Each one is a separate switch, and turning one off erases what it held.`
              : 'No AI features on. Nothing about you reaches a model.'}
          </span>
        </li>
        <li>
          <ShieldCheck size={13} aria-hidden="true" />
          {/* Three states, not two. `keyAdded` is about THIS run; `hasKey` is
              about the account. Reading only the first told somebody replaying
              the introduction that they had no key on file, on the strength of
              their not having pasted one in the last two minutes. */}
          <span>
            {keyAdded
              ? 'Your public key is on file — it can encrypt your address and sign you in.'
              : hasKey
                ? 'Your public key is already on file. Replacing it is done from your account page.'
                : 'No PGP key on file. You can add one from your account page whenever you like.'}
          </span>
        </li>
      </ul>

      {/* DESIGN §9: a confirmation ends pointing forward. The two places
          somebody goes from here are the shelf and the switches they were
          just shown, so both are on the screen rather than behind a back
          button. */}
      <div className="onb-finale-actions">
        {/* Both close the introduction as well as navigating. The screen is
            mounted OUTSIDE the router (App.jsx) precisely so it cannot be
            navigated out from under — which means a link that only navigated
            would leave the ending sitting over whatever page it opened. */}
        <Link to="/products" className="glass-btn glass-btn-primary onb-btn-lg" onClick={onLeave}>
          <Store size={16} aria-hidden="true" />
          Browse {storeName || 'the shop'}
        </Link>
        <Link to="/profile" className="glass-btn onb-btn-lg" onClick={onLeave}>
          <Settings2 size={16} aria-hidden="true" />
          Account settings
        </Link>
      </div>
    </div>
  );
}
