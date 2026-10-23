import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './context/AuthContext';
import { useTheme } from './context/ThemeContext';
import AgeGate from './components/AgeGate';
import { useRouteHead } from './hooks/useDocumentHead';

import Layout from './components/Layout/Layout';
import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Products from './pages/Products';
import ProductDetail from './pages/ProductDetail';
import Cart from './pages/Cart';

import NotFound from './pages/NotFound';
import { getDefaultAdminPath, hasAdminPermission } from './utils/adminPermissions';
import { STORE_PAGES, adminPagePath } from './config/storePages';
import RefCapture from './components/RefCapture';
import PwaUpdatePrompt from './components/PwaUpdatePrompt';
import SessionRetry from './components/SessionRetry';
import RouteFallback from './components/RouteFallback';

/**
 * ── What ships in the first download, and what arrives when it is asked for ─
 *
 * Every page used to be a static import, so the bundle was one 2.3 MB file
 * (623 KB gzipped) and a shopper opening a product page downloaded the packing
 * bench, the warehouse map, the risk board, the analytics charts and the theme
 * editor in order to look at it. On a clearnet shop that is merely wasteful.
 * On the deployment this project is actually for — a buyer on Tor, on a
 * filtered network, on a phone — it is most of the wait before anything
 * renders at all, and CLAUDE.md is explicit that this is the buyer to design
 * for.
 *
 * The split is by AUDIENCE rather than by page size:
 *
 * - **Eager** is the shell and the path a shopper walks: Layout, Home, Login,
 *   Register, Products, ProductDetail, Cart. Those are reached in sequence and
 *   often quickly, and a chunk fetch between the catalogue and a product is a
 *   round trip Tor charges real time for. They stay in the entry chunk so that
 *   walk costs none.
 * - **Lazy** is everything else: the whole admin console, and the storefront
 *   leaves a person goes to deliberately rather than passes through — orders,
 *   support, wishlist, receipts, the operator's own pages.
 *
 * Checkout was eager and is not any more, and it is the one page where the rule
 * above is worth restating rather than applying. It is ~80 KB, and unlike the
 * catalogue walk it is not passed through: a person arrives at it having
 * decided to buy, which is the single moment in the shop where one more round
 * trip is least noticed — and it is reached by a small fraction of the visitors
 * who were paying for it. The measurement that prompted this found three such
 * passengers in the entry chunk: Checkout, the shader library and the AI
 * companion, the last two for features that are OFF on a default store. The
 * other two are now fetched at the moment they are wanted; see
 * `components/effects/useShaderSource.js` and `components/ai/BuddySlot.jsx`.
 *
 * `AgeGate`, `RefCapture`, `PwaUpdatePrompt` and `SessionRetry` stay eager
 * despite being small and conditional. `SessionRetry` in particular is
 * rendered BY the auth guards below, so splitting it would put a Suspense
 * boundary inside every guard for the sake of a few lines.
 *
 * Two things that make this safe rather than merely smaller. The fallback
 * lives inside the two layout shells rather than around `<Routes>` (see
 * Layout.jsx), so a page arriving keeps the navbar, sidebar and footer on
 * screen instead of blanking the app. And the service worker precaches every
 * emitted chunk — client/pwa-build.js already filters on `assets/` for exactly
 * this reason — so an installed app stays complete offline and an update stays
 * all-or-nothing. Splitting changes WHEN the bytes arrive, never whether they
 * do.
 */
