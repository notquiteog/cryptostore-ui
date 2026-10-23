import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Megaphone, Plus, X, Copy, Check, Search, FilterX, MousePointerClick,
  UserPlus, ShoppingBag, Users, Coins, Pencil, Ban, Radio, EyeOff,
  ExternalLink, Infinity as InfinityIcon, Store, Link2,
} from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { hasAdminPermission } from '../../utils/adminPermissions';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import Pager from '../../components/admin/Pager';
import StatTiles from '../../components/admin/StatTiles';
import { count as fmtCount, money, relTime } from '../../utils/adminFormat';

/**
 * The marketing console.
 *
 * ── The question this page exists to answer ─────────────────────────────────
 *
 * "I posted a link on Instagram. Was it worth it?"
 *
 * The Analytics page could already say how many accounts each invite link
 * produced. It could not say how many people ever *saw* one, so every rate on
 * it had a numerator and no denominator, and a link nobody clicked looked
 * exactly like a link ten thousand people clicked and bounced off. Those are
 * opposite problems with opposite fixes, and an operator buying advertising
 * was choosing between them by guessing. This page has both halves.
 *
 * ── DESIGN §10 — the funnel is the flourish, and it does a job ──────────────
 *
 * The four figures are not four figures: they are one number losing people at
 * each of three steps, and the interesting thing about them is always WHERE
 * the loss is. A row of tiles states the numbers and hides the shape; the
 * funnel band draws each stage at its true proportion of the arrivals, so
 * "everybody clicks and nobody signs up" and "nobody clicks but everybody who
 * does buys" are different pictures before they are different numbers. The
 * drop between stages is printed as a percentage under each stage as well as
 * drawn, because a proportion that only exists as a width cannot be read off
 * with a screen reader and cannot survive somebody flattening every effect in
 * the theme.
 *
 * ── DESIGN §6 — responsive table, two views, or a toggle? ───────────────────
 *
 * One responsive list, built on `.lrows` / `.lrow` — the same machinery the
 * invite-links console and the credit ledger use, which already owns the
 * rhythm, the zebra, the hover/focus-within pair and the reserved action
 * space. A campaign row is a row of uniform facts (a URL, five counters, a
 * state) rather than something with a picture and a different field order on a
 * phone, so it does not earn a second purpose-built view. It carries a meter
 * per row and the meter re-flows with the container query the shared file
 * already provides. No toggle: there is one way to read a table of counters
 * and a second layout would be a control nobody can say who presses (§7).
 *
 * ── What is deliberately absent ─────────────────────────────────────────────
 *
 * There is no visitor list, no click log, no map, no per-person path, and no
 * way to get one, because the store does not record any of it: arrivals are a
 * per-day integer per link with no identity beside them. The page says so in
 * words rather than leaving an operator to wonder where the drill-down went —
 * and when the operator has switched even that off, it says that too instead
 * of drawing a column of honest zeroes that read as "nobody came".
 */

const LIMIT = 25;

/** The windows worth offering. 7 for "is the post working", 365 for the year. */
const WINDOWS = [
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
  { days: 365, label: '1y' },
];

const STATUS_META = {
  active: { label: 'Live', badge: 'badge-success', tone: 'var(--success)' },
  exhausted: { label: 'Filled', badge: 'badge-warning', tone: 'var(--warning)' },
  expired: { label: 'Expired', badge: 'badge-muted', tone: 'var(--text-muted)' },
  revoked: { label: 'Stopped', badge: 'badge-danger', tone: 'var(--danger)' },
};

const EMPTY_FORM = {
  label: '',
  ref_tag: '',
  channel: '',
  landing_path: '/register',
  price_markup_value: '0',
  price_markup_kind: 'percent',
  max_uses: '',
  expires_at: '',
};

/** `12.4%`, or a dash when the denominator is zero — never `0%`, which is a claim. */
function rate(part, whole) {
  if (!whole) return null;
  return (part / whole) * 100;
}

function pct(value) {
  if (value == null) return '—';
  if (value >= 100) return '100%';
  if (value >= 10) return `${Math.round(value)}%`;
  return `${value.toFixed(1)}%`;
}

/**
 * The full URL an operator copies, assembled in the browser.
 *
 * The server sends the path and never the origin, deliberately: the store's
 * address is whatever host this admin is actually on — a mirror, an onion, a
 * LAN address during setup — and a URL built server-side would hand a Tor
 * operator the clearnet address to go and print on something.
 */
