import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  CreditCard, FilterX, Search, Wallet, ArrowDownLeft, ArrowUpRight,
  Gift, ShoppingCart, Undo2, UserCog, Link2, Users, Activity,
} from 'lucide-react';
import { api } from '../../utils/api';
import PageHeader from '../../components/admin/PageHeader';
import VoucherDesk from '../../components/admin/VoucherDesk';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { adminCapabilities } from '../../utils/adminPermissions';
import Pager from '../../components/admin/Pager';
import StatTiles from '../../components/admin/StatTiles';
import CreditDrift from '../../components/admin/CreditDrift';
import CreditAdjuster from '../../components/admin/CreditAdjuster';
import { money, num, count as fmtCount, relTime, orderRef } from '../../utils/adminFormat';
import NextStops from '../../components/admin/NextStops';

const LIMIT = 50;

/**
 * The store credit ledger.
 *
 * **What this page is.** Every movement of store credit the shop has ever made,
 * and the panel that makes new ones. The record is `store_credit_transactions`:
 * one row per movement, four movement types, an amount that is negative when
 * credit leaves a balance, and — depending on the type — an order or a second
 * account hanging off it.
 *
 * **The thing that was wrong with it.** It drew every row identically and
 * summed the wrong number. The header reported "+$47.38 on this page": the
 * arithmetic mean of nothing, computed over whichever fifty rows had loaded,
 * changing as you paged. The number an operator opens this page for is the one
 * that was missing — *how much credit is the store on the hook for right now* —
 * and that is a liability, not a page total. It comes off `store_credit.balance`
 * and it does not move when a filter changes.
 *
 * **`related_user_id` is two different people.** This is the fact the old page
 * got wrong and the reason its User column mis-linked. The column holds:
 *
 *   · `referral_reward` — the *buyer* whose paid order minted this reward for
 *     the referrer named in `user_id` (`utils/subUserReward.js`)
 *   · `order_refund` (clawback) — the same buyer, whose cancellation reversed
 *     it (`utils/orderRestore.js`)
 *   · `admin_adjustment` — the *member of staff* who moved the money
 *     (`subUserController.adminAdjustCredit`)
 *   · `order_discount`, and refunds that restore a buyer's own credit — nobody
 *
 * The old page rendered all of them as "via <name>", which is true of the first
 * two and actively misleading on the third: an admin adjustment read as though
 * some other customer had caused it. Worse, the whole cell was gated on
 * `related_user_id` being present, so the account whose balance actually moved
 * was only ever a link when a counterparty happened to exist — and the link
 * then pointed at the counterparty while showing the owner's name. Each type
 * now names its second party for what it is, or names nobody.
 *
 * **DESIGN §6 — responsive table, two views, or a toggle?** Two purpose-built
 * views, and explicitly *not* a toggle. A ledger is read down one axis: the
 * desktop shape is compact line items with the figures in the mono face,
 * because a column of amounts that does not align is unreadable at a glance
 * and that column is the whole point of the page. There is no second desktop
 * shape worth offering — a "comfortable cards" mode would be the same six
 * short facts in more space, which is a control that cannot say who presses it
 * or when (§7). The phone shape is a real second layout, and the switch is a
 * container query in the stylesheet rather than a viewport query, so a ledger
 * rendered into a narrow panel on a wide monitor gets it too.
 *
 * **DESIGN §10 — the flow gauge.** Every row is money moving in one of two
 * directions, and the direction is the single most scannable fact about it. It
 * was carried by a `+` or `−` and a colour, which is two channels that both
 * cost the reader a fixation. The amount is drawn from a centre axis instead:
 * credit in grows right, credit out grows left, every row scaled against the
 * largest movement on the page. A column of stubs with one bar running to the
 * edge is a $999 adjustment among $2 rewards, visible before a single figure
 * is read. It is fill and position only, so it survives `--glow-strength: 0`,
 * and the sign and the figure are both still printed — the gauge is a second
 * channel for something already said, never the only one.
 */

/**
 * The four movements the `store_credit_transactions` CHECK constraint allows.
 *
 * `tone` feeds `--lrow-tone` and the stat tiles; the badge classes compose from
 * the theme's channel triples (06-glass-primitives.css) so both follow an
 * operator who moves the store off the shipped palette. These were once four
 * hand-written rgba literals, which is how the ledger ended up tinted in last
 * year's indigo with dark-mode alphas in light mode.
 *
 * `party` says what `related_user_id` means for that type — see the note above.
 * It is the whole reason this table has a column for it.
 */