const AdminApiKeys       = lazy(() => import('./pages/admin/ApiKeys'));
const AdminAuditLog      = lazy(() => import('./pages/admin/AuditLog'));
const AdminCanary        = lazy(() => import('./pages/admin/Canary'));
const AdminCashMail      = lazy(() => import('./pages/admin/CashMail'));
const AdminCoupons       = lazy(() => import('./pages/admin/Coupons'));
const AdminDashboard     = lazy(() => import('./pages/admin/Dashboard'));
const AdminDisputes      = lazy(() => import('./pages/admin/Disputes'));
const AdminInviteLinks   = lazy(() => import('./pages/admin/InviteLinks'));
const AdminLayout        = lazy(() => import('./components/Layout/AdminLayout'));
const AdminMarketing     = lazy(() => import('./pages/admin/Marketing'));
const AdminNodes         = lazy(() => import('./pages/admin/Nodes'));
const AdminNotFound      = lazy(() => import('./pages/admin/NotFound'));
const AdminOrders        = lazy(() => import('./pages/admin/Orders'));
const AdminPgpKeys       = lazy(() => import('./pages/admin/PgpKeys'));
const AdminProductEdit   = lazy(() => import('./pages/admin/ProductEdit'));
const AdminProducts      = lazy(() => import('./pages/admin/Products'));
const AdminSettings      = lazy(() => import('./pages/admin/Settings'));
const AdminSupport       = lazy(() => import('./pages/admin/Support'));
const AdminTheme         = lazy(() => import('./pages/admin/Theme'));
const AdminUsers         = lazy(() => import('./pages/admin/Users'));
const AdminZelleAccounts = lazy(() => import('./pages/admin/ZelleAccounts'));
const AiSettings         = lazy(() => import('./pages/admin/AiSettings'));
const Analytics          = lazy(() => import('./pages/admin/Analytics'));
// Checkout is ~80 KB and is reached by a fraction of visitors, always after a
// deliberate decision — the one moment in the shop where a page arriving a tick
// late costs nothing and the bytes not sent to everyone else cost a lot. Cart
// stays eager: it is one tap from the navbar on every page.
const Checkout           = lazy(() => import('./pages/Checkout'));
const CanaryPublic       = lazy(() => import('./pages/Canary'));
const CatalogHealth      = lazy(() => import('./pages/admin/CatalogHealth'));
const FlashSales         = lazy(() => import('./pages/admin/FlashSales'));
const HomePromises       = lazy(() => import('./pages/admin/HomePromises'));
const LabResults         = lazy(() => import('./pages/LabResults'));
const Limits             = lazy(() => import('./pages/admin/Limits'));
const LiveChat           = lazy(() => import('./components/LiveChat'));
const Manifest           = lazy(() => import('./pages/admin/Manifest'));
const Membership         = lazy(() => import('./pages/Membership'));
const Onboarding         = lazy(() => import('./components/onboarding/Onboarding'));
const OrderDetail        = lazy(() => import('./pages/OrderDetail'));
const OrderReceipt       = lazy(() => import('./pages/OrderReceipt'));
const Orders             = lazy(() => import('./pages/Orders'));
const PackOrder          = lazy(() => import('./pages/admin/PackOrder'));
const Profile            = lazy(() => import('./pages/Profile'));
const PullList           = lazy(() => import('./pages/admin/PullList'));
const Reviews            = lazy(() => import('./pages/admin/Reviews'));
const RiskBoard          = lazy(() => import('./pages/admin/RiskBoard'));
const Shelves            = lazy(() => import('./pages/admin/Shelves'));
/**
 * The shelf switch's gate, lazy like everything else under /admin.
 *
 * It was a static import and that put `components/admin/ShelvesOff` — and
 * `PageHeader` with it — into the entry chunk every storefront visitor
 * downloads, which `test/routeSplit.test.mjs` exists to refuse. A named export
 * needs the `.then` remap because `lazy()` takes a module whose DEFAULT is the
 * component; `ShelvesOff` itself is that default, and the gate is the named one
 * beside it.
 */
const ShelfGate = lazy(() => import('./components/admin/ShelvesOff').then((m) => ({ default: m.ShelfGate })));
const ShipDesk           = lazy(() => import('./pages/admin/ShipDesk'));
const StockOps           = lazy(() => import('./pages/admin/StockOps'));
const StoreCreditLedger  = lazy(() => import('./pages/admin/StoreCreditLedger'));
const StorePage          = lazy(() => import('./pages/StorePage'));
const StorePageEditor    = lazy(() => import('./pages/admin/StorePageEditor'));
const SubUsers           = lazy(() => import('./pages/SubUsers'));
const Support            = lazy(() => import('./pages/Support'));
const SupportTicket      = lazy(() => import('./pages/SupportTicket'));
const Tiers              = lazy(() => import('./pages/admin/Tiers'));
const WarehouseMap       = lazy(() => import('./pages/admin/WarehouseMap'));
const Wishlist           = lazy(() => import('./pages/Wishlist'));

/**
 * What every guard below renders when there is no confirmed user.
 *
 * ── Why one component and not a line in each guard ─────────────────────────
 *
 * Every guard used to end in `<Navigate to="/login" />` on `!user`, and `!user`
 * meant two different things: signed out, or signed in but the store could not
 * be asked — a 429 from the rate limiter, a dropped Tor circuit, a restart. The
 * second sent people to the sign-in form holding a valid token (seen on the dev
 * store: `/auth/me` answered 429, the admin panel landed on /login, and the
 * same token read 200 a minute later).
 *
 * `AuthContext` now tells the two apart as `unconfirmed`, and this is the one
 * place the difference is acted on. A guard added later that reaches for "not
 * signed in" gets both halves by writing the line the others write, instead of
 * copying a `<Navigate>` and quietly bringing the bounce back.
 */
