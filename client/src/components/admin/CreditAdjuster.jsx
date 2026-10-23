import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  CreditCard, Plus, Minus, X, ArrowRight, AlertTriangle, Lock, UserRound,
} from 'lucide-react';
import { api } from '../../utils/api';
import { money, num } from '../../utils/adminFormat';

/**
 * The panel that moves store credit into or out of one account.
 *
 * **Why this is a module and not markup on a page.** It existed twice, in
 * `admin/StoreCreditLedger.jsx` and `admin/InviteLinks.jsx`, as two near-copies
 * of the same form — and they had already drifted the way CLAUDE.md's parity
 * rule says copies always do. One offered a Clear button and the other did not.
 * One labelled the field "Amount (negative to deduct)" and the other "Amount
 * (can be negative)". One reset its result when the account changed and the
 * other left last account's confirmation sitting under the new id. Both read
 * `result.new_balance`, a field the endpoint has never sent, so both silently
 * fell through to a second guess. Two spellings of one money mutation is
 * exactly the shape this repository keeps failing at, one directory over from
 * where it usually fails.
 *
 * **What it draws that the old form did not.**
 *
 * · *Who.* The field is a user id because that is what `POST
 *   /subusers/admin/credit/:userId` takes, but an id is not a person. The old
 *   form let an operator type `42`, send $500, and find out afterwards whose
 *   account 42 was. The id is resolved against `/admin/users?id=` as it is
 *   typed, and the account's name, role and current balance are shown before
 *   anything can be pressed.
 *
 * · *Which direction.* One signed number carried both the amount and the
 *   intent, so a stray minus was the difference between granting $500 and
 *   taking it. Direction is now its own control and the amount is a magnitude,
 *   which is also the only way to write a form whose submit button can say
 *   what it is about to do.
 *
 * · *What will happen.* `store_credit.balance` carries `CHECK (balance >= 0)`
 *   and the server clamps with `GREATEST(0, …)`, so a deduction larger than the
 *   balance takes only part of what was asked. The server records that
 *   faithfully — `applied` versus `requested`, and a note on the ledger row
 *   saying it clamped — and the old confirmation printed neither, so the one
 *   case where the store did something other than what was typed was the one
 *   case the screen did not mention. It is predicted before the press and
 *   stated plainly after it.
 *
 * DESIGN §10 asks a flourish to do a job. The balance moving from its old
 * figure to its new one is the job: this panel's whole purpose is to change a
 * number, and until it drew that change the operator's only confirmation that
 * the right number moved by the right amount was a toast.
 */

/** The shape a fresh form starts and returns to. */
const EMPTY = { userId: '', amount: '', note: '' };

/**
 * @param {object} props
 * @param {number|string} [props.initialUserId]  pre-filled account, e.g. from `?user=`
 * @param {boolean} [props.enabled]      store credit facility on? null = unknown
 * @param {Function} [props.onApplied]   (result, userId) => void — refresh the ledger
 * @param {import('react').ReactNode} [props.footerLinks]  extra §9 outbound links
 * @param {boolean} [props.canAdjust]    false renders the panel read-only
 */
