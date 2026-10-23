import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { api } from '../../utils/api';

/**
 * Accounts whose credit balance disagrees with their own ledger.
 *
 * ── Why this is a banner and not a tile ─────────────────────────────────────
 *
 * `services/creditReconcile.js` carries the argument for the check itself. What
 * belongs here is why it renders the way it does: **nothing at all, almost
 * always.**
 *
 * A permanent "0 accounts drift" stat would be a fourth tile beside three
 * figures an operator reads every day, and after a fortnight of zeroes it is a
 * tile nobody looks at — which is precisely the one they need to notice the
 * week it is not zero. `services/riskScan.js`'s header makes the same
 * observation about alerting on a condition rather than on a crossing: staff
 * mute the channel, and a muted channel is indistinguishable from one that was
 * never built.
 *
 * So its appearance IS the signal. Absent means the invariant holds.
 *
 * ── It says what not to do ──────────────────────────────────────────────────
 *
 * The obvious reaction to "these two numbers disagree" is to make them agree,
 * and there is deliberately no control here that does. A balance above its
 * ledger is credit the store cannot account for having given; one below it is
 * money a buyer was promised and cannot spend. Overwriting the balance erases
 * the evidence of the first and is the wrong answer to the second — if a spend
 * wrote the balance and its ledger row never landed, the LEDGER is the
 * incomplete record.
 *
 * The fix is an audited adjustment with a note, through the control that
 * already exists on the account. So the banner links there and says so.
 *
 * ── Failure is silence ──────────────────────────────────────────────────────
 *
 * A 403 (a viewer without the grant, on a page they reached some other way) or
 * a 500 renders nothing rather than an error. This is a background assurance,
 * not something the operator asked for; a red box saying the reconciliation
 * could not run would be noise on a page about something else.
 */
export default function CreditDrift() {
  const [drift, setDrift] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/admin/store-credit/reconciliation')
      .then((res) => { if (alive) setDrift(res); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const accounts = drift?.accounts || [];
  if (!accounts.length) return null;

  return (
    <section className="cdrift" data-reveal>
      <h2 className="cdrift-head">
        <AlertTriangle size={14} aria-hidden="true" />
        {accounts.length === 1
          ? 'One balance does not match its ledger'
          : `${accounts.length} balances do not match their ledgers`}
        {drift.truncated && <span className="cdrift-more">showing the largest</span>}
      </h2>

      <p className="cdrift-why">
        A balance is what checkout spends against; the ledger is every movement that
        produced it. When they differ, a write path recorded one and not the other.
        Correct it with an adjustment and a note on the account — never by overwriting
        the balance to match, which erases the evidence of what went wrong.
      </p>

      <ul className="cdrift-list">
        {accounts.map((a) => (
          <li key={a.user_id} className="cdrift-row">
            <Link to={`/admin/users?id=${a.user_id}`} className="cdrift-who">
              {a.username || `Account ${a.user_id}`}
            </Link>
            {/* Mono, and all three figures, because the pair is the point: a
                lone "out by $4" does not say which side to trust, and DESIGN §6
                asks numerals to line up so a column is readable at a glance. */}
            <span className="cdrift-figs">
              <span>balance <b>{a.balance}</b></span>
              <span>ledger <b>{a.ledger}</b></span>
              <span className="cdrift-gap">
                {Number(a.drift) > 0 ? '+' : ''}{a.drift}
              </span>
            </span>
            <span className="cdrift-moves">
              {a.movements} movement{a.movements === 1 ? '' : 's'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
