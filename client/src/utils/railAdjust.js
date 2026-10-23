/**
 * The per-rail fee or discount, as the checkout previews it — a mirror of
 * server/services/pricingService.railAdjustmentCents, for SAYING what the
 * line will be before the order exists. The server is the authority at
 * checkout; this exists so the tile can read "−2% · −$1.23" and the ledger
 * can show the line the moment a rail is picked, from the same public
 * `payment_rail_adjustments` blob the engine reads.
 *
 * Same rules, same rounding: percent of the resolved subtotal, magnitude
 * rounded half-up to the cent, a discount clamped at the goods, and it sits
 * after the tier/sale prices and before the coupon.
 */

export function parseRailPolicy(raw) {
  try {
    const data = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    const out = {};
    for (const [rail, entry] of Object.entries(data)) {
      const value = Number(entry?.value);
      if (!Number.isFinite(value) || value === 0) continue;
      out[rail] = { kind: entry.kind === 'flat' ? 'flat' : 'percent', value };
    }
    return out;
  } catch {
    return {};
  }
}

/** Signed dollars for `method` on `subtotal` dollars, or 0. */
export function railAdjustment(subtotal, method, policy) {
  const entry = policy?.[method];
  if (!entry) return 0;
  const base = Math.max(0, Math.round(Number(subtotal || 0) * 100));
  let cents;
  if (entry.kind === 'flat') cents = Math.round(entry.value * 100);
  else {
    const magnitude = Math.round(base * Math.abs(entry.value) / 100);
    cents = entry.value < 0 ? -magnitude : magnitude;
  }
  if (cents < 0 && -cents > base) cents = -base;
  return (cents || 0) / 100;
}

/** "+2%" / "−$3.00" — the short form for a chip. */
export function railLabel(entry) {
  if (!entry) return null;
  const sign = entry.value < 0 ? '−' : '+';
  return entry.kind === 'flat'
    ? `${sign}$${Math.abs(entry.value).toFixed(2)}`
    : `${sign}${Math.abs(entry.value)}%`;
}
