import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import { useTheme } from '../../context/ThemeContext';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import CouponVoucher, { couponState, money, shortDate } from '../../components/admin/CouponVoucher';
import CouponPrinter from '../../components/admin/CouponPrinter';
import ViewToggle from '../../components/ViewToggle';
import useViewMode from '../../hooks/useViewMode';
import toast from 'react-hot-toast';
import {
  Ticket, Plus, X, Search, Printer, Power, Trash2, Copy, Check, Zap, Users,
  TrendingUp, UserPlus,
} from 'lucide-react';
import CouponScope from '../../components/admin/CouponScope';
import AskAbout from '../../components/admin/AskAbout';

/**
 * What the codes actually did.
 *
 * ── The question the redemption meter could not answer ──────────────────────
 *
 * Every card on this page has shown `current_uses / max_uses` since the page
 * existed. That says a code was used forty times and nothing else: not what
 * those forty uses cost, not what the orders carrying them were worth, not
 * whether any of them reached somebody who had never bought here before. The
 * rows to answer all three have been in `coupon_uses` the whole time and had
 * only ever been read to enforce a per-user cap.
 *
 * ── Money here is a second permission ───────────────────────────────────────
 *
 * The server decides it — `analytics.revenue`, exactly as the analytics pages
 * decide it — and sends `money_hidden` so this can say which half it is
 * showing instead of drawing a column of dashes that look like a bug. A
 * manager who writes coupons but cannot read takings still gets the counts,
 * which is most of what "is this code working" means.
 *
 * ── The baseline is a comparison, never a claim ─────────────────────────────
 *
 * The footer prints what an order with NO code averaged over the same window.
 * That is two measured numbers side by side. The service refuses to compute an
 * "incremental revenue" figure and this refuses to imply one: nothing here
 * says the code caused the difference, because nothing in the schema knows.
 */
function PerformancePanel({ days = 90 }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/coupons/admin/performance?days=${days}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((err) => { if (alive) setError(err.message || 'Could not load coupon performance'); });
    return () => { alive = false; };
  }, [days]);

  // Silent on failure rather than shouting: this is a panel beside the real
  // work of the page, and a red box over a report nobody asked for would make
  // a working coupon desk look broken.
  if (error || !data) return null;
  if (!data.coupons.length) return null;

  const hidden = data.money_hidden === true;
  return (
    <section className="glass-card admin-panel-in cpf-panel" style={{ marginBottom: 'var(--sp-6)' }} aria-label="Coupon performance">
      <header className="cpf-head">
        <TrendingUp size={15} aria-hidden="true" />
        <strong>What they did — last {data.window_days} days</strong>
        <AskAbout
          question="How have the discount codes performed? Which were redeemed most, what did each give away, and how many redemptions were somebody's first order?"
          label="Ask"
          title="Ask the assistant how the codes have performed"
          className="cpf-ask"
        />
      </header>

      <ul className="cpf-list">
        {data.coupons.slice(0, 8).map((c) => (
          <li key={c.id} className="cpf-row">
            <span className="cpf-code">{c.code}</span>
            <span className="cpf-stat" title="Redemptions, and how many separate accounts made them">
              <Users size={11} aria-hidden="true" /> {c.redemptions} used
              <em>{c.buyers} buyer{c.buyers === 1 ? '' : 's'}</em>
            </span>
            {/* The one figure that says whether a code recruited anybody or
                just discounted people who were already buying. */}
            {c.first_order_redemptions > 0 && (
              <span className="cpf-stat is-new" title="Redemptions that were that buyer's first order here">
                <UserPlus size={11} aria-hidden="true" /> {c.first_order_redemptions} first order{c.first_order_redemptions === 1 ? '' : 's'}
              </span>
            )}
            {!hidden && (
              <span className="cpf-stat" title="Given away, against what the orders carrying this code were worth">
                {money(c.discount_given)} off {money(c.order_revenue)}
                {c.discount_rate_pct != null && <em>{c.discount_rate_pct}% of gross</em>}
              </span>
            )}
          </li>
        ))}
      </ul>

      {data.coupons.length > 8 && (
        <p className="admin-hint cpf-more">And {data.coupons.length - 8} more.</p>
      )}

      {!hidden && data.baseline.average_order_value != null && (
        <p className="cpf-baseline">
          An order with no code averaged {money(data.baseline.average_order_value)} over the same window,
          across {data.baseline.orders.toLocaleString()} order{data.baseline.orders === 1 ? '' : 's'}.
          {' '}That is a comparison, not a verdict — nothing here knows what these buyers would have
          spent without the code.
        </p>
      )}
      {hidden && (
        <p className="admin-hint cpf-baseline">
          Counts only — the money on these codes needs the revenue permission.
        </p>
      )}
    </section>
  );
}

