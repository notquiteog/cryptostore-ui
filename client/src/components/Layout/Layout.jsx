import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Navbar from './Navbar';
import StoreFooter from './StoreFooter';
import BackgroundEffects from '../effects/BackgroundEffects';
import OfflineBar from '../OfflineBar';
import StorePausedBar from '../StorePausedBar';
import ErrorBoundary from '../ErrorBoundary';
import RouteFallback from '../RouteFallback';

/**
 * The two pages where a visitor is about to type a password get no footer:
 * its page links are not what somebody signing in came for, and the thing
 * they DO need — whether this address is the real store — is fused to the
 * bottom of the sign-in card itself (components/MirrorCheck.jsx, mounted by
 * the auth pages). Decided here, in the one place that draws the footer.
 */
const AUTH_PATHS = new Set(['/login', '/register']);

export default function Layout() {
  const { pathname } = useLocation();
  const authPage = AUTH_PATHS.has(pathname.replace(/\/+$/, '') || '/');

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', position: 'relative', zIndex: 2 }}>
      {/* One rule for what the store paints behind itself, shared with the
          other layout — see components/effects/BackgroundEffects.jsx. */}
      <BackgroundEffects />
      <Navbar />
      {/* Nothing until the connection is gone — see components/OfflineBar.jsx. */}
      <OfflineBar />
      {/* Nothing until the operator pauses new orders — see
          components/StorePausedBar.jsx. Below the offline bar so a buyer who is
          both offline and looking at a paused store reads the connection first:
          it is the one of the two that changes what this device can trust. */}
      <StorePausedBar />
      {/* `site-main` exists for the mobile tab bar's clearance rule: a fixed
          bottom bar with no matching padding eats the last row of every page. */}
      <main className="site-main" style={{ flex: 1 }}>
        {/* Inside <main>, so a page that throws loses the page and nothing
            else: the nav, the footer and the tab bar stay put and the person
            is one click from somewhere that works. Outside it — around the
            router — the same crash would take the shell with it, which is the
            white screen this boundary exists to end. */}
        {/* Inside the boundary, not around it: a page whose CODE is still
            arriving and a page that has thrown are different states, and the
            error boundary must stay mounted across the wait so a chunk that
            fails to load is caught rather than escaping to the white screen
            the boundary above exists to end.

            Inside <main> for the same reason the boundary is — the navbar, the
            footer and the tab bar stay put while a route loads, so navigating
            looks like the page filling in rather than like the app blinking.
            See App.jsx for which routes are split and why. */}
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      {/* Renders nothing until the operator enables it. Outside <main> so the
          tab-bar clearance padding stays the page's, not the footer's — the
          footer carries its own clearance rule for the same fixed bar. */}
      {!authPage && <StoreFooter />}
    </div>
  );
}
