import { Suspense } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useState, useEffect } from 'react';
import { canAccessAdminPath } from '../../utils/adminPermissions';
import BackgroundEffects from '../effects/BackgroundEffects';
import ErrorBoundary from '../ErrorBoundary';
import RouteFallback from '../RouteFallback';
import {
  LayoutDashboard, Package, ShoppingBag, Users, Settings, Gauge,
  Mail, AlertTriangle, ArrowLeft, Palette, Menu, X, Headphones,
  Tag, Link2, Activity, BarChart2, Zap, CreditCard, Star, MessageSquare, Server, KeyRound, Landmark,
  Fingerprint, Route, PackageCheck, MapPin, ShieldAlert, Send, Map, ClipboardCheck, ClipboardList,
  BadgeCheck, Bird, Sparkles, Megaphone } from 'lucide-react';
import { STORE_PAGES, adminPagePath } from '../../config/storePages';
import { watchNoAutofill } from '../../utils/noAutofill';
import AdminSearch from '../admin/AdminSearch';
import AdminCompanion from '../ai/AdminCompanion';
import { StaffNoticesProvider, NoticesBell } from '../admin/StaffNotices';

/**
 * The sidebar, grouped.
 *
 * Twenty flat links is a list to be read rather than a menu to be used — every
 * visit means scanning the whole thing. Grouping by what the operator is
 * actually doing (selling, serving customers, taking money, running the shop)
 * turns most visits into "which of four sections", which is a glance.
 *
 * Order within a group is by how often it is reached, not alphabetically.
 * A group whose items are all permission-filtered away hides its heading too.
 *
 * Labels are sentence case — "Rate limits", "Ship desk" — because that is how
 * the pages head themselves and how the assistant's manual names them, and a
 * link that says "Rate Limits" over a page that says "Rate limits" reads as
 * two things. The two that stay capitalised are names: Cash in Mail, Zelle.
 */
