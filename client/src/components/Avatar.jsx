import { useState, useEffect, useLayoutEffect, useRef, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { useTheme } from '../context/ThemeContext';
import {
  Shield, ShieldCheck, Award, Clock, Package, Send, KeyRound, Ban, User as UserIcon,
} from 'lucide-react';

/**
 * The one avatar in this app, and the card that opens when a pointer rests on
 * it.
 *
 * Every surface that names a person renders this — the chat line, the dispute
 * thread, the support ticket, the review byline, the navbar. That is the whole
 * argument for it being one component: a face beside a name is the most
 * repeated element in the product, and five hand-rolled copies would be five
 * different sizes, five fallbacks and five decisions about who may see what.
 *
 * ── The fallback is the interesting half ──────────────────────────────────
 *
 * Most accounts have no picture, and an operator can switch avatars off
 * store-wide, so the no-image case is the COMMON case rather than the error
 * case. It is drawn as an initial on a colour derived from the username, which
 * gives every person a stable identity in a thread without the store holding
 * anything: the hue is computed in the browser from text already on screen.
 * Nothing is fetched, nothing is stored, and a person who never uploads
 * anything still looks like themselves in every room. Deriving it from the
 * name rather than the user id also means it works on payloads that carry only
 * a name — which is all the chat, the reviews and the disputes send.
 */

/**
 * A stable hue per name. FNV-1a because it is four lines and has no clustering
 * on short ASCII strings — `charCodeAt` sums do, and "abc"/"cba" landing on
 * the same colour in a room of similar handles is exactly the failure.
 */
function hueFor(name) {
  let h = 0x811c9dc5;
  const s = String(name || '?').toLowerCase();
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 360;
}

/**
 * The first character, as a grapheme rather than a code unit.
 *
 * `name[0]` splits an emoji or an astral-plane character in half and renders a
 * replacement glyph — and usernames on this store are whatever people type.
 * Intl.Segmenter is in every browser this app targets; the slice is the
 * fallback for the ones where it is not.
 */
function initialOf(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const first = seg.segment(s)[Symbol.iterator]().next();
    return (first.done ? s.slice(0, 1) : first.value.segment).toUpperCase();
  } catch {
    return s.slice(0, 1).toUpperCase();
  }
}

/**
 * Just the circle. No card, no fetch, no hover — used wherever an avatar is
 * decoration rather than a thing to interrogate (your own, in the navbar and
 * on your profile).
 *
 * `size` is a number of pixels rather than a t-shirt size because the call
 * sites genuinely differ — 22 in a chat line, 28 in a ticket, 96 on the
 * profile — and a scale with four named steps would have acquired a fifth
 * within a week.
 */
export function AvatarImage({ username, avatarPath, size = 28, className = '', title }) {
  const { settings } = useTheme();
  const [broken, setBroken] = useState(false);
  // An operator switch-off has to hide existing pictures too, not just the
  // uploader — otherwise turning it off leaves every avatar already uploaded
  // on screen and the switch looks broken.
  const enabled = settings.avatars_enabled !== 'false';
  const src = enabled && !broken ? avatarPath : null;
  const hue = hueFor(username);

  // Reset on a new path so replacing a picture recovers from an earlier
  // failure — without this, one 404 pinned the initial forever.
  useEffect(() => { setBroken(false); }, [avatarPath]);

  return (
    <span
      className={`avatar ${className}`.trim()}
      style={{
        '--avatar-size': `${size}px`,
        '--avatar-hue': hue,
      }}
      title={title}
      aria-hidden={title ? undefined : 'true'}
    >
      {src ? (
        <img src={src} alt={title ? `${username}'s profile picture` : ''} onError={() => setBroken(true)} loading="lazy" />
      ) : (
        <span className="avatar-initial">{initialOf(username)}</span>
      )}
    </span>
  );
}

/** Role badges, in the one place that decides what a role looks like. */
const ROLE_META = {
  admin: { label: 'Admin', Icon: ShieldCheck, tone: 'var(--danger)' },
  manager: { label: 'Staff', Icon: Shield, tone: 'var(--warning)' },
};

/**
 * "How long they have been here", in the unit that is actually informative.
 *
 * Days for the first month, because "signed up 3 days ago" is the single most
 * useful thing to know about a stranger in a chat room and "less than a month"
 * throws it away. Months up to two years, then years.
 */
