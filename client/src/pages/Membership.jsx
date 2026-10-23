import ProgressBar from '../components/ProgressBar';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import { headStartLabel, tierPerks } from '../utils/headStart';
import {
  Award, TrendingUp, Wallet, Users, Clock, Info, ArrowRight, Lock, ShoppingBag,
} from 'lucide-react';

/**
 * The customer's own view of their membership.
 *
 * Written to be auditable rather than merely decorative: the tier, the spend
 * that earned it, the window it is measured over, and the individual orders
 * that make up the total are all shown, so a customer can check the number
 * instead of taking it on faith.
 */

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const moneyShort = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Days until the oldest qualifying order drops out of the window. */
function daysUntilDrop(order, windowDays) {
  if (!order?.counted_at) return null;
  const age = (Date.now() - new Date(order.counted_at).getTime()) / 86400000;
  return Math.max(0, Math.ceil(windowDays - age));
}

/** Inside this many days of leaving, an order is drawn as "leaving soon". */
const LEAVING_SOON_DAYS = 7;

/**
 * The rolling window as a queue.
 *
 * This used to be a percentage bar. The number it showed was right and the
 * thing it hid was the mechanism: a tier is not earned once, it is HELD by a
 * window that rolls, and the bar could not show an order about to fall out
 * of it. So the bar is now the queue itself. Each counted order is one
 * segment, its width the share of the next tier's threshold it pays for;
 * newest orders enter at the left, the oldest stand at the right, nearest
 * the exit, and the ones that leave within a week are lit and hatched. The
 * filled length is still the progress — the same figure the bar used to
 * show — and the empty remainder is still what is left to spend.
 *
 * Hatch AND colour for the leaving-soon segments, so the warning survives
 * `--glow-strength: 0` and a colour-blind reader. Segments slide in from the
 * entry side on first paint, staggered, because entering is what they did;
 * under reduced motion the queue is drawn where it stands.
 */
