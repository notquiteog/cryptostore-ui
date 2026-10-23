import FieldError from '../components/checkout/FieldError';
import useCartQuote from '../hooks/useCartQuote';
// The placed order's payment panel, rendered inside this page once an order
// exists. A real dependency, unlike the two helper imports that used to sit
// beside it — but a static one pinned the whole order page into the entry
// chunk, because Checkout ships there to keep the shopping path free of round
// trips (see App.jsx). Rolldown said so out loud: INEFFECTIVE_DYNAMIC_IMPORT,
// declared lazy in the router and not actually splittable.
//
// Split, then PRELOADED on mount (below). The buyer spends a while choosing a
// payment method and typing an address; the chunk arrives during that, so by
// the time they press Place order it is already in memory. Waiting for a
// network round trip at the moment somebody has just paid is exactly the thing
// docs/AI.md §9 rule 1 is about, and it applies to bytes as much as to badges.
const OrderDetail = lazy(() => import('./OrderDetail'));
import { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { api } from '../utils/api';
import RouteFallback from '../components/RouteFallback';
import { fmtDayRange } from '../utils/shipping';
import { shippingCostFor } from '../utils/shipping';
import { checkArmorShape } from '../utils/armor';
import { parseDepthPolicy, depthFor, settleWindowMinutes, formatWindow } from '../utils/confirmationDepth';
import { parseRailPolicy, railAdjustment, railLabel } from '../utils/railAdjust';
import { encryptTo, preloadPgp } from '../utils/pgpClient';
import {
  loadPrefs, savePrefs, loadAttempt, saveAttempt, clearAttempt,
  stashAddress, unstashAddress, forgetAddress,
} from '../utils/checkoutRecovery';
import { playSound } from '../utils/sounds';
import toast from 'react-hot-toast';
import CheckoutSteps from '../components/CheckoutSteps';
import { pausedMessage, storePaused } from '../components/StorePausedBar';
import ReceiptPrinter from '../components/ReceiptPrinter';
import StoreCreditMeter from '../components/checkout/StoreCreditMeter';
import StoreKeyCard from '../components/checkout/StoreKeyCard';
import {
  CreditCard, Truck, Tag, AlertTriangle, Check, Package,
  ShieldCheck, Info, Lock, MapPin, ArrowLeft, Banknote, Landmark,
  FlaskConical, PackageX, LifeBuoy, Receipt, Hourglass, Gift, Search, KeyRound, Globe,
  ArrowRight, History, PauseCircle,
} from 'lucide-react';

const money = (n) => `$${Number(n).toFixed(2)}`;

/**
 * The line under a field that cannot be accepted.
 *
 * Validation used to answer with a toast — "Please select a payment method"
 * — that faded before the eye found the field it meant, on a form with
 * fifteen fields. The message now sits under the field, the field is
 * marked, and the first one takes focus (see `focusFirstInvalid`).
 */

/** "3 minutes ago", for the recovered-order and stashed-address notes. */
function agoText(stamp) {
  const ms = Date.now() - new Date(stamp).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 2) return 'a moment ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `${Math.floor(hours / 24)} day${hours >= 48 ? 's' : ''} ago`;
}

/** "1–2 days" / "within a day" / "2–4 weeks", from a {lo, hi} in days. */
/**
 * The mark a payment tile wears.
 *
 * Two kinds, deliberately. `glyph` is the currency's own sign — ₿, ɱ, Ł are
 * typography, set in the theme's faces like any other character, and no icon
 * set has a better mark for a coin than the coin's own. `Icon` is a real
 * lucide glyph for everything that is not a currency.
 *
 * What is gone is the third kind: 💵, 🏦 and 🧪 were emoji, which DESIGN §1
 * rules out as iconography — and on top of the house rule they are the one
 * "icon" on the page whose shape the store does not control. They are drawn by
 * whatever emoji font the buyer's OS ships, at a size and colour the theme
 * cannot touch, in full colour beside three monochrome currency signs; and on
 * a hardened Linux box with no colour-emoji font installed they render as
 * tofu boxes. A storefront that must work on a filtered network has no
 * business rendering its payment options in a font it did not ship.
 */
const PM_MARKS = {
  btc: { glyph: '₿' },
  xmr: { glyph: 'ɱ' },
  ltc: { glyph: 'Ł' },
  cash_in_mail: { Icon: Banknote },
  zelle: { Icon: Landmark },
  demo: { Icon: FlaskConical },
};

/**
 * What each rail costs the buyer, in three lines: how long until the store
 * acts on the money, whether it can be pulled back, and what trace it leaves.
 *
 * The chips used to be five equal tiles that said "BTC", "XMR", "By post" —
 * and nothing on the page said that Monero at depth 20 is forty minutes of
 * waiting, that Zelle is minutes but puts a legal name in a bank's records,
 * or that cash in the mail is days. Those are the facts a buyer choosing a
 * rail is actually choosing between.
 *
 * Timing for the coins is DERIVED from the store's confirmation-depth policy
 * (`payment_confirmation_depth`, public) and the chain's block interval, for
 * the order's own total — a store that drops xmr to depth 5 shows "about
 * 10 minutes", not the shipped default. Reversibility and record-keeping are
 * properties of the rail itself and do not move.
 */
function railFacts(pm, { policy, total }) {
  const coin = ['btc', 'ltc', 'xmr'].includes(pm.value) ? pm.value : null;
  if (coin) {
    const depth = depthFor(policy, coin, total);
    const win = settleWindowMinutes(coin, depth);
    return {
      settles: `${formatWindow(win)} · ${depth} block${depth === 1 ? '' : 's'}`,
      reversible: 'No — final once confirmed',
      record: coin === 'xmr'
        ? 'A private chain: amounts and parties hidden'
        : 'A public chain: the address, not your name',
    };
  }
  if (pm.value === 'cash_in_mail') {
    return {
      settles: 'Days — when the envelope arrives and is counted',
      reversible: 'No — cash in transit is yours to lose',
      record: 'None, unless you add postal tracking',
    };
  }
  if (pm.value === 'zelle') {
    return {
      settles: 'Minutes — once staff confirm the transfer',
      reversible: 'No — Zelle transfers are final',
      record: 'Your legal name and bank, at both banks',
    };
  }
  if (pm.value === 'demo') {
    return {
      settles: 'Seconds — it confirms itself',
      reversible: 'Nothing moves',
      record: 'Nothing — no money changes hands',
    };
  }
  return null;
}

/**
 * A fresh idempotency key for one checkout attempt.
 *
 * The server has accepted `idempotency_key` since 20260516000000, but the key
 * is OPTIONAL there and the server cannot mint one for you — it identifies an
 * attempt, so only the thing that owns the attempt can. Every checkout path
 * therefore has to mint its own, and until this file did, a double-tapped
 * button placed two real orders that had to be unwound by hand: stock re-added,
 * store credit refunded, coupon use released, sub-user reward clawed back.
 * This is the web path's half; the bots' half is whatever their callers pass to
 * `createBotOrder`'s `idempotencyKey` option, and at the time of writing they
 * passed nothing.
 *
 * Spelled out because the comment that used to sit here said the bots "have
 * always sent one" — false, and backwards: the web path was the one that had
 * just been fixed. A comment claiming a path is protected when it is not is how
 * the unprotected path survives review.
 *
 * `crypto.randomUUID()` is deliberately NOT used. It is restricted to secure
 * contexts, and a store reached over a plain-HTTP .onion is not one — it would
 * be `undefined` on exactly the deployment this project exists for, and the
 * TypeError would take the whole checkout down rather than the key being
 * missing. `getRandomValues` carries no such restriction. The last resort is
 * only reached in a browser with no Web Crypto at all; a weak key is still a
 * unique-per-attempt key, and this value is not a secret — it is scoped to the
 * account by the (user_id, idempotency_key) index, so guessing one buys an
 * attacker nothing.
 *
 * Shape matches `chk_orders_idempotency_key_shape`: [A-Za-z0-9_.:-]{8,128}.
 */
