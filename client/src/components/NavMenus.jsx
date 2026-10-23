import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardList, LifeBuoy, Award, Package, Moon, Sun, SunMoon, Check, Plus,
  Heart, Link2, User, LogOut, ShoppingCart, TrendingUp, Users, Wallet, Shield,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../utils/api';
import { useTheme } from '../context/ThemeContext';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import NavPopover from './NavPopover';
import { AvatarImage } from './Avatar';

const money = (n) => `$${Number(n).toFixed(2)}`;
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

/**
 * One lazy fetch per panel, on first open. These panels hang off every page,
 * so fetching eagerly would tax every navigation for data that only exists
 * on hover; fetching per-open would hammer the API for someone who hovers
 * five times. Once is the honest middle: stale-after-a-while is acceptable
 * for a glance surface whose full page is one click away.
 *
 * `version` is the escape hatch, and the wishlist is why it exists. "Once per
 * page load" is only acceptable for data this app cannot change from inside
 * itself — orders, tickets, membership all move out of band. The wishlist
 * moves under the buyer's own cursor: every heart on the catalog and the
 * detail page writes to it. Cached once, the panel answered "Nothing saved
 * yet" for the rest of the session no matter how much was saved. Passing a
 * counter that the owning context bumps on each committed change makes the
 * cache expire exactly when it stops being true, and never otherwise —
 * hovering the panel five times after one change is still one refetch.
 */
function useLazyFetch(open, path, version = 0) {
  const [state, setState] = useState({ data: null, loaded: false, at: 0 });
  useEffect(() => {
    if (!open || (state.loaded && state.at === version)) return undefined;
    let alive = true;
    api.get(path)
      // `at` records the version this answer describes, not the version at the
      // time it lands: a change committed mid-flight leaves the two unequal
      // and the panel refetches on next open rather than caching a reply that
      // was already out of date when it arrived.
      .then((data) => { if (alive) setState({ data, loaded: true, at: version }); })
      .catch(() => { if (alive) setState({ data: null, loaded: true, at: version }); });
    return () => { alive = false; };
  }, [open, state.loaded, state.at, path, version]);
  return state;
}

/** The store's order lifecycle, collapsed to badge tones. */
export function orderBadge(status) {
  if (status === 'delivered') return 'badge-success';
  if (['shipped', 'accepted', 'paid'].includes(status)) return 'badge-info';
  if (['cancelled', 'refunded', 'disputed'].includes(status)) return 'badge-danger';
  return 'badge-warning';
}

// ─── Orders ──────────────────────────────────────────────────────────────────

export function OrdersPopover() {
  const trigger = (
    <Link to="/orders" className="nav-icon-link" title="Orders">
      <ClipboardList size={19} />
    </Link>
  );
  return (
    <NavPopover trigger={trigger} ariaLabel="Recent orders" panelClassName="orders-pop" openOn="hover">
      {({ open, close }) => <OrdersPanel open={open} close={close} />}
    </NavPopover>
  );
}

