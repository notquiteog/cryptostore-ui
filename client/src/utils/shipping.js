/**
 * Shipping cost from the store's `shipping_tiers` setting.
 *
 * The setting is a JSON array of `{ min_qty, price }`; the tier that applies is
 * the highest `min_qty` the item count reaches. Checkout has always resolved it
 * this way, and the product page now quotes shipping too — so the rule lives in
 * one place rather than being reimplemented next to the second surface that
 * prints the number. `orderController.js` runs the same ladder server-side and
 * is what actually charges.
 *
 * Anything malformed resolves to 0: a store that has not configured shipping
 * should read as free, not as NaN.
 */
/**
 * MIRRORS `services/botOrders.calculateShipping`, which is the authority.
 *
 * The duplication is unavoidable and bounded: the client has to quote a
 * shipping cost before an order exists, and there is no server figure to read
 * until one does. What it must never become is a second POLICY — the server
 * recomputes this at checkout and its answer is what the buyer is charged, so
 * a divergence here shows up as a total that changes when Place Order is
 * pressed.
 *
 * Both sort by `min_qty` descending and take the first tier the quantity
 * reaches, and both fall back to zero on anything unparseable. If you change
 * one, change the other.
 */
export function shippingCostFor(tiersJson, totalItems) {
  try {
    const tiers = typeof tiersJson === 'string' ? JSON.parse(tiersJson || '[]') : (tiersJson || []);
    if (!Array.isArray(tiers) || tiers.length === 0) return 0;
    const sorted = [...tiers].sort((a, b) => b.min_qty - a.min_qty);
    for (const tier of sorted) {
      if (totalItems >= tier.min_qty) return parseFloat(tier.price) || 0;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * The next quantity that would make shipping cheaper, if there is one.
 *
 * DISPLAY ONLY — it reads the same ladder `shippingCostFor` does and charges
 * nothing. It exists because the cart quotes a shipping figure now, and a
 * quote with no context is a number the buyer cannot act on: a store whose
 * tiers are `[{min_qty:1,price:12},{min_qty:5,price:0}]` is offering free
 * shipping four units away and never said so.
 *
 * Returns `null` when no reachable tier is cheaper than the current one, which
 * covers the ordinary case of a flat rate, an unconfigured store, and a ladder
 * that only ever gets more expensive. `addUnits` is how many more items the
 * cart needs, never zero.
 */
export function nextShippingBreak(tiersJson, totalItems) {
  try {
    const tiers = typeof tiersJson === 'string' ? JSON.parse(tiersJson || '[]') : (tiersJson || []);
    if (!Array.isArray(tiers) || tiers.length === 0) return null;

    const current = shippingCostFor(tiersJson, totalItems);
    let best = null;
    for (const tier of tiers) {
      const min = Number(tier.min_qty);
      const price = parseFloat(tier.price) || 0;
      if (!Number.isFinite(min) || min <= totalItems) continue;
      if (price >= current) continue;
      // A tier only applies if it is the HIGHEST min_qty the count reaches, so
      // quote the price that ladder would actually resolve to at `min` rather
      // than this row's own price — with two tiers at the same threshold the
      // row read here is not necessarily the one that wins.
      const resolved = shippingCostFor(tiersJson, min);
      if (resolved >= current) continue;
      if (!best || min < best.at) best = { at: min, price: resolved };
    }
    return best ? { addUnits: best.at - totalItems, price: best.price } : null;
  } catch {
    return null;
  }
}

/**
 * A delivery-estimate window, as a person would say it.
 *
 * Lived in pages/Checkout.jsx, which pages/OrderDetail.jsx then imported —
 * and since Checkout ships in the entry chunk, that one import for one
 * seven-line formatter pinned the whole order page into it. A shared helper
 * belongs in a shared file; a page is not one.
 */
export function fmtDayRange(r) {
  if (!r) return null;
  const { lo, hi } = r;
  if (hi <= 1) return 'within a day';
  const unit = (d) => (d >= 14 ? `${Math.round(d / 7)} wk` : `${d % 1 === 0 ? d : d.toFixed(1)} day${d === 1 ? '' : 's'}`);
  return lo === hi ? unit(hi) : `${lo % 1 === 0 ? lo : lo.toFixed(1)}–${unit(hi)}`;
}
