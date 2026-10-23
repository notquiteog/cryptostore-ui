import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Ticket, Trash2, Printer, Copy, Check, Percent, DollarSign,
  CalendarClock, ShoppingCart, Users, AlertTriangle, Infinity as InfinityIcon, Power,
} from 'lucide-react';
import { gradientStops } from '../../utils/code128';

/**
 * The coupon code as a real Code 128, painted with the same one-gradient
 * trick as before so the vertical stub and the horizontal mobile stub keep
 * working by changing the angle in CSS — but the stops now come from
 * utils/code128 and a scanner reads them back as the code printed beside
 * them. Percent stops, `no-repeat`: a real code must not tile.
 *
 * A code the symbology cannot carry (anything outside printable ASCII) draws
 * no bars at all rather than wrong ones.
 */
function barcodeBars(code) {
  try {
    const { stops } = gradientStops(code);
    return { '--cpn-bars': stops };
  } catch {
    return { '--cpn-bars': 'transparent 0% 100%' };
  }
}

/**
 * What the ticket is worth right now, as one word.
 *
 * Order matters. A coupon that is switched off is "off" whatever its dates
 * say, and an expired one is expired whether or not it also ran out of uses —
 * showing the reason an admin can act on beats showing the first one found.
 *
 * "Scheduled" sits below both of those and above everything else, because a
 * code that has not started is `active` in the column and unredeemable in
 * fact: `couponRedeem` refuses it in both the preview and the claim. Showing
 * it as Active would make this word disagree with the only thing it is for —
 * whether a buyer typing the code right now gets a discount.
 */
export function couponState(c) {
  if (!c.active) return 'inactive';
  if (c.expires_at && new Date(c.expires_at).getTime() < Date.now()) return 'expired';
  if (c.starts_at && new Date(c.starts_at).getTime() > Date.now()) return 'scheduled';
  const used = Number(c.current_uses ?? c.uses_count ?? 0);
  const cap = c.max_uses == null ? null : Number(c.max_uses);
  if (cap != null && used >= cap) return 'exhausted';
  return 'active';
}

const STATE_LABEL = {
  active: 'Active',
  inactive: 'Switched off',
  expired: 'Expired',
  exhausted: 'Fully redeemed',
  scheduled: 'Starts later',
};

// The diagonal overprint, for the states where the ticket is not usable. A
// scheduled coupon gets one too: a voucher printed for Friday and handed out on
// Wednesday should say so on its face, which is the one place this component is
// read away from the console.
const STATE_STAMP = {
  inactive: 'Void',
  expired: 'Expired',
  exhausted: 'Redeemed',
  scheduled: 'Not yet',
};

export function money(v) {
  return `$${Number(v || 0).toFixed(2)}`;
}