const TYPE_META = {
  referral_reward: {
    label: 'Referral reward',
    short: 'Reward',
    badge: 'badge-success',
    tone: 'var(--success)',
    icon: Gift,
    party: 'from',
    blurb: 'A sub-user’s paid order paying their referrer.',
  },
  order_discount: {
    label: 'Spent at checkout',
    short: 'Spent',
    badge: 'badge-primary',
    tone: 'var(--primary)',
    icon: ShoppingCart,
    party: null,
    blurb: 'Credit applied to an order instead of payment.',
  },
  order_refund: {
    label: 'Order reversal',
    short: 'Reversal',
    badge: 'badge-warning',
    tone: 'var(--warning)',
    icon: Undo2,
    party: 'from',
    blurb: 'Credit restored, or a reward clawed back, when an order ended.',
  },
  admin_adjustment: {
    label: 'Staff adjustment',
    short: 'Staff',
    badge: 'badge-danger',
    tone: 'var(--danger)',
    icon: UserCog,
    party: 'by',
    blurb: 'A person moved this money by hand.',
  },
  voucher_redeem: {
    label: 'Voucher redeemed',
    short: 'Voucher',
    badge: 'badge-success',
    tone: 'var(--success)',
    icon: Gift,
    party: null,
    blurb: 'A bearer voucher turned into credit on this account.',
  },
};

function typeMeta(type) {
  return TYPE_META[type] ?? {
    label: String(type ?? 'unknown').replace(/_/g, ' '),
    short: String(type ?? 'unknown').replace(/_/g, ' '),
    badge: 'badge-muted',
    tone: 'var(--text-muted)',
    icon: Activity,
    party: null,
    blurb: '',
  };
}

// Every type the constraint allows, so each can be isolated. Leaving
// `order_refund` out once meant the credit returned on a cancelled order — and
// the negative clawback `orderRestore` writes alongside it — could only be
// found by scrolling the unfiltered ledger.
const TYPE_FILTERS = ['', ...Object.keys(TYPE_META)];

/**
 * The second party on a row, named for what it actually is.
 *
 * Returns null when the type has no counterparty, so the cell can say so once
 * rather than printing "via —" on half the ledger.
 */
function counterparty(tx) {
  const { party } = typeMeta(tx.type);
  if (!party || tx.related_user_id == null || tx.related_user_id === tx.user_id) return null;
  return {
    preposition: party,
    id: tx.related_user_id,
    // The endpoint joins `users as related` for this. It used not to, so the
    // page could only ever print `#41` — attribution spelled as homework.
    name: tx.related_username || `#${tx.related_user_id}`,
  };
}