/**
 * How long the rip takes, end to end.
 *
 * Mirrors `coupon-tear-body` / `coupon-tear-stub` in the stylesheet. Pulling
 * the row out of the grid before the halves have fallen unmounts them
 * mid-air, so the delete waits this out even when the server answered first.
 */
const TEAR_MS = 760;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const EMPTY_COUPON = {
  code: '',
  type: 'percent',
  value: '',
  min_order_amount: '',
  max_uses: '',
  uses_per_user: '1',
  starts_at: '',
  expires_at: '',
  active: true,
  // The three restrictions, each defaulting to the behaviour coupons had
  // before they existed: the whole order, any tier, any order. That is not
  // politeness — a restriction whose default is anything other than "no
  // restriction" would silently narrow every coupon an operator creates
  // without reading this panel.
  scope: 'order',
  scope_group_ids: [],
  scope_categories: [],
  first_order_only: false,
  min_tier_id: null,
};

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Switched off' },
  { key: 'scheduled', label: 'Starts later' },
  { key: 'expired', label: 'Expired' },
  { key: 'exhausted', label: 'Redeemed' },
];

/**
 * DESIGN §6 — which of the three shapes this list is: **a toggle.**
 *
 * Not the responsive table, because the voucher is not a card standing in for
 * a table row. It is the §10 flourish that does a job: the identical component
 * renders onto paper through `.coupon-print-sheet` — notches, perforation,
 * barcode and all — and deleting one rips it along that perforation. Fold the
 * ticket into a table and the printable artefact goes with it.
 *
 * But a store running forty codes at once is asking a different question —
 * which of these still work, what is left on each, what expires this week —
 * and forty tickets at 178px tall is five screens of scrolling to answer it.
 * So both views exist and `useViewMode` remembers which one this operator
 * works in: the ticket for the one coupon you are about to hand somebody, the
 * line item for the wall of them.
 */
const ROW_COLS = 'minmax(0, 1.3fr) 116px 104px 128px minmax(0, 1fr) minmax(0, 1.4fr) 140px';

/**
 * The line item's accent answers a different question from the ticket's.
 *
 * `--cpn-tone` on a voucher says which *kind* of discount it is — the brand
 * tone for percent, green for flat — which is the right thing to colour when
 * one ticket fills a card and the number is the whole point. Nobody scanning
 * forty lines is looking for percent-versus-flat; they are looking for which
 * codes are still working. So the row tones by state and moves the kind into
 * words under the code, and both channels stay readable at `--glow-strength: 0`
 * because the pill prints the state as a word too.
 */
const STATE_TONE = {
  active: 'var(--success)',
  inactive: 'var(--warning)',
  expired: 'var(--text-muted)',
  exhausted: 'var(--info)',
  // Info rather than warning: a code waiting for its date is the plan working,
  // not something to chase. It reads as the same class of fact as "fully
  // redeemed" — this one is finished, that one has not begun.
  scheduled: 'var(--info)',
};

/**
 * The state as a word, read back out of the filter pills.
 *
 * Deliberately not a second `{ active: 'Active', … }` map: the pill an operator
 * clicked to narrow the list and the pill printed on the rows it returned have
 * to say the same thing, and two maps drift the moment one of them is edited.
 */
