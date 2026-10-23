import {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight, Bell, Check, CheckCheck, Gauge, Headphones, Package, PackageCheck,
  Scale, ShieldAlert, ShoppingBag, Truck, Undo2, X,
} from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { canAccessAdminPath } from '../../utils/adminPermissions';
import {
  ago, destinationFor, groupByDay, hrefFor, kindLabel, readBody, readTitle, toneFor,
} from '../../utils/noticeDisplay';

/**
 * Everything the shop broadcasts to its staff, on the screen they are already
 * looking at.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 *
 * `server/services/staffNotify.js` was written so that no caller could address
 * a single channel, and on its own terms it worked: nobody has shipped a
 * Telegram-only broadcast since. It was still missing half its audience,
 * because the channels were two CHAT NETWORKS — and a manager who runs the
 * shop from a laptop has linked neither. Risk lamps, stock crossings,
 * operational thresholds and carrier exceptions were not quieter for that
 * person, or redacted; they were absent, with nothing anywhere saying so.
 *
 * This is the fourth channel, and the only one that needs nothing set up: a
 * row per broadcast, addressed to one staff member, holding exactly the text
 * that person's permissions entitled them to at the moment it was sent.
 *
 * ── A bell in each bar, one tray ────────────────────────────────────────────
 *
 * It was a 352px popover measured off a bell in the sidebar head, and it was
 * wrong on both viewports. On a desktop it opened BEHIND the rail — z-index 60
 * under 100 — so the heading and the start of every title were hidden. On a
 * phone the bell existed only inside the hamburger drawer, so the unread count
 * could not be seen until somebody opened the menu for another reason, and the
 * panel it opened painted beneath the drawer's scrim: a blurred list behind a
 * dimming layer that nobody could read or press.
 *
 * Now there is a bell in each bar a person actually sees — the rail on a desk,
 * the top bar on a phone — and ONE tray that both open, which comes out of the
 * bar the bell is in. Where it sits is CSS against the layout's own 900px line
 * (`119-staff-notices.css`); nothing measures a bell any more.
 *
 * The state lives once, in `StaffNoticesProvider`, above both bells. The old
 * component was mounted twice — in the rail, and again in the drawer, which is
 * always in the DOM — so every admin navigation asked for the same count
 * twice, on a store that may be reached over Tor.
 *
 * ── Why it still lives in the bars ──────────────────────────────────────────
 *
 * Because `AdminCompanion` already made the argument, about the index: *the
 * page that reports it is one nobody sits on*. A notices page in the sidebar
 * would be the same mistake with a bell on it. The bar is where an operator's
 * eye already goes, so the count sits there, and the tray opens over the
 * console rather than replacing it. Nothing here is a destination; every row's
 * job is to send somebody somewhere else, and it says where (`destinationFor`).
 *
 * ── No polling ──────────────────────────────────────────────────────────────
 *
 * Read on navigation, exactly as `AdminCompanion` reads the AI status, and on
 * the tab coming back into view — both events, neither a timer. Admin work is
 * a sequence of page visits, and a timer running for the life of the tab is a
 * request every interval forever on a store that may be reached over Tor. The
 * trade is that a notice arriving while somebody stares at one page is not
 * seen until they move — which is what Web Push is for, and push is a channel
 * of the same fan-out, so the person got it there.
 *
 * ── §6: which list shape ────────────────────────────────────────────────────
 *
 * Neither a responsive table nor a card grid, and no toggle. The tray is one
 * column of one measure on a phone and on an 8K monitor, so it is line items,
 * one notice per row under its day: the title carries the weight, the body is
 * a muted clamp, the kind and the destination are a footnote. A table would be
 * columns nobody can read at this width; cards would be three rows a screen
 * on a board that holds fifty.
 *
 * ── Why the tray is a PORTAL ────────────────────────────────────────────────
 *
 * `.admin-sidebar` carries `overflow: auto` AND `backdrop-filter`. The first
 * clips anything hung off the rail; the second makes the rail a containing
 * block, so `position: fixed` would not escape it either — and a frosted panel
 * inside a frosted bar filters an empty backdrop (DESIGN §3), ignoring the
 * operator's blur slider. So the tray renders into `document.body`, and the
 * bells reach it through context.
 */

