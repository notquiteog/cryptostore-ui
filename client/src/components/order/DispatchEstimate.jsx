import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Hourglass } from 'lucide-react';
import { api } from '../../utils/api';
import { fmtDayRange } from '../../utils/shipping';

// ─── "Usually dispatched within 1–2 days" ─────────────────────────────────────
//
// The store's own history (services/fulfilmentStats — medians and p90s over a
// window, suppressed when the sample is thin) read back to the buyer on their
// order page, for the leg that is still ahead of them. Absent, not invented,
// when the server has no basis: `basis: null` means "not enough history", and
// printing a number nobody can stand behind is worse than printing nothing.
//
// This used to be a private `EtaNote` inside pages/OrderDetail.jsx. It moved
// here because it acquired rules that belong in one place: which statuses are
// "before dispatch", and that a parcel the carrier has already dated beats the
// store's average. The checkout's summary line reads the same endpoint for the
// pre-order case (no order, no carrier) and can take this component when it
// is next touched.

/**
 * Every status between "the money is on its way" and "it has left". The
 * dispatch clock starts when the buyer has done their part, which on a manual
 * rail is `awaiting_confirmation` — staff confirming the cash is part of the
 * store's dispatch time, not the buyer's wait. `pending_payment` is not here:
 * an unpaid order has no clock.
 */
export const BEFORE_DISPATCH = ['awaiting_confirmation', 'paid', 'accepted'];

/**
 * Which leg the estimate describes for this order, or null for none.
 *
 * `shipped` is the transit leg only while no parcel on the order carries a
 * carrier-supplied ETA: once the carrier has named a day, the parcel card
 * prints it, and a store-wide average beside a carrier's date is two answers
 * to one question. Everything else — delivered, cancelled, refunded,
 * disputed, unpaid — has no leg ahead of the buyer, so nothing is shown.
 */
export function estimateLeg(order) {
  const status = order?.status;
  if (BEFORE_DISPATCH.includes(status)) return 'dispatch';
  if (status !== 'shipped') return null;
  const carrierDated = (order.tracking_numbers || [])
    .some((t) => t.tracking?.eta && !['delivered', 'returned'].includes(t.tracking.status));
  return carrierDated ? null : 'transit';
}

/** "within 1–3 days" / "within a day" — fmtDayRange already says "within" for the one-day case. */
const within = (r) => {
  const s = fmtDayRange(r);
  return s.startsWith('within') ? s : `within ${s}`;
};
/** "3–5 days after dispatch" / "within a day of dispatch". */
const afterDispatch = (r) => {
  const s = fmtDayRange(r);
  return s.startsWith('within') ? `${s} of dispatch` : `${s} after dispatch`;
};

export default function DispatchEstimate({ order }) {
  const [eta, setEta] = useState(null);
  const leg = estimateLeg(order);
  // The order's own carrier, once it has one, so the per-carrier figure is
  // used where the store has enough history on it.
  const carrier = order?.tracking_numbers?.find((t) => t.carrier)?.carrier || null;

  useEffect(() => {
    if (!leg) return undefined;
    let alive = true;
    api.get(`/orders/delivery-estimate${carrier ? `?carrier=${encodeURIComponent(carrier)}` : ''}`)
      .then((d) => { if (alive) setEta(d); })
      .catch(() => { /* an estimate is a courtesy; its absence is not an error */ });
    return () => { alive = false; };
  }, [leg, carrier]);

  if (!leg || !eta || !eta.basis) return null;
  const range = eta[leg];
  if (!range) return null;

  // Past the slow end of "usually": say so rather than keep promising. An
  // order still awaiting confirmation has no paid_at, so it is never "late".
  const since = leg === 'dispatch' ? order.paid_at : order.shipped_at;
  const elapsedDays = since ? (Date.now() - new Date(since).getTime()) / 86400000 : null;
  const late = elapsedDays != null && elapsedDays > range.hi;
  const basisNote = `The middle and slow end of the last ${range.n} ${leg === 'dispatch' ? 'paid' : 'shipped'} orders`
    + (eta.basis === 'carrier' ? ` on ${eta.carrier}` : ' here');

  return (
    <p className={`od-eta${late ? ' is-late' : ''}`} title={basisNote}>
      <Hourglass size={12} aria-hidden="true" />
      <span>
        {leg === 'dispatch'
          ? <>Usually dispatched <b>{within(range)}</b>{eta.transit && <>, arriving <b>{afterDispatch(eta.transit)}</b></>}.</>
          : <>Usually arrives <b>{afterDispatch(range)}</b>{eta.basis === 'carrier' ? ` on ${eta.carrier}` : ''}.</>}
        {late && <> This one is past that — if it has not turned up, <Link to="/support">ask the store</Link>.</>}
      </span>
    </p>
  );
}
