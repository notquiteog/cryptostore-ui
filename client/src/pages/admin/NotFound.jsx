import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Compass, LayoutDashboard, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getDefaultAdminPath } from '../../utils/adminPermissions';

/**
 * The admin shell's catch-all. Same beacon as the storefront page, one size
 * down, because it sits inside the sidebar layout rather than owning the
 * screen.
 *
 * "Dashboard" is whatever the first admin page this account may open is —
 * the same helper the sidebar uses — so a packer holding only `orders.pick`
 * is sent to the packing desk, not to a dashboard they would bounce off.
 */
export default function AdminNotFound() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const home = getDefaultAdminPath(user) || '/';

  return (
    <div className="admin-page nf-admin">
      <section className="nf-stage is-compact" aria-labelledby="nf-title">
        <div className="nf-halo" aria-hidden="true" />
        <div className="nf-beacon" aria-hidden="true">
          <span className="nf-ring" />
          <span className="nf-ring" />
          <span className="nf-ring" />
          <span className="nf-core"><Compass size={30} strokeWidth={1.75} /></span>
        </div>
        <p className="nf-code" aria-hidden="true"><span>4</span><span>0</span><span>4</span></p>
        <h1 id="nf-title" className="nf-title">No desk at this address</h1>
        <p className="nf-lede">
          Nothing in the admin panel answers to this path. If a link brought you
          here, the page it pointed at has moved.
        </p>
        <p className="nf-path"><code>{pathname}</code></p>
        <nav className="nf-links" aria-label="Where to go next">
          <Link to={home} className="glass-btn glass-btn-primary"><LayoutDashboard size={15} aria-hidden="true" /> {home === '/' ? 'Back to the store' : 'Dashboard'}</Link>
          <button type="button" className="glass-btn" onClick={() => navigate(-1)}><ArrowLeft size={15} aria-hidden="true" /> Go back</button>
        </nav>
      </section>
    </div>
  );
}