const navGroups = [
  {
    label: 'Overview',
    items: [
      { path: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard', exact: true },
      { path: '/admin/analytics', icon: BarChart2, label: 'Analytics' },
      // Under Overview rather than beside Invite Links: this is a report, and
      // the person opening it is asking "did the campaign work", not "issue me
      // a code". The two pages link to each other, which is what makes the
      // split navigable rather than a place to lose a link.
      { path: '/admin/marketing', icon: Megaphone, label: 'Marketing' },
      { path: '/admin/risk', icon: ShieldAlert, label: 'Risk board' },
      { path: '/admin/audit-log', icon: Activity, label: 'Audit log' },
    ],
  },
  {
    label: 'Catalog',
    items: [
      { path: '/admin/products', icon: Package, label: 'Products' },
      { path: '/admin/flash-sales', icon: Zap, label: 'Flash sales' },
      { path: '/admin/coupons', icon: Tag, label: 'Coupons' },
      { path: '/admin/reviews', icon: MessageSquare, label: 'Reviews' },
      { path: '/admin/catalog-health', icon: ClipboardCheck, label: 'Catalogue health' },
    ],
  },
  {
    // Its own group rather than three more entries under Customers. A packer
    // holding only `orders.pick` sees this section and nothing else in the
    // sidebar, which is the whole point of the grant — the screens name
    // products and shelves, never a buyer.
    label: 'Fulfilment',
    items: [
      { path: '/admin/pack', icon: PackageCheck, label: 'Packing' },
      { path: '/admin/ship', icon: Send, label: 'Ship desk' },
      { path: '/admin/manifest', icon: ClipboardList, label: 'Manifest' },
      { path: '/admin/pull-list', icon: Route, label: 'Pull list' },
      // `needsWarehouse` — absent on a shop that has turned the shelf system
      // off (utils/warehouseEnabled.js), because every screen behind these
      // three is about a bin location and the routes themselves 404. Absent
      // rather than greyed, the same rule `AdminSearch` applies to a page the
      // viewer cannot reach: a disabled row still advertises a feature and
      // still invites a press that goes nowhere.
      //
      // Stock Ops stays: receiving goods raises a quantity with or without a
      // shelf to put them on, and the page's counting half hides itself.
      { path: '/admin/shelves', icon: MapPin, label: 'Shelves', needsWarehouse: true },
      { path: '/admin/stock', icon: ClipboardCheck, label: 'Stock ops' },
      { path: '/admin/warehouse', icon: Map, label: 'Warehouse', needsWarehouse: true },
    ],
  },
  {
    label: 'Customers',
    items: [
      { path: '/admin/orders', icon: ShoppingBag, label: 'Orders' },
      { path: '/admin/users', icon: Users, label: 'Users' },
      { path: '/admin/support', icon: Headphones, label: 'Support' },
      { path: '/admin/disputes', icon: AlertTriangle, label: 'Disputes' },
      { path: '/admin/tiers', icon: Star, label: 'VIP tiers' },
      { path: '/admin/invite-links', icon: Link2, label: 'Invite links' },
    ],
  },
  {
    label: 'Money',
    items: [
      { path: '/admin/cash-mail', icon: Mail, label: 'Cash in Mail' },
      { path: '/admin/zelle', icon: Landmark, label: 'Zelle' },
      { path: '/admin/store-credit', icon: CreditCard, label: 'Store credit' },
      // Node work is permission-gated like everything else: nodes.view to watch
      // sync, and separate grants for configuring, unlocking and spending.
      { path: '/admin/nodes', icon: Server, label: 'Nodes' },
    ],
  },
  {
    // The configuration pages. Settings leads: it is the hub the rest hang
    // off — its last block links to every one of them — and the one opened
    // most. The others follow by how often they are reached, not by name.
    label: 'Store',
    items: [
      { path: '/admin/settings', icon: Settings, label: 'Settings' },
      { path: '/admin/theme', icon: Palette, label: 'Theme' },
      { path: '/admin/ai', icon: Sparkles, label: 'AI' },
      { path: '/admin/pgp', icon: Fingerprint, label: 'PGP key' },
      { path: '/admin/limits', icon: Gauge, label: 'Rate limits' },
      { path: '/admin/api-keys', icon: KeyRound, label: 'API keys' },
    ],
  },
  {
    // Its own section rather than one "Pages" link with tabs inside it. Four
    // pages behind one link means the sidebar cannot say which of them is
    // open, cannot say which are published, and cannot be linked to — the
    // tab bar was a second navigation duplicating this one badly. Built from
    // the roster so a new page appears here and in the router together.
    label: 'Pages',
    items: [
      // The home page is a store page like the rest of this section, and it
      // sits first because it is the one a visitor lands on. It keeps its own
      // route for permission purposes rather than borrowing '/admin/pages':
      // it is not built from the page_ roster and its grant is its own.
      { path: '/admin/home', icon: BadgeCheck, label: 'Home page' },
      ...STORE_PAGES.map((p) => ({
        path: adminPagePath(p.key),
        icon: p.icon,
        label: p.label,
        // Every page_ key resolves to settings.store on write, so one grant
        // covers the whole section — the same one the single link needed.
        permissionPath: '/admin/pages',
      })),
      // The warrant canary is a page a visitor reads (/canary, public and
      // outside every gate, exactly like the privacy policy), so it lives
      // with the pages rather than among the store's machinery — it used to
      // sit under Store beside the PGP key that signs it, which is how it is
      // built, not what it is for. Its grant stays settings.pgp: publishing a
      // signed statement is the key holder's act, not the copywriter's.
      { path: '/admin/canary', icon: Bird, label: 'Canary' },
    ],
  },
];

/**
 * How long the glow stays on a setting the search sent you to.
 *
 * Long enough to find with your eyes after the scroll settles, short enough
 * that it is gone before it becomes part of the furniture. It also clears on
 * the next navigation, so a highlight can never outlive the page it describes.
 */
const HIGHLIGHT_MS = 2600;

/**
 * Resolve `?hl=<target>` to an element, scroll to it, and glow it.
 *
 * Lives here rather than in each page because every admin route already renders
 * inside this layout, and the alternative is twenty-eight copies of the same
 * effect — the shape CLAUDE.md warns about, in the client. A page opts in by
 * having an element the resolver can find; it writes no code.
 *
 * Three selectors, narrowest first:
 *
 *   [data-search-target]     annotated explicitly for this search
 *   [data-settings-section]  a Settings card — these already existed
 *   #id                       any control with that id, which most of the
 *                             Settings page's inputs already have
 *
 * ── The two attribute matches are case-INSENSITIVE, and that is the point ───
 *
 * A Settings card is addressed by its TITLE — `?hl=Live chat` — and a title is
 * prose. Prose gets reworded. Within a fortnight this file's own section names
 * went "Live Chat" → "Live chat" → "Live Chat" → "Live chat", and every link
 * pointing at one silently stopped working each time: a `?hl=` that matches
 * nothing does not error, so the page loads, the rail sits where it was, and
 * the control the link promised to point at is simply not lit. The link looks
 * like it worked and did half its job.
 *
 * `[attr="v" i]` closes the axis the rewording actually moves along. It does
 * NOT make every rename safe, deliberately — "Payments" against a card called
 * "Payment methods" still finds nothing, and should, because that is a link
 * aimed at a section that no longer exists by that name.
 * `client/test/nextStops.test.mjs` compares under the same rule, so a link this
 * resolver would fail on fails the suite rather than the operator.
 *
 * `getElementById` stays case-SENSITIVE and is not a gap: an id is a code
 * identifier chosen by whoever wrote the input, not a sentence somebody
 * rewrites for tone, and the DOM offers no case-insensitive id lookup that is
 * not a full scan.
 *
 * The retry loop is the load-bearing part. The destination page fetches its own
 * settings before it renders anything, so at the moment the URL changes the
 * target does not exist yet; a single querySelector would find nothing and the
 * feature would work only when navigating within a page already open. It gives
 * up rather than polling forever, because a target that never appears means a
 * stale link and the honest response to that is to land on the page and stop.
 */
function useSearchHighlight() {
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const target = params.get('hl');
    // A coarser target for when the precise one renders conditionally — the
    // Monero daemon fields only exist once XMR RPC is on, which is not the
    // state a store is in when its operator goes looking for them.
    const fallback = params.get('hl2');
    if (!target && !fallback) return undefined;

    let cancelled = false;
    let glowTimer;
    let found;
    let attempts = 0;

    const esc = (v) => ((window.CSS && CSS.escape) ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&'));
    // The ` i` flag sits after the closing quote and before the bracket. See
    // the header for why the attribute matches are case-insensitive and the id
    // lookup is not.
    const locate = (v) => v && (
      document.querySelector(`[data-search-target="${esc(v)}" i]`)
      || document.querySelector(`[data-settings-section="${esc(v)}" i]`)
      || document.getElementById(v)
    );

    const tick = () => {
      if (cancelled) return;
      // The precise target for most of the retry budget, so a slow page still
      // gets the exact control rather than settling for its card. Only once it
      // is clear the target is not coming does the fallback take over —
      // otherwise a fast-rendering card would always beat the field inside it.
      found = locate(target) || (attempts > 20 ? locate(fallback) : null);

      if (found) {
        // `center` rather than `start`: a setting pinned to the top edge of the
        // viewport reads as cropped, and the label above it is often the half
        // that says what it does.
        //
        // The scroll is forced INSTANT by suspending the global
        // `scroll-behavior: smooth` for one frame, and that is not a
        // preference. Arriving on a new route starts the browser's own smooth
        // scroll back to the top; because the stylesheet makes every scroll on
        // the root animated, that animation is still running when this fires
        // several hundred milliseconds later, and it finishes LAST. The result
        // was a correctly glowing element sitting off-screen with the page
        // parked at the top — measured repeatedly: scrollTop went to 729 and
        // back to 0. Assigning under `auto` cancels the in-flight animation
        // rather than queueing behind it.
        const root = document.documentElement;
        const previous = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        found.scrollIntoView({ block: 'center' });
        // Restored on the next frame, so ordinary in-page anchors keep the
        // smooth scrolling the stylesheet asks for.
        requestAnimationFrame(() => { root.style.scrollBehavior = previous; });
        found.classList.add('admin-search-hit');
        glowTimer = setTimeout(() => found.classList.remove('admin-search-hit'), HIGHLIGHT_MS);
        // Drop the parameter once it has been honoured, so a refresh does not
        // glow again and the URL the operator copies is just the page.
        //
        // `history.replaceState`, NOT `navigate(..., { replace: true })`. The
        // router version re-renders the route, and that re-render lands in the
        // middle of the smooth scroll above and puts the page back at the top —
        // so the glow was applied correctly to an element the operator could
        // not see. Measured: scrollTop went to 729 and back to 0 before the
        // animation finished. Nothing else reads this parameter once it has
        // been consumed, so bypassing the router is the whole fix.
        window.history.replaceState(
          window.history.state, '', `${location.pathname}${location.hash}`,
        );
        return;
      }
      // ~2s of retries at a frame-ish cadence. Long enough for a settings fetch
      // on a slow link, short enough not to fire into a page the operator has
      // since navigated away from.
      if (attempts++ < 60) setTimeout(tick, 32);
    };
    tick();

    return () => {
      cancelled = true;
      clearTimeout(glowTimer);
      found?.classList.remove('admin-search-hit');
    };
  }, [location.search, location.pathname, location.hash]);
}

