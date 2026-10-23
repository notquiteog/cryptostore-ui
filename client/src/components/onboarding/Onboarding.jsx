import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, ArrowRight, Check, KeyRound, Lock, Search, Sparkles,
  ShieldCheck, ShieldAlert, Cpu, EyeOff, Hash, PackageOpen, FileLock2, UserCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { api } from '../../utils/api';
import { getAiStatus, invalidateAiStatus } from '../../utils/aiStatus';
import { resolveCompanion } from '../../utils/companion';
import { checkPublicKeyBlock } from '../../utils/armor';
import { planSteps, consentableCapabilities } from '../../utils/onboardingPlan';
import Finale from './Finale';

/**
 * The introduction: four pages and an ending, shown once, over everything.
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 *
 * This store asks two things of a new account that no ordinary shop asks, and
 * both of them are worse to discover late than to be told early:
 *
 *   1. Whether a language model may read their orders. The switches for that
 *      exist on the account page and nobody finds a settings page they were
 *      not sent to, so the practical outcome of "there is a toggle in
 *      settings" is a feature nobody uses and consent nobody gave knowingly.
 *   2. That there is no password reset. `CLAUDE.md` is explicit that this is
 *      deliberate — no email, no phone, nothing to send a link to — and
 *      somebody learning it at the moment they need it has already lost the
 *      account.
 *
 * So it is a screen, not a banner, and it is the only screen in the storefront
 * allowed to be the whole viewport.
 *
 * ── Why the flag is on the account and not in this browser ──────────────────
 *
 * See the migration (`20260930000000_onboarding.js`). The short version: the
 * requirement is that signing out half way through does not count as finishing
 * it, and a browser key cannot express that. `user.onboarding_complete` comes
 * down with `/auth/me` on every load, so the gate resolves in the same request
 * the rest of the shell is already waiting on and there is no frame where the
 * catalogue is visible to somebody who has not been introduced to it.
 *
 * ── It only ever describes what this install actually has ───────────────────
 *
 * `utils/onboardingPlan.js` decides which pages exist from `/api/ai/status`
 * and the store's PGP key. A shop with the model switched off does not get two
 * pages about a model; a shop with no usable store key does not offer to
 * encrypt an address to one. That is not tidiness — a page promising a feature
 * the install does not have is the interface lying, and it is the first thing
 * a new buyer would read.
 *
 * ── Touch ───────────────────────────────────────────────────────────────────
 *
 * Swipe left and right between pages, on Pointer Events so mouse, pen and
 * touch are one implementation (`DESIGN.md` §8). Three rules make it survive
 * contact with a real thumb:
 *
 *   · `touch-action: pan-y` on the deck, so the browser keeps vertical
 *     scrolling and hands us the horizontal axis. Without it a short screen
 *     cannot be read, because every attempt to scroll a long page starts a
 *     page turn instead.
 *   · A drag is only claimed once it is more horizontal than vertical. A
 *     thumb travelling down a page wobbles sideways by ten pixels and must not
 *     lose its scroll to that.
 *   · Controls opt out. A drag starting on the key textarea is a text
 *     selection and a drag starting on a switch is somebody pressing it; both
 *     are excluded by `[data-no-swipe]` rather than by guessing from the tag.
 *
 * Never a swipe INTO the ending: the last page's forward gesture rubber-bands
 * instead. Finishing writes consents to the server, and an action with a
 * network write behind it gets a button somebody meant to press.
 *
 * ── It is portalled to the body, and has to be ──────────────────────────────
 *
 * The account page mounts this component to replay the introduction, and it
 * mounts it inside a `.glass-card`. **A `backdrop-filter` establishes a
 * containing block for fixed-position descendants**, so `position: fixed;
 * inset: 0` resolved against the card rather than the viewport: the whole
 * screen rendered as a panel a third of the way down the profile, scrolling
 * with the page behind it. Nothing errored; it simply stopped being an
 * overlay. Every glass surface in this app carries that filter, so a portal
 * is the only version of this component that is safe to mount anywhere.
 */

/** How far a horizontal drag must travel before it turns a page. */
const SWIPE_MIN = 64;

/** Past this ratio of the deck's own width, a shorter flick still counts. */
const SWIPE_RATIO = 0.16;

