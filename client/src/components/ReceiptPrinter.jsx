import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, PenLine, Printer } from 'lucide-react';
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion';
import { gradientStops } from '../utils/code128';

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/* How long the paper takes to clear the slot, and how far apart the printed
   lines land. Both are mirrored by `--rcpt-feed` / `--rcpt-stagger` in the
   stylesheet; changing one without the other desynchronises the line stagger
   from the feed and lines start appearing below the torn edge. */
const FEED_MS = 1500;
const STAGGER_MS = 55;

/**
 * The order id as a real Code 128 — one gradient paint, as before, but the
 * stops now come from the encoder in utils/code128 rather than from the
 * characters' code points. A scanner at the bench reads it back into the
 * same reference printed beneath it. Percent stops, `no-repeat`: a real code
 * must not tile.
 */
function barcodeBars(code) {
  try {
    const { stops } = gradientStops(code);
    return { '--rcpt-bars': stops };
  } catch {
    return { '--rcpt-bars': 'transparent 0% 100%' };
  }
}

const shortId = (uuid) => String(uuid || '').replace(/-/g, '').slice(0, 12).toUpperCase();

const stamp = (iso) => {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};

const shout = (s) => String(s || '').replace(/_/g, ' ').toUpperCase();

/**
 * The receipt that feeds out of the checkout panel once an order exists.
 *
 * The order is already real by the time this mounts — it is a record of what
 * happened, not a confirmation step, which is why nothing here can fail and
 * the only control is the one that carries on to payment. Payment is the part
 * that has not happened yet, so the sheet says what is owed rather than what
 * was charged, and the button is the only thing on it that is not paper.
 *
 * `receipt` is a snapshot taken at submit time, not live cart state: placing
 * the order empties the cart, and a receipt that recomputed itself from the
 * cart would blank out a second after printing.
 */