function fullUrl(refPath) {
  return refPath ? `${window.location.origin}${refPath}` : '';
}

export default function Marketing() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  // Reading this page is `analytics.marketing`, which is deliberately a read
  // grant — an analyst can be given the funnel without being given the power
  // to mint a link that changes what people pay, or to stop the store
  // recording what it records. Both of those ride `users.invite_links`, so
  // both controls render only for somebody holding it. The state of the
  // switch is reported to every viewer either way: a report that silently
  // omitted "arrivals are not being counted" would have an analyst reading
  // zeroes as a failed campaign.
  const canManage = hasAdminPermission(user, 'users.invite_links');

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [days, setDays] = useState(90);
  const [channel, setChannel] = useState('');
  const [source, setSource] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);

  // Typed and applied are separate so the input stays responsive while the
  // request behind it is debounced — the same arrangement the invite-links
  // console uses, and the reason its search does not fire per keystroke.
  const [queryInput, setQueryInput] = useState(params.get('q') || '');
  const [query, setQuery] = useState(params.get('q') || '');
  useEffect(() => {
    const t = setTimeout(() => setQuery(queryInput.trim()), 300);
    return () => clearTimeout(t);
  }, [queryInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = new URLSearchParams({ days: String(days), page: String(page), limit: String(LIMIT) });
      if (channel) qs.set('channel', channel);
      if (source) qs.set('source', source);
      if (query) qs.set('q', query);
      setData(await api.get(`/marketing/admin/overview?${qs}`));
    } catch (err) {
      // Said in words above the page rather than as a toast that scrolls away:
      // the most common cause is the export limiter, and the operator needs to
      // still be able to read it when they come back to the tab.
      setError(err.message || 'Could not load the marketing report');
    } finally {
      setLoading(false);
    }
  }, [days, page, channel, source, query]);

  useEffect(() => { load(); }, [load]);

  // Filters reset the pager. Without this, narrowing from four pages to one
  // leaves the pager on page 3 and the list empty for a reason nothing on
  // screen explains.
  useEffect(() => { setPage(1); }, [days, channel, source, query]);

  useEffect(() => {
    const next = new URLSearchParams(params);
    if (query) next.set('q', query); else next.delete('q');
    if (channel) next.set('channel', channel); else next.delete('channel');
    setParams(next, { replace: true });
    // `params` is deliberately not a dependency: including it re-runs this on
    // its own write and loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, channel]);

  const totals = data?.totals;
  const filtered = !!(query || channel || source);
  const totalPages = Math.max(1, Math.ceil((data?.total || 0) / LIMIT));

  const stats = useMemo(() => {
    if (!totals) return [];
    return [
      {
        key: 'clicks', label: 'Arrivals', value: fmtCount(totals.clicks), icon: MousePointerClick, lead: true,
        hint: data.click_tracking ? 'People who followed a tagged link' : 'Arrival counting is off',
      },
      {
        key: 'views', label: 'Reached signup', value: fmtCount(totals.signup_views), icon: UserPlus,
        hint: pct(rate(totals.signup_views, totals.clicks)) + ' of arrivals',
      },
      {
        key: 'accounts', label: 'Accounts', value: fmtCount(totals.accounts), icon: Users,
        tone: 'var(--primary)',
        hint: pct(rate(totals.accounts, totals.clicks)) + ' of arrivals',
      },
      {
        key: 'buyers', label: 'Buyers', value: fmtCount(totals.buyers), icon: ShoppingBag,
        hint: pct(rate(totals.buyers, totals.accounts)) + ' of accounts',
      },
      {
        key: 'orders', label: 'Orders', value: fmtCount(totals.orders), icon: ShoppingBag,
      },
      // Redacted rather than shown as $0.00, which is a different claim — the
      // same rule the rest of the reporting surface follows.
      {
        key: 'revenue', label: 'Revenue',
        value: data.revenue_hidden ? '—' : money(totals.revenue),
        icon: Coins, tone: 'var(--success)',
        hint: data.revenue_hidden ? 'Needs the revenue permission' : undefined,
      },
    ];
  }, [totals, data]);

  const clearFilters = () => {
    setQueryInput(''); setQuery(''); setChannel(''); setSource('');
  };

  const afterWrite = async (message) => {
    toast.success(message);
    setShowCreate(false);
    setEditing(null);
    await load();
  };

  const revoke = async (link) => {
    if (!confirm(
      `Stop ${link.label || link.ref_tag || link.code}?\n\n`
      + 'The link stops admitting new signups immediately. Everyone who already used it keeps '
      + 'their account and their price, and its numbers stay on this page.'
    )) return;
    try {
      await api.delete(`/subusers/admin/invite-links/${link.id}`);
      await afterWrite('Link stopped');
    } catch (err) {
      toast.error(err.message || 'Could not stop that link');
    }
  };

  return (
    <div className="page mkt-page">
      <PageHeader
        icon={Megaphone}
        title="Marketing"
        subtitle={totals
          ? `${fmtCount(totals.links)} tracking ${totals.links === 1 ? 'link' : 'links'}`
            + ` · ${fmtCount(totals.clicks)} arrivals · ${fmtCount(totals.accounts)} accounts in the last ${days} days`
          : 'Tracking links, and what each one brought in'}
      >
        {/* `staff-marketing` reads `marketingController.overview` — the same
            query that drew the tiles above — so the answer and the page cannot
            disagree, and the money and the names in it are redacted by the
            page's own rules rather than by anything the topic knows. */}
        <AskAbout
          question="How are the tracking links doing? How many clicks, signups and orders did they bring in over the last month, and which links are busiest?"
          label="Ask"
          title="Ask the assistant how the tracking links are performing"
        />
        <div className="mkt-window" role="group" aria-label="Reporting window">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              className={`glass-btn glass-btn-sm${days === w.days ? ' glass-btn-primary' : ''}`}
              onClick={() => setDays(w.days)}
              aria-pressed={days === w.days}
            >
              {w.label}
            </button>
          ))}
        </div>
        {canManage && (
          <button type="button" className="glass-btn glass-btn-primary" onClick={() => { setEditing(null); setShowCreate(true); }}>
            <Plus size={16} aria-hidden="true" /> New link
          </button>
        )}
      </PageHeader>

      {error && <p className="mkt-error">{error}</p>}

      {/* Said once, at the top, and only when it is true: a page of zeroes with
          no explanation is a page that looks broken. Everybody who can read the
          report sees the notice; only somebody who can manage links gets the
          switch, and without it the sentence still says where the decision
          lives rather than dangling a control that would 403. */}
      {data && !data.click_tracking && (
        <p className="mkt-notice">
          <EyeOff size={14} aria-hidden="true" />
          <span>
            This store is not counting arrivals, so the arrivals column stays at zero.
            Accounts, buyers and orders are worked out from the accounts themselves and are unaffected.
          </span>
          {canManage && <TrackingToggle enabled={false} onDone={load} />}
        </p>
      )}

      <StatTiles stats={stats} />

      {totals && <Funnel totals={totals} days={days} />}

      {data?.channels?.length > 0 && (
        <Channels
          channels={data.channels}
          active={channel}
          revenueHidden={data.revenue_hidden}
          onPick={(c) => setChannel(c === channel ? '' : c)}
        />
      )}

      <div className="mkt-toolbar">
        <label className="mkt-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="glass-input"
            type="search"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            placeholder="Tag, label, channel or code"
            aria-label="Search tracking links"
          />
        </label>
        <div className="mkt-source" role="group" aria-label="Who made the link">
          {[
            { key: '', label: 'All' },
            { key: 'admin', label: 'Store' },
            { key: 'user', label: 'Customer' },
          ].map((s) => (
            <button
              key={s.key || 'all'}
              type="button"
              className={`glass-btn glass-btn-sm${source === s.key ? ' glass-btn-primary' : ''}`}
              onClick={() => setSource(s.key)}
              aria-pressed={source === s.key}
            >
              {s.label}
            </button>
          ))}
        </div>
        {filtered && (
          <button type="button" className="glass-btn glass-btn-sm" onClick={clearFilters}>
            <FilterX size={13} aria-hidden="true" /> Clear
          </button>
        )}
      </div>

      <LinkList
        links={data?.links || []}
        loading={loading}
        filtered={filtered}
        canManage={canManage}
        revenueHidden={data?.revenue_hidden}
        namesHidden={data?.names_hidden}
        clickTracking={data?.click_tracking}
        onClear={clearFilters}
        onCreate={() => { setEditing(null); setShowCreate(true); }}
        onEdit={(link) => { setShowCreate(false); setEditing(link); }}
        onRevoke={revoke}
      />

      {totalPages > 1 && (
        <Pager
          page={page}
          totalPages={totalPages}
          total={data?.total}
          noun="link"
          label="Tracking link pages"
          onChange={setPage}
        />
      )}

      {/* What the store does and does not keep, said on the page that would
          otherwise be the natural place to go looking for a drill-down that
          does not exist. §9's rule about dead ends applies to questions as
          well as to links: an operator who wonders where the visitor list is
          should find the answer here rather than in a settings hint. */}
      {data?.click_tracking && (
        <p className="mkt-privacy">
          Arrivals are counted as one number per link per day. No address, no browser, no
          per-visitor record — there is no visitor list on this page because the store does
          not keep one, and a seized copy of this database cannot produce one.
          {canManage && <TrackingToggle enabled onDone={load} />}
        </p>
      )}

      {/* §9 — where somebody goes from here. A campaign row is one end of a
          chain that runs through an account to an order to a credit movement,
          and every one of those has a console of its own. */}
      <nav className="mkt-onward" aria-label="Related pages">
        <Link to="/admin/invite-links" className="glass-btn glass-btn-sm"><Link2 size={13} /> Invite links</Link>
        <Link to="/admin/analytics" className="glass-btn glass-btn-sm">Analytics</Link>
        <Link to="/admin/users" className="glass-btn glass-btn-sm">Accounts</Link>
        <Link to="/admin/store-credit" className="glass-btn glass-btn-sm">Credit ledger</Link>
      </nav>

      {(showCreate || editing) && (
        <LinkForm
          link={editing}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={afterWrite}
        />
      )}
    </div>
  );
}