export default function CreditAdjuster({
  initialUserId = '',
  enabled = null,
  onApplied,
  footerLinks = null,
  canAdjust = true,
}) {
  const [form, setForm] = useState({ ...EMPTY, userId: String(initialUserId || '') });
  // 'credit' | 'deduct'. Held apart from the amount so the field can only ever
  // hold a magnitude — see the header note on the stray minus.
  const [direction, setDirection] = useState('credit');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  // The resolved account behind the id: { id, username, role, balance } while
  // it is known, `null` when the id matches nobody, `undefined` while unknown.
  const [account, setAccount] = useState(undefined);
  const [lookingUp, setLookingUp] = useState(false);

  const magnitude = num(form.amount, NaN);
  const hasAmount = Number.isFinite(magnitude) && magnitude > 0;
  const signed = direction === 'deduct' ? -magnitude : magnitude;

  // Deductions stay available while the facility is frozen — winding the
  // programme down is exactly what that means — but new credit does not. The
  // server enforces this with a 409; mirroring it here means the operator is
  // told before they type an amount rather than after they submit it.
  const frozen = enabled === false;
  const blockedByFreeze = frozen && direction === 'credit';

  /**
   * Resolve the typed id to an account.
   *
   * Debounced, and guarded by a request token: an operator typing `4`, `42`,
   * `421` fires three lookups whose responses can land in any order, and
   * without the token the answer for `4` arriving last would leave the panel
   * describing the wrong account under the right id — which on this particular
   * form is the mistake the lookup exists to prevent.
   *
   * A failure here is deliberately silent. `users.view` is a separate grant
   * from `users.store_credit`, so a manager can legitimately hold the right to
   * move credit without the right to read the user list; the panel degrades to
   * the bare id it always was rather than showing them an error for a request
   * they did not make.
   */
  const lookupToken = useRef(0);
  useEffect(() => {
    const id = form.userId.trim();
    if (!/^\d+$/.test(id)) { setAccount(undefined); setLookingUp(false); return undefined; }

    const token = ++lookupToken.current;
    setLookingUp(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api.get(`/admin/users?id=${encodeURIComponent(id)}&limit=1`);
        if (token !== lookupToken.current) return;
        const hit = (data.users || data.rows || [])[0];
        setAccount(hit && String(hit.id) === id ? hit : null);
      } catch {
        if (token === lookupToken.current) setAccount(undefined);
      } finally {
        if (token === lookupToken.current) setLookingUp(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [form.userId]);

  // `store_credit_balance` is a correlated sub-select that `getUsers` only adds
  // for callers holding a credit grant, and it is NULL for an account that has
  // never had a balance row materialised. "Unknown" and "zero" are different
  // answers and the panel must not print the second for the first: a forecast
  // drawn from an assumed zero would predict a clamp that will not happen.
  const knownBalance = account && account.store_credit_balance != null
    ? num(account.store_credit_balance)
    : null;

  /**
   * What the balance will be if this is submitted, and how much of the request
   * the clamp will refuse.
   *
   * Only computed when the balance is actually known — a prediction made from a
   * balance the panel could not read would be a confident guess about somebody
   * else's money.
   */
  const forecast = (() => {
    if (knownBalance === null || !hasAmount) return null;
    const next = Math.max(0, Math.round((knownBalance + signed) * 100) / 100);
    const applied = Math.round((next - knownBalance) * 100) / 100;
    return { next, applied, clamped: Math.abs(applied - signed) > 0.005 };
  })();

  const reset = () => { setForm({ ...EMPTY }); setResult(null); setDirection('credit'); };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.userId.trim()) return toast.error('Which account? Enter a user id.');
    if (!hasAmount) return toast.error('Enter an amount above zero.');
    if (blockedByFreeze) return toast.error('Store credit is frozen — new credit cannot be issued.');

    setSubmitting(true);
    setResult(null);
    try {
      const data = await api.post(`/subusers/admin/credit/${form.userId.trim()}`, {
        amount: signed,
        note: form.note || undefined,
      });
      // Everything the confirmation draws comes off this response rather than
      // off the form, so the panel reports what the store did and not what was
      // asked for. They differ whenever the clamp fires.
      setResult({ ...data, userId: form.userId.trim(), username: account?.username });
      toast.success(direction === 'credit' ? 'Credit added' : 'Credit deducted');
      // The account's balance is now stale in two places — refetch by nudging
      // the lookup, and hand the fresh figure to whoever owns the list.
      setAccount((prev) => (prev ? { ...prev, store_credit_balance: data.balance } : prev));
      setForm((f) => ({ ...f, amount: '', note: '' }));
      onApplied?.(data, form.userId.trim());
    } catch (err) {
      toast.error(err.message || 'Failed to adjust store credit');
    }
    setSubmitting(false);
  };

  if (!canAdjust) return null;

  return (
    <section className="glass-card credit-adjuster" id="adjust-credit" aria-labelledby="credit-adjuster-title">
      <h3 className="admin-card-title" id="credit-adjuster-title">
        <CreditCard size={16} aria-hidden="true" />
        Adjust store credit
      </h3>

      {/* The freeze is stated where the money is moved, not only in Settings.
          A frozen store still shows a full ledger, so nothing else on the page
          says the facility has stopped. */}
      {frozen && (
        <p className="credit-frozen" role="status">
          <Lock size={13} aria-hidden="true" />
          <span>
            Store credit is switched off for this store. Existing balances stand and can still
            be deducted — winding the programme down is what that means — but no new credit
            can be issued until it is switched back on.
          </span>
        </p>
      )}

      <form onSubmit={submit}>
        <div className="credit-fields">
          {/* ── Who ─────────────────────────────────────────────────────── */}
          <div className="form-group credit-account">
            <label htmlFor="credit-user">Account</label>
            <input
              id="credit-user"
              className="glass-input"
              type="number"
              inputMode="numeric"
              value={form.userId}
              onChange={(e) => { setForm({ ...form, userId: e.target.value }); setResult(null); }}
              placeholder="User id"
              min={1}
              step={1}
              aria-describedby="credit-account-state"
            />
            {/* The resolved identity. Space is reserved for it so the form does
                not jump a line taller the moment an id starts resolving —
                DESIGN §4: a control that reflows under the pointer moves the
                thing beneath it out from under the click. */}
            <p className="credit-account-state" id="credit-account-state" aria-live="polite">
              {!form.userId.trim() ? (
                <span className="credit-hint">Whose balance moves.</span>
              ) : lookingUp ? (
                <span className="credit-hint">Looking up…</span>
              ) : account ? (
                <>
                  <UserRound size={12} aria-hidden="true" />
                  <Link to={`/admin/users?id=${account.id}`} className="credit-account-name">
                    {account.username}
                  </Link>
                  {account.role && account.role !== 'user' && (
                    <span className="badge badge-muted credit-role">{account.role}</span>
                  )}
                  {knownBalance !== null && (
                    <span className="credit-hint">
                      holds <strong className="t-num">{money(knownBalance)}</strong>
                    </span>
                  )}
                </>
              ) : account === null ? (
                <span className="credit-nobody">
                  <AlertTriangle size={12} aria-hidden="true" /> No account with that id.
                </span>
              ) : (
                <span className="credit-hint">Whose balance moves.</span>
              )}
            </p>
          </div>

          {/* ── Which way, and how much ─────────────────────────────────── */}
          <div className="form-group credit-amount">
            <label htmlFor="credit-amount-input">Amount</label>
            <div className="credit-amount-row">
              <div className="segmented credit-direction" role="group" aria-label="Direction">
                <button
                  type="button"
                  className={`segmented-option${direction === 'credit' ? ' active' : ''}`}
                  aria-pressed={direction === 'credit'}
                  onClick={() => { setDirection('credit'); setResult(null); }}
                  disabled={frozen}
                  title={frozen ? 'Store credit is switched off — no new credit can be issued' : 'Add credit to this balance'}
                >
                  <Plus size={13} aria-hidden="true" /> Credit
                </button>
                <button
                  type="button"
                  className={`segmented-option${direction === 'deduct' ? ' active is-deduct' : ''}`}
                  aria-pressed={direction === 'deduct'}
                  onClick={() => { setDirection('deduct'); setResult(null); }}
                  title="Take credit off this balance"
                >
                  <Minus size={13} aria-hidden="true" /> Deduct
                </button>
              </div>
              <div className="credit-amount-field">
                <span className="credit-currency" aria-hidden="true">$</span>
                <input
                  id="credit-amount-input"
                  className="glass-input t-num"
                  type="number"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => { setForm({ ...form, amount: e.target.value }); setResult(null); }}
                  placeholder="0.00"
                  min={0}
                  step="0.01"
                  aria-describedby="credit-forecast"
                />
              </div>
            </div>

            {/* What is about to happen, in the same shape the confirmation
                uses afterwards, so the operator reads one sentence twice
                rather than learning two layouts. */}
            <p className="credit-forecast" id="credit-forecast" aria-live="polite">
              {forecast ? (
                <>
                  <span className="t-num">{money(knownBalance)}</span>
                  <ArrowRight size={12} aria-hidden="true" />
                  <strong className={`t-num ${signed < 0 ? 'text-danger' : 'text-success'}`}>
                    {money(forecast.next)}
                  </strong>
                  {forecast.clamped && (
                    <span className="credit-clamp-warn">
                      <AlertTriangle size={12} aria-hidden="true" />
                      only {money(Math.abs(forecast.applied))} can be taken — the balance stops at zero
                    </span>
                  )}
                </>
              ) : (
                <span className="credit-hint">
                  {hasAmount && knownBalance === null
                    ? 'The resulting balance is confirmed after applying.'
                    : 'A positive figure. Direction is set on the left.'}
                </span>
              )}
            </p>
          </div>

          {/* ── Why ─────────────────────────────────────────────────────── */}
          <div className="form-group credit-note">
            <label htmlFor="credit-note-input">Note</label>
            <textarea
              id="credit-note-input"
              className="glass-input"
              rows={2}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Goodwill for the delayed shipment on 7F3A2B10…"
            />
            {/* Not "optional": it is optional to the API and it is the only
                thing on the ledger row that will explain this movement to
                whoever reads it in six months. */}
            <p className="credit-hint">Written onto the ledger row. This is the only explanation it will carry.</p>
          </div>
        </div>

        <div className="admin-form-actions">
          <button
            type="submit"
            className={`glass-btn ${direction === 'deduct' ? 'glass-btn-danger' : 'glass-btn-primary'}`}
            disabled={submitting || blockedByFreeze || !hasAmount || !form.userId.trim() || account === null}
          >
            {submitting
              ? 'Applying…'
              : direction === 'deduct'
                ? `Deduct ${hasAmount ? money(magnitude) : 'credit'}`
                : `Credit ${hasAmount ? money(magnitude) : 'account'}`}
          </button>
          <button type="button" className="glass-btn" onClick={reset} disabled={submitting}>
            <X size={14} aria-hidden="true" /> Clear
          </button>
        </div>
      </form>

      {result && <CreditReceipt result={result} footerLinks={footerLinks} />}
    </section>
  );
}