function OrdersPanel({ open, close }) {
  // The endpoint is paginated and returns {orders, total, ...} — reading it
  // as a bare array rendered "No orders yet." to buyers with a full history.
  const { data, loaded } = useLazyFetch(open, '/orders?limit=5');
  const orders = data?.orders || [];
  return (
    <>
      <div className="nav-pop-head">
        <span className="nav-pop-title">Recent orders</span>
        {loaded && data?.total > 0 && <span className="nav-pop-count">{data.total} total</span>}
      </div>
      {!loaded ? (
        <div className="nav-pop-empty"><span className="spinner spinner-inline" /> Loading…</div>
      ) : orders.length === 0 ? (
        <div className="nav-pop-empty"><Package size={18} /><span>No orders yet.</span></div>
      ) : (
        <ul className="nav-pop-list">
          {orders.map((o) => (
            <li key={o.id}>
              <Link to={`/orders/${o.uuid || o.id}`} className="nav-pop-row" onClick={close}>
                <div className="nav-pop-row-main">
                  {/* Number() because COUNT() arrives as a string, and "1" !== 1
                      pluralised every single-item order. */}
                  <span className="nav-pop-row-title">
                    #{o.id} · {Number(o.item_count ?? o.items?.length ?? 0) === 1 ? '1 item' : `${Number(o.item_count ?? o.items?.length ?? 0)} items`}
                  </span>
                  <span className="nav-pop-row-sub">{shortDate(o.created_at)}</span>
                </div>
                <div className="nav-pop-row-side">
                  <span className="nav-pop-mono">{money(o.total)}</span>
                  <span className={`badge ${orderBadge(o.status)}`} style={{ fontSize: 'var(--fs-3xs)' }}>{o.status}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="nav-pop-foot">
        <Link to="/orders" className="glass-btn glass-btn-sm" onClick={close}>All orders</Link>
      </div>
    </>
  );
}

// ─── Support ─────────────────────────────────────────────────────────────────

export function SupportPopover() {
  const trigger = (
    <Link to="/support" className="nav-icon-link" title="Support">
      <LifeBuoy size={19} />
    </Link>
  );
  return (
    <NavPopover trigger={trigger} ariaLabel="Support tickets" panelClassName="support-pop" openOn="hover">
      {({ open, close }) => <SupportPanel open={open} close={close} />}
    </NavPopover>
  );
}

function SupportPanel({ open, close }) {
  const { data, loaded } = useLazyFetch(open, '/support?limit=5');
  const tickets = (data?.tickets || []).slice(0, 5);
  return (
    <>
      <div className="nav-pop-head">
        <span className="nav-pop-title">Support</span>
        {loaded && data?.total > 0 && <span className="nav-pop-count">{data.total} ticket{data.total === 1 ? '' : 's'}</span>}
      </div>
      {!loaded ? (
        <div className="nav-pop-empty"><span className="spinner spinner-inline" /> Loading…</div>
      ) : tickets.length === 0 ? (
        <div className="nav-pop-empty"><LifeBuoy size={18} /><span>No tickets — need a hand with anything?</span></div>
      ) : (
        <ul className="nav-pop-list">
          {tickets.map((t) => (
            <li key={t.id}>
              <Link to={`/support/${t.id}`} className="nav-pop-row" onClick={close}>
                <div className="nav-pop-row-main">
                  <span className="nav-pop-row-title">{t.subject}</span>
                  <span className="nav-pop-row-sub">{shortDate(t.created_at)}</span>
                </div>
                <div className="nav-pop-row-side">
                  <span className={`badge ${t.status === 'open' ? 'badge-info' : 'badge-muted'}`} style={{ fontSize: 'var(--fs-3xs)' }}>
                    {t.status}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="nav-pop-foot">
        <Link to="/support" className="glass-btn glass-btn-sm glass-btn-primary" onClick={close}>
          <Plus size={13} /> New ticket
        </Link>
        <Link to="/support" className="glass-btn glass-btn-sm" onClick={close}>All tickets</Link>
      </div>
    </>
  );
}

// ─── Membership ──────────────────────────────────────────────────────────────

export function MembershipPopover() {
  const trigger = (
    <Link to="/membership" className="nav-icon-link" title="Membership & tier">
      <Award size={19} />
    </Link>
  );
  return (
    <NavPopover trigger={trigger} ariaLabel="Membership tier" panelClassName="member-pop" openOn="hover">
      {({ open, close }) => <MembershipPanel open={open} close={close} />}
    </NavPopover>
  );
}

function MembershipPanel({ open, close }) {
  const { data, loaded } = useLazyFetch(open, '/tiers/me');
  const tier = data?.tier;
  const next = data?.next_tier;
  const spend = Number(data?.spend_window || 0);
  const pct = Math.round((data?.progress || 0) * 100);
  const windowDays = data?.window_days ?? 30;
  return (
    <>
      <div className="nav-pop-head">
        <span className="nav-pop-title">Membership</span>
        {loaded && data && <span className="nav-pop-count">{money(spend)} / {windowDays}d</span>}
      </div>
      {!loaded ? (
        <div className="nav-pop-empty"><span className="spinner spinner-inline" /> Loading…</div>
      ) : !data ? (
        <div className="nav-pop-empty"><Award size={18} /><span>Tiers are not running right now.</span></div>
      ) : (
        <div style={{ '--member-color': tier?.color || 'var(--primary)' }}>
          <div className="member-pop-tier" style={{ color: tier?.color || 'var(--text)' }}>
            <Award size={16} /> {tier?.name || 'No tier yet'}
          </div>
          <div className="member-pop-bar" role="img" aria-label={`${pct}% toward the next tier`}>
            <div className="member-pop-fill" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
          <p className="member-pop-next">
            {next
              ? <>{money(Math.max(0, Number(next.min_spend_30d) - spend))} more in {windowDays} days reaches{' '}
                <strong style={{ color: next.color || 'var(--text)' }}>{next.name}</strong>
                {next.discount_pct > 0 && <> ({next.discount_pct}% off)</>}.</>
              : tier
                ? <>Top tier — every order keeps it warm.</>
                : <>Every order counts toward your first tier.</>}
          </p>
        </div>
      )}
      <div className="nav-pop-foot">
        <Link to="/membership" className="glass-btn glass-btn-sm" onClick={close}>Full details</Link>
      </div>
    </>
  );
}

// ─── Wishlist ────────────────────────────────────────────────────────────────

export function WishlistPopover() {
  const trigger = (
    <Link to="/wishlist" className="nav-icon-link" title="Wishlist">
      <Heart size={19} />
    </Link>
  );
  return (
    <NavPopover trigger={trigger} ariaLabel="Wishlist" panelClassName="wishlist-pop" openOn="hover">
      {({ open, close }) => <WishlistPanel open={open} close={close} />}
    </NavPopover>
  );
}

function WishlistPanel({ open, close }) {
  // The one panel whose contents the buyer edits from inside this same app —
  // see useLazyFetch above for why that needs a version rather than a plain
  // fetch-once.
  const { revision } = useWishlist();
  const { data, loaded } = useLazyFetch(open, '/wishlist', revision);
  const { addToCart } = useCart();
  const all = Array.isArray(data) ? data : [];
  const items = all.slice(0, 5);

  const quickAdd = async (item) => {
    try {
      await addToCart(item.variant_id, 1);
      toast.success(`${item.group_name} added to cart`);
    } catch (err) {
      toast.error(err?.message || 'Could not add to cart');
    }
  };

  return (
    <>
      <div className="nav-pop-head">
        <span className="nav-pop-title">Wishlist</span>
        {loaded && all.length > 0 && (
          <span className="nav-pop-count">{all.length} saved</span>
        )}
      </div>
      {!loaded ? (
        <div className="nav-pop-empty"><span className="spinner spinner-inline" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="nav-pop-empty"><Heart size={18} /><span>Nothing saved yet — tap the heart on anything.</span></div>
      ) : (
        <ul className="nav-pop-list">
          {items.map((item) => (
            <li key={item.variant_id} className="nav-pop-row wishlist-row">
              {item.image_url
                ? <span className="nav-pop-thumb" style={{ backgroundImage: `url(${item.image_url})` }} aria-hidden="true" />
                : <span className="nav-pop-thumb nav-pop-thumb-empty" aria-hidden="true"><Package size={14} /></span>}
              <div className="nav-pop-row-main">
                <Link to={`/products/${item.group_id}`} className="nav-pop-row-title" onClick={close}>
                  {item.group_name}
                </Link>
                <span className="nav-pop-row-sub">{item.variant_name}</span>
              </div>
              <div className="nav-pop-row-side">
                <span className="nav-pop-mono">{money(item.price)}</span>
                <button
                  type="button"
                  className="wishlist-quick-add"
                  onClick={() => quickAdd(item)}
                  title={`Add ${item.group_name} to cart`}
                  aria-label={`Add ${item.group_name} to cart`}
                >
                  <ShoppingCart size={12} /> Add
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {/* DESIGN §6: the panel shows five and says so, rather than letting the
          sixth saved item vanish with nothing on screen to suggest it exists. */}
      {all.length > items.length && (
        <p className="nav-pop-more">
          {all.length - items.length} more saved
        </p>
      )}
      <div className="nav-pop-foot">
        <Link to="/wishlist" className="glass-btn glass-btn-sm" onClick={close}>Full wishlist</Link>
      </div>
    </>
  );
}

// ─── Sub-users ───────────────────────────────────────────────────────────────

export function SubUsersPopover() {
  const trigger = (
    <Link to="/subusers" className="nav-icon-link" title="Your sub-users">
      <Link2 size={19} />
    </Link>
  );
  return (
    <NavPopover trigger={trigger} ariaLabel="Sub-users" panelClassName="referral-pop" openOn="hover">
      {({ open, close }) => <SubUsersPanel open={open} close={close} />}
    </NavPopover>
  );
}

function SubUsersPanel({ open, close }) {
  const { data, loaded } = useLazyFetch(open, '/subusers/panel');
  const s = data?.summary;
  return (
    <>
      <div className="nav-pop-head">
        <span className="nav-pop-title">Sub-users</span>
      </div>
      {!loaded ? (
        <div className="nav-pop-empty"><span className="spinner spinner-inline" /> Loading…</div>
      ) : !s ? (
        <div className="nav-pop-empty"><Link2 size={18} /><span>Invite people, earn from what they spend.</span></div>
      ) : (
        <dl className="nav-pop-stats">
          <div className="nav-pop-stat">
            <dt><TrendingUp size={11} /> Earned</dt>
            <dd>{money(s.total_earned || 0)}</dd>
          </div>
          <div className="nav-pop-stat">
            <dt><Users size={11} /> Sub-users</dt>
            <dd>{s.sub_user_count || 0}</dd>
          </div>
          <div className="nav-pop-stat">
            <dt>Their orders</dt>
            <dd>{s.sub_user_orders || 0}</dd>
          </div>
          <div className="nav-pop-stat">
            <dt>Active links</dt>
            <dd>{s.active_links || 0}</dd>
          </div>
        </dl>
      )}
      <div className="nav-pop-foot">
        <Link to="/subusers" className="glass-btn glass-btn-sm" onClick={close}>Sub-user panel</Link>
      </div>
    </>
  );
}

// ─── Profile ─────────────────────────────────────────────────────────────────

/**
 * No fetch: everything here rides the session's own user object. The one
 * number a buyer forgets they have is store credit, so it gets the stage.
 */
export function ProfilePopover({ user, onLogout }) {
  /* Your own face in the navbar, once you have one.
     `AvatarImage` rather than `Avatar`: this is already the trigger for a
     panel, and nesting the hover card's own button inside a popover trigger
     would give one control two overlapping open/close mechanisms. It also
     falls back to the same generic icon the bar wore before, so a store with
     avatars switched off is unchanged. */
  const trigger = (
    <Link to="/profile" className="nav-icon-link" title="Profile">
      {user?.avatar_path
        ? <AvatarImage username={user.username} avatarPath={user.avatar_path} size={22} />
        : <User size={19} />}
    </Link>
  );
  const credit = Number(user?.store_credit_balance || 0);
  const since = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
    : null;
  const twoFactor = user?.two_factor_method && user.two_factor_method !== 'disabled';
  return (
    <NavPopover trigger={trigger} ariaLabel="Account" panelClassName="profile-pop" openOn="hover">
      {({ close }) => (
        <>
          <div className="profile-pop-head">
            <AvatarImage username={user?.username} avatarPath={user?.avatar_path} size={32} />
            <span className="profile-pop-id">
              <span className="profile-pop-name">{user?.username}</span>
              {since && <span className="nav-pop-row-sub">since {since}</span>}
            </span>
          </div>
          {credit > 0 && (
            <div className="profile-pop-credit">
              <Wallet size={14} />
              <span>Store credit</span>
              <strong className="nav-pop-mono">{money(credit)}</strong>
            </div>
          )}
          <div className={`profile-pop-2fa${twoFactor ? '' : ' is-off'}`}>
            <Shield size={12} />
            {twoFactor ? 'Two-factor is on' : 'Two-factor is off — one password is all that guards this account'}
          </div>
          <div className="nav-pop-foot">
            <Link to="/profile" className="glass-btn glass-btn-sm" onClick={close}>Settings</Link>
            <button type="button" className="glass-btn glass-btn-sm" onClick={() => { close(); onLogout(); }}>
              <LogOut size={13} /> Logout
            </button>
          </div>
        </>
      )}
    </NavPopover>
  );
}

// ─── Colour mode menu ────────────────────────────────────────────────────────

const MODE_OPTIONS = [
  { value: 'dark', label: 'Dark', icon: Moon, hint: 'Always dark' },
  { value: 'light', label: 'Light', icon: Sun, hint: 'Always light' },
  { value: 'auto', label: 'Auto', icon: SunMoon, hint: 'Follows your system' },
];

/**
 * Explicit choice instead of the old blind cycle: three buttons, current one
 * marked. Hover opens it on desktop; on touch the trigger tap opens it (the
 * old behaviour — tap immediately switching — meant discovering "auto" only
 * by cycling past the mode you wanted).
 */
export function ModeMenu() {
  const { settings, visitorMode, setVisitorMode, allowVisitorMode, resolvedMode } = useTheme();
  if (!allowVisitorMode) return null;

  const storeMode = settings.theme_mode || 'dark';
  const intent = visitorMode || storeMode;
  const TriggerIcon = intent === 'auto' ? SunMoon : (resolvedMode === 'light' ? Sun : Moon);

  const trigger = (
    <button
      type="button"
      className="nav-icon-link mode-toggle"
      title={`Color mode: ${intent}`}
      aria-label={`Color mode: ${intent}. Opens the mode menu.`}
      aria-haspopup="true"
    >
      <TriggerIcon size={19} />
    </button>
  );

  return (
    <NavPopover trigger={trigger} ariaLabel="Color mode" panelClassName="mode-menu" openOn="auto">
      {({ close }) => (
        <div className="mode-menu-options" role="group" aria-label="Color mode">
          {MODE_OPTIONS.map((opt) => {
            const active = intent === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                className={`mode-menu-btn${active ? ' is-active' : ''}`}
                aria-pressed={active}
                onClick={() => {
                  // Picking the store's own default clears the override, so
                  // "back to normal" also means "follow the store if it
                  // changes later".
                  setVisitorMode(opt.value === storeMode ? null : opt.value);
                  close();
                }}
              >
                <opt.icon size={15} />
                {opt.label}
                {active && <Check size={14} className="mode-menu-check" />}
              </button>
            );
          })}
          <p className="mode-menu-note">
            {MODE_OPTIONS.find((o) => o.value === intent)?.hint}
            {intent === storeMode && !visitorMode ? ' — the store default.' : '.'}
          </p>
        </div>
      )}
    </NavPopover>
  );
}
