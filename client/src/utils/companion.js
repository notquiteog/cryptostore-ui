import { NAMES } from '../components/ai/sprites.js';

/**
 * Which companion this browser shows, and whether it is allowed to move.
 *
 * ── Why the choice is not a column on `users` ───────────────────────────────
 *
 * The same reasoning `sounds.js` gives for the mute switch, and it applies
 * harder here. A companion is taste, it is per-machine (a phone on a bus is
 * not a desk at home), and it has to work for a signed-out visitor — the
 * assistant itself does, when the operator allows it. Writing a row for it
 * would mean the server held one more fact about a named person for no benefit
 * anybody could point at, which is exactly what `CLAUDE.md` means by
 * "anything new that touches real-world identity should default to holding
 * less". Capability the server does not have cannot be taken from it.
 *
 * The consequence is stated plainly on the profile page rather than hidden:
 * the choice follows the browser, not the account.
 *
 * ── What the operator still decides ────────────────────────────────────────
 *
 * Four things, and all four come from `/api/ai/status`:
 *
 *   sprite       the store's own companion, and what everybody sees by default
 *   choice       whether a person may pick a different one at all
 *   name         what it is called, in the shop's own voice
 *   liveliness   how much it is allowed to move, on one three-way dial
 *
 * `resolveCompanion` is the single place those are combined with the local
 * preference. A second place that decided this would be a second place that
 * decided it differently — and the one that got it wrong would be the one that
 * ignored `choice`, quietly handing every visitor a picker the operator had
 * switched off.
 */

const KEY = 'cs.companion.v1';

/**
 * How much the operator lets it move, safest first.
 *
 * One dial rather than a switch per kind of movement — `ai_buddy_liveliness`
 * in server/config/aiKeys.js, which retired an `ai_buddy_roam` boolean. Two
 * booleans come back out of it here, because that is how the callers ask:
 * `stirs` is "may it do the small idle moments at all", `roam` is "may it
 * leave its button". Deriving both in one place is what stops a third caller
 * inventing a third reading of the same dial.
 */
const LIVELINESS = ['still', 'occasional', 'lively'];

/** Anything the server does not recognise reads as the default it ships. */
function liveliness(buddy) {
  const v = String(buddy?.liveliness ?? '');
  return LIVELINESS.includes(v) ? v : 'occasional';
}

/** `none` is a real, chosen answer: a plain button and no animal at all. */
const NONE = 'none';

/** Is this a sprite name the renderer can actually draw, or the plain button? */
function known(name) {
  return name === NONE || NAMES.includes(name);
}

/** What this browser has picked, or null if it has never picked anything. */
function storedCompanion() {
  try {
    const v = localStorage.getItem(KEY);
    return v && known(v) ? v : null;
  } catch {
    // Private mode, or storage blocked. The store's own choice stands, which
    // is the right answer rather than an error worth showing anybody.
    return null;
  }
}

/** Remember a choice, or forget it and fall back to the store's. */
function setStoredCompanion(name) {
  try {
    if (!name || !known(name)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, name);
  } catch { /* private mode: the choice simply does not persist */ }
  // The browser's storage event only reaches OTHER tabs. Without our local
  // event the preview changes immediately but the navbar keeps the old pet.
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('cs:companion'));
}

function subscribeCompanion(notify) {
  const storage = (event) => { if (event.key === KEY || event.key === null) notify(); };
  window.addEventListener('storage', storage);
  window.addEventListener('cs:companion', notify);
  return () => {
    window.removeEventListener('storage', storage);
    window.removeEventListener('cs:companion', notify);
  };
}

/**
 * The companion to draw, given the store's settings and this browser.
 *
 * @param {{sprite?: string, choice?: boolean, name?: string, liveliness?: string}} buddy
 * @returns {{animal: string|null, name: string|null, chosen: boolean, canChoose: boolean,
 *            liveliness: string, stirs: boolean, roam: boolean}}
 *   `animal` is null when the answer is a plain button — either because the
 *   operator picked `none` or because the stored name is one this build no
 *   longer ships.
 */
function resolveCompanion(buddy) {
  const store = known(buddy?.sprite) ? buddy.sprite : NONE;
  const canChoose = Boolean(buddy?.choice);
  const mine = canChoose ? storedCompanion() : null;
  const picked = mine || store;
  return {
    animal: picked === NONE ? null : picked,
    // The NAME is the shop's, even when the shape is the visitor's. An
    // operator who called their assistant "Ledger" has named the assistant,
    // not the cat — and letting a visitor's choice of animal rename the shop's
    // assistant would make one store answer to a different name on every
    // phone that visited it.
    name: (buddy?.name || '').trim() || null,
    chosen: Boolean(mine),
    canChoose,
    // The dial, and the two questions its callers actually ask of it. Walking
    // the bar stays opt-in and only the operator can opt in: decoration that
    // moves on every page is not something to switch on for somebody by
    // default.
    liveliness: liveliness(buddy),
    stirs: liveliness(buddy) !== 'still',
    roam: liveliness(buddy) === 'lively',
  };
}

/**
 * May we play a decorative animation?
 *
 * The CSS already pauses them under `prefers-reduced-motion` — this is the
 * other half: callers use it to decline to ENTER a decorative state at all, so
 * a hover does not queue a greeting nobody will see and then spend a second
 * waiting for it to finish. Read live rather than cached, because the
 * preference can change without a reload.
 */
function motionAllowed() {
  try {
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

export {
  KEY, NONE, LIVELINESS, known, storedCompanion, setStoredCompanion, subscribeCompanion, resolveCompanion,
  liveliness, motionAllowed,
};
