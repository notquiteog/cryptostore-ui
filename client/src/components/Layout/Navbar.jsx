import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import HeaderField from '../effects/HeaderField';
import ShaderCanvas from '../effects/ShaderCanvas';
// Fetched only when a header shader is actually selected — see useShaderSource.
import { useShaderSource } from '../effects/useShaderSource';
import { useTheme } from '../../context/ThemeContext';
import { useCart } from '../../context/CartContext';
import { ShoppingCart, User, LogOut, LogIn, LayoutDashboard, Menu, X, Home, Package, ShoppingBag } from 'lucide-react';
import { useState, useRef } from 'react';
import ProductSearchBar from '../ProductSearchBar';
import StoreSearch, { useStorePalette } from '../StoreSearch';
import MiniCart from '../MiniCart';
// The slot, not the companion: `Buddy` is ~150 KB and `ai_enabled` is false on
// a new install, so it is fetched only once the shop says it has an assistant.
// See components/ai/BuddySlot.jsx.
import Buddy from '../ai/BuddySlot';
import {
  OrdersPopover, SupportPopover, MembershipPopover, WishlistPopover,
  SubUsersPopover, ProfilePopover, ModeMenu,
} from '../NavMenus';

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const { settings } = useTheme();
  /*
   * The header runs ONE engine, exactly as the background does — see
   * components/effects/BackgroundEffects.jsx for why, and for why the selector
   * is a view over both sets of settings rather than a destructive switch.
   *
   * Anything other than the explicit 'webgl2' is canvas, including the absent
   * value a store that predates the selector has. Defaulting the other way
   * would start a shader in a store that never chose one.
   */
  const headerEngine = settings.effects_header_engine === 'webgl2' ? 'webgl2' : 'canvas';

  /*
   * The header's WebGL2 slot, resolved to a source and whether it tracks the
   * pointer. A custom shader gets `pointer: true` unconditionally: the engine
   * only attaches the listener when asked, and an operator writing against
   * `iMouse` with no way to switch tracking on would find the uniform frozen
   * at its off-screen sentinel with nothing on screen to explain why.
   */
  const headerOn = headerEngine === 'webgl2' && settings.effects_header_shader === 'true';
  const headerName = headerOn && settings.effects_header_shader_name !== 'custom'
    ? settings.effects_header_shader_name
    : null;
  const headerBuilt = useShaderSource('header', headerName);
  const headerShader = (() => {
    if (!headerOn) return null;
    const name = settings.effects_header_shader_name;
    if (name === 'custom') {
      const source = settings.effects_header_shader_source;
      return source ? { source, pointer: true } : null;
    }
    // Null until the library lands; the header simply has no field until then.
    return headerBuilt ? { source: headerBuilt.source, pointer: !!headerBuilt.pointer } : null;
  })();
  const { count } = useCart();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  // The find-anything palette (components/StoreSearch.jsx). One instance for
  // the storefront; Ctrl/Cmd+K toggles it from any storefront page.
  const navRef = useRef(null);
  const [paletteOpen, setPaletteOpen] = useStorePalette(navRef);

  /*
   * The catalog's search term, echoed into this field.
   *
   * The catalog page used to mount a SECOND ProductSearchBar of its own,
   * directly under this one — two identical wide search fields on the same
   * screen, a hundred pixels apart. Only the page's copy knew what had been
   * searched for, so this one always looked empty even while the shelf below
   * it was filtered by a term.
   *
   * Read straight off the URL rather than lifted into state: the query string
   * is already where that term lives, and a second copy of it is a second
   * thing to keep in step.
   */
  const catalogQuery = location.pathname === '/products'
    ? new URLSearchParams(location.search).get('search') || ''
    : '';

  // Active state for the bottom tab bar. Home matches exactly — every path
  // starts with '/', so prefix-matching it would light Home on every page.
  const tabActive = (path) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  const handleLogout = () => {
    logout();
    navigate('/login');
    setMobileOpen(false);
  };

  const isAdmin = user && (user.role === 'admin' || user.role === 'manager');
  const close = () => setMobileOpen(false);
  const guestBrowsing = settings.allow_guest_browsing === 'true';
  // An invite-only store still has a usable register page (paste your code);
  // a closed one does not, so the link only disappears when signups are off.
  const canRegister = settings.registration_enabled !== 'false';

  // ── Navbar presentation, set on the admin Theme page ──
  // `wide` gives a horizontal wordmark the room it needs; the default box
  // squeezed one into 120px and made it unreadable.
  const logoSize = settings.navbar_logo_size === 'wide' ? 'wide' : 'standard';
  const logoDynamic = settings.navbar_logo_dynamic_color === 'true';
  const showStoreName = settings.navbar_show_store_name === 'true';
  const logoClass = [
    'navbar-logo-img',
    `navbar-logo-${logoSize}`,
    logoDynamic ? 'navbar-logo-dynamic' : '',
    settings.favicon_rounded === 'true' ? 'navbar-logo-round' : '',
  ].filter(Boolean).join(' ');

  // The colour-mode control lives in NavMenus as a three-option dropdown —
  // hover on desktop, tap on touch — rather than a blind cycle button.

  // Signed out with guest browsing off there is nothing to navigate to, so the
  // bar would be an empty frame above the login form. With it on, the bar is
  // how a guest reaches the catalog and the login link.
  if (!loading && !user && !guestBrowsing) return null;

  return (
    <>
      <nav className="navbar glass-plate" ref={navRef}>
        {/* Behind the bar's content and above its background, sized to the
            <nav> by its own ResizeObserver. Rests invisible and answers the
            pointer — see components/effects/HeaderField.jsx. */}
        {headerEngine === 'canvas' && settings.effects_header === 'true' && <HeaderField />}
        {/* The WebGL2 header slot, sized to the <nav> rather than the viewport
            — `position: absolute` inside the bar's own stacking context, which
            is why this component takes the position rather than hard-coding
            `fixed` the way a background field can.

            It runs ALONGSIDE the constellation rather than instead of it: they
            are different objects (a graph of points versus a field), the bar is
            small enough that two cheap effects there cost less than one
            full-screen one, and an operator who wants only one simply leaves
            the other off. */}
        {headerShader && (
          <ShaderCanvas
            source={headerShader.source}
            colorKey="theme_header_shader_color"
            colorKey2="theme_header_shader_color_2"
            pointer={headerShader.pointer}
            position="absolute"
          />
        )}
        <div className="navbar-inner container">

          {/* Search bar fills left/center of navbar */}
          <div className="navbar-search">
            {settings.store_logo && (
              <Link to="/" onClick={close} className="navbar-logo-link">
                {logoDynamic ? (
                  /* A fixed-colour logo file cannot follow a re-themed palette.
                     Masking paints the brand colour *through* the logo's own
                     alpha, so the shape is kept and the colour is the theme's.
                     Only sensible for a flat single-colour mark — a photographic
                     or multi-colour logo would come out as a silhouette, which
                     is why this is opt-in rather than automatic. */
                  <span
                    role="img"
                    aria-label={settings.store_name || 'Logo'}
                    className={logoClass}
                    style={{ '--logo-src': `url("${settings.store_logo}")` }}
                  />
                ) : (
                  <img
                    src={settings.store_logo}
                    alt={settings.store_name || 'Logo'}
                    className={logoClass}
                  />
                )}
                {showStoreName && settings.store_name && (
                  <span className="navbar-wordmark">{settings.store_name}</span>
                )}
              </Link>
            )}
            {!settings.store_logo && (
              <Link to="/" onClick={close} className="navbar-brand-fallback" aria-label={`${settings.store_name || 'CryptoStore'} home`}>
                <span className="navbar-brand-mark"><ShoppingBag size={20} strokeWidth={1.6} aria-hidden="true" /></span>
                <span className="navbar-brand-name">{settings.store_name || 'CryptoStore'}</span>
              </Link>
            )}
            <ProductSearchBar
              key={location.pathname === '/products' ? 'catalog' : 'global'}
              initialQuery={catalogQuery}
              placeholder="Search products..."
              style={{ width: '100%' }}
            />
          </div>

          {/* Desktop right: one icon language for the whole row. Orders,
              Support, Membership and the cart wrap their links with hover
              previews on fine pointers; on touch each is its plain link. */}
          <div className="navbar-desktop">
            <Link to="/products" className="nav-icon-link" title="Products">
              <Package size={19} />
            </Link>
            {/* The find-anything palette has no button here any more: it is a
                hidden hotkey (Ctrl/Cmd K, wired by useStorePalette below).
                The product search field beside the logo stays the visible
                way to search; the palette is the power user's door. */}
            <ModeMenu />
            {user ? (
              <div className="navbar-desktop-actions">
                <OrdersPopover />
                <SupportPopover />
                <MiniCart />
                <WishlistPopover />
                {/* The assistant. Renders nothing at all when the shop does
                    not offer one, so there is no assistant-shaped hole in a
                    navbar that has no assistant. */}
                <Buddy />
                {/* An account that is itself somebody's sub-user cannot run a
                    programme of its own — one level, not a tree
                    (server/utils/subUserAccess.js) — and every route behind
                    the panel refuses them. Offering the icon anyway would be
                    the navbar advertising a page that redirects. */}
                {!user.is_sub_user && <SubUsersPopover />}
                <MembershipPopover />
                <ProfilePopover user={user} onLogout={handleLogout} />
                {/* Admin sits at the far right, visually apart from the
                    shopping icons: it is a context switch, not a destination
                    in the buying loop. */}
                {isAdmin && (
                  <Link to="/admin" className="nav-icon-link navbar-admin-link" title="Admin panel">
                    <LayoutDashboard size={19} />
                  </Link>
                )}
                <button onClick={handleLogout} className="glass-btn glass-btn-sm" style={{ marginLeft: 'var(--sp-1)' }}>
                  <LogOut size={14} /> Logout
                </button>
              </div>
            ) : (
              <div className="navbar-auth" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
                <Buddy />
                {canRegister && <Link to="/register" className="nav-link">Register</Link>}
                <Link to="/login" className="glass-btn glass-btn-sm glass-btn-primary">
                  <LogIn size={14} /> Login
                </Link>
              </div>
            )}
          </div>

          {/* Mobile: mode menu, the companion and the hamburger.

              No cart here. It was a second copy of the tab bar's Cart, badge
              and all: `.navbar-mobile-icons` and `.mobile-tabbar` appear at
              the same 768px, and both entries were gated on `user`, so on a
              phone the two were never anything but the same link twice — once
              in the top corner and once under the thumb. The bar below is
              where a buyer's hand already is, so that is the copy that stays.
              (The hamburger keeps a third, in the long-tail menu; that one is
              a list of destinations rather than a control, and reads as such.) */}
          <div className="navbar-mobile-icons">
            <ModeMenu />
            <Buddy />
            <button
              className="glass-btn navbar-toggle"
              onClick={() => setMobileOpen(v => !v)}
              aria-label="Toggle menu"
            >
              {mobileOpen ? <X size={21} /> : <Menu size={21} />}
            </button>
          </div>
        </div>

        {/* Mobile dropdown — no search here, it's always visible in the bar */}
        <div className={`mobile-menu${mobileOpen ? ' mobile-menu-open' : ''}`}>
          <div className="mobile-menu-inner">
            <nav className="mobile-nav-links">
              <Link to="/products" className="mobile-nav-link" onClick={close}>Products</Link>
              {user && <Link to="/orders" className="mobile-nav-link" onClick={close}>Orders</Link>}
              {user && <Link to="/support" className="mobile-nav-link" onClick={close}>Support</Link>}
              {user && (
                <Link to="/cart" className="mobile-nav-link" onClick={close}>
                  Cart {count > 0 && <span className="cart-badge" style={{ position: 'static', marginLeft: 4 }}>{count}</span>}
                </Link>
              )}
              {user && <Link to="/wishlist" className="mobile-nav-link" onClick={close}>Wishlist</Link>}
              {user && <Link to="/membership" className="mobile-nav-link" onClick={close}>Membership</Link>}
              {user && !user.is_sub_user && <Link to="/subusers" className="mobile-nav-link" onClick={close}>Sub-users</Link>}
              {isAdmin && <Link to="/admin" className="mobile-nav-link" onClick={close}>Admin Panel</Link>}
              {user && <Link to="/profile" className="mobile-nav-link" onClick={close}>Profile</Link>}
            </nav>
            <div className="mobile-nav-footer">
              {user ? (
                <button onClick={handleLogout} className="glass-btn" style={{ width: '100%', justifyContent: 'center' }}>
                  <LogOut size={16} /> Logout
                </button>
              ) : (
                <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
                  <Link to="/login" className="glass-btn glass-btn-primary" onClick={close} style={{ width: '100%', justifyContent: 'center' }}>
                    <LogIn size={16} /> Login
                  </Link>
                  {canRegister && (
                    <Link to="/register" className="glass-btn" onClick={close} style={{ width: '100%', justifyContent: 'center' }}>
                      Create an account
                    </Link>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {mobileOpen && <div className="mobile-backdrop" onClick={close} />}

      <StoreSearch open={paletteOpen} onClose={() => setPaletteOpen(false)} />

      {/* Bottom tab bar — the thumb-reach storefront on a phone. These five
          are the loop a buyer actually walks; the hamburger keeps the long
          tail (support, membership, sub-users, admin, logout). Signed-out
          guests get the browse pair and the way in. */}
      <nav className="mobile-tabbar" aria-label="Primary">
        <Link to="/" onClick={close} className={`tabbar-link${tabActive('/') ? ' active' : ''}`}>
          <Home size={20} aria-hidden="true" />
          <span>Home</span>
        </Link>
        <Link to="/products" onClick={close} className={`tabbar-link${tabActive('/products') ? ' active' : ''}`}>
          <Package size={20} aria-hidden="true" />
          <span>Products</span>
        </Link>
        {user ? (
          <>
            <Link to="/cart" onClick={close} className={`tabbar-link${tabActive('/cart') ? ' active' : ''}`}>
              <span className="tabbar-icon">
                <ShoppingCart size={20} aria-hidden="true" />
                {count > 0 && <span className="cart-badge">{count}</span>}
              </span>
              <span>Cart</span>
            </Link>
            <Link to="/orders" onClick={close} className={`tabbar-link${tabActive('/orders') ? ' active' : ''}`}>
              <ShoppingBag size={20} aria-hidden="true" />
              <span>Orders</span>
            </Link>
            <Link to="/profile" onClick={close} className={`tabbar-link${tabActive('/profile') ? ' active' : ''}`}>
              <User size={20} aria-hidden="true" />
              <span>Profile</span>
            </Link>
          </>
        ) : (
          <Link to="/login" onClick={close} className={`tabbar-link${tabActive('/login') ? ' active' : ''}`}>
            <LogIn size={20} aria-hidden="true" />
            <span>Sign in</span>
          </Link>
        )}
      </nav>
    </>
  );
}
