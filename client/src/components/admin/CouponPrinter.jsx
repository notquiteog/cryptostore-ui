import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Check, Copy, Printer, X } from 'lucide-react';
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion';
import CouponVoucher from './CouponVoucher';

/* How long the ticket takes to clear the slot. Mirrored by `--cpnp-feed` in
   the stylesheet, which is where the per-row stagger inside the ticket is
   timed from; changing one without the other lands rows on paper that is
   already out, or below the print head. */
const FEED_MS = 1000;

/* A beat after the paper stops, so the lamp does not flip to green on the
   same frame the mechanism halts. The last row inside the ticket is already
   down by then — see the `.cpnp.is-printing` stagger in global.css, which is
   timed to land its slowest row just as the feed ends. */
const SETTLE_MS = 160;

/**
 * The voucher that feeds out of the create panel once a coupon exists.
 *
 * This replaces the form in place rather than opening over it: the coupon is
 * already real by the time this mounts, so the panel that was asking for
 * values becomes the machine that hands back the thing they made. Nothing
 * here can fail, and nothing here is a confirmation step.
 *
 * Printing to actual paper is a separate act, on the button below the ticket —
 * the animation says the coupon exists, the button says put it on card stock.
 *
 * `coupon` is the stored row the create endpoint returned, not the form state,
 * so the ticket shows the values the database actually holds.
 */
export default function CouponPrinter({ coupon, onPrint, onDone }) {
  const reduced = usePrefersReducedMotion();
  const [printing, setPrinting] = useState(true);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (reduced) {
      setPrinting(false);
      return undefined;
    }
    const t = setTimeout(() => setPrinting(false), FEED_MS + SETTLE_MS);
    return () => clearTimeout(t);
  }, [reduced]);

  // The create panel sits above the fold on a short list but well below it
  // once there are a dozen tickets and the operator has scrolled down to find
  // the New coupon button. Bring the machine into view rather than running it
  // somewhere nobody is looking.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    // Deliberately mount-only: re-running on a preference change would yank
    // the page while someone is reading the ticket.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    <div ref={rootRef} className={`cpnp${printing ? ' is-printing' : ' is-done'}`} style={{ '--cpnp-feed': `${FEED_MS}ms` }}>
      {/* ── The machine ───────────────────────────────────────────────────
          A lipped slot rather than a plain heading: it is what makes the
          ticket below read as having come *out* of something. */}
      <div className="cpnp-slot" aria-hidden="true">
        <span className="cpnp-slot-face">
          <span className={`cpnp-led${printing ? ' is-busy' : ' is-ready'}`} />
          <span className="cpnp-slot-label">
            {printing ? 'Printing coupon' : `Coupon ${coupon.code} ready`}
          </span>
          <Printer size={13} className="cpnp-slot-icon" />
        </span>
        <span className="cpnp-mouth" />
      </div>

      <p className="sr-only" role="status">
        {printing
          ? `Coupon ${coupon.code} created. Printing the voucher.`
          : `Coupon ${coupon.code} created and ready.`}
      </p>

      <div className="cpnp-feed">
        <div className="cpnp-clip">
          <div className="cpnp-sheet">
            <CouponVoucher coupon={coupon} print />

            {/* Not on the ticket — under it. Everything above is the voucher
                itself; these are things to do with it. */}
            <div className="cpnp-actions">
              <button type="button" className="glass-btn glass-btn-sm" onClick={copy}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy code'}
              </button>
              <button type="button" className="glass-btn glass-btn-sm" onClick={() => onPrint(coupon)}>
                <Printer size={13} /> Print on paper
              </button>
              <button type="button" className="glass-btn glass-btn-sm glass-btn-primary" onClick={onDone}>
                <X size={13} /> Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