const stateLabel = (state) => FILTERS.find(f => f.key === state)?.label ?? state;

/** Whole days from now until `when`, negative once it has passed. */
const daysUntil = (when) => Math.ceil((new Date(when).getTime() - Date.now()) / 86400000);

/** The seven-day window the voucher already warns inside, named so the row's
 *  amber and the ticket's amber cannot start disagreeing about "soon". */
const EXPIRY_WARN_DAYS = 7;

/**
 * The expiry, as the thing somebody actually reads off a wall of codes.
 *
 * A date alone makes the reader do arithmetic against today for every row; the
 * date alone is also the only thing that survives being printed, which is why
 * the ticket keeps it and the row prints both.
 */
function expiryNote(when) {
  const d = daysUntil(when);
  if (d > 1) return `in ${d} days`;
  if (d === 1) return 'tomorrow';
  if (d === 0) return 'today';
  if (d === -1) return 'yesterday';
  return `${Math.abs(d)} days ago`;
}

/**
 * One coupon as a line item: the same record the voucher draws, re-flowed so
 * forty of them fit on a screen.
 *
 * Every field the ticket carries is still here — code, kind, discount, the
 * redemption meter, expiry, state, minimum order and per-customer limit — laid
 * along one axis instead of stacked. §5 is explicit that a second view is not
 * the first with columns deleted, and the fields an operator drops a coupon for
 * (is it live, how much is left on it) are exactly the ones a table would have
 * been tempted to cut.
 */
function CouponRow({ coupon, tearing, onToggle, onDelete, onPrint }) {
  const [copied, setCopied] = useState(false);
  const state = couponState(coupon);
  const tone = STATE_TONE[state];

  const used = Number(coupon.current_uses ?? coupon.uses_count ?? 0);
  const cap = coupon.max_uses == null ? null : Number(coupon.max_uses);
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  const minOrder = Number(coupon.min_order_amount || 0);
  const perUser = Number(coupon.uses_per_user || 1);
  const expiringSoon = coupon.expires_at && state === 'active'
    && daysUntil(coupon.expires_at) <= EXPIRY_WARN_DAYS;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(coupon.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <div
      className={`lrow cpn-lrow${state === 'active' ? '' : ' is-spent'}${tearing ? ' is-busy' : ''}`}
      /* One value drives the row's left edge and the redemption meter, so a
         line can never say "live" in green while its meter says something
         else. `--cpn-tone` is the name the meter already reads. */
      style={{ '--lrow-tone': tone, '--cpn-tone': tone }}
    >
      <div className="lrow-stack">
        <span className="cpn-lrow-code">{coupon.code}</span>
        <small>{coupon.type === 'percent' ? 'Percent off' : 'Amount off'}</small>
      </div>

      <span className="coupon-state cpn-lrow-state">{stateLabel(state)}</span>

      <span className="lrow-num cpn-lrow-value">
        {coupon.type === 'percent'
          ? `${Number(coupon.value)}%`
          : money(coupon.value)}
      </span>

      <div className="cpn-lrow-uses">
        <span className="lrow-num">{cap == null ? used : `${used} / ${cap}`}</span>
        {cap == null ? (
          <small>no limit</small>
        ) : (
          <div
            className="coupon-meter cpn-lrow-meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={cap}
            aria-valuenow={used}
            aria-label={`${used} of ${cap} redemptions used`}
          >
            <div className={`coupon-meter-fill${pct >= 100 ? ' is-full' : ''}`} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {/* Whichever end of the window is the next thing to happen. A code that
          has not started yet is read for "when does it go live", and printing
          its expiry there answers a question nobody has asked yet — the row is
          six fields wide and cannot afford both. Once it is running the expiry
          is the live fact again, which is what this cell has always shown. */}
      <div className="lrow-stack cpn-lrow-exp">
        {state === 'scheduled' ? (
          <>
            <span>Starts {shortDate(coupon.starts_at)}</span>
            <small>{expiryNote(coupon.starts_at)}</small>
          </>
        ) : (
          <>
            <span className={expiringSoon ? 'is-warn' : undefined}>
              {coupon.expires_at ? shortDate(coupon.expires_at) : 'No expiry'}
            </span>
            {coupon.expires_at && <small>{expiryNote(coupon.expires_at)}</small>}
          </>
        )}
      </div>

      <span className="lrow-text cpn-lrow-scope">
        {minOrder > 0 ? `${money(minOrder)} minimum` : 'No minimum'}
        {' · '}
        {perUser === 1 ? '1 per customer' : `${perUser} per customer`}
      </span>

      {/* Icon-only, because four labelled buttons per line is more chrome than
          record. Every one keeps a `title` and an off-screen name, and the
          whole group is revealed on hover *and* focus-within by `.lrow-actions`
          — hover alone would put the delete out of a keyboard's reach. */}
      <div className="lrow-actions">
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={copy}
          disabled={tearing}
          title={`Copy code ${coupon.code}`}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          <span className="sr-only">Copy code</span>
        </button>
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => onPrint(coupon)}
          disabled={tearing}
          title="Print this coupon as a voucher"
        >
          <Printer size={13} />
          <span className="sr-only">Print</span>
        </button>
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => onToggle(coupon)}
          disabled={tearing}
          title={coupon.active ? 'Switch this code off' : 'Switch this code on'}
        >
          <Power size={13} />
          <span className="sr-only">{coupon.active ? 'Switch off' : 'Switch on'}</span>
        </button>
        <button
          type="button"
          className="glass-btn glass-btn-sm glass-btn-danger"
          onClick={() => onDelete(coupon)}
          disabled={tearing}
          title="Delete this coupon"
        >
          <Trash2 size={13} />
          <span className="sr-only">Delete</span>
        </button>
      </div>
    </div>
  );
}