/**
 * The icon per notice class.
 *
 * `kind` comes from the broadcaster (`staffNotify`'s builder result) and is a
 * hint, never authorization — the row was already addressed and already
 * redacted server-side. An unknown kind falls back to the bell rather than
 * rendering nothing, because a new broadcaster should not be able to produce
 * an invisible row.
 */
const KIND_ICON = {
  stock: Package,
  risk: ShieldAlert,
  ops: Gauge,
  order: ShoppingBag,
  support: Headphones,
  parcel: Truck,
  pack: PackageCheck,
  returns: Undo2,
  dispute: Scale,
};

/** How long a dismissed row takes to slide out and close its gap — `--dur-3`. */
const LEAVE_MS = 340;

/**
 * Where an empty board points instead. Filtered by permission at render: a
 * packer holding only `orders.pick` must not be offered the risk board as the
 * place to look.
 */
const ELSEWHERE = [
  { to: '/admin/orders', label: 'Order queue' },
  { to: '/admin/risk', label: 'Risk board' },
  { to: '/admin/stock', label: 'Stock ops' },
  { to: '/admin/pack', label: 'Packing' },
];

const NoticesContext = createContext(null);

export function StaffNoticesProvider({ children }) {
  const location = useLocation();
  const trayId = useId();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notices, setNotices] = useState(null);
  const [more, setMore] = useState(false);
  const [keep, setKeep] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [older, setOlder] = useState(false);
  const [leaving, setLeaving] = useState(() => new Set());
  const [sweeping, setSweeping] = useState(false);
  const [ringing, setRinging] = useState(false);
  const openerRef = useRef(null);
  const lastCount = useRef(null);
  const ringTimer = useRef(null);

  /**
   * Every change to the count goes through here, so the bell can ring when it
   * RISES — and only then.
   *
   * Not on the first read (`lastCount` is null), or a board with nine unread
   * would ring on every page load; and not for `quiet` updates, which are this
   * tab reconciling its own optimistic arithmetic with the server — a rollback
   * that puts one back is not a new notice.
   */
  const takeCount = useCallback((value, quiet = false) => {
    const n = Number(value) || 0;
    if (!quiet && lastCount.current !== null && n > lastCount.current) {
      clearTimeout(ringTimer.current);
      setRinging(true);
      ringTimer.current = setTimeout(() => setRinging(false), 1000);
    }
    lastCount.current = n;
    setUnread(n);
  }, []);
  useEffect(() => () => clearTimeout(ringTimer.current), []);

  // The badge only. Cheap, and the one thing that has to be right without the
  // tray being open. A 403 here is not an error worth showing: this renders
  // inside a layout that already refused non-staff, so the only way to get one
  // is a demotion mid-session — in which case the right behaviour is to go
  // quiet, not to put a red box in the bar.
  const refreshCount = useCallback(async () => {
    try {
      const res = await api.get('/admin/notices/unread');
      takeCount(res?.unread);
    } catch {
      takeCount(0, true);
    }
  }, [takeCount]);

  useEffect(() => { refreshCount(); }, [location.pathname, refreshCount]);

  // Coming back to the tab re-reads the count — the moment somebody is about
  // to look, instead of a timer that asks whether or not anybody is there.
  //
  // At most once per half minute, and the floor is not caution. This was "one
  // request per return", and a return turned out to be something a browser can
  // report every second: the embedded preview pane flips a hidden tab to
  // visible and back about once a second, and this handler answered every flip
  // — fourteen badge requests in fifteen idle seconds, measured, on a page
  // nobody was touching. Chrome's window-occlusion tracking reports an ordinary
  // desktop window hidden whenever another window fully covers it, so an
  // operator alt-tabbing between two maximised windows produces the same
  // stream. A return sooner than the floor is a glance, not an absence, and
  // the count read on the last navigation is still the count.
  useEffect(() => {
    const FLOOR_MS = 30_000;
    // From mount: the pathname effect above has just read the count.
    let last = Date.now();
    const onShow = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - last < FLOOR_MS) return;
      last = Date.now();
      refreshCount();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [refreshCount]);

  // Any navigation puts the tray away. Following a row already does; this
  // covers the back button and a rail link pressed while the tray was out.
  useEffect(() => { setOpen(false); }, [location.pathname]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get('/admin/notices');
      setNotices(Array.isArray(res?.notices) ? res.notices : []);
      setMore(Boolean(res?.more));
      setKeep(res?.keep || null);
      takeCount(res?.unread);
    } catch (err) {
      // Said out loud rather than rendered as an empty list. An empty board and
      // a board that failed to load look identical and mean opposite things,
      // and the one that means "you are up to date" is the one an operator
      // will assume. Rows already held stay on screen under the error.
      setError(err?.message || 'Could not load notices');
      setNotices((rows) => rows || []);
    }
  }, [takeCount]);

  const loadOlder = useCallback(async () => {
    const last = notices?.[notices.length - 1];
    if (!last || older) return;
    setOlder(true);
    try {
      // The cursor is the last row held, as its time AND its id — the pair the
      // board is ordered by. See `staffNotice.listFor` for why an id alone
      // paged a board with a bumped repeat on it wrong.
      const qs = new URLSearchParams({ before: String(last.id), before_at: String(last.created_at) });
      const res = await api.get(`/admin/notices?${qs}`);
      const page = Array.isArray(res?.notices) ? res.notices : [];
      // Deduplicated by id all the same. A row that fires again between the two
      // reads is bumped to the head server-side; it is already held, and must
      // not appear a second time at the bottom.
      setNotices((rows) => {
        const held = new Set((rows || []).map((n) => n.id));
        return [...(rows || []), ...page.filter((n) => !held.has(n.id))];
      });
      setMore(Boolean(res?.more));
      takeCount(res?.unread, true);
    } catch (err) {
      setError(err?.message || 'Could not load older notices');
    } finally {
      setOlder(false);
    }
  }, [notices, older, takeCount]);

  const openTray = useCallback((opener) => {
    openerRef.current = opener || null;
    setOpen(true);
    load();
  }, [load]);

  // Focus goes back to the bell that opened the tray when the tray was closed
  // from inside it — Escape, the close button — so a keyboard user is not left
  // at the top of the document. A click elsewhere keeps focus where it landed.
  const closeTray = useCallback((restoreFocus) => {
    setOpen(false);
    if (restoreFocus) openerRef.current?.focus?.({ preventScroll: true });
  }, []);

  const toggle = useCallback((opener) => {
    if (open) closeTray(false);
    else openTray(opener);
  }, [open, openTray, closeTray]);

  const markAll = useCallback(async () => {
    setBusy(true);
    try {
      const res = await api.post('/admin/notices/read', {});
      takeCount(res?.unread, true);
      // Patched in place rather than re-fetched: the list on screen is the list
      // that was just marked, and a re-fetch would re-order it under the cursor
      // if a scan fired during the round trip. `sweeping` staggers the unread
      // rails as they retract, top to bottom, so the eye sees what "all" meant.
      const stamp = new Date().toISOString();
      setSweeping(true);
      setTimeout(() => setSweeping(false), 700);
      setNotices((rows) => (rows || []).map((n) => (n.read_at ? n : { ...n, read_at: stamp })));
    } catch (err) {
      setError(err?.message || 'Could not mark those read');
    } finally {
      setBusy(false);
    }
  }, [takeCount]);

  // Optimistic, and reconciled honestly: the row reads as read at once, and if
  // the write fails it goes back to unread and the count is re-read rather than
  // re-derived.
  const markOne = useCallback((n) => {
    if (!n || n.read_at) return;
    const stamp = new Date().toISOString();
    setNotices((rows) => (rows || []).map((r) => (r.id === n.id ? { ...r, read_at: stamp } : r)));
    takeCount(Math.max(0, unread - 1), true);
    api.post('/admin/notices/read', { ids: [n.id] })
      .then((res) => takeCount(res?.unread, true))
      .catch(() => {
        setNotices((rows) => (rows || []).map((r) => (r.id === n.id ? { ...r, read_at: null } : r)));
        api.get('/admin/notices/unread').then((res) => takeCount(res?.unread, true)).catch(() => {});
      });
  }, [unread, takeCount]);

  const dismiss = useCallback((n) => {
    // The row slides out and its gap closes (the CSS), THEN it leaves the list.
    // Removing it at once would make the neighbours teleport up under the
    // pointer, which is how a second click lands on the wrong notice.
    setLeaving((s) => new Set(s).add(n.id));
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    setTimeout(() => {
      setNotices((rows) => (rows || []).filter((r) => r.id !== n.id));
      setLeaving((s) => {
        const next = new Set(s);
        next.delete(n.id);
        return next;
      });
    }, reduce ? 0 : LEAVE_MS);
    if (!n.read_at) takeCount(Math.max(0, unread - 1), true);
    api.delete(`/admin/notices/${n.id}`)
      .then((res) => takeCount(res?.unread, true))
      .catch((err) => {
        // A 404 is the outcome the person asked for — the row was pruned, or
        // dismissed in another tab. Anything else is said, and the board is
        // re-read so the row comes back if it really is still there.
        if (err?.status !== 404) setError(err?.message || 'Could not dismiss that');
        load();
      });
  }, [unread, takeCount, load]);

  // Following a notice is reading it. Marked on the click rather than on
  // render: a tray that clears its own badge the instant it opens means a
  // glance at a list of nine costs you the record of which two you had not
  // dealt with.
  const follow = useCallback((n) => {
    setOpen(false);
    markOne(n);
  }, [markOne]);

  const value = useMemo(() => ({
    trayId, open, unread, ringing, notices, more, keep, error, busy, older, leaving, sweeping,
    toggle, closeTray, load, loadOlder, markAll, markOne, dismiss, follow,
  }), [
    trayId, open, unread, ringing, notices, more, keep, error, busy, older, leaving, sweeping,
    toggle, closeTray, load, loadOlder, markAll, markOne, dismiss, follow,
  ]);

  return (
    <NoticesContext.Provider value={value}>
      {children}
      <NoticesTray />
    </NoticesContext.Provider>
  );
}

