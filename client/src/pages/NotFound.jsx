import { Link, useLocation } from 'react-router-dom';
import { PackageSearch, LayoutGrid, Home, ClipboardList, LifeBuoy, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import useDocumentHead from '../hooks/useDocumentHead';
import { ROBOTS_PRIVATE } from '../utils/documentHead';

/**
 * The storefront's catch-all.
 *
 * Before this existed an unknown URL mounted the Layout with an empty <main>:
 * navbar, footer, and nothing between them, which reads as the store having
 * broken rather than as a link having gone stale. Rendered inside the Layout
 * on purpose, so the bar and the tab bar stay and the person is never off the
 * map.
 *
 * The path is shown so a mistyped bookmark can be spotted; it is only ever
 * read from the address bar the visitor already sees, and is not sent
 * anywhere. Nothing here logs.
 *
 * The links are the page's job (DESIGN §9): the catalog, home, and — once
 * signed in — the two places a buyer is usually trying to reach when a link
 * fails, their orders and support. A signed-out visitor on a store that does
 * not allow guest browsing is offered sign-in instead of a catalog link that
 * would only bounce them there.
 */
export default function NotFound() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { settings } = useTheme();
  const canBrowse = !!user || settings.allow_guest_browsing === 'true';
  // Titled for the tab, and marked noindex for a crawler that renders the
  // page — the served document already said so (the SPA fallback answers an
  // unknown path with 404 and a not-found head), this keeps it true when the
  // router lands here from a stale in-app link.
  useDocumentHead({ title: 'Page not found', robots: ROBOTS_PRIVATE });

  return (
    <div className="page container nf-page">
      <section className="nf-stage" aria-labelledby="nf-title">
        <div className="nf-halo" aria-hidden="true" />
        <div className="nf-beacon" aria-hidden="true">
          <span className="nf-ring" />
          <span className="nf-ring" />
          <span className="nf-ring" />
          <span className="nf-core"><PackageSearch size={34} strokeWidth={1.75} /></span>
        </div>
        <p className="nf-code" aria-hidden="true"><span>4</span><span>0</span><span>4</span></p>
        <h1 id="nf-title" className="nf-title">Nothing on this shelf</h1>
        <p className="nf-lede">
          The address you followed doesn&apos;t point at anything in this store.
          It may have moved, or the link was mistyped.
        </p>
        <p className="nf-path"><code>{pathname}</code></p>
        <nav className="nf-links" aria-label="Where to go next">
          {canBrowse ? (
            <Link to="/products" className="glass-btn glass-btn-primary"><LayoutGrid size={15} aria-hidden="true" /> Browse the catalog</Link>
          ) : (
            <Link to="/login" className="glass-btn glass-btn-primary"><LogIn size={15} aria-hidden="true" /> Sign in</Link>
          )}
          <Link to="/" className="glass-btn"><Home size={15} aria-hidden="true" /> Home</Link>
          {user && <Link to="/orders" className="glass-btn"><ClipboardList size={15} aria-hidden="true" /> Your orders</Link>}
          {user && <Link to="/support" className="glass-btn"><LifeBuoy size={15} aria-hidden="true" /> Support</Link>}
        </nav>
      </section>
    </div>
  );
}