/**
 * The one control on this page that changes what the store records.
 *
 * Optimistic, with the previous value restored on failure — the same shape the
 * invite-links gate uses. It is a link rather than a switch because it is not
 * a preference somebody flips back and forth: turning counting off is a
 * decision about what a seized box can say, and the confirmation is where that
 * gets stated.
 */
function TrackingToggle({ enabled, onDone }) {
  const [busy, setBusy] = useState(false);

  const flip = async () => {
    const next = !enabled;
    if (!next && !confirm(
      'Stop counting arrivals?\n\n'
      + 'Existing counts are kept and the rest of this page keeps working — accounts, buyers, '
      + 'orders and revenue are worked out from the accounts themselves. What you lose is the '
      + 'denominator: you will no longer be able to tell a link nobody clicked from one '
      + 'everybody clicked and bounced off.'
    )) return;
    setBusy(true);
    try {
      await api.put('/settings', { marketing_click_tracking: next ? 'true' : 'false' });
      toast.success(next ? 'Counting arrivals again' : 'Arrivals are no longer counted');
      await onDone();
    } catch (err) {
      toast.error(err.message || 'Could not change the setting');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="glass-btn glass-btn-sm mkt-track-btn" onClick={flip} disabled={busy}>
      {enabled ? 'Stop counting' : 'Start counting'}
    </button>
  );
}

/* ── The funnel ───────────────────────────────────────────────────────────── */

/**
 * Four stages, drawn at their true proportion of the arrivals.
 *
 * Widths come from the arrivals figure, so the taper is the real loss rather
 * than a decorative shape — a store where nine in ten arrivals reach the
 * signup form gets a nearly straight band, which is exactly what should be
 * seen. When arrivals are not being counted the first stage has no honest
 * width, so the band scales from accounts instead and says so; drawing a full
 * bar from a number that does not exist would be inventing the very
 * denominator this page was built to supply.
 */
function Funnel({ totals, days }) {
  const base = totals.clicks || totals.accounts || 0;
  const fromClicks = totals.clicks > 0;

  const stages = [
    { key: 'clicks', label: 'Arrived', value: totals.clicks, icon: MousePointerClick },
    { key: 'views', label: 'Reached signup', value: totals.signup_views, icon: UserPlus },
    { key: 'accounts', label: 'Registered', value: totals.accounts, icon: Users },
    { key: 'buyers', label: 'Bought', value: totals.buyers, icon: ShoppingBag },
  ].filter((s) => fromClicks || s.key !== 'clicks');

  if (!base) {
    return (
      <div className="mkt-funnel is-empty">
        <p>
          Nothing has come through a tracking link in the last {days} days.
          A link only counts once somebody follows it.
        </p>
      </div>
    );
  }

  return (
    <section className="mkt-funnel" aria-label="Conversion funnel">
      <ol className="mkt-funnel-stages">
        {stages.map((stage, i) => {
          const prev = i === 0 ? null : stages[i - 1];
          const width = Math.max(4, Math.min(100, (stage.value / base) * 100));
          const carried = prev ? rate(stage.value, prev.value) : null;
          const Icon = stage.icon;
          return (
            <li key={stage.key} className="mkt-stage">
              <span className="mkt-stage-head">
                <Icon size={13} aria-hidden="true" />
                <span className="mkt-stage-label">{stage.label}</span>
                <span className="t-num mkt-stage-value">{fmtCount(stage.value)}</span>
              </span>
              {/* The bar is `aria-hidden` and the proportion is printed beside
                  it, so the shape is decoration over a figure rather than the
                  only way to read the number. */}
              <span className="mkt-stage-bar" aria-hidden="true">
                <span className="mkt-stage-fill" style={{ width: `${width}%` }} />
              </span>
              <span className="mkt-stage-foot">
                {prev
                  ? <>{pct(carried)} of {prev.label.toLowerCase()}</>
                  : <>everyone who followed a link</>}
              </span>
            </li>
          );
        })}
      </ol>
      {!fromClicks && (
        <p className="mkt-funnel-note">
          Scaled from registrations — this store does not count arrivals.
        </p>
      )}
    </section>
  );
}

/* ── Channels ─────────────────────────────────────────────────────────────── */

/**
 * The roll-up an operator picks a filter from.
 *
 * Deliberately computed over EVERY link rather than over the filtered page: a
 * roll-up that filtered itself by the filter would collapse to one row the
 * moment somebody used it, which is the point at which they need to compare it
 * against the others.
 */
function Channels({ channels, active, revenueHidden, onPick }) {
  return (
    <section className="mkt-channels" aria-label="Channels">
      {channels.map((c) => (
        <button
          key={c.channel}
          type="button"
          className={`mkt-channel${active === c.channel ? ' is-active' : ''}`}
          onClick={() => onPick(c.channel)}
          aria-pressed={active === c.channel}
        >
          <span className="mkt-channel-name">
            <Radio size={12} aria-hidden="true" /> {c.channel}
          </span>
          <span className="mkt-channel-figures t-num">
            <span title="Arrivals">{fmtCount(c.clicks)}</span>
            <span className="mkt-channel-sep" aria-hidden="true">→</span>
            <span title="Accounts">{fmtCount(c.accounts)}</span>
            {!revenueHidden && <span className="mkt-channel-money" title="Revenue">{money(c.revenue)}</span>}
          </span>
        </button>
      ))}
    </section>
  );
}

/* ── The list ─────────────────────────────────────────────────────────────── */

function LinkList({
  links, loading, filtered, canManage, revenueHidden, namesHidden, clickTracking,
  onClear, onCreate, onEdit, onRevoke,
}) {
  if (loading) {
    return (
      <div className="lrows mkt-rows" aria-busy="true" aria-label="Loading tracking links">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="lrow-skel mkt-skel" />)}
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div className="lrows mkt-rows">
        <div className="lrows-empty">
          <strong>{filtered ? 'No link matches that.' : 'No tracking links yet.'}</strong>
          {filtered
            ? 'Nothing in the store matches this filter and search.'
            : 'A tracking link is an ordinary invite link with a name you chose. Put ?ref=instagram on the end of any page and this console tells you what came back.'}
          <div className="lrows-empty-links">
            {filtered ? (
              <button type="button" className="glass-btn glass-btn-sm" onClick={onClear}>
                <FilterX size={13} aria-hidden="true" /> Clear filters
              </button>
            ) : canManage ? (
              <button type="button" className="glass-btn glass-btn-sm" onClick={onCreate}>
                <Plus size={13} aria-hidden="true" /> Create the first link
              </button>
            ) : null}
            <Link to="/admin/invite-links" className="glass-btn glass-btn-sm">Invite links</Link>
            <Link to="/admin/analytics" className="glass-btn glass-btn-sm">Analytics</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lrows mkt-rows">
      <div className="lrows-head mkt-head">
        <span>Link</span>
        <span className="mkt-num-head">{clickTracking ? 'Arrivals' : 'Arrivals (off)'}</span>
        <span className="mkt-num-head">Signups</span>
        <span className="mkt-num-head">Rate</span>
        <span className="mkt-num-head">Buyers</span>
        <span className="mkt-num-head">{revenueHidden ? '—' : 'Revenue'}</span>
        <span>State</span>
        <span aria-hidden="true" />
      </div>
      {links.map((link) => (
        <LinkRow
          key={link.id}
          link={link}
          canManage={canManage}
          revenueHidden={revenueHidden}
          namesHidden={namesHidden}
          onEdit={onEdit}
          onRevoke={onRevoke}
        />
      ))}
    </div>
  );
}