export default function StoreCreditLedger() {
  const { user } = useAuth();
  const { settings } = useTheme();
  const can = useMemo(() => adminCapabilities(user), [user]);
  // The filter lives in the URL so a link to "this account's credit history"
  // is a link somebody can send. The Users table points here with `?user=`.
  const [params, setParams] = useSearchParams();
  const typeFilter = TYPE_FILTERS.includes(params.get('type') || '') ? (params.get('type') || '') : '';
  const userFilter = /^\d+$/.test(params.get('user') || '') ? params.get('user') : '';

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [creditEnabled, setCreditEnabled] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Typed immediately, sent on a delay. Every keystroke firing a query against
  // a table this page pages over made the list flicker through three wrong
  // answers on the way to the right one.
  const [queryInput, setQueryInput] = useState(params.get('q') || '');
  const [query, setQuery] = useState(params.get('q') || '');
  useEffect(() => {
    const t = setTimeout(() => {
      const next = queryInput.trim();
      setQuery(next);
      // The URL carries the search too, so "here is what I am looking at" is a
      // link somebody can paste into a ticket — the same reason `?type=` and
      // `?user=` live there. `replace` because a debounced push would write one
      // history entry per pause in typing and bury the page the operator
      // arrived from under a dozen back presses.
      setParams((prev) => {
        const p = new URLSearchParams(prev);
        if (next) p.set('q', next); else p.delete('q');
        return p;
      }, { replace: true });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryInput]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (typeFilter) qs.set('type', typeFilter);
      if (userFilter) qs.set('user', userFilter);
      if (query) qs.set('q', query);
      const data = await api.get(`/admin/store-credit?${qs}`);
      setRows(data.transactions || []);
      // `count()` arrives as a string through the driver, and a string here
      // made `total / LIMIT` NaN — the pager then reported one page over a
      // ledger with thousands of movements in it.
      setTotal(num(data.total));
      setSummary(data.summary || null);
      if (data.store_credit_enabled !== undefined) setCreditEnabled(!!data.store_credit_enabled);
    } catch (err) {
      toast.error(err.message || 'Failed to load the ledger');
    }
    setLoading(false);
  }, [page, typeFilter, userFilter, query]);

  useEffect(() => { load(); }, [load]);

  // Any change to what is being asked for returns to page one. Without this a
  // filter applied from page 6 lands on page 6 of a shorter result and reads
  // as an empty ledger.
  useEffect(() => { setPage(1); }, [typeFilter, userFilter, query]);

  const setFilter = (next) => {
    const p = new URLSearchParams(params);
    if (next) p.set('type', next); else p.delete('type');
    setParams(p, { replace: true });
  };

  const clearAll = () => {
    setQueryInput('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const filtered = !!(typeFilter || userFilter || query);

  /**
   * The scale the flow gauge is drawn against: the largest movement on this
   * page, never smaller than a cent so a page of zero-value clamp rows cannot
   * divide by nothing.
   *
   * Deliberately per-page rather than global. A gauge scaled to the store's
   * all-time largest adjustment would draw every ordinary row as an invisible
   * sliver forever; scaled to what is on screen it answers the question the
   * operator is actually asking, which is "which of *these* is the big one".
   * The page's maximum is named in the column heading so the scale is never a
   * silent one.
   */
  const gaugeMax = useMemo(
    () => Math.max(0.01, ...rows.map((t) => Math.abs(num(t.amount)))),
    [rows],
  );

  const stats = useMemo(() => {
    if (!summary) return [];
    return [
      {
        key: 'outstanding',
        label: 'Outstanding',
        value: money(summary.outstanding),
        icon: Wallet,
        tone: 'var(--primary)',
        lead: true,
        hint: `${fmtCount(summary.holders)} account${summary.holders === 1 ? '' : 's'} holding credit`,
        title: 'Credit issued and not yet spent — money the store owes its customers. Unaffected by the filters below.',
      },
      {
        key: 'issued',
        label: 'Issued',
        value: money(summary.issued),
        icon: ArrowDownLeft,
        tone: 'var(--success)',
        hint: filtered ? 'matching this filter' : 'all time',
      },
      {
        key: 'spent',
        label: 'Spent & reversed',
        value: money(Math.abs(num(summary.spent))),
        icon: ArrowUpRight,
        tone: 'var(--warning)',
        hint: filtered ? 'matching this filter' : 'all time',
      },
      {
        key: 'movements',
        label: 'Movements',
        value: fmtCount(total),
        icon: Activity,
        tone: 'var(--text-muted)',
        hint: filtered ? 'matching this filter' : 'all time',
      },
    ];
  }, [summary, total, filtered]);

  return (
    <div className="admin-page scl-page">
      <PageHeader
        icon={CreditCard}
        title="Store credit"
        subtitle={summary
          ? `${money(summary.outstanding)} outstanding across ${fmtCount(summary.holders)} account${summary.holders === 1 ? '' : 's'}`
          : 'Every movement of credit the store has made.'}
      >
        <Link to="/admin/invite-links" className="glass-btn glass-btn-sm">
          <Link2 size={14} aria-hidden="true" /> Invite links
        </Link>
      </PageHeader>

      <StatTiles stats={stats} />

      {/* ── The invariant, checked ──
          `store_credit.balance` is a running total the checkout spends against
          and `store_credit_transactions` is the ledger of how it got there.
          Nothing compared them until services/creditReconcile.js — stock has
          had a reconciliation for years and money had none, which is the wrong
          way round.

          Drawn only when something is actually wrong. A permanent "0 accounts
          drift" tile would be a fourth stat nobody reads, and the whole value
          of this is that its appearance means something. */}
      <CreditDrift />

      {/* Issuing bearer vouchers is its own grant (`credit.issue_voucher`),
          drawn only for the people who hold it — a form that would 403 is
          worse than no form. */}
      {can.has('credit.issue_voucher') && (
        <VoucherDesk storeName={settings?.store_name} onChanged={load} />
      )}

      {/* The account filter, when one is on. It is a URL parameter, so it can
          arrive from a link on the Users table with nothing on this page having
          set it — which means the page has to say out loud that it is showing a
          slice, or a one-row ledger reads as a store that has issued credit
          once. */}
      {userFilter && (
        <div className="scl-scope" role="status">
          <Users size={14} aria-hidden="true" />
          <span>
            Showing one account&apos;s credit history —{' '}
            <Link to={`/admin/users?id=${userFilter}`}>
              {rows[0]?.username || `account #${userFilter}`}
            </Link>
          </span>
          <button type="button" className="glass-btn glass-btn-sm" onClick={clearAll}>
            <FilterX size={13} aria-hidden="true" /> Whole ledger
          </button>
        </div>
      )}

      <div className="admin-toolbar is-sticky">
        <div className="status-filter-row" role="group" aria-label="Filter by movement type">
          {TYPE_FILTERS.map((t) => {
            const meta = t ? typeMeta(t) : null;
            return (
              <button
                key={t || '__all'}
                type="button"
                className={`status-filter-pill${typeFilter === t ? ' active' : ''}`}
                onClick={() => setFilter(t)}
                aria-pressed={typeFilter === t}
                title={meta ? meta.blurb : 'Every movement type'}
              >
                {meta ? <meta.icon size={13} aria-hidden="true" /> : null}
                {meta ? meta.label : 'All movements'}
              </button>
            );
          })}
        </div>

        <div className="admin-search">
          <Search size={15} aria-hidden="true" />
          <input
            className="glass-input"
            type="search"
            placeholder="Account, note or order ref…"
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            aria-label="Search the store credit ledger"
          />
        </div>
      </div>

      <LedgerList
        rows={rows}
        loading={loading}
        gaugeMax={gaugeMax}
        filtered={filtered}
        onClear={clearAll}
      />

      <Pager
        page={page}
        totalPages={totalPages}
        total={total}
        noun="movement"
        label="Store credit ledger pages"
        onChange={setPage}
      />

      {/* The panel that writes the rows above. The two share a page because the
          ledger is the receipt for anything typed in here — and because this
          form used to exist twice, in two versions that had already drifted. */}
      <CreditAdjuster
        initialUserId={userFilter}
        enabled={creditEnabled}
        onApplied={() => { setPage(1); load(); }}
        footerLinks={<Link to="/admin/invite-links" className="glass-btn glass-btn-sm">Invite links</Link>}
      />
    </div>
  );
}

/**
 * The ledger itself.
 *
 * One record per line on a wide screen, one card per record on a narrow one —
 * and the switch is a CONTAINER query in the stylesheet, not a viewport query,
 * so this behaves correctly if it is ever dropped into a narrow panel on a wide
 * monitor. Every field survives the fold; §5 is explicit that the phone view is
 * not the desktop view with columns deleted.
 */
function LedgerList({ rows, loading, gaugeMax, filtered, onClear }) {
  if (loading) {
    return (
      <div className="lrows scl-rows" aria-busy="true" aria-label="Loading the store credit ledger">
        <div className="lrows-head scl-head" aria-hidden="true">
          <span>When</span><span>Account</span><span>Movement</span>
          <span className="scl-gauge-head">Amount</span><span>Why</span><span>Order</span>
        </div>
        {Array.from({ length: 10 }, (_, i) => <div key={i} className="lrow-skel" />)}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="lrows scl-rows">
        {/* §9: an empty state is navigation, not an apology. The two ways out
            are widening the filter and the form that writes these rows — which
            is on this very page, hence the anchor. */}
        <div className="lrows-empty">
          <strong>{filtered ? 'Nothing matches that.' : 'No credit has moved yet.'}</strong>
          {filtered
            ? 'No movement on record matches the current filter and search.'
            : 'Referral rewards, checkout spends, order reversals and staff adjustments all land here.'}
          <div className="lrows-empty-links">
            {filtered && (
              <button type="button" className="glass-btn glass-btn-sm" onClick={onClear}>
                <FilterX size={13} aria-hidden="true" /> Clear filters
              </button>
            )}
            <a href="#adjust-credit" className="glass-btn glass-btn-sm">Adjust a balance</a>
            <Link to="/admin/invite-links" className="glass-btn glass-btn-sm">Invite links</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lrows scl-rows">
      <div className="lrows-head scl-head">
        <span>When</span>
        <span>Account</span>
        <span>Movement</span>
        {/* The gauge's scale is named rather than implied. A bar drawn against
            an unstated maximum invites the reader to compare it with a bar on
            the previous page, which is not a comparison it supports. */}
        <span className="scl-gauge-head">
          Amount <em>out ← → in, to {money(gaugeMax)}</em>
        </span>
        <span>Why</span>
        <span>Order</span>
      </div>

      {rows.map((tx) => (
        <LedgerRow key={tx.id} tx={tx} gaugeMax={gaugeMax} />
      ))}
    </div>
  );
}

function LedgerRow({ tx, gaugeMax }) {
  const meta = typeMeta(tx.type);
  const amount = num(tx.amount);
  const out = amount < 0;
  // A 0.00 row is a real record, not a rounding artefact: `adminAdjustCredit`
  // writes one when a deduction is clamped away entirely, precisely so the
  // attempt leaves a trace. It is neither in nor out, so it gets neither sign
  // and neither colour — "+$0.00" asserts that something was added, which is
  // the one thing that did not happen.
  const still = amount === 0;
  const other = counterparty(tx);
  const at = tx.created_at ? new Date(tx.created_at) : null;

  // The gauge. A percentage of half the track, because the track has a centre
  // axis and each direction owns one side of it. Floored at 1.5% so that a
  // $2.38 reward beside a $999 adjustment is still a visible tick rather than
  // nothing at all — a row whose amount is drawn as zero width reads as a row
  // with no amount, which is a different and wrong statement.
  const share = Math.min(1, Math.abs(amount) / gaugeMax);
  const width = amount === 0 ? 0 : Math.max(1.5, share * 50);

  return (
    <div className="lrow scl-row" style={{ '--lrow-tone': meta.tone }}>
      {/* §4: hover discloses the exact timestamp behind the coarse one. */}
      <span className="lrow-id scl-when" title={at ? at.toLocaleString() : undefined}>
        {at ? relTime(at.getTime()) : '—'}
      </span>

      <span className="lrow-stack scl-who">
        {/* Whose balance moved. Linked unconditionally — the old page only made
            this a link when a counterparty existed, and then linked to the
            counterparty while printing this name. */}
        <Link to={`/admin/users?id=${tx.user_id}`} className="lrow-text">
          {tx.username || `#${tx.user_id}`}
        </Link>
        {/* Only when there is one. A row without a counterparty printed "—" on
            a second line, which cost every order_discount and every plain
            refund an extra line of height to say nothing — better than half
            the ledger, two lines tall, carrying one em dash each (§7: every
            element on screen should be something the reader is there to
            read). The rows are vertically centred, so the shorter ones simply
            take less room. */}
        {other && (
          <small>
            {other.preposition}{' '}
            <Link to={`/admin/users?id=${other.id}`}>{other.name}</Link>
          </small>
        )}
      </span>

      <span className="scl-type">
        <span className={`badge ${meta.badge}`} title={meta.blurb}>
          <meta.icon size={11} aria-hidden="true" />
          <span className="scl-type-full">{meta.label}</span>
          <span className="scl-type-short">{meta.short}</span>
        </span>
      </span>

      {/* The flow gauge. `aria-hidden` on the drawing and the figure beside it
          in text: the bar is a second channel for something already stated, so
          a screen reader gets the sentence and not a description of a shape. */}
      <span className={`scl-amount${still ? ' is-still' : out ? ' is-out' : ' is-in'}`}>
        <span className="scl-gauge" aria-hidden="true">
          <span className="scl-gauge-axis" />
          <span className="scl-gauge-bar" style={{ width: `${width}%` }} />
        </span>
        <strong className="t-num scl-figure">
          {still ? '' : out ? '−' : '+'}{money(Math.abs(amount))}
        </strong>
      </span>

      {/* The note is prose and the only explanation the row will ever carry, so
          it is clamped rather than truncated to one line — two lines of it is
          usually the whole sentence — and hover gives the rest. */}
      <span className="scl-note" title={tx.note || undefined}>
        {tx.note || <span className="scl-noparty">No note</span>}
      </span>

      {/* `is-empty` so the card shape can drop the cell entirely. On the table
          an em dash is right — the column exists and the row has nothing in it
          — but a card that prints "ORDER —" has spent a line saying there is
          no order, which is not a thing anyone came to read. */}
      <span className={`scl-order${tx.related_order_uuid ? '' : ' is-empty'}`}>
        {tx.related_order_uuid ? (
          // The shared order detail page every other admin table links to.
          // This once read `tx.order_uuid ?? tx.order_id`, neither of which the
          // endpoint sends, so every row fell to an em dash and the ledger's
          // only route back to the order that moved the money was dead.
          <Link to={`/orders/${tx.related_order_uuid}`} className="t-hash">
            {orderRef({ uuid: tx.related_order_uuid })}
          </Link>
        ) : (
          <span className="scl-noparty">—</span>
        )}
      </span>
      <NextStops route="/admin/store-credit" />
    </div>
  );
}