export default function Coupons() {
  const { settings } = useTheme();
  const reduced = usePrefersReducedMotion();
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newCoupon, setNewCoupon] = useState({ ...EMPTY_COUPON });
  const [creating, setCreating] = useState(false);
  const [justPrinted, setJustPrinted] = useState(null);
  const [tearing, setTearing] = useState(() => new Set());
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [printJob, setPrintJob] = useState(null);
  // Tickets or line items, remembered per operator. See hooks/useViewMode.js.
  const [view, setView] = useViewMode('admin-coupons');

  const fetchCoupons = async () => {
    setLoading(true);
    try {
      const data = await api.get('/coupons/admin');
      setCoupons(data.coupons || data || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load coupons');
    }
    setLoading(false);
  };

  useEffect(() => { fetchCoupons(); }, []);

  /**
   * Hand the ticket to a real printer.
   *
   * Only ever reached from a Print button — creating a coupon animates one out
   * of the panel instead, and never opens this dialog on its own.
   *
   * The sheet has to exist and be laid out before `window.print()` freezes the
   * page, so the call is deferred rather than made during the commit.
   *
   * Two timers race, and the first one to arrive prints. A double
   * `requestAnimationFrame` is the accurate signal — it lands right after the
   * browser has laid the sheet out — but it never fires at all while the
   * document is hidden, which is exactly what happens if the operator switches
   * tabs after clicking Print. On its own it would leave the voucher mounted
   * and no dialog ever opening, with nothing on screen to explain why. The
   * timeout is the floor that guarantees the print happens; `fired` keeps the
   * loser of the race from opening a second dialog.
   *
   * `afterprint` clears the sheet whether the dialog was confirmed or
   * cancelled — a dismissed job should not leave the page stuck in a printing
   * state.
   */
  useEffect(() => {
    if (!printJob) return undefined;

    let fired = false;
    const fire = () => {
      if (fired) return;
      fired = true;
      window.print();
    };

    const clear = () => setPrintJob(null);
    window.addEventListener('afterprint', clear);

    let inner = 0;
    const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(fire); });
    const timer = window.setTimeout(fire, 120);

    return () => {
      window.removeEventListener('afterprint', clear);
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      window.clearTimeout(timer);
    };
  }, [printJob]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newCoupon.code.trim()) return toast.error('Code is required');
    if (!newCoupon.value) return toast.error('Value is required');
    if (newCoupon.type === 'percent' && Number(newCoupon.value) > 100) {
      return toast.error('A percent discount cannot exceed 100%');
    }
    setCreating(true);
    try {
      // Blanks are sent as empty strings and resolved server-side to the
      // column's own default, so an untouched optional box means "no limit"
      // rather than a failed insert.
      const body = {
        ...newCoupon,
        code: newCoupon.code.trim().toUpperCase(),
        value: parseFloat(newCoupon.value),
        min_order_amount: newCoupon.min_order_amount || '',
        max_uses: newCoupon.max_uses || '',
        uses_per_user: newCoupon.uses_per_user || '',
        starts_at: newCoupon.starts_at || null,
        expires_at: newCoupon.expires_at || null,
        // Sent as they are. The server validates the combination and refuses a
        // scope that names nothing — a half-filled scope must not become a
        // store-wide coupon, which is the one failure direction here that costs
        // real money. See `restrictionPatch` in controllers/couponController.
        scope: newCoupon.scope,
        scope_group_ids: newCoupon.scope_group_ids,
        scope_categories: newCoupon.scope_categories,
        first_order_only: newCoupon.first_order_only,
        min_tier_id: newCoupon.min_tier_id,
      };
      const created = await api.post('/coupons/admin', body);
      toast.success(`Coupon ${created.code} created`);
      setShowCreate(false);
      setNewCoupon({ ...EMPTY_COUPON });
      fetchCoupons();
      // The form makes way for the printer in the same panel. The endpoint
      // returns the stored row, so the ticket that feeds out carries the
      // values the database actually holds rather than what was typed.
      if (created?.code) setJustPrinted(created);
    } catch (err) {
      toast.error(err.message || 'Failed to create coupon');
    }
    setCreating(false);
  };

  const toggleActive = async (coupon) => {
    try {
      await api.put(`/coupons/admin/${coupon.id}`, { active: !coupon.active });
      toast.success(`${coupon.code} ${!coupon.active ? 'switched on' : 'switched off'}`);
      fetchCoupons();
    } catch (err) {
      toast.error(err.message || 'Failed to update coupon');
    }
  };

  const untear = (id) => setTearing((prev) => {
    const next = new Set(prev);
    next.delete(id);
    return next;
  });

  /**
   * Delete a coupon, and rip it in half on the way out.
   *
   * The tear starts on the operator's yes rather than on the server's, so the
   * ticket reacts to the click instead of to the round trip. The halves fill
   * forwards where they land, so a slow request just leaves an empty shell in
   * the grid a moment longer.
   *
   * A rejected delete puts the ticket back rather than leaving a hole the next
   * refetch would silently refill.
   *
   * There is no ticket to rip in the rows view, so the wait is skipped there
   * along with the reduced-motion case. Holding a line item on screen for
   * three-quarters of a second after the server has already deleted it is not
   * a flourish, it is lag — and on a wall of forty codes an operator clearing
   * several would be watching a queue of rows that are already gone.
   */
  const deleteCoupon = async (coupon) => {
    if (!confirm(`Delete coupon "${coupon.code}"? This cannot be undone.`)) return;

    setTearing((prev) => new Set(prev).add(coupon.id));
    const torn = sleep(reduced || view === 'rows' ? 0 : TEAR_MS);

    try {
      await api.delete(`/coupons/admin/${coupon.id}`);
    } catch (err) {
      untear(coupon.id);
      toast.error(err.message || 'Failed to delete coupon');
      return;
    }

    await torn;
    toast.success('Coupon deleted');
    // Dropped from local state rather than refetched: a refetch landing
    // mid-rip unmounts the ticket and the halves never finish falling. The row
    // is already gone server-side, so the list needs no round trip to agree.
    setCoupons((cs) => cs.filter((c) => c.id !== coupon.id));
    untear(coupon.id);
  };

  const counts = useMemo(() => {
    const tally = { all: coupons.length, active: 0, inactive: 0, expired: 0, exhausted: 0, scheduled: 0 };
    coupons.forEach(c => { tally[couponState(c)] += 1; });
    return tally;
  }, [coupons]);

  const redeemed = useMemo(
    () => coupons.reduce((sum, c) => sum + Number(c.current_uses ?? c.uses_count ?? 0), 0),
    [coupons],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return coupons
      .filter(c => filter === 'all' || couponState(c) === filter)
      .filter(c => !q || c.code.toLowerCase().includes(q));
  }, [coupons, filter, query]);

  const field = (key, label, type = 'text', extra = {}) => (
    <div className="form-group">
      <label htmlFor={`coupon-${key}`}>{label}</label>
      <input
        id={`coupon-${key}`}
        className="glass-input"
        type={type}
        value={newCoupon[key]}
        onChange={(e) => setNewCoupon({ ...newCoupon, [key]: e.target.value })}
        {...extra}
      />
    </div>
  );

  const storeName = settings.store_name || 'CryptoStore';

  return (
    <div className="admin-page">
      <header className="admin-page-head">
        <div>
          <h1 className="page-title admin-page-title">
            <Ticket size={22} aria-hidden="true" />
            Coupons
          </h1>
          <p className="admin-page-sub">
            {counts.all === 0
              ? 'No coupons yet — create one and it prints as a voucher.'
              : `${counts.active} live of ${counts.all} · ${redeemed} redemption${redeemed === 1 ? '' : 's'} so far`}
          </p>
        </div>
        <button
          className="glass-btn glass-btn-primary"
          onClick={() => { setShowCreate(v => !v); setJustPrinted(null); }}
        >
          {showCreate ? <X size={15} /> : <Plus size={15} />}
          {showCreate ? 'Cancel' : 'New coupon'}
        </button>
      </header>

      {showCreate && (
        <div className="glass-card admin-panel-in" style={{ marginBottom: 'var(--sp-6)' }}>
          <h2 className="admin-card-title">New coupon</h2>
          <form onSubmit={handleCreate}>
            <div className="admin-form-grid">
              {field('code', 'Code', 'text', {
                placeholder: 'e.g. SAVE10',
                style: { textTransform: 'uppercase', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' },
                maxLength: 40,
                autoComplete: 'off',
              })}

              <div className="form-group">
                <label htmlFor="coupon-type">Type</label>
                <select
                  id="coupon-type"
                  className="glass-input"
                  value={newCoupon.type}
                  onChange={(e) => setNewCoupon({ ...newCoupon, type: e.target.value })}
                >
                  <option value="percent">Percent (%)</option>
                  <option value="flat">Flat ($)</option>
                </select>
              </div>

              {field('value', newCoupon.type === 'percent' ? 'Value (%)' : 'Value ($)', 'number', {
                min: 0,
                max: newCoupon.type === 'percent' ? 100 : undefined,
                step: 'any',
                placeholder: newCoupon.type === 'percent' ? '10' : '5.00',
              })}
              {field('min_order_amount', 'Minimum order ($)', 'number', { min: 0, step: 'any', placeholder: 'No minimum' })}
              {field('max_uses', 'Total redemptions', 'number', { min: 1, step: 1, placeholder: 'Unlimited' })}
              {field('uses_per_user', 'Per customer', 'number', { min: 1, step: 1 })}
              {/* Both ends of the window, adjacent. Coupons carried an expiry
                  and no start for as long as they have existed, which made a
                  code for Friday's sale a thing somebody had to remember to
                  switch on — while the flash sale two panels away has had
                  `starts_at` and `ends_at` all along. Blank means "already
                  started", so nothing about an ordinary code changes. */}
              {field('starts_at', 'Starts', 'date', { placeholder: 'Right away' })}
              {field('expires_at', 'Expires', 'date')}

              <div className="form-group admin-form-check">
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={newCoupon.active}
                    onChange={(e) => setNewCoupon({ ...newCoupon, active: e.target.checked })}
                  />
                  <span className="switch-track" />
                </label>
                <span>{newCoupon.starts_at ? 'Live from the start date' : 'Live immediately'}</span>
              </div>
            </div>

            {/* Scope, tier floor and first-order-only, as one fieldset rather
                than three more boxes in the grid above: they compound, and an
                operator can easily configure a coupon nobody qualifies for.
                The component says out loud what the combination will do. */}
            <CouponScope value={newCoupon} onChange={setNewCoupon} />

            <div className="admin-form-actions">
              <button type="submit" className="glass-btn glass-btn-primary" disabled={creating}>
                {creating ? 'Creating…' : <><Plus size={15} /> Create coupon</>}
              </button>
              <button
                type="button"
                className="glass-btn"
                onClick={() => { setShowCreate(false); setNewCoupon({ ...EMPTY_COUPON }); }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* The form's panel, once the form has done its job: the coupon that was
          just created feeds out of a slot where the fields were standing. */}
      {!showCreate && justPrinted && (
        <div className="glass-card admin-panel-in" style={{ marginBottom: 'var(--sp-6)' }}>
          <CouponPrinter
            coupon={justPrinted}
            onPrint={setPrintJob}
            onDone={() => setJustPrinted(null)}
          />
        </div>
      )}

      {/* What the codes did, above the codes themselves: an operator opening
          this page to decide whether to retire something is answering that
          question before they scroll to the cards. */}
      {coupons.length > 0 && <PerformancePanel />}

      {/* Filters */}
      {coupons.length > 0 && (
        <div className="admin-toolbar">
          <div className="status-filter-row" role="group" aria-label="Filter coupons">
            {FILTERS.map(f => (
              <button
                key={f.key}
                type="button"
                className={`status-filter-pill${filter === f.key ? ' active' : ''}`}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
              >
                {f.label}
                <span className="status-filter-count">{counts[f.key]}</span>
              </button>
            ))}
          </div>
          <div className="admin-toolbar-group">
            <div className="admin-search">
              <Search size={15} aria-hidden="true" />
              <input
                className="glass-input"
                type="search"
                placeholder="Find a code…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Search coupon codes"
              />
            </div>
            <ViewToggle
              value={view}
              onChange={setView}
              label="Coupon layout"
              cardsLabel="Vouchers"
              rowsLabel="Rows"
            />
          </div>
        </div>
      )}

      {/* Vouchers, or the wall of codes */}
      {loading ? (
        view === 'rows' ? (
          <div className="lrows cpn-rows" style={{ '--lrow-cols': ROW_COLS }} aria-busy="true" aria-label="Loading coupons">
            {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton lrow-skel" />)}
          </div>
        ) : (
          <div className="coupon-grid">
            {[0, 1, 2].map(i => <div key={i} className="skeleton skeleton-coupon" />)}
          </div>
        )
      ) : visible.length === 0 ? (
        /* One empty state for both views on purpose — the reason the list is
           empty has nothing to do with how it would have been drawn, and two
           copies is two places for the wording to rot.

           §9: this is navigation, not an apology. A store with no coupons is
           not necessarily a store with no discounts, so the ways out are the
           other two mechanisms that price without a code. */
        <div className="glass-card empty-state">
          <Ticket size={34} aria-hidden="true" />
          <h3>{coupons.length === 0 ? 'No coupons yet' : 'No code matches that'}</h3>
          <p>
            {coupons.length === 0
              ? 'A coupon is a code a buyer types at checkout. Create one and it prints as a tear-off voucher — or discount without a code at all.'
              : 'Nothing answers to that filter and that search together.'}
          </p>
          <div className="cpn-empty-acts">
            {coupons.length === 0 ? (
              <>
                <button
                  type="button"
                  className="glass-btn glass-btn-primary"
                  onClick={() => { setShowCreate(true); setJustPrinted(null); }}
                >
                  <Plus size={15} aria-hidden="true" /> New coupon
                </button>
                <Link className="glass-btn" to="/admin/flash-sales">
                  <Zap size={15} aria-hidden="true" /> Flash sales
                </Link>
                <Link className="glass-btn" to="/admin/tiers">
                  <Users size={15} aria-hidden="true" /> Customer tiers
                </Link>
              </>
            ) : (
              <button
                type="button"
                className="glass-btn"
                onClick={() => { setFilter('all'); setQuery(''); }}
              >
                <X size={14} aria-hidden="true" /> Show all {counts.all} coupon{counts.all === 1 ? '' : 's'}
              </button>
            )}
          </div>
        </div>
      ) : view === 'rows' ? (
        <div className="lrows cpn-rows" style={{ '--lrow-cols': ROW_COLS }}>
          <div className="lrows-head">
            <span>Code</span>
            <span className="cpn-lrow-h-mid">Status</span>
            <span className="cpn-lrow-h-num">Discount</span>
            <span className="cpn-lrow-h-num">Redeemed</span>
            <span>Expires</span>
            <span>Scope</span>
            <span className="sr-only">Actions</span>
          </div>
          {visible.map(c => (
            <CouponRow
              key={c.id}
              coupon={c}
              tearing={tearing.has(c.id)}
              onToggle={toggleActive}
              onDelete={deleteCoupon}
              onPrint={setPrintJob}
            />
          ))}
        </div>
      ) : (
        <div className="coupon-grid">
          {visible.map(c => (
            <CouponVoucher
              key={c.id}
              coupon={c}
              tearing={tearing.has(c.id)}
              onToggle={toggleActive}
              onDelete={deleteCoupon}
              onPrint={setPrintJob}
            />
          ))}
        </div>
      )}

      {/* Print sheet — invisible on screen, the only thing visible on paper. */}
      {printJob && (
        <div className="coupon-print-root">
          <div className="coupon-print-sheet">
            <div className="coupon-print-head">
              <span className="coupon-print-store">{storeName}</span>
              <span className="coupon-print-kicker">Discount voucher</span>
            </div>

            <div className="coupon-print-cut">
              <CouponVoucher coupon={printJob} print />
            </div>

            <ul className="coupon-print-terms">
              <li>Enter the code above at checkout to redeem this voucher.</li>
              {Number(printJob.min_order_amount || 0) > 0 && (
                <li>Valid on orders of {money(printJob.min_order_amount)} or more, before shipping.</li>
              )}
              <li>
                {Number(printJob.uses_per_user || 1) === 1
                  ? 'Limit one redemption per customer.'
                  : `Limit ${Number(printJob.uses_per_user)} redemptions per customer.`}
              </li>
              {printJob.max_uses != null && (
                <li>Limited to {printJob.max_uses} redemptions in total, across all customers.</li>
              )}
              {/* The restrictions, ON THE PAPER.
                  A printed voucher is handed to somebody who cannot see the
                  admin panel, and a coupon that silently covers only the
                  edibles — or only a first order — reads at the till as a
                  voucher that does not work. A term they can read beforehand
                  is the difference between a condition and a disappointment. */}
              {printJob.scope === 'products' && (
                <li>
                  Valid on selected products only
                  {Array.isArray(printJob.scope_products) && printJob.scope_products.length
                    ? `: ${printJob.scope_products.map((p) => p.name).join(', ')}.`
                    : '.'}
                </li>
              )}
              {printJob.scope === 'categories' && Array.isArray(printJob.scope_categories) && printJob.scope_categories.length > 0 && (
                <li>Valid on {printJob.scope_categories.join(', ')} only.</li>
              )}
              {printJob.first_order_only && (
                <li>Valid on a customer&apos;s first order only.</li>
              )}
              {printJob.min_tier_id != null && (
                <li>For members of the qualifying tier and above.</li>
              )}
              <li>
                {printJob.expires_at
                  ? `Expires ${shortDate(printJob.expires_at)}.`
                  : 'No expiry date.'}
              </li>
              <li>Cannot be exchanged for cash. {storeName} may withdraw this offer at any time.</li>
            </ul>

            <p className="coupon-print-issued">
              Issued {shortDate(Date.now())} · {storeName}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