function LinkRow({ link, canManage, revenueHidden, namesHidden, onEdit, onRevoke }) {
  const meta = STATUS_META[link.status] || STATUS_META.revoked;
  const live = link.status === 'active';
  const conversion = rate(link.accounts, link.clicks);

  return (
    <div className={`lrow mkt-row${live ? '' : ' is-spent'}`} style={{ '--lrow-tone': meta.tone }}>
      <span className="lrow-stack mkt-ident">
        <span className="mkt-ident-top">
          <span className="lrow-text mkt-label">{link.label || <em className="mkt-dim">Unlabelled</em>}</span>
          {link.channel && <span className="badge badge-muted mkt-channel-tag">{link.channel}</span>}
        </span>
        <CopyUrl link={link} />
        <small className="mkt-provenance">
          {link.source === 'admin' ? <><Store size={10} aria-hidden="true" /> Store</> : <><Users size={10} aria-hidden="true" /> Customer</>}
          {/* Names are gated on `users.view` — a manager granted campaign
              reporting is not thereby granted the customer list — but whether
              a link PAYS somebody is kept either way, because it is the fact
              that changes how the row reads and it names nobody. */}
          {!namesHidden && link.referrer_username && link.referrer_user_id
            ? <> · pays <Link to={`/admin/users?id=${link.referrer_user_id}`}>{link.referrer_username}</Link></>
            : link.has_referrer ? <> · pays a customer</> : null}
          {link.created_at ? <> · {relTime(new Date(link.created_at).getTime())}</> : null}
        </small>
      </span>

      {/* `data-label` is what the card shape prints beside each figure once
          the column header is gone (110-marketing.css). Without it the phone
          view is a stack of five unnamed numbers — §5's rule that the mobile
          view is a re-flow and not a version with the labels deleted. */}
      <span className="t-num mkt-num" data-label="Arrivals">{fmtCount(link.clicks)}</span>
      {/* Accounts created in the reporting window — NOT `current_uses`, which
          is the link's lifetime total. Putting a windowed figure next to a
          lifetime cap in one cell is how a report comes to read `3/50` for a
          link that is actually full. The cap lives in the state cell, where
          the badge that depends on it already is. */}
      <span className="t-num mkt-num" data-label="Signups">{fmtCount(link.accounts)}</span>

      {/* The one derived figure on the row, and the one an operator actually
          compares links by. A dash rather than 0% when nobody arrived: with no
          denominator there is no rate, and printing 0% claims a link converted
          nobody when the truth is that nobody saw it. */}
      <span className="t-num mkt-num mkt-rate" data-label="Conversion">
        {conversion == null
          ? <span className="mkt-dim" title="Nothing arrived through this link in this window">—</span>
          : pct(conversion)}
      </span>

      <span className="t-num mkt-num" data-label="Buyers">{fmtCount(link.buyers)}</span>
      <span className="t-num mkt-num mkt-money" data-label="Revenue">
        {revenueHidden ? <span className="mkt-dim">—</span> : money(link.revenue)}
      </span>

      <span className="mkt-state">
        <span className={`badge ${meta.badge}`}>{meta.label}</span>
        {/* The fuse, where there is one. A capped link is a finite thing
            burning down and `12/50` states that without showing it; an
            uncapped one is not, and says so rather than drawing a full bar
            for "unlimited". Lifetime figures, both of them, so they agree
            with each other and with the badge beside them. */}
        {link.max_uses != null ? (
          <small className="mkt-cap t-num" title="Signups used, all time">
            {fmtCount(link.current_uses)}<span className="mkt-dim">/{fmtCount(link.max_uses)}</span>
            <span className="mkt-meter" aria-hidden="true">
              <span
                className="mkt-meter-fill"
                style={{ width: `${Math.min(100, (link.current_uses / link.max_uses) * 100)}%` }}
              />
            </span>
          </small>
        ) : (
          <small className="mkt-cap mkt-dim" title="No cap on signups">
            <InfinityIcon size={11} aria-hidden="true" /> {fmtCount(link.current_uses)} all time
          </small>
        )}
      </span>

      <span className="lrow-actions">
        {canManage ? (
          <>
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              onClick={() => onEdit(link)}
              title={`Edit ${link.label || link.ref_tag || link.code}`}
            >
              <Pencil size={13} aria-hidden="true" /> Edit
            </button>
            {live && (
              <button
                type="button"
                className="glass-btn glass-btn-sm glass-btn-danger"
                onClick={() => onRevoke(link)}
                title="Stop this link"
              >
                <Ban size={13} aria-hidden="true" /> Stop
              </button>
            )}
          </>
        ) : null}
      </span>
    </div>
  );
}

