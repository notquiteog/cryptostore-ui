import { useEffect, useState } from 'react';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '../../utils/api';

/**
 * How many finished orders the retention window would actually clear.
 *
 * ── Why the control needed this ─────────────────────────────────────────────
 *
 * The window is a dropdown reading "90 days after the order finishes", and on
 * its own that asks an operator to authorise a deletion whose size they cannot
 * see. Ninety days is four orders on one store and eleven thousand on another,
 * and the difference is the whole of what somebody wants to know before saving.
 *
 * `previewStockAlerts` had this problem first and answered it the same way —
 * the Stock alerts card prints what the thresholds you have TYPED would alert
 * on, before they are saved. Same shape here: the figure follows the selected
 * value rather than the stored one, so it moves while the operator is still
 * deciding.
 *
 * ── It counts every field the sweep clears, not just the address ────────────
 *
 * `services/identityRetention.pendingCount` matches an order where ANY of the
 * shred columns is still set. An order whose address was already cleared by a
 * customer erasing their account can still carry a Zelle sender name, and
 * reporting zero for it would make this line disagree with what the next sweep
 * does — which is the one way a reassurance figure can be worse than none.
 *
 * ── Silence on failure, and why that is right here ──────────────────────────
 *
 * A viewer without `settings.security` gets a 403, and a store mid-migration
 * gets a 500. Both render nothing. The dropdown above still works and still
 * saves; this is a figure that helps a decision, not a precondition for making
 * one, and a red box about a failed count would be noise over a control that is
 * fine.
 */
export default function AddressRetentionNote({ days }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    let alive = true;
    const n = Number(days);
    // `0` is "keep forever" and the server answers it without touching the
    // table, so there is nothing to ask about — and asking anyway would print
    // "0 orders" under a control that is switched off, which reads as a fact
    // about the store rather than about the setting.
    if (!Number.isFinite(n) || n <= 0) { setState(null); return undefined; }
    api.get(`/settings/address-retention?days=${n}`)
      .then((r) => { if (alive) setState(r); })
      .catch(() => { if (alive) setState(null); });
    return () => { alive = false; };
  }, [days]);

  if (!state) return null;

  const { pending, days: window, last } = state;

  return (
    <div className="aret" role="status">
      <p className="aret-line">
        <Trash2 size={13} aria-hidden="true" />
        {pending === 0 ? (
          <span>
            Nothing to clear today — no order has been finished for {window} days and still
            holds a delivery address.
          </span>
        ) : (
          <span>
            <strong>{pending.toLocaleString()}</strong>{' '}
            {pending === 1 ? 'order has' : 'orders have'} been finished for more than {window} days
            and still {pending === 1 ? 'holds' : 'hold'} a delivery address. Saving this clears{' '}
            {pending === 1 ? 'it' : 'them'} on the next daily sweep.
          </span>
        )}
      </p>
      {last && (
        // Labelled as this instance's own count on purpose. The store may be
        // behind a load balancer, the sweep takes a lock so only one process
        // runs it, and whichever process answered this request is the one
        // reporting. Inventing a store-wide total would mean a table to keep it
        // in, for a line of reassurance.
        <p className="aret-last">
          <ShieldCheck size={12} aria-hidden="true" />
          Last sweep on this server cleared {last.cleared.toLocaleString()}{' '}
          {last.cleared === 1 ? 'order' : 'orders'}.
        </p>
      )}
    </div>
  );
}