function NotSignedIn() {
  const { unconfirmed } = useAuth();
  if (unconfirmed) return <SessionRetry />;
  return <Navigate to="/login" replace />;
}

function RequireAuth({ children, roles }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <NotSignedIn />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

/**
 * A page a signed-out visitor may see when the store allows guest browsing.
 *
 * Only the catalog is ever opened this way. Anything that reads or writes an
 * account — cart, checkout, orders, wishlist, support — stays behind
 * `RequireAuth`, so turning guest browsing on widens what can be *looked at*
 * and nothing else. The server is unchanged by this toggle: the product
 * endpoints were already public (`optionalAuth`), which is also why guest
 * pricing correctly omits per-account tier discounts.
 */
function BrowsePage({ children }) {
  const { user, loading } = useAuth();
  const { settings, loaded } = useTheme();

  // Waiting on either avoids a flash of the login redirect for a guest whose
  // settings have not landed yet.
  if (loading || !loaded) return null;
  if (user) return children;
  // A guest-browsing store keeps showing the shelf to somebody whose session
  // is unconfirmed rather than swapping it for the retry card: every product
  // request still carries their token, so the server prices them as
  // themselves, and the check keeps running behind the page until it lands.
  if (settings.allow_guest_browsing === 'true') return children;
  return <NotSignedIn />;
}

/**
 * The age gate covers the storefront only. The admin panel already sits behind
 * a login, and re-asking staff on every browser turns a customer-facing notice
 * into an obstacle for the person configuring it.
 */
function StorefrontAgeGate() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/admin')) return null;
  return <AgeGate />;
}

/**
 * The introduction, for an account that has not been through it.
 *
 * ── Why it is gated here and not inside the component ───────────────────────
 *
 * Same shape as the age gate above, and for the same two reasons. It is
 * storefront-only — an operator setting a shop up spends their day at /admin
 * and being handed a buyer's tour of their own store every time they open it
 * would be an obstacle, not an introduction — and it is decided in one place,
 * so there is no second surface that can forget to ask.
 *
 * `onboarding_complete` rides `/auth/me`, so `loading` is the only wait: by
 * the time the shell renders anything the answer is already here, and there is
 * no frame in which the catalogue is visible to somebody who has not been
 * introduced to it.
 *
 * It renders BELOW the age gate deliberately (z-index 8500 against 9000). A
 * visitor whose age acknowledgement has expired must answer that first; a shop
 * tour on top of the gate would be the shop letting them in.
 */
function StorefrontOnboarding() {
  const { pathname } = useLocation();
  const { user, loading } = useAuth();
  if (loading || !user) return null;
  if (user.onboarding_complete !== false) return null;
  if (pathname.startsWith('/admin')) return null;
  // `null` while it loads, deliberately. This is an overlay over a page the
  // person can already read; a progress bar on top of it would be the tour
  // interrupting twice.
  return <Suspense fallback={null}><Onboarding /></Suspense>;
}

/**
 * The sub-user panel, for somebody who is not themselves a sub-user.
 *
 * An account created through another buyer's invite buys at that buyer's
 * price and cannot run a programme of its own — one level, not a tree, and
 * `server/utils/subUserAccess.js` holds the argument about why the price
 * engine and the reward module cannot answer the question a chain would ask
 * them. Every route behind this page enforces it server-side; this is what
 * stops the page rendering a panel whose every request would 403.
 *
 * Sends them home rather than drawing an explanation, because the navbar and
 * the mobile menu do not offer the link to them either: the only way to be
 * here is a bookmark from before, or a URL typed by hand, and a page that
 * exists solely to say "not for you" is a page in the way. The assistant
 * answers the question in words if they ask it (services/ai/topics/account.js).
 */
