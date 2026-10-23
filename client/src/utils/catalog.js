/**
 * Small shape helpers every surface that renders a product card needs: the
 * catalog grid, the product page's related/recently-viewed rails, and anything
 * that follows. Group imagery wins over variant imagery, and a group counts as
 * stocked if any one of its live variants has units.
 */

/**
 * The still image that represents one media row.
 *
 * A media slot can now hold a video, and `<img src="…​.webm">` is a broken-image
 * icon on every card in the catalogue. A video's still is the poster frame the
 * encoder pulled from it; a video with no poster has no thumbnail at all and
 * yields null so the caller can fall through to the next slot.
 */
export function mediaThumb(row) {
  if (!row) return null;
  if (row.media_type === 'video') return row.poster_path || null;
  return row.path || null;
}

/** First usable still for a group: its own media, else the first variant's. */
export function productThumb(product) {
  for (const img of product?.images || []) {
    const thumb = mediaThumb(img);
    if (thumb) return thumb;
  }
  for (const v of product?.variants || []) {
    for (const img of v.images || []) {
      const thumb = mediaThumb(img);
      if (thumb) return thumb;
    }
  }
  return null;
}

/** Whether anything in the group can actually be bought right now. */
export function productInStock(product) {
  return (product?.variants || []).some(v => v.quantity > 0);
}

/*
 * Recently-viewed products.
 *
 * Stores only what a card needs to be *identified* — id, name, category,
 * thumbnail — and deliberately not a price. A remembered price goes stale the
 * moment a flash sale starts or ends, and a stale figure sitting beside a live
 * one is the exact disagreement the shared pricing helpers exist to prevent.
 * The rail prints no price for these; the live page is one click away.
 *
 * Fails silently in every direction: private browsing, a disabled store and a
 * full quota all raise here, and none of them is worth breaking a product page
 * over.
 */
const RECENT_KEY = 'cs.recent.v1';
const RECENT_MAX = 12;

export function readRecentlyViewed() {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(r => r && typeof r.id === 'number') : [];
  } catch {
    return [];
  }
}

export function rememberViewed(product) {
  if (!product?.id) return;
  try {
    const entry = {
      id: product.id,
      name: product.name,
      category: product.category || null,
      thumb: productThumb(product),
    };
    const next = [entry, ...readRecentlyViewed().filter(r => r.id !== entry.id)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — the rail simply stays empty */
  }
}

// Alternate pack sizes describe the same goods. Adding their availability
// counts that pool repeatedly (100 boxes + 1000 ten-packs are not 1100 packs).
export function productStock(product) {
  if (product?.breakdown_enabled) return Math.max(0, Number(product.stock_quantity) || 0);
  return (product?.variants || []).reduce((sum, v) => sum + Math.max(0, Number(v.quantity) || 0), 0);
}
