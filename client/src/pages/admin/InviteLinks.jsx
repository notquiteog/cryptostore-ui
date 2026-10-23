import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Link2, Plus, X, Copy, Check, Trash2, Search, Users, FilterX, CreditCard,
  Infinity as InfinityIcon, CalendarClock, ShieldCheck, Store,
} from 'lucide-react';
import { api } from '../../utils/api';
import PageHeader from '../../components/admin/PageHeader';
import Pager from '../../components/admin/Pager';
import StatTiles from '../../components/admin/StatTiles';
import CreditAdjuster from '../../components/admin/CreditAdjuster';
import { num, count as fmtCount, money, relTime, untilTime } from '../../utils/adminFormat';

const LIMIT = 25;

/**
 * The invite links console.
 *
 * **What a link is.** A code that, used at registration, attaches the new
 * account to a referrer and stamps a permanent price markup on everything that
 * account ever buys. It is the only object in this store that quietly changes
 * what somebody pays, which is why the page an operator triages abuse from is
 * this one.
 *
 * **What was wrong with it.**
 *
 * · *It could not see past its own first page.* The page fetched `limit=100`
 *   and then filtered and searched that array in the browser. Every count, every
 *   status pill and every search was therefore scoped to the hundred most
 *   recent links: a store with four hundred showed "Revoked (0)" while holding
 *   forty revoked links, and searching a code that existed returned nothing
 *   unless the link was recent enough to already be on screen. It admitted this
 *   in a footnote — "showing the 100 most recent of 412" — under a filter bar
 *   whose numbers the footnote quietly invalidated. Filtering, searching,
 *   counting and paging are now all the server's job.
 *
 * · *Status was re-derived in the browser* from the raw columns, a second copy
 *   of the four-branch rule the customer panel already had — and the two had
 *   drifted over whether a link expiring on this exact millisecond is expired.
 *   `server/utils/inviteLinkStatus.js` is now the only definition and the row
 *   arrives carrying its own `status`.
 *
 * · *The `source` column was never shown.* Links are created by buyers or by
 *   staff, the column has said which since the table was created, and the page
 *   put a store-wide switch for buyer-created links directly above a list that
 *   would not tell you which links were buyer-created. The switch was asking
 *   the operator to make a decision and withholding the evidence for it.
 *
 * · *A markup was a number with no consequence attached.* "20%" says nothing
 *   about whether that is a partner deal or somebody quietly overcharging forty
 *   accounts. It is drawn against the store's other links now, and the signups
 *   under it are one click away.
 *
 * **DESIGN §6 — responsive table, two views, or a toggle?** Two purpose-built
 * views. A link is not a row of uniform facts: it has a burn-down, a clock and
 * a code you copy, and §6 names exactly that — a progress bar, a different
 * field order — as the case where the single responsive table stops being
 * enough. Desktop is compact line items; the narrow shape is a real card with
 * the code and the meter promoted, and it is reached by a container query, so
 * the same component is correct inside a narrow panel on a wide monitor. No
 * toggle: there is one way to read this list and offering a second layout
 * would be a control that cannot say who presses it (§7).
 *
 * **DESIGN §10 — the fuse.** A capped link burns down. Every redemption is one
 * unit of a finite thing, and an expiry is the same burn running on a clock
 * instead of on signups. Drawn as a meter, a partner link that took thirty of
 * its fifty places in a day looks different from one that has taken two in a
 * month — which is the abuse signal this page exists to surface, and which a
 * cell reading `30/50` states without showing. Uncapped links get no meter and
 * say so: drawing a full bar for "unlimited" would be the opposite of true.
 */

const STATUS_META = {
  active: { label: 'Active', badge: 'badge-success', tone: 'var(--success)' },
  exhausted: { label: 'Filled', badge: 'badge-warning', tone: 'var(--warning)' },
  expired: { label: 'Expired', badge: 'badge-muted', tone: 'var(--text-muted)' },
  revoked: { label: 'Revoked', badge: 'badge-danger', tone: 'var(--danger)' },
};

