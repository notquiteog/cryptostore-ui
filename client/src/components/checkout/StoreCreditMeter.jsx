import { useEffect, useRef, useState } from 'react';
import { Wallet } from 'lucide-react';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/* Long enough to see a figure fall, short enough that a buyer flicking the
   switch twice is not watching an animation finish. */
const COUNT_MS = 520;

/**
 * A number that travels to its new value instead of jumping to it.
 *
 * Deliberately not a CSS transition: the thing being animated is the digits,
 * not a box, and there is nothing to interpolate in a text node. rAF with an
 * explicit start value taken from the CURRENT displayed figure is what makes an
 * interrupted count carry on from where it visibly was rather than snapping
 * back to the last target first.
 */
function useCountTo(value, enabled) {
  const [shown, setShown] = useState(value);
  const raf = useRef(0);
  const from = useRef(value);

  useEffect(() => {
    if (!enabled) { setShown(value); return undefined; }
    cancelAnimationFrame(raf.current);
    const start = performance.now();
    const a = from.current;
    const b = value;
    if (Math.abs(a - b) < 0.005) { setShown(b); return undefined; }

    const step = (now) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      // Same shape as --ease-out, in JS because this is a value, not a style.
      const eased = 1 - Math.pow(1 - t, 3);
      const at = a + (b - a) * eased;
      from.current = at;
      setShown(at);
      if (t < 1) raf.current = requestAnimationFrame(step);
      else from.current = b;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value, enabled]);

  return shown;
}

/**
 * Store credit, drawn as the balance it actually is.
 *
 * DESIGN §10 names this one outright — "store credit that counts down as it is
 * spent at checkout" — and the job it does here is specific. The switch it
 * replaces said "$40.00 available on your account" and then, once flipped,
 * said exactly the same thing: not how much of it this order takes, not what
 * would be left, not whether it covers the whole thing. The one figure a buyer
 * wants before spending a balance is the figure that was missing.
 *
 * The meter is fill AND rule AND a printed number, not a glow, because an
 * operator can set `--glow-strength: 0` and the split has to survive it.
 *
 * `applied` is computed by Checkout against the same clamp `orderController`
 * uses — coupon first, credit only against what is left — so the drain here is
 * the money that will really move, not an optimistic preview of it.
 */
export default function StoreCreditMeter({ balance, applied, dueAfter, on, onToggle, disabled }) {
  const reduced = usePrefersReducedMotion();
  const spend = on ? Math.min(applied, balance) : 0;
  const left = Math.max(0, balance - spend);
  const shownLeft = useCountTo(left, !reduced);
  const pct = balance > 0 ? Math.max(0, Math.min(100, (left / balance) * 100)) : 0;
  // Two different outcomes that both look like "the credit ran out" if you only
  // watch the bar: the order is settled and nothing is owed, or the balance is
  // spent and money is still due. The buyer's next action differs completely.
  const settlesOrder = on && spend > 0 && dueAfter <= 0.005;
  const exhausted = on && spend > 0 && !settlesOrder && left <= 0.005;

  return (
    <div className={`ckcr-meter${on ? ' is-spending' : ''}`}>
      <div className="ckcr-row">
        <label className="switch" htmlFor="sc-toggle">
          <input
            id="sc-toggle"
            type="checkbox"
            checked={on}
            disabled={disabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="switch-track" />
        </label>
        <label htmlFor="sc-toggle" className="ckcr-text">
          <span className="ckcr-title">Spend store credit on this order</span>
          <span className="ckcr-hint">
            {on
              ? <>Taking {money(spend)} of {money(balance)}</>
              : <>{money(balance)} sitting on your account</>}
          </span>
        </label>
        <span className="ckcr-mark" aria-hidden="true"><Wallet size={15} /></span>
      </div>

      {/* The balance itself. The bar is what is LEFT, so switching the credit on
          drains it — the direction the money is going. */}
      {/* `.ckcr-bar-wrap` animates `grid-template-rows: 0fr → 1fr`, which only
          collapses its ONE explicit row — a second child lands in an implicit
          `auto` row and stays fully open, which is how the meter first shipped
          showing a full bar and "$45.00 left" for a balance nobody had touched.
          Hence the single inner element. */}
      <div className="ckcr-bar-wrap">
        <div className="ckcr-bar-inner">
          <div
            className="ckcr-bar"
            role="img"
            aria-label={
              on
                ? `${money(spend)} of ${money(balance)} store credit spent on this order, ${money(left)} left`
                : `${money(balance)} store credit, none spent on this order`
            }
          >
            <span className="ckcr-bar-fill" style={{ width: `${pct}%` }} />
            <span className="ckcr-bar-spent" style={{ width: `${100 - pct}%` }} />
          </div>
          <div className="ckcr-figures">
            <span className="ckcr-fig">
              <span className="ckcr-fig-label">Left after this order</span>
              <span className="ckcr-fig-value">{money(shownLeft)}</span>
            </span>
            {spend > 0 && (
              <span className="ckcr-fig is-spend">
                <span className="ckcr-fig-label">On this order</span>
                <span className="ckcr-fig-value">−{money(spend)}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {settlesOrder && (
        <p className="ckcr-covers is-settled">
          This covers the order in full. Nothing to send — it is paid the moment you place it.
        </p>
      )}
      {exhausted && (
        <p className="ckcr-covers">
          That is all of your credit. {money(dueAfter)} is still due by your chosen payment
          method.
        </p>
      )}
    </div>
  );
}