/** Beyond this the drag is a scroll and not a page turn. */
const AXIS_LOCK = 1.3;

export default function Onboarding({ replay = false, onClose }) {
  const { user, refreshUser } = useAuth();
  const { settings } = useTheme();

  // `undefined` is "not asked yet" and null is "asked and it failed". The
  // difference decides whether the screen may render at all: planning the
  // pages from a status that has not arrived would build the AI pages for a
  // shop that has AI switched off, then remove them under the reader.
  const [ai, setAi] = useState(undefined);
  const [storeKey, setStoreKey] = useState(undefined);

  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState(null);   // Set of capability ids, once known
  const [pgpKey, setPgpKey] = useState('');
  const [keyError, setKeyError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  // What the server actually recorded. The ending reads these rather than the
  // switches on screen, so it cannot congratulate somebody on a capability
  // that failed to save.
  const [saved, setSaved] = useState(null);

  const rootRef = useRef(null);
  const deckRef = useRef(null);
  const headingRef = useRef(null);
  const drag = useRef(null);
  const [dragX, setDragX] = useState(0);

  useEffect(() => {
    let alive = true;
    // A replay READS the consents and then writes them back, so it must not
    // start from the shared 60-second cache: a stale `consented` set
    // re-submitted at the end is a change made in another tab being quietly
    // undone. The first run has nothing to be stale about.
    if (replay) invalidateAiStatus();
    getAiStatus().then((s) => { if (alive) setAi(s || null); });
    api.get('/store-pgp/public')
      .then((d) => { if (alive) setStoreKey(d); })
      .catch(() => { if (alive) setStoreKey(null); });
    return () => { alive = false; };
  }, [replay]);

  const hasKey = Boolean(user?.has_pgp_key);
  const ready = ai !== undefined && storeKey !== undefined;

  const steps = useMemo(
    () => planSteps({ ai, hasKey, storeKeyReady: storeKey?.address_encryption_ready === true }),
    [ai, hasKey, storeKey],
  );
  const offers = useMemo(() => consentableCapabilities(ai), [ai]);

  /*
   * The switches start ON — the requirement, and the honest default for a
   * shop whose operator has already decided these features are worth offering.
   *
   * Except on a replay, where they start where the person left them. Somebody
   * re-reading the introduction has already answered; defaulting them back to
   * "all on" would silently re-grant consent they had withdrawn, which is the
   * one way a consent screen can do actual harm.
   */
  useEffect(() => {
    if (chosen || !ready) return;
    setChosen(new Set(
      replay ? offers.filter((c) => c.consented).map((c) => c.id) : offers.map((c) => c.id),
    ));
  }, [chosen, ready, replay, offers]);

  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const finishing = index === steps.length - 2;   // the page whose forward button saves

  // Nothing behind the introduction scrolls, and nothing behind it takes
  // focus. Same shape as the age gate next door.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  // The heading takes focus on every page turn, so a screen reader announces
  // the new page and a keyboard tab lands at its top rather than wherever the
  // previous page's last control happened to be.
  useEffect(() => {
    const t = window.setTimeout(() => headingRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, [index]);

  const go = useCallback((next) => {
    setIndex((i) => Math.max(0, Math.min(next, steps.length - 1)));
    setDragX(0);
  }, [steps.length]);

  /**
   * Save, then show the ending.
   *
   * The account is NOT refreshed here. Refreshing sets `onboarding_complete`
   * and the gate in App.jsx would unmount this component mid-animation — the
   * person would press Finish and the screen would vanish. The refresh happens
   * when they leave the ending, by which point the flag is already true on the
   * server, so a reload in between shows them the shop rather than the
   * introduction again.
   */
  const finish = useCallback(async () => {
    if (saving) return;
    const key = pgpKey.trim();
    if (key) {
      const shape = checkPublicKeyBlock(key);
      if (!shape.ok) {
        setKeyError(shape.message);
        // Land them on the page carrying the box, whichever number it is.
        const at = steps.findIndex((s) => s.id === 'recovery');
        if (at >= 0) go(at);
        return;
      }
    }
    setSaving(true);
    setSaveError('');
    try {
      const res = await api.post('/onboarding/complete', {
        capabilities: [...(chosen || [])],
        ...(key && !hasKey ? { pgp_public_key: key } : {}),
      });
      setSaved({ granted: res?.capabilities || [], keyAdded: Boolean(res?.pgp_key_added) });
      // The cached status now disagrees with the server about this person's
      // consents, and the navbar companion is holding it. Drop it so the
      // assistant they just switched on is awake on the page behind this one.
      invalidateAiStatus();
      go(steps.length - 1);
    } catch (err) {
      // Not "nothing was changed" — the key is written before the consents, so
      // a failure part way through may have saved half of it, and claiming
      // otherwise would be the screen guessing. What IS true is that pressing
      // it again is safe: every write behind this button is idempotent.
      setSaveError(`${err.message || 'That could not be saved.'} Press Finish again — repeating it is safe.`);
    }
    setSaving(false);
  }, [saving, pgpKey, chosen, hasKey, steps, go]);

  const leave = useCallback(() => {
    onClose?.();
    // Only now: this is what makes the gate stop rendering the screen.
    refreshUser();
  }, [onClose, refreshUser]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  //
  // Arrows page. Escape deliberately does nothing: this is not a dialog
  // somebody opened, and dismissing it would be skipping it.
  //
  // Tab wraps inside the screen. Without that, `aria-modal` is a claim the
  // page does not keep — the shop behind is still in the tab order, so a few
  // presses walk a keyboard user into a catalogue they cannot see, with the
  // introduction still nominally in front of them.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Tab') {
        const root = rootRef.current;
        if (!root) return;
        const focusable = [...root.querySelectorAll(
          'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
        )].filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last_ = focusable[focusable.length - 1];
        if (e.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
          e.preventDefault();
          last_.focus();
        } else if (!e.shiftKey && document.activeElement === last_) {
          e.preventDefault();
          first.focus();
        }
        return;
      }
      if (e.target?.closest?.('input, textarea, select')) return;
      if (e.key === 'ArrowRight' && !last && !finishing) go(index + 1);
      if (e.key === 'ArrowLeft' && index > 0 && !last) go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, last, finishing, go]);

  // ── Swipe ─────────────────────────────────────────────────────────────────

  const onPointerDown = (e) => {
    if (last || saving) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target?.closest?.('[data-no-swipe]')) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null };
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;

    if (d.axis === null) {
      // Undecided. Vertical wins ties, because losing a scroll to a page turn
      // is a worse failure than losing a page turn to a scroll.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) <= Math.abs(dy) * AXIS_LOCK) { drag.current = null; return; }
      d.axis = 'x';
      // Capture is what lets the thumb wander off the deck mid-turn; it is not
      // what the turn depends on. A pointer already gone by the time we ask
      // throws NotFoundError, and an exception out of a React event handler
      // over a nicety is not a trade worth making — the same guard, for the
      // same reason, as the live-chat slide.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the turn continues uncaptured */ }
    }

    // Rubber-band at both ends, and at the forward end of the last readable
    // page: there IS no next page there, and a deck that slid freely into
    // nothing would promise one.
    const blocked = (dx > 0 && index === 0) || (dx < 0 && finishing);
    setDragX(blocked ? dx * 0.22 : dx);
  };

  const endDrag = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.axis !== 'x') { setDragX(0); return; }
    const width = deckRef.current?.clientWidth || 1;
    const threshold = Math.min(SWIPE_MIN, width * SWIPE_RATIO);
    const dx = e.clientX - d.x;
    if (dx <= -threshold && !finishing) go(index + 1);
    else if (dx >= threshold && index > 0) go(index - 1);
    else setDragX(0);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  // Nothing until both reads have landed. A half-planned introduction that
  // grows a page under the reader is worse than a beat of the page they were
  // already looking at.
  if (!ready || !chosen || !user) return null;

  const storeName = (settings.store_name || '').trim();
  const companion = resolveCompanion(ai?.buddy);

  return createPortal((
    <div
      className="onb"
      role="dialog"
      aria-modal="true"
      // Named here rather than by `aria-labelledby` on the page heading: the
      // ending has no heading with that id, and a dialog whose label points at
      // a missing element has no accessible name at all.
      aria-label={storeName ? `Welcome to ${storeName}` : 'Welcome'}
      ref={rootRef}
    >
      {/* Two elements, not one. `.onb-shell` DECLARES the size container and
          `.onb-frame` is laid out against it — an element cannot query the
          container it declares, so a single div carrying both the width cap
          and `container-type` would leave the rail-beside-content rule
          silently never matching. It is the trap DESIGN §5 names, and it
          costs a wrapper to avoid. */}
      <div className="onb-shell">
        <div className="onb-frame">
          <OnboardingRail
            steps={steps}
            index={index}
            locked={last}
            storeName={storeName}
            onPick={go}
          />

          <div className="onb-main">
            <div
              className="onb-deck"
              ref={deckRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={() => { drag.current = null; setDragX(0); }}
            >
              <article
                className={`onb-sheet${dragX ? ' is-dragging' : ''}`}
                style={dragX ? { transform: `translate3d(${dragX}px, 0, 0)` } : undefined}
                key={step.id}
              >
                {last ? (
                  <Finale
                    animal={companion.animal}
                    companionName={companion.name}
                    granted={saved?.granted || []}
                    keyAdded={Boolean(saved?.keyAdded)}
                    hasKey={hasKey}
                    storeName={storeName}
                    onLeave={leave}
                  />
                ) : (
                  <>
                    <h2 className="onb-title" tabIndex={-1} ref={headingRef}>
                      {step.title}
                    </h2>
                    <p className="onb-lede">{step.lede}</p>

                    {step.id === 'finding' && <FindingStep ai={ai} companion={companion} />}
                    {step.id === 'switches' && (
                      <SwitchesStep
                        offers={offers}
                        chosen={chosen}
                        onChange={setChosen}
                      />
                    )}
                    {step.id === 'ordering' && <OrderingStep storeKey={storeKey} />}
                    {step.id === 'recovery' && (
                      <RecoveryStep
                        hasKey={hasKey}
                        value={pgpKey}
                        error={keyError}
                        onChange={(v) => { setPgpKey(v); setKeyError(''); }}
                      />
                    )}
                  </>
                )}
              </article>
            </div>

            {!last && (
              <footer className="onb-foot">
                <button
                  type="button"
                  className="glass-btn onb-btn-lg onb-back"
                  onClick={() => go(index - 1)}
                  disabled={index === 0}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  <span>Back</span>
                </button>

                {saveError && <p className="onb-save-error" role="alert">{saveError}</p>}

                {finishing ? (
                  <button
                    type="button"
                    className="glass-btn glass-btn-primary onb-btn-lg onb-next"
                    onClick={finish}
                    disabled={saving}
                  >
                    {saving
                      ? <span className="spinner spinner-inline" />
                      : <Check size={16} aria-hidden="true" />}
                    <span>{saving ? 'Saving' : 'Finish'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="glass-btn glass-btn-primary onb-btn-lg onb-next"
                    onClick={() => go(index + 1)}
                  >
                    <span>Next</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                )}
              </footer>
            )}

            {last && (
              <footer className="onb-foot onb-foot-end">
                <button type="button" className="glass-btn onb-btn-lg onb-next" onClick={leave}>
                  <span>Close</span>
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </footer>
            )}
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}

/**
 * Where you are, and what is left.
 *
 * One piece of markup that is a numbered contents list on a wide screen and a
 * row of segments on a narrow one — not two, because two would put the same
 * navigation in the accessibility tree twice and a screen reader would read
 * every step name a second time. The narrow shape hides the words with
 * `.sr-only` rather than `display: none`, so what a sighted reader loses to
 * width is still announced.
 *
 * The steps are BUTTONS for pages already visited. Somebody who wants to
 * re-read what the switches meant should not have to swipe backwards past two
 * pages to get there, and a forward jump is refused because the pages read in
 * order — the switches page makes no sense before the page explaining what it
 * is switching on.
 */
function OnboardingRail({ steps, index, locked, storeName, onPick }) {
  // The ending is not a page anybody navigates to, so it is not in the rail.
  const readable = steps.slice(0, -1);
  return (
    <nav className="onb-rail" aria-label="Introduction">
      <p className="onb-rail-brand">
        <Sparkles size={13} aria-hidden="true" />
        <span>{storeName ? `Welcome to ${storeName}` : 'Welcome'}</span>
      </p>
      <ol className="onb-rail-list">
        {readable.map((s, i) => {
          const state = locked ? 'done' : i < index ? 'done' : i === index ? 'now' : 'next';
          return (
            <li key={s.id} className={`onb-rail-item is-${state}`}>
              <button
                type="button"
                className="onb-rail-step"
                aria-current={state === 'now' ? 'step' : undefined}
                disabled={state === 'next' || locked}
                onClick={() => onPick(i)}
              >
                <span className="onb-rail-num" aria-hidden="true">
                  {state === 'done' ? <Check size={12} /> : i + 1}
                </span>
                <span className="onb-rail-text">
                  <span className="onb-rail-title">{s.title}</span>
                  <span className="onb-rail-lede">{s.lede}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="onb-rail-count" aria-hidden="true">
        {locked ? 'Done' : `${index + 1} / ${readable.length}`}
      </p>
    </nav>
  );
}

/** A small labelled fact. Three of these is a row; one is a note. */
function Fact({ icon: Icon, title, children }) {
  return (
    <div className="onb-fact">
      <span className="onb-fact-icon"><Icon size={15} aria-hidden="true" /></span>
      <div className="onb-fact-body">
        <h4>{title}</h4>
        <p>{children}</p>
      </div>
    </div>
  );
}

/**
 * Page one: how this shop is searched, and what is answering.
 *
 * Every claim here is bound to something in the code, because the whole point
 * of the page is that a buyer can believe it:
 *
 *   word search + typos   services/catalogSearch.js (full-text, then trigram)
 *   meaning search        the `search` capability, embeddings, docs/AI.md §4
 *   what it may read      services/ai/retrieval.js, docs/AI.md §6a
 *   never states a number docs/AI.md §7
 *   nothing kept          Buddy.jsx drops the transcript when the panel closes
 */
function FindingStep({ ai, companion }) {
  const has = (id) => ai?.capabilities?.some((c) => c.id === id && c.offered);
  const called = companion.name || 'the assistant';

  return (
    <div className="onb-cols">
      <div className="onb-prose">
        <section className="onb-block">
          <h3><Search size={16} aria-hidden="true" /> Search finds the shelf</h3>
          <p>
            Type what you remember. The catalogue is matched on words first — name, brand,
            category, tags, description — and a typo still lands: <em>adidsa</em> finds Adidas.
          </p>
          {has('search') && (
            <p>
              When the words match nothing, this shop tries again by <strong>meaning</strong>.
              Your phrase is turned into a vector by the shop&apos;s own model and compared
              against the catalogue, so <em>something citrusy for the evening</em> can return
              a product whose page uses neither word.
            </p>
          )}
        </section>

        {has('assistant') && (
          <section className="onb-block">
            <h3><Sparkles size={16} aria-hidden="true" /> And {called} answers</h3>
            <p>
              The animal in the bar at the top of the page. It answers from three places and
              nowhere else: the products this shop actually stocks, the pages the operator
              wrote — shipping, payment, privacy — and <strong>your own orders</strong>.
              Never anybody else&apos;s.
            </p>
            <p className="onb-aside-note">
              It is also the only status light the AI has. Awake means the model answered;
              asleep means it cannot be reached; thinking means it is working on your question
              right now. It cannot look cheerful while the model is down.
            </p>
          </section>
        )}
      </div>

      <aside className="onb-facts">
        <Fact icon={Cpu} title="It is not a service">
          There is no OpenAI here, no Google, no analytics beacon. The model runs where this
          shop&apos;s operator put it — by default a container beside the shop itself. When it
          is somewhere else, it is their own machine, reached over TLS and optionally over Tor.
        </Fact>
        <Fact icon={EyeOff} title="Nothing is written down">
          Your question and its answer live in the page and are dropped when you close the
          panel. The one feature that remembers anything is called Assistant memory, it has its
          own switch, and it erases what it holds the moment you turn it off.
        </Fact>
        <Fact icon={Hash} title="It never invents a number">
          Prices, stock counts and order status are read from the shop&apos;s own records and
          printed as they are. The model is shown them; it is never asked to say one.
        </Fact>
      </aside>
    </div>
  );
}

/**
 * Page two: the switches.
 *
 * One master control, on by default, and every capability underneath it with
 * its own switch and the server's own description of what it does. The
 * individual switches are not hidden behind a disclosure: a master switch
 * whose contents you have to go looking for is a bundle, and bundling is how
 * consent screens become something people click through.
 */
function SwitchesStep({ offers, chosen, onChange }) {
  const allOn = offers.length > 0 && offers.every((c) => chosen.has(c.id));

  const setAll = (on) => onChange(new Set(on ? offers.map((c) => c.id) : []));
  const toggle = (id) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  return (
    <div className="onb-switches">
      <label className={`onb-master${allOn ? ' is-on' : ''}`} data-no-swipe>
        <span className="switch">
          <input
            type="checkbox"
            checked={allOn}
            onChange={(e) => setAll(e.target.checked)}
          />
          <span className="switch-track" />
        </span>
        <span className="onb-master-text">
          <strong>Turn on everything this shop offers</strong>
          <span>
            {offers.length} {offers.length === 1 ? 'feature' : 'features'}. Leave it on, or
            pick them one at a time below.
          </span>
        </span>
      </label>

      <ul className="onb-caps">
        {offers.map((c) => (
          <li key={c.id} className={`onb-cap${chosen.has(c.id) ? ' is-on' : ''}`}>
            <label data-no-swipe>
              <span className="onb-cap-text">
                <span className="onb-cap-title">{c.label}</span>
                <span className="onb-cap-what">{c.what}</span>
                {/* What withdrawing it would destroy, from the server, so the
                    switch is honest about being reversible rather than
                    claiming it in the abstract. */}
                {c.holds && (
                  <span className="onb-cap-holds">
                    Turning this off later erases {c.holds.what}.
                  </span>
                )}
              </span>
              <span className="switch">
                <input
                  type="checkbox"
                  checked={chosen.has(c.id)}
                  onChange={() => toggle(c.id)}
                />
                <span className="switch-track" />
              </span>
            </label>
          </li>
        ))}
      </ul>

      <p className="onb-foot-note">
        <ShieldCheck size={13} aria-hidden="true" />
        <span>
          Every one of these is two switches: this one, and the operator&apos;s. Both have to be
          on. Yours lives on your account page afterwards, and turning one off erases whatever
          it was holding in the same click — not on a schedule, and not eventually.
        </span>
      </p>
    </div>
  );
}

/**
 * Page three: what an order is, and what happens to the one field that could
 * identify you.
 *
 * `storeKey` decides which half of this page is true. An install with no
 * active key cannot encrypt anything, and telling a buyer otherwise would be
 * the exact failure `services/addressCrypto.js` refuses at the other end —
 * silently storing plaintext while the interface says "encrypted".
 */
function OrderingStep({ storeKey }) {
  const canEncrypt = storeKey?.address_encryption_ready === true;

  return (
    <div className="onb-cols">
      <div className="onb-prose">
        <section className="onb-block">
          <h3><PackageOpen size={16} aria-hidden="true" /> What an order is</h3>
          <p>
            A list of what you bought, a total, and — if it is being posted to you — an
            address. That address is the most damaging thing this shop could hold, so it is
            the one field the shop is built to be unable to read casually.
          </p>
        </section>

        <section className="onb-block">
          {/* The heading answers to the same fact the body does. "Three ways to
              encrypt it" over a paragraph explaining that this shop cannot
              encrypt anything is the screen contradicting itself in the two
              lines a reader is most likely to read. */}
          <h3>
            <FileLock2 size={16} aria-hidden="true" />
            {canEncrypt ? 'Three ways to encrypt it' : 'Encrypting the address'}
          </h3>
          {canEncrypt ? (
            <ol className="onb-steps-list">
              <li>
                <strong>Let the shop seal it.</strong> Switch on address encryption and it is
                stored as a PGP block encrypted to the store&apos;s key <em>and to yours</em>.
                Reading it needs the store&apos;s private key — a separate secret from the
                database — and every read is written to the audit log.
              </li>
              <li>
                <strong>Seal it yourself, in this browser.</strong> At checkout there is a box
                marked <em>seal in my browser</em>. Tick it and the address is encrypted on
                your device before it is sent; the shop only ever receives the block.
              </li>
              <li>
                <strong>Bring your own.</strong> Paste an armored PGP block into the address
                field. The shop stores it exactly as pasted and never re-encrypts it — you
                chose the recipients, and a second layer would leave a block staff cannot open
                and an order nobody can ship.
              </li>
            </ol>
          ) : (
            <p className="onb-warn">
              <ShieldAlert size={15} aria-hidden="true" />
              <span>
                This shop has no usable PGP key right now, so an address is stored as you write
                it. Nothing here will pretend otherwise. Ask the operator before pasting a
                block — one encrypted to a key they do not hold cannot be read by anyone,
                including the staff who would ship it.
              </span>
            </p>
          )}
        </section>
      </div>

      <aside className="onb-facts">
        <Fact icon={UserCheck} title="Staff see fields, not pages">
          Address, totals and payment details are each behind a separate permission. Somebody
          picking your order from a shelf sees what to put in the box and never sees who you
          are.
        </Fact>
        <Fact icon={Lock} title="Every privileged read is logged">
          Refunds, forced payment confirmation, unlocking the store key to read an address —
          each one writes an audit row naming who did it and when.
        </Fact>
        <Fact icon={EyeOff} title="No address on the record">
          Sessions and audit rows carry no IP address unless the operator switches that on. On
          a store reached over Tor it would be the exit node&apos;s anyway, and on any store it
          is one more thing to hold.
        </Fact>
      </aside>
    </div>
  );
}

/**
 * Page four: the key box, and the sentence people most need to read before
 * they need it.
 *
 * The two belong on one page because they are one subject. `CLAUDE.md`:
 * *"There is deliberately no self-service password reset … recovery is an
 * admin setting a new password, TOTP recovery codes, or a PGP challenge."*
 * The key box is one of those three routes, so putting it anywhere else would
 * be listing a problem on one page and its solution on another.
 */
function RecoveryStep({ hasKey, value, error, onChange }) {
  return (
    <div className="onb-cols">
      <div className="onb-prose">
        <section className="onb-block onb-block-loud">
          <h3><ShieldAlert size={16} aria-hidden="true" /> There is no password reset</h3>
          <p>
            This account has no email address and no phone number, on purpose — there is
            nothing for a reset link to be sent to, and nothing to be leaked, subpoenaed or
            sold. The trade is real and it is yours to know about: <strong>a forgotten
            password with nothing else on the account cannot be recovered by anybody.</strong>
          </p>
          <p>Three things can get you back in, and all three are set up in advance:</p>
          <ul className="onb-list">
            <li>An admin setting a new password for you.</li>
            <li>A recovery code, if you enrol an authenticator app.</li>
            <li>A PGP challenge — the shop encrypts a token to your key and you decrypt it.</li>
          </ul>
        </section>
      </div>

      <aside className="onb-facts onb-facts-wide">
        {hasKey ? (
          <div className="onb-keydone">
            <span className="onb-fact-icon"><Check size={15} aria-hidden="true" /></span>
            <div className="onb-fact-body">
              <h4>Your key is already on file</h4>
              <p>
                Replacing it is done from your account page, where the change can be proved —
                a key that could be swapped from anywhere would be a way to take the account,
                not just to lock it.
              </p>
            </div>
          </div>
        ) : (
          <div className="onb-keybox" data-no-swipe>
            <label htmlFor="onb-pgp">
              <KeyRound size={15} aria-hidden="true" />
              <span>Your PGP public key</span>
              <em>optional</em>
            </label>
            <textarea
              id="onb-pgp"
              className="glass-input onb-key-input"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
              rows={7}
              spellCheck="false"
              autoComplete="off"
              aria-describedby="onb-pgp-hint"
              aria-invalid={error ? 'true' : undefined}
            />
            {error && <p className="onb-key-error" role="alert">{error}</p>}
            <p className="onb-key-hint" id="onb-pgp-hint">
              Public key only. Nothing in this shop ever asks for your private key, and this box
              refuses one if you paste it by accident.
            </p>
            <ul className="onb-list onb-list-tight">
              <li>Encrypt your shipping address, to the store&apos;s key and to yours.</li>
              <li>Sign in with the key instead of a password.</li>
              <li>Use it as your second factor.</li>
            </ul>
            <p className="onb-key-hint">
              Skip it if you have no key yet — you can add one from your account page at any
              time, and adding a first key never needs proof.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