function tenure(iso) {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days < 0) return 'just now';
  if (days === 0) return 'joined today';
  if (days === 1) return 'joined yesterday';
  if (days < 31) return `${days} days here`;
  const months = Math.floor(days / 30.44);
  if (months < 24) return `${months} month${months === 1 ? '' : 's'} here`;
  return `${Math.floor(days / 365.25)} years here`;
}

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/**
 * One row of the card. Kept as a component so the icon column lines up: a card
 * whose four facts each indent differently reads as four unrelated notes.
 */
function CardFact({ icon: Icon, children, tone }) {
  return (
    <div className="ucard-fact">
      <Icon size={13} aria-hidden="true" style={tone ? { color: tone } : undefined} />
      <span>{children}</span>
    </div>
  );
}

/**
 * The card body. Split from the trigger so the fetch only mounts when a card
 * is actually opened — a chat backlog of two hundred lines must not be two
 * hundred requests waiting to happen.
 */
function ProfileCard({ username, onClose }) {
  const [card, setCard] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error

  useEffect(() => {
    let alive = true;
    api.get(`/profiles/${encodeURIComponent(username)}`)
      .then((data) => { if (alive) { setCard(data); setState('ready'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [username]);

  const role = ROLE_META[card?.role];

  return (
    <div className="ucard">
      <div className="ucard-head">
        <AvatarImage username={username} avatarPath={card?.avatar_path} size={44} />
        <div className="ucard-id">
          <span className="ucard-name">{username}</span>
          <span className="ucard-badges">
            {role && (
              <span className="ucard-role" style={{ '--role-tone': role.tone }}>
                <role.Icon size={11} aria-hidden="true" /> {role.label}
              </span>
            )}
            {card?.tier_name && (
              <span className="ucard-tier" style={{ '--tier-tone': card.tier_color || 'var(--primary)' }}>
                <Award size={11} aria-hidden="true" /> {card.tier_name}
              </span>
            )}
          </span>
        </div>
      </div>

      {state === 'loading' && <div className="ucard-note"><span className="spinner spinner-inline" /> Reading profile…</div>}
      {/* An error here is not worth a red panel: the card is a convenience
          over a name that is already on screen and readable. Say what is
          missing and leave the name alone. */}
      {state === 'error' && <div className="ucard-note">Could not load this profile.</div>}

      {state === 'ready' && (
        <div className="ucard-facts">
          {card.active === false && (
            <CardFact icon={Ban} tone="var(--danger)">Account is deactivated</CardFact>
          )}
          {tenure(card.member_since) && (
            <CardFact icon={Clock}>
              {tenure(card.member_since)}
              {/* Hover discloses the exact date — DESIGN §4. The relative
                  form is what anyone actually wants; the absolute one is what
                  someone chasing a specific incident needs. */}
              <span className="ucard-exact" title={new Date(card.member_since).toLocaleString()}>
                {' · '}{new Date(card.member_since).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
              </span>
            </CardFact>
          )}

          {/* Everything below is permission-gated server side: the fields are
              absent from the payload rather than blanked, so a customer's card
              cannot render a staff fact even if this code forgot to ask. */}
          {typeof card.order_count === 'number' && (
            <CardFact icon={Package}>
              {card.order_count === 0 ? 'No orders yet' : `${card.order_count} order${card.order_count === 1 ? '' : 's'}`}
              {card.order_count > 0 && <span className="ucard-mono"> · {money(card.lifetime_total)}</span>}
            </CardFact>
          )}
          {(card.telegram_linked || card.potato_linked) && (
            <CardFact icon={Send}>
              Reachable on {[card.telegram_linked && 'Telegram', card.potato_linked && 'Potato'].filter(Boolean).join(' and ')}
            </CardFact>
          )}
          {card.pgp_on_file && <CardFact icon={KeyRound}>PGP key on file</CardFact>}

          {/* DESIGN §9: a record links to its neighbours. Staff who can see the
              order count are staff who can open the account. */}
          {typeof card.order_count === 'number' && !card.is_self && (
            <Link className="ucard-link" to={`/admin/users?q=${encodeURIComponent(username)}`} onClick={onClose}>
              Open in user admin
            </Link>
          )}
          {card.is_self && (
            <Link className="ucard-link" to="/profile" onClick={onClose}>
              This is you — edit your profile
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Avatar plus hover card.
 *
 * Hover-intent timings match `NavPopover` (80ms in, 300ms out) deliberately —
 * two different hover delays in one app is the kind of thing nobody can name
 * but everybody feels. It is not built ON NavPopover because that component
 * mounts its panel permanently and keys children off an `open` flag, which is
 * right for five fixed navbar panels and wrong for a chat log where the same
 * pattern would mount two hundred cards.
 *
 * Touch has no hover (DESIGN §4), so on a coarse pointer the avatar becomes a
 * button that opens the same card on tap. The information is never
 * hover-only.
 *
 * ── Why the card is portalled to <body> ─────────────────────────────────────
 *
 * It used to render inside the avatar, absolutely positioned, and nearly every
 * place an avatar sits is a `.glass-card` — each support message, dispute
 * message and review. That broke it twice over:
 *
 *   - `.glass-card` is `overflow: hidden`, so the card was CUT OFF at the edge
 *     of the message that held it; on a ticket you saw its top third and then
 *     the next message. Raising z-index cannot fix a clip.
 *   - `.glass-card` has its own `backdrop-filter`, which makes it the card's
 *     BACKDROP ROOT. The card's blur could only sample what was painted inside
 *     that one message, so the text behind it showed through crisp instead of
 *     dissolving — and over the next message there was nothing to blur at all.
 *     No CSS on the card can reach past a backdrop root.
 *
 * Releasing the clip with `overflow: visible` fixed the first and not the
 * second. At <body> the card has no clipping ancestor and its backdrop root is
 * the page, which is what DESIGN §3's lg glass assumes. BinChip's shelf peek
 * is portalled for exactly the same pair of reasons.
 *
 * Moving it out of the DOM order costs two things this component then has to
 * put back by hand, and both are marked where they happen: the pointer
 * travelling from avatar to card (the card carries the same hover handlers),
 * and the Tab order (the trigger hands focus into the card, and the card's
 * last stop hands it back).
 */
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
// Roughly the card's tallest form — enough to pick a side, which is all it is
// used for. A few pixels out never matters on a card this short.
const CARD_HEIGHT = 230;
const CARD_WIDTH = 250;
const GAP = 8;

function placeCard(anchor) {
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Below by default; above only when below would run off the screen AND
  // above has the room. An avatar near the bottom of a long chat is the case.
  const up = r.bottom + GAP + CARD_HEIGHT > vh && r.top - GAP - CARD_HEIGHT > 0;
  const left = Math.max(GAP, Math.min(r.left, vw - CARD_WIDTH - GAP));
  return up
    ? { up, style: { left: `${left}px`, top: 'auto', bottom: `${vh - r.top + GAP}px` } }
    : { up, style: { left: `${left}px`, top: `${r.bottom + GAP}px` } };
}

export default function Avatar({ username, avatarPath, size = 28, className = '' }) {
  const [open, setOpen] = useState(false);
  const [canHover, setCanHover] = useState(false);
  const [place, setPlace] = useState(null);
  const timers = useRef({ open: null, close: null });
  const wrapRef = useRef(null);
  const cardRef = useRef(null);
  const triggerRef = useRef(null);
  // Set while focus is being handed BACK to the trigger off the card's last
  // stop, so the trigger's onFocus does not reopen what Tab just left. Without
  // it the keyboard loops trigger → card → trigger → card forever.
  const returning = useRef(false);
  // Set between a pointer pressing the trigger and that press's click. A tap
  // FOCUSES the button and then CLICKS it; focus opened the card and the click
  // toggled it straight shut again, so on a phone tapping an avatar showed
  // nothing at all — the hover-free path the comment above promises did not
  // exist. During a press the click alone decides; focus only opens the card
  // for focus that did not come from a pointer, which is the keyboard.
  const pressing = useRef(false);
  const panelId = useId();

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

  const close = useCallback(() => { clearTimers(); setOpen(false); }, []);

  // A fixed card does not move with the page, so it is re-placed on every
  // scroll and resize while open — capture phase, because the scroll that
  // matters is usually a chat log or a thread, not the window. Layout effect
  // so the first paint is already in the right place rather than at 0,0.
  useLayoutEffect(() => {
    if (!open || !wrapRef.current) { setPlace(null); return undefined; }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (wrapRef.current) setPlace(placeCard(wrapRef.current)); });
    };
    setPlace(placeCard(wrapRef.current));
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

  // Press mode's outside-click, and Escape in both modes. "Inside" is the
  // avatar OR the card: the card is no longer a DOM descendant of the avatar,
  // so checking only the wrap closed it on the first click of its own link.
  useEffect(() => {
    if (!open) return undefined;
    const inside = (node) => wrapRef.current?.contains(node) || cardRef.current?.contains(node);
    const onDown = (e) => { if (!inside(e.target)) setOpen(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Focus goes back to the trigger if it was in the card, which is about
      // to unmount — otherwise it falls to <body> and the keyboard user is
      // dropped at the top of the page.
      if (cardRef.current?.contains(document.activeElement)) {
        returning.current = true;
        triggerRef.current?.focus();
      }
      close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  if (!username) return <AvatarImage username="?" size={size} className={className} />;

  // On the avatar AND on the card. The card used to be inside the avatar, so
  // moving the pointer onto it never left the hover target; now it is
  // elsewhere in the DOM, and without these on the card the 300ms close timer
  // started by leaving the avatar shut it under the pointer.
  const hoverProps = canHover ? {
    onMouseEnter: () => { clearTimers(); timers.current.open = setTimeout(() => setOpen(true), 80); },
    onMouseLeave: () => { clearTimers(); timers.current.close = setTimeout(() => setOpen(false), 300); },
  } : {};

  const inCard = (node) => cardRef.current?.contains(node);
  const focusables = () => [...(cardRef.current?.querySelectorAll(FOCUSABLE) ?? [])];

  // The trigger's Tab goes INTO the card, as it did when the card followed the
  // trigger in the DOM. At the end of <body> the browser's own Tab would skip
  // it entirely and the card would be mouse-only.
  const onTriggerKeyDown = (e) => {
    if (e.key !== 'Tab' || e.shiftKey || !open) return;
    const first = focusables()[0];
    if (first) { e.preventDefault(); first.focus(); }
  };
  // And the card's ends hand focus back: Shift+Tab off the first stop returns
  // to the trigger with the card still open; Tab off the last closes it and
  // lands on the trigger, so the next Tab carries on into the page from where
  // the avatar is rather than from the bottom of <body>.
  const onCardKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) return;
    if (e.shiftKey && document.activeElement === list[0]) {
      e.preventDefault();
      returning.current = true;
      triggerRef.current?.focus();
      returning.current = false;
    } else if (!e.shiftKey && document.activeElement === list[list.length - 1]) {
      e.preventDefault();
      returning.current = true;
      triggerRef.current?.focus();
      close();
    }
  };

  return (
    <span className={`avatar-wrap ${className}`.trim()} ref={wrapRef} {...hoverProps}>
      <button
        type="button"
        ref={triggerRef}
        className="avatar-trigger"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={`Profile of ${username}`}
        // Focus opens it for the same reason NavPopover uses focus-within: a
        // hover-revealed panel that a keyboard cannot reach is not reachable.
        onFocus={() => {
          if (returning.current) { returning.current = false; return; }
          if (pressing.current) return;
          clearTimers(); setOpen(true);
        }}
        onBlur={(e) => {
          // A press that never became a click — a finger dragged off the
          // avatar — must not leave the next KEYBOARD focus unable to open it.
          pressing.current = false;
          if (e.currentTarget.parentElement?.contains(e.relatedTarget) || inCard(e.relatedTarget)) return;
          close();
        }}
        onKeyDown={onTriggerKeyDown}
        onPointerDown={() => { pressing.current = true; }}
        onPointerCancel={() => { pressing.current = false; }}
        onClick={() => { pressing.current = false; setOpen((v) => !v); }}
      >
        <AvatarImage username={username} avatarPath={avatarPath} size={size} />
      </button>
      {open && place && createPortal((
        <div
          ref={cardRef}
          className={`avatar-card${place.up ? ' avatar-card-up' : ''}`}
          style={place.style}
          id={panelId}
          role="dialog"
          aria-label={`Profile of ${username}`}
          {...hoverProps}
          onKeyDown={onCardKeyDown}
          // Focus leaving the card for anywhere that is neither the card nor
          // the trigger closes it, the same rule the trigger's onBlur applies.
          onBlur={(e) => {
            if (inCard(e.relatedTarget) || e.relatedTarget === triggerRef.current) return;
            close();
          }}
        >
          <ProfileCard username={username} onClose={close} />
        </div>
      ), document.body)}
    </span>
  );
}
