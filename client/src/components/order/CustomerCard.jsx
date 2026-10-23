import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Ban, CalendarDays, ChevronDown, CreditCard, ExternalLink, Gavel, KeyRound,
  Lock, Mail, MessageSquare, Package, ShieldCheck, Star, User, Wallet,
} from 'lucide-react';

/**
 * Who the customer is, on the staff side of an order page.
 *
 * Staff opening an order to decide something about it — ship it, refund it,
 * believe a dispute — were shown the order and nothing about the person. The
 * facts that actually inform those decisions (is this their first order or
 * their fortieth, have they disputed three of them, do they hold store credit,
 * are they on a tier) all existed, spread across the admin user list and the
 * analytics pages, and none of it was reachable from here.
 *
 * Everything rendered comes from the order payload, gated server-side by the
 * same permissions that gate the order's own fields — a viewer without
 * `orders.view_customer` never receives this object at all, so there is no
 * client-side hiding to get wrong.
 *
 * Money figures arrive as `null` rather than `0` when withheld, which is the
 * distinction that matters: "we are not telling you" and "they have never spent
 * anything" look identical as a zero and mean opposite things.
 */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

function relDays(value) {
  if (!value) return null;
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (!Number.isFinite(days)) return null;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** Two letters from the username, for the monogram. */
function initials(name) {
  const s = String(name || '?').trim();
  const parts = s.split(/[\s_.-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function Stat({ icon: Icon, label, value, tone, title }) {
  return (
    <div className="ocust-stat" style={tone ? { '--ocust-stat-tone': tone } : undefined} title={title}>
      <span className="ocust-stat-label">
        <Icon size={11} aria-hidden="true" /> {label}
      </span>
      <span className="ocust-stat-value">{value}</span>
    </div>
  );
}

function Flag({ on, onLabel, offLabel, icon: Icon, tone = 'var(--success)' }) {
  return (
    <span className={`ocust-flag${on ? ' is-on' : ''}`} style={{ '--ocust-flag-tone': tone }}>
      <Icon size={10} aria-hidden="true" />
      {on ? onLabel : offLabel}
    </span>
  );
}

export default function CustomerCard({ customer, orderRef }) {
  const [open, setOpen] = useState(false);
  if (!customer) return null;

  const c = customer;
  const tierColor = c.tier?.color || 'var(--text-muted)';

  // "Has this person had trouble before" is the single most useful thing on the
  // card, so it gets a tone rather than being one number among six.
  const troubled = (c.dispute_count || 0) > 0 || (c.refunded_count || 0) > 0;

  return (
    <section
      className={`glass-card ocust${c.active === false ? ' is-banned' : ''}`}
      style={{ '--ocust-tone': c.active === false ? 'var(--danger)' : tierColor }}
      aria-label="Customer information"
    >
      <span className="ocust-rail" aria-hidden="true" />

      <header className="ocust-head">
        <span className="ocust-avatar" aria-hidden="true">{initials(c.username)}</span>

        <div className="ocust-id">
          <h3 className="ocust-name">
            {c.username}
            {c.role !== 'user' && <span className="ocust-role">{c.role}</span>}
          </h3>
          <div className="ocust-sub">
            {c.tier
              ? (
                <span className="ocust-tier">
                  <span className="ocust-tier-swatch" style={{ background: tierColor }} />
                  {c.tier.name}
                  {c.tier.discount_pct > 0 && <> · {Number(c.tier.discount_pct)}% off</>}
                  {c.tier.locked && <> · pinned</>}
                </span>
              )
              : <span className="ocust-tier is-none">No tier</span>}
            {c.created_at && (
              <>
                <span aria-hidden="true">·</span>
                <span title={new Date(c.created_at).toLocaleString()}>
                  <CalendarDays size={11} aria-hidden="true" /> joined {relDays(c.created_at)}
                </span>
              </>
            )}
          </div>
        </div>

        <Link
          to={`/admin/users?search=${encodeURIComponent(c.username)}`}
          className="glass-btn glass-btn-sm ocust-open"
          title="Open this account in user management"
        >
          <ExternalLink size={13} aria-hidden="true" />
          <span className="ocust-open-label">Account</span>
        </Link>
      </header>

      {c.active === false && (
        <p className="ocust-banned-note">
          <Ban size={13} aria-hidden="true" />
          This account is banned. It cannot sign in, and its bot links have been cut.
        </p>
      )}

      <div className="ocust-stats">
        <Stat icon={Package} label="Orders" value={c.order_count} />
        <Stat icon={ShieldCheck} label="Paid" value={c.paid_count} tone="var(--success)" />
        <Stat
          icon={Gavel}
          label="Disputes"
          value={c.dispute_count}
          tone={c.dispute_count > 0 ? 'var(--danger)' : undefined}
        />
        <Stat
          icon={Wallet}
          label="Lifetime"
          value={c.lifetime_spend == null ? <span className="ocust-hidden">hidden</span> : money(c.lifetime_spend)}
          title={c.lifetime_spend == null ? 'Needs the order amounts permission' : undefined}
        />
      </div>

      <button
        type="button"
        className="glass-btn glass-btn-sm ocust-more"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${open ? 'Hide' : 'Show'} more about ${c.username}`}
      >
        {open ? 'Less' : 'More about this customer'}
        <ChevronDown size={13} aria-hidden="true" />
      </button>

      <div className={`ocust-drawer${open ? ' is-open' : ''}`}>
        <div className="ocust-drawer-clip">
          <div className="ocust-drawer-inner" inert={open ? undefined : true}>
            <dl className="ocust-rows">
              <div className="ocust-row">
                <dt>Store credit</dt>
                <dd>
                  {c.store_credit == null
                    ? <span className="ocust-hidden">hidden</span>
                    : <strong>{money(c.store_credit)}</strong>}
                </dd>
              </div>
              <div className="ocust-row">
                <dt>Cancelled / refunded</dt>
                <dd className={troubled ? 'is-warn' : undefined}>
                  {c.cancelled_count} / {c.refunded_count}
                </dd>
              </div>
              <div className="ocust-row">
                <dt>Reviews written</dt>
                <dd><Star size={11} aria-hidden="true" /> {c.review_count}</dd>
              </div>
              <div className="ocust-row">
                <dt>Last order</dt>
                <dd title={c.last_order_at ? new Date(c.last_order_at).toLocaleString() : undefined}>
                  {relDays(c.last_order_at) || '—'}
                </dd>
              </div>
              {c.referred_by && (
                <div className="ocust-row">
                  <dt>Referred by</dt>
                  <dd><User size={11} aria-hidden="true" /> {c.referred_by.username}</dd>
                </div>
              )}
            </dl>

            <div className="ocust-flags">
              <span className="ocust-flags-label">Payment rails</span>
              <div className="ocust-flag-row">
                <Flag on={c.rails?.cash_in_mail} icon={Mail} onLabel="Cash in mail" offLabel="No cash in mail" />
                <Flag on={c.rails?.zelle} icon={CreditCard} onLabel="Zelle" offLabel="No Zelle" />
              </div>
            </div>

            <div className="ocust-flags">
              <span className="ocust-flags-label">Security</span>
              <div className="ocust-flag-row">
                <Flag on={c.security?.has_pgp_key} icon={KeyRound} onLabel="PGP key" offLabel="No PGP key" tone="var(--info)" />
                <Flag
                  on={c.security?.two_factor && c.security.two_factor !== 'disabled'}
                  icon={ShieldCheck}
                  onLabel={c.security?.two_factor === 'totp' ? 'Authenticator 2FA' : 'PGP 2FA'}
                  offLabel="No 2FA"
                  tone="var(--info)"
                />
                {c.security?.pgp_login_only && (
                  <Flag on icon={KeyRound} onLabel="Key-only sign-in" offLabel="" tone="var(--info)" />
                )}
                {c.security?.encrypts_address && (
                  <Flag on icon={Lock} onLabel="Encrypts address" offLabel="" tone="var(--primary)" />
                )}
              </div>
            </div>

            {c.contact && (
              <div className="ocust-flags">
                <span className="ocust-flags-label">Reachable on</span>
                <div className="ocust-flag-row">
                  <Flag on={c.contact.telegram_linked} icon={MessageSquare} onLabel="Telegram" offLabel="No Telegram" tone="var(--info)" />
                  <Flag on={c.contact.potato_linked} icon={MessageSquare} onLabel="Potato" offLabel="No Potato" tone="var(--info)" />
                </div>
              </div>
            )}

            <p className="ocust-foot">
              Figures cover every order on this account, not just {orderRef ? `order ${orderRef}` : 'this one'}.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
