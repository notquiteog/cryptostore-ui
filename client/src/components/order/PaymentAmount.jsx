import { Copy } from 'lucide-react';
// One presentation for the live invoice and theme specimens. The caller owns
// the server instruction; this component never recomputes money.
export default function PaymentAmount({ amount, ticker, label, onCopy }) {
  return <div className="payment-amount">
    <span className="od-copy-label">{label || 'Send exactly'}</span>
    <div className="od-pay-ask-row"><span className="od-pay-amount">{amount}</span><span className="od-pay-ticker">{ticker}</span>
      <button type="button" className="od-copy-btn" onClick={onCopy} aria-label="Copy payment amount"><Copy size={13} aria-hidden="true" /></button>
    </div>
  </div>;
}