/**
 * The notices provider sits above the whole shell because the shell has two
 * bells — the rail's and the phone top bar's — and they must share one count,
 * one list and one tray. Mounted inside `AdminShell`'s header instead, it was
 * two components with two states, and every navigation fetched the count twice.
 */
export default function AdminLayout() {
  return (
    <StaffNoticesProvider>
      <AdminShell />
    </StaffNoticesProvider>
  );
}

/*
 * ── Why the rail's parts are module-level components ────────────────────────
 *
 * `NavLinks` and `SidebarHeader` used to be arrow functions declared INSIDE the
 * shell's render. Every render therefore minted a new component type, and React
 * treats a new type as a different component: it unmounts the old subtree and
 * mounts a fresh one. The shell re-renders on every route change — it reads
 * `useLocation` — so every navigation threw away and rebuilt the settings
 * search, the AI status line, the notices bell and every nav link, in the rail
 * and in the drawer both.
 *
 * Measured in the browser before the fix, clicking Dashboard → Analytics: the
 * Analytics link and the search input both came back as NEW nodes, a query
 * typed into the search was gone, and neither link's `::before` ran a
 * transition. So the active marker's spring in `43-admin-sidebar.css` — "snaps
 * into a detent" — had never played: a link that mounts already `.active` has
 * no earlier state to transition from.
 *
 * Declared out here the types are stable, and React updates the same nodes: the
 * marker leaves the old link and springs into the new one, and the search keeps
 * what was typed until a result is chosen (`AdminSearch.go` clears it then, on
 * purpose). Everything they used to close over from the shell's render arrives
 * as props instead. Do not move them back inside for convenience — nothing
 * errors when you do; the rail just quietly starts rebuilding itself again.
 */

