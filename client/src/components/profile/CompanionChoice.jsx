import { useCallback, useEffect, useState } from 'react';
import { PawPrint } from 'lucide-react';
import { api } from '../../utils/api';
import CompanionCard from '../ai/CompanionCard';
import CompanionPicker from '../ai/CompanionPicker';
import {
  NONE, resolveCompanion, setStoredCompanion, storedCompanion,
} from '../../utils/companion';

/**
 * "Which animal opens the assistant for me."
 *
 * ── It renders nothing unless the operator opened the door ──────────────────
 *
 * Three conditions, all read from `/api/ai/status`: the AI is on, the
 * assistant is one of the things this shop offers, and the operator has ticked
 * "let people pick their own". Absent rather than disabled, for the same
 * reason the navbar companion is absent when the assistant is off — a store
 * that made this decision for everybody should have no companion-shaped hole
 * on its account page explaining what people cannot do.
 *
 * ── Why there is no Save button ─────────────────────────────────────────────
 *
 * There is nothing to save anywhere. The choice is a `localStorage` key on
 * this browser (see utils/companion.js for why it is not a column on `users`),
 * so clicking an animal IS the change — the card beside the grid updates and
 * so does the navbar on the next page load. A Save button would imply the shop
 * was about to write this down about you, which is precisely what it is not
 * doing.
 *
 * The per-device consequence is stated on the card rather than left to be
 * discovered on a second phone.
 */
export default function CompanionChoice() {
  const [buddy, setBuddy] = useState(null);
  const [mine, setMine] = useState(() => storedCompanion());

  useEffect(() => {
    let alive = true;
    api.get('/ai/status')
      .then((s) => {
        if (!alive) return;
        const assistant = s?.capabilities?.find((c) => c.id === 'assistant');
        // The assistant being OFFERED is the gate, not the person's consent to
        // it: choosing what the button looks like is not the same decision as
        // agreeing to let a model read your orders, and making the picker wait
        // on consent would mean the friendliest thing on the page is the last
        // thing anybody sees.
        if (s?.enabled && assistant?.offered && s.buddy?.choice) setBuddy(s.buddy);
      })
      .catch(() => { /* a status that cannot be read is an assistant that is off */ });
    return () => { alive = false; };
  }, []);

  const choose = useCallback((name) => {
    // Picking the store's own answer clears the preference rather than
    // recording the same value: a stored choice that happens to match today's
    // store default would silently stop following it when the operator changed
    // theirs, which is not what "same as the shop" means.
    const next = name === buddy?.sprite || name === (resolveCompanion({ ...buddy, choice: false }).animal || NONE) ? null : name;
    setStoredCompanion(next);
    setMine(next);
  }, [buddy]);

  if (!buddy) return null;

  const resolved = resolveCompanion({ ...buddy, name: buddy.name });
  const effective = resolved.animal || NONE;

  return (
    <section className="glass-card prof-card cmp-choice">
      <div className="prof-card-head">
        <div className="prof-card-title">
          <h3><PawPrint size={17} aria-hidden="true" /> Your companion</h3>
          <p>
            Which animal opens the assistant for you. It lives in this browser,
            not in your account — so it is not something the shop knows about
            you, and another device will start on the shop&apos;s own choice.
          </p>
        </div>
      </div>

      <CompanionPicker value={effective} onChange={choose} idPrefix="my-cmp" />

      <CompanionCard
        animal={effective === NONE ? null : effective}
        name={resolved.name}
        size={80}
      >
        <p className="cmp-foot">
          {mine
            ? <>Yours, on this browser. <button type="button" className="cmp-link" onClick={() => choose(buddy.sprite || NONE)}>Use the shop&apos;s again</button></>
            : 'The shop’s own choice. Pick another and it changes here and in the navbar.'}
        </p>
      </CompanionCard>
    </section>
  );
}
