import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  AlertTriangle, ArrowLeftRight, Check, ImagePlus, Package, Pencil, Send, ShieldCheck, Star,
  Trash2, Wallet, X,
} from 'lucide-react';
import { api } from '../../utils/api';
import StarRating from '../StarRating';
import ReviewMediaPicker from '../product/ReviewMediaPicker';
import { RefundComposer, SwapComposer, SwapOffer } from './OrderLineActions';

/**
 * The items on an order, and the review each one is owed.
 *
 * The old card was a flat list of name / quantity / line total with nothing to
 * do on it. Reviewing a delivered item meant leaving the order, finding the
 * product page, scrolling past the whole catalogue entry to the review form,
 * and picking the right purchase out of a dropdown of every eligible order —
 * a path nobody walked, which is why almost nothing was ever reviewed.
 *
 * Each line is now a small card with the review state on it and the composer
 * one click away, in place. The three states a line can be in:
 *
 *   not delivered  — nothing to do yet, and it says why
 *   reviewable     — a Write a review button
 *   reviewed       — the stars, the words, and an Edit button
 *
 * Editing exists because a review is a lasting public statement about a
 * purchase, and the thing most likely to change it — the item turning out
 * better or worse a week later — happens after it is written.
 */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const MAX_BODY = 2000;

/** The one status from which a purchase may be reviewed. */
const REVIEWABLE_STATUS = 'delivered';

function ReviewComposer({
  item, existing, mediaEnabled, orderId, onDone, onCancel,
}) {
  const isEdit = !!existing;
  const [rating, setRating] = useState(existing?.rating ?? 5);
  const [body, setBody] = useState(existing?.body ?? '');
  const [signing, setSigning] = useState(false);
  const [signature, setSignature] = useState('');
  const [pending, setPending] = useState([]);
  const [busy, setBusy] = useState(false);

  const dirty = isEdit
    ? rating !== existing.rating || body !== (existing.body || '') || signing || pending.length > 0
    : true;

  const submit = async (e) => {
    e.preventDefault();
    if (signing && !signature.trim()) return toast.error('Paste your signed message, or turn signing off');
    if (signing && !body.trim()) return toast.error('A signed review needs a body for the signature to cover');

    setBusy(true);
    try {
      let reviewId = existing?.id;

      if (isEdit) {
        const res = await api.put(`/reviews/${existing.id}`, {
          rating,
          body: body.trim() || null,
          // Only send the signature field when the author touched it: omitting
          // it lets the server apply its own rule (a changed body drops a stale
          // signature) instead of this form guessing at it.
          ...(signing ? { pgp_signature: signature.trim() } : {}),
        });
        if (res?.signature_cleared) {
          toast('Your PGP signature was removed — it covered the old wording', { icon: '🔓' });
        }
      } else {
        const created = await api.post('/reviews', {
          variant_id: item.variant_id,
          order_id: orderId,
          rating,
          body: body.trim() || undefined,
          pgp_signature: signing ? signature.trim() : undefined,
        });
        reviewId = created?.review?.id;
      }

      // Media second, exactly as the product page does it: a failed transcode
      // must never cost the buyer the words they just wrote.
      if (pending.length > 0 && reviewId) {
        try {
          const fd = new FormData();
          pending.forEach((f) => fd.append('files', f));
          await api.upload(`/reviews/${reviewId}/media`, fd);
        } catch (mediaErr) {
          toast.error(`Review saved, but the media failed: ${mediaErr.message || 'upload error'}`);
          onDone();
          return;
        }
      }

      toast.success(isEdit ? 'Review updated' : 'Review posted — thank you');
      onDone();
    } catch (err) {
      toast.error(err.message || 'Could not save the review');
    } finally {
      setBusy(false);
    }
  };

  // The server counts what is already attached when it caps a review at four
  // files, so an edit that adds two to an existing three is refused there. The
  // picker is simply hidden once the review is full rather than duplicating
  // that arithmetic and getting it subtly different.
  const roomLeft = Math.max(0, 4 - (existing?.media?.length || 0));

  return (
    <form className="oitem-compose" onSubmit={submit}>
      <div className="oitem-compose-row">
        <span className="oitem-compose-label" id={`rate-${item.id}`}>Your rating</span>
        {/* StarRating renders bare spans with no role, so the label has to be
            attached to a wrapper the assistive tree can see rather than to the
            component. The id above was orphaned without this. */}
        <span role="group" aria-labelledby={`rate-${item.id}`}>
          <StarRating rating={rating} interactive onRate={setRating} size={24} />
        </span>
      </div>

      <div className="form-group oitem-compose-body">
        <label htmlFor={`body-${item.id}`}>
          What did you think? <span className="field-opt">(optional)</span>
        </label>
        <textarea
          id={`body-${item.id}`}
          className="glass-input"
          value={body}
          maxLength={MAX_BODY}
          rows={4}
          placeholder="How was the item, the packaging, the wait?"
          onChange={(e) => setBody(e.target.value)}
        />
        <span className="oitem-compose-count">{body.length}/{MAX_BODY}</span>
      </div>

      {mediaEnabled && roomLeft > 0 && (
        <div className="oitem-compose-media">
          <span className="oitem-compose-label">
            <ImagePlus size={12} aria-hidden="true" /> Photos or a short clip
          </span>
          <ReviewMediaPicker files={pending} onChange={setPending} disabled={busy} />
          <p className="oitem-compose-hint">
            Every file is re-encoded before it is stored, so the location and device details
            your camera writes into it never leave your machine.
          </p>
        </div>
      )}

      <label className="oitem-compose-sign">
        <input type="checkbox" checked={signing} onChange={(e) => setSigning(e.target.checked)} />
        <span>
          Sign this review with my PGP key
          <em>Proves the words are yours to anyone holding your public key.</em>
        </span>
      </label>

      {signing && (
        <div className="form-group">
          <label htmlFor={`sig-${item.id}`}>Clear-signed message</label>
          <textarea
            id={`sig-${item.id}`}
            className="glass-input oitem-compose-sig"
            value={signature}
            rows={6}
            spellCheck="false"
            placeholder={'-----BEGIN PGP SIGNED MESSAGE-----'}
            onChange={(e) => setSignature(e.target.value)}
          />
          <p className="oitem-compose-hint">
            Sign the exact text above — the store checks that the signature covers it.
          </p>
        </div>
      )}

      <div className="oitem-compose-actions">
        <button type="submit" className="glass-btn glass-btn-primary glass-btn-sm" disabled={busy || !dirty}>
          {busy ? <span className="spinner spinner-inline" /> : <Send size={13} aria-hidden="true" />}
          {isEdit ? 'Save changes' : 'Post review'}
        </button>
        <button type="button" className="glass-btn glass-btn-sm" onClick={onCancel} disabled={busy}>
          <X size={13} aria-hidden="true" /> Cancel
        </button>
      </div>
    </form>
  );
}

