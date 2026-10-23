import { Check } from 'lucide-react';

/**
 * The spine shared by the cart and checkout pages.
 *
 * These were two unrelated screens: nothing told a buyer how much of the flow
 * was left, and the third step — actually sending funds — only announced
 * itself once the order already existed. Naming all three up front is the
 * whole point of the rail. Payment here happens off-site and by hand, so
 * someone deciding whether to start typing an address deserves to know that
 * before they type it, not after.
 */
const STEPS = [
  { key: 'cart', label: 'Cart', hint: 'Review items' },
  { key: 'details', label: 'Details', hint: 'Payment & shipping' },
  { key: 'payment', label: 'Payment', hint: 'Send funds' },
];

export default function CheckoutSteps({ current = 0 }) {
  return (
    <nav className="flow-rail" aria-label="Checkout progress">
      <ol className="flow-steps">
        {STEPS.map((step, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo';
          return (
            <li
              key={step.key}
              className={`flow-step is-${state}`}
              aria-current={state === 'current' ? 'step' : undefined}
            >
              <span className="flow-node" aria-hidden="true">
                {state === 'done'
                  ? <Check size={15} strokeWidth={3} />
                  : String(i + 1).padStart(2, '0')}
              </span>
              <span className="flow-text">
                <span className="flow-label">
                  {step.label}
                  {state === 'done' && <span className="sr-only"> — completed</span>}
                </span>
                <span className="flow-hint">{step.hint}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