export default function ReceiptPrinter({ receipt, onPay }) {
  const reduced = usePrefersReducedMotion();
  const [printing, setPrinting] = useState(true);
  const rootRef = useRef(null);

  const bars = useMemo(() => barcodeBars(shortId(receipt.uuid)), [receipt.uuid]);

  // Lines are numbered in DOM order so each one's entrance delay tracks how
  // far down the sheet it sits — the stagger has to follow the paper, and the
  // rows above the items vary with which discounts the buyer actually used.
  const line = (() => {
    let n = 0;
    return () => ({ '--i': n++ });
  })();

  useEffect(() => {
    if (reduced) {
      setPrinting(false);
      return undefined;
    }
    const rows = 12 + receipt.items.length;
    const t = setTimeout(() => setPrinting(false), FEED_MS + rows * STAGGER_MS);
    return () => clearTimeout(t);
  }, [reduced, receipt.items.length]);

  // The panel this prints into is often below the fold on a tall checkout, and
  // on mobile it sits under the whole form. Bring it into view rather than
  // animating something nobody is looking at.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    // Deliberately mount-only: re-running on a preference change would yank
    // the page while someone is reading the sheet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const due = Number(receipt.total || 0);

  return (
    <div
      ref={rootRef}
      className={`rcpt${printing ? ' is-printing' : ' is-done'}`}
      style={{ '--rcpt-feed': `${FEED_MS}ms`, '--rcpt-stagger': `${STAGGER_MS}ms` }}
    >
      {/* ── The machine ───────────────────────────────────────────────────
          A lipped slot rather than a plain divider: it is what makes the sheet
          below read as having come *out* of something instead of unfolding. */}
      <div className="rcpt-slot" aria-hidden="true">
        <span className="rcpt-slot-face">
          <span className={`rcpt-led${printing ? ' is-busy' : ' is-ready'}`} />
          <span className="rcpt-slot-label">
            {printing ? 'Printing receipt' : 'Receipt ready'}
          </span>
          <Printer size={13} className="rcpt-slot-icon" />
        </span>
        <span className="rcpt-mouth" />
      </div>

      <p className="sr-only" role="status">
        {printing
          ? 'Order placed. Printing your receipt.'
          : `Order ${shortId(receipt.uuid)} placed. ${money(due)} due. Receipt ready.`}
      </p>

      <div className="rcpt-feed">
        <div className="rcpt-clip">
          <article className="rcpt-paper">
            <header className="rcpt-head" style={line()}>
              <p className="rcpt-store">{receipt.storeName}</p>
              <p className="rcpt-kicker">Order Receipt</p>
            </header>

            <dl className="rcpt-meta">
              <div className="rcpt-meta-row" style={line()}>
                <dt>Order</dt>
                <dd>{shortId(receipt.uuid)}</dd>
              </div>
              <div className="rcpt-meta-row" style={line()}>
                <dt>Date</dt>
                <dd>{stamp(receipt.createdAt)}</dd>
              </div>
              <div className="rcpt-meta-row" style={line()}>
                <dt>Method</dt>
                <dd>{receipt.paymentLabel}</dd>
              </div>
              <div className="rcpt-meta-row" style={line()}>
                <dt>Status</dt>
                <dd className="is-pending">{shout(receipt.status || 'pending payment')}</dd>
              </div>
            </dl>

            <ul className="rcpt-items">
              {receipt.items.map((item) => (
                <li key={item.id} className="rcpt-item" style={line()}>
                  <span className="rcpt-item-qty">{item.quantity}×</span>
                  <span className="rcpt-item-name">
                    {item.product_name}
                    {item.variant_name && <em>{item.variant_name}</em>}
                  </span>
                  <span className="rcpt-item-sum">
                    {money(Number(item.price) * item.quantity)}
                  </span>
                </li>
              ))}
            </ul>

            <dl className="rcpt-sums">
              <div className="rcpt-sum" style={line()}>
                <dt>Subtotal</dt>
                <dd>{money(receipt.subtotal)}</dd>
              </div>
              <div className="rcpt-sum" style={line()}>
                <dt>Shipping</dt>
                <dd>{receipt.shipping > 0 ? money(receipt.shipping) : 'FREE'}</dd>
              </div>
              {Math.abs(receipt.rail || 0) > 0.001 && (
                <div className={`rcpt-sum${receipt.rail < 0 ? ' is-off' : ''}`} style={line()}>
                  <dt>{receipt.rail < 0 ? 'Method discount' : 'Method fee'}</dt>
                  <dd>{receipt.rail < 0 ? '-' : '+'}{money(Math.abs(receipt.rail))}</dd>
                </div>
              )}
              {receipt.couponDiscount > 0 && (
                <div className="rcpt-sum is-off" style={line()}>
                  <dt>Coupon{receipt.couponCode ? ` ${receipt.couponCode.toUpperCase()}` : ''}</dt>
                  <dd>-{money(receipt.couponDiscount)}</dd>
                </div>
              )}
              {receipt.creditApplied > 0 && (
                <div className="rcpt-sum is-off" style={line()}>
                  <dt>Store credit</dt>
                  <dd>-{money(receipt.creditApplied)}</dd>
                </div>
              )}
            </dl>

            <div className="rcpt-due" style={line()}>
              <span className="rcpt-due-label">{due > 0 ? 'Total due' : 'Total'}</span>
              <span className="rcpt-due-value">{money(due)}</span>
            </div>

            {receipt.address && (
              <section className="rcpt-ship" style={line()}>
                <h3 className="rcpt-ship-title">Ship to</h3>
                <pre className="rcpt-ship-body">{receipt.address}</pre>
              </section>
            )}

            <div className="rcpt-code" style={line()}>
              <span className="rcpt-barcode" style={bars} aria-hidden="true" title={shortId(receipt.uuid)} />
              <span className="rcpt-code-text">{shortId(receipt.uuid)}</span>
            </div>

            {/* The one control on the sheet. Everything above is a record;
                this is the only thing still outstanding. */}
            <div className="rcpt-action" style={line()}>
              <button type="button" className="rcpt-pay" onClick={onPay}>
                <span className="rcpt-pay-glow" aria-hidden="true" />
                <span className="rcpt-pay-text">
                  {due > 0 ? <>Pay {money(due)}</> : <>View order</>}
                </span>
                <ArrowRight size={16} strokeWidth={2.5} aria-hidden="true" />
              </button>
              <p className="rcpt-foot">
                <Check size={11} strokeWidth={3} aria-hidden="true" />
                {due > 0
                  ? 'Payment details are on the next screen — nothing has been charged yet.'
                  : 'Covered in full. Open the order to follow its progress.'}
              </p>
              {/* The last line on the paper: where the signed copy lives. The
                  receipt page renders this order as text and hands it back
                  cleartext-signed by the store key, or says why it cannot.
                  A small link, not a second button — paying is the one thing
                  still outstanding, and this is a record to keep. */}
              <Link to={`/orders/${receipt.uuid}/receipt`} className="rcpt-signed">
                <PenLine size={10} aria-hidden="true" />
                signed version
              </Link>
            </div>
          </article>

          <span className="rcpt-tear" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
