import ProgressBar from '../components/ProgressBar';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';
import toast from 'react-hot-toast';
import {
  Link2, Users, DollarSign, Copy, Plus, Trash2, Check, X, TrendingUp,
  Percent, Ban, Clock, Info, ArrowRight, Wallet, ShoppingBag, Award,
  MousePointerClick, Tag,
} from 'lucide-react';

/**
 * The customer's sub-user panel — the whole of their sub-business, in one page.
 *
 * Four jobs, in the order they matter: see what the sub-users have earned, see
 * what is still coming, set the markup each of them pays, and hand out invite
 * links. The markup editor is the reason the page exists, so it is a
 * first-class control with a live worked example rather than a bare number
 * field — someone setting a margin should be able to see what it does to a
 * price before saving it.
 *
 * "Referral" is not a word this page uses any more. An account that signs up
 * through one of these links becomes a SUB-USER, permanently, and the account
 * above them owns their markup for as long as the relationship lasts. That is a
 * reseller arrangement, not a one-off finder's fee, and calling it a referral
 * undersold what the operator is actually being handed.
 */

const TABS = [
  { key: 'subusers', label: 'Sub-Users', icon: Users, count: (d) => d.sub_users.length },
  { key: 'links', label: 'Invite Links', icon: Link2, count: (d) => d.invite_links.filter((l) => l.status === 'active').length },
  { key: 'credit', label: 'Store Credit', icon: Wallet },
];

// Two ladders, because "10" means something completely different in each unit.
const MARKUP_PRESETS = { percent: [0, 5, 10, 15, 20, 25], amount: [0, 1, 2, 5, 10, 20] };

// A representative basket price, only used to illustrate the markup.
const EXAMPLE_PRICE = 100;

const TYPE_BADGE = {
  // The stored ledger type is still `referral_reward` — it is a recorded fact in
  // a money ledger with a CHECK constraint over it and thousands of historical
  // rows, and renaming stored data buys a reader nothing. The label is what
  // people see, and that is the half worth unifying.
  //
  // `noSource` is what the From column says when the row has no counterparty
  // username. A bare em dash there reads as a name the page failed to load, and
  // the truthful answer differs per type: credit spent at checkout came from
  // nobody, it went into your own order.
  referral_reward:  { label: 'Sub-user reward', cls: 'badge-success', noSource: '—' },
  order_discount:   { label: 'Order discount',  cls: 'badge-primary', noSource: 'your own order' },
  admin_adjustment: { label: 'Adjustment',      cls: 'badge-warning', noSource: 'the store' },
};

const LINK_STATUS = {
  active:    { label: 'Active',    cls: 'badge-success' },
  expired:   { label: 'Expired',   cls: 'badge-muted' },
  exhausted: { label: 'Used up',   cls: 'badge-warning' },
  revoked:   { label: 'Revoked',   cls: 'badge-muted' },
};

