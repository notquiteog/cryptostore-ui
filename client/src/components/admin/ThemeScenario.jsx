import { useState } from 'react';
import CheckoutSteps from '../CheckoutSteps';
import FieldError from '../checkout/FieldError';
import PaymentAmount from '../order/PaymentAmount';
import { ParcelCard } from '../order/ParcelStatus';
import QtyInput from '../fulfilment/QtyInput';
import ProgressBar from '../ProgressBar';

// Actual shared controls with local fixture state. No live account, cart or
// payment endpoint is reachable from a theme preview.
export default function ThemeScenario({ scenario }) {
  const [picked, setPicked] = useState(2);
  const [copied, setCopied] = useState(false);
  return <section className="thm-workflow flow-stack" aria-label="Sample workflow">
    <span className="flow-eyebrow">Interactive sample · no order is placed</span>
    {scenario === 'payment' && <><CheckoutSteps current={2} /><PaymentAmount amount="0.0011" ticker="BTC" label="Send the remaining amount" onCopy={() => setCopied(true)} /><p className="flow-note">0.0041 of 0.0052 BTC received. {copied ? 'Sample copy action recorded.' : 'Payments to this address add together.'}</p><ProgressBar label="Payment received" value={79} /></>}
    {scenario === 'checkout' && <><CheckoutSteps current={1} /><label>Postal code<input className="glass-input" aria-invalid="true" placeholder="Enter postal code" /></label><FieldError message="Enter a postal code before placing your order." /><button type="button" className="glass-btn glass-btn-primary" disabled>Place order · $48.00</button></>}
    {scenario === 'stock' && <><h3>Everyday essentials · large pack</h3><span className="badge badge-danger">Unavailable</span><p className="flow-note">Choose an available size or remove this line to continue.</p><select className="glass-input" aria-label="Sample replacement"><option>2 × small pack · same total units</option><option>Remove this line</option></select><button type="button" className="glass-btn">Review replacement</button></>}
    {scenario === 'packing' && <><h3>Packing order · sample</h3><span className="badge badge-warning">Shortage · 3 units</span><QtyInput className="glass-input" value={picked} max={5} onCommit={setPicked} ariaLabel="Sample units picked" /><ProgressBar label="Units picked" value={picked * 20} /><p className="flow-review">Packing paused while the customer reviews a replacement.</p><button type="button" className="glass-btn glass-btn-primary" disabled>Dispatch paused</button></>}
    {scenario === 'orders' && <><h3>Orders needing attention</h3>{/* A compact responsive table compares aligned statuses and amounts; narrow screens retain labels. */}<table className="admin-rtable"><thead><tr><th>Order</th><th>Next action</th><th>Total</th></tr></thead><tbody>{[['A104','Confirm payment','$48.00'],['A105','Review shortage','$96.00'],['A106','Review parcel','$124.00']].map(([id, action, total]) => <tr key={id}><td data-label="Order">{id}</td><td data-label="Next action">{action}</td><td data-label="Total">{total}</td></tr>)}</tbody></table><ParcelCard tracking={{ tracked: true, status: 'exception', tone: 'danger', label: 'Needs attention', attention: true, summary: 'Delivery attempted. Review the carrier instructions.', events: [] }} /></>}
  </section>;
}
