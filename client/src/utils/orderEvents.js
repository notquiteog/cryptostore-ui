/**
 * "An order just changed" — said once, heard by whichever page shows it.
 *
 * ── Why an event ────────────────────────────────────────────────────────────
 *
 * The assistant's staff cards carry buttons that move an order (Accept, Ship,
 * Offer a swap — components/ai/ResultCard.jsx). The card lives in the
 * companion panel in the navbar; the order queue and the order page live in
 * routed pages nowhere near it in the tree, and both cache what they last
 * fetched. Before this, pressing Accept on a card left the queue behind it
 * still saying "paid" until the operator refreshed by hand, which reads as
 * the button not having worked.
 *
 * Same shape as `CART_CHANGED` in context/CartContext.jsx, for the same
 * reason: a one-way notification carrying an identifier is what a DOM event
 * is, and a page that unmounts stops listening by itself. The detail carries
 * the order's uuid so a listener showing ONE order can ignore the rest; the
 * queue refetches on any, because it may be showing that one.
 *
 * Fired only after the server said yes. A press that failed changed nothing,
 * and a refetch would only confirm that.
 */
export const ORDER_CHANGED = 'cs:order-changed';

/** @param {string|null} order the uuid of the order that changed, if known */
export function announceOrderChanged(order = null) {
  window.dispatchEvent(new CustomEvent(ORDER_CHANGED, { detail: { order } }));
}