const money = (n) => `$${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function formatDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function SummaryCard({ icon: Icon, label, value, note, primary }) {
  return (
    <div className={`ref-summary-card${primary ? ' is-primary' : ''}`}>
      <div className="ref-summary-label">{Icon && <Icon size={11} />} {label}</div>
      <div className="ref-summary-value" style={primary ? { color: 'var(--success)' } : undefined}>{value}</div>
      {note && <div className="ref-summary-note">{note}</div>}
    </div>
  );
}

/** "20%" or "$20", for a stored markup. */
function markupLabel(value, kind) {
  const n = Number(value) || 0;
  return kind === 'amount' ? money(n) : `${n}%`;
}

/**
 * Markup control for one sub-user.
 *
 * Local draft state, so typing never fights the panel refresh, and the Save
 * button only appears once the value actually differs from what is stored.
 *
 * The unit is part of the value, not decoration: a percentage cannot express "a
 * dollar on everything" — one number cannot be 10% of $9.99 and 10% of $27.99
 * at once — so switching kind changes what the same digits mean and is treated
 * as an edit like any other.
 */
function MarkupEditor({ subUser, maxPct, maxAmount, onSave }) {
  const stored = subUser.price_markup_value ?? 0;
  const storedKind = subUser.price_markup_kind === 'amount' ? 'amount' : 'percent';
  const [draft, setDraft] = useState(String(stored));
  const [kind, setKind] = useState(storedKind);
  const [saving, setSaving] = useState(false);

  // Follow the server when it changes underneath an untouched field.
  useEffect(() => { setDraft(String(stored)); setKind(storedKind); }, [stored, storedKind]);

  const max = kind === 'amount' ? maxAmount : maxPct;
  const limit = kind === 'amount' ? `$0 and ${money(maxAmount)}` : `0 and ${maxPct}%`;
  const parsed = parseFloat(draft);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= max;
  const dirty = valid && (parsed !== stored || kind !== storedKind);

  const save = async () => {
    if (!valid) return toast.error(`Markup must be between ${limit}`);
    setSaving(true);
    try {
      await onSave(parsed, kind);
    } finally {
      setSaving(false);
    }
  };

  const example = valid
    ? (kind === 'amount' ? EXAMPLE_PRICE + parsed : EXAMPLE_PRICE * (1 + parsed / 100))
    : null;

  return (
    <div>
      <div className="markup-editor">
        <div className="markup-field">
          <label htmlFor={`markup-${subUser.sub_user_id}`}>Your markup</label>
          <div className="markup-input-wrap">
            {kind === 'amount' && <span className="markup-prefix">$</span>}
            <input
              id={`markup-${subUser.sub_user_id}`}
              className="glass-input"
              type="number"
              min={0}
              max={max}
              step={kind === 'amount' ? 0.25 : 0.5}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && dirty) save(); }}
              aria-describedby={`markup-help-${subUser.sub_user_id}`}
            />
            {kind === 'percent' && <span className="markup-suffix">%</span>}
          </div>
        </div>

        <div className="markup-kind" role="group" aria-label="Markup unit">
          {['percent', 'amount'].map((k) => (
            <button
              key={k}
              type="button"
              className={`markup-kind-btn${kind === k ? ' active' : ''}`}
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              title={k === 'percent'
                ? 'A share of each price — scales with what they buy'
                : 'The same money on every unit, whatever it costs'}
            >
              {k === 'percent' ? '%' : '$'}
            </button>
          ))}
        </div>

        <div className="markup-presets" role="group" aria-label="Common markups">
          {MARKUP_PRESETS[kind].map((p) => (
            <button
              key={p}
              type="button"
              className={`markup-preset${parsed === p ? ' active' : ''}`}
              onClick={() => setDraft(String(p))}
            >
              {markupLabel(p, kind)}
            </button>
          ))}
        </div>

        {dirty && (
          <div style={{ display: 'flex', gap: 'var(--sp-15)' }}>
            <button className="glass-btn glass-btn-primary glass-btn-sm" onClick={save} disabled={saving}>
              <Check size={13} /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              className="glass-btn glass-btn-sm"
              onClick={() => { setDraft(String(stored)); setKind(storedKind); }}
              title="Discard"
            >
              <X size={13} />
            </button>
          </div>
        )}
      </div>

      <p className="markup-preview" id={`markup-help-${subUser.sub_user_id}`}>
        {!valid ? (
          <span style={{ color: 'var(--danger)' }}>Enter a value between {limit}.</span>
        ) : parsed === 0 ? (
          <>No markup — {subUser.username} pays list price and you earn nothing on their orders.</>
        ) : (
          <>
            A <strong>{money(EXAMPLE_PRICE)}</strong> item costs {subUser.username}{' '}
            <strong>{money(example)}</strong>, and the{' '}
            <strong>{money(example - EXAMPLE_PRICE)}</strong> difference becomes your store credit
            once their order is delivered.
            {kind === 'amount' && <> The same {money(parsed)} is added to every item, cheap or dear.</>}
          </>
        )}
      </p>
    </div>
  );
}

function SubUserCard({ subUser, maxPct, maxAmount, onSave, onRemove }) {
  return (
    <div className={`subuser-card${subUser.account_active ? '' : ' inactive'}`}>
      <div className="subuser-head">
        <div style={{ minWidth: 0 }}>
          <div className="subuser-name">
            <Users size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            {subUser.username}
            {!subUser.account_active && (
              <span className="badge badge-muted" style={{ fontSize: 'var(--fs-3xs)' }}>
                <Ban size={9} /> deactivated
              </span>
            )}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 'var(--sp-1)' }}>
            Joined {formatDate(subUser.created_at)}
          </div>
        </div>
        <button
          className="glass-btn glass-btn-sm"
          onClick={() => onRemove(subUser)}
          style={{ color: 'var(--danger)', borderColor: 'color-mix(in srgb, var(--danger) 35%, transparent)' }}
        >
          <Trash2 size={13} /> Remove
        </button>
      </div>

      <div className="subuser-stats">
        <div>
          <div className="subuser-stat-label">Earned you</div>
          <div className="subuser-stat-value" style={{ color: subUser.earned > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
            {money(subUser.earned)}
          </div>
        </div>
        <div>
          <div className="subuser-stat-label" title="Paid for, not yet delivered">Pending</div>
          <div className="subuser-stat-value" style={{ color: subUser.pending > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
            {money(subUser.pending || 0)}
          </div>
        </div>
        <div>
          <div className="subuser-stat-label">They spent</div>
          <div className="subuser-stat-value">{money(subUser.spent)}</div>
        </div>
        <div>
          <div className="subuser-stat-label">Orders</div>
          <div className="subuser-stat-value">{subUser.orders}</div>
        </div>
        <div>
          <div className="subuser-stat-label">Markup</div>
          <div className="subuser-stat-value" style={{ color: 'var(--primary)' }}>
            {markupLabel(subUser.price_markup_value, subUser.price_markup_kind)}
          </div>
        </div>
      </div>

      <MarkupEditor
        subUser={subUser}
        maxPct={maxPct}
        maxAmount={maxAmount}
        onSave={(value, kind) => onSave(subUser.sub_user_id, value, kind)}
      />
    </div>
  );
}

function InviteLinkCard({ link, onRevoke, onRename, clickTracking }) {
  const [copied, setCopied] = useState(false);
  const [editingTag, setEditingTag] = useState(false);
  const [tag, setTag] = useState(link.ref_tag || '');
  const [savingTag, setSavingTag] = useState(false);
  // The path comes from the server, which is the only place that knows where
  // this link is meant to land and whether it has a chosen tag; the origin
  // comes from the browser, which is the only place that knows which host the
  // person is actually on. The page used to assemble the whole string itself
  // and so could only ever produce `/register?invite=<code>`.
  const url = `${window.location.origin}${link.ref_path || `/register?invite=${link.code}`}`;
  const token = link.ref_tag || link.code;
  const status = LINK_STATUS[link.status] || LINK_STATUS.active;
  const dead = link.status !== 'active';
  // Of the people who followed this link, how many signed up. A dash rather
  // than 0% when nobody arrived: with no denominator there is no rate, and
  // "0%" claims the link converted nobody when the truth is nobody saw it.
  const conversion = link.clicks > 0
    ? `${Math.min(100, Math.round((Number(link.current_uses) / link.clicks) * 100))}%`
    : null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is unavailable over plain HTTP and in some hardened browsers;
      // selecting the text is the fallback rather than a silent no-op.
      toast.error('Could not copy — select the link and copy it manually');
    }
  };

  const saveTag = async () => {
    setSavingTag(true);
    try {
      await onRename(link, tag.trim());
      setEditingTag(false);
    } finally {
      setSavingTag(false);
    }
  };

  const usedPct = link.max_uses ? Math.min(100, (link.current_uses / link.max_uses) * 100) : 0;

  return (
    <div className={`invite-card${dead ? ' is-dead' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>{link.label || 'Untitled link'}</span>
          <span className={`badge ${status.cls}`} style={{ fontSize: 'var(--fs-3xs)' }}>{status.label}</span>
          {link.price_markup_value > 0 && (
            <span className="badge badge-primary" style={{ fontSize: 'var(--fs-3xs)' }}>
              {link.price_markup_kind === 'amount'
                ? <DollarSign size={9} />
                : <Percent size={9} />}
              {' '}{markupLabel(link.price_markup_value, link.price_markup_kind)} markup
            </span>
          )}
        </div>
        {link.status === 'active' && (
          <button className="glass-btn glass-btn-sm" onClick={() => onRevoke(link)} style={{ fontSize: 'var(--fs-xs)' }}>
            <Ban size={12} /> Revoke
          </button>
        )}
      </div>

      <div className="invite-url">
        <code title={url}>{url}</code>
        <button className="glass-btn glass-btn-sm" onClick={copy} style={{ fontSize: 'var(--fs-xs)', flexShrink: 0 }}>
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>

      {/* The tag is the half of the link a person chose, and the half somebody
          types back in when a link cleaner eats the query string. Editable for
          the life of the link — the code underneath never changes, so anything
          already shared keeps working whatever the tag becomes. */}
      {!dead && (
        editingTag ? (
          <div className="invite-tag-edit">
            <span className="ref-tag-field">
              <span className="ref-tag-prefix">?ref=</span>
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder={link.code}
                maxLength={64}
                autoComplete="off"
                spellCheck="false"
                aria-label="Referral tag"
              />
            </span>
            <button className="glass-btn glass-btn-sm glass-btn-primary" onClick={saveTag} disabled={savingTag}>
              <Check size={12} /> Save
            </button>
            <button className="glass-btn glass-btn-sm" onClick={() => { setTag(link.ref_tag || ''); setEditingTag(false); }}>
              <X size={12} />
            </button>
          </div>
        ) : (
          <button type="button" className="invite-tag-btn" onClick={() => setEditingTag(true)}>
            <Tag size={11} />
            {link.ref_tag
              ? <>Tag <strong>{link.ref_tag}</strong> — rename</>
              : <>Give this link a name people can type</>}
          </button>
        )
      )}

      <div className="invite-meta">
        {/* Arrivals first, because it is the number that was missing: without
            it "3 signed up" could mean a link nobody clicked or one four
            hundred people clicked and bounced off, and those want opposite
            responses. Shown only when the store counts them — a hard zero
            beside a real signup count reads as a bug. */}
        {clickTracking && (
          <span title="People who followed this link">
            <MousePointerClick size={11} /> {link.clicks} click{link.clicks === 1 ? '' : 's'}
            {conversion && <> · {conversion} signed up</>}
          </span>
        )}
        <span><Users size={11} /> {link.current_uses} signed up{link.max_uses ? ` of ${link.max_uses}` : ''}</span>
        {link.expires_at && <span><Clock size={11} /> expires {formatDate(link.expires_at)}</span>}
        <span><Plus size={11} /> created {formatDate(link.created_at)}</span>
      </div>

      {link.max_uses && (
        <div className="invite-uses-bar">
          <div className={`invite-uses-fill${usedPct >= 100 ? ' full' : ''}`} style={{ width: `${usedPct}%` }} />
        </div>
      )}
    </div>
  );
}

