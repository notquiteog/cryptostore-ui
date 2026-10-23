import { Component } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AlertTriangle, RotateCcw, Home, LayoutGrid, ClipboardList, LifeBuoy, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { getDefaultAdminPath } from '../utils/adminPermissions';

/**
 * The last line between one component throwing and the whole store going white.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * React unmounts the entire tree when a render or effect throws and nothing
 * catches it. Until this file there was no boundary anywhere in the client, so
 * a single bad line took down everything: one `previous.status` read on a null
 * ref in OrderDetail's purchase-event effect blanked every order page to an
 * empty <body>, navbar and footer included. The page was fine, the API was
 * fine, and the symptom was a white rectangle with no way forward.
 *
 * Mounted around each layout's <Outlet> rather than around the router, so the
 * chrome survives the crash: the person keeps the nav, the footer and the tab
 * bar, and is one click from somewhere that works. Same reasoning as
 * pages/NotFound.jsx — a dead end is a worse failure than the original bug.
 *
 * ── What it deliberately does not do ────────────────────────────────────────
 *
 * It does not report. No beacon, no Sentry, no remote logging of any kind: a
 * store on a hostile network cannot afford a crash to become an outbound
 * request to a third party, and the stack of a failing render is exactly the
 * kind of thing that names internal routes and buyer data. The error goes to
 * the operator's own console and nowhere else.
 *
 * The detail panel is DEV-only for the same reason. In a built storefront the
 * buyer is told the page failed and where to go next; they are not shown a
 * component stack. An operator debugging a live box reads the console, which
 * is theirs.
 */

class Boundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, key: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  /**
   * Clear on navigation.
   *
   * Without this the boundary latches: once a page throws, every subsequent
   * route renders the fallback too, because the state that holds the error is
   * never reset and the nav links below would take the person to a screen
   * still showing the crash they just left. `resetKey` is the pathname, so
   * moving anywhere at all gives the tree a clean mount.
   */
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.key) return { key: props.resetKey, error: null };
    return null;
  }

  // Console only — see the header. `info.componentStack` is what actually
  // names the failing component, and it is not on the error object.
  componentDidCatch(error, info) {
    console.error('[CryptoStore] a page failed to render:', error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      return this.props.renderFallback(this.state.error, () => this.setState({ error: null }));
    }
    return this.props.children;
  }
}

export default function ErrorBoundary({ children, variant = 'store' }) {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { settings } = useTheme();
  const canBrowse = !!user || settings.allow_guest_browsing === 'true';
  const adminHome = variant === 'admin' ? getDefaultAdminPath(user) : null;

  const renderFallback = (error, retry) => (
    <div className={variant === 'admin' ? 'eb-admin' : 'page container eb-page'}>
      <section className="eb-stage" aria-labelledby="eb-title" role="alert">
        <div className="eb-halo" aria-hidden="true" />
        <div className="eb-mark" aria-hidden="true">
          <span className="eb-mark-core"><AlertTriangle size={30} strokeWidth={1.75} /></span>
        </div>
        <h1 id="eb-title" className="eb-title">This page stopped partway</h1>
        <p className="eb-lede">
          Something in it failed while drawing. Nothing you did caused it and
          nothing was lost — the rest of the {variant === 'admin' ? 'panel' : 'store'} still works.
        </p>

        {/* DEV only. A built store shows a buyer the way out, not a stack. */}
        {import.meta.env.DEV && (
          <details className="eb-detail">
            <summary>What went wrong</summary>
            <pre>{String(error?.stack || error?.message || error)}</pre>
          </details>
        )}

        {/* DESIGN §9: the two or three things somebody does straight after
            landing here. Retry first, because a render that failed on a race
            or a half-loaded record often succeeds on a second mount. */}
        <nav className="eb-links" aria-label="Where to go next">
          <button type="button" className="glass-btn glass-btn-primary" onClick={retry}>
            <RotateCcw size={15} aria-hidden="true" /> Try again
          </button>
          {variant === 'admin' ? (
            <>
              {adminHome && <Link to={adminHome} className="glass-btn"><Home size={15} aria-hidden="true" /> Admin home</Link>}
              <Link to="/" className="glass-btn"><LayoutGrid size={15} aria-hidden="true" /> Storefront</Link>
            </>
          ) : (
            <>
              <Link to="/" className="glass-btn"><Home size={15} aria-hidden="true" /> Home</Link>
              {canBrowse && <Link to="/products" className="glass-btn"><LayoutGrid size={15} aria-hidden="true" /> Catalog</Link>}
              {user && <Link to="/orders" className="glass-btn"><ClipboardList size={15} aria-hidden="true" /> Your orders</Link>}
              {user && <Link to="/support" className="glass-btn"><LifeBuoy size={15} aria-hidden="true" /> Support</Link>}
              {!user && <Link to="/login" className="glass-btn"><LogIn size={15} aria-hidden="true" /> Sign in</Link>}
            </>
          )}
        </nav>
      </section>
    </div>
  );

  return <Boundary resetKey={pathname} renderFallback={renderFallback}>{children}</Boundary>;
}