export function shortDate(v) {
  return new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Whole days from now until `when`, negative once it has passed. */
function daysUntil(when) {
  return Math.ceil((new Date(when).getTime() - Date.now()) / 86400000);
}

/**
 * One coupon, drawn as the physical thing it represents.
 *
 * @param {object}  props
 * @param {object}  props.coupon
 * @param {boolean} [props.print]  Render the print variant: no controls, and
 *   the terms spelled out for someone holding the paper rather than for the
 *   admin who already knows what they configured.
 * @param {boolean} [props.tearing]  The delete has been accepted and the
 *   ticket is ripping in half. Purely a class flag — the animation, and the
 *   geometry that lets the two halves leave the ticket's box, live in CSS.
 */
export default function CouponVoucher({ coupon, print = false, tearing = false, onToggle, onDelete, onPrint }) {
  const [copied, setCopied] = useState(false);
  const state = couponState(coupon);
  const dead = state !== 'active';
  const bars = useMemo(() => barcodeBars(coupon.code), [coupon.code]);

  const used = Number(coupon.current_uses ?? coupon.uses_count ?? 0);
  const cap = coupon.max_uses == null ? null : Number(coupon.max_uses);
  const pct = cap ? Math.min(100, (used / cap) * 100) : 0;
  const minOrder = Number(coupon.min_order_amount || 0);
  const perUser = Number(coupon.uses_per_user || 1);
  const expiringSoon = coupon.expires_at && state === 'active' && daysUntil(coupon.expires_at) <= 7;

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
    <div className={`coupon-shell${tearing ? ' is-tearing' : ''}`}>
      <article
        className={[
          'coupon',
          coupon.type === 'flat' ? 'coupon-flat' : '',
          dead && !print ? 'coupon-dead' : '',
          tearing ? 'is-tearing' : '',
        ].filter(Boolean).join(' ')}
      >
        <div className="coupon-body">
          {dead && !print && (
            <span className={`coupon-stamp${state === 'exhausted' ? ' is-muted' : ''}`} aria-hidden="true">
              {STATE_STAMP[state]}
            </span>
          )}

          <div className="coupon-row">
            <span className="coupon-kind">
              {coupon.type === 'percent' ? <Percent size={11} /> : <DollarSign size={11} />}
              {coupon.type === 'percent' ? 'Percent off' : 'Amount off'}
            </span>
            {!print && <span className="coupon-state">{STATE_LABEL[state]}</span>}
          </div>

          <div className="coupon-amount">
            {coupon.type === 'percent' ? (
              <>
                <span className="coupon-amount-num">{Number(coupon.value)}</span>
                <span className="coupon-amount-unit">% off</span>
              </>
            ) : (
              <>
                <span className="coupon-amount-num">${Number(coupon.value).toFixed(2).replace(/\.00$/, '')}</span>
                <span className="coupon-amount-unit">off</span>
              </>
            )}
          </div>

          <div className="coupon-terms">
            <span className="coupon-term">
              <ShoppingCart size={12} aria-hidden="true" />
              {minOrder > 0 ? `${money(minOrder)} minimum` : 'No minimum'}
            </span>
            <span className="coupon-term">
              <Users size={12} aria-hidden="true" />
              {perUser === 1 ? 'One per customer' : `${perUser} per customer`}
            </span>
            <span className={`coupon-term${expiringSoon ? ' is-warn' : ''}`}>
              {expiringSoon ? <AlertTriangle size={12} aria-hidden="true" /> : <CalendarClock size={12} aria-hidden="true" />}
              {coupon.expires_at ? `Expires ${shortDate(coupon.expires_at)}` : 'No expiry'}
            </span>
            {!print && (
              <span className="coupon-term">
                {cap == null ? <InfinityIcon size={12} aria-hidden="true" /> : <Ticket size={12} aria-hidden="true" />}
                {cap == null ? `${used} redeemed` : `${used} of ${cap} redeemed`}
              </span>
            )}
          </div>

          {!print && cap != null && (
            <div
              className="coupon-meter"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={cap}
              aria-valuenow={used}
              aria-label={`${used} of ${cap} redemptions used`}
            >
              <div className={`coupon-meter-fill${pct >= 100 ? ' is-full' : ''}`} style={{ width: `${pct}%` }} />
            </div>
          )}

          <div className="coupon-code-row">
            <span className="coupon-code">{coupon.code}</span>
            {!print && (
              <button
                type="button"
                className="glass-btn glass-btn-sm coupon-copy"
                onClick={copy}
                aria-label={`Copy code ${coupon.code}`}
                title="Copy code"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            )}
          </div>
        </div>

        <div className="coupon-stub">
          <div className="coupon-barcode" style={bars} aria-hidden="true" />
          <div className="coupon-stub-code">{coupon.code}</div>
        </div>
      </article>

      {!print && (
        <div className="coupon-actions">
          <button className="glass-btn glass-btn-sm" onClick={() => onPrint(coupon)} disabled={tearing}>
            <Printer size={13} /> Print
          </button>
          <button className="glass-btn glass-btn-sm" onClick={() => onToggle(coupon)} disabled={tearing}>
            <Power size={13} /> {coupon.active ? 'Switch off' : 'Switch on'}
          </button>
          <button
            className="glass-btn glass-btn-sm glass-btn-danger"
            onClick={() => onDelete(coupon)}
            disabled={tearing}
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      )}
    </div>
  );
}