/**
 * The desktop rail has no drawer to close, so its links and its search take
 * this as `onClose`. One identity for the life of the module, where an inline
 * `() => {}` would be a new function each render and churn the `useCallback`
 * that `AdminSearch` keeps it in.
 */
const noop = () => {};

/** The search and the grouped links — one component for the rail and the drawer. */
function NavLinks({ groups, pathname, onClose }) {
  return (
    <>
      {/* Above the groups on purpose: it is the fastest route to any setting,
          and burying it under twenty links would make it the slowest. */}
      <AdminSearch onNavigate={onClose} />
      <nav className="admin-nav">
        {groups.map(group => (
          <div className="admin-nav-group" key={group.label}>
            <div className="admin-nav-group-label">{group.label}</div>
            {group.items.map(item => {
              const active = item.exact
                ? pathname === item.path
                : pathname.startsWith(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  className={`admin-nav-link${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <item.icon size={17} aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="admin-nav-foot">
        <Link to="/" onClick={onClose} className="admin-nav-link admin-nav-back">
          <ArrowLeft size={16} aria-hidden="true" /> Back to store
        </Link>
      </div>
    </>
  );
}

// `withBell` is for the rail's head only. The drawer's copy of this header
// goes without, because a phone now carries its bell in the top bar where it
// is always visible — the drawer's used to be the only one a phone had, and
// it could not be seen until the menu was opened for some other reason.
function SidebarHeader({ storeName, withBell = false }) {
  return (
    <div className="admin-sidebar-head">
      <div className="admin-sidebar-title-row">
        <div>
          <div className="admin-sidebar-store">{storeName}</div>
          <div className="admin-sidebar-kicker">Admin Panel</div>
        </div>
        {/* Everything `services/staffNotify.js` broadcasts, for the staff
            member who never linked a chat bot — which was, until this
            existed, everything they never heard about. */}
        {withBell && <NoticesBell variant="rail" />}
      </div>
      {/* The AI subsystem's status light. Renders nothing at all unless this
          person may see AI settings and the feature is on — see the component,
          which also explains why it costs no extra request. It re-reads its
          status on `location.pathname` itself, so it never depended on being
          remounted to stay current. */}
      <AdminCompanion />
    </div>
  );
}

function AdminShell() {
  useSearchHighlight();
  // The browser's form-filler was injecting the operator's own store login into
  // the RPC password on Nodes, the carrier secrets on the tracking settings and
  // the key passphrases on PGP — the fields declaring `autocomplete="off"`
  // included, because browsers ignore `off` on a password input. One pass over
  // the shell covers every desk, including the ones not written yet and the
  // trays that portal out to the body. See utils/noAutofill.js; removing this
  // line turns the filling back on everywhere at once and nothing will say so.
  useEffect(() => watchNoAutofill(document.body), []);
  const location = useLocation();
  const { user } = useAuth();
  const { settings } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const storeName = settings.store_name || 'CryptoStore';
  // Absent means on: the key ships as 'true' and a payload that predates it
  // must not hide three pages. Same defaulting as the server's `getBool`.
  const shelves = settings.warehouse_enabled !== 'false';
  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => (!item.adminOnly || user?.role === 'admin')
          && (!item.needsWarehouse || shelves)
          // `permissionPath` exists for groups whose several routes share one
          // grant: the permission map keys on the page, not on each of its
          // four editors.
          && canAccessAdminPath(user, item.permissionPath || item.path)
      ),
    }))
    .filter((group) => group.items.length > 0);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  return (
    <div className="admin-layout">
      {/* One rule for what the store paints behind itself, shared with the
          other layout — see components/effects/BackgroundEffects.jsx. */}
      <BackgroundEffects />
      {/* Desktop sidebar */}
      <aside className="admin-sidebar">
        <SidebarHeader storeName={storeName} withBell />
        <NavLinks groups={visibleGroups} pathname={location.pathname} onClose={noop} />
      </aside>

      {/* Mobile top bar */}
      <div className="admin-topbar glass-plate">
        <button
          className="glass-btn admin-menu-btn"
          onClick={() => setDrawerOpen(v => !v)}
          aria-label="Open admin menu"
        >
          {drawerOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <div className="admin-topbar-title">
          {storeName}
          <span className="admin-topbar-kicker">Admin</span>
        </div>
        <NoticesBell variant="bar" />
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="admin-drawer-backdrop" onClick={() => setDrawerOpen(false)} />
      )}
      <div className={`admin-drawer${drawerOpen ? ' admin-drawer-open' : ''}`}>
        <SidebarHeader storeName={storeName} />
        <NavLinks
          groups={visibleGroups}
          pathname={location.pathname}
          onClose={() => setDrawerOpen(false)}
        />
      </div>

      {/* Main content */}
      <main className="admin-main">
        {/* Same reasoning as the storefront shell: a bench that throws keeps
            the sidebar, so staff can reach another desk instead of reloading
            a blank panel. The admin variant offers admin destinations — a
            crashed pack bench should not send a picker to the catalogue. */}
        {/* The desks are code-split (App.jsx), so this is where a bench
            arriving is shown. Inside the boundary and inside <main>, so the
            sidebar stays and staff can still reach another desk while one
            loads — the same argument the boundary itself makes. */}
        <ErrorBoundary variant="admin">
          <Suspense fallback={<RouteFallback label="Opening…" />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