/**
 * The URL, and the one thing anybody does with it.
 *
 * Confirms in place rather than only firing a toast — the toast appears in a
 * corner of the screen the eye is not on, having just clicked a control inside
 * a table. The tag is picked out of the string in the accent colour because it
 * is the half somebody chose and the half they will type back in if a link
 * cleaner eats the query string.
 */
function CopyUrl({ link }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const url = fullUrl(link.ref_path);
  const token = link.ref_tag || link.code;

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard is unavailable over plain HTTP and in hardened browsers, and
      // this store is often served over exactly those. Selecting the text is
      // the fallback rather than a silent no-op.
      toast.error('Could not copy — select the link and copy it manually');
    }
  };

  // Shown: the PATH. Copied: the whole URL.
  //
  // They differ on purpose. `https://your-store.example/products?ref=instagram`
  // is sixty characters of which the operator already knows the first thirty —
  // it is their own shop — and in a table column it truncates to `htt…`, which
  // identifies nothing. The path is short enough to read in place and is the
  // half that actually distinguishes one campaign row from another. The full
  // URL is on the clipboard, in the tooltip, and behind the open button, which
  // is every way anybody uses it.
  const shown = link.ref_path || '';
  const [before] = shown.split(token);

  return (
    <span className="ref-url mkt-url">
      <code title={url}>
        <span className="ref-url-lead">{before}</span>
        <span className="ref-url-tag">{token}</span>
      </code>
      <button type="button" className="glass-btn glass-btn-sm" onClick={copy} title="Copy link">
        {copied ? <><Check size={12} aria-hidden="true" /> Copied</> : <Copy size={12} aria-hidden="true" />}
        <span className="sr-only">Copy link</span>
      </button>
      <a
        href={link.ref_path}
        target="_blank"
        rel="noreferrer"
        className="glass-btn glass-btn-sm"
        title="Open the landing page"
      >
        <ExternalLink size={12} aria-hidden="true" />
        <span className="sr-only">Open landing page</span>
      </a>
    </span>
  );
}

