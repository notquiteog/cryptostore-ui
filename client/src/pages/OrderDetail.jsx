import PaymentAmount from '../components/order/PaymentAmount';
import OrderQueueNav from '../components/order/OrderQueueNav';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../utils/api';
import { settleWindowMinutes, formatWindow } from '../utils/confirmationDepth';
import { useAuth } from '../context/AuthContext';
// Per-capability gating for the staff controls below. Gating on role alone
// drew every admin button for every manager, and the ones their grants could
// not complete were dead: a pick-only manager saw "Deny & Refund" and
// "Cancel Order" whose endpoints answer 403. The admin Orders page states the
// rule this page now follows: a button is only drawn when the account behind
// it could actually complete the request.
import { adminCapabilities } from '../utils/adminPermissions';

/** Mirrors the server's PICKABLE_STATUSES — what the bench may still work on. */
const PICKABLE_HERE = ['paid', 'accepted'];
/** What the Ship desk's own queue accepts. */
const SHIPPABLE_HERE = ['paid', 'accepted'];
import { playSound } from '../utils/sounds';
import toast from 'react-hot-toast';
import { QRCodeSVG } from 'qrcode.react';
import { useTheme } from '../context/ThemeContext';
import CustomerCard from '../components/order/CustomerCard';
import OrderItemsCard from '../components/order/OrderItemsCard';
import OrderBoxesCard from '../components/order/OrderBoxesCard';
import { ParcelCard } from '../components/order/ParcelStatus';
import EncryptedAddress from '../components/order/EncryptedAddress';
// The store wallet paying a refund out — the second door on the refund desk,
// beside the manual txid. Its own component because the quote-then-send
// contract with the server (409 on a moved rate, the unrecorded-send
// outcome) is a small state machine that does not belong inline in a page
// this size.
import WalletRefund from '../components/order/WalletRefund';
// "Usually dispatched within…", from the store's own history. Was a private
// `EtaNote` here; moved out with the rules it grew (which statuses are before
// dispatch, and that a carrier's own date beats the store's average).
import DispatchEstimate from '../components/order/DispatchEstimate';
import ArmoredText from '../components/pgp/ArmoredText';
import { hasMessageBlock } from '../utils/pgpBlocks';
// Imported from the list page rather than written again here. A reorder result
// is a contract with the server — statuses, skip reasons, whether a price moved
// — and two renderings of it diverge the first time one page is touched and the
// other is not. See the note above the definitions in Orders.jsx.
import { ReorderButton, ReorderSummary } from '../components/order/Reorder';
import {
  Copy, AlertTriangle, CheckCircle, Truck, Clock, CreditCard,
  Package, ShieldCheck, RefreshCw, ArrowRight, ExternalLink,
  Wallet, Send, XCircle, DollarSign, Trash2, MapPin, Pencil,
  FlaskConical, PackageCheck, ChevronLeft, Receipt, LifeBuoy,
  ListOrdered, Gavel, Store, Users, Landmark, Mail, Ban, ArrowLeftRight,
  MessageCircleQuestion, NotepadText,
} from 'lucide-react';
import { askAssistant } from '../utils/askAssistant';
import { ORDER_CHANGED } from '../utils/orderEvents';
import { useAiCapability } from '../hooks/useAiTool';

// ─── Constants ────────────────────────────────────────────────────────────────

const statusSteps = ['pending_payment', 'paid', 'accepted', 'shipped', 'delivered'];
// Statuses that leave the happy path entirely — the stepper has nothing
// meaningful to point at, so it is replaced rather than forced.
const TERMINAL_STATUSES = ['cancelled', 'refunded', 'disputed'];
const cashSteps   = ['awaiting_confirmation', 'paid', 'accepted', 'shipped', 'delivered'];
// Mirrors ADDRESS_EDITABLE_STATUSES in orderController: the buyer may correct
// their delivery address until staff accept the order and start preparing it.
// The server is the authority — this only decides whether to offer the button.
const ADDRESS_EDITABLE_STATUSES = ['pending_payment', 'awaiting_confirmation', 'paid'];
/** While the buyer may still walk away, on either rail. */
const BUYER_CANCELLABLE = ['pending_payment', 'awaiting_confirmation'];

// `at` names the column that records when this step happened, and three of the
// six have one. `accepted` deliberately does not: nothing writes an
// `accepted_at`, and deriving it from `updated_at` would print a timestamp
// that silently moves every time anybody edits the row — a date that lies
// quietly is worse than a blank.
const stepMeta = {
  pending_payment:      { icon: CreditCard,  label: 'Payment',   color: 'var(--primary)',   at: 'created_at' },
  awaiting_confirmation:{ icon: Clock,       label: 'Awaiting',  color: 'var(--warning)',   at: 'created_at' },
  paid:                 { icon: CheckCircle, label: 'Paid',      color: 'var(--success)',   at: 'paid_at' },
  accepted:             { icon: Package,     label: 'Accepted',  color: 'var(--info)',      at: null },
  shipped:              { icon: Truck,       label: 'Shipped',   color: 'var(--secondary)', at: 'shipped_at' },
  delivered:            { icon: ShieldCheck, label: 'Delivered', color: 'var(--success)',   at: 'delivered_at' },
};

const cryptoNames  = { btc: 'Bitcoin', xmr: 'Monero', ltc: 'Litecoin' };
// The one place on this page where a fixed colour is right: Bitcoin orange is
// not the operator's to theme, and a buyer scanning the page for the Monero
// panel is looking for that orange. Confined by 82-order-detail-panels.css to
// the panel's hairline, the coin chip and the QR bloom — nothing is ever set
// in type against them, so no contrast pair depends on a value the theme
// solver has never seen.
const cryptoColors = {
  btc: { from: '#f7931a', to: '#ff6b00' },
  xmr: { from: '#ff6600', to: '#cc4400' },
  ltc: { from: '#a0a0a0', to: '#345d9d' },
};

// Status label and the badge primitive that carries it. This was nine inline
// style objects composing their own rgba from the channel triples — the same
// arithmetic `.badge-*` in 06-glass-primitives.css already does, one copy of
// which had drifted (`accepted` mixed a `--secondary` background under
// `--info` text). Use the primitive.
const STATUS = {
  pending_payment:       { label: 'Awaiting payment',      badge: 'badge-primary' },
  awaiting_confirmation: { label: 'Awaiting confirmation', badge: 'badge-warning' },
  paid:                  { label: 'Paid',                  badge: 'badge-success' },
  accepted:              { label: 'Accepted',              badge: 'badge-info' },
  shipped:               { label: 'Shipped',               badge: 'badge-primary' },
  delivered:             { label: 'Delivered',             badge: 'badge-success' },
  disputed:              { label: 'Disputed',              badge: 'badge-danger' },
  cancelled:             { label: 'Cancelled',             badge: 'badge-muted' },
  refunded:              { label: 'Refunded',              badge: 'badge-warning' },
};

// ─── Small helpers ────────────────────────────────────────────────────────────

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
/** XMR carries twelve decimals; every other chain here carries eight. */
const coinPlaces = (type) => (type === 'xmr' ? 12 : 8);

/**
 * What the buyer is paying with, in words.
 *
 * The fact strip printed `order.payment_method` straight from the column, so a
 * Bitcoin order read "PAID BY btc" — the wrong noun, lower-cased, and in the
 * wrong tense on an order nobody has paid yet.
 */
const railName = (method, cryptoType) =>
  cryptoNames[cryptoType || method]
  || { cash_in_mail: 'Cash in the mail', zelle: 'Zelle', demo: 'Demo checkout' }[method]
  || String(method || '').replace(/_/g, ' ');

const fmtDay   = (v) => (v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
const fmtDate  = (v) => (v ? new Date(v).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
const fmtStamp = (v) => (v ? new Date(v).toLocaleString() : '');

/**
 * A hash, shortened in the middle rather than at the end.
 *
 * `text-overflow: ellipsis` keeps the head and throws the tail away, and the
 * tail is the half a person actually eyeballs against a block explorer — the
 * leading characters of two transactions to the same wallet are often
 * identical. Both ends survive; the whole value is on the title and one click
 * from the clipboard.
 */
function shortHash(h) {
  const s = String(h || '');
  return s.length > 22 ? `${s.slice(0, 10)}…${s.slice(-8)}` : s;
}

function copyValue(value, what = 'Copied') {
  if (!value) return;
  navigator.clipboard?.writeText(String(value))
    .then(() => toast.success(what))
    .catch(() => toast.error('Could not reach the clipboard'));
}

// ─── QR URI Builder ────────────────────────────────────────────────────────────

function buildCryptoUri(cryptoType, address, amount) {
  if (!address) return '';
  const amountStr = amount ? `?${cryptoType === 'xmr' ? 'tx_amount' : 'amount'}=${amount}` : '';
  const scheme = cryptoType === 'btc' ? 'bitcoin' : cryptoType === 'ltc' ? 'litecoin' : 'monero';
  return `${scheme}:${address}${amountStr}`;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.pending_payment;
  return <span className={`badge ${s.badge}`}>{s.label}</span>;
}

/** One fact on the header strip. Rendered nothing at all when it has no value. */
function Fact({ k, v, title, to, money: isMoney, muted }) {
  if (v == null || v === '') return null;
  const cls = ['od-fact-v', muted ? 'is-muted' : ''].filter(Boolean).join(' ');
  return (
    <div className={`od-fact${isMoney ? ' is-money' : ''}`}>
      <span className="od-fact-k">{k}</span>
      {to
        ? <Link className={cls} to={to} title={title}>{v}</Link>
        : <span className={cls} title={title}>{v}</span>}
    </div>
  );
}

/** A short strip of coloured advice. `tone` is warn / success / danger / quiet. */
/**
 * A coin amount at the coin's own precision, with trailing zeros gone.
 *
 * `0.00110000` and `0.0011` are the same number and do not look like it, and
 * this one is read by somebody about to type it into a wallet. Mirrors the
 * trimming `utils/paymentShortfall.shortfallSentence` does on the server so
 * the web page and the bots print an identical figure.
 */
function trimCoin(value, places = 8) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value ?? '');
  return String(Number(n.toFixed(places)));
}

