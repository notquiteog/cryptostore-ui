/**
 * The volume band a quantity falls in — the display-side mirror of
 * pricingService.qualifyingTier, and the same rule: the qualifying row with the
 * HIGHEST min_qty wins, whatever it costs, with the cheaper row breaking a tie
 * inside one band. Selecting the cheapest qualifying row instead cannot express
 * a ladder that rises with quantity, and this catalog holds several.
 *
 * Labels are free text — this catalog holds both "3" and "3x" — so two rows can
 * describe the same break; the tie-break is what collapses them.
 *
 * Returns { minQty, price } or null.
 */
export function qualifyingTier(variant, quantity = 1) {
  let band = null;
  for (const tier of variant?.tiers || []) {
    const minQty = parseInt(tier.min_qty_label, 10);
    if (isNaN(minQty) || minQty < 1 || !(quantity >= minQty)) continue;
    const price = Number(tier.price);
    if (!Number.isFinite(price) || price < 0) continue;
    if (band === null || minQty > band.minQty || (minQty === band.minQty && price < band.price)) {
      band = { minQty, price };
    }
  }
  return band;
}

/**
 * Display-side mirror of the server's computeUnitPrice.
 *
 * The API has already applied the viewer's tier discount and sub-user markup to
 * every price it sends — list, volume tiers and the flash-sale price alike — and
 * it has already folded any active sale INTO each tier price, because a
 * percentage sale cannot be resolved without knowing which break the quantity
 * qualifies for (see productController.priceVariantWithSale). So a qualifying
 * band is the finished number: it is used as it stands.
 *
 * `sale_price` is the sale resolved against the LIST price, so it only decides
 * anything at quantities that reach no break at all. Taking the lowest of the
 * three, as this did, went wrong the moment a ladder could rise: a $27.99 list
 * with a 4+ band at $32.99 quoted the sale-on-list at four units while checkout
 * charged the sale on $32.99.
 *
 * This lives in one place because the three surfaces that quote a price (the
 * catalog grid, the featured carousel and the product page) had each worked it
 * out differently: two ignored the flash sale the API was already sending, and
 * the product page picked its volume tier by authoring order instead of by
 * qualifying quantity, so it could quote a worse break than checkout charged.
 */
export function effectiveUnitPrice(variant, quantity = 1) {
  if (!variant) return 0;
  const list = Number(variant.price);
  if (!Number.isFinite(list)) return 0;

  const band = qualifyingTier(variant, quantity);
  if (band) return band.price;

  const sale = variant.sale_price != null ? Number(variant.sale_price) : null;
  return sale != null && Number.isFinite(sale) && sale >= 0 ? Math.min(list, sale) : list;
}

/** The list price an effective price is struck through against. */
export function listUnitPrice(variant) {
  const price = Number(variant?.price);
  return Number.isFinite(price) ? price : 0;
}

/**
 * The headline price for a product card: the cheapest unit across a group's
 * variants at quantity 1, paired with the list price of that same variant so a
 * struck-through "was" always belongs to the number printed beside it.
 */
export function groupDisplayPrice(product) {
  let best = null;
  for (const v of product?.variants || []) {
    const list = listUnitPrice(v);
    const effective = effectiveUnitPrice(v, 1);
    if (best === null || effective < best.effective) {
      best = { effective, list, onSale: effective < list, saleLabel: v.sale_label || null };
    }
  }
  return best || { effective: 0, list: 0, onSale: false, saleLabel: null };
}

/** Whole-percent discount, for a "-30%" badge. */
export function discountPct(list, effective) {
  const l = Number(list), e = Number(effective);
  if (!Number.isFinite(l) || !Number.isFinite(e) || l <= 0 || e >= l) return 0;
  return Math.round(((l - e) / l) * 100);
}

/**
 * What a flash-sale discount leaves a unit costing — the display-side mirror of
 * pricingService.applyFlashSale.
 *
 * Exists so the admin's create form can quote the price the server is about to
 * store *before* it stores it. Worked in integer cents for the same reason the
 * server does: `3.30 * 0.75` is 2.4749999999999996 in binary, so a discount
 * landing on a half cent would round the other way here and the preview would
 * disagree with the saved figure by a cent on roughly one price point in forty.
 *
 * There is no absolute-price branch. `'price'` sales — "this variant now costs
 * $9" — were withdrawn because an absolute number cannot compose with a volume
 * break, and this comment used to claim the type was "still handled" when in
 * truth it fell through to the default like any unknown string. It falls
 * through deliberately now, and nothing can send it: both the baseline schema
 * and 20260917000000_retire_legacy_shims constrain the column to
 * ('percent', 'flat').
 */
export function applyFlashDiscount(listPrice, type, value) {
  const base = Number(listPrice);
  const amount = Number(value);
  if (!Number.isFinite(base) || !Number.isFinite(amount) || amount < 0) return null;

  const cents = Math.round(base * 100);
  switch (type) {
    case 'percent': {
      const numerator = cents * (10000 - Math.round(Math.min(amount, 100) * 100));
      const whole = Math.floor(numerator / 10000);
      const remainder = numerator - whole * 10000;
      return (remainder * 2 >= 10000 ? whole + 1 : whole) / 100;
    }
    case 'flat':
      return Math.max(0, cents - Math.round(amount * 100)) / 100;
    default:
      // An unrecognised discount applies nothing rather than being guessed at,
      // and the guard is kept for its own sake rather than for the withdrawn
      // type that prompted it. Mirrors pricingService.applyFlashSale, which is
      // what actually charges: the failure to avoid is an unknown shape read as
      // a replacement price, which quotes a discount off a number nobody
      // agreed to.
      return base;
  }
}