function WindowQueue({ orders, spend, target, windowDays, locked, currentTier, nextTier }) {
  const list = Array.isArray(orders) ? orders : [];
  // Denominator: the next threshold; at the top tier, what has been spent
  // (the queue is full by definition). Zero-safe.
  const denom = Math.max(Number(target) || 0, 0) || Math.max(Number(spend) || 0, 0) || 1;
  // Newest first so the queue reads entry → exit left to right.
  const sorted = [...list].sort((a, b) => new Date(b.counted_at) - new Date(a.counted_at));
  const raw = sorted.map((o) => ({ o, pct: (Number(o.total) || 0) / denom * 100 }));
  const sumPct = raw.reduce((s, r) => s + r.pct, 0);
  // Over the threshold the queue is clamped to the track and the overflow is
  // said in words: a bar that drew 140% would be a bar with no edge to read.
  const scale = sumPct > 100 ? 100 / sumPct : 1;
  const over = sumPct > 100 ? (Number(spend) || 0) - denom : 0;

  if (locked) {
    return (
      <div className="member-queue is-locked" aria-hidden="true">
        <span className="member-queue-track"><span className="member-queue-seg is-locked" style={{ '--w': '100%' }} /></span>
      </div>
    );
  }

  return (
    <div className="member-queue">
      <div
        className="member-queue-track"
        role="img"
        aria-label={`${list.length} order${list.length === 1 ? '' : 's'} in the ${windowDays}-day window, ${money(spend)} of ${money(denom)}`}
      >
        {raw.map(({ o, pct }, idx) => {
          const days = daysUntilDrop(o, windowDays);
          const soon = days != null && days <= LEAVING_SOON_DAYS;
          return (
            <span
              key={o.id}
              className={`member-queue-seg${soon ? ' is-leaving' : ''}`}
              style={{ '--w': `${Math.max(pct * scale, 1.2)}%`, '--i': idx }}
              title={`#${o.id} · ${money(o.total)} · ${soon ? `leaves in ${days} day${days === 1 ? '' : 's'}` : `leaves in ${days}d`}`}
            />
          );
        })}
        {!nextTier && list.length > 0 && <span className="member-queue-full" aria-hidden="true" />}
      </div>
      <div className="member-queue-axis" aria-hidden="true">
        <span>new orders enter here</span>
        <span>
          {over > 0
            ? `${money(over)} over the ${nextTier ? nextTier.name : currentTier?.name || 'tier'} line`
            : nextTier ? `${nextTier.name} at ${money(denom)}` : 'top of the ladder'}
        </span>
        <span>oldest leave here →</span>
      </div>
      {raw.some(({ o }) => (daysUntilDrop(o, windowDays) ?? Infinity) <= LEAVING_SOON_DAYS) && (
        <p className="member-queue-note">
          <span className="member-queue-key" aria-hidden="true" />
          Lit segments leave the window within {LEAVING_SOON_DAYS} days — the tier drops with them unless a new order takes their place.
        </p>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, action, children, style }) {
  return (
    <section className="glass-card" style={{ marginTop: 'var(--sp-5)', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)', flexWrap: 'wrap' }}>
        <h2 style={{
          margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 700, letterSpacing: '0.12em',
          textTransform: 'uppercase', color: 'var(--primary)', fontFamily: 'var(--font-display)',
          display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
        }}>
          {Icon && <Icon size={14} />} {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, note }) {
  return (
    <div className="member-stat">
      <div className="member-stat-label">{label}</div>
      <div className="member-stat-value">{value}</div>
      {note && <div className="member-stat-note">{note}</div>}
    </div>
  );
}

export default function Membership() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/tiers/me')
      .then(setData)
      .catch((err) => setError(err.message || 'Could not load your membership'))
      .finally(() => setLoading(false));
  }, []);

  const windowDays = data?.window_days ?? 30;
  const tierColor = data?.tier?.color || 'var(--primary)';

  // The order that will age out first — the one that could cost them the tier.
  const oldestQualifying = useMemo(() => {
    const orders = data?.qualifying_orders || [];
    if (!orders.length) return null;
    return orders[orders.length - 1];
  }, [data]);

  if (loading) {
    return (
      <div className="page container" style={{ textAlign: 'center' }}>
        <ProgressBar label="Loading…" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page container">
        <div className="empty-state">
          <h3>Membership unavailable</h3>
          <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
        </div>
      </div>
    );
  }

  const spend = data.spend_window || 0;
  const progressPct = Math.round((data.progress || 0) * 100);
  const hasTier = !!data.tier;

  return (
    <div className="page container" style={{ maxWidth: 900 }}>
      <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-25)' }}>
        <Award size={22} style={{ color: 'var(--primary)' }} /> Membership
      </h1>

      {/* Hero — the tier itself */}
      <div className="member-hero" style={{ '--tier': tierColor }}>
        <div className="member-hero-top">
          <div style={{ minWidth: 0 }}>
            <div className="member-tier-name">{data.tier?.name || 'No tier yet'}</div>
            {/* The head start leads when the tier carries one — it is the perk the
                big discount block beside this cannot show, and a customer who holds
                a day's early access on drops should read that here, not discover
                it on a product page. The operator's description follows it. */}
            <div className="member-tier-sub">
              {[
                hasTier && headStartLabel(data.tier?.early_access_minutes)
                  ? `${headStartLabel(data.tier.early_access_minutes)} early access to scheduled drops`
                  : null,
                data.tier?.description || null,
              ].filter(Boolean).join(' · ')
                || (hasTier ? 'Your current membership tier' : `Spend ${moneyShort(data.next_tier?.min_spend_30d || 0)} in ${windowDays} days to earn your first tier`)}
            </div>
          </div>

          {hasTier && data.discount_pct > 0 && (
            <div className="member-discount">
              <span className="member-discount-num">{data.discount_pct}%</span>
              <span className="member-discount-lbl">off every order</span>
            </div>
          )}
        </div>

        {/* Progress to the next rung */}
        <div className="member-progress">
          <div className="member-progress-head">
            {data.locked ? (
              <span style={{ color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 'var(--sp-15)' }}>
                <Lock size={13} /> This tier is set by the store and stays regardless of spend
              </span>
            ) : data.next_tier ? (
              <>
                <span style={{ color: 'var(--text-secondary)' }}>
                  <strong style={{ color: 'var(--text)' }}>{money(data.remaining_to_next)}</strong> more
                  in the next {windowDays} days to reach{' '}
                  <strong style={{ color: data.next_tier.color || 'var(--text)' }}>{data.next_tier.name}</strong>
                  {tierPerks(data.next_tier, { fallback: '' }) && <> ({tierPerks(data.next_tier)})</>}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{progressPct}%</span>
              </>
            ) : (
              <span style={{ color: 'var(--success)' }}>You’ve reached the highest tier.</span>
            )}
          </div>
          <WindowQueue
            orders={data.qualifying_orders}
            spend={spend}
            target={data.next_tier?.min_spend_30d}
            windowDays={windowDays}
            locked={!!data.locked}
            currentTier={data.tier}
            nextTier={data.next_tier}
          />
        </div>

        <div className="member-stats">
          <Stat
            label={`Spent · last ${windowDays}d`}
            value={money(spend)}
            note="Counts paid, accepted, shipped and delivered orders"
          />
          <Stat label="Lifetime spend" value={money(data.lifetime_spend)} note={`${data.lifetime_orders} order${data.lifetime_orders === 1 ? '' : 's'}`} />
          {/* Not "Applied at checkout": the checkout toggle is deliberately off
              by default so a balance is never spent by accident, so promising
              automatic application made a correctly full-price order read as a
              bug. */}
          <Stat label="Store credit" value={money(data.store_credit)}
            note={data.store_credit > 0 ? 'Opt in at checkout to use it' : 'Earn credit by referring'} />
          <Stat label="Member since" value={formatDate(data.member_since)} note={data.member_since ? undefined : 'No completed orders yet'} />
        </div>
      </div>

      {/* How it works — stated plainly, because a tier nobody understands is noise */}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-25)', marginTop: 'var(--sp-4)',
        padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', background: 'rgba(var(--tint-rgb), 0.02)',
        fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.6,
      }}>
        <Info size={15} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 'var(--sp-05)' }} />
        <span>
          Your tier is worked out from what you spent over the last <strong>{windowDays} days</strong>, and
          it updates on its own. Because the window rolls, older orders eventually stop counting —
          so a tier is kept by continuing to shop, not earned once.
          {oldestQualifying && !data.locked && (
            <> Your oldest counting order ({money(oldestQualifying.total)}) drops out
              in <strong>{daysUntilDrop(oldestQualifying, windowDays)} day(s)</strong>.</>
          )}
        </span>
      </div>

      {/* The ladder */}
      <Section icon={TrendingUp} title="Tiers">
        <div className="tier-ladder">
          {(data.ladder || []).map((t) => {
            const reached = spend >= t.min_spend_30d;
            const current = data.tier?.id === t.id;
            const cls = ['tier-rung', reached ? 'reached' : '', current ? 'current' : '', !reached ? 'locked-out' : ''].filter(Boolean).join(' ');
            return (
              <div key={t.id} className={cls} style={{ '--tier': t.color || 'var(--primary)' }}>
                <span className={`tier-rung-dot${reached ? '' : ' pending'}`} />
                <div style={{ minWidth: 0 }}>
                  <div className="tier-rung-name">
                    {t.name}
                    {current && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 'var(--fs-xs)' }}> · your tier</span>}
                  </div>
                  {/* What the tier gets you — the discount and the head start on
                      drops — rather than the discount and a label. This line used to
                      read "5% off every order · Valued customer", and the one fact a
                      customer could not find anywhere on this page was the early
                      access their tier already carried. The operator's description
                      keeps its place beneath, when there is one. */}
                  <div className="tier-rung-meta">{tierPerks(t)}</div>
                  {t.description && <div className="tier-rung-desc">{t.description}</div>}
                </div>
                <div className="tier-rung-req">
                  {t.min_spend_30d > 0
                    ? <>{moneyShort(t.min_spend_30d)} <span style={{ color: 'var(--text-muted)' }}>/ {windowDays}d</span></>
                    : <span style={{ color: 'var(--text-muted)' }}>Entry tier</span>}
                  {!reached && t.min_spend_30d > spend && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                      {money(t.min_spend_30d - spend)} to go
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {(!data.ladder || data.ladder.length === 0) && (
            <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-base)', margin: 0 }}>
              This store has not set up membership tiers yet.
            </p>
          )}
        </div>
      </Section>

      {/* The orders behind the number */}
      <Section
        icon={ShoppingBag}
        title={`Orders counting toward your tier`}
        action={<Link to="/orders" className="glass-btn glass-btn-sm" style={{ fontSize: 'var(--fs-xs)' }}>All orders <ArrowRight size={12} /></Link>}
      >
        {/* DESIGN §6 — this list is a RESPONSIVE TABLE: one `.admin-rtable`,
            not two purpose-built views and not a cards/rows toggle. Five short
            fields, no thumbnail, no progress bar and nothing to swipe, so the
            phone wants the same record in the same order, stacked — which is
            precisely the shape `.admin-rtable` draws below 720px. Two views
            here would be two things to keep in step for no gain.

            The failure it removes: this was five columns inside an
            `overflow-x: auto` wrapper, so on a 375px phone the amount and the
            date the order leaves the window — the two figures a customer opens
            this page to check — sat off the right edge with nothing on screen
            to say they were there. Every cell now prints its own heading from
            `data-label`; nothing is hidden to make it fit, because this table
            is the audit trail behind the tier figure and a dropped column is a
            number the customer can no longer check. */}
        {data.qualifying_orders?.length ? (
          <div className="member-orders-wrap admin-rtable-wrap">
            <table className="member-orders admin-rtable">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Counted</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">Amount</th>
                  <th scope="col" className="num">Leaves window</th>
                </tr>
              </thead>
              <tbody>
                {data.qualifying_orders.map((o) => (
                  <tr key={o.id}>
                    <td data-label="Order">
                      <Link to={`/orders/${o.id}`} className="member-orders-id">
                        #{o.id}
                      </Link>
                    </td>
                    <td data-label="Counted" style={{ color: 'var(--text-secondary)' }}>{formatDate(o.counted_at)}</td>
                    <td data-label="Status"><span className={`status-${o.status}`} style={{ fontSize: 'var(--fs-sm)' }}>{o.status}</span></td>
                    <td data-label="Amount" className="num">{money(o.total)}</td>
                    <td data-label="Leaves window" className="num member-orders-drop">
                      in {daysUntilDrop(o, windowDays)}d
                    </td>
                  </tr>
                ))}
              </tbody>
              {/* The sum stays a real `<tfoot>` rather than a paragraph under
                  the table: it is the number every row above it justifies, and
                  a screen reader should meet it as the table's own summary.
                  38-responsive-admin-tables.css only blockifies table/tbody/
                  tr/td, so 26-membership.css re-draws the footer as a lit
                  summary card once the rows become cards — the label cell
                  carries the wording, and the figure keeps `.num` so it lands
                  under the amounts it totals. */}
              <tfoot>
                <tr>
                  <td colSpan={3}>Total in window</td>
                  <td className="num">{money(spend)}</td>
                  <td className="member-orders-pad" aria-hidden="true" />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          /* §9: an empty state is navigation. "No orders yet" left someone on
             the page that just told them their tier is slipping with no way to
             do anything about it. */
          <div className="empty-state">
            <ShoppingBag size={34} aria-hidden="true" />
            <h3>Nothing counting yet</h3>
            <p>
              An order joins this list the moment its payment is confirmed, and stays in it for{' '}
              {windowDays} days. Nothing has been confirmed in that window.
            </p>
            <div className="empty-state-links">
              <Link to="/products" className="glass-btn glass-btn-primary">Browse products</Link>
              <Link to="/orders" className="glass-btn">Your orders</Link>
            </div>
          </div>
        )}
      </Section>

      {/* Sub-users, if this account has any */}
      {data.sub_users?.length > 0 && (
        <Section
          icon={Users}
          title="Your sub-users"
          action={<Link to="/subusers" className="glass-btn glass-btn-sm" style={{ fontSize: 'var(--fs-xs)' }}>Sub-users <ArrowRight size={12} /></Link>}
        >
          <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: '0 0 0.85rem', lineHeight: 1.6 }}>
            Accounts you referred. Your markup is added to the price they pay, and the difference is
            credited to you.
          </p>
          <div style={{ display: 'grid', gap: 'var(--sp-2)' }}>
            {data.sub_users.map((su) => (
              <div key={su.user_id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: 'var(--sp-4)', padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', background: 'rgba(var(--tint-rgb), 0.02)',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{su.username}</div>
                  <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>since {formatDate(su.since)}</div>
                </div>
                <span className="badge badge-primary" style={{ whiteSpace: 'nowrap' }}>
                  +{su.markup_kind === 'amount'
                    ? `$${Number(su.markup_value || 0).toFixed(2)} an item`
                    : `${Number(su.markup_value || 0)}%`} markup
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Being somebody else's sub-user changes the prices this customer sees,
          so it is stated rather than left as an unexplained difference. */}
      {data.parent_markup && data.parent_markup.value > 0 && (
        <Section icon={Wallet} title="Your pricing">
          <p style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.65 }}>
            You were referred by another account, and a{' '}
            <strong style={{ color: 'var(--text)' }}>
              {data.parent_markup.kind === 'amount'
                ? `$${Number(data.parent_markup.value).toFixed(2)} per item`
                : `${Number(data.parent_markup.value)}%`}
            </strong>{' '}
            markup is included in the prices you see. Any tier discount you earn is applied on top of that.
          </p>
        </Section>
      )}

      <p style={{
        fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 'var(--sp-5)',
        display: 'flex', alignItems: 'center', gap: 'var(--sp-15)',
      }}>
        <Clock size={11} /> Spend figures update within a minute of an order being confirmed.
      </p>
    </div>
  );
}