export default function SubUsers() {
  const [data, setData] = useState({
    sub_users: [], invite_links: [], store_credit_balance: 0,
    recent_transactions: [], summary: null, max_markup_pct: 100, max_markup_amount: 1000,
    // Optimistic default: flashing a "not accepting links" notice during the
    // fetch would tell every visitor the programme is closed for a beat.
    user_links_enabled: true,
    // Same reasoning inverted: assume the store counts arrivals, so the click
    // line does not blink out of existence between the render and the fetch.
    click_tracking: true,
  });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('subusers');
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newLink, setNewLink] = useState({
    label: '', max_uses: '', price_markup_value: '', price_markup_kind: 'percent',
    expires_at: '', ref_tag: '',
  });

  const load = useCallback(async () => {
    try {
      const panel = await api.get('/subusers/panel');
      setData((prev) => ({ ...prev, ...panel }));
    } catch (err) {
      toast.error(err.message || 'Failed to load your sub-user panel');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const maxPct = data.max_markup_pct ?? 100;
  const maxAmount = data.max_markup_amount ?? 1000;
  const summary = data.summary || {
    sub_user_count: data.sub_users.length, active_links: 0,
    total_earned: 0, total_pending: 0, pending_orders: 0,
    sub_user_spend: 0, sub_user_orders: 0,
  };

  const saveMarkup = async (subUserId, value, kind) => {
    try {
      await api.put(`/subusers/sub-users/${subUserId}`, {
        price_markup_value: value,
        price_markup_kind: kind,
      });
      toast.success(`Markup set to ${markupLabel(value, kind)}`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to save markup');
    }
  };

  const removeSubUser = async (su) => {
    if (!confirm(
      `Remove ${su.username} as a sub-user?\n\n`
      + 'They keep their account and their order history, but they will pay list price from now on '
      + 'and you will stop earning credit from their orders. This cannot be undone from here.'
    )) return;
    try {
      await api.delete(`/subusers/sub-users/${su.sub_user_id}`);
      toast.success(`${su.username} removed`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to remove sub-user');
    }
  };

  const revokeLink = async (link) => {
    if (!confirm(`Revoke "${link.label || 'this link'}"? Anyone holding it will no longer be able to sign up with it.`)) return;
    try {
      await api.delete(`/subusers/invite-links/${link.id}`);
      toast.success('Link revoked');
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to revoke link');
    }
  };

  /**
   * Set or clear a link's tag.
   *
   * Rethrows so the card can keep its editor open on a rejection: a tag that
   * is already taken is the ordinary failure here, and closing the field would
   * throw away what the person typed and leave them re-deriving it from a
   * toast.
   */
  const renameLink = async (link, nextTag) => {
    try {
      await api.put(`/subusers/invite-links/${link.id}`, { ref_tag: nextTag });
      toast.success(nextTag ? `Link is now ?ref=${nextTag}` : 'Tag cleared — the link still works on its code');
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not save that tag');
      throw err;
    }
  };

  const createLink = async (e) => {
    e.preventDefault();
    setCreating(true);
    try {
      const body = {};
      if (newLink.label.trim()) body.label = newLink.label.trim();
      if (newLink.max_uses !== '') body.max_uses = parseInt(newLink.max_uses, 10);
      if (newLink.price_markup_value !== '') {
        body.price_markup_value = parseFloat(newLink.price_markup_value);
        body.price_markup_kind = newLink.price_markup_kind;
      }
      if (newLink.expires_at !== '') body.expires_at = newLink.expires_at;
      if (newLink.ref_tag.trim() !== '') body.ref_tag = newLink.ref_tag.trim();

      await api.post('/subusers/invite-links', body);
      toast.success('Invite link created');
      setNewLink({
        label: '', max_uses: '', price_markup_value: '', price_markup_kind: 'percent',
        expires_at: '', ref_tag: '',
      });
      setShowCreate(false);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to create link');
    } finally {
      setCreating(false);
    }
  };

  const sortedLinks = useMemo(() => {
    const rank = { active: 0, exhausted: 1, expired: 2, revoked: 3 };
    return [...data.invite_links].sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
  }, [data.invite_links]);

  if (loading) {
    return (
      <div className="page container" style={{ textAlign: 'center' }}>
        <ProgressBar label="Loading…" />
      </div>
    );
  }

  return (
    <div className="page container" style={{ maxWidth: 900 }}>
      <div className="page-header">
        <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-25)' }}>
          <Users size={22} style={{ color: 'var(--primary)' }} /> Sub-Users
        </h1>
        <Link to="/membership" className="glass-btn glass-btn-sm" style={{ fontSize: 'var(--fs-sm)' }}>
          <Award size={14} /> Membership <ArrowRight size={12} />
        </Link>
      </div>

      {/* Banked and pending are two tiles, never one number. Pending money is
          not spendable, and a single "earnings" figure that included it would
          be quoting a balance the checkout has to refuse. */}
      <div className="ref-summary">
        <SummaryCard primary icon={TrendingUp} label="Earned from sub-users" value={money(summary.total_earned)}
          note="Paid out and in your balance" />
        <SummaryCard icon={Clock} label="Pending" value={money(summary.total_pending || 0)}
          note={summary.pending_orders
            ? `${summary.pending_orders} order${summary.pending_orders === 1 ? '' : 's'} paid, not yet delivered`
            : 'Nothing in flight'} />
        <SummaryCard icon={Wallet} label="Store credit" value={money(data.store_credit_balance)}
          note="Spendable at checkout" />
        <SummaryCard icon={Users} label="Sub-users" value={summary.sub_user_count}
          note={`${summary.sub_user_orders} order${summary.sub_user_orders === 1 ? '' : 's'} placed`} />
        <SummaryCard icon={ShoppingBag} label="They’ve spent" value={money(summary.sub_user_spend)}
          note="Across all your sub-users" />
      </div>

      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-25)', marginBottom: 'var(--sp-5)',
        padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', background: 'rgba(var(--tint-rgb), 0.02)',
        fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.6,
      }}>
        <Info size={15} style={{ color: 'var(--primary)', flexShrink: 0, marginTop: 'var(--sp-05)' }} />
        <span>
          Share an invite link to gain sub-users. Your markup is added to every price they see, and
          the difference becomes your store credit — so you set the margin and the store handles the
          rest. A reward shows as <strong>pending</strong> from the moment their order is paid and
          lands in your balance when it is <strong>delivered</strong>, because an order that is
          refunded or cancelled after payment was never really earned. Changing a markup applies to
          their next order, never a past one.
        </span>
      </div>

      <div className="ref-tabs" role="tablist">
        {TABS.map((t) => {
          const count = t.count ? t.count(data) : null;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              className={`ref-tab${activeTab === t.key ? ' active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              <t.icon size={14} /> {t.label}
              {count !== null && <span className="ref-tab-count">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* ── SUB-USERS ── */}
      {activeTab === 'subusers' && (
        data.sub_users.length === 0 ? (
          <div className="empty-state">
            <h3>No sub-users yet</h3>
            <p style={{ color: 'var(--text-secondary)', maxWidth: 460, margin: '0 auto 1.25rem' }}>
              Anyone who signs up through one of your invite links becomes a sub-user. You then set
              the markup they pay, and earn the difference on everything they buy.
            </p>
            {data.user_links_enabled !== false && (
              <button className="glass-btn glass-btn-primary" onClick={() => { setActiveTab('links'); setShowCreate(true); }}>
                <Plus size={15} /> Create an invite link
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
            {data.sub_users.map((su) => (
              <SubUserCard
                key={su.sub_user_id}
                subUser={su}
                maxPct={maxPct}
                maxAmount={maxAmount}
                onSave={saveMarkup}
                onRemove={removeSubUser}
              />
            ))}
          </div>
        )
      )}

      {/* ── INVITE LINKS ── */}
      {activeTab === 'links' && (
        <div>
          {/* Creation is what the store toggle gates — existing links below
              keep rendering and keep working, because they are promises the
              programme already made. */}
          {data.user_links_enabled === false ? (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: 'var(--sp-25)', marginBottom: 'var(--sp-4)',
              padding: 'var(--sp-3) var(--sp-4)', borderRadius: 'var(--radius)',
              border: '1px solid var(--border)', background: 'rgba(var(--tint-rgb), 0.02)',
              fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.6,
            }}>
              <Info size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: 'var(--sp-05)' }} />
              <span>
                The store isn&apos;t accepting new invite links right now. Your existing links
                keep working, your sub-users keep earning you credit, and their markups stay
                editable.
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--sp-4)' }}>
              <button className="glass-btn glass-btn-primary glass-btn-sm" onClick={() => setShowCreate((v) => !v)}>
                {showCreate ? <X size={14} /> : <Plus size={14} />}
                {showCreate ? 'Cancel' : 'New link'}
              </button>
            </div>
          )}

          {showCreate && data.user_links_enabled !== false && (
            <form className="glass-card" onSubmit={createLink} style={{ marginBottom: 'var(--sp-5)' }}>
              <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 'var(--sp-4)' }}>New invite link</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(180px, 100%), 1fr))', gap: '0 1rem' }}>
                <div className="form-group">
                  <label htmlFor="nl-label">Label</label>
                  <input id="nl-label" className="glass-input" value={newLink.label}
                    onChange={(e) => setNewLink((p) => ({ ...p, label: e.target.value }))}
                    placeholder="What this link is for" maxLength={128} />
                </div>
                <div className="form-group">
                  <label htmlFor="nl-markup">
                    Markup {newLink.price_markup_kind === 'amount' ? 'per item ($)' : '(%)'}
                  </label>
                  <div className="markup-input-row">
                    <input id="nl-markup" className="glass-input" type="number" min={0}
                      max={newLink.price_markup_kind === 'amount' ? maxAmount : maxPct}
                      step={newLink.price_markup_kind === 'amount' ? 0.25 : 0.5}
                      value={newLink.price_markup_value}
                      onChange={(e) => setNewLink((p) => ({ ...p, price_markup_value: e.target.value }))}
                      placeholder="0" />
                    <div className="markup-kind" role="group" aria-label="Markup unit">
                      {['percent', 'amount'].map((k) => (
                        <button
                          key={k}
                          type="button"
                          className={`markup-kind-btn${newLink.price_markup_kind === k ? ' active' : ''}`}
                          onClick={() => setNewLink((p) => ({ ...p, price_markup_kind: k }))}
                          aria-pressed={newLink.price_markup_kind === k}
                          title={k === 'percent'
                            ? 'A share of each price — scales with what they buy'
                            : 'The same money on every unit, whatever it costs'}
                        >
                          {k === 'percent' ? '%' : '$'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <small style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                    Applied to whoever signs up with this link. Editable per sub-user later.
                  </small>
                </div>
                <div className="form-group">
                  <label htmlFor="nl-uses">Max uses</label>
                  <input id="nl-uses" className="glass-input" type="number" min={1} step={1}
                    value={newLink.max_uses}
                    onChange={(e) => setNewLink((p) => ({ ...p, max_uses: e.target.value }))}
                    placeholder="Unlimited" />
                </div>
                <div className="form-group">
                  <label htmlFor="nl-expiry">Expires</label>
                  <input id="nl-expiry" className="glass-input" type="date"
                    value={newLink.expires_at}
                    onChange={(e) => setNewLink((p) => ({ ...p, expires_at: e.target.value }))} />
                </div>
                {/* The tag. Optional, and the field says what happens when it
                    is left empty rather than leaving somebody to find out —
                    the link still works, on a 16-character code nobody can
                    read out over the phone. */}
                <div className="form-group">
                  <label htmlFor="nl-tag">Link name</label>
                  <span className="ref-tag-field">
                    <span className="ref-tag-prefix">?ref=</span>
                    <input id="nl-tag" value={newLink.ref_tag}
                      onChange={(e) => setNewLink((p) => ({ ...p, ref_tag: e.target.value }))}
                      placeholder="your-name" maxLength={64} autoComplete="off" spellCheck="false" />
                  </span>
                  <small style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)' }}>
                    Optional. Makes the link something people can type. Leave it empty and it
                    works on a random code instead — harder to share, impossible to guess.
                  </small>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-25)', marginTop: 'var(--sp-2)' }}>
                <button type="submit" className="glass-btn glass-btn-primary" disabled={creating}>
                  {creating ? <span className="spinner" style={{ width: 15, height: 15 }} /> : <Plus size={15} />}
                  {creating ? 'Creating…' : 'Create link'}
                </button>
                <button type="button" className="glass-btn" onClick={() => setShowCreate(false)}>Cancel</button>
              </div>
            </form>
          )}

          {sortedLinks.length === 0 ? (
            <div className="empty-state">
              <h3>No invite links</h3>
              <p style={{ color: 'var(--text-secondary)' }}>
                {data.user_links_enabled === false
                  ? 'New links are paused store-wide at the moment.'
                  : 'Create one to start referring customers.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
              {sortedLinks.map((l) => (
                <InviteLinkCard
                  key={l.id}
                  link={l}
                  onRevoke={revokeLink}
                  onRename={renameLink}
                  clickTracking={data.click_tracking !== false}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── STORE CREDIT ── */}
      {activeTab === 'credit' && (
        <div>
          <div className="glass-card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-4)', marginBottom: 'var(--sp-5)' }}>
            <DollarSign size={30} style={{ color: 'var(--success)', flexShrink: 0 }} />
            <div>
              <div className="ref-summary-label">Available balance</div>
              <div className="ref-summary-value" style={{ color: 'var(--success)' }}>
                {money(data.store_credit_balance)}
              </div>
              <div className="ref-summary-note">Applied automatically at checkout.</div>
            </div>
            {(summary.total_pending || 0) > 0 && (
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div className="ref-summary-label"><Clock size={11} /> Pending</div>
                <div className="ref-summary-value" style={{ color: 'var(--warning)' }}>
                  {money(summary.total_pending)}
                </div>
                <div className="ref-summary-note">Lands when those orders are delivered.</div>
              </div>
            )}
          </div>

          {/* DESIGN §6 — a RESPONSIVE TABLE, like the qualifying-orders table
              on Membership.jsx it shares a skin with. Five short fields, no
              image and nothing to swipe: the phone wants the same five facts
              stacked, so `.admin-rtable` earns it, and a second purpose-built
              card view would only be a second place for the ledger to drift.

              Two failures removed. The table was five columns inside an
              `overflow-x: auto` wrapper, so the amount — the only column
              anyone opens a credit ledger for — sat off the right edge of a
              375px phone with nothing saying so. And it carried an inline
              `minWidth: 480` plus inline cell padding: 38-responsive-admin-
              tables.css has to fight the first with `min-width: 0 !important`
              because only `!important` outranks an inline style, and the
              second could not be fought at all, so the desktop gutter survived
              into the row-card and pushed every value away from the edge the
              card had just aligned it to. Both now live in
              27-referral-panel.css as `.credit-ledger`. */}
          {data.recent_transactions.length === 0 ? (
            /* §9: an empty ledger is the moment to say how credit is earned
               AND to offer the two ways to start earning it. */
            <div className="empty-state">
              <Wallet size={34} aria-hidden="true" />
              <h3>No credit activity yet</h3>
              <p>
                Sub-user rewards land here once their order is delivered, and every checkout that
                spends credit is listed beside them.
              </p>
              <div className="empty-state-links">
                {data.user_links_enabled !== false && (
                  <button
                    className="glass-btn glass-btn-primary"
                    onClick={() => { setActiveTab('links'); setShowCreate(true); }}
                  >
                    <Plus size={15} /> Create an invite link
                  </button>
                )}
                <button className="glass-btn" onClick={() => setActiveTab('subusers')}>
                  <Users size={15} /> Your sub-users
                </button>
              </div>
            </div>
          ) : (
            <div className="glass-card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="credit-ledger-wrap admin-rtable-wrap">
                <table className="member-orders credit-ledger admin-rtable">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Type</th>
                      <th scope="col">From</th>
                      <th scope="col">Note</th>
                      <th scope="col" className="num">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_transactions.map((tx) => {
                      const badge = TYPE_BADGE[tx.type] || { label: tx.type, cls: 'badge-muted' };
                      const amount = parseFloat(tx.amount) || 0;
                      return (
                        <tr key={tx.id}>
                          <td data-label="Date" style={{ color: 'var(--text-secondary)' }}>{formatDate(tx.created_at)}</td>
                          <td data-label="Type"><span className={`badge ${badge.cls}`} style={{ fontSize: 'var(--fs-2xs)' }}>{badge.label}</span></td>
                          {/* Not a bare em dash: a row with no counterparty
                              still has an answer to "from whom", and the blank
                              otherwise reads as a username the page failed to
                              load. See `noSource` on TYPE_BADGE. */}
                          <td data-label="From" style={{ color: 'var(--text-secondary)' }}>
                            {tx.related_username
                              || <span style={{ color: 'var(--text-muted)' }}>{badge.noSource || '—'}</span>}
                          </td>
                          <td data-label="Note" className="credit-ledger-note">{tx.note || '—'}</td>
                          <td data-label="Amount" className="num" style={{ color: amount >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {amount >= 0 ? '+' : '−'}{money(Math.abs(amount))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