function ItemRow({ item, order, review, mediaEnabled, canReview, isOwner, onReload }) {
  const [composing, setComposing] = useState(false);
  const lineTotal = item.price_at_purchase == null
    ? null
    : Number(item.price_at_purchase) * Number(item.quantity);
  const refunded = item.refunded_quantity || 0;
  const canSwap = order.item_actions?.can_swap && item.swap_eligibility?.allowed !== false && refunded < item.quantity;
  // The bench's own words, present only for staff — `utils/orderVisibility.js`
  // strips the short mark for the buyer, because the note is the shop talking
  // to itself and a customer should hear about a shortage as a substitution
  // offer rather than as a flag on their own order page.
  const isShort = Boolean(item.short_at);

  /*
   * ── Pre-running the substitution tool ──
   *
   * A packer marked this line short, which means somebody at a shelf has
   * already established that it cannot be filled. The person reading this page
   * holds `orders.swap_items` — that is what `can_swap` says — so the next act
   * is the offer, and making them find the line, read the note and press Swap
   * is three steps of a decision that has already been made.
   *
   * So the composer opens by itself, once, on mount. `useState`'s initialiser
   * rather than an effect, deliberately: an effect would re-open the dialog
   * every time the page reloaded after an offer was made, which would trap the
   * operator in a dialog they had just finished with.
   *
   * It opens rather than acts. The tool is a form — which replacement, how
   * many, what to say — and every one of those is the swap-holder's decision,
   * not the packer's. See `packBench.setShort` on why the two grants stay apart.
   */
  const [swapping, setSwapping] = useState(() => Boolean(item.short_at) && Boolean(order.item_actions?.can_swap) && item.swap_eligibility?.allowed !== false);

  const deleteMedia = async (mediaId) => {
    if (!confirm('Remove this attachment from your review?')) return;
    try {
      await api.delete(`/reviews/media/${mediaId}`);
      toast.success('Attachment removed');
      onReload();
    } catch (err) {
      toast.error(err.message || 'Could not remove it');
    }
  };

  return (
    <article className={`oitem${composing ? ' is-composing' : ''}`}>
      <div className="oitem-main">
        {/* The product's own picture, not a generic parcel glyph.
            `item.image` is already resolved server-side for every line —
            variant media first, the group's as fallback — and the boxes card
            below has been drawing it all along. This card was the one place
            that had the thumbnail available and rendered an icon instead, so a
            buyer reviewing what they ordered saw five identical boxes.
            The icon stays as the fallback: a deleted variant, or a product
            nobody uploaded media for, still needs something in the slot. */}
        {item.image
          ? <img className="oitem-thumb" src={item.image} alt="" loading="lazy" />
          : <span className="oitem-icon" aria-hidden="true"><Package size={15} /></span>}

        <div className="oitem-text">
          <h4 className="oitem-name">
            {item.group_id
              ? <Link to={`/products/${item.group_id}`}>{item.product_name}</Link>
              : item.product_name}
          </h4>
          <p className="oitem-meta">
            {item.variant_name}
            <span aria-hidden="true">·</span>
            <span className="oitem-qty">×{item.quantity}</span>
            {/* A refunded count is packing information as much as accounting:
                whoever fills this box needs to know not to put these in it. It
                shows for the buyer too, because it is their money. */}
            {refunded > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="oitem-refunded">
                  {refunded === item.quantity ? 'refunded' : `${refunded} refunded`}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="oitem-money">
          {lineTotal == null
            ? <span className="oitem-hidden">hidden</span>
            : <span className="oitem-total">{money(lineTotal)}</span>}
          {item.price_at_purchase != null && Number(item.quantity) > 1 && (
            <span className="oitem-unit">{money(item.price_at_purchase)} each</span>
          )}
        </div>
      </div>

      {/* ── Review state ─────────────────────────────────────────────── */}
      {review && !composing && (
        <div className="oitem-review">
          <div className="oitem-review-head">
            <StarRating rating={review.rating} size={15} />
            <span className="oitem-review-when">
              {review.updated_at
                ? `edited ${new Date(review.updated_at).toLocaleDateString()}`
                : new Date(review.created_at).toLocaleDateString()}
            </span>
            {review.pgp_signature && (
              <span className="oitem-review-sig" title="Signed with the author's PGP key">
                <ShieldCheck size={11} aria-hidden="true" /> signed
              </span>
            )}
            <button
              type="button"
              className="glass-btn glass-btn-sm oitem-review-edit"
              onClick={() => setComposing(true)}
            >
              <Pencil size={12} aria-hidden="true" /> Edit
            </button>
          </div>

          {review.body && <p className="oitem-review-body">{review.body}</p>}

          {review.media?.length > 0 && (
            <div className="oitem-review-media">
              {review.media.map((m) => (
                <figure key={m.id} className="oitem-media-thumb">
                  {m.media_type === 'video'
                    ? <video src={m.path} poster={m.poster_path || undefined} muted playsInline preload="metadata" />
                    : <img src={m.path} alt="" loading="lazy" />}
                  <button
                    type="button"
                    className="oitem-media-x"
                    onClick={() => deleteMedia(m.id)}
                    aria-label="Remove this attachment"
                    title="Remove"
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </figure>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Only the buyer is ever prompted about reviews. Staff looking at
          somebody else's order were being told "reviewable once delivered" on
          an order that was already delivered — a sentence aimed at a person who
          is not reading it. */}
      {!review && !composing && isOwner && (
        <div className="oitem-cta">
          {canReview ? (
            <button
              type="button"
              className="glass-btn glass-btn-sm oitem-review-btn"
              onClick={() => setComposing(true)}
            >
              <Star size={13} aria-hidden="true" /> Write a review
            </button>
          ) : (
            <span className="oitem-cta-note">
              You can review this once the order is marked delivered.
            </span>
          )}
        </div>
      )}

      {/* Staff actions on this line. Rendered from `order.item_actions`, which is
          the server's answer about this viewer and this order's state — the
          page never offers a button whose request would come back 403. */}
      {/* What the bench found, in the packer's own words. Above the actions
          because it is the reason the actions are being offered, and DESIGN §9:
          the screen should say what happened before it asks what to do. */}
      {isShort && (
        <div className="oitem-short" role="status">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>
            <strong>A packer could not fill this line.</strong>
            {item.short_note && <> “{item.short_note}”</>}
            {!canSwap && <> {item.swap_eligibility?.reason || 'Somebody with the swap grant can offer a substitute.'}</>}
          </span>
        </div>
      )}

      {canSwap && !swapping && (
        <div className="oitem-cta">
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => setSwapping(true)}
          >
            <ArrowLeftRight size={13} aria-hidden="true" /> Offer a swap
          </button>
        </div>
      )}

      {swapping && (
        <SwapComposer
          order={order}
          item={item}
          onCancel={() => setSwapping(false)}
          onDone={() => { setSwapping(false); onReload(); }}
        />
      )}

      {composing && (
        <ReviewComposer
          item={item}
          existing={review}
          mediaEnabled={mediaEnabled}
          orderId={order.id}
          onCancel={() => setComposing(false)}
          onDone={() => { setComposing(false); onReload(); }}
        />
      )}
    </article>
  );
}

export default function OrderItemsCard({ order, isOwner, mediaEnabled, onReload }) {
  const [reviews, setReviews] = useState([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refunding, setRefunding] = useState(false);

  /**
   * Re-read both halves after a review changes.
   *
   * The order itself may genuinely have moved (staff acting on it in another
   * tab), so the parent's fetch still runs; the counter is what re-reads the
   * reviews, which live on a different endpoint the order fetch knows nothing
   * about.
   */
  const reload = useCallback(() => {
    setRefreshKey((n) => n + 1);
    onReload?.();
  }, [onReload]);
  const items = Array.isArray(order.items) ? order.items : [];
  const canReview = isOwner && order.status === REVIEWABLE_STATUS;

  /**
   * The buyer's own reviews for the items on this order.
   *
   * Fetched per product group rather than per order because that is the
   * endpoint that exists, and a single order rarely spans more than a couple of
   * groups. Failures are silent: an order page must still render its items when
   * the review service is unhappy.
   */
  const groupIds = useMemo(
    () => [...new Set(items.map((i) => i.group_id).filter(Boolean))],
    [items],
  );

  useEffect(() => {
    if (!isOwner || groupIds.length === 0) return;
    let cancelled = false;
    Promise.all(groupIds.map((gid) => api.get(`/reviews/${gid}`).catch(() => null)))
      .then((results) => {
        if (cancelled) return;
        const mine = [];
        for (const r of results) {
          for (const review of r?.reviews || []) {
            // Ownership by id, not by username — the display name is the wrong
            // handle for a "may I edit this" decision.
            if (review.order_id === order.id) mine.push(review);
          }
        }
        setReviews(mine);
      });
    return () => { cancelled = true; };
    // `refreshKey` rather than `order.updated_at`: posting or editing a review
    // does not touch the order row, so keying the refetch on the order's own
    // timestamp meant a review the buyer had just written never appeared until
    // they reloaded the page.
  }, [groupIds.join(','), order.id, isOwner, refreshKey]);

  const reviewFor = (item) => reviews.find((r) => r.variant_id === item.variant_id) || null;

  const reviewable = canReview ? items.filter((i) => !reviewFor(i)).length : 0;

  // Open offers first, then the answered ones, each group newest first. The
  // server sends them newest-first as one list; the split is presentational,
  // and it is what keeps a live offer from being pushed below a month of
  // history on an order that has been argued over.
  const swaps = useMemo(() => {
    const all = Array.isArray(order.swaps) ? order.swaps : [];
    return [...all].sort((a, b) => (a.status === 'offered' ? 0 : 1) - (b.status === 'offered' ? 0 : 1));
  }, [order.swaps]);

  return (
    <section className="glass-card oitems">
      <header className="oitems-head">
        <h3 className="oitems-title">
          <Package size={15} aria-hidden="true" /> Items
          <span className="oitems-count">{items.length}</span>
        </h3>
        {reviewable > 0 && (
          <span className="oitems-nudge">
            <Star size={11} aria-hidden="true" />
            {reviewable} {reviewable === 1 ? 'item' : 'items'} left to review
          </span>
        )}
        {canReview && reviewable === 0 && items.length > 0 && (
          <span className="oitems-nudge is-done">
            <Check size={11} aria-hidden="true" /> All reviewed — thank you
          </span>
        )}
      </header>

      {/* Offers first, above the lines. An open offer is the one thing on this
          page waiting on somebody to act, and a buyer who does not answer holds
          up their own order and keeps the replacement out of the catalogue.
          Closed offers stay visible underneath: "we offered them the 250mg and
          they said no" is what stops the next person offering it again. */}
      {swaps.length > 0 && (
        <div className="oswaps">
          {swaps.map((swap) => (
            <SwapOffer
              key={swap.id}
              swap={swap}
              isOwner={isOwner}
              canManage={!!order.item_actions?.can_swap}
              onDone={reload}
            />
          ))}
        </div>
      )}

      <div className="oitems-list">
        {items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            order={order}
            review={isOwner ? reviewFor(item) : null}
            mediaEnabled={mediaEnabled}
            canReview={canReview}
            isOwner={isOwner}
            onReload={reload}
          />
        ))}
        {items.length === 0 && (
          <p className="oitems-empty">This order has no line items recorded.</p>
        )}
      </div>

      <dl className="oitems-ledger">
        {order.shipping_cost != null && Number(order.shipping_cost) > 0 && (
          <div className="oitems-ledger-row">
            <dt>Shipping</dt>
            <dd>{money(order.shipping_cost)}</dd>
          </div>
        )}
        {order.rail_adjustment != null && Math.abs(Number(order.rail_adjustment)) > 0.001 && (
          <div className={`oitems-ledger-row${Number(order.rail_adjustment) < 0 ? ' is-credit' : ''}`}>
            <dt>{Number(order.rail_adjustment) < 0 ? 'Payment method discount' : 'Payment method fee'}</dt>
            <dd>{Number(order.rail_adjustment) < 0 ? '−' : '+'}{money(Math.abs(Number(order.rail_adjustment)))}</dd>
          </div>
        )}
        {order.discount_amount != null && Number(order.discount_amount) > 0 && (
          <div className="oitems-ledger-row is-credit">
            <dt>Discount</dt>
            <dd>−{money(order.discount_amount)}</dd>
          </div>
        )}
        {order.store_credit_applied != null && Number(order.store_credit_applied) > 0 && (
          <div className="oitems-ledger-row is-credit">
            <dt>Store credit</dt>
            <dd>−{money(order.store_credit_applied)}</dd>
          </div>
        )}
        <div className="oitems-ledger-row is-total">
          <dt>Total</dt>
          <dd>
            {order.total == null
              ? <span className="oitem-hidden">hidden</span>
              : money(order.total)}
          </dd>
        </div>
        {/* Two refund rows, never one. They are different money on different
            rails: `credit_refund_total` has already landed in the buyer's
            balance, while `refund_amount` is a claim still to be paid out on
            chain by hand. Summing them would tell the buyer they had been given
            back twice what they have. */}
        {order.credit_refund_total != null && Number(order.credit_refund_total) > 0 && (
          <div className="oitems-ledger-row is-credit">
            <dt>Refunded to store credit</dt>
            <dd>{money(order.credit_refund_total)}</dd>
          </div>
        )}
        {order.refund_amount != null && Number(order.refund_amount) > 0 && (
          <div className="oitems-ledger-row is-credit">
            <dt>Refunded</dt>
            <dd>{money(order.refund_amount)}</dd>
          </div>
        )}
      </dl>

      {order.item_actions?.can_refund_credit && (
        refunding ? (
          <RefundComposer
            order={order}
            onCancel={() => setRefunding(false)}
            onDone={() => { setRefunding(false); reload(); }}
          />
        ) : (
          <div className="oitems-staff-actions">
            <button type="button" className="glass-btn glass-btn-sm" onClick={() => setRefunding(true)}>
              <Wallet size={13} aria-hidden="true" /> Refund items to store credit
            </button>
          </div>
        )
      )}
    </section>
  );
}