/**
 * The bell. Renders nothing outside a provider, so a stray import cannot put a
 * dead button in a bar.
 *
 * `variant` is where it sits — 'rail' (the desktop sidebar head) or 'bar' (the
 * phone's top bar) — and only its size and alignment differ, in the CSS.
 */
export function NoticesBell({ variant = 'rail' }) {
  const ctx = useContext(NoticesContext);
  if (!ctx) return null;
  const { trayId, open, unread, ringing, toggle } = ctx;
  // The count is in the label as well as on the badge: a screen reader reading
  // "Notices, button" cannot see the number painted on it.
  const label = unread ? `Notices, ${unread} unread` : 'Notices';
  return (
    <button
      type="button"
      className="staff-notices-bell"
      data-notices-bell=""
      data-variant={variant}
      data-unread={unread > 0 ? 'yes' : 'no'}
      data-open={open ? 'yes' : 'no'}
      data-ringing={ringing ? 'yes' : 'no'}
      aria-expanded={open}
      aria-controls={trayId}
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      onClick={(e) => toggle(e.currentTarget)}
    >
      <Bell size={variant === 'bar' ? 20 : 17} aria-hidden="true" />
      {unread > 0 && (
        <span className="staff-notices-count" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </button>
  );
}

function NoticesTray() {
  const {
    trayId, open, unread, notices, more, keep, error, busy, older, leaving, sweeping,
    closeTray, load, loadOlder, markAll, markOne, dismiss, follow,
  } = useContext(NoticesContext);
  const { user } = useAuth();
  const trayRef = useRef(null);
  const scrollRef = useRef(null);
  const headingRef = useRef(null);
  const pull = useRef(null);
  const swallowClick = useRef(false);
  const [expanded, setExpanded] = useState(() => new Set());

  // Close on a press outside or on Escape — both, because the tray overlays the
  // console and a panel you can only dismiss with its own button traps a
  // keyboard user. A press on either bell is left to the bell's own toggle, or
  // the two would close and reopen the tray in one click.
  useEffect(() => {
    if (!open) return undefined;
    // Back at the top: new notices arrive at the head, and a tray reopened
    // halfway down last time's scroll would hide exactly those.
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    const focusTimer = setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 0);
    const onDown = (e) => {
      if (trayRef.current?.contains(e.target)) return;
      if (e.target instanceof Element && e.target.closest('[data-notices-bell]')) return;
      closeTray(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') closeTray(true); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, closeTray]);

  /*
   * The pull tab (phone only — the CSS hides it on a desk).
   *
   * On a phone the tray drops from the top bar, which puts its close button at
   * the top of a sheet that can reach the bottom of the screen: the one place a
   * thumb is not. The tab sits on the tray's lower edge, where the thumb is.
   * A tap closes; a drag upward follows the finger and closes past a quarter of
   * the tray's height or on a flick; anything short springs back. It is a
   * button, so keyboard and screen readers get the tap without the drag
   * (DESIGN §8), and `touch-action: none` is on the tab alone, never the list.
   */
  const onPullDown = (e) => {
    pull.current = { y: e.clientY, t: e.timeStamp, dy: 0, dragged: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer ids throw */ }
  };
  const onPullMove = (e) => {
    const p = pull.current;
    const tray = trayRef.current;
    if (!p || !tray) return;
    p.dy = Math.min(0, e.clientY - p.y);
    if (Math.abs(p.dy) > 4) p.dragged = true;
    if (p.dragged) {
      tray.style.transition = 'none';
      tray.style.transform = `translateY(${p.dy}px)`;
    }
  };
  const onPullEnd = (e) => {
    const p = pull.current;
    const tray = trayRef.current;
    pull.current = null;
    if (!p || !tray || !p.dragged) return;
    // A drag is not also a tap: the click that follows pointerup is swallowed.
    swallowClick.current = true;
    tray.style.transition = '';
    tray.style.transform = '';
    const speed = p.dy / Math.max(1, e.timeStamp - p.t);
    if (e.type === 'pointerup' && (p.dy < -tray.offsetHeight * 0.25 || speed < -0.5)) closeTray(false);
  };
  const onPullClick = () => {
    if (swallowClick.current) {
      swallowClick.current = false;
      return;
    }
    closeTray(true);
  };

  const toggleRow = useCallback((n) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(n.id)) next.delete(n.id);
      else next.add(n.id);
      return next;
    });
    markOne(n);
  }, [markOne]);

  const groups = useMemo(() => groupByDay(notices || []), [notices]);
  const elsewhere = ELSEWHERE.filter((l) => canAccessAdminPath(user, l.to)).slice(0, 3);
  const held = notices?.length || 0;

  let tally = 'Reading the board…';
  if (notices !== null) {
    tally = (
      <>
        {unread > 0 ? <><b>{unread}</b> unread</> : 'All read'}
        {held > 0 && ` · ${held}${more ? '+' : ''} on the board`}
      </>
    );
  }

  // One running index across the day groups, so the arrival stagger is a single
  // ladder down the tray rather than restarting under every day heading.
  let row = 0;

  return createPortal(
    <>
      {/* The phone's scrim. It exists to absorb the tap that closes the tray,
          so the page underneath does not also receive it as a click on
          whatever card was there. On a desk the tray is not modal and the CSS
          removes this: a click on the console closes the tray AND lands. */}
      <div className="staff-notices-scrim" data-open={open ? 'yes' : 'no'} aria-hidden="true" />
      <aside
        ref={trayRef}
        id={trayId}
        className="staff-notices-tray glass-plate"
        data-open={open ? 'yes' : 'no'}
        data-sweeping={sweeping ? 'yes' : 'no'}
        role="dialog"
        aria-labelledby={`${trayId}-title`}
        inert={!open}
      >
        <header className="staff-notices-head">
          <div className="staff-notices-heading">
            <h2 id={`${trayId}-title`} ref={headingRef} tabIndex={-1} className="staff-notices-title">
              Notices
            </h2>
            <p className="staff-notices-tally" aria-live="polite">{tally}</p>
          </div>
          {/* Kept in the DOM when there is nothing unread, only disabled, so
              the head does not change shape as the last notice is read. */}
          <button
            type="button"
            className="staff-notices-tool"
            aria-label="Mark all read"
            onClick={markAll}
            disabled={busy || !unread}
          >
            <CheckCheck size={15} aria-hidden="true" />
            <span className="staff-notices-tool-label">Mark all read</span>
          </button>
          <button
            type="button"
            className="staff-notices-tool staff-notices-close"
            aria-label="Close notices"
            onClick={() => closeTray(true)}
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="staff-notices-scroll" ref={scrollRef}>
          {error && (
            <p className="staff-notices-error" role="alert">
              {error}
              <button type="button" onClick={load}>Try again</button>
            </p>
          )}

          {notices === null && !error && (
            <p className="staff-notices-state">Reading the board…</p>
          )}

          {notices !== null && held === 0 && !error && (
            /*
             * An empty state that is navigation, not apology (DESIGN §9). The
             * honest reading of an empty board is "nothing has been broadcast
             * to you", which is not the same as "nothing is happening" — so it
             * points at the pages that answer the second question.
             */
            <div className="staff-notices-empty">
              <p className="staff-notices-empty-head">Nothing has been broadcast to you.</p>
              <p>
                Payments that need a look, stock crossing its threshold, risk
                lamps and carrier exceptions land here as they happen.
              </p>
              {elsewhere.length > 0 && (
                <nav className="staff-notices-empty-links" aria-label="Where to look instead">
                  {elsewhere.map((l) => (
                    <Link key={l.to} to={l.to} onClick={() => closeTray(false)}>
                      {l.label}
                      <ArrowRight size={13} aria-hidden="true" />
                    </Link>
                  ))}
                </nav>
              )}
            </div>
          )}

          {groups.map((g) => (
            <section key={g.key} className="staff-notices-day" aria-labelledby={`${trayId}-day-${g.key}`}>
              <h3 id={`${trayId}-day-${g.key}`} className="staff-notices-day-label">
                <span>{g.label}</span>
                {g.unread > 0 && <span className="staff-notices-day-new">{g.unread} new</span>}
              </h3>
              <ul className="staff-notices-list">
                {g.items.map((n) => (
                  <NoticeRow
                    key={n.id}
                    n={n}
                    i={Math.min(row++, 10)}
                    leaving={leaving.has(n.id)}
                    expanded={expanded.has(n.id)}
                    onFollow={follow}
                    onToggle={toggleRow}
                    onMarkRead={markOne}
                    onDismiss={dismiss}
                  />
                ))}
              </ul>
            </section>
          ))}

          {more && (
            <button type="button" className="staff-notices-more" onClick={loadOlder} disabled={older}>
              {older ? 'Reading…' : 'Load older notices'}
            </button>
          )}

          {notices !== null && (
            <footer className="staff-notices-foot">
              {/* The windows come from the server that enforces them, so this
                  line cannot drift from `staffNotice.READ_TTL_DAYS`. */}
              {keep && (
                <p>Read notices clear after {keep.read_days} days, unread after {keep.unread_days}.</p>
              )}
              <Link to="/profile" onClick={() => closeTray(false)}>
                Send these to your phone
                <ArrowRight size={12} aria-hidden="true" />
              </Link>
            </footer>
          )}
        </div>

        <button
          type="button"
          className="staff-notices-pull"
          aria-label="Put the notices away"
          onPointerDown={onPullDown}
          onPointerMove={onPullMove}
          onPointerUp={onPullEnd}
          onPointerCancel={onPullEnd}
          onClick={onPullClick}
        >
          <span aria-hidden="true" />
        </button>
      </aside>
    </>,
    document.body,
  );
}

/**
 * One notice.
 *
 * The row's main area is the link when there is one — following is the job —
 * and a disclosure button when there is not: a broadcaster that predates links
 * still gets a row that does something, which is to show the rest of its body
 * and count as read.
 *
 * The right-hand column holds the age, and on a fine pointer the row controls
 * take the age's place on hover (DESIGN §4). The column is sized for the
 * controls whether or not they are showing, so the row never reflows under the
 * cursor and turns a mis-click into a click on the wrong notice.
 */
function NoticeRow({
  n, i, leaving, expanded, onFollow, onToggle, onMarkRead, onDismiss,
}) {
  const { title, tone: markTone } = readTitle(n.title);
  const tone = toneFor(n.kind, markTone);
  const body = readBody(n.body, n.title);
  const Icon = KIND_ICON[n.kind] || Bell;
  const unread = !n.read_at;
  const href = hrefFor(n.link);
  const where = destinationFor(href);
  // Worth offering "more" only when the clamp could have cut something.
  const long = !href && (body.length > 140 || body.split('\n').length > 3);

  const content = (
    <>
      <span className="staff-notice-mark" aria-hidden="true"><Icon size={16} /></span>
      <span className="staff-notice-text">
        <span className="staff-notice-title">{title}</span>
        {body && <span className="staff-notice-body">{body}</span>}
        <span className="staff-notice-meta">
          <span className="staff-notice-kind">{kindLabel(n.kind)}</span>
          {/* How many times this fired while nobody read it. The server
              collapses repeats into one row rather than stacking them — a
              scanner that re-alerts every tick until somebody acts is right
              to, and on a persistent board that was 24 identical rows. Shown,
              because collapsing without it would make the board quietly lie
              about how often something is happening. */}
          {n.repeats > 1 && (
            <span className="staff-notice-repeats" title={`Fired ${n.repeats} times while unread`}>
              ×{n.repeats}
            </span>
          )}
          {where && (
            <span className="staff-notice-go">
              {where}
              <ArrowRight size={12} aria-hidden="true" />
            </span>
          )}
          {long && <span className="staff-notice-go">{expanded ? 'Show less' : 'Read all'}</span>}
        </span>
      </span>
    </>
  );

  return (
    <li
      className="staff-notice"
      data-read={unread ? 'no' : 'yes'}
      data-tone={tone || 'none'}
      data-expanded={expanded ? 'yes' : 'no'}
      data-leaving={leaving ? 'yes' : 'no'}
      style={{ '--i': i }}
    >
      <div className="staff-notice-inner">
        {href ? (
          <Link className="staff-notice-main" to={href} onClick={() => onFollow(n)}>
            {content}
          </Link>
        ) : (
          <button
            type="button"
            className="staff-notice-main"
            aria-expanded={long ? expanded : undefined}
            onClick={() => onToggle(n)}
          >
            {content}
          </button>
        )}
        <span className="staff-notice-side">
          <time
            className="staff-notice-age"
            dateTime={n.created_at}
            title={new Date(n.created_at).toLocaleString()}
          >
            {ago(n.created_at)}
          </time>
          <span className="staff-notice-acts">
            {unread && (
              <button
                type="button"
                className="staff-notice-act"
                title="Mark read"
                aria-label={`Mark read: ${title}`}
                onClick={() => onMarkRead(n)}
              >
                <Check size={15} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              className="staff-notice-act staff-notice-act-dismiss"
              title="Dismiss"
              aria-label={`Dismiss: ${title}`}
              onClick={() => onDismiss(n)}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </span>
        </span>
      </div>
    </li>
  );
}