function Note({ tone, icon: Icon = AlertTriangle, children }) {
  return (
    <div className={`od-note${tone ? ` is-${tone}` : ''}`}>
      <Icon size={14} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

/**
 * A value whose only purpose is being copied somewhere else.
 *
 * Every one of them on this page is long — a 95-character Monero subaddress, a
 * four-line postal address, a 64-character refund txid — so the box wraps and
 * the value is mono at every size. The button is hover-disclosed on a mouse
 * and permanent on touch; see the rules in 82-order-detail-panels.css for why
 * the space is reserved either way.
 */
function CopyField({ label, value, large, what }) {
  if (value == null || value === '') return null;
  return (
    <div className="od-copy">
      {label && <span className="od-copy-label">{label}</span>}
      <div className="od-copy-box">
        <code className={`od-copy-val${large ? ' is-lg' : ''}`}>{value}</code>
        <button
          type="button"
          className="od-copy-btn"
          onClick={() => copyValue(value, what || `${label || 'Value'} copied`)}
          title={`Copy ${label || 'value'}`}
          aria-label={`Copy ${label || 'value'}`}
        >
          <Copy size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/**
 * The buyer's notes. Plain text gets the copy field; a note that carries an
 * encrypted block — a buyer who pasted their sealed address here instead of,
 * or as well as, the address field — gets the block drawn as a block, with
 * the audited decrypt for staff who may read addresses. The notes column
 * is free text, so nothing stops a block landing in it, and a page that
 * printed forty lines of armor as a "note" hid the one thing on it worth
 * reading.
 */
function NotesField({ notes, orderRef }) {
  if (!hasMessageBlock(notes)) return <CopyField label="Notes from the buyer" value={notes} />;
  return (
    <div className="od-copy">
      <span className="od-copy-label">Notes from the buyer</span>
      <ArmoredText text={notes} className="od-notes-armored" context={`order ${String(orderRef).slice(0, 8)} notes`} />
    </div>
  );
}

/**
 * How much has arrived, and how much of it has settled — one track, not two.
 *
 * The two bars this replaces drew "total received" and "confirmed received" as
 * separate quantities stacked one above the other, which hid the only
 * relationship that matters between them: confirmed money *is* received money,
 * once enough blocks have landed on top of it that it can no longer be taken
 * back. It can never exceed it, and two bars racing each other implied it
 * could.
 *
 * So: one track whose full width is the amount owed. The pale fill is what has
 * arrived. The solid fill is the part that has settled, rising through the
 * pale one as confirmations land. Full means paid; short means short.
 */
function SettleTrack({ received, confirmed, required, ticker, reqConfs }) {
  const pct = (n) => (required > 0 ? `${Math.min(100, (n / required) * 100)}%` : '0%');
  const full = required > 0 && confirmed >= required;
  const anything = received > 0;
  // Money the network has seen and the store has not yet accepted: the gap
  // between the pale fill and the solid one. It is the most misunderstood
  // thing about a crypto checkout — "my wallet says sent, why is nothing
  // happening" — so it is named, counted, and drawn as still in motion.
  const unsettled = Math.max(0, received - confirmed);
  const settling = anything && unsettled > 1e-12;
  return (
    <>
      <div className="od-track-cap">
        <span>{anything ? `Settled of ${required} ${ticker}` : `Waiting for ${required} ${ticker}`}</span>
        <b className={full ? 'is-good' : anything ? 'is-warn' : 'is-idle'}>
          {confirmed} {ticker}
        </b>
      </div>
      <div className={`od-track${full ? ' is-full' : ''}${settling ? ' is-settling' : ''}`}>
        {/* The pale fill is what has ARRIVED. While part of it is still
            unconfirmed the fill carries a moving hatch — money in motion —
            and the hatch stops the moment the solid fill catches up. Under
            reduced motion the hatch stays, still: the distinction is carried
            by the pattern, not by the movement. */}
        <div className="od-track-fill od-track-recv" style={{ '--recv': pct(received) }} />
        <div className="od-track-fill od-track-conf" style={{ '--conf': pct(confirmed) }} />
      </div>
      {anything && !full && (
        <div className="od-track-cap is-under">
          <span>
            <span className="od-seen-key" aria-hidden="true" /> Seen by the network, not yet settled
            {' '}({reqConfs}+ block{reqConfs === 1 ? '' : 's'} needed)
          </span>
          <b className="od-seen">{unsettled.toFixed(Math.min(8, String(received).split('.')[1]?.length || 4))} {ticker}</b>
        </div>
      )}
    </>
  );
}

/**
 * Pay another way — or get a fresh quote on the same rail.
 *
 * Shown under the lead panel of an unpaid order. The rails offered are the
 * ones the store has on and this account may use (the same probe checkout
 * runs for pool capacity); the current rail is offered as "fresh quote" once
 * its window is near or past. Every press asks once, because a switch mints
 * a new address and, on a manual rail, takes a recipient out of the pool —
 * the server rate-limits it too (config/limits `requote`).
 *
 * The old quote is never lost: a payment that arrives late at the previous
 * address still settles the order — see services/paymentSwitch.
 */
function RailSwitcher({ order, payment, onSwitched }) {
  const { settings } = useTheme();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [avail, setAvail] = useState(null);
  const [busy, setBusy] = useState(null);
  const [review, setReview] = useState(null);
  const [reviewError, setReviewError] = useState(null);
  const current = order.payment_method;
  const total = Number(order.total || 0);

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    api.get(`/orders/payment-availability?total=${encodeURIComponent(total.toFixed(2))}`)
      .then((d) => { if (alive) setAvail(d); })
      .catch(() => { if (alive) setAvail({}); });
    return () => { alive = false; };
  }, [open, total]);

  const rails = [];
  if (settings.btc_enabled === 'true') rails.push({ value: 'btc', label: 'Bitcoin' });
  if (settings.xmr_enabled === 'true') rails.push({ value: 'xmr', label: 'Monero' });
  if (settings.ltc_enabled === 'true') rails.push({ value: 'ltc', label: 'Litecoin' });
  if (settings.cash_in_mail_enabled === 'true' && user?.cash_in_mail_enabled && avail?.cash_in_mail !== false) rails.push({ value: 'cash_in_mail', label: 'Cash in the mail' });
  if (settings.zelle_enabled === 'true' && user?.zelle_enabled && avail?.zelle !== false) rails.push({ value: 'zelle', label: 'Zelle' });
  if (avail?.demo === true) rails.push({ value: 'demo', label: avail.demo_label || 'Demo' });

  const expiresAt = payment?.expires_at ? new Date(payment.expires_at).getTime() : null;
  const msLeft = expiresAt ? expiresAt - Date.now() : null;
  const expired = msLeft != null && msLeft <= 0;
  const soon = msLeft != null && msLeft > 0 && msLeft < 60 * 60 * 1000;

  const go = async (method) => {
    setBusy(method); setReview(null); setReviewError(null);
    try {
      setReview(await api.post(`/orders/${order.uuid || order.id}/payment-method`, { payment_method: method, preview: true }));
    } catch (err) { setReviewError(err.message); }
    finally { setBusy(null); }
  };
  const confirmSwitch = async () => {
    if (!review || busy) return;
    setBusy(review.to); setReviewError(null);
    try {
      const res = await api.post(`/orders/${order.uuid || order.id}/payment-method`, { payment_method: review.to, fingerprint: review.fingerprint });
      playSound('tick'); toast.success(res.requoted ? 'Fresh quote issued' : 'Payment method changed');
      setReview(null); setOpen(false); onSwitched?.();
    } catch (err) { setReviewError(err.message); setReview(null); }
    finally { setBusy(null); }
  };

  const others = rails.filter((r) => r.value !== current);
  const isCrypto = ['btc', 'xmr', 'ltc'].includes(current);

  return (
    <div className={`od-rail${expired ? ' is-expired' : soon ? ' is-soon' : ''}`}>
      {reviewError && <p className="flow-error" role="alert">{reviewError}</p>}
      {review && <section className="flow-review" aria-label="Review payment change">
        <h3>Review payment change</h3>
        <p>{rails.find(r => r.value === review.to)?.label || review.to}: <strong>{money(review.old_total)} → {money(review.total)}</strong></p>
        <p>Payment adjustment: {money(review.old_rail_adjustment)} → {money(review.rail_adjustment)}. Existing store credit: {money(review.credit_applied)}.</p>
        <p>Confirm to issue a new address or recipient. Previous crypto addresses remain monitored for payments already sent.</p>
        <div className="flow-actions"><button type="button" className="glass-btn glass-btn-primary" disabled={!!busy} onClick={confirmSwitch}>{busy ? 'Updating…' : `Confirm ${money(review.total)} due`}</button><button type="button" className="glass-btn" disabled={!!busy} onClick={() => setReview(null)}>Keep current method</button></div>
      </section>}
      {isCrypto && expiresAt && (
        <p className="od-rail-window">
          <Clock size={12} aria-hidden="true" />
          {expired
            ? <>This quote's window has closed. <button type="button" className="od-rail-link" onClick={() => go(current)} disabled={busy != null}>Get a fresh quote</button> — the order is kept for you.</>
            : <>Quote good until {new Date(expiresAt).toLocaleString()}{soon && <> — <button type="button" className="od-rail-link" onClick={() => go(current)} disabled={busy != null}>refresh it now</button></>}.</>}
        </p>
      )}
      {(others.length > 0 || !open) && (
        <button type="button" className="od-rail-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <ArrowLeftRight size={12} aria-hidden="true" /> Pay another way
        </button>
      )}
      {open && (
        <div className="od-rail-list" role="group" aria-label="Other ways to pay">
          {avail === null && <span className="od-rail-hint">Checking which rails are open…</span>}
          {avail !== null && others.length === 0 && <span className="od-rail-hint">No other rail is open to this account right now.</span>}
          {others.map((r) => (
            <button key={r.value} type="button" className="od-rail-opt" onClick={() => go(r.value)} disabled={busy != null}>
              {busy === r.value ? 'Switching…' : r.label}
            </button>
          ))}
          {isCrypto && !expired && (
            <button type="button" className="od-rail-opt is-quiet" onClick={() => go(current)} disabled={busy != null} title="Same coin, today's rate, a new address">
              {busy === current ? 'Quoting…' : `Fresh ${cryptoNames[current]} quote`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * What the order is waiting on, and for how long.
 *
 * Sits ABOVE `DispatchEstimate` (components/order) and does a different job.
 * DispatchEstimate gives the EXPECTATION — "usually dispatched within 2-4
 * days" — and it renders nothing at all when the shop has no history to
 * compute one from, or when the status is not one of the two legs it knows
 * about. This gives the FACT, which the shop always has: this order has been
 * sitting in this state for four days.
 *
 * That fact is what "where is my order" tickets are actually asking for. The
 * stepper already dates the steps an order has reached; what it could never
 * say is how long it has been stuck on the current one, because a step with no
 * date looks identical whether it was reached an hour ago or last week.
 *
 * The uncomfortable case is the one that matters: "Accepted — waiting to be
 * packed and shipped, for 4 days" is a sentence a warehouse would rather not
 * print, and it is exactly the sentence that stops somebody opening a ticket
 * to ask whether anything has moved.
 *
 * `order.timeline` is computed server-side (utils/orderTimeline.js) so this
 * page and both bots tell one history of one order.
 */
/**
 * Whose move this order is, what is blocking it, and where to go.
 *
 * Pairs with the stepper rather than replacing it: the stepper says WHERE the
 * order is, the timeline says HOW LONG, and this says WHO and WHY. "Paid" or
 * "accepted" never explained why an order had not moved; this is the
 * sentence that does, and it is the server's own (utils/orderNextAction.js),
 * so the order list, the home page, the admin queue, both bots and the
 * assistant all say the same thing about the same order.
 *
 * Only the viewer's own move is lit (DESIGN §3). A wait on the store, the
 * network or the carrier is a fact, not a call to action. The link is an
 * in-page anchor when the action lives on this page — the payment panel, the
 * items, the parcels — and a page elsewhere when it does not.
 */
function NowStrip({ action, timeline, order, param }) {
  if (!action) return null;
  const pending = timeline?.pending;
  const yours = action.actor === 'viewer';
  const [path, hash] = String(action.href || '').split('#');
  const here = [`/orders/${order?.uuid}`, `/orders/${order?.id}`, `/orders/${param}`];
  const samePage = !path || here.includes(path);
  return (
    <div className={`od-now${yours ? ' is-yours' : ''}${action.actor === 'none' ? ' is-none' : ''}`} role="status">
      <span className="od-now-who">
        <Clock size={11} aria-hidden="true" /> {yours ? 'Your move' : action.responsibility}
      </span>
      <span className="od-now-label">{action.label}</span>
      <span className="od-now-reason">{action.reason}</span>
      {pending?.elapsed && pending.elapsed !== 'just now' && (
        <span className="od-now-since">for <b>{pending.elapsed}</b></span>
      )}
      {action.actor !== 'none' && (samePage
        ? (hash ? <a className="od-now-go" href={`#${hash}`}>Go there <ArrowRight size={12} aria-hidden="true" /></a> : null)
        : <Link className="od-now-go" to={action.href}>Go there <ArrowRight size={12} aria-hidden="true" /></Link>)}
    </div>
  );
}

function WaitingNote({ order }) {
  const pending = order?.timeline?.pending;
  if (!pending) return null;
  return (
    <p className="od-waiting">
      <Clock size={12} aria-hidden="true" />
      <span>
        {pending.label}
        {pending.elapsed ? <> — for <b>{pending.elapsed}</b></> : null}
      </span>
    </p>
  );
}

/**
 * The blocks that have landed on top of this payment.
 *
 * Replaces a `ConfirmationDots` component that was written, styled and never
 * rendered — it sat in this file unreferenced, so the confirmation depth the
 * poll was fetching every fifteen seconds appeared nowhere on the page except
 * as a number inside each transaction row.
 *
 * Twelve rungs at most. An operator who requires sixty confirmations does not
 * need sixty rungs on screen; the count beside the ladder is the precise
 * statement and the ladder is the glance.
 */
/**
 * The payments seen against this order's address.
 *
 * DESIGN §6, answered: purpose-built line items, not `.admin-rtable` and not a
 * card/list toggle. Three facts of wildly different shapes — a 12-decimal
 * amount, a confirmation count and a 64-character hash — is not a table, and
 * the list is one to five rows long, which is not a surface anybody wants a
 * view switcher on. It lays out against its panel with a container query so
 * the hash sits inline when there is room and drops to its own line when
 * there is not.
 */
/**
 * Every payment the chain has shown for this order, each with its own depth.
 *
 * The track above says how much has arrived and how much has settled. This
 * list says WHICH transactions that is — one row per transaction, from the
 * moment it reaches the mempool at zero confirmations, because "my wallet
 * says sent and nothing here has changed" is the most common question a
 * crypto checkout gets, and the answer is a row that appears the instant the
 * network has the money.
 *
 * Each row carries the same three facts about its own coins that the track
 * carries about all of them: how much (in the coin and at the order's rate),
 * how deep (blocks landed of blocks required, as a bar and as words), and
 * how long (the usual wait for the blocks still to come, from the chain's
 * mean block time). The bar at zero blocks carries the same drifting hatch
 * as the track's unsettled fill — money in motion — and goes solid the block
 * it settles, so a buyer watching two payments can see which one the store
 * is still waiting on.
 *
 * Two payments split the depth question in two, and this list is where the
 * buyer sees which coin the order is still waiting on — the order settles when
 * its last coin does. There used to be a "Blocks on top" pile above the list
 * reporting the shallowest of them; it was removed as visual noise, and the
 * per-row bar below carries the same fact where it belongs, beside the payment
 * it describes.
 *
 * Rows are keyed by hash so a transaction that appears mid-watch slides in
 * once and the rows already on screen stay put; the bar's width tweens as
 * blocks land (a layout property, tolerated for the reason the track gives).
 * Under reduced motion nothing slides and the hatch stands still.
 */
function agoText(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function PaymentLedger({ transactions, cryptoType, requiredConfirmations, payment, requiredAmount }) {
  const ticker = String(cryptoType || '').toUpperCase();
  const places = coinPlaces(cryptoType);
  const req = Math.max(1, Number(requiredConfirmations) || 1);
  const rate = payment && Number(payment.amount_crypto) > 0 && payment.amount_usd != null
    ? Number(payment.amount_usd) / Number(payment.amount_crypto)
    : null;
  const owed = Number(requiredAmount) || 0;
  const many = (transactions || []).length > 1;

  return (
    <div className="od-txs">
      <h4 className="od-txs-head">
        Payments seen
        {transactions?.length > 0 && <span className="od-txs-count">{transactions.length}</span>}
      </h4>

      {(!transactions || transactions.length === 0) && (
        <p className="od-txs-empty">
          <span className="od-txs-empty-dot" aria-hidden="true" />
          Nothing yet. A payment shows here the moment the network sees it — before any block —
          and each one gets its own line, so a second payment to the same address is never a mystery.
        </p>
      )}

      {transactions?.length > 0 && (
        <ul className="od-tx-list">
          {transactions.map((tx, i) => {
            const confs = Math.max(0, Number(tx.confirmations) || 0);
            const settled = confs >= req;
            const mempool = confs === 0;
            const p = Math.min(1, confs / req);
            const amount = parseFloat(tx.amount) || 0;
            const remaining = Math.max(0, req - confs);
            const eta = settled ? null : formatWindow(settleWindowMinutes(cryptoType, remaining));
            const first = formatWindow(settleWindowMinutes(cryptoType, 1));
            const share = owed > 0 ? amount / owed : null;
            const cls = ['od-tx', settled ? 'is-settled' : mempool ? 'is-mempool' : 'is-settling'].join(' ');
            const state = settled
              ? 'Settled'
              : mempool ? 'In the mempool' : `${confs} of ${req} block${req === 1 ? '' : 's'}`;
            return (
              <li key={tx.tx_hash || i} className={cls} style={{ '--p': p, '--i': Math.min(i, 8) }}>
                {/* The ring is the row's depth at a glance; the number inside
                    it is the same fact, for anyone who cannot see the ring. */}
                <span className="od-tx-ring" aria-hidden="true">
                  <span className="od-tx-ring-in">
                    {settled ? <CheckCircle size={14} /> : mempool ? <Clock size={13} /> : <b>{confs}</b>}
                  </span>
                </span>

                <div className="od-tx-body">
                  <div className="od-tx-top">
                    <span className="od-tx-amt">
                      {amount.toFixed(places)} <small>{ticker}</small>
                    </span>
                    <span className="od-tx-state">{state}</span>
                  </div>

                  <div className="od-tx-facts">
                    {rate != null && <span title="At the rate this order was priced at">≈ {money(amount * rate)}</span>}
                    {share != null && (many || Math.abs(share - 1) > 0.0005) && (
                      <span title="This payment's share of the amount owed">
                        {share >= 0.9995 ? 'the full amount' : `${Math.round(share * 100)}% of the amount owed`}
                      </span>
                    )}
                    <span title={fmtStamp(tx.first_seen_at)}>
                      seen {new Date(tx.first_seen_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {agoText(tx.first_seen_at)}
                    </span>
                  </div>

                  {/* Blocks landed of blocks required. Segmented when the
                      depth is small enough to count; continuous past that. */}
                  <div
                    className={`od-tx-bar${req <= 24 ? ' is-segmented' : ''}`}
                    style={{ '--segs': req }}
                    role="progressbar"
                    aria-valuenow={Math.min(confs, req)}
                    aria-valuemin={0}
                    aria-valuemax={req}
                    aria-label={`${Math.min(confs, req)} of ${req} confirmations`}
                  >
                    <div className="od-tx-bar-fill" />
                  </div>

                  <div className="od-tx-meta">
                    <span className="od-tx-eta">
                      {settled
                        ? `Settled after ${req} block${req === 1 ? '' : 's'}`
                        : mempool
                          ? `Waiting for the first block${first ? ` — usually ${first}` : ''}; ${req} needed`
                          : `${remaining} more block${remaining === 1 ? '' : 's'}${eta ? ` — about ${eta}` : ''}`}
                    </span>
                    <button
                      type="button"
                      className="od-tx-hash"
                      title={tx.tx_hash}
                      onClick={() => copyValue(tx.tx_hash, 'Transaction id copied')}
                    >
                      {shortHash(tx.tx_hash)}
                      <Copy size={10} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The QR code, enlarged.
 *
 * A real dialog rather than a fixed div: it takes focus when it opens, hands
 * focus back to whatever opened it when it closes, answers Escape, and sits at
 * `--z-modal` instead of the `z-index: 1000` literal it used to carry. The
 * plate stays white in both modes on purpose — see the note on `.od-qr-plate`.
 */
function QrLightbox({ uri, address, onClose }) {
  const plateRef = useRef(null);
  useEffect(() => {
    const opener = document.activeElement;
    plateRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  return (
    <div className="od-qr-veil" onClick={onClose}>
      <div
        ref={plateRef}
        className="od-qr-plate"
        role="dialog"
        aria-modal="true"
        aria-label="Payment address QR code"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <QRCodeSVG value={uri || address || ''} size={260} level="M" includeMargin />
        <div className="od-qr-addr">{address}</div>
        <div className="od-qr-hint">Press Escape, or click outside, to close</div>
      </div>
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────

export default function OrderDetail({ orderRef, embedded = false }) {
  const params = useParams();
  const id = orderRef || params.id;
  return <OrderDetailContent key={id} id={id} embedded={embedded} />;
}

function OrderDetailContent({ id, embedded }) {
  const { user } = useAuth();
  const { settings } = useTheme();
  const [order, setOrder]           = useState(null);
  const [notFound, setNotFound]     = useState(false);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft]     = useState('');
  const [notesDraft, setNotesDraft]         = useState('');
  const [savingAddress, setSavingAddress]   = useState(false);
  const [loading, setLoading]       = useState(true);
  const [checking, setChecking]     = useState(false);
  const [checkError, setCheckError] = useState(null);
  const checkInFlight = useRef(false);
  const activeOrderRef = useRef(id);
  activeOrderRef.current = id;
  const [disputeReason, setDisputeReason] = useState('');
  const [showDispute, setShowDispute] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [cashMailTracking, setCashMailTracking] = useState('');
  const [updatingTracking, setUpdatingTracking] = useState(false);
  const [newTrackingNumber, setNewTrackingNumber] = useState('');
  const [newTrackingCarrier, setNewTrackingCarrier] = useState('');
  const [addingTracking, setAddingTracking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [refundAddress, setRefundAddress] = useState('');
  const [claimingRefund, setClaimingRefund] = useState(false);
  const [refundTxid, setRefundTxid] = useState('');
  const [senderName, setSenderName] = useState('');
  const [sendingRefund, setSendingRefund] = useState(false);
  const [reorderResult, setReorderResult] = useState(null);
  const [zelleSentBusy, setZelleSentBusy] = useState(false);

  /**
   * Which irreversible action is currently being asked about, if any.
   *
   * One piece of state rather than a boolean per control, so two confirms can
   * never be open at once — and so cancelling one is a single assignment
   * rather than a list of resets somebody will eventually forget to extend.
   * Values: 'pay' | 'cancel' | 'deny' | 'refund'.
   */
  const [ask, setAsk] = useState(null);
  const [refundDraft, setRefundDraft] = useState('');

  const pollingRef = useRef(null);
  const paymentStatusRef = useRef(null);
  useEffect(() => {
    const previous = paymentStatusRef.current;
    // The `previous && order &&` is load-bearing, not defensive padding.
    // Written as `previous?.id === order?.id` it compared undefined to
    // undefined on the very first render — when the ref is still empty and the
    // order has not arrived — which is *true*, so the guard fell through to
    // `previous.status` and threw on null. React unmounted the tree and every
    // order page rendered blank, on a line whose optional chaining made it look
    // fully guarded. Optional chaining protects the property read; it does not
    // stop two absent values from comparing equal.
    if (previous && order && previous.id === order.id
      && ['pending_payment', 'awaiting_confirmation'].includes(previous.status)
      && ['paid', 'accepted'].includes(order.status) && order.user_id === user?.id) {
      window.dispatchEvent(new CustomEvent('cs:purchase', { detail: { id: order.id } }));
    }
    paymentStatusRef.current = order ? { id: order.id, status: order.status } : null;
  }, [order?.id, order?.status, order?.user_id, user?.id]);
  /** Whether this page has ever held a real order — see fetchOrder's catch. */
  const loadedOnce = useRef(false);
  const isAdmin = user && ['admin', 'manager'].includes(user.role);
  // Undefined while the status loads, so the button does not flicker in after
  // the row has settled — useAiCapability's three-state rule.
  const assistantOffered = useAiCapability('assistant') === true;
  // The staff half of the assistant is the operator's own switch; without it
  // the model has no order tools and the buttons below would ask a question
  // it cannot answer.
  const consoleOffered = useAiCapability('console') === true;
  const can = useMemo(() => adminCapabilities(user), [user]);
  // Staff on their own order act as a customer, not as staff — the server
  // routes them onto the customer transition table (or the confirm-own-order
  // one), so the staff buttons below would 400/403. Withheld with a note, the
  // same treatment the admin Orders page gives its cards.
  const isOwnOrder = user?.id != null && order?.user_id != null && order.user_id === user.id;

  // Columns are named `_encrypted` but hold plaintext; the names are the
  // schema's, not a description of the contents.
  const shippingAddress = order?.shipping_address_encrypted || '';
  const orderNotes = order?.order_notes_encrypted || '';
  const shippingHidden = Array.isArray(order?.redacted_fields)
    && order.redacted_fields.includes('shipping_address_encrypted');

  // Whether the address is a PGP block, and whether this viewer may open it.
  // Decided by the server and sent as its own object rather than sniffed from
  // the text — a heuristic here is exactly how a field ends up wrongly labelled
  // as encrypted (or, worse, wrongly labelled as readable).
  const addressState = order?.address_state || { encryption: null, recipients: [], can_decrypt: false };

  // Which staff controls this viewer could actually complete, given the
  // order's state, their grants, and whose order it is. Drives the buttons AND
  // whether the desk renders at all — an empty panel reads as a bug, and a
  // dead button that 403s reads as a worse one.
  const staffActions = {
    confirm: !isOwnOrder && order?.status === 'awaiting_confirmation' && can.confirmPayment,
    accept: !isOwnOrder && order?.status === 'paid' && can.updateOrderStatus,
    denyRefund: !isOwnOrder && order?.status === 'paid' && can.refundOrder,
    ship: !isOwnOrder && order?.status === 'accepted' && can.updateOrderStatus,
    closeDelivered: !isOwnOrder && order?.status === 'disputed' && can.updateOrderStatus,
    offerRefund: !isOwnOrder && order?.status === 'disputed' && can.refundOrder,
    cancel: !isOwnOrder && can.cancelOrder
      && !['cancelled', 'refunded', 'delivered', 'shipped', 'disputed'].includes(order?.status),
    refundDesk: order?.status === 'refunded' && can.refundOrder,
    // Staff on their own order get the reason instead of buttons that 400.
    ownOrderNote: isOwnOrder && isAdmin
      && ['awaiting_confirmation', 'paid', 'accepted', 'disputed'].includes(order?.status),
    // Routes into the two fulfilment screens, offered only while this order is
    // actually AT that stage. A "Pack this" button on a delivered order is a
    // link to a bench that will refuse it, and a dispatch link on an unpaid one
    // is the same lie in the other direction — the whole reason this object
    // exists is that a dead button reads worse than an absent one.
    packHere: !isOwnOrder && can.pickOrders && PICKABLE_HERE.includes(order?.status),
    shipDesk: !isOwnOrder && (can.updateOrderStatus || can.manageTracking)
      && SHIPPABLE_HERE.includes(order?.status),
  };
  const staffPanelVisible = Object.values(staffActions).some(Boolean);

  /* ── The shop's own note on this order ──
   *
   * Its own panel rather than a field in the Order desk below, because that
   * panel only renders when the viewer has an action to take on this status —
   * and the desk that most needs to write a note is support, which holds no
   * fulfilment grant at all and would therefore never see it.
   *
   * Draft kept apart from `order.staff_note` so a colleague's edit arriving on
   * the next poll cannot overwrite half a sentence somebody is typing. `null`
   * means "not editing"; the server answers with the stored value and that is
   * what goes back into the order.
   */
  const [noteDraft, setNoteDraft] = useState(null);
  const [savingNote, setSavingNote] = useState(false);
  const ORDER_NOTE_MAX = 500;

  const saveStaffNote = async () => {
    if (noteDraft === null) return;
    setSavingNote(true);
    try {
      const saved = await api.put(`/orders/${id}/staff-note`, { staff_note: noteDraft });
      setOrder((o) => (o ? { ...o, ...saved } : o));
      setNoteDraft(null);
      toast.success(saved.staff_note ? 'Note saved' : 'Note cleared');
    } catch (err) {
      toast.error(err.message || 'Could not save the note');
    } finally {
      setSavingNote(false);
    }
  };

  const fetchOrder = useCallback(() => {
    return api.get(`/orders/${id}`)
      .then(data => {
        loadedOnce.current = true;
        setOrder(data);
        setNotFound(false);
        if (data.cash_mail_tracking) setCashMailTracking(data.cash_mail_tracking);
      })
      .catch(() => {
        // Only the FIRST fetch may declare the order missing. A refetch after a
        // status change that happens to fail — a dropped connection, a token
        // that expired mid-shift — must not replace an order the operator was
        // reading a second ago with "no order with that reference".
        //
        // A ref, not a read of `order` inside a setState updater: an updater
        // has to be pure, and StrictMode runs it twice in development, so a
        // `setNotFound` called from inside one fires twice and would be a
        // genuine bug the day somebody adds a counter to it.
        if (!loadedOnce.current) setNotFound(true);
        toast.error('Could not load this order');
      })
      .finally(() => setLoading(false));
  }, [id]);

  // The order on this page moved from somewhere that is not this page — a
  // button on an assistant card in the navbar panel (utils/orderEvents.js).
  // Only THIS order, or an event that did not say which: refetching a page
  // because a different order was accepted would be a spinner for nothing.
  useEffect(() => {
    const onChanged = (e) => {
      const which = e?.detail?.order;
      if (which && order?.uuid && which !== order.uuid) return;
      fetchOrder();
    };
    window.addEventListener(ORDER_CHANGED, onChanged);
    return () => window.removeEventListener(ORDER_CHANGED, onChanged);
  }, [fetchOrder, order?.uuid]);

  const triggerCheck = useCallback(async () => {
    if (checkInFlight.current) return;
    checkInFlight.current = true;
    setChecking(true);
    try {
      const result = await api.post(`/orders/${id}/check-payment`, {});
      if (activeOrderRef.current !== id) return;
      setOrder(result);
      setCheckError(null);
      if (result.status && result.status !== 'pending_payment') playSound('success');
    } catch {
      if (activeOrderRef.current !== id) return;
      setCheckError('Could not check payment. The amounts below are the last known state; do not send again just because this check failed.');
    } finally {
      checkInFlight.current = false;
      setChecking(false);
    }
  }, [id]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  // Poll every 15 s while pending payment
  useEffect(() => {
    if (!order) return;
    if (order.status !== 'pending_payment') {
      if (pollingRef.current) clearInterval(pollingRef.current);
      return;
    }
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => triggerCheck(), 15000);
    return () => clearInterval(pollingRef.current);
  }, [order?.status]);

  const markDelivered = async () => {
    try {
      await api.put(`/orders/${id}/status`, { status: 'delivered' });
      toast.success('Marked as delivered');
      fetchOrder();
    } catch (err) { toast.error(err.message); }
  };

  const markZelleSent = async () => {
    if (zelleSentBusy) return;
    setZelleSentBusy(true);
    try {
      const result = await api.post(`/orders/${id}/zelle-sent`, {});
      toast.success(result.message || 'Recorded');
      fetchOrder();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setZelleSentBusy(false);
    }
  };

  const submitDispute = async () => {
    if (!disputeReason.trim()) return toast.error('Please describe what went wrong');
    try {
      await api.post(`/orders/${id}/dispute`, { reason: disputeReason });
      toast.success('Dispute submitted');
      setShowDispute(false);
      fetchOrder();
    } catch (err) { toast.error(err.message); }
  };

  const cancelOrder = async () => {
    setCancelling(true);
    try {
      await api.post(`/orders/${id}/cancel`, {});
      toast.success('Order cancelled');
      setAsk(null);
      fetchOrder();
    } catch (err) { toast.error(err.message); }
    setCancelling(false);
  };

  const claimRefund = async () => {
    if (!refundAddress.trim()) return toast.error('Enter your crypto address');
    setClaimingRefund(true);
    try {
      await api.post(`/orders/${id}/claim-refund`, { refund_address: refundAddress });
      toast.success('Refund address submitted');
      fetchOrder();
    } catch (err) { toast.error(err.message); }
    setClaimingRefund(false);
  };

  const markRefundSent = async () => {
    if (!refundTxid.trim()) return toast.error('Enter the transaction ID');
    setSendingRefund(true);
    try {
      await api.post(`/orders/${id}/mark-refund-sent`, { refund_txid: refundTxid });
      toast.success('Refund marked as sent');
      fetchOrder();
    } catch (err) { toast.error(err.message); }
    setSendingRefund(false);
  };

  const adminUpdateStatus = async (newStatus, extra = {}) => {
    try {
      await api.put(`/orders/${id}/status`, { status: newStatus, ...extra });
      toast.success(`Order updated to ${newStatus.replace(/_/g, ' ')}`);
      setAsk(null);
      fetchOrder();
    } catch (err) { toast.error(err.message); }
  };

  const updateCashMailTracking = async () => {
    if (!cashMailTracking.trim()) return toast.error('Enter a tracking number');
    setUpdatingTracking(true);
    try {
      await api.put(`/orders/${id}/cash-mail-tracking`, { tracking: cashMailTracking });
      toast.success('Tracking updated');
      fetchOrder();
    } catch (err) { toast.error(err.message); }
    setUpdatingTracking(false);
  };

  const saveShippingDetails = async () => {
    const next = addressDraft.trim();
    if (!next) return toast.error('Enter a shipping address');
    setSavingAddress(true);
    try {
      // Notes are sent even when empty — clearing them is a real edit, and the
      // endpoint only touches the keys it actually receives.
      await api.put(`/orders/${id}/shipping-details`, {
        shipping_address: next,
        order_notes: notesDraft.trim(),
      });
      toast.success('Shipping details updated');
      setEditingAddress(false);
      fetchOrder();
    } catch (err) { toast.error(err.message); }
    setSavingAddress(false);
  };

  const addTrackingNumber = async () => {
    if (!newTrackingNumber.trim()) return toast.error('Enter a tracking number');
    setAddingTracking(true);
    try {
      await api.post(`/orders/${id}/tracking-numbers`, {
        tracking_number: newTrackingNumber,
        carrier: newTrackingCarrier || undefined,
      });
      toast.success('Tracking number added');
      setNewTrackingNumber('');
      setNewTrackingCarrier('');
      fetchOrder();
    } catch (err) { toast.error(err.message); }
    setAddingTracking(false);
  };

  const removeTrackingNumber = async (trackingId) => {
    try {
      await api.delete(`/orders/${id}/tracking-numbers/${trackingId}`);
      toast.success('Tracking number removed');
      fetchOrder();
    } catch (err) { toast.error(err.message); }
  };

  /* ── Loading ──
     Holds the shape the page is about to have rather than centring a spinner
     in an empty viewport: the head, the stepper, the wide column and the rail.
     Nothing jumps when the order lands, and a slow network reads as a page
     arriving rather than as a screen that failed. */
  if (loading) return (
    <div className="od-page">
      <div className="od-skeleton" aria-busy="true" aria-live="polite">
        <div>
          <div className="od-skeleton-bar is-title" />
          <div className="od-skeleton-bar is-strip" />
        </div>
        <div className="od-skeleton-bar is-step" />
        <div className="od-skeleton-split">
          <div className="od-skeleton-bar is-main" />
          <div className="od-skeleton-bar is-rail" />
        </div>
        <span className="od-skeleton-say">Fetching order {String(id).slice(0, 8).toUpperCase()}…</span>
      </div>
    </div>
  );

  /* ── Not found ──
     DESIGN §9: an empty state is navigation, not an apology. The old one was
     an `<h3>` reading "Order not found" with nothing else on the screen —
     a dead end reached by exactly the people most likely to have followed a
     stale link from an email or a bot message. */
  if (!order) return (
    <div className="od-page">
      <div className="empty-state is-error">
        <Package aria-hidden="true" />
        <h3>No order with that reference</h3>
        <p>
          {notFound
            ? 'It may have been placed on another account, or the link may have lost characters on its way here — order references are 36 characters long.'
            : 'The store did not answer. If this keeps happening the order may still exist.'}
        </p>
        <div className="od-desk-row is-centred">
          <Link className="glass-btn" to={isAdmin ? '/admin/orders' : '/orders'}>
            <ListOrdered size={14} aria-hidden="true" /> {isAdmin ? 'Order queue' : 'Your orders'}
          </Link>
          {/* Ahead of the support link, because it answers instantly and for
              free what a ticket answers in hours: where the order is, what it
              cost, whether it can still be cancelled. Page context already
              resolves /orders/:id, so "this order" needs no explaining — the
              only thing missing was a way to notice the assistant is here.
              Falls through to the support link when it cannot help, which is
              the order the buyer wants them in. */}
          {!isAdmin && assistantOffered && (
            <button
              type="button"
              className="glass-btn"
              onClick={() => askAssistant('What is happening with this order?')}
            >
              <MessageCircleQuestion size={14} aria-hidden="true" /> Ask about this order
            </button>
          )}
          {/* Pre-linked, not bare. The support page already takes
              `?new=1&subject=` (it is how the assistant's ticket tool hands
              a person a form) and opens the composer with the subject
              filled in and nothing sent. The reference the person arrived
              with is the one thing staff will need, and the buyer is the
              person least able to retype thirty-six characters correctly —
              the link may already have lost some. No `order=`: the order
              could not be resolved, so there is no id to attach. */}
          {!isAdmin && (
            <Link
              className="glass-btn"
              to={`/support?new=1&subject=${encodeURIComponent(`Order ${String(id || '').slice(0, 8).toUpperCase()} not found`)}`}
            >
              <LifeBuoy size={14} aria-hidden="true" /> Ask the store
            </Link>
          )}
        </div>
      </div>
    </div>
  );

  // ─── Derived ────────────────────────────────────────────────────────────────

  const steps   = order.payment_method === 'cash_in_mail' ? cashSteps : statusSteps;
  // A cancelled/refunded/disputed order is not "at step 0" — indexOf returns -1
  // and the old Math.max floor drew it as though payment were still pending,
  // which read as an order that was somehow both cancelled and in progress.
  // `disputed` is only terminal while a dispute is actually live. An order left
  // at `disputed` after every dispute on it has been resolved or closed used to
  // replace the whole stepper with a red "a dispute is open on this order"
  // panel — directly above the green `resolved` badge rendered from the same
  // payload. Ask the dispute rows, not the order's status label.
  const liveDisputes = (order.disputes || []).filter(d => ['open', 'in_review'].includes(d.status));
  const isTerminal = TERMINAL_STATUSES.includes(order.status)
    && !(order.status === 'disputed' && liveDisputes.length === 0);
  const curStep = Math.max(0, steps.indexOf(order.status));
  const isOwner = user && order.user_id === user.id;
  // Staff looking at somebody else's order. Decides which queue the breadcrumb
  // points back at, which onward paths the page offers, and — because a staff
  // viewer opened this page to DO something — which panel leads.
  const isStaffViewer = !!isAdmin && !isOwner;
  const canEditAddress = isOwner && ADDRESS_EDITABLE_STATUSES.includes(order.status);
  const payment = order.payment;
  const transactions = order.transactions || [];
  const isCrypto = payment && ['btc','xmr','ltc'].includes(payment.crypto_type);
  const cColor   = isCrypto ? (cryptoColors[payment.crypto_type] || cryptoColors.btc) : null;
  const payAddress = payment?.payment_address || payment?.wallet_address || '';
  // The one figure this page asks for, from the server (utils/paymentShortfall
  // .paymentInstruction): the whole amount before anything arrives, the
  // REMAINDER once part has, and nothing once enough is in. The QR encodes
  // the same figure. It used to encode `amount_crypto` regardless, so a buyer
  // topping up a short payment by scanning the code sent the whole invoice a
  // second time — the shortfall note beside it said 0.0011 and the code said
  // 0.0052. Falls back to the raw amounts for a viewer whose redaction leaves
  // no instruction (staff without the money grant), who is shown no figure.
  const instruction = order.payment_instruction || null;
  const payState = instruction?.state
    || (payment && parseFloat(payment.amount_crypto || 0) > 0
      && parseFloat(payment.confirmed_received || 0) >= parseFloat(payment.amount_crypto || 0) ? 'settled'
      : payment && parseFloat(payment.amount_received || 0) > 0 ? 'partial' : 'unpaid');
  const askAmount = instruction ? instruction.amount : (payment?.amount_crypto ?? null);
  const qrUri    = isCrypto ? buildCryptoUri(payment.crypto_type, payAddress, askAmount) : '';
  // Handed to the panel as custom properties so the coin's two colours reach
  // the hairline, the chip and the QR bloom without any of them being written
  // out again in CSS. The theme owns everything else on the panel.
  const coinVars = cColor ? { '--coin-a': cColor.from, '--coin-b': cColor.to } : undefined;

  const totalReceived   = payment ? parseFloat(payment.amount_received || 0) : 0;
  const confirmedReceived = payment ? parseFloat(payment.confirmed_received || 0) : 0;
  const requiredNum     = payment ? parseFloat(payment.amount_crypto || 0) : 0;
  const hasAnyReceived  = totalReceived > 0;
  const hasSufficient   = confirmedReceived >= requiredNum && requiredNum > 0;
  const reqConfs        = payment?.required_confirmations || 1;
  // Min confirmations across all transactions — the depth the whole payment
  // can be relied on to, which is the shallowest of its parts.
  const minConfs = transactions.length > 0 ? Math.min(...transactions.map(t => t.confirmations)) : 0;

  const isPendingCrypto = isCrypto && order.status === 'pending_payment';
  const isCashMail = order.payment_method === 'cash_in_mail';
  const isZelle = order.payment_method === 'zelle';
  // The demo rail. Kept out of `isCrypto` on purpose: the crypto panel draws a
  // QR code and a coin gradient, and rendering a fake address inside that
  // chrome is exactly how somebody ends up sending real coins to a string no
  // wallet controls. The demo gets its own panel that says what it is.
  const isDemo = order.payment_method === 'demo';
  const isPendingDemo = isDemo && order.status === 'pending_payment';
  const orderLabel = order.uuid ? order.uuid.split('-')[0].toUpperCase() : `#${order.id}`;

  /**
   * What this order is waiting on — and therefore what leads the page.
   *
   * DESIGN §3: exactly one thing on a screen may be lit, or nothing is. The
   * old page had no answer to this at all. Every panel was the same glass at
   * the same depth, and the panels a buyer actually had to act on were the
   * furthest down: "Finalize Order" and "Open Dispute" sat below the payment
   * summary, the items, the boxes and the staff controls, so a buyer whose
   * parcel had arrived scrolled past the whole record to answer the one
   * question the page was asking them.
   *
   * The outstanding thing leads now, whatever it is, in one slot at the top of
   * the main column. When there is nothing outstanding and a staff viewer is
   * looking, the desk leads instead — that is what they opened the order to
   * reach. An order with neither is a record, and nothing on it glows.
   */
  const outstanding =
      isPendingCrypto ? 'crypto'
    : isPendingDemo ? 'demo'
    : (isOwner && isZelle && order.status === 'awaiting_confirmation') ? 'zelle'
    : (isOwner && isCashMail && BUYER_CANCELLABLE.includes(order.status)) ? 'cash'
    : (!isAdmin && isOwner && order.status === 'shipped') ? 'arrived'
    : (!isAdmin && isOwner && order.status === 'refunded') ? 'refund'
    : null;
  const deskLeads = !outstanding && isStaffViewer && staffPanelVisible;
  const buyerMayCancel = isOwner && BUYER_CANCELLABLE.includes(order.status);

  // The payment as a record rather than as an instruction: drawn whenever the
  // rail's own instruction is not already leading the page.
  const showPaymentRecord = !isPendingCrypto && !isDemo && outstanding !== 'zelle' && outstanding !== 'cash';

  /**
   * Where someone goes from here (DESIGN §9).
   *
   * The audit that produced this list found one outbound path on the whole
   * page for a buyer — the breadcrumb — and turned up a printable receipt at
   * /orders/:uuid/receipt that nothing in the entire application linked to.
   * The route had been shipped and left unreachable.
   *
   * The receipt is offered to anyone the totals are visible to, which is the
   * same test OrderReceipt itself applies before it will render: a viewer
   * whose grants redact the money gets a sheet reading $0.00, so it refuses,
   * and there is no point sending them to it.
   */
  const ways = [];
  if (order.total != null && order.uuid) {
    ways.push({ to: `/orders/${order.uuid}/receipt`, icon: Receipt, label: 'Printable receipt' });
  }
  if (isStaffViewer) {
    if (can.viewOrders) ways.push({ to: '/admin/orders', icon: ListOrdered, label: 'Order queue' });
    // `orders.view_customer` is what puts a username on the order at all, and
    // it is the same grant that makes the queue's search box match one — so if
    // the name is here, the link works.
    if (order.username) {
      ways.push({
        to: `/admin/orders?search=${encodeURIComponent(order.username)}`,
        icon: Users,
        label: `Everything ${order.username} has ordered`,
      });
    }
    if (order.disputes?.length > 0 && can.has('disputes.view')) {
      ways.push({ to: '/admin/disputes', icon: Gavel, label: 'Dispute desk' });
    }
  } else {
    ways.push({ to: '/orders', icon: ListOrdered, label: 'Your other orders' });
    ways.push({ to: '/products', icon: Store, label: 'Back to the shelves' });
    // "About this order" means the form arrives knowing which order. The
    // support page opens its composer from `?new=1&subject=&order=` (the
    // assistant's ticket tool has always used that door), so the buyer lands
    // with the order attached and a subject naming it, and staff get a ticket
    // they can open the order from. Bare `/support` sent them to a list of
    // their old tickets and a "New ticket" button, and the order the whole
    // link was about had to be picked out of a dropdown by its first block.
    ways.push({
      to: `/support?new=1&order=${order.id}&subject=${encodeURIComponent(`Order ${orderLabel}`)}`,
      icon: LifeBuoy,
      label: 'Ask the store about this order',
    });
  }

  const backTo    = isStaffViewer && can.viewOrders ? '/admin/orders' : '/orders';
  const backLabel = isStaffViewer && can.viewOrders ? 'Order queue' : 'Your orders';

  // ─── Panels reused between "instruction" and "record" ────────────────────────

  const testnetNote = payment?.testnet ? (
    <Note tone="warn">
      <strong>Testnet</strong>
      <p>These are not real coins. Do not send funds to this address.</p>
    </Note>
  ) : null;

  const zelleBody = (
    <>
      {order.zelle?.recipient_handle ? (
        <>
          <dl className="od-kv">
            <div className="od-kv-row"><dt>Recipient</dt><dd>{order.zelle.recipient_name}</dd></div>
            {order.zelle.bank_name && (
              <div className="od-kv-row"><dt>Bank</dt><dd>{order.zelle.bank_name}</dd></div>
            )}
            <div className="od-kv-row is-num">
              <dt>Amount</dt><dd>{money(order.zelle.amount ?? order.total)}</dd>
            </div>
          </dl>
          <CopyField
            label={order.zelle.handle_type === 'phone' ? 'Zelle phone number' : 'Zelle email'}
            value={order.zelle.recipient_handle}
          />
        </>
      ) : (
        <p className="od-panel-note">Recipient details are hidden from your account.</p>
      )}

      {order.zelle?.reference && (
        <>
          <CopyField label="Put this in the Zelle memo" value={order.zelle.reference} large />
          <Note tone="warn">
            Without this code the transfer cannot be matched to your order, and confirming
            it becomes a manual hunt through the store's bank statement.
          </Note>
        </>
      )}

      {order.zelle?.instructions && (
        <p className="od-panel-note">{order.zelle.instructions}</p>
      )}

      {isOwner && order.status === 'awaiting_confirmation' && (
        <>
          <p className="od-panel-note">
            Zelle has no automatic confirmation, so staff verify the transfer by hand. This
            order moves to paid once they do.
          </p>
          {/* The buyer's half of the reconciliation loop. Telling the store the
              transfer is on its way pages the payment desk and stops the
              stale-order sweep cancelling an order whose money is mid-air —
              the cash rail's tracking box, for Zelle. */}
          {order.zelle_sent_at ? (
            <Note tone="success" icon={CheckCircle}>
              You marked this transfer as sent on {fmtStamp(order.zelle_sent_at)}.
              Staff confirm it once it lands.
            </Note>
          ) : (
            <div className="od-desk-row">
              <button
                type="button"
                className="glass-btn glass-btn-primary is-lead"
                onClick={markZelleSent}
                disabled={zelleSentBusy}
              >
                <Send size={14} aria-hidden="true" />
                {zelleSentBusy ? 'Recording…' : "I've sent the transfer"}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );

  const cashMailBody = (
    <>
      {order.cash_mail_address && (
        <CopyField
          label={outstanding === 'cash' ? 'Send cash to' : 'Cash was sent to'}
          value={order.cash_mail_address}
        />
      )}

      <div className="od-field is-spaced">
        <label htmlFor="od-cash-track">
          {isAdmin && !isOwner ? "Buyer's mail tracking" : 'Your mail tracking'}
        </label>
        {isOwner && !isAdmin && BUYER_CANCELLABLE.includes(order.status) ? (
          <div className="od-parcel-add is-bare">
            <div className="od-field is-grow">
              <input
                id="od-cash-track"
                type="text"
                className="glass-input"
                value={cashMailTracking}
                onChange={(e) => setCashMailTracking(e.target.value)}
                placeholder="Tracking number from the post office"
              />
            </div>
            <button
              type="button"
              className="glass-btn glass-btn-primary glass-btn-sm"
              onClick={updateCashMailTracking}
              disabled={updatingTracking}
            >
              <Send size={12} aria-hidden="true" />
              {order.cash_mail_tracking ? 'Update' : 'Submit'}
            </button>
          </div>
        ) : order.cash_mail_tracking ? (
          <span className="od-parcel-no">{order.cash_mail_tracking}</span>
        ) : (
          <span className="od-withheld">
            {isAdmin && !isOwner ? 'The buyer has not sent a tracking number yet.' : 'Not submitted yet.'}
          </span>
        )}
      </div>

      {!isAdmin && order.status === 'awaiting_confirmation' && (
        <Note tone="warn" icon={Clock}>
          Waiting for staff to open the envelope and confirm the amount.
          {!order.cash_mail_tracking && ' Adding the tracking number above is what lets them find it.'}
        </Note>
      )}
    </>
  );

  // Committing a partial refund. Replaces a `window.prompt()` that could not
  // state the ceiling, could not validate what came back, and handed a raw
  // string to `parseFloat` — so an empty prompt sent `NaN`, which
  // `JSON.stringify` turns into `null` on the way to a money column.
  const submitRefund = () => {
    const max = Number(order.total);
    const amount = Number(refundDraft);
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter an amount to refund');
    if (amount > max) return toast.error(`This order only holds ${money(max)}`);
    adminUpdateStatus('refunded', { refund_amount: Math.round(amount * 100) / 100 });
  };

  const paymentContent = <>        {/* Unpaid crypto: an address, an amount and a clock. Nothing on the
            page outranks it until it is paid. */}
        {outstanding === 'crypto' && (
          <section id="payment" className={`od-panel is-lead od-pay is-${payState}`} style={coinVars} data-pay-state={payState}>
            <div className="od-pay-edge" aria-hidden="true" />
            <div className="od-pay-body">
              {testnetNote}

              <div className="od-pay-split">
                <div>
                  <div className="od-pay-coin">
                    <span className="od-pay-coin-mark" aria-hidden="true"><Wallet size={19} /></span>
                    <div>
                      <div className="od-pay-coin-name">
                        {cryptoNames[payment.crypto_type] || payment.crypto_type.toUpperCase()}
                      </div>
                      <div className="od-pay-coin-sub">One address, used by this order only</div>
                    </div>
                  </div>

                  {/* The panel changes with the payment, not with the order:
                      before anything arrives the amount leads; after a part
                      payment the SAME slot carries the remainder, with its
                      own copy button, and the QR to the right encodes it;
                      once enough is in the ask goes entirely and "nothing
                      more to send" stands where it was. A figure that could
                      be paid twice is never on screen. */}
                  {(payState === 'confirming' || payState === 'settled') ? (
                    <div className="od-pay-done" role="status">
                      <CheckCircle size={20} aria-hidden="true" />
                      <div>
                        <div className="od-pay-done-title">
                          {payState === 'settled' ? 'Paid in full' : 'Nothing more to send — waiting for confirmation'}
                        </div>
                        <div className="od-pay-done-sub">
                          {instruction?.detail || (payState === 'settled'
                            ? 'Your payment is confirmed. The order is moving on.'
                            : 'Your payment has arrived. Waiting for network confirmation.')}
                        </div>
                      </div>
                    </div>
                  ) : askAmount && (
                    <div className="od-pay-ask">
                      <PaymentAmount amount={askAmount} ticker={payment.crypto_type.toUpperCase()} label={instruction?.label} onCopy={() => copyValue(askAmount, payState === 'partial' ? 'Remaining amount copied' : 'Amount copied')} />
                      {payState === 'partial' ? (
                        <div className="od-pay-of">
                          {trimCoin(totalReceived, coinPlaces(payment.crypto_type))} of {payment.amount_crypto}{' '}
                          {payment.crypto_type.toUpperCase()} has arrived. {instruction?.detail}
                        </div>
                      ) : (
                        <div className="od-pay-usd">
                          {money(payment.amount_usd)} at the rate when this order was placed
                        </div>
                      )}
                    </div>
                  )}

                  <CopyField
                    label={`${payment.crypto_type.toUpperCase()} address`}
                    value={payAddress}
                    what="Address copied"
                  />

                  <div className="od-monitor">
                    <div className="od-monitor-head">
                      <span className="od-monitor-live">
                        {checking
                          ? <span className="spinner spinner-inline" />
                          : <span className="od-monitor-dot" aria-hidden="true" />}
                        {checking || order.payment_check?.state === 'checking' ? 'Checking the payment network…' : checkError || order.payment_check?.state === 'unavailable' ? 'Payment check unavailable' : 'Payment monitoring'}
                      </span>
                      <button
                        type="button"
                        className="glass-btn glass-btn-sm"
                        onClick={triggerCheck}
                        disabled={checking}
                      >
                        <RefreshCw size={11} aria-hidden="true" className={checking ? 'is-spinning' : undefined} />
                        Check now
                      </button>
                    </div>

                    <SettleTrack
                      received={totalReceived}
                      confirmed={confirmedReceived}
                      required={requiredNum}
                      ticker={payment.crypto_type.toUpperCase()}
                      reqConfs={reqConfs}
                    />

                    {/* Still short.
                        The figure comes from the server (utils/paymentShortfall)
                        rather than from `requiredNum - totalReceived` here, for
                        two reasons.

                        Float equality: subtracting two decimals read back from
                        NUMERIC columns can leave a remainder in the eighteenth
                        place, and `.toFixed()` would then print a buyer who
                        paid in full an unpayable amount they still "owe". The
                        module rounds both sides to the coin's own precision
                        before subtracting.

                        Parity: both bots print this same sentence from the same
                        function. A buyer told "send 0.0011 more" on the site and
                        something different on Telegram acts on whichever they
                        read first. */}
                    {order.shortfall?.short && (
                      <Note tone="warn">
                        Still short by{' '}
                        <b>{trimCoin(order.shortfall.remaining, order.shortfall.places)} {order.shortfall.ticker}</b>.
                        Send the remainder to the same address — payments to it are added together.
                      </Note>
                    )}

                    {/* The state the old panel had no sentence for: every coin
                        has arrived and none of it is deep enough yet. The
                        buyer's question here is "is there anything left for
                        me to do", and the answer is no — so it is said, with
                        the usual wait for the shallowest payment. */}
                    {hasAnyReceived && totalReceived >= requiredNum && !hasSufficient && (
                      <Note icon={Clock}>
                        The order settles when its
                        shallowest payment reaches {reqConfs} block{reqConfs === 1 ? '' : 's'}
                        {(() => {
                          const eta = formatWindow(settleWindowMinutes(payment.crypto_type, Math.max(0, reqConfs - minConfs)));
                          return eta ? `, usually ${eta} from now` : '';
                        })()}.
                      </Note>
                    )}

                    <PaymentLedger
                      transactions={transactions}
                      cryptoType={payment.crypto_type}
                      requiredConfirmations={reqConfs}
                      payment={payment}
                      requiredAmount={requiredNum}
                    />

                    {transactions.length === 0 && hasAnyReceived && (
                      <p className="od-monitor-when">A payment has landed; its details are still loading.</p>
                    )}

                    {(checkError || order.payment_check?.state === 'unavailable') && <p className="flow-error" role="status">{checkError || 'The payment node did not answer. These are the last known amounts; another check will run automatically.'}</p>}
                    <p className="od-monitor-when">
                      {payment.checked_at ? `Last successful network check: ${new Date(payment.checked_at).toLocaleString()}` : 'No successful network check recorded yet.'}
                    </p>
                  </div>
                </div>

                <div className="od-pay-qr">
                  <button
                    type="button"
                    className="od-qr-thumb"
                    onClick={() => setQrOpen(true)}
                    title="Enlarge this code"
                    aria-label="Enlarge the payment QR code"
                  >
                    <QRCodeSVG value={qrUri || payAddress} size={148} level="M" includeMargin={false} />
                  </button>
                  <span className="od-qr-cap">
                    {payState === 'partial' ? 'Carries the remaining amount' : 'Scan with your'}<br />
                    {payState === 'partial' ? 'Scan with your wallet' : `${cryptoNames[payment.crypto_type] || payment.crypto_type.toUpperCase()} wallet`}
                  </span>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => setQrOpen(true)}>
                    <ExternalLink size={11} aria-hidden="true" /> Enlarge
                  </button>
                </div>
              </div>
              {/* Switching rails is offered only while NOTHING has arrived.
                  A part-paid order must not move: the coins are at this
                  address and the checker is watching it, so re-quoting
                  elsewhere would strand what was already sent. paymentSwitch
                  refuses it server-side too; this keeps the button off the
                  screen rather than letting somebody find out by pressing. */}
              {isOwner && !hasAnyReceived && (
                <RailSwitcher order={order} payment={payment} onSwitched={fetchOrder} />
              )}
            </div>
          </section>
        )}

        {/* ── DEMO PAYMENT ──
            Its own panel rather than a variant of the crypto one. The crypto
            card draws a coin gradient, a QR code and a "scan to pay" affordance,
            and a fake address wearing that chrome is precisely how somebody
            sends real funds to a string that no wallet anywhere controls. This
            says what it is before it shows an address at all, and keeps saying
            it after the order settles. */}
        {isDemo && (
          <div className="orderx-demo-panel">
            <div className="orderx-demo-banner">
              <FlaskConical size={18} aria-hidden="true" />
              <div>
                <strong>Demo payment — no real payment</strong>
                <p>
                  This store is running a demonstration checkout. Nothing was charged, no
                  coins are involved and the address below is not a wallet.
                </p>
              </div>
            </div>

            <div className="orderx-demo-rows">
              <div className="orderx-demo-row">
                <span>Amount</span>
                <strong>{money(order.total)}</strong>
              </div>
              {payment?.wallet_address && (
                <div className="orderx-demo-row is-stacked">
                  <span>Demo address</span>
                  <code className="orderx-demo-address">{payment.wallet_address}</code>
                </div>
              )}
              <div className="orderx-demo-row">
                <span>State</span>
                {isPendingDemo ? (
                  <strong className="orderx-demo-live">
                    <span className="orderx-demo-pulse" aria-hidden="true" />
                    Confirming automatically…
                  </strong>
                ) : (
                  <strong className="orderx-demo-done">
                    <CheckCircle size={13} aria-hidden="true" /> Settled — no funds moved
                  </strong>
                )}
              </div>
            </div>

            {isPendingDemo && (
              <p className="orderx-demo-foot">
                This order marks itself paid after a short delay set by the operator. Leave the
                page open or come back later — nothing needs to be sent.
              </p>
            )}
          </div>
        )}

        {/* Out-of-band rails, while the buyer still owes the money. */}
        {outstanding === 'zelle' && (
          <section className="od-panel is-lead" id="payment">
            <div className="od-panel-head">
              <h3 className="od-panel-title"><Landmark size={15} aria-hidden="true" /> Send the transfer</h3>
            </div>
            {zelleBody}
            {isOwner && !order.zelle_sent_at && (
              <RailSwitcher order={order} payment={null} onSwitched={fetchOrder} />
            )}
          </section>
        )}
        {outstanding === 'cash' && (
          <section className="od-panel is-lead" id="payment">
            <div className="od-panel-head">
              <h3 className="od-panel-title"><Mail size={15} aria-hidden="true" /> Post the cash</h3>
            </div>
            {cashMailBody}
            {isOwner && !order.cash_mail_tracking && order.status !== 'paid' && (
              <RailSwitcher order={order} payment={null} onSwitched={fetchOrder} />
            )}
          </section>
        )}

</>;
  if (embedded === 'payment') return <div className="payment-embedded">
    {paymentContent}
    {!['crypto', 'zelle', 'cash', 'demo'].includes(outstanding) && <div className="glass-card flow-success" role="status"><CheckCircle size={24} /><div><h3>{order.status === 'cancelled' ? 'Order cancelled' : order.status === 'refunded' ? 'Order refunded' : 'Payment complete'}</h3><p>{order.next_action?.reason || 'Your order is recorded.'}</p></div></div>}
    {qrOpen && isCrypto && <QrLightbox uri={qrUri} address={payAddress} onClose={() => setQrOpen(false)} />}
  </div>;

  return (
    <div className="od-page">

      {/* ── Header ──
          Says where you are (DESIGN §9). The breadcrumb points at the queue the
          reader came from, which is not always the same list: it read "Your
          orders" and pointed at /orders for everybody, so a packer who reached
          this page from the admin queue was offered a link to their own
          shopping history. */}
      {isStaffViewer && <OrderQueueNav orderRef={order.uuid} />}
      <header className="od-head">
        <nav className="od-crumb" aria-label="Breadcrumb">
          <Link to={backTo} className="od-crumb-link">
            <ChevronLeft size={13} aria-hidden="true" />
            {backLabel}
          </Link>
        </nav>

        <div className="od-head-row">
          <div className="od-head-id">
            <h1 className="od-title">{orderLabel}</h1>
            {order.uuid && <div className="od-uuid">{order.uuid}</div>}
          </div>

          <div className="od-head-side">
            {/* The status badge lives on the stepper, which names the step it
                has reached in words. Printing it here as well made three
                statements of one fact — header badge, stepper node, and a
                "Status" row in the Order Info card — on a page whose job is
                to be unambiguous about exactly this. Terminal orders keep it,
                because there is no step for them to sit on. */}
            {isTerminal && <StatusBadge status={order.status} />}
            {isDemo && (
              <span className="orderx-demo-chip is-lg">
                <FlaskConical size={12} aria-hidden="true" /> DEMO — no real payment
              </span>
            )}
            {/* "Buy it again" belongs where the order is, at the top, on every
                status. Membership tiers are earned on a rolling 30-day spend
                window, so repeating an order is the single most valuable thing
                a returning buyer can do and it had no path at all. */}
            {isOwner && (
              <ReorderButton orderRef={order.uuid || order.id} onResult={setReorderResult} />
            )}
          </div>
        </div>

        {/* The reference facts.
            These were a glass card in the rail holding two rows — the payment
            method and the date — which is a border, a blur, a shadow and 20px
            of padding spent on eleven words, next to a header with room to
            spare. They are a strip now, and it carries more than the card did:
            the money, the buyer, the rail, and when it was placed. DESIGN §7. */}
        <div className="od-facts">
          <Fact
            k="Total"
            money
            v={order.total == null ? 'hidden' : money(order.total)}
            muted={order.total == null}
            title={order.total == null ? 'Your role does not include order totals' : undefined}
          />
          <Fact k="Paying with" v={railName(order.payment_method, payment?.crypto_type)} />
          <Fact k="Placed" v={fmtDate(order.created_at)} title={fmtStamp(order.created_at)} />
          {/* A field that names another record is a link (DESIGN §9). */}
          {order.username && (
            <Fact
              k="Buyer"
              v={order.username}
              to={`/admin/orders?search=${encodeURIComponent(order.username)}`}
              title={`Every order ${order.username} has placed`}
            />
          )}
          <Fact k="Items" v={order.items?.length ? String(order.items.length) : null} />
        </div>
      </header>

      {/* ── Progress Stepper ── */}
      <div className="order-stepper">
        {isTerminal ? (
          <div className={`order-stepper-terminal is-${order.status}`}>
            <div className="order-stepper-terminal-icon">
              {order.status === 'disputed' ? <AlertTriangle size={20} /> : <XCircle size={20} />}
            </div>
            <div className="order-stepper-terminal-text">
              <div className="order-stepper-terminal-title">{STATUS[order.status]?.label || order.status}</div>
              <div className="order-stepper-terminal-sub">
                {order.status === 'cancelled' && 'This order was cancelled and is no longer progressing.'}
                {order.status === 'refunded' && 'This order was refunded. Any store credit and coupon it used have been returned.'}
                {order.status === 'disputed' && (liveDisputes.length > 0
                  ? 'A dispute is open on this order. Staff will respond in the dispute thread.'
                  : 'This order is being settled following a dispute. Staff have responded in the dispute thread.')}
              </div>
            </div>
          </div>
        ) : (
          <div
            className="order-stepper-rail"
            /* The track spans centre-of-first-icon to centre-of-last-icon, which
               is half a column in from each edge. It used to be a flat 20px,
               which only lined up when a column happened to be 40px wide — at
               every other width the fill stopped short of, or ran past, the
               icon it was meant to land on. */
            style={{ '--steps': steps.length, '--fill': `${(curStep / Math.max(steps.length - 1, 1)) * 100}%` }}
          >
            <div className="order-stepper-track">
              <div className="order-stepper-fill" />
            </div>
            {steps.map((step, i) => {
              const meta = stepMeta[step] || { icon: Clock, label: step, color: 'var(--primary)', at: null };
              const Icon = meta.icon;
              const done = i < curStep;
              const active = i === curStep;
              const cls = ['order-step', done ? 'is-done' : '', active ? 'is-active' : ''].filter(Boolean).join(' ');
              // When it happened, on the steps this order has actually reached.
              // A future step has no date, and `accepted` has no date at any
              // point because nothing records one — see `stepMeta`.
              const when = meta.at && i <= curStep ? order[meta.at] : null;
              return (
                <div key={step} className={cls} style={{ '--step-color': meta.color, '--i': i }}>
                  <div className="order-step-node">
                    {done ? <CheckCircle size={18} /> : <Icon size={16} />}
                  </div>
                  <div className="order-step-label">{meta.label}</div>
                  <time
                    className="order-step-when"
                    dateTime={when || undefined}
                    title={when ? fmtStamp(when) : undefined}
                  >
                    {when ? fmtDay(when) : ''}
                  </time>
                </div>
              );
            })}
          </div>
        )}
        {/* Who, why and where — or, when the server sent no next action, the
            older note that only says how long. */}
        {!isTerminal && (order.next_action
          ? <NowStrip action={order.next_action} timeline={order.timeline} order={order} param={id} />
          : <WaitingNote order={order} />)}
        {/* Deliberate questions for staff, not a chat: each names the order,
            so the assistant resolves it through `look_up_order` and the
            proposal tool — both of which redact for the asker's own
            permissions before a model sees a row. Only offered where the
            operator has switched the staff console on. */}
        {isStaffViewer && assistantOffered && consoleOffered && (
          <div className="od-now-ask">
            {/* The plain question first, on every status including the
                terminal ones the blocker buttons below have nothing to say
                about. "Look up order N" is the staff lookup topic's own
                phrasing, so it is answered from the tables, instantly, with
                the verbs this viewer may press on the card that comes back. */}
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              onClick={() => askAssistant(`Look up order ${order.id}`)}
            >
              <MessageCircleQuestion size={13} aria-hidden="true" /> Ask about this order
            </button>
            {!isTerminal && (
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                onClick={() => askAssistant(`Explain why order ${order.id} is not moving, and what should happen next.`)}
              >
                <MessageCircleQuestion size={13} aria-hidden="true" /> Explain this blocker
              </button>
            )}
            {!isTerminal && ['paid', 'accepted'].includes(order.status) && (
              <button
                type="button"
                className="glass-btn glass-btn-sm"
                onClick={() => askAssistant(`Order ${order.id} may be short on stock. Which lines cannot be picked, and what could be offered in their place?`)}
              >
                <ArrowLeftRight size={13} aria-hidden="true" /> Help resolve a stock discrepancy
              </button>
            )}
          </div>
        )}
        {/* The buyer's own expectation line. Owner only: staff read the
            NowStrip above, which says who the order is waiting on; a
            store-wide average beside that is a second answer for them, and
            the one this line is for is the person waiting on the parcel.
            The component itself decides the leg and goes quiet on
            delivered, cancelled, refunded and a carrier-dated parcel. */}
        {isOwner && <DispatchEstimate order={order} />}
      </div>

      {/* Who placed this. Staff only, and only with orders.view_customer — the
          server withholds the whole object otherwise, so there is nothing to
          hide here. */}
      {order.customer && (
        <div className="od-customer-slot">
          <CustomerCard customer={order.customer} orderRef={String(order.uuid || order.id).slice(0, 8).toUpperCase()} />
        </div>
      )}

      {/* The wide column carries the money and the goods; the rail carries the
          reference facts. It used to be the other way round — a 300px sidebar
          held the line items, their prices and the order total while a 550px
          column held one payment panel and then several hundred pixels of
          nothing. Product names wrapped to three lines in the rail beside an
          empty half-page. */}
      <div className={`order-detail-grid${isPendingCrypto ? ' is-single' : ''}`}>

        {/* The wide column is one grid item, not a run of hand-placed ones —
            see the note on `.od-main` in 73-order-detail.css for the screen and
            a half of empty page the previous arrangement carried. */}
        <div className="od-main">

        {/* ── The lead slot: whatever this order is waiting on ── */}

        {paymentContent}

        {/* Their parcel is out. The one question the store has for them, and it
            used to sit below every panel on the page. */}
        {outstanding === 'arrived' && (
          <section className="od-panel is-lead">
            <div className="od-panel-head">
              <h3 className="od-panel-title"><Truck size={15} aria-hidden="true" /> Did it arrive?</h3>
            </div>
            <p className="od-panel-note">
              Closing the order releases it for review and finishes it on both sides. If
              something is wrong — short, damaged, never turned up — open a dispute instead
              and staff pick it up in the thread.
            </p>
            <div className="od-desk-row is-spaced">
              <button type="button" className="glass-btn glass-btn-success is-lead" onClick={markDelivered}>
                <CheckCircle size={15} aria-hidden="true" /> Everything arrived
              </button>
              {!showDispute && (
                <div className="od-desk-danger">
                  <button type="button" className="glass-btn glass-btn-danger glass-btn-sm" onClick={() => setShowDispute(true)}>
                    <AlertTriangle size={14} aria-hidden="true" /> Something is wrong
                  </button>
                </div>
              )}
            </div>
            {showDispute && (
              <div className="od-confirm">
                <div className="od-field">
                  <label htmlFor="od-dispute">What went wrong?</label>
                  <textarea
                    id="od-dispute"
                    className="glass-input"
                    value={disputeReason}
                    onChange={e => setDisputeReason(e.target.value)}
                    placeholder="Which items, what state they arrived in, what you would like done about it."
                    rows={4}
                  />
                </div>
                <div className="od-confirm-actions">
                  <button type="button" className="glass-btn glass-btn-danger glass-btn-sm" onClick={submitDispute}>
                    <ArrowRight size={14} aria-hidden="true" /> Open the dispute
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => setShowDispute(false)}>
                    Not now
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Money the store owes them, and the address it goes to. */}
        {outstanding === 'refund' && (
          <section className="od-panel is-lead is-warn">
            <div className="od-panel-head">
              <h3 className="od-panel-title"><DollarSign size={15} aria-hidden="true" /> Your refund</h3>
              <div className="od-panel-aside">
                <span className="badge badge-warning">{money(order.refund_amount || order.total)}</span>
              </div>
            </div>
            {order.refund_txid ? (
              <>
                <Note tone="success" icon={CheckCircle}>Sent. It is on the chain now.</Note>
                <CopyField label="Refund transaction" value={order.refund_txid} what="Transaction id copied" />
              </>
            ) : order.refund_address ? (
              <>
                <Note tone="warn" icon={Clock}>
                  Address received. Staff send the payout by hand, so this is not instant.
                </Note>
                <CopyField label="Paying out to" value={order.refund_address} />
              </>
            ) : (
              <>
                <p className="od-panel-note">
                  Where should it go? The store cannot reuse the address you paid from — on
                  every chain here that address belongs to your wallet software, not to you.
                </p>
                <div className="od-parcel-add is-bare">
                  <div className="od-field is-grow">
                    <label htmlFor="od-refund-addr">
                      Your {payment?.crypto_type ? (cryptoNames[payment.crypto_type] || payment.crypto_type.toUpperCase()) : 'crypto'} address
                    </label>
                    <input
                      id="od-refund-addr"
                      type="text"
                      className="glass-input"
                      value={refundAddress}
                      onChange={e => setRefundAddress(e.target.value)}
                      placeholder="Paste the receiving address"
                    />
                  </div>
                  <button
                    type="button"
                    className="glass-btn glass-btn-primary glass-btn-sm"
                    onClick={claimRefund}
                    disabled={claimingRefund}
                  >
                    <Send size={12} aria-hidden="true" /> {claimingRefund ? 'Submitting…' : 'Send it here'}
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* Walking away, while walking away is still possible.
            A footnote with a button, not a panel: a card is a claim that
            something is a discrete object, and "you can still cancel" is a
            condition of the panel above it. `isOwner` alone, not
            `!isAdmin && isOwner` — staff cancel their own unpaid orders as
            ordinary buyers, and the old guard left a staff member's own order
            with no cancel control anywhere. */}
        {buyerMayCancel && (
          <div className="od-quiet">
            <span className="od-quiet-say">
              Changed your mind? This order can be cancelled until the payment is confirmed.
            </span>
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              onClick={() => setAsk(ask === 'cancel' ? null : 'cancel')}
            >
              <Ban size={13} aria-hidden="true" /> Cancel this order
            </button>
            {ask === 'cancel' && (
              <div className="od-confirm">
                <p className="od-confirm-lede">
                  <AlertTriangle size={14} aria-hidden="true" />
                  Cancelling releases the stock and returns any store credit and coupon this
                  order used. It cannot be un-cancelled — a new order is the only way back.
                </p>
                <div className="od-confirm-actions">
                  <button type="button" className="glass-btn glass-btn-danger glass-btn-sm" onClick={cancelOrder} disabled={cancelling}>
                    <XCircle size={14} aria-hidden="true" /> {cancelling ? 'Cancelling…' : 'Yes, cancel it'}
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => setAsk(null)} disabled={cancelling}>
                    Keep the order
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── The shop's own note ──
            Above the desk, because it is the thing somebody reads BEFORE
            deciding what to do with the order — "customer rang, hold until
            Friday" changes whether you press Accept — and DESIGN's rule is
            that the reading comes before the controls.

            Never shown to the buyer: the server strips all four fields for
            anyone without `orders.view` (see utils/orderVisibility), so this
            block simply has nothing to render for them. The gate here is about
            chrome, not secrecy — a staff member who can neither write a note
            nor read one that exists gets no empty panel. */}
        {isAdmin && (can.noteOrders || order.staff_note) && (
          <section className="od-panel od-staffnote">
            <div className="od-panel-head">
              <h3 className="od-panel-title">
                <NotepadText size={15} aria-hidden="true" /> Staff note
              </h3>
              {order.staff_note_at && (
                <div className="od-panel-aside">
                  <small>
                    {order.staff_note_by_username || 'a former colleague'}
                    {' · '}{new Date(order.staff_note_at).toLocaleString()}
                  </small>
                </div>
              )}
            </div>

            {noteDraft === null ? (
              <div className="od-staffnote-read">
                {order.staff_note
                  ? <p className="od-staffnote-text">{order.staff_note}</p>
                  : <p className="od-staffnote-empty">Nothing recorded on this order yet.</p>}
                {can.noteOrders && (
                  <button
                    type="button"
                    className="glass-btn glass-btn-sm"
                    onClick={() => setNoteDraft(order.staff_note || '')}
                  >
                    <Pencil size={13} aria-hidden="true" /> {order.staff_note ? 'Edit' : 'Write a note'}
                  </button>
                )}
              </div>
            ) : (
              <div className="od-staffnote-edit">
                <label className="sr-only" htmlFor="od-staff-note">Staff note on this order</label>
                <textarea
                  id="od-staff-note"
                  className="glass-input"
                  rows={3}
                  maxLength={ORDER_NOTE_MAX}
                  value={noteDraft}
                  autoFocus
                  placeholder="What the next person handling this order needs to know."
                  onChange={(e) => setNoteDraft(e.target.value)}
                />
                <div className="od-staffnote-actions">
                  {/* The cap is the database's, stated here so an operator sees
                      it filling rather than discovering it on save. */}
                  <small>{noteDraft.length} / {ORDER_NOTE_MAX}</small>
                  <button
                    type="button"
                    className="glass-btn glass-btn-primary glass-btn-sm"
                    onClick={saveStaffNote}
                    disabled={savingNote}
                  >
                    {savingNote ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    type="button"
                    className="glass-btn glass-btn-sm"
                    onClick={() => setNoteDraft(null)}
                    disabled={savingNote}
                  >
                    Cancel
                  </button>
                </div>
                {/* Not visible to the customer, said where somebody is typing
                    rather than in a tooltip they would have to go looking for.
                    The packing note beside it has the opposite lifetime and
                    saying so here is what stops the two being used
                    interchangeably. */}
                <p className="od-staffnote-hint">
                  Staff only — the customer never sees this. It stays on the order,
                  unlike the packing note, which clears when the pack is handed on.
                </p>
              </div>
            )}
          </section>
        )}

        {/* ── The staff desk ──
            Called "Admin Actions" and drawn at the very bottom of the page,
            under the buyer's dispute thread, as a flat row of eight identical
            small buttons. Accepting an order, opening the packing bench and
            refunding it are not peers; a row that draws them identically has
            not decided which one the person is here for (DESIGN §1). The
            advancing move leads, the routes into the fulfilment screens follow
            as links, and everything that ends the order or moves money is
            behind a rule and drawn in danger. */}
        {isAdmin && staffPanelVisible && (
          <section className={`od-panel od-desk${deskLeads ? ' is-lead' : ''}`}>
            <div className="od-panel-head">
              <h3 className="od-panel-title">
                <ShieldCheck size={15} aria-hidden="true" /> Order desk
              </h3>
              <div className="od-panel-aside">
                <StatusBadge status={order.status} />
              </div>
            </div>

            <div className="od-desk-row">
              {staffActions.ownOrderNote && (
                <p className="od-desk-note">
                  This is your own order. It moves along the customer path — confirming or
                  advancing it needs someone else, or the &quot;Confirm own orders&quot; permission.
                </p>
              )}

              {/* Confirming an out-of-band payment.
                  This is the whole of what the Zelle and cash-in-mail rails are:
                  money arrives where the store cannot see it, and a human who has
                  seen it says so. */}
              {staffActions.confirm && (
                <button
                  type="button"
                  className="glass-btn glass-btn-success is-lead"
                  onClick={() => setAsk(ask === 'pay' ? null : 'pay')}
                >
                  <CheckCircle size={15} aria-hidden="true" /> Mark paid
                </button>
              )}
              {staffActions.accept && (
                <button type="button" className="glass-btn glass-btn-primary is-lead" onClick={() => adminUpdateStatus('accepted')}>
                  <ArrowRight size={15} aria-hidden="true" /> Accept order
                </button>
              )}
              {staffActions.ship && (
                <button type="button" className="glass-btn glass-btn-primary is-lead" onClick={() => adminUpdateStatus('shipped')}>
                  <Truck size={15} aria-hidden="true" /> Mark shipped
                </button>
              )}
              {/* Disputed: the two settlements answer to different grants —
                  closing is a status move, refunding is a money move — so they
                  render independently rather than as a pair, and only the
                  status move is routine. */}
              {staffActions.closeDelivered && (
                <button type="button" className="glass-btn glass-btn-success is-lead" onClick={() => adminUpdateStatus('delivered')}>
                  <CheckCircle size={15} aria-hidden="true" /> Close as delivered
                </button>
              )}

              {/* Into the fulfilment screens. Links, not actions: the bench and
                  the desk own their own claim and dispatch rules, and duplicating
                  either here would be a second author for the same decision. */}
              {staffActions.packHere && (
                <Link
                  to={`/admin/pack/${order.id}`}
                  className="glass-btn glass-btn-sm"
                  title="Open this order on the packing bench — claim it there, then record picks and boxes"
                >
                  <PackageCheck size={14} aria-hidden="true" /> Pack bench
                </Link>
              )}
              {staffActions.shipDesk && (
                <Link
                  to="/admin/ship"
                  className="glass-btn glass-btn-sm"
                  title="Dispatch this order's boxes from the Ship desk, with per-box tracking"
                >
                  <Send size={14} aria-hidden="true" /> Ship desk
                </Link>
              )}

              {(staffActions.denyRefund || staffActions.offerRefund || staffActions.cancel) && (
                <div className="od-desk-danger">
                  {staffActions.denyRefund && (
                    <button
                      type="button"
                      className="glass-btn glass-btn-danger glass-btn-sm"
                      onClick={() => setAsk(ask === 'deny' ? null : 'deny')}
                    >
                      <XCircle size={14} aria-hidden="true" /> Deny &amp; refund
                    </button>
                  )}
                  {staffActions.offerRefund && (
                    <button
                      type="button"
                      className="glass-btn glass-btn-danger glass-btn-sm"
                      onClick={() => {
                        setRefundDraft(order.total == null ? '' : Number(order.total).toFixed(2));
                        setAsk(ask === 'refund' ? null : 'refund');
                      }}
                    >
                      <DollarSign size={14} aria-hidden="true" /> Offer refund
                    </button>
                  )}
                  {staffActions.cancel && (
                    <button
                      type="button"
                      className="glass-btn glass-btn-danger glass-btn-sm"
                      onClick={() => setAsk(ask === 'cancel' ? null : 'cancel')}
                      disabled={cancelling}
                    >
                      <Ban size={14} aria-hidden="true" /> Cancel order
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* ── The confirms ──
                Every one of these went through `window.confirm()`, and the
                refund amount through `window.prompt()`: a dialog that cannot
                show the order's total, cannot validate the number, is
                suppressible by the browser, and hands back a string. On a page
                whose subject is money that is not a confirmation, it is a guess
                with an OK button. */}
            {ask === 'pay' && staffActions.confirm && (
              <div className="od-confirm is-success">
                <p className="od-confirm-lede">
                  <ShieldCheck size={14} aria-hidden="true" />
                  <span>
                    Confirm that {isZelle ? 'the transfer' : 'the cash'} for{' '}
                    <strong>{order.total == null ? 'this order' : money(order.total)}</strong>{' '}
                    has actually arrived. This releases the order for fulfilment and pays any
                    referral reward — it cannot be undone from here.
                  </span>
                </p>

                {isZelle && (
                  <div className="od-field">
                    <label htmlFor="od-sender">
                      Name on the transfer <span className="field-opt">(optional)</span>
                    </label>
                    <input
                      id="od-sender"
                      className="glass-input"
                      value={senderName}
                      placeholder={order.zelle_reference ? `Reference ${order.zelle_reference}` : 'Sender name'}
                      onChange={(e) => setSenderName(e.target.value)}
                    />
                  </div>
                )}

                <div className="od-confirm-actions">
                  <button
                    type="button"
                    className="glass-btn glass-btn-success glass-btn-sm"
                    onClick={async () => {
                      await adminUpdateStatus('paid', senderName.trim() ? { sender_name: senderName.trim() } : {});
                      setSenderName('');
                    }}
                  >
                    <CheckCircle size={14} aria-hidden="true" /> Yes, the money is here
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => setAsk(null)}>
                    Not yet
                  </button>
                </div>
              </div>
            )}

            {ask === 'deny' && staffActions.denyRefund && (
              <div className="od-confirm">
                <p className="od-confirm-lede">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>
                    Refuse this order and return the whole{' '}
                    <strong>{order.total == null ? 'amount' : money(order.total)}</strong>. The
                    stock goes back on the shelf and any coupon and store credit it used are
                    restored to the buyer.
                  </span>
                </p>
                <div className="od-confirm-actions">
                  <button type="button" className="glass-btn glass-btn-danger glass-btn-sm" onClick={() => adminUpdateStatus('refunded')}>
                    <XCircle size={14} aria-hidden="true" /> Deny and refund in full
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => setAsk(null)}>Keep it</button>
                </div>
              </div>
            )}

            {ask === 'refund' && staffActions.offerRefund && (
              <div className="od-confirm is-warn">
                <p className="od-confirm-lede">
                  <DollarSign size={14} aria-hidden="true" />
                  <span>
                    Settle this dispute with a refund. The most this order can return is{' '}
                    <strong>{order.total == null ? 'its total' : money(order.total)}</strong> —
                    the money the buyer actually paid.
                  </span>
                </p>
                <div className="od-field">
                  <label htmlFor="od-refund-amt">Amount to refund</label>
                  <input
                    id="od-refund-amt"
                    className="glass-input is-money"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    max={order.total ?? undefined}
                    step="0.01"
                    value={refundDraft}
                    onChange={(e) => setRefundDraft(e.target.value)}
                  />
                </div>
                <div className="od-confirm-actions">
                  <button type="button" className="glass-btn glass-btn-danger glass-btn-sm" onClick={submitRefund}>
                    <DollarSign size={14} aria-hidden="true" /> Refund this amount
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => setAsk(null)}>Cancel</button>
                </div>
              </div>
            )}

            {ask === 'cancel' && staffActions.cancel && (
              <div className="od-confirm">
                <p className="od-confirm-lede">
                  <AlertTriangle size={14} aria-hidden="true" />
                  <span>
                    Cancel this order on the buyer&apos;s behalf. Stock returns to the shelf and
                    any coupon and store credit it used go back to them. There is no way to
                    un-cancel it.
                  </span>
                </p>
                <div className="od-confirm-actions">
                  <button type="button" className="glass-btn glass-btn-danger glass-btn-sm" onClick={cancelOrder} disabled={cancelling}>
                    <XCircle size={14} aria-hidden="true" /> {cancelling ? 'Cancelling…' : 'Cancel the order'}
                  </button>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => setAsk(null)} disabled={cancelling}>
                    Leave it alone
                  </button>
                </div>
              </div>
            )}

            {/* Paying out a refund that has already been agreed. */}
            {staffActions.refundDesk && (
              <div className="od-confirm is-warn">
                <p className="od-confirm-lede">
                  <DollarSign size={14} aria-hidden="true" />
                  <span>Owed to the buyer: <strong>{money(order.refund_amount || order.total)}</strong></span>
                </p>
                {order.refund_address ? (
                  <>
                    <CopyField label="Paying out to" value={order.refund_address} />
                    {order.refund_txid ? (
                      <>
                        <Note tone="success" icon={CheckCircle}>
                          Sent — {shortHash(order.refund_txid)}
                        </Note>
                        <CopyField label="Refund transaction" value={order.refund_txid} what="Transaction id copied" />
                      </>
                    ) : (
                      <>
                        {/* The store wallet pays. Drawn only for a viewer who
                            holds BOTH grants the server checks, and only on a
                            coin the wallet holds — on a cash or bank order the
                            quote could only ever explain why it cannot send,
                            and a button whose one outcome is an explanation is
                            a dead button. The manual field below stays for a
                            payout made from another wallet, and is where the
                            txid goes if the send lands but the record fails. */}
                        {can.sendFunds && cryptoNames[order.payment_method] && (
                          <WalletRefund
                            orderRef={id}
                            onSent={(txid, { unrecorded } = {}) => {
                              if (unrecorded) setRefundTxid(txid);
                              else fetchOrder();
                            }}
                          />
                        )}
                        {/* Under a rule when the wallet block is above it, so
                            the two doors read as two; bare when it is the only
                            one, as it always was. */}
                        <div className={`od-parcel-add${can.sendFunds && cryptoNames[order.payment_method] ? '' : ' is-bare'}`}>
                          <div className="od-field is-grow">
                            <label htmlFor="od-refund-txid">
                              {can.sendFunds && cryptoNames[order.payment_method]
                                ? 'Or record a payout made from another wallet'
                                : 'Transaction id, as proof'}
                            </label>
                            <input
                              id="od-refund-txid"
                              type="text"
                              className="glass-input"
                              value={refundTxid}
                              onChange={e => setRefundTxid(e.target.value)}
                              placeholder="Hash of the payout"
                            />
                          </div>
                          <button
                            type="button"
                            className="glass-btn glass-btn-success glass-btn-sm"
                            onClick={markRefundSent}
                            disabled={sendingRefund}
                          >
                            <CheckCircle size={13} aria-hidden="true" /> {sendingRefund ? 'Saving…' : 'Mark sent'}
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <p className="od-panel-note">
                    Waiting for the buyer to give an address to pay it to.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {/* ── The payment, as a record ── */}
        {showPaymentRecord && (
          <section className="od-panel" id="payment">
            <div className="od-panel-head">
              <h3 className="od-panel-title"><CreditCard size={15} aria-hidden="true" /> Payment</h3>
              {payment?.confirmed && (
                <div className="od-panel-aside"><span className="badge badge-success">Confirmed</span></div>
              )}
            </div>

            {isCrypto && payment && (
              <>
                {testnetNote}
                <dl className="od-kv">
                  <div className="od-kv-row">
                    <dt>Rail</dt>
                    <dd>{cryptoNames[payment.crypto_type] || payment.crypto_type.toUpperCase()}</dd>
                  </div>
                  {payment.amount_crypto && (
                    <div className="od-kv-row is-num">
                      <dt>Asked for</dt>
                      <dd>{payment.amount_crypto} {payment.crypto_type.toUpperCase()}</dd>
                    </div>
                  )}
                  {totalReceived > 0 && (
                    <div className="od-kv-row is-num">
                      <dt>Arrived</dt>
                      <dd>{totalReceived} {payment.crypto_type.toUpperCase()}</dd>
                    </div>
                  )}
                  {confirmedReceived > 0 && (
                    <div className="od-kv-row is-num is-good">
                      <dt>Settled</dt>
                      <dd>{confirmedReceived} {payment.crypto_type.toUpperCase()}</dd>
                    </div>
                  )}
                </dl>
                <PaymentLedger
                  transactions={transactions}
                  payment={payment}
                  requiredAmount={requiredNum}
                  cryptoType={payment.crypto_type}
                  requiredConfirmations={reqConfs}
                />
              </>
            )}

            {/* A staff viewer whose role redacts the payment away entirely used
                to get this card as an empty shell — a heading over nothing,
                which reads as broken rather than withheld. Say which it is.
                Keyed on the capability, not the role: a full-payment viewer
                looking at an order that simply has no payment row must not be
                told their role hid something. */}
            {isAdmin && !isOwner && isCrypto && !payment && !can.seePayment && (
              <p className="od-panel-note">Payment details are hidden for your role.</p>
            )}

            {isZelle && zelleBody}
            {isCashMail && cashMailBody}
          </section>
        )}

        {/* Items, each with the review it is owed. See OrderItemsCard — the
            old card was a read-only list, which is why reviewing an item meant
            leaving the order and hunting through the product page.

            It reads its own box width with a container query
            (66-order-line-actions.css), so moving it out of the 300px rail is
            all that was needed for it to lay out as a full-width line-item
            list rather than a stack of wrapped two-line tiles. */}
        <div id="order-items">
          <OrderItemsCard
            order={order}
            isOwner={isOwner}
            mediaEnabled={settings?.review_media_enabled === 'true'}
            onReload={fetchOrder}
          />
        </div>

        </div>

        {/* ── Rail: where it goes, and what carries it ── */}
        <aside className="od-rail">

          {/* Ship to.
              Visibility is the server's call, not this component's: redactOrder
              nulls the field unless the viewer owns the order, is an admin, or
              holds `orders.view_shipping`, and names what it withheld in
              `redacted_fields`. That list is what separates "you may not see
              this" from "the buyer never gave one" — two nulls that mean
              opposite things to someone trying to pack a box. */}
          {(shippingAddress || shippingHidden || isAdmin || canEditAddress) && (
            <section className="od-panel">
              <div className="od-panel-head">
                <h3 className="od-panel-title"><MapPin size={15} aria-hidden="true" /> Ship to</h3>
                {canEditAddress && !editingAddress && (
                  <div className="od-panel-aside">
                    <button
                      type="button"
                      className="glass-btn glass-btn-sm"
                      onClick={() => { setAddressDraft(shippingAddress); setNotesDraft(orderNotes); setEditingAddress(true); }}
                    >
                      <Pencil size={12} aria-hidden="true" /> {shippingAddress ? 'Edit' : 'Add'}
                    </button>
                  </div>
                )}
              </div>

              {editingAddress ? (
                <>
                  <div className="od-field">
                    <label htmlFor="od-address">Address</label>
                    <textarea
                      id="od-address"
                      className="glass-input is-address"
                      value={addressDraft}
                      onChange={(e) => setAddressDraft(e.target.value)}
                      placeholder={'JANE DOE\n1234 N MAIN ST APT 101\nLOS ANGELES CA 90001'}
                      rows={4}
                      maxLength={500}
                    />
                  </div>

                  <div className="od-field is-spaced">
                    <label htmlFor="od-notes">
                      Notes <span className="field-opt">(optional)</span>
                    </label>
                    <textarea
                      id="od-notes"
                      className="glass-input"
                      value={notesDraft}
                      onChange={(e) => setNotesDraft(e.target.value)}
                      placeholder="Anything the packer should know."
                      rows={2}
                      maxLength={1000}
                    />
                  </div>

                  <div className="od-field-actions">
                    <button
                      type="button"
                      onClick={saveShippingDetails}
                      disabled={savingAddress || !addressDraft.trim()}
                      className="glass-btn glass-btn-primary glass-btn-sm is-grow"
                    >
                      {savingAddress ? <span className="spinner spinner-inline" /> : <Send size={12} aria-hidden="true" />}
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingAddress(false)}
                      disabled={savingAddress}
                      className="glass-btn glass-btn-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : shippingAddress && addressState.encryption ? (
                <>
                  {/* An encrypted address is not something to render as text
                      and hope somebody notices the armor headers. It gets its
                      own panel, which says which kind of encryption this is,
                      whether the store can open it, and offers the audited
                      decrypt when it can. */}
                  <EncryptedAddress
                    orderId={order.uuid || order.id}
                    state={addressState}
                    canDecrypt={addressState.can_decrypt}
                    armored={shippingAddress}
                    isOwner={isOwner}
                  />
                  {orderNotes && <NotesField notes={orderNotes} orderRef={order.uuid || order.id} />}
                </>
              ) : shippingAddress ? (
                <>
                  <CopyField value={shippingAddress} what="Address copied" />
                  {orderNotes && <NotesField notes={orderNotes} orderRef={order.uuid || order.id} />}
                </>
              ) : shippingHidden ? (
                <p className="od-withheld">
                  Withheld — your role does not include shipping details.
                </p>
              ) : (
                <Note tone="warn">This order was placed without a shipping address.</Note>
              )}

              {/* Say when the window closes, so "I'll fix it later" is an
                  informed choice rather than a surprise at `accepted`. */}
              {canEditAddress && !editingAddress && (
                <p className="od-panel-note">
                  You can change this until the order is accepted for shipping.
                </p>
              )}
            </section>
          )}

          {/* Parcel tracking — visible to the buyer once added, managed by
              staff from accepted onwards. */}
          {(order.tracking_numbers?.length > 0 || (isAdmin && can.manageTracking && ['accepted', 'shipped', 'delivered'].includes(order.status))) && (
            <section className="od-panel">
              <div className="od-panel-head">
                <h3 className="od-panel-title"><Truck size={15} aria-hidden="true" /> Parcel tracking</h3>
                {order.tracking_numbers?.length > 0 && (
                  <div className="od-panel-aside">
                    <span className="badge badge-muted">{order.tracking_numbers.length}</span>
                  </div>
                )}
              </div>

              {order.tracking_numbers?.length > 0 ? (
                <ul className="od-parcels">
                  {order.tracking_numbers.map((tn) => (
                    <li key={tn.id} className="od-parcel">
                      <div className="od-parcel-text">
                        <div className="od-parcel-no">{tn.tracking_number}</div>
                        <div className="od-parcel-meta">
                          {tn.carrier && `${tn.carrier} · `}
                          <time dateTime={tn.created_at} title={fmtStamp(tn.created_at)}>
                            {fmtDay(tn.created_at)}
                          </time>
                          {isAdmin && tn.added_by_username && ` · ${tn.added_by_username}`}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="od-copy-btn"
                        onClick={() => copyValue(tn.tracking_number, 'Tracking number copied')}
                        title="Copy this number"
                        aria-label={`Copy tracking number ${tn.tracking_number}`}
                      >
                        <Copy size={13} aria-hidden="true" />
                      </button>
                      {isAdmin && can.manageTracking && (
                        <button
                          type="button"
                          className="od-parcel-drop"
                          onClick={() => removeTrackingNumber(tn.id)}
                          title="Remove this tracking number"
                          aria-label={`Remove tracking number ${tn.tracking_number}`}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      )}
                      {/* What the carrier last said — the store's worker asks
                          on its own clock and this draws what it stored, with
                          the time it stored it. No refresh control, by design:
                          see components/order/ParcelStatus. Absent entirely
                          when the store has never looked (tracking off). */}
                      {tn.tracking && (tn.tracking.tracked || tn.tracking.done_reason) && (
                        <div className="od-parcel-status" id={`parcel-${tn.id}`}>
                          <ParcelCard tracking={tn.tracking} defaultOpen={false} />
                          {isStaffViewer && can.manageTracking && tn.tracking.attention && <button type="button" className="glass-btn glass-btn-sm" onClick={async (e) => {
                            const button = e.currentTarget; button.disabled = true;
                            try { await api.post(`/orders/${order.uuid}/parcels/${tn.id}/resolve-attention`, { observed_at: tn.tracking.last_change_at || tn.tracking.checked_at }); await fetchOrder(); toast.success('Parcel problem resolved'); }
                            catch (err) { toast.error(err.message); } finally { button.disabled = false; }
                          }}>Mark parcel problem resolved</button>}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                !isAdmin && <p className="od-withheld">Nothing has been dispatched yet.</p>
              )}

              {/* Adding one — only while the order is at a stage where a parcel
                  exists to track, and only for holders of the write grant; the
                  form 403'd for everyone else. */}
              {isAdmin && can.manageTracking && ['accepted', 'shipped'].includes(order.status) && (
                <div className="od-parcel-add">
                  <div className="od-field is-grow">
                    <label htmlFor="od-tn">Tracking number</label>
                    <input
                      id="od-tn"
                      type="text"
                      className="glass-input"
                      value={newTrackingNumber}
                      onChange={(e) => setNewTrackingNumber(e.target.value)}
                      placeholder="As printed on the label"
                    />
                  </div>
                  <div className="od-field">
                    <label htmlFor="od-carrier">Carrier</label>
                    <input
                      id="od-carrier"
                      type="text"
                      className="glass-input"
                      value={newTrackingCarrier}
                      onChange={(e) => setNewTrackingCarrier(e.target.value)}
                      placeholder="USPS, UPS…"
                    />
                  </div>
                  <button
                    type="button"
                    className="glass-btn glass-btn-primary glass-btn-sm"
                    onClick={addTrackingNumber}
                    disabled={addingTracking}
                  >
                    <Send size={12} aria-hidden="true" /> Add
                  </button>
                </div>
              )}
            </section>
          )}

        </aside>
      </div>

      {/* ── Boxes: how the order physically shipped, when boxes were recorded ── */}
      <div id="order-parcels">
        <OrderBoxesCard order={order} isAdmin={isAdmin} />
      </div>

      {/* ── Disputes ──
          DESIGN §6, answered: cards, and not a toggle. Every row carries a
          paragraph of the buyer's own words and often a paragraph of the
          store's reply, and prose does not go in a column. */}
      {order.disputes?.length > 0 && (
        <section className={`od-panel is-apart${liveDisputes.length > 0 ? ' is-danger' : ''}`}>
          <div className="od-panel-head">
            <h3 className="od-panel-title">
              <AlertTriangle size={15} aria-hidden="true" />
              {liveDisputes.length > 0 ? 'Open dispute' : 'Dispute history'}
            </h3>
            <div className="od-panel-aside">
              <span className="badge badge-muted">{order.disputes.length}</span>
            </div>
          </div>
          <ul className="od-disputes">
            {order.disputes.map(d => {
              const live = ['open', 'in_review'].includes(d.status);
              return (
                <li key={d.id} className={`od-dispute${live ? '' : ' is-closed'}`}>
                  <div className="od-dispute-head">
                    {/* `in_review` is still an active claim, not a settled one —
                        painting it success-green alongside `resolved` told the
                        buyer their dispute was finished while staff were still
                        working it. */}
                    <span className={`badge ${live ? 'badge-danger' : 'badge-success'}`}>
                      {d.status.replace(/_/g, ' ')}
                    </span>
                    <time className="od-dispute-when" dateTime={d.created_at} title={fmtStamp(d.created_at)}>
                      {fmtDate(d.created_at)}
                    </time>
                  </div>
                  <p className="od-dispute-body">{d.reason}</p>
                  {/* Where the photographs go. The dispute's conversation is
                      a support ticket, and the ticket page is the one place
                      a buyer can attach a file to what they say — the reason
                      the two were merged. A buyer told "it arrived damaged?
                      open a dispute" and then given nowhere to put the photo
                      was the gap this link closes. Gated on the ticket
                      existing: a dispute from before the merge has none. */}
                  {d.ticket_id && (
                    <Link className="od-dispute-ticket" to={`/support/${d.ticket_id}`}>
                      <LifeBuoy size={13} aria-hidden="true" />
                      {live ? 'Add photos or a message on the dispute thread' : 'Read the dispute thread'}
                    </Link>
                  )}
                  {d.admin_response && (
                    <div className="od-dispute-reply">
                      <strong>The store replied:</strong> {d.admin_response}
                    </div>
                  )}
                  {d.refund_amount && (
                    <div className="od-dispute-offer">Refund offered: {money(d.refund_amount)}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {order.support_resolutions?.length > 0 && <section className="glass-card flow-stack"><h2>Support resolutions</h2><ul className="flow-list">{order.support_resolutions.map(r => <li key={r.id}><div><strong>{r.body}</strong><p>{new Date(r.created_at).toLocaleString()}</p></div><Link className="glass-btn glass-btn-sm" to={`/support/${r.ticket_id}`}>Ticket #{r.ticket_id}</Link></li>)}</ul></section>}
      {/* ── Where this goes next ──
          DESIGN §9: audit the dead ends. Before this strip the page's only
          outbound path for a buyer was the breadcrumb, and the printable
          receipt at /orders/:uuid/receipt was reachable from nowhere in the
          application at all. */}
      {ways.length > 0 && (
        <nav className="od-ways" aria-label="Related pages">
          <span className="od-ways-lede">From here</span>
          {ways.map(w => (
            <Link key={w.to} to={w.to} className="od-way">
              <w.icon size={14} aria-hidden="true" /> {w.label}
            </Link>
          ))}
        </nav>
      )}

      {qrOpen && isCrypto && (
        <QrLightbox uri={qrUri} address={payAddress} onClose={() => setQrOpen(false)} />
      )}

      {/* One summary sheet for the page. Rendered last so it sits above the
          panels it reports on, and unmounted entirely when there is no result
          rather than left in the DOM hidden. */}
      <ReorderSummary result={reorderResult} onClose={() => setReorderResult(null)} />
    </div>
  );
}