/**
 * The movement, drawn.
 *
 * Every figure here comes from the server's response: `previous_balance`,
 * `balance`, `requested` and `applied`. The old confirmation read
 * `result.new_balance` — a field no version of this endpoint has ever sent —
 * then fell back to `result.balance`, so the line that reported the outcome of
 * a money mutation was one rename away from silently printing "updated".
 *
 * The bar is scaled to whichever of the two balances is larger, so the segment
 * that changed is drawn against the balance it changed, and a $5 movement on a
 * $500 balance correctly looks like almost nothing. It is a fill and a
 * position, never a glow: DESIGN §3 requires the state to survive
 * `--glow-strength: 0`, and the whole meaning of this drawing is which of two
 * lengths is longer.
 */
function CreditReceipt({ result, footerLinks }) {
  const previous = num(result.previous_balance);
  const next = num(result.balance);
  const applied = num(result.applied);
  const requested = num(result.requested);
  // The clamp. `applied` is what the balance actually moved by; the difference
  // is the part of the request the CHECK constraint refused.
  const clamped = Math.abs(applied - requested) > 0.005;
  const up = applied > 0;

  // A pure no-op still gets a receipt — the server writes a 0.00 ledger row for
  // a fully clamped deduction precisely so the attempt is not invisible, and a
  // panel that said nothing here would undo that.
  const scale = Math.max(previous, next, 0.01);
  const fromPct = (previous / scale) * 100;
  const toPct = (next / scale) * 100;

  return (
    <div className={`credit-receipt${up ? ' is-up' : ' is-down'}`} role="status">
      <div className="credit-receipt-bar" aria-hidden="true">
        {/* The part of the balance that did not move, then the part that did.
            Two elements rather than one animated width: the segment that
            changed has to be a different colour from the segment that did not,
            which a single bar cannot say. */}
        <span className="credit-bar-base" style={{ width: `${Math.min(fromPct, toPct)}%` }} />
        <span
          className="credit-bar-delta"
          style={{ width: `${Math.abs(toPct - fromPct)}%` }}
        />
      </div>

      <p className="credit-receipt-line">
        <span className="t-num credit-was">{money(previous)}</span>
        <ArrowRight size={13} aria-hidden="true" />
        <strong className="t-num credit-now">{money(next)}</strong>
        <span className={`credit-delta t-num ${up ? 'text-success' : 'text-danger'}`}>
          {up ? '+' : '−'}{money(Math.abs(applied))}
        </span>
      </p>

      {clamped && (
        <p className="credit-clamped">
          <AlertTriangle size={13} aria-hidden="true" />
          {money(Math.abs(requested))} was requested and {money(Math.abs(applied))} applied — a balance
          cannot go below zero. The ledger row records the clamp.
        </p>
      )}

      {/* §9: a confirmation ends pointing forward. */}
      <div className="empty-state-links credit-receipt-links">
        <Link to={`/admin/users?id=${result.userId}`} className="glass-btn glass-btn-sm">
          Open {result.username || `account #${result.userId}`}
        </Link>
        {footerLinks}
      </div>
    </div>
  );
}