// The order the pills sit in, which is the order an operator triages: what is
// live, what filled up, what timed out, what was stopped by hand.
const FILTERS = [
  { key: '', label: 'All', countKey: 'all' },
  { key: 'active', label: 'Active', countKey: 'active' },
  { key: 'exhausted', label: 'Filled', countKey: 'exhausted' },
  { key: 'expired', label: 'Expired', countKey: 'expired' },
  { key: 'revoked', label: 'Revoked', countKey: 'revoked' },
];

const EMPTY_LINK = {
  label: '',
  referrer_user_id: '',
  price_markup_value: '0',
  price_markup_kind: 'percent',
  max_uses: '',
  expires_at: '',
  set_no_referrer: false,
};

/** `20%` or `$1.50`, in the unit the link actually carries. */
function markupText(link) {
  const v = num(link.price_markup_value);
  return link.price_markup_kind === 'amount' ? money(v) : `${v}%`;
}

export default function InviteLinks() {
  const [params, setParams] = useSearchParams();
  const status = STATUS_META[params.get('status')] ? params.get('status') : '';

  const [links, setLinks] = useState([]);
  const [counts, setCounts] = useState({ all: 0, active: 0, revoked: 0, expired: 0, exhausted: 0 });
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const [queryInput, setQueryInput] = useState(params.get('q') || '');
  const [query, setQuery] = useState(params.get('q') || '');
  useEffect(() => {
    const t = setTimeout(() => {
      const next = queryInput.trim();
      setQuery(next);
      // Mirrored into the URL alongside `?status=`, so a view of "every revoked
      // link mentioning partner" is a link. `replace`, or a debounced push
      // writes one history entry per pause in typing.
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        if (next) p.set('q', next); else p.delete('q');
        return p;
      }, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput]);

  const [showCreate, setShowCreate] = useState(false);
  const [newLink, setNewLink] = useState({ ...EMPTY_LINK });
  const [creating, setCreating] = useState(false);

  // The store-wide gate on buyers creating their own links. Read from the list
  // endpoint (this page's grant cannot read GET /settings); written through PUT
  // /settings, whose per-key rule maps the key back to this page's own grant.
  // null = not loaded, so the switch never renders a value it is about to
  // contradict.
  const [userLinksEnabled, setUserLinksEnabled] = useState(null);
  const [togglingGate, setTogglingGate] = useState(false);
  const [creditEnabled, setCreditEnabled] = useState(null);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (status) qs.set('status', status);
      if (query) qs.set('q', query);
      const data = await api.get(`/subusers/admin/invite-links?${qs}`);
      setLinks(data.links || []);
      setTotal(num(data.total));
      if (data.counts) setCounts(data.counts);
      if (data.user_links_enabled !== undefined) setUserLinksEnabled(!!data.user_links_enabled);
    } catch (err) {
      toast.error(err.message || 'Failed to load invite links');
    }
    setLoading(false);
  }, [page, status, query]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [status, query]);

  // The credit panel at the foot of this page needs to know whether the
  // facility is frozen, and this endpoint does not carry that. A failure is
  // silent: `analytics.store_credit` is a separate grant, and an operator who
  // only manages invite links should not be shown an error for a request they
  // did not make. The panel treats null as "unknown" and stays out of the way.
  useEffect(() => {
    let live = true;
    api.get('/admin/store-credit?limit=1')
      .then((d) => { if (live && d.store_credit_enabled !== undefined) setCreditEnabled(!!d.store_credit_enabled); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const setStatus = (next) => {
    const p = new URLSearchParams(params);
    if (next) p.set('status', next); else p.delete('status');
    setParams(p, { replace: true });
  };

  const clearAll = () => {
    setQueryInput('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const toggleUserLinks = async (next) => {
    setTogglingGate(true);
    const previous = userLinksEnabled;
    // Optimistic, and reconciled honestly: the switch shows the new position
    // immediately and animates back if the write is refused.
    setUserLinksEnabled(next);
    try {
      await api.put('/settings', { referral_user_links_enabled: next ? 'true' : 'false' });
      toast.success(next
        ? 'Buyers can create invite links again'
        : 'New buyer links paused — existing links and sub-users keep working');
    } catch (err) {
      setUserLinksEnabled(previous);
      toast.error(err.message || 'Could not change the setting');
    }
    setTogglingGate(false);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newLink.label.trim()) return toast.error('Give the link a label — it is how you will find it again.');
    setCreating(true);
    try {
      await api.post('/subusers/admin/invite-links', {
        label: newLink.label,
        referrer_user_id: newLink.set_no_referrer
          ? null
          : (newLink.referrer_user_id ? parseInt(newLink.referrer_user_id, 10) : null),
        price_markup_value: num(newLink.price_markup_value),
        price_markup_kind: newLink.price_markup_kind === 'amount' ? 'amount' : 'percent',
        max_uses: newLink.max_uses ? parseInt(newLink.max_uses, 10) : null,
        expires_at: newLink.expires_at || null,
        set_no_referrer: newLink.set_no_referrer,
      });
      toast.success('Invite link created');
      setShowCreate(false);
      setNewLink({ ...EMPTY_LINK });
      // A new link is the newest row, so it is on page one whatever page we
      // were on. Landing back where we were would hide the thing just made.
      setPage(1);
      if (status && status !== 'active') setStatus('');
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to create the invite link');
    }
    setCreating(false);
  };

  const revokeLink = async (link) => {
    if (!confirm(
      `Revoke "${link.label || link.code}"?\n\n`
      + 'Nobody new can sign up through it. Accounts already created keep their referrer '
      + 'and their markup, and this cannot be undone.',
    )) return;
    try {
      await api.delete(`/subusers/admin/invite-links/${link.id}`);
      toast.success('Invite link revoked');
      load();
    } catch (err) {
      toast.error(err.message || 'Failed to revoke the link');
    }
  };

  const filtered = !!(status || query);

  const stats = useMemo(() => ([
    {
      key: 'active',
      label: 'Live links',
      value: fmtCount(counts.active),
      icon: ShieldCheck,
      tone: 'var(--success)',
      lead: true,
      // "ever issued" is only true of the unsearched set; while a search is on,
      // every tile counts the matches and the hint has to say so.
      hint: query ? `of ${fmtCount(counts.all)} matching` : `of ${fmtCount(counts.all)} ever issued`,
      onClick: () => setStatus(status === 'active' ? '' : 'active'),
      active: status === 'active',
      title: 'Links that will accept a signup right now',
    },
    {
      key: 'filled',
      label: 'Filled',
      value: fmtCount(counts.exhausted),
      icon: Users,
      tone: 'var(--warning)',
      hint: 'hit their cap',
      onClick: () => setStatus(status === 'exhausted' ? '' : 'exhausted'),
      active: status === 'exhausted',
    },
    {
      key: 'expired',
      label: 'Expired',
      value: fmtCount(counts.expired),
      icon: CalendarClock,
      tone: 'var(--text-muted)',
      hint: 'ran out their clock',
      onClick: () => setStatus(status === 'expired' ? '' : 'expired'),
      active: status === 'expired',
    },
    {
      key: 'revoked',
      label: 'Revoked',
      value: fmtCount(counts.revoked),
      icon: Trash2,
      tone: 'var(--danger)',
      hint: 'stopped by staff',
      onClick: () => setStatus(status === 'revoked' ? '' : 'revoked'),
      active: status === 'revoked',
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]), [counts, status, query]);

  return (
    <div className="admin-page ivl-page">
      <PageHeader
        icon={Link2}
        title="Invite links"
        /* The counts are scoped to the search — deliberately, so the pills
           report the distribution of what was searched for. That makes
           `counts.all === 0` mean "nothing matched", NOT "the store has no
           links", and phrasing it as the latter had the header announcing
           "No invite links yet." to a store holding nine of them the moment a
           search missed. The subtitle says which of the two it is. */
        subtitle={query
          ? `${fmtCount(counts.all)} link${counts.all === 1 ? '' : 's'} matching “${query}”`
          : counts.all === 0
            ? 'No invite links yet.'
            : `${fmtCount(counts.active)} live of ${fmtCount(counts.all)}`}
      >
        <Link to="/admin/store-credit" className="glass-btn glass-btn-sm">
          <CreditCard size={14} aria-hidden="true" /> Store credit
        </Link>
        <button
          type="button"
          className="glass-btn glass-btn-primary"
          onClick={() => setShowCreate((v) => !v)}
          aria-expanded={showCreate}
        >
          {showCreate ? <X size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          {showCreate ? 'Cancel' : 'New link'}
        </button>
      </PageHeader>

      <StatTiles stats={stats} />

      {/* The programme gate. It lives here rather than in Settings because the
          person who manages invite links is the person who decides when the
          programme stops taking new ones — and now directly above a list that
          marks which links came from buyers, so the switch and its evidence are
          on one screen. */}
      {userLinksEnabled !== null && (
        <div className={`ivl-gate${userLinksEnabled ? ' is-on' : ''}`}>
          <div className="ivl-gate-text">
            <label htmlFor="user-links-gate" className="ivl-gate-title">
              <Store size={15} aria-hidden="true" />
              Buyers can create their own invite links
            </label>
            <p className="ivl-gate-hint">
              Off pauses <strong>new</strong> buyer links only. Links already in the world keep
              signing people up, existing sub-users keep earning their referrers credit, and every
              markup stays editable — promises already made are kept. Links made from this page are
              unaffected either way.
            </p>
          </div>
          <label className="switch">
            <input
              id="user-links-gate"
              type="checkbox"
              checked={userLinksEnabled}
              disabled={togglingGate}
              onChange={(e) => toggleUserLinks(e.target.checked)}
            />
            <span className="switch-track" />
          </label>
        </div>
      )}

      {showCreate && (
        <CreateLinkForm
          value={newLink}
          onChange={setNewLink}
          onSubmit={handleCreate}
          onCancel={() => { setShowCreate(false); setNewLink({ ...EMPTY_LINK }); }}
          creating={creating}
        />
      )}

      <div className="admin-toolbar is-sticky">
        <div className="status-filter-row" role="group" aria-label="Filter links by state">
          {FILTERS.map((f) => (
            <button
              key={f.key || '__all'}
              type="button"
              className={`status-filter-pill${status === f.key ? ' active' : ''}`}
              onClick={() => setStatus(f.key)}
              aria-pressed={status === f.key}
            >
              {f.label}
              <span className="status-filter-count">{fmtCount(counts[f.countKey])}</span>
            </button>
          ))}
        </div>

        <div className="admin-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="glass-input"
            type="search"
            placeholder="Label, code, creator, referrer or #id…"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            aria-label="Search invite links"
          />
        </div>
      </div>

      <LinkList
        links={links}
        loading={loading}
        filtered={filtered}
        onRevoke={revokeLink}
        onClear={clearAll}
        onCreate={() => setShowCreate(true)}
      />

      <Pager
        page={page}
        totalPages={totalPages}
        total={total}
        noun="link"
        label="Invite link pages"
        onChange={setPage}
      />

      {/* Store credit sits at the foot of this page because a link's referrer is
          paid in it: the operator reading the signups column is often the person
          about to correct a balance. It is the same module the ledger page
          renders — this page used to carry its own near-copy. */}
      <CreditAdjuster
        enabled={creditEnabled}
        footerLinks={<Link to="/admin/store-credit" className="glass-btn glass-btn-sm">Store credit ledger</Link>}
      />
    </div>
  );
}

/* ── The list ─────────────────────────────────────────────────────────────── */

function LinkList({ links, loading, filtered, onRevoke, onClear, onCreate }) {
  if (loading) {
    return (
      <div className="lrows ivl-rows" aria-busy="true" aria-label="Loading invite links">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="lrow-skel ivl-skel" />)}
      </div>
    );
  }

  if (links.length === 0) {
    return (
      <div className="lrows ivl-rows">
        {/* §9: the way out is the thing the operator came to do. */}
        <div className="lrows-empty">
          <strong>{filtered ? 'No link matches that.' : 'No invite links yet.'}</strong>
          {filtered
            ? 'Nothing in the store matches this filter and search.'
            : 'A link carries its own price markup and pays its referrer store credit on every order the account it created ever places.'}
          <div className="lrows-empty-links">
            {filtered ? (
              <button type="button" className="glass-btn glass-btn-sm" onClick={onClear}>
                <FilterX size={13} aria-hidden="true" /> Clear filters
              </button>
            ) : (
              <button type="button" className="glass-btn glass-btn-sm" onClick={onCreate}>
                <Plus size={13} aria-hidden="true" /> Create the first link
              </button>
            )}
            <Link to="/admin/store-credit" className="glass-btn glass-btn-sm">Store credit ledger</Link>
            <Link to="/admin/users" className="glass-btn glass-btn-sm">Accounts</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lrows ivl-rows">
      <div className="lrows-head ivl-head">
        <span>Code</span>
        <span>Purpose</span>
        <span>Referrer</span>
        <span className="ivl-markup-head">Markup</span>
        <span>Signups</span>
        <span>State</span>
        <span aria-hidden="true" />
      </div>
      {links.map((link) => <LinkRow key={link.id} link={link} onRevoke={onRevoke} />)}
    </div>
  );
}

function LinkRow({ link, onRevoke }) {
  const meta = STATUS_META[link.status] || STATUS_META.revoked;
  const uses = num(link.current_uses);
  const capped = link.max_uses != null;
  const cap = capped ? Number(link.max_uses) : null;
  // Clamped at 100%: a cap lowered after the fact can legitimately leave a link
  // above its own ceiling, and a bar drawn past the end of its track is a
  // rendering bug wearing the costume of a data point.
  const burn = capped && cap > 0 ? Math.min(100, (uses / cap) * 100) : 0;
  const live = link.status === 'active';

  return (
    <div className={`lrow ivl-row${live ? '' : ' is-spent'}`} style={{ '--lrow-tone': meta.tone }}>
      <span className="ivl-code">
        <CopyCode code={link.code} label={link.label} />
      </span>

      {/* Label and provenance together: what this link is for, and whether a
          buyer or staff made it. `source` has been on the row since the table
          existed and this page never showed it. */}
      <span className="lrow-stack ivl-purpose">
        <span className="lrow-text">{link.label || <em className="ivl-dim">Unlabelled</em>}</span>
        <small>
          {link.source === 'admin' ? 'Staff' : 'Buyer'}
          {link.creator_username ? (
            <> · <Link to={`/admin/users?id=${link.created_by}`}>{link.creator_username}</Link></>
          ) : link.created_by ? <> · #{link.created_by}</> : null}
          {link.created_at ? <> · {relTime(new Date(link.created_at).getTime())}</> : null}
        </small>
      </span>

      {/* §9: the referrer is another record, and the markup on this row is money
          that person is owed — the account is where an operator goes to check
          it, and their credit history is one further click from there. */}
      <span className="ivl-referrer">
        {link.referrer_user_id ? (
          <Link to={`/admin/users?id=${link.referrer_user_id}`} className="lrow-text">
            {link.referrer_username || `#${link.referrer_user_id}`}
          </Link>
        ) : (
          <span className="ivl-dim" title="Nobody is paid for signups through this link">
            No referrer
          </span>
        )}
      </span>

      <span className="ivl-markup t-num" title={link.price_markup_kind === 'amount'
        ? 'A flat sum added to every unit, whatever it costs'
        : 'A share of each price — it scales with what they buy'}>
        {num(link.price_markup_value) === 0
          ? <span className="ivl-dim">list price</span>
          : markupText(link)}
      </span>

      {/* The fuse. A capped link is a finite thing burning down; an uncapped one
          is not, and says so rather than showing a full bar for "unlimited". */}
      <span className="ivl-uses">
        {capped ? (
          <>
            <span className="ivl-meter" aria-hidden="true">
              <span className="ivl-meter-fill" style={{ width: `${burn}%` }} />
            </span>
            <span className="t-num ivl-uses-figure">
              {fmtCount(uses)}<span className="ivl-dim">/{fmtCount(cap)}</span>
            </span>
          </>
        ) : (
          <span className="t-num ivl-uses-figure">
            {fmtCount(uses)}
            <span className="ivl-dim ivl-uncapped" title="No cap on redemptions">
              <InfinityIcon size={12} aria-hidden="true" />
            </span>
          </span>
        )}
      </span>

      <span className="ivl-state">
        <span className={`badge ${meta.badge}`}>{meta.label}</span>
        {/* The clock, where there is one. An expiry that has not fired yet is
            the difference between a link that is fine and one that is about to
            stop working, and a bare date makes the reader do that arithmetic. */}
        {link.expires_at && (
          <small className="ivl-expiry" title={new Date(link.expires_at).toLocaleString()}>
            {link.status === 'expired' ? 'ended ' : 'ends '}
            {untilTime(link.expires_at)}
          </small>
        )}
      </span>

      {/* §4: revealed on hover and on focus-within, with the space reserved —
          and simply present on a coarse pointer, where there is no hover. */}
      <span className="lrow-actions">
        {link.active !== false ? (
          <button
            type="button"
            className="glass-btn glass-btn-sm glass-btn-danger"
            onClick={() => onRevoke(link)}
            title={`Revoke ${link.label || link.code}`}
          >
            <Trash2 size={13} aria-hidden="true" /> Revoke
          </button>
        ) : (
          // Not blank: on the card shape an empty actions area is a padded gap
          // at the foot of the card with nothing to explain it.
          <span className="ivl-dim">Revoked</span>
        )}
      </span>
    </div>
  );
}

/**
 * The code, and the one thing anybody does with it.
 *
 * A code is 16 base64url characters — long enough to need truncating in a
 * column and meaningless to read aloud, so the useful affordance is not the
 * text but the copy. The button confirms in place for a moment rather than
 * only firing a toast: the toast appears in a corner of the screen the eye is
 * not on, having just clicked a control in a table.
 */
function CopyCode({ code, label }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  if (!code) return <span className="ivl-dim">—</span>;

  const copy = async () => {
    const url = `${window.location.origin}/register?invite=${code}`;
    try {
      // `navigator.clipboard` is undefined on a page served over plain HTTP,
      // which a self-hosted store on a LAN or a .onion without TLS genuinely
      // is. Falling through to the toast is what tells the operator to copy it
      // by hand rather than leaving a button that does nothing.
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      toast.error('Could not copy — the invite URL is /register?invite=' + code);
    }
  };

  return (
    <button
      type="button"
      className={`ivl-copy${copied ? ' is-copied' : ''}`}
      onClick={copy}
      title={`Copy the invite URL for ${label || code}`}
      aria-label={`Copy the invite URL for ${label || code}`}
    >
      <span className="ivl-copy-code">{code}</span>
      {copied
        ? <Check size={12} aria-hidden="true" className="ivl-copy-icon" />
        : <Copy size={12} aria-hidden="true" className="ivl-copy-icon" />}
      <span className="ivl-copy-said" aria-live="polite">{copied ? 'Copied' : ''}</span>
    </button>
  );
}

/* ── Create ───────────────────────────────────────────────────────────────── */

function CreateLinkForm({ value, onChange, onSubmit, onCancel, creating }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const markup = num(value.price_markup_value);

  return (
    <div className="glass-card admin-panel-in ivl-create">
      <h3 className="admin-card-title"><Plus size={15} aria-hidden="true" /> New invite link</h3>

      <form onSubmit={onSubmit}>
        <div className="admin-form-grid">
          <div className="form-group">
            <label htmlFor="ivl-label">Label</label>
            <input
              id="ivl-label"
              className="glass-input"
              type="text"
              value={value.label}
              onChange={(e) => set({ label: e.target.value })}
              placeholder="Partner A — spring run"
              maxLength={128}
            />
            <p className="ivl-field-hint">Only you see this. It is how you find the link again.</p>
          </div>

          <div className="form-group">
            <label htmlFor="ivl-referrer">Referrer</label>
            <input
              id="ivl-referrer"
              className="glass-input"
              type="number"
              value={value.referrer_user_id}
              onChange={(e) => set({ referrer_user_id: e.target.value })}
              disabled={value.set_no_referrer}
              placeholder="User id"
              min={1}
              step={1}
            />
            <p className="ivl-field-hint">
              Who earns store credit on orders from accounts this link creates.
            </p>
          </div>

          {/* `.admin-form-check` already owns the box size, the accent colour
              and the baseline offset that lines a checkbox up with the labelled
              inputs beside it. */}
          <div className="form-group admin-form-check">
            <input
              id="ivl-no-referrer"
              type="checkbox"
              checked={value.set_no_referrer}
              onChange={(e) => set({ set_no_referrer: e.target.checked, referrer_user_id: '' })}
            />
            <label htmlFor="ivl-no-referrer">Nobody — a plain store link</label>
          </div>

          {/* A percentage cannot say "a dollar on everything", so the unit is
              part of the value rather than a fixed label beside it. */}
          <div className="form-group">
            <label htmlFor="ivl-markup">
              Markup {value.price_markup_kind === 'amount' ? '(per item)' : '(percent)'}
            </label>
            <div className="markup-input-row">
              <input
                id="ivl-markup"
                className="glass-input t-num"
                type="number"
                min={0}
                step="any"
                placeholder="0"
                value={value.price_markup_value}
                onChange={(e) => set({ price_markup_value: e.target.value })}
              />
              <div className="markup-kind" role="group" aria-label="Markup unit">
                {['percent', 'amount'].map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`markup-kind-btn${value.price_markup_kind === k ? ' active' : ''}`}
                    onClick={() => set({ price_markup_kind: k })}
                    aria-pressed={value.price_markup_kind === k}
                    title={k === 'percent'
                      ? 'A share of each price — scales with what they buy'
                      : 'The same money on every unit, whatever it costs'}
                  >
                    {k === 'percent' ? '%' : '$'}
                  </button>
                ))}
              </div>
            </div>
            {/* The consequence, stated. A markup is permanent for every account
                the link creates, which is not something the number says. */}
            <p className="ivl-field-hint">
              {markup === 0
                ? 'These accounts pay list price.'
                : value.price_markup_kind === 'amount'
                  ? `Every unit costs ${money(markup)} more, forever, for every account this link creates.`
                  : `Everything costs ${markup}% more, forever, for every account this link creates.`}
            </p>
          </div>

          <div className="form-group">
            <label htmlFor="ivl-max">Signup cap</label>
            <input
              id="ivl-max"
              className="glass-input t-num"
              type="number"
              min={1}
              step={1}
              placeholder="Unlimited"
              value={value.max_uses}
              onChange={(e) => set({ max_uses: e.target.value })}
            />
            <p className="ivl-field-hint">Leave empty for no cap.</p>
          </div>

          <div className="form-group">
            <label htmlFor="ivl-expires">Expires</label>
            <input
              id="ivl-expires"
              className="glass-input"
              type="date"
              value={value.expires_at}
              onChange={(e) => set({ expires_at: e.target.value })}
            />
            <p className="ivl-field-hint">Leave empty to run until revoked.</p>
          </div>
        </div>

        <div className="admin-form-actions">
          <button type="submit" className="glass-btn glass-btn-primary" disabled={creating}>
            {creating ? 'Creating…' : 'Create link'}
          </button>
          <button type="button" className="glass-btn" onClick={onCancel} disabled={creating}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