function newIdempotencyKey() {
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return `web-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/* Pairs a product with its variant into one lookup key. The unit separator
   cannot occur in either name, so no pair of names can collide by running
   together the way a space or a dash would let them. */
const lineKey = (product, variant) => `${product}\u001f${variant}`;

/**
 * The receipt's line items, preferring the lines the order was written with.
 *
 * The cart is the fallback rather than the source: it carries an image and an
 * id that make a nicer list, but its prices are a preview, and a receipt whose
 * lines do not add up to its own subtotal is worse than one without thumbnails.
 */
function linesOf(data, cartItems) {
  const lines = Array.isArray(data?.items) ? data.items : [];
  if (lines.length === 0) return cartItems.map(i => ({ ...i }));

  // The thumbnail is the one thing the cart has that the order row does not,
  // and the summary panel above the receipt is still showing it. Matched on
  // name rather than position: the two lists are built by different queries
  // and nothing guarantees they come back in the same order.
  const art = new Map(cartItems.map(i => [lineKey(i.product_name, i.variant_name), i.image]));

  return lines.map((l, idx) => ({
    id: `line-${idx}`,
    product_name: l.product_name,
    variant_name: l.variant_name,
    quantity: Number(l.quantity),
    price: Number(l.price_at_purchase),
    image: art.get(lineKey(l.product_name, l.variant_name)) || null,
  }));
}

/**
 * The money lines of a created order, read back off the row that was written.
 *
 * Postgres hands NUMERIC columns over as strings, and the row stores the
 * coupon and the store credit added together in `discount_amount` with the
 * credit also broken out on its own — so the coupon's share is the difference.
 * `fallback` covers a server that answered without the money columns; every
 * field is taken or left as a group so the four figures can never come from
 * two different sources and stop adding up.
 */
function ledgerOf(order, fallback) {
  const num = (v) => (v == null ? null : Number(v));
  const total = num(order?.total);
  const shipping = num(order?.shipping_cost);
  const discount = num(order?.discount_amount);
  const credit = num(order?.store_credit_applied);
  if ([total, shipping, discount, credit].some((v) => v == null || Number.isNaN(v))) {
    return fallback;
  }
  const rail = num(order?.rail_adjustment) || 0;
  return {
    subtotal: total + discount - shipping - rail,
    shipping,
    rail,
    couponDiscount: Math.max(0, discount - credit),
    creditApplied: credit,
    total,
  };
}

export default function Checkout() {
  const { items, total, hydrated, fetchCart } = useCart();
  const { user } = useAuth();
  const { settings } = useTheme();
  const navigate = useNavigate();

  const [paymentMethod, setPaymentMethodState] = useState('');
  const [addrFields, setAddrFields] = useState({ name: '', company: '', street: '', city: '', state: '', zip: '', country: '' });
  // The address lookup (E1): whether the store offers one, and in what
  // mode, is the SERVER's answer — see config/geocodeKeys for why the mode
  // is a property of the provider and never hard-coded here.
  const [lookup, setLookup] = useState(null);
  const [finding, setFinding] = useState(false);
  const [lookupQ, setLookupQ] = useState('');
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupHits, setLookupHits] = useState(null);
  // Seal in the browser (B4b): the address is encrypted here, to the store
  // key and the buyer's own, and the store receives only the block.
  const [storeKey, setStoreKey] = useState(null);
  const [sealInBrowser, setSealInBrowser] = useState(false);
  const [sealed, setSealed] = useState(null);      // { armored, fingerprints, plain }
  const [sealPhase, setSealPhase] = useState(null); // 'working' | 'sealing' | 'sealed'
  // 'form' — the six fields below; 'pgp' — a block the buyer encrypted in
  // their own client, which the store stores verbatim and cannot read.
  const [addrMode, setAddrMode] = useState('form');
  const [pgpAddress, setPgpAddress] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [couponCode, setCouponCode] = useState('');
  const [voucherCode, setVoucherCode] = useState('');
  const [appliedVoucher, setAppliedVoucher] = useState('');
  const voucherNeedsReview = voucherCode.trim() !== appliedVoucher;
  const [couponResult, setCouponResult] = useState(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [useStoreCredit, setUseStoreCredit] = useState(false);
  // Whether the operator allows credit to be spent at all. Assume yes until the
  // balance call says otherwise, so a slow request never hides a usable toggle.
  const [creditEnabled, setCreditEnabled] = useState(true);
  const [storeCredit, setStoreCredit] = useState(0);

  // Which fields cannot be accepted, keyed by the field's element id so the
  // first one can be focused. Empty until a submit is refused.
  const [fieldErrors, setFieldErrors] = useState({});
  const clearError = (id) => setFieldErrors((prev) => {
    if (!(id in prev)) return prev;
    const { [id]: _gone, ...rest } = prev;
    return rest;
  });

  // Choosing a rail is what clears its own error line.
  const setPaymentMethod = (value) => { setPaymentMethodState(value); clearError('ck-payment'); };

  const setAddr = (field) => (e) => {
    setAddrFields(prev => ({ ...prev, [field]: e.target.value }));
    clearError(`ck-${field}`);
  };

  /**
   * Does this shop want to know where the parcel goes?
   *
   * `require_shipping_address` (server: utils/shippingAddress.js). Off, the
   * whole of step 02's address half is not drawn and nothing is sent: a shop
   * selling something that does not ship has no use for six identity fields,
   * and an "optional" address form still collects an address from everyone who
   * fills one in out of habit. The cheapest way to protect the most damaging
   * column in the schema is not to hold it.
   *
   * `!== 'false'` and not `=== 'true'`, matching every other default-on switch
   * on this page: an unset row, a blank one, or a settings payload that has not
   * landed yet behaves as the store behaved before the switch had teeth.
   */
  const wantsAddress = settings.require_shipping_address !== 'false';

  // The six fields, assembled into the one block of text the order carries.
  const formAddress = [
    addrFields.name.trim(),
    addrFields.company.trim(),
    addrFields.street.trim(),
    [addrFields.city.trim(), addrFields.state.trim(), addrFields.zip.trim()].filter(Boolean).join(' '),
    addrFields.country.trim().toUpperCase(),
  ].filter(Boolean).join('\n');

  /**
   * Whichever address is actually being sent.
   *
   * A buyer may paste a block they encrypted themselves instead of filling in
   * the form. The server detects an armored block and stores it as-is rather
   * than wrapping it again — see services/addressCrypto.js — so the two modes
   * are genuinely alternatives, not layers.
   */
  const builtAddress = !wantsAddress ? '' : (addrMode === 'pgp' ? pgpAddress.trim() : formAddress);
  // The same shape check the server runs at the order door (utils/armor on
  // both sides, kept identical by test). Not advisory: a block that fails it
  // is refused here AND by the server, because the old warning let the order
  // through and stored a block with the address typed in plaintext under it,
  // labelled encrypted. The server additionally checks the packets — that a
  // PGP MESSAGE is actually encrypted and not merely signed — which needs a
  // library the client does not carry, so a block can pass here and still be
  // refused with `code: 'address_armor'` on submit.
  const pgpVerdict = pgpAddress.trim() ? checkArmorShape(pgpAddress) : null;
  const pgpLooksArmored = !!pgpVerdict?.ok;
  const [loading, setLoading] = useState(false);

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const shippingCost = useMemo(
    () => shippingCostFor(settings.shipping_tiers, totalItems),
    [settings.shipping_tiers, totalItems]
  );

  // A frozen copy of everything the receipt prints, taken the moment the order
  // is created. Placing the order empties the cart, so a panel still reading
  // live cart state would blank its own line items out from under the sheet
  // that is describing them. Non-null also means "this checkout is spent":
  // it locks the form and holds off the empty-cart redirect below.
  const [placed, setPlaced] = useState(null);
  // The till is shut (components/StorePausedBar). Two sources, because the
  // public settings are read once when the app loads: the payload says so
  // from the start, or the server said so with a 423 when the button was
  // pressed after the operator paused mid-visit. Either way the button goes
  // and the notice takes its place — the server's own sentence if it sent
  // one, since that is the freshest copy of the operator's words.
  const [pausedByServer, setPausedByServer] = useState(null);
  const paused = storePaused(settings) || pausedByServer !== null;
  const pausedNotice = pausedByServer || pausedMessage(settings);

  // Warm the order-panel chunk while the buyer is still filling the form. No
  // state, no cleanup: the import is idempotent and its only job is to be
  // resolved before `placed` is set. A failure here is silently fine — the
  // Suspense boundary below fetches it again at render.
  useEffect(() => { import('./OrderDetail').catch(() => {}); }, []);
  useEffect(() => {
    if (!placed) return;
    document.querySelector('.checkout-payment')?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [placed]);

  // ── Recovery across a reload ──
  //
  // `idle` until the account is known, `checking` while the last attempt's
  // key is being asked about, then `none` or `found`. The empty-cart redirect
  // below waits for this: an order that DID go through empties the cart, so
  // without the wait a buyer coming back from a dropped connection was
  // bounced to /cart before the page could tell them anything.
  const [recovery, setRecovery] = useState({ state: 'idle', order: null });
  // The address the buyer was typing before the reload, sealed in this
  // browser at their request. Offered, never silently restored.
  const [stashOffer, setStashOffer] = useState(null);
  const [keepAddress, setKeepAddress] = useState(false);
  // Preferences are applied once the account is known and saved only after
  // that, so the defaults on first render never overwrite what was kept.
  const [prefsReady, setPrefsReady] = useState(false);

  // Lines `createOrder` will refuse the whole order over — a deactivated
  // variant or group, or a drop this buyer may not see yet. The cart marks
  // them and offers the removal; this page's job is to stop someone filling in
  // an address and a payment method for an order that cannot be accepted, and
  // to say which lines rather than leaving them to decode a 400.
  const blockedLines = items.filter((i) => i.available === false || Number(i.stock) < i.quantity);

  // `hydrated` and not just `items.length`: the provider mounts with an empty
  // cart and fills it when its fetch lands, so this redirect used to fire on
  // mount and send every hard refresh of /checkout — and every link straight to
  // it — back to the cart page. Waiting for the read to settle is the whole fix;
  // an empty cart after that is genuinely empty and still redirects.
  useEffect(() => {
    if (hydrated && items.length === 0 && !placed && recovery.state === 'none') navigate('/cart');
  }, [hydrated, items, navigate, placed, recovery.state]);

  // ── What this browser kept for this account ──
  //
  // The rail, the address mode and the credit choice; the last attempt's
  // key; the sealed address if they asked for it. See utils/checkoutRecovery
  // for what each is, how long it lives, and why the address is the only one
  // encrypted. All three reads are wrapped there — a browser that refuses
  // storage gets a checkout that simply remembers nothing.
  useEffect(() => {
    if (!user) return undefined;
    let alive = true;

    const prefs = loadPrefs(user.id);
    if (prefs.addrMode) setAddrMode(prefs.addrMode);
    if (typeof prefs.useStoreCredit === 'boolean') setUseStoreCredit(prefs.useStoreCredit);
    // The profile's own request outranks a remembered toggle: a buyer who
    // asked for encryption on their profile gets it here every time.
    if (typeof prefs.sealInBrowser === 'boolean' && !user.pgp_encrypt_address) {
      setSealInBrowser(prefs.sealInBrowser);
      if (prefs.sealInBrowser) preloadPgp();
    }
    setPrefsReady(true);

    const attempt = loadAttempt(user.id);
    if (!attempt) {
      setRecovery({ state: 'none', order: null });
    } else {
      setRecovery({ state: 'checking', order: null });
      // Reused for a retry: if the earlier request did land, `createOrder`
      // replays that order for the same key rather than making a second one.
      idempotencyKeyRef.current = attempt.key;
      api.get(`/orders/attempt/${encodeURIComponent(attempt.key)}`)
        .then((d) => {
          if (!alive) return;
          if (d?.order) {
            clearAttempt(user.id);
            idempotencyKeyRef.current = null;
            setRecovery({ state: 'found', order: d.order });
          } else {
            setRecovery({ state: 'none', order: null });
          }
        })
        .catch(() => { if (alive) setRecovery({ state: 'none', order: null }); });
    }

    // Only where there is a field to restore it into. A stash kept before the
    // operator turned the address off is not offered back; the section that
    // would hold it is not on the page.
    if (wantsAddress) unstashAddress(user.id).then((s) => { if (alive && s) setStashOffer(s); }).catch(() => {});
    return () => { alive = false; };
  }, [user]);

  useEffect(() => {
    if (!user || !prefsReady) return;
    savePrefs(user.id, { paymentMethod: paymentMethod || undefined, addrMode, sealInBrowser, useStoreCredit });
  }, [user, prefsReady, paymentMethod, addrMode, sealInBrowser, useStoreCredit]);

  // The sealed address, kept only while the box is ticked and re-sealed as
  // the fields change. Debounced so a keystroke is not an encryption.
  useEffect(() => {
    if (!user || !keepAddress || placed) return undefined;
    const t = setTimeout(() => { stashAddress(user.id, addrFields).catch(() => {}); }, 600);
    return () => clearTimeout(t);
  }, [user, keepAddress, addrFields, placed]);

  useEffect(() => {
    if (user) {
      api.get('/subusers/credit').then(d => {
        setStoreCredit(parseFloat(d.balance || 0));
        // The endpoint reports whether the operator has frozen store credit
        // precisely so checkout can stop offering it. Discarding the flag meant
        // that with the system frozen the buyer was shown a discounted Total
        // beside Place Order, agreed to it, and the server then applied nothing
        // — committing an order that cost more than the figure they accepted,
        // with no way to un-place it.
        setCreditEnabled(d.store_credit_enabled !== false);
      }).catch(() => {});
    }
  }, [user]);

  // What this order will actually cost, mirroring orderController: the coupon
  // comes off first, and store credit can only cover what is left after it.
  // Clamping the credit against the pre-coupon figure instead reaches the same
  // total — both floor at zero — but overstates the credit line by the value of
  // the coupon, and spends a balance the buyer still has.
  //
  // The availability probe reads the same number: a recipient pool is only
  // usable if someone in it has headroom for this specific total.
  // The rail's own line, previewed from the same policy the engine reads:
  // after the resolved prices, before the coupon. Zero until a rail is
  // picked, and zero on a rail with no adjustment.
  const railPolicy = useMemo(() => parseRailPolicy(settings.payment_rail_adjustments), [settings.payment_rail_adjustments]);
  const quote = useCartQuote(items, { paymentMethod, couponCode: couponResult?.valid ? couponCode : '', voucherCode: appliedVoucher, useCredit: useStoreCredit, enabled: hydrated && !placed });
  const railAdj = quote.data?.rail ?? 0;
  const couponDiscount = quote.data?.couponDiscount ?? 0;
  const canUseCredit = creditEnabled && storeCredit > 0;
  const creditApplied = quote.data?.creditApplied ?? 0;
  const orderTotal = quote.data?.total ?? 0;

  // What the summary panel shows: the live cart until an order exists, the
  // snapshot afterwards, so the figures beside the receipt keep matching it.
  const view = placed ?? {
    items: items.map(i => ({ ...i, price: quote.data?.items?.find(q => q.variant_id === i.variant_id)?.price ?? i.price })),
    subtotal: quote.data?.subtotal ?? total,
    shipping: quote.data?.shipping ?? shippingCost,
    rail: railAdj,
    couponCode: couponResult?.valid ? couponCode : null,
    couponDiscount,
    creditApplied,
    total: orderTotal,
  };

  // Out-of-band methods draw from a pool of rotating recipients that can run
  // out of capacity, so ask before offering them rather than letting the buyer
  // fill in the whole form and fail at the last step. `null` means "not asked
  // yet" and is treated as available so the options do not flicker.
  const [availability, setAvailability] = useState({ cash_in_mail: null, zelle: null });
  // Whether the probe has ever answered. Only used to tell "no methods, still
  // asking" from "no methods, that is the answer" — the difference between a
  // spinner and an apology, and drawing the apology first is how a page tells
  // someone their account is locked out when it is merely still loading.
  const [probed, setProbed] = useState(false);

  // One key per checkout ATTEMPT, held across retries of that attempt.
  //
  // Minted lazily on first submit and cleared once an order exists, which is
  // what makes it a retry guard rather than a "one order per page load" rule: a
  // resubmit after a validation failure reuses the key (no order was created,
  // so nothing is replayed), while a buyer who genuinely wants a second order
  // starts a fresh attempt and gets a fresh key. Kept in a ref rather than
  // state on purpose — two clicks landing in the same React batch must read the
  // same key, and a state update would not have applied yet for the second.
  const idempotencyKeyRef = useRef(null);
  const submittingRef = useRef(false);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    api.get(`/orders/payment-availability?total=${encodeURIComponent(orderTotal.toFixed(2))}`)
      .then((d) => { if (alive) { setAvailability(d); setProbed(true); } })
      .catch(() => { if (alive) setProbed(true); /* order creation reports the real reason */ });
    return () => { alive = false; };
  }, [user, orderTotal]);

  const offered = (method) => availability[method] !== false;

  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    api.get('/orders/address-lookup/provider').then((d) => { if (alive) setLookup(d); }).catch(() => {});
    api.get('/store-pgp/public').then((k) => {
      if (!alive || !k?.public_key) return;
      setStoreKey(k);
      // Default on for a buyer who asked for encryption in their profile:
      // the promise there was "encrypted before it is stored", and doing it
      // in their own browser is the strongest form of that promise.
      if (user.pgp_encrypt_address) { setSealInBrowser(true); preloadPgp(); }
    }).catch(() => {});
    return () => { alive = false; };
  }, [user]);

  const runLookup = async (e) => {
    e?.preventDefault?.();
    const q = lookupQ.trim();
    if (q.length < 3) return;
    setLookupBusy(true);
    try {
      const d = await api.get(`/orders/address-lookup?q=${encodeURIComponent(q)}`);
      setLookupHits(d.results || []);
    } catch (err) {
      toast.error(err.message || 'The lookup did not answer');
    } finally {
      setLookupBusy(false);
    }
  };

  // As-you-type only where the provider permits it (Photon, Google). Under
  // Nominatim the field waits for Enter — its policy forbids the other thing,
  // and the server throttles store-wide regardless.
  useEffect(() => {
    if (!finding || lookup?.mode !== 'type') return undefined;
    const t = setTimeout(() => { if (lookupQ.trim().length >= 3) runLookup(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lookupQ, finding, lookup?.mode]);

  const pickHit = (h) => {
    setAddrFields((prev) => ({
      ...prev,
      street: h.street || prev.street,
      city: h.city || prev.city,
      state: h.state || prev.state,
      zip: h.zip || prev.zip,
      country: h.country || prev.country,
    }));
    setFinding(false);
    setLookupHits(null);
    setLookupQ('');
  };

  // "Usually ships within…", from the store's own history. Store-wide at
  // checkout — no carrier exists yet — and absent, not invented, when the
  // history is too thin: see services/fulfilmentStats for the suppression.
  const [eta, setEta] = useState(null);
  useEffect(() => {
    if (!user) return undefined;
    let alive = true;
    api.get('/orders/delivery-estimate')
      .then((d) => { if (alive) setEta(d); })
      .catch(() => { /* an estimate is a courtesy; its absence is not an error */ });
    return () => { alive = false; };
  }, [user]);

  // The depth policy, read once per settings load. See railFacts.
  const depthPolicy = useMemo(
    () => parseDepthPolicy(settings.payment_confirmation_depth),
    [settings.payment_confirmation_depth],
  );

  const paymentMethods = [];
  if (settings.btc_enabled === 'true') paymentMethods.push({ value: 'btc', label: 'Bitcoin', note: 'BTC', color: '#f7931a', testnet: settings.developer_mode === 'true' && settings.btc_testnet === 'true' });
  if (settings.xmr_enabled === 'true') paymentMethods.push({ value: 'xmr', label: 'Monero', note: 'XMR', color: '#ff6600', testnet: settings.developer_mode === 'true' && settings.xmr_testnet === 'true' });
  if (settings.ltc_enabled === 'true') paymentMethods.push({ value: 'ltc', label: 'Litecoin', note: 'LTC', color: '#bfbbbb', testnet: settings.developer_mode === 'true' && settings.ltc_testnet === 'true' });
  if (settings.cash_in_mail_enabled === 'true' && user?.cash_in_mail_enabled && offered('cash_in_mail')) {
    paymentMethods.push({ value: 'cash_in_mail', label: 'Cash in Mail', note: 'By post', color: 'var(--success)', testnet: false });
  }
  if (settings.zelle_enabled === 'true' && user?.zelle_enabled && offered('zelle')) {
    paymentMethods.push({ value: 'zelle', label: 'Zelle', note: 'Bank transfer', color: 'var(--info, #6ea8fe)', testnet: false });
  }
  // The demo rail, offered only on an explicit `true`.
  //
  // Every other method above reads a public setting; this one cannot, because
  // `demo_enabled` is only half its switch — the other half is an environment
  // gate that keeps a database restored from an evaluation box inert on a
  // production store. Only the server can answer, which is why this is the one
  // tile that comes from the availability probe alone.
  //
  // `=== true` rather than `offered('demo')`: `offered` treats "not asked yet"
  // as available so the coin tiles do not flicker, and a rail that hands out
  // paid orders for nothing must fail the other way — absent, unknown or
  // errored all mean not offered. The label travels with the flag so the button
  // cannot end up reading like a brand name beside Bitcoin and Zelle.
  if (availability.demo === true) {
    paymentMethods.push({
      value: 'demo',
      label: availability.demo_label || 'Demo (no real payment)',
      note: 'Test rail — settles itself',
      color: 'var(--warning)',
      testnet: false,
    });
  }

  // The rail is restored separately, once the tiles exist to restore it
  // into — the list depends on settings and on the availability probe, and
  // a remembered rail the store no longer offers is left unselected.
  const railRestored = useRef(false);
  const railKeys = paymentMethods.map((pm) => pm.value).join(',');
  useEffect(() => {
    if (!user || !prefsReady || railRestored.current || paymentMethod) return;
    const wanted = loadPrefs(user.id).paymentMethod;
    if (!wanted) { railRestored.current = true; return; }
    if (railKeys.split(',').includes(wanted)) { setPaymentMethod(wanted); railRestored.current = true; }
  }, [user, prefsReady, paymentMethod, railKeys]);

  /**
   * Which fields cannot be accepted, in screen order, keyed by element id.
   *
   * Mirrors what the labels already promise with an asterisk. The server
   * still checks the address on its own terms (services/addressCrypto for
   * the block, a non-empty address for the form); this is what stops a buyer
   * finding that out from a 400.
   */
  const validate = () => {
    const errs = {};
    if (!paymentMethod) errs['ck-payment'] = 'Choose how you will pay.';
    // Nothing to validate on a shop that asks for no address — the fields are
    // not drawn, so they are empty, and demanding them would make checkout
    // unusable rather than strict.
    if (!wantsAddress) return errs;
    if (addrMode === 'form' && !sealed) {
      if (!addrFields.name.trim()) errs['ck-name'] = 'Who should the parcel be addressed to?';
      if (!addrFields.street.trim()) errs['ck-street'] = 'Enter the street address.';
      if (!addrFields.city.trim()) errs['ck-city'] = 'Enter the city.';
      if (!addrFields.state.trim()) errs['ck-state'] = 'Enter the state or province.';
      if (!addrFields.zip.trim()) errs['ck-zip'] = 'Enter the ZIP or postcode.';
    }
    if (addrMode === 'pgp') {
      // The armor verdict already draws its own line under the block, so a
      // malformed block gets focus without a second sentence saying so.
      if (!pgpAddress.trim()) errs['ck-pgp-addr'] = 'Paste your encrypted address block, or switch back to the address form.';
      else if (!pgpLooksArmored) errs['ck-pgp-addr'] = '';
    }
    return errs;
  };
  const focusFirstInvalid = (errs) => {
    const first = Object.keys(errs)[0];
    const el = first ? document.getElementById(first) : null;
    if (!el) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    el.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    el.focus?.({ preventScroll: true });
  };
  const invalid = (id) => ({
    'aria-invalid': fieldErrors[id] ? true : undefined,
    'aria-describedby': fieldErrors[id] ? `${id}-err` : undefined,
  });

  const restoreStash = () => {
    if (!stashOffer) return;
    setAddrFields((prev) => ({ ...prev, ...stashOffer.fields }));
    setKeepAddress(true);
    setStashOffer(null);
    setFieldErrors({});
  };
  const forgetStash = () => {
    if (user) forgetAddress(user.id);
    setStashOffer(null);
  };

  const applyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    try {
      // Validated against the rail-adjusted subtotal, as the server will
      // measure it at checkout — the coupon comes after the rail.
      const q = await api.post('/orders/cart/quote', { coupon_code: couponCode, payment_method: paymentMethod, use_store_credit: useStoreCredit });
      const d = { valid: true, discount_amount: q.couponDiscount };
      setCouponResult(d);
      if (d.valid) toast.success(`Coupon applied: -$${parseFloat(d.discount_amount).toFixed(2)}`);
      else toast.error(d.error || 'Invalid coupon code');
    } catch (err) {
      toast.error(err.message || 'Failed to validate coupon');
      setCouponResult({ valid: false, error: err.message });
    } finally {
      setCouponLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submittingRef.current) return;
    // Refused here as well as drawn above, because the guard has to hold for
    // the keyboard path that submits the form without ever pressing the button.
    if (paused) return toast.error(pausedNotice);
    if (voucherNeedsReview) return toast.error('Apply or remove the voucher before placing your order');
    if (!quote.ready) return toast.error(quote.error || 'Please wait for your total to update');
    if (blockedLines.length > 0) {
      return toast.error('Some lines can no longer be sold — remove them in your cart first');
    }
    // Nothing validated the address at all once: the six fields carried no
    // `required` and neither did the PGP block, so an order could be placed
    // with no delivery address and staff found out when they came to ship it.
    // The refusal now lands beside the field, and the first one takes focus.
    const errs = validate();
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      focusFirstInvalid(errs);
      return;
    }
    // A ref closes the gap before React renders the disabled button, including
    // submissions that are still encrypting an address when another arrives.
    submittingRef.current = true;
    setLoading(true);
    try {
      // Seal here, in the buyer's browser, before anything leaves it. The
      // fold below is the buyer watching it happen; the store receives the
      // block and recognises itself as a recipient (addressCrypto).
      let addressToSend = builtAddress;
      if (wantsAddress && addrMode === 'form' && sealInBrowser && storeKey?.public_key) {
        setSealPhase('working');
        try {
          const { armored, fingerprints } = await encryptTo([storeKey.public_key, user?.pgp_public_key], formAddress);
          if (!fingerprints.some((f) => f === String(storeKey.fingerprint).toUpperCase())) {
            throw new Error('The store key could not be used — the address was not sealed. Nothing was sent.');
          }
          setSealed({ armored, fingerprints, plain: formAddress });
          setSealPhase('sealing');
          setTimeout(() => setSealPhase('sealed'), 700);
          addressToSend = armored;
        } catch (err) {
          setSealPhase(null);
          return toast.error(err.message || 'Could not seal the address in your browser');
        }
      }
      if (!idempotencyKeyRef.current) {
        idempotencyKeyRef.current = newIdempotencyKey();
        // Kept across a reload, so a connection that drops after this point
        // can be asked "did that make an order?" — see utils/checkoutRecovery.
        if (user) saveAttempt(user.id, idempotencyKeyRef.current);
      }
      const body = {
        payment_method: paymentMethod,
        quoted_total: orderTotal,
        shipping_address: addressToSend,
        order_notes: orderNotes,
        coupon_code: couponResult?.valid ? couponCode : undefined,
        voucher_code: voucherCode.trim() || undefined,
        use_store_credit: useStoreCredit && canUseCredit,
        idempotency_key: idempotencyKeyRef.current,
      };

      const data = await api.post('/orders', body);
      window.dispatchEvent(new CustomEvent('cs:purchase', { detail: { id: data.order.id } }));
      // The attempt produced an order — a replayed one counts, since the point
      // is that exactly one exists. Releasing the key here is what stops the
      // next order placed without a remount from being answered with this one.
      idempotencyKeyRef.current = null;
      if (user) {
        clearAttempt(user.id);
        // The order carries the address now; nothing about it stays here.
        forgetAddress(user.id);
        setStashOffer(null);
      }

      // The buyer asked for encryption and did not get it. Surfaced rather than
      // swallowed: the order is already placed, and it is their decision that
      // failed to take effect.
      if (data.address_warning) toast.error(data.address_warning, { duration: 9000 });

      // The order is committed at this point, so the page stops asking and
      // starts reporting: the receipt below the button is the confirmation,
      // and its Pay button is what carries on to the payment screen. Going
      // straight there instead would skip past the only summary of what was
      // just bought that the buyer ever sees at full size.
      setPlaced({
        uuid: data.order.uuid || data.order.id,
        createdAt: data.order.created_at,
        status: data.order.status,
        // Server-asserted, never inferred from a $0 ledger: the order took no
        // further money and is already marked paid.
        settled: !!data.settled_at_checkout,
        storeName: settings.store_name || 'CryptoStore',
        paymentLabel: paymentMethods.find(pm => pm.value === paymentMethod)?.label || paymentMethod,
        address: wantsAddress ? (formAddress || builtAddress) : '',
        couponCode: couponResult?.valid ? couponCode : null,
        items: linesOf(data, items),
        // Money comes off the created row, not the form. The two agree in the
        // ordinary case — the cart preview is priced through the same engine —
        // but a price or credit that moved between load and submit is settled
        // by the server, and a receipt is the wrong place to be approximate.
        //
        // `discount_amount` is the coupon *and* the credit combined, so the
        // credit has to come back out of it before the receipt prints them as
        // two lines; leaving it in would show the credit twice.
        ...ledgerOf(data.order, {
          subtotal: total,
          shipping: shippingCost,
          rail: railAdj,
          couponDiscount,
          creditApplied,
          total: orderTotal,
        }),
      });
      await fetchCart();
      toast.success('Order placed!');
      // The order chime, not the payment one — success is reserved for the
      // moment money actually lands (OrderDetail's payment check).
      playSound('notify');
    } catch (err) {
      // The operator paused new orders after this page loaded its settings,
      // so the button was drawn and the server refused it (423,
      // `code: 'store_paused'`). Not an error in the buyer's form: the page
      // swaps the button for the notice, in the server's own words, and the
      // cart is left exactly as it was for when the till reopens.
      if (err.status === 423 || err.data?.code === 'store_paused') {
        setPausedByServer(err.data?.error || err.message || null);
        toast.error(err.data?.error || err.message);
        return;
      }
      quote.retry();
      toast.error(err.message);
      playSound('error');
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const goToPayment = () => document.getElementById('checkout-payment')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

  return (
    <div className="page container ck-page">
      <header className="cart-head">
        <div className="cart-head-text">
          <h1 className="page-title">Checkout</h1>
          <p className="cart-head-sub">
            {placed
              ? (placed.settled
                ? 'Your order is placed. No payment is due.'
                : 'Your order is placed. Complete payment below.')
              : 'How you are paying, and where this is going.'}
          </p>
        </div>
        {/* §9: the only way back to the cart used to be the browser's own
            button. A page that locks the form once an order exists must not
            still offer to edit the cart it came from, so this goes with it. */}
        {!placed && (
          <Link to="/cart" className="glass-btn glass-btn-sm cart-head-back">
            <ArrowLeft size={15} aria-hidden="true" /> Back to cart
          </Link>
        )}
      </header>

      <CheckoutSteps current={placed ? 2 : 1} />

      {/* ── The last attempt made an order ──
          The sentence that replaces uncertainty after a dropped connection.
          With an empty cart it stands alone — there is nothing else to draw —
          and with a refilled cart it leads the form, because "you already
          have one" outranks "place another". */}
      {recovery.state === 'found' && !placed && (
        <div className={`ck-recovered${items.length === 0 ? ' is-alone' : ''}`} role="status">
          <Check size={18} strokeWidth={3} aria-hidden="true" />
          <p>
            <strong>Your order was created.</strong> Order{' '}
            <b>{String(recovery.order.uuid || recovery.order.id).split('-')[0].toUpperCase()}</b> was placed
            {recovery.order.created_at ? ` ${agoText(recovery.order.created_at)}` : ''}, and the
            connection dropped before this page could say so.
            {recovery.order.status === 'pending_payment'
              ? ' Nothing has been paid yet — the amount and address are on the order.'
              : ` It is ${String(recovery.order.status).replace(/_/g, ' ')}.`}
          </p>
          <div className="ck-recovered-acts">
            <Link to={`/orders/${recovery.order.uuid || recovery.order.id}`} className="glass-btn glass-btn-primary">
              {recovery.order.status === 'pending_payment' ? 'Continue payment' : 'Open the order'}
              <ArrowRight size={14} aria-hidden="true" />
            </Link>
            {items.length === 0 && (
              <Link to="/products" className="glass-btn" onClick={() => setRecovery({ state: 'none', order: null })}>
                Start a new order
              </Link>
            )}
          </div>
        </div>
      )}
      {recovery.state === 'checking' && items.length === 0 && !placed && (
        <p className="ck-lookup-where" role="status" aria-live="polite">Checking your last attempt…</p>
      )}

      {blockedLines.length > 0 && !placed && (
        <div className="cart-blocked ck-blocked" role="alert">
          <PackageX size={16} aria-hidden="true" />
          <p>
            <strong>
              {blockedLines.length === 1 ? 'One line' : `${blockedLines.length} lines`} in this
              order can no longer be sold.
            </strong>{' '}
            {blockedLines.map((i) => `${i.product_name} — ${i.variant_name}`).join('; ')}.
            The order will be refused until {blockedLines.length === 1 ? 'it is' : 'they are'} removed.
          </p>
          <Link to="/cart" className="glass-btn glass-btn-sm glass-btn-danger">
            Fix it in the cart
          </Link>
        </div>
      )}

      {(items.length > 0 || placed) && (<div className={`checkout-flow${placed ? " is-complete" : ""}`}>
      {placed && <section id="checkout-payment" className="checkout-payment flow-stack" aria-label="Complete your payment">
        <div className="flow-heading"><div><span className="flow-eyebrow">Order {String(placed.uuid).slice(0, 8).toUpperCase()}</span><h2>Your order is placed</h2><p>Follow your payment below. You can return to this order at any time.</p></div><Link className="glass-btn" to={`/orders/${placed.uuid}`}>View full order</Link></div>
        <Suspense fallback={<RouteFallback label="Loading your order…" />}>
          <OrderDetail key={placed.uuid} orderRef={placed.uuid} embedded="payment" />
        </Suspense>
      </section>}
      <form id="checkout-form" onSubmit={handleSubmit} className="ck-layout">
        {/* Once the order exists these fields describe it but no longer steer
            it, so they go quiet and stop taking focus — editing an address
            here after the fact would be a silent no-op. */}
        <div className={`ck-main${placed ? ' is-spent' : ''}`} inert={placed ? true : undefined}>
          {/* ── 01 Payment method ─────────────────────────────────────────── */}
          <section className="glass-card ck-section">
            <header className="ck-head">
              <span className="ck-step">01</span>
              <h2 className="ck-head-title"><CreditCard size={16} aria-hidden="true" /> How you pay</h2>
              {paymentMethod && (
                <span className="ck-head-state">
                  <Check size={12} strokeWidth={3} aria-hidden="true" />
                  {paymentMethods.find((pm) => pm.value === paymentMethod)?.label}
                </span>
              )}
            </header>

            {paymentMethods.length === 0 ? (
              probed ? (
                /* §9: an empty state is navigation. "No methods available" with
                   no way forward is the end of the road on the page where the
                   buyer is trying to spend money. */
                <div className="ck-none">
                  <Info size={16} aria-hidden="true" />
                  <div>
                    <strong>No payment method is open to your account right now.</strong>
                    <p>
                      Cash and bank options are enabled per account, and the out-of-band pools
                      can be temporarily full. Support can tell you which applies.
                    </p>
                    <div className="ck-none-links">
                      <Link to="/support" className="glass-btn glass-btn-sm">
                        <LifeBuoy size={13} aria-hidden="true" /> Ask support
                      </Link>
                      <Link to="/cart" className="glass-btn glass-btn-sm">Back to cart</Link>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="ck-probing"><span className="spinner" /> Checking which methods are open…</p>
              )
            ) : (
              <>
              <FieldError id="ck-payment-err" message={fieldErrors['ck-payment']} />
              <div
                id="ck-payment"
                className={`pm-grid${fieldErrors['ck-payment'] ? ' is-invalid' : ''}`}
                role="radiogroup"
                aria-label="Payment method"
                tabIndex={-1}
                {...invalid('ck-payment')}
              >
                {paymentMethods.map(pm => {
                  const mark = PM_MARKS[pm.value] || {};
                  return (
                    <button
                      key={pm.value}
                      type="button"
                      role="radio"
                      aria-checked={paymentMethod === pm.value}
                      onClick={() => setPaymentMethod(pm.value)}
                      className={`pm-tile${paymentMethod === pm.value ? ' is-selected' : ''}`}
                      style={{ '--pm-tint': pm.color }}
                    >
                      <span className="pm-mark" aria-hidden="true">
                        {mark.glyph
                          ? <span className="pm-glyph">{mark.glyph}</span>
                          : mark.Icon && <mark.Icon size={17} />}
                      </span>
                      <span className="pm-text">
                        <span className="pm-label">
                          {pm.label}
                          {railPolicy[pm.value] && (
                            <span className={`pm-rail${railPolicy[pm.value].value < 0 ? ' is-off' : ' is-fee'}`} title={railPolicy[pm.value].value < 0 ? 'This rail is cheaper' : 'This rail carries a fee'}>
                              {railLabel(railPolicy[pm.value])}
                            </span>
                          )}
                        </span>
                        <span className="pm-note">{pm.note}</span>
                        {pm.testnet && <span className="pm-testnet">Testnet</span>}
                        {(() => {
                          const methodQuote = quote.data?.method_quotes?.[pm.value];
                          const facts = railFacts(pm, { policy: depthPolicy, total: methodQuote?.total ?? orderTotal });
                          if (!facts) return null;
                          return (
                            <dl className="pm-facts">
                              {methodQuote?.total != null && <div><dt>Due with this method</dt><dd>{money(methodQuote.total)}</dd></div>}
                              <div><dt>Settles in</dt><dd>{facts.settles}</dd></div>
                              <div><dt>Reversible</dt><dd>{facts.reversible}</dd></div>
                              <div><dt>Leaves a record</dt><dd>{facts.record}</dd></div>
                            </dl>
                          );
                        })()}
                      </span>
                      <span className="pm-check" aria-hidden="true"><Check size={12} strokeWidth={3} /></span>
                    </button>
                  );
                })}
              </div>
              </>
            )}

            {paymentMethod === 'zelle' && (
              <div className="ck-notice">
                <p>
                  After placing the order you will be shown the recipient and a reference code. Put that
                  code in the Zelle memo — it is how your payment gets matched to this order. Send the
                  exact total; payment is confirmed manually, so allow a little time.
                </p>
                <p className="ck-notice-warn">
                  <AlertTriangle size={15} aria-hidden="true" />
                  <span>
                    Zelle sends your real name and bank details to the recipient, and transfers cannot be
                    reversed once sent. Choose a cryptocurrency option instead if you would rather not
                    share those.
                  </span>
                </p>
              </div>
            )}

            {paymentMethod === 'cash_in_mail' && (
              <div className="ck-notice">
                <p>
                  After placing the order, you will receive a mailing address. Send your cash and enter
                  the tracking number on the order details page.
                </p>
              </div>
            )}
          </section>

          {/* ── 02 Where it goes ──────────────────────────────────────────── */}
          <section className="glass-card ck-section">
            {/* The step keeps its number and its place whether or not this shop
                ships. Dropping the section outright would renumber every step
                below it, and a buyer who knows this checkout would find 02
                missing rather than answered. */}
            <header className="ck-head">
              <span className="ck-step">02</span>
              {wantsAddress
                ? <h2 className="ck-head-title"><Truck size={16} aria-hidden="true" /> Where it goes</h2>
                : <h2 className="ck-head-title"><Info size={16} aria-hidden="true" /> Anything to add</h2>}
            </header>

            {!wantsAddress && (
              <p className="ck-addr-state">
                <Info size={13} aria-hidden="true" />
                <span>
                  This shop does not ship, so it does not ask where to. Nothing about your
                  address is collected or stored with this order.
                </span>
              </p>
            )}

            {wantsAddress && (<>
            {/* How the address is supplied. Two genuinely different things:
                the form is typed and the store can read it (encrypting it to
                the store key on the way in, if the account asks for that); a
                pasted block is opaque to the store and is never re-encrypted. */}
            <div className="segmented ck-addr-mode" role="tablist" aria-label="Address format">
              <button
                type="button"
                role="tab"
                aria-selected={addrMode === 'form'}
                className={`segmented-option${addrMode === 'form' ? ' active' : ''}`}
                onClick={() => setAddrMode('form')}
                disabled={!!placed}
              >
                <MapPin size={13} aria-hidden="true" /> Address form
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={addrMode === 'pgp'}
                className={`segmented-option${addrMode === 'pgp' ? ' active' : ''}`}
                onClick={() => setAddrMode('pgp')}
                disabled={!!placed}
              >
                <Lock size={13} aria-hidden="true" /> I'll encrypt it myself
              </button>
            </div>

            {addrMode === 'form' && storeKey?.public_key && !sealed && (
              <label className={`ck-seal-opt${sealInBrowser ? ' is-on' : ''}`}>
                <input
                  type="checkbox"
                  checked={sealInBrowser}
                  onChange={(e) => { setSealInBrowser(e.target.checked); if (e.target.checked) preloadPgp(); }}
                  disabled={!!placed}
                />
                <span>
                  <strong>Seal this address in your browser.</strong> It is encrypted here, on your
                  machine, to the store key{user?.pgp_public_key ? ' and to your own' : ''} — the store
                  receives only the sealed block and opens it with its key when it ships.
                  {!sealInBrowser && user?.pgp_encrypt_address && ' (Off here, the store seals it on arrival, as your profile asks.)'}
                  <span className="ck-seal-where">
                    Store key <code>{String(storeKey.fingerprint || '').slice(-16)}</code>
                    {!user?.pgp_public_key && ' · add your own key on your profile to be able to read it back yourself'}
                  </span>
                </span>
              </label>
            )}
            {addrMode === 'form' && !storeKey?.public_key && user?.pgp_encrypt_address && (
              <p className="ck-addr-state is-on">
                <ShieldCheck size={13} aria-hidden="true" />
                <span>
                  This address will be encrypted to the store's PGP key and to yours before it is
                  stored, because you turned that on in your profile.
                </span>
              </p>
            )}
            {sealPhase === 'working' && (
              <div className="ck-seal"><div className="ck-seal-working"><KeyRound size={14} aria-hidden="true" /> Sealing in your browser…</div></div>
            )}
            {sealed && sealPhase !== 'working' && (
              <div className={`ck-seal is-${sealPhase || 'sealed'}`} aria-live="polite">
                <div className="ck-seal-plain"><div><pre>{sealed.plain}</pre></div></div>
                <div className="ck-seal-cipher">
                  <pre className="ck-seal-lines" aria-hidden="true">
                    {sealed.armored.split('\n').slice(0, 14).map((line, i) => (
                      <span key={i} style={{ '--i': i }}>{line}</span>
                    ))}
                  </pre>
                  <div className="ck-seal-stamp">
                    <ShieldCheck size={18} aria-hidden="true" />
                    <span>
                      <b>{String(sealed.fingerprints[0] || '').slice(-16)}</b>
                      <small>sealed on this device{sealed.fingerprints.length > 1 ? ' · and to your key' : ''}</small>
                    </span>
                  </div>
                </div>
                <div className="ck-seal-foot">
                  <span>Encrypted on this device. The store never saw the text above.</span>
                  {!placed && <button type="button" onClick={() => { setSealed(null); setSealPhase(null); }}>Edit the address</button>}
                </div>
              </div>
            )}

            {addrMode === 'pgp' && (
              <>
                <p className="ck-addr-state">
                  <Lock size={13} aria-hidden="true" />
                  <span>
                    Encrypt your address to <strong>the store's public key</strong> in your own PGP
                    client and paste the block below. It is stored exactly as you paste it — the store
                    will not wrap it again — so make sure the store is a recipient, or nobody can read
                    it to ship your order.
                  </span>
                </p>

                {/* The key itself, rather than the old sentence pointing at a
                    "store PGP page" that does not exist. */}
                <StoreKeyCard />

                <div className="form-group">
                  <label htmlFor="ck-pgp-addr">Encrypted address block <span className="field-req">*</span></label>
                  <textarea
                    id="ck-pgp-addr"
                    className={`glass-input ck-pgp-input${pgpVerdict && !pgpVerdict.ok ? ' ck-pgp-invalid' : ''}${fieldErrors['ck-pgp-addr'] ? ' is-invalid' : ''}`}
                    value={pgpAddress}
                    onChange={(e) => { setPgpAddress(e.target.value); clearError('ck-pgp-addr'); }}
                    {...invalid('ck-pgp-addr')}
                    placeholder={'-----BEGIN PGP MESSAGE-----\n\n...\n-----END PGP MESSAGE-----'}
                    rows={9}
                    spellCheck="false"
                    disabled={!!placed}
                  />
                  <FieldError id="ck-pgp-addr-err" message={fieldErrors['ck-pgp-addr']} />
                  {pgpVerdict && !pgpVerdict.ok && (
                    <p className="ck-addr-warn" role="alert">
                      <AlertTriangle size={12} aria-hidden="true" />
                      {pgpVerdict.message} The order will not be placed until this is fixed.
                    </p>
                  )}
                  {pgpVerdict?.ok && (
                    <p className="ck-addr-state is-on">
                      <ShieldCheck size={13} aria-hidden="true" />
                      <span>One whole PGP message block. The store checks on submit that it is encrypted and not merely signed.</span>
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Offered, never silently filled in: the buyer decides whether
                the address they were typing before the reload comes back. */}
            {stashOffer && addrMode === 'form' && !sealed && !placed && (
              <div className="ck-stash" role="status">
                <History size={14} aria-hidden="true" />
                <p>
                  You were typing an address here {agoText(stashOffer.at) || 'earlier'}. It was kept
                  sealed in this browser for an hour, as you asked.
                </p>
                <div className="ck-stash-acts">
                  <button type="button" className="glass-btn glass-btn-sm glass-btn-primary" onClick={restoreStash}>Restore it</button>
                  <button type="button" className="glass-btn glass-btn-sm" onClick={forgetStash}>Forget it</button>
                </div>
              </div>
            )}

            {addrMode === 'form' && lookup?.enabled && !sealed && !placed && (
              <div className="ck-lookup">
                {!finding ? (
                  <button type="button" className="glass-btn glass-btn-sm" onClick={() => setFinding(true)}>
                    <Search size={13} aria-hidden="true" /> Find an address
                  </button>
                ) : (
                  <form className="ck-lookup-form" onSubmit={runLookup}>
                    <input
                      className="glass-input"
                      value={lookupQ}
                      onChange={(e) => setLookupQ(e.target.value)}
                      placeholder={lookup.mode === 'type' ? 'Start typing a street or town…' : 'Street, town — then Enter'}
                      aria-label="Address search"
                      autoFocus
                    />
                    {lookup.mode !== 'type' && (
                      <button type="submit" className="glass-btn glass-btn-sm" disabled={lookupBusy || lookupQ.trim().length < 3}>
                        {lookupBusy ? '…' : 'Search'}
                      </button>
                    )}
                    <button type="button" className="glass-btn glass-btn-sm" onClick={() => { setFinding(false); setLookupHits(null); }}>Type it instead</button>
                    {/* Say where the query goes. A buyer who came here because
                        the address is encrypted is entitled to know that this
                        one field is not. */}
                    <p className="ck-lookup-where">
                      <Globe size={12} aria-hidden="true" />
                      What you type here is sent to <b>{lookup.host || lookup.label}</b>{
                        lookup.route === 'tor' ? ' over Tor'
                          : lookup.route === 'proxies' ? ' through a proxy' : ''
                      } through this
                      store's server — not from your browser. Nothing else on this page leaves the store.
                    </p>
                    {lookupHits && (
                      <ul className="ck-lookup-hits">
                        {lookupHits.length === 0 && <li className="ck-lookup-none">Nothing matched. Try the street and town.</li>}
                        {lookupHits.map((h, i) => (
                          <li key={i}>
                            <button type="button" onClick={() => pickHit(h)}>
                              <MapPin size={12} aria-hidden="true" /> {h.display || [h.street, h.city, h.state, h.zip].filter(Boolean).join(', ')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </form>
                )}
              </div>
            )}

            <div className="ck-addr-form" hidden={addrMode !== 'form' || !!sealed || finding}>
              <div className="form-group">
                <label htmlFor="ck-name">Recipient name <span className="field-req">*</span></label>
                <input id="ck-name" className={`glass-input${fieldErrors['ck-name'] ? ' is-invalid' : ''}`} value={addrFields.name}
                  onChange={setAddr('name')} placeholder="JOHN DOE" autoComplete="name" {...invalid('ck-name')} />
                <FieldError id="ck-name-err" message={fieldErrors['ck-name']} />
              </div>

              <div className="form-group">
                <label htmlFor="ck-company">Company <span className="field-opt">(optional)</span></label>
                <input id="ck-company" className="glass-input" value={addrFields.company}
                  onChange={setAddr('company')} placeholder="ACME CORP" autoComplete="organization" />
              </div>

              <div className="form-group ck-addr-street">
                <label htmlFor="ck-street">Street address <span className="field-req">*</span></label>
                <input id="ck-street" className={`glass-input${fieldErrors['ck-street'] ? ' is-invalid' : ''}`} value={addrFields.street}
                  onChange={setAddr('street')} placeholder="1234 N MAIN ST APT 101" autoComplete="street-address" {...invalid('ck-street')} />
                <FieldError id="ck-street-err" message={fieldErrors['ck-street']} />
              </div>

              <div className="form-group">
                <label htmlFor="ck-city">City <span className="field-req">*</span></label>
                <input id="ck-city" className={`glass-input${fieldErrors['ck-city'] ? ' is-invalid' : ''}`} value={addrFields.city}
                  onChange={setAddr('city')} placeholder="LOS ANGELES" autoComplete="address-level2" {...invalid('ck-city')} />
                <FieldError id="ck-city-err" message={fieldErrors['ck-city']} />
              </div>

              {/* Not `maxLength={2}` with a "CA" placeholder any more. This
                  project's stated range runs from a US clearnet store to an
                  operator on a hostile network, and a two-character cap made
                  every address outside the US unenterable — Bayern, Kanagawa
                  and Nordrhein-Westfalen all truncated to two letters in a
                  field the buyer could not argue with. The address travels as
                  one block of free text either way, so the cap was buying
                  nothing and silently corrupting the label. */}
              <div className="form-group">
                <label htmlFor="ck-state">State / province <span className="field-req">*</span></label>
                <input id="ck-state" className={`glass-input${fieldErrors['ck-state'] ? ' is-invalid' : ''}`} value={addrFields.state}
                  onChange={setAddr('state')} placeholder="CA" maxLength={64} autoComplete="address-level1" {...invalid('ck-state')} />
                <FieldError id="ck-state-err" message={fieldErrors['ck-state']} />
              </div>

              <div className="form-group">
                <label htmlFor="ck-zip">ZIP / postcode <span className="field-req">*</span></label>
                <input id="ck-zip" className={`glass-input${fieldErrors['ck-zip'] ? ' is-invalid' : ''}`} value={addrFields.zip}
                  onChange={setAddr('zip')} placeholder="90001" maxLength={16} autoComplete="postal-code" {...invalid('ck-zip')} />
                <FieldError id="ck-zip-err" message={fieldErrors['ck-zip']} />
              </div>

              {/* Country was the one field the six never had, and the one
                  every geocoder returns. Two letters, upper-cased into the
                  block. Optional: a domestic-only store never needs it. */}
              <div className="form-group">
                <label htmlFor="ck-country">Country <span className="field-opt">(optional)</span></label>
                <input id="ck-country" className="glass-input" value={addrFields.country}
                  onChange={setAddr('country')} placeholder="US" maxLength={32} autoComplete="country" />
              </div>
            </div>

            {/* The address is assembled from six fields but travels as one block
                of text, so show the block itself — a label preview catches the
                transposed apartment number that reading the fields back never
                does. */}
            {addrMode === 'form' && builtAddress && (
              <figure className="ship-label">
                <figcaption className="ship-label-head">
                  <span className="ship-label-title"><MapPin size={12} aria-hidden="true" /> Ship to</span>
                  <span className="ship-label-hint">Sent exactly as shown</span>
                </figcaption>
                <pre className="ship-label-body">{builtAddress}</pre>
              </figure>
            )}

            {/* Explicit, temporary, encrypted — and off unless asked. The
                alternative every other checkout ships is the plaintext
                address in localStorage indefinitely, which is the thing
                CLAUDE.md means by "hold less". See utils/checkoutRecovery for
                exactly what the seal does and does not protect against. */}
            {addrMode === 'form' && !placed && (
              <label className="ck-keep">
                <input
                  type="checkbox"
                  checked={keepAddress}
                  onChange={(e) => {
                    setKeepAddress(e.target.checked);
                    if (!e.target.checked && user) forgetAddress(user.id);
                  }}
                />
                <span>
                  <strong>Keep this address in this browser for an hour</strong>, in case the page reloads.
                  <span className="ck-keep-note">
                    Sealed with a key this browser will not hand out, and forgotten when the order is
                    placed or the hour is up. Left unticked, nothing is kept.
                  </span>
                </span>
              </label>
            )}

            </>)}

            <div className="form-group ck-notes">
              <label htmlFor="ck-notes">
                {wantsAddress
                  ? <>Notes for whoever packs this <span className="field-opt">(optional)</span></>
                  : <>Notes on this order <span className="field-opt">(optional)</span></>}
              </label>
              <textarea
                id="ck-notes"
                className="glass-input"
                value={orderNotes}
                onChange={(e) => setOrderNotes(e.target.value)}
                placeholder="Buzzer is broken, leave with the neighbour…"
                rows={2}
              />
            </div>
          </section>

          {/* ── 03 Money off ──────────────────────────────────────────────── */}
          <section className="glass-card ck-section">
            <header className="ck-head">
              <span className="ck-step">03</span>
              <h2 className="ck-head-title"><Tag size={16} aria-hidden="true" /> Money off</h2>
            </header>

            <div className="ck-coupon">
              <input
                className="glass-input"
                value={couponCode}
                onChange={e => { setCouponCode(e.target.value); setCouponResult(null); }}
                placeholder="Coupon code"
                aria-label="Coupon code"
              />
              <button
                type="button"
                className="glass-btn"
                onClick={applyCoupon}
                disabled={couponLoading || !couponCode.trim()}
              >
                {couponLoading ? <span className="spinner" /> : 'Apply'}
              </button>
            </div>

            {/* A store-credit voucher, redeemed INSIDE the order transaction
                onto the balance and spent from it in the same breath. Its
                value is previewed here from the same hint the server will
                give; the arbiter is the guarded UPDATE at checkout. */}
            {creditEnabled && (
              <div className="ck-voucher">
                <input
                  className="glass-input"
                  value={voucherCode}
                  onChange={(e) => { setVoucherCode(e.target.value); if (!e.target.value.trim()) setAppliedVoucher(''); }}
                  placeholder="Credit voucher SC-XXXX-XXXX-XXXX"
                  aria-label="Store credit voucher code"
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck="false"
                  disabled={!!placed}
                />
                <button type="button" className="glass-btn" disabled={!voucherNeedsReview || !!placed} onClick={() => setAppliedVoucher(voucherCode.trim())}>Apply voucher</button>
                {quote.ready && quote.data?.voucher && <p className="flow-note">Voucher {quote.data.voucher.hint}: {money(quote.data.voucher.face_value)} added to available credit in this preview. Redeemed only when you place the order.</p>}
                {voucherCode.trim() && (
                  <span className="ck-voucher-note">
                    <Gift size={13} aria-hidden="true" /> Redeemed onto your balance when you place the order, and spent on it.
                  </span>
                )}
              </div>
            )}

            {couponResult && (
              <p className={`ck-coupon-result${couponResult.valid ? ' is-valid' : ' is-invalid'}`}>
                {couponResult.valid
                  ? <><Check size={14} strokeWidth={3} aria-hidden="true" /> Coupon applied — {money(couponResult.discount_amount)} off</>
                  : <><AlertTriangle size={14} aria-hidden="true" /> {couponResult.error}</>}
              </p>
            )}

            {canUseCredit && (
              <StoreCreditMeter
                balance={quote.data?.balance ?? storeCredit}
                applied={creditApplied}
                dueAfter={orderTotal}
                on={useStoreCredit}
                onToggle={setUseStoreCredit}
                disabled={!!placed}
              />
            )}
          </section>
        </div>

        {/* ── Order summary ───────────────────────────────────────────────── */}
        <aside id="checkout-summary" className={`glass-card summary-panel${placed ? ' is-printed' : ''}`}>
          <h2 className="summary-title">
            {placed ? 'What you bought' : 'What you are buying'}
          </h2>

          {!placed && !quote.ready && <p className="flow-note" role="status">{quote.error || "Updating your total…"}{quote.error && <button type="button" className="glass-btn glass-btn-sm" onClick={quote.retry}>Try again</button>}</p>}
          <ul className="summary-items">
            {view.items.map(item => (
              <li key={item.id} className="summary-item">
                <span className="summary-item-media">
                  {item.image
                    ? <img src={item.image} alt="" loading="lazy" />
                    : <Package size={15} aria-hidden="true" />}
                  <span className="summary-item-qty">{item.quantity}</span>
                </span>
                <span className="summary-item-text">
                  {/* §9: a field that names another record is a link. Only
                      before the order exists — the receipt's own lines carry
                      no group id, and the panel is inert beside it anyway. */}
                  {item.group_id && !placed
                    ? (
                      <Link to={`/products/${item.group_id}`} className="summary-item-name">
                        {item.product_name}
                      </Link>
                    )
                    : <span className="summary-item-name">{item.product_name}</span>}
                  <span className="summary-item-variant">{item.variant_name}</span>
                </span>
                <span className="summary-item-price">{money(Number(item.price) * item.quantity)}</span>
              </li>
            ))}
          </ul>

          <dl className="ledger">
            <div className="ledger-row">
              <dt>Subtotal</dt>
              <dd>{money(view.subtotal)}</dd>
            </div>
            <div className="ledger-row">
              <dt>Shipping</dt>
              {view.shipping === 0
                ? <dd className="is-free">Free</dd>
                : <dd>{money(view.shipping)}</dd>}
            </div>
            {Math.abs(view.rail || 0) > 0.001 && (
              <div className={`ledger-row${view.rail < 0 ? ' is-credit' : ''}`}>
                <dt>{view.rail < 0 ? 'Payment method discount' : 'Payment method fee'}</dt>
                <dd>{view.rail < 0 ? '-' : '+'}{money(Math.abs(view.rail))}</dd>
              </div>
            )}
            {view.couponDiscount > 0 && (
              <div className="ledger-row is-credit">
                <dt>Coupon {view.couponCode?.toUpperCase()}</dt>
                <dd>-{money(view.couponDiscount)}</dd>
              </div>
            )}
            {view.creditApplied > 0 && (
              <div className="ledger-row is-credit">
                <dt>Store credit</dt>
                <dd>-{money(view.creditApplied)}</dd>
              </div>
            )}
          </dl>

          {eta?.dispatch && !placed && (
            <p className="summary-eta" title={`The middle and slow end of the last ${eta.dispatch.n} paid orders here`}>
              <Hourglass size={12} aria-hidden="true" />
              <span>
                Orders here usually ship within <b>{fmtDayRange(eta.dispatch)}</b> of payment
                {eta.transit && <> and arrive <b>{fmtDayRange(eta.transit)}</b> after</>}.
              </span>
            </p>
          )}

          <div className="summary-total">
            <span className="summary-total-label">{placed && !placed.settled ? 'Due' : 'Total'}</span>
            <span className="summary-total-value">{money(view.total)}</span>
          </div>

          {paused && !placed ? (
            /* The CTA's place, taken by the reason there is no CTA — the same
               footprint `.summary-blocked` gives the unsellable-lines notice,
               so the panel does not jump. The operator's words, not ours:
               they are the one who knows when the till reopens. */
            <p className="summary-blocked summary-paused" role="status">
              <PauseCircle size={14} aria-hidden="true" />
              <span><b>Not taking new orders right now.</b> {pausedNotice} Your cart is kept.</span>
            </p>
          ) : (
            <button
              type="submit"
              className={`glass-btn glass-btn-primary summary-cta${placed ? ' is-placed' : ''}`}
              disabled={loading || !!placed || blockedLines.length > 0 || !quote.ready || voucherNeedsReview}
            >
              {loading ? <span className="spinner" />
                : placed ? <><Check size={16} strokeWidth={3} aria-hidden="true" /> Order placed</>
                : blockedLines.length > 0 ? <>Remove the unsellable {blockedLines.length === 1 ? 'line' : 'lines'}</>
                : orderTotal === 0 ? <>Place order — nothing to pay</>
                : <>Place order · {money(orderTotal)}</>}
            </button>
          )}

          {placed
            ? (
              <>
                <ReceiptPrinter receipt={placed} onPay={goToPayment} />
                {/* §9: a confirmation ends pointing forward. The receipt owns
                    the outstanding thing — paying — so these are the two
                    places someone goes once that is dealt with. */}
                <div className="ck-after">
                  <Link to="/orders" className="glass-btn glass-btn-sm">
                    <Receipt size={13} aria-hidden="true" /> All your orders
                  </Link>
                  <Link to="/products" className="glass-btn glass-btn-sm">Keep shopping</Link>
                </div>
              </>
            )
            : (
              <ul className="summary-trust">
                <li>
                  <ShieldCheck size={13} aria-hidden="true" />
                  Place your order to see payment instructions. Any selected store credit is applied when you place it.
                </li>
              </ul>
            )}
        </aside>
      </form>
      {!placed && <div className="checkout-dock" aria-label="Checkout total and action">
        <a href="#checkout-summary"><span>Order total</span><strong>{quote.ready ? money(orderTotal) : 'Updating…'}</strong><small>View breakdown</small></a>
        {paused
          ? <button type="button" className="glass-btn glass-btn-primary" disabled title={pausedNotice}><PauseCircle size={14} aria-hidden="true" /> Orders paused</button>
          : <button type="submit" className="glass-btn glass-btn-primary" disabled={loading || !quote.ready || blockedLines.length > 0 || voucherNeedsReview} form="checkout-form">{loading ? 'Placing…' : 'Place order'}</button>}
      </div>}</div>
      )}
    </div>
  );
}