function RequireNotSubUser({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <NotSignedIn />;
  if (user.is_sub_user) return <Navigate to="/" replace />;
  return children;
}

function RequireAdminPermission({ children, permission }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <NotSignedIn />;
  if (!['admin', 'manager'].includes(user.role)) return <Navigate to="/" replace />;
  if (hasAdminPermission(user, permission)) return children;

  const fallback = getDefaultAdminPath(user);
  return <Navigate to={fallback || '/'} replace />;
}

function AdminIndexRedirect() {
  const { user, loading } = useAuth();

  if (loading) return null;
  const fallback = getDefaultAdminPath(user);
  return <Navigate to={fallback || '/'} replace />;
}

export default function App() {
  // The document's head — tab title, description, robots directive and
  // canonical link — follows the route from here, for EVERY route. It sat in
  // the storefront Layout first, which left the admin shell with no route
  // layer at all: a cold load of /admin/settings resolved as the home page
  // and wrote "index, follow" over the noindex the server had served.
  useRouteHead();
  return (
    <>
      <PwaUpdatePrompt />
      <Toaster
        position="top-right"
        toastOptions={{
          className: 'glass-toast',
          success: { iconTheme: { primary: 'var(--success)', secondary: 'var(--bg)' } },
          error:   { iconTheme: { primary: 'var(--danger)',  secondary: 'var(--bg)' } },
        }}
      />
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route path="login" element={<Login />} />
          <Route path="register" element={<Register />} />
          <Route index element={<BrowsePage><Home /></BrowsePage>} />
          <Route path="products" element={<BrowsePage><Products /></BrowsePage>} />
          <Route path="products/:id" element={<BrowsePage><ProductDetail /></BrowsePage>} />
          <Route path="cart" element={<RequireAuth><Cart /></RequireAuth>} />
          <Route path="checkout" element={<RequireAuth><Checkout /></RequireAuth>} />
          <Route path="orders" element={<RequireAuth><Orders /></RequireAuth>} />
          <Route path="orders/:id" element={<RequireAuth><OrderDetail /></RequireAuth>} />
          <Route path="profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route path="support" element={<RequireAuth><Support /></RequireAuth>} />
          <Route path="support/:id" element={<RequireAuth><SupportTicket /></RequireAuth>} />
          <Route path="wishlist" element={<RequireAuth><Wishlist /></RequireAuth>} />
          <Route path="subusers" element={<RequireAuth><RequireNotSubUser><SubUsers /></RequireNotSubUser></RequireAuth>} />
          {/* The panel was called "referral" until the product settled on
              sub-users as the one name for these accounts. The old path stays
              forever: invite links, bookmarks and the footer links stored in
              store_settings all point at it, and a rename that 404s an
              operator's own link is a rename that gets reverted. */}
          <Route path="referral" element={<Navigate to="/subusers" replace />} />
          <Route path="membership" element={<RequireAuth><Membership /></RequireAuth>} />
          <Route path="orders/:uuid/receipt" element={<RequireAuth><OrderReceipt /></RequireAuth>} />
          {/* Operator-authored pages. Deliberately outside RequireAuth AND
              outside the guest-browsing gate: a privacy policy exists for
              exactly the visitor who has not signed up yet. Disabled pages
              404 server-side, so mounting the routes reveals nothing.

              Mounted from the roster rather than listed, so a page can never
              exist in the sidebar and not in the router — the failure that
              publishes a link to a 404. Lab results carry structure rather
              than prose and keep their own component. */}
          {STORE_PAGES.map((p) => (
            <Route
              key={p.key}
              path={p.key}
              element={p.lab ? <LabResults /> : <StorePage slug={p.slug} />}
            />
          ))}
          {/* The warrant canary: public by definition, outside every gate,
              for the same reason the operator pages are. */}
          <Route path="canary" element={<CanaryPublic />} />
          {/* Last, and inside the Layout, so an unknown address still has the
              bar and the tab bar around it. The server answers these paths
              with a real 404 status in production (server/utils/spaRoutes.js);
              this is what the person sees. */}
          <Route path="*" element={<NotFound />} />
        </Route>
        {/* The admin SHELL is a chunk of its own, so it needs a boundary
            above it — the one inside it covers the desks, not itself. This is
            the only Suspense that has no shell around it to keep on screen,
            which is unavoidable: there is nothing rendered yet to keep. */}
        <Route path="/admin" element={
          <RequireAuth roles={['admin', 'manager']}>
            <Suspense fallback={<RouteFallback label="Opening the console…" />}>
              <AdminLayout />
            </Suspense>
          </RequireAuth>
        }>
          <Route index element={<AdminIndexRedirect />} />
          <Route path="products" element={<RequireAdminPermission permission="products.view"><AdminProducts /></RequireAdminPermission>} />
          <Route path="products/new" element={<RequireAdminPermission permission="products.create"><AdminProductEdit /></RequireAdminPermission>} />
          <Route path="products/:id/edit" element={<RequireAdminPermission permission={['products.edit', 'products.stock', 'products.media']}><AdminProductEdit /></RequireAdminPermission>} />
          <Route path="orders" element={<RequireAdminPermission permission="orders.view"><AdminOrders /></RequireAdminPermission>} />
          {/* Fulfilment. `orders.pick` is the weakest grant in the orders
              family on purpose: these three screens name products, quantities
              and shelves, and never a buyer. Shelf assignment is catalogue
              work, so it sits behind products.stock instead. */}
          <Route path="pull-list" element={<RequireAdminPermission permission="orders.pick"><PullList /></RequireAdminPermission>} />
          <Route path="pack" element={<RequireAdminPermission permission="orders.pick"><PackOrder /></RequireAdminPermission>} />
          <Route path="pack/:id" element={<RequireAdminPermission permission="orders.pick"><PackOrder /></RequireAdminPermission>} />
          {/* The Ship desk needs one of the two grants whose work happens
              there: advancing orders or recording tracking. */}
          <Route path="ship" element={<RequireAdminPermission permission={['orders.update_status', 'orders.tracking']}><ShipDesk /></RequireAdminPermission>} />
          {/* The end-of-day sheet. Same grants as the desk that produced it —
              it is a read over columns the desk already serves. */}
          <Route path="manifest" element={<RequireAdminPermission permission={['orders.update_status', 'orders.tracking']}><Manifest /></RequireAdminPermission>} />
          {/* `ShelfGate` as well as the permission, and in that order: a manager
              who holds products.stock on a shop with no shelves should be told
              the shop has none, not shown an empty map whose every fetch 404s.
              Hiding the nav entries removed the way IN; these routes are still
              reachable from a bookmark, a pasted link or the back button. The
              gate is a wrapper rather than an early return inside each page —
              see components/admin/ShelvesOff.jsx for the hook-ordering crash
              that would otherwise wait for the setting to change mid-session. */}
          <Route path="shelves" element={<RequireAdminPermission permission="products.stock"><ShelfGate title="Shelves" what="the shelf list"><Shelves /></ShelfGate></RequireAdminPermission>} />
          <Route path="warehouse" element={<RequireAdminPermission permission="products.stock"><ShelfGate title="Warehouse" what="the warehouse map"><WarehouseMap /></ShelfGate></RequireAdminPermission>} />
          {/* Counting, receiving and returns. Any one of the four grants opens
              the page; the page itself renders only the tabs that grant covers,
              so a receiver never sees a returns tab that would 403. */}
          <Route path="stock" element={<RequireAdminPermission permission={['products.count', 'products.stock', 'products.receive', 'orders.returns']}><StockOps /></RequireAdminPermission>} />
          <Route path="users" element={<RequireAdminPermission permission="users.view"><AdminUsers /></RequireAdminPermission>} />
          <Route path="settings" element={<RequireAdminPermission permission="settings.view"><AdminSettings /></RequireAdminPermission>} />
          <Route path="theme" element={<RequireAdminPermission permission={['settings.theme', 'settings.view']}><AdminTheme /></RequireAdminPermission>} />
          {/* The home page's promises section. Store identity like the pages
              below it — every `home_` key resolves to settings.store on write
              — but not a page: it has no route of its own on the storefront,
              it is a band on the home page, so it keeps its own link rather
              than being bolted into the STORE_PAGES roster whose entries all
              promise a public path. */}
          <Route path="home" element={<RequireAdminPermission permission={['settings.store', 'settings.view']}><HomePromises /></RequireAdminPermission>} />
          {/* One editor, one route per page. `/admin/pages` on its own lands
              on the first of them so an old bookmark still opens something. */}
          <Route path="pages" element={<Navigate to={adminPagePath(STORE_PAGES[0].key)} replace />} />
          {STORE_PAGES.map((p) => (
            <Route
              key={p.key}
              path={`pages/${p.key}`}
              element={(
                <RequireAdminPermission permission={['settings.store', 'settings.view']}>
                  <StorePageEditor pageKey={p.key} />
                </RequireAdminPermission>
              )}
            />
          ))}
          <Route path="cash-mail" element={<RequireAdminPermission permission="orders.cash_mail"><AdminCashMail /></RequireAdminPermission>} />
          <Route path="zelle" element={<RequireAdminPermission permission="orders.zelle"><AdminZelleAccounts /></RequireAdminPermission>} />
          <Route path="disputes" element={<RequireAdminPermission permission="disputes.view"><AdminDisputes /></RequireAdminPermission>} />
          <Route path="support" element={<RequireAdminPermission permission="support.view"><AdminSupport /></RequireAdminPermission>} />
          <Route path="support/:id" element={<RequireAdminPermission permission="support.view"><SupportTicket /></RequireAdminPermission>} />
          <Route path="dashboard" element={<RequireAdminPermission permission="analytics.dashboard"><AdminDashboard /></RequireAdminPermission>} />
          <Route path="api-keys" element={<RequireAdminPermission permission="settings.api_keys"><AdminApiKeys /></RequireAdminPermission>} />
          <Route path="pgp" element={<RequireAdminPermission permission="settings.pgp"><AdminPgpKeys /></RequireAdminPermission>} />
          {/* The canary is signed as the store, so it answers to the grant
              that already means "may sign as the store". */}
          <Route path="canary" element={<RequireAdminPermission permission="settings.pgp"><AdminCanary /></RequireAdminPermission>} />
          <Route path="nodes" element={<RequireAdminPermission permission="nodes.view"><AdminNodes /></RequireAdminPermission>} />
          {/* Any-of: the board is a set of checks with different permissions,
              and it is useful to anybody holding any one of them. getBoard
              filters per check, so this gate only answers "is there anything
              here for you at all". */}
          <Route path="risk" element={<RequireAdminPermission permission={['settings.advanced', 'nodes.view', 'orders.recipient_stats', 'settings.pgp', 'settings.bots', 'settings.security']}><RiskBoard /></RequireAdminPermission>} />
          <Route path="audit-log" element={<RequireAdminPermission permission="analytics.audit_log"><AdminAuditLog /></RequireAdminPermission>} />
          <Route path="coupons" element={<RequireAdminPermission permission="settings.coupons"><AdminCoupons /></RequireAdminPermission>} />
          <Route path="invite-links" element={<RequireAdminPermission permission="users.invite_links"><AdminInviteLinks /></RequireAdminPermission>} />
          <Route path="analytics" element={<RequireAdminPermission permission={['analytics.reports', 'analytics.revenue']}><Analytics /></RequireAdminPermission>} />
          {/* The acquisition report with its missing half filled in: what
              each tracking link was clicked, not only what it converted. Its
              own grant because it is a read an analyst can be given without
              `users.invite_links`, which is the power to mint a link that
              changes what people pay. */}
          <Route path="marketing" element={<RequireAdminPermission permission="analytics.marketing"><AdminMarketing /></RequireAdminPermission>} />
          <Route path="flash-sales" element={<RequireAdminPermission permission="products.flash_sales"><FlashSales /></RequireAdminPermission>} />
          <Route path="store-credit" element={<RequireAdminPermission permission="analytics.store_credit"><StoreCreditLedger /></RequireAdminPermission>} />
          <Route path="tiers" element={<RequireAdminPermission permission="users.tiers"><Tiers /></RequireAdminPermission>} />
          <Route path="limits" element={<RequireAdminPermission permission={['settings.security', 'settings.view']}><Limits /></RequireAdminPermission>} />
          <Route path="ai" element={<RequireAdminPermission permission="settings.security"><AiSettings /></RequireAdminPermission>} />
          <Route path="reviews" element={<RequireAdminPermission permission="products.reviews"><Reviews /></RequireAdminPermission>} />
          {/* Catalogue hygiene: the product list with five filters on it, so
              the same grant. Fixing a row needs products.edit, which the page
              checks before offering a draft tool. */}
          <Route path="catalog-health" element={<RequireAdminPermission permission="products.view"><CatalogHealth /></RequireAdminPermission>} />
          {/* Inside the shell — the sidebar stays — and behind RequireAuth
              like everything above it, so an unknown admin path tells a
              signed-out visitor nothing it would not tell them at /admin. */}
          <Route path="*" element={<AdminNotFound />} />
        </Route>
      </Routes>
      {/* Watches every navigation for `?ref=`, captures it, takes it back out
          of the address bar and counts the arrival. Above the outlet so a
          campaign can land anywhere in the store rather than only on the
          signup form. Renders nothing. */}
      <RefCapture />
      {/* Same reasoning as the onboarding overlay: the chat button appearing a
          moment late is invisible, and a fallback for it would not be. */}
      <Suspense fallback={null}><LiveChat /></Suspense>
      <StorefrontOnboarding />
      <StorefrontAgeGate />
    </>
  );
}
