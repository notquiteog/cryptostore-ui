import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Buddy from './Buddy';
import BuddySprite from './BuddySprite';
import { getAiStatus } from '../../utils/aiStatus';
import { resolveCompanion } from '../../utils/companion';
import { companionPng } from '../../utils/companionIcon';
import { setFaviconOverride } from '../../utils/favicon';

/**
 * The companion as the admin's status light for the AI subsystem.
 *
 * ── Why this exists at all ──────────────────────────────────────────────────
 *
 * docs/AI.md §9 says the buddy's job is that the AI system's state is
 * otherwise invisible. That was true for buyers and wrong for the one person
 * it matters most to: the admin has no navigation bar, so it has no companion,
 * so an operator could only find out that the meaning index had stalled by
 * opening AI Settings and reading a line of counts. The index is a job
 * measured in minutes to hours; the page that reports it is one nobody sits
 * on.
 *
 * So the same animal, in the sidebar, bound to the same kind of real thing:
 *
 *   indexing   the sweeper has work left and is doing it        `work`
 *   blocked    it tried and could not — model, or vector store  `sleep`
 *   idle       nothing waiting                                  `idle`
 *
 * A capability the operator switched off deliberately is NOT a state here. It
 * is not a fault, the settings page already says so plainly, and an animal
 * asleep beside a switch somebody turned off on purpose is a status light
 * crying wolf. See `noteSkip`'s `kind` in services/ai/embedSweeper.js.
 *
 * ── Where the facts come from, and what they cost ───────────────────────────
 *
 * `/api/ai/status`, which every admin page already reads once a minute through
 * utils/aiStatus — so this adds no request. The server answers `jobs` only for
 * staff who may see AI settings, and it answers from the SWEEPER's record of
 * its own last pass rather than probing: watching a status light must not be a
 * way to make the store open connections to a model host.
 *
 * ── And why it borrows the tab ──────────────────────────────────────────────
 *
 * Because the whole point of a background job is that nobody is watching it.
 * An operator who starts a re-index and switches to another tab is exactly the
 * person this is for, and a sidebar they cannot see is no better than the page
 * of counts it replaced. So while the job is running or stalled the companion
 * becomes the tab icon — drawn locally, in the store's palette, no request —
 * and the store's own mark comes back the moment it is neither.
 *
 * The tab has one owner (utils/favicon.js) precisely so this cannot be the
 * feature that leaves somebody's storefront wearing an animal.
 *
 * ── Why it says words as well ───────────────────────────────────────────────
 *
 * Because `ai_buddy_sprite: none` is a real answer, and because a pose is not
 * a sentence. The line is the information and the animal illustrates it — the
 * same split the expiry notice uses in Buddy.jsx. With no companion chosen the
 * words appear on their own, which is exactly right: an operator who wanted no
 * mascot did not thereby ask for no status.
 *
 * ── Why the animal is a button and the words are a link ─────────────────────
 *
 * Because they go to two different places, and both are worth reaching.
 *
 * The animal is `Buddy` — the same assistant the storefront navbar carries,
 * the same component, so the admin cannot drift into a second assistant with
 * its own consent gate and its own bugs. Clicking it opens the chat where the
 * operator already is. Before this it did not exist in the console at all: the
 * only way to ask the shop's own assistant anything was to leave the console,
 * find it in the storefront, and come back.
 *
 * The words stay a link to `/admin/ai`, because the sentence they say is
 * usually "Index stalled" and the page that explains why is the one thing
 * somebody reading that wants next (DESIGN §9). Handing that link to the chat
 * as well would have cost the operator the diagnosis to gain a second route to
 * a panel the animal beside it already opens.
 *
 * The index state rides the animal exactly as it did, through Buddy's
 * `backgroundState` — it ranks below everything the assistant is doing, so a
 * sweep in progress can never paint over a model the store cannot reach. See
 * the ladder in Buddy.jsx.
 */
export default function AdminCompanion() {
  const [status, setStatus] = useState(null);
  const location = useLocation();

  // Re-read on navigation rather than on a timer. Admin work is a sequence of
  // page visits, the answer is cached for a minute, and a poll running on
  // every admin page for the life of the tab is the thing this whole design
  // has been avoiding.
  useEffect(() => {
    let alive = true;
    getAiStatus().then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, [location.pathname]);

  const jobs = status?.jobs;
  const notable = jobs?.indexing ? 'work' : (jobs?.blocked ? 'sleep' : null);
  const { animal: companion } = resolveCompanion(status?.enabled ? status.buddy : null);

  /*
   * The tab, while there is something to say. Cleared on unmount as well as on
   * the state changing, so leaving the admin gives the storefront its own mark
   * back — a buyer-facing tab wearing the operator's index light would be a
   * status leak with a face on it.
   */
  useEffect(() => {
    let alive = true;
    if (!notable || !companion) { setFaviconOverride(null); return undefined; }
    companionPng(companion, { state: notable, size: 64 })
      .then((png) => { if (alive && png) setFaviconOverride(png); });
    return () => { alive = false; setFaviconOverride(null); };
  }, [notable, companion]);

  /*
   * Whether this person is offered the assistant, read from the same two
   * fields Buddy reads. Asked here rather than left to Buddy because Buddy
   * renders NOTHING when it is not offered — which is right in a navbar and
   * would, here, take the status light's face away with it. When the answer is
   * no, the row falls back to the plain sprite it has always drawn.
   *
   * Note the two conditions are independent: `jobs` is answered only to staff
   * who may see AI settings, while the assistant is offered per person. A
   * packer with neither sees nothing, as before; one with only the assistant
   * gets the animal and no status line, which is the honest rendering of
   * "there is something to ask and nothing you are allowed to be told".
   */
  const assistant = status?.capabilities?.find((c) => c.id === 'assistant');
  const offered = Boolean(status?.enabled && assistant?.offered);

  // Nothing to report and nothing to ask: not staff, or the feature is off.
  if (!status?.enabled || (!jobs && !offered)) return null;

  const state = notable || 'idle';
  const line = !jobs ? null : jobs.indexing
    ? 'Indexing'
    : jobs.blocked
      ? 'Index stalled'
      : jobs.setup
        ? 'Index not set up'
        : 'Index up to date';

  return (
    <div className="admin-companion" data-state={state}>
      {/* The assistant's own button, or — when this shop or this person does
          not have one — the status light on its own, exactly as before. */}
      {offered
        ? <Buddy variant="admin" backgroundState={notable} />
        : companion && <BuddySprite animal={companion} state={state} size={24} />}
      {line && (
        <Link
          to="/admin/ai"
          className="admin-companion-line"
          // The reason is the sweeper's own sentence, already written for the
          // log. It is a title rather than body text because it can be long
          // and it is the second question, not the first.
          title={jobs.reason || 'The meaning index and the model behind it'}
        >
          {line}
        </Link>
      )}
    </div>
  );
}