/* ── Create and edit ──────────────────────────────────────────────────────── */

/**
 * One form for both, because they are the same object.
 *
 * The differences are two: creating picks a random code that can never be
 * changed afterwards, and editing shows the code it already has. Everything
 * else — the tag, the channel, where it lands, the markup, the cap, the
 * expiry — is editable for the life of the link, because a campaign gets
 * printed on things and "make a new one" is not a rename, it is splitting the
 * campaign's numbers across two rows.
 *
 * The markup carries a warning rather than a lock. It is the one field here
 * that touches money, and what it does is precise: `sub_users` stamps the
 * markup at registration, so changing it re-prices nobody who has already
 * signed up and changes the offer made to the next person through the door.
 * That is a real thing an operator means to do, and it is audit-logged.
 */
function LinkForm({ link, onClose, onSaved }) {
  const isEdit = !!link;
  const [form, setForm] = useState(() => (link ? {
    label: link.label || '',
    ref_tag: link.ref_tag || '',
    channel: link.channel || '',
    landing_path: link.landing_path || '/register',
    price_markup_value: String(link.price_markup_value ?? 0),
    price_markup_kind: link.price_markup_kind || 'percent',
    max_uses: link.max_uses == null ? '' : String(link.max_uses),
    expires_at: link.expires_at ? String(link.expires_at).slice(0, 10) : '',
  } : EMPTY_FORM));
  const [saving, setSaving] = useState(false);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        label: form.label,
        ref_tag: form.ref_tag,
        channel: form.channel,
        landing_path: form.landing_path,
        price_markup_value: form.price_markup_value,
        price_markup_kind: form.price_markup_kind,
        max_uses: form.max_uses,
        expires_at: form.expires_at || '',
      };
      if (isEdit) {
        await api.put(`/subusers/admin/invite-links/${link.id}`, body);
        onSaved('Link updated');
      } else {
        await api.post('/subusers/admin/invite-links', body);
        onSaved('Link created');
      }
    } catch (err) {
      toast.error(err.message || 'Could not save that link');
    } finally {
      setSaving(false);
    }
  };

  const origin = typeof window !== 'undefined' ? window.location.host : 'your-store';
  const landing = form.landing_path || '/register';

  return (
    <div
      className="mkt-sheet-backdrop glass-plate"
      role="dialog"
      aria-modal="true"
      aria-label={isEdit ? 'Edit link' : 'New tracking link'}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form className="glass-card mkt-sheet" onSubmit={submit}>
        <header className="mkt-sheet-head">
          <h2>{isEdit ? 'Edit link' : 'New tracking link'}</h2>
          <button type="button" className="glass-btn glass-btn-sm" onClick={onClose} aria-label="Close">
            <X size={15} aria-hidden="true" />
          </button>
        </header>

        <div className="form-group">
          <label htmlFor="mkt-label">What is it for</label>
          <input
            id="mkt-label" className="glass-input" value={form.label} onChange={set('label')}
            placeholder="Spring giveaway post" maxLength={128}
          />
          <p className="form-hint">Only ever shown to staff. Name it so you recognise it in six months.</p>
        </div>

        <div className="form-group">
          <label htmlFor="mkt-tag">Tag</label>
          <span className="ref-tag-field">
            <span className="ref-tag-prefix" title={`${origin}${landing}`}>{origin}{landing}{landing.includes('?') ? '&' : '?'}ref=</span>
            <input
              id="mkt-tag" value={form.ref_tag} onChange={set('ref_tag')}
              placeholder="instagram" maxLength={64} autoComplete="off" spellCheck="false"
            />
          </span>
          <p className="form-hint">
            Letters, numbers, dots, dashes and underscores. Leave it empty and the link works on its
            generated code instead — which is unguessable, and unreadable.
          </p>
        </div>

        <div className="mkt-sheet-pair">
          <div className="form-group">
            <label htmlFor="mkt-channel">Channel</label>
            <input
              id="mkt-channel" className="glass-input" value={form.channel} onChange={set('channel')}
              placeholder="instagram" maxLength={48} autoComplete="off"
            />
            <p className="form-hint">Groups several links together on this page. Optional.</p>
          </div>

          <div className="form-group">
            <label htmlFor="mkt-landing">Lands on</label>
            <input
              id="mkt-landing" className="glass-input" value={form.landing_path} onChange={set('landing_path')}
              placeholder="/register" maxLength={255} autoComplete="off"
            />
            <p className="form-hint">
              A path on this store — <code>/products</code>, <code>/</code>, a product page.
              Not a full URL: the address a visitor reaches you on is theirs, not yours.
            </p>
          </div>
        </div>

        <div className="mkt-sheet-pair">
          <div className="form-group">
            <label htmlFor="mkt-markup">Price markup</label>
            <div className="mkt-markup-row">
              <input
                id="mkt-markup" className="glass-input" type="number" min="0" step="0.01"
                value={form.price_markup_value} onChange={set('price_markup_value')}
              />
              <select
                className="glass-input" value={form.price_markup_kind}
                onChange={set('price_markup_kind')} aria-label="Markup kind"
              >
                <option value="percent">%</option>
                <option value="amount">$ per item</option>
              </select>
            </div>
            <p className="form-hint">
              {isEdit
                ? 'Changing this re-prices nobody who has already signed up — their markup was stamped when they registered. It changes what the next person through this link pays.'
                : 'Added to every price the accounts this link creates ever see. Leave at 0 for a plain campaign link.'}
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="mkt-max">Signup cap</label>
            <input
              id="mkt-max" className="glass-input" type="number" min="1" value={form.max_uses}
              onChange={set('max_uses')} placeholder="Unlimited"
            />
            <p className="form-hint">Empty means no cap.</p>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="mkt-expires">Stops working on</label>
          <input
            id="mkt-expires" className="glass-input" type="date" value={form.expires_at}
            onChange={set('expires_at')}
          />
          <p className="form-hint">Empty means it runs until you stop it.</p>
        </div>

        {isEdit && (
          <p className="form-hint">
            Code <code>{link.code}</code> — generated when the link was made and never changes,
            so anything already printed with it keeps working.
          </p>
        )}

        <div className="mkt-sheet-foot">
          <button type="button" className="glass-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="glass-btn glass-btn-primary" disabled={saving}>
            {saving ? <span className="spinner" /> : (isEdit ? 'Save changes' : 'Create link')}
          </button>
        </div>
      </form>
    </div>
  );
}
