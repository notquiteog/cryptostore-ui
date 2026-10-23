import { useState } from 'react';
import { Package, CircleCheck, Clock, ChevronDown, MailX } from 'lucide-react';

/**
 * The parcels an order ships in, on the order page — buyer and staff alike.
 *
 * Read-only by design: boxes are created and weighed at the packing bench and
 * dispatched from the Ship desk; this card is the record both of those write.
 * The buyer sees their own order in full; a staff viewer's weight and note
 * answer to `orders.view_shipping` via the server's redaction, and a withheld
 * field shows as "hidden" rather than as an empty cell.
 *
 * ── How contents render ─────────────────────────────────────────────────────
 *
 * Collapsed by default: the head of each box carries a strip of product
 * thumbnails (up to four, then "+N") and the unit count — enough to tell two
 * parcels apart at a glance — and expands to the itemised list on tap. The
 * thumbnails come from `order.items[].image`, the same catalogue media the
 * cart shows, resolved server-side per line.
 *
 * A single box with no recorded rows truthfully holds the whole order and
 * renders every line. A multi-parcel order shows exactly what the packer
 * recorded, and a box they recorded nothing for says "contents not recorded"
 * rather than guessing.
 */

const fmtWeight = (g) => (g == null ? null : g >= 1000 ? `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 1)} kg` : `${g} g`);

function Thumb({ item, size = 'md' }) {
  return item.image
    ? <img className={`obox-thumb is-${size}`} src={item.image} alt="" loading="lazy" />
    : (
      <span className={`obox-thumb is-${size} is-empty`} aria-hidden="true">
        <Package size={size === 'sm' ? 12 : 16} />
      </span>
    );
}

function BoxEntry({ box, entries, tracking, isAdmin, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen);

  const units = entries.reduce((s, e) => s + e.quantity, 0);
  const hasContents = entries.length > 0;
  const preview = entries.slice(0, 4);
  const overflow = entries.length - preview.length;

  return (
    <li className={`obox${box.shipped_at ? ' is-shipped' : ''}`}>
      {/* The head is the whole tap target when there is something to expand —
          a chevron alone is a fiddly target on a phone. */}
      <button
        type="button"
        className="obox-head"
        onClick={() => hasContents && setOpen((v) => !v)}
        aria-expanded={hasContents ? open : undefined}
        disabled={!hasContents}
      >
        <span className="obox-name">
          Box {box.box_number}
          {box.redacted && box.weight_grams === null
            ? <span className="obox-chip" title="Hidden — weight needs shipping access">weight hidden</span>
            : fmtWeight(box.weight_grams) && <span className="obox-chip">{fmtWeight(box.weight_grams)}</span>}
          {box.untracked && tracking.length === 0 && (
            <span className="obox-chip is-untracked" title="This parcel ships without a tracking number">
              <MailX size={10} aria-hidden="true" /> no tracking
            </span>
          )}
        </span>

        {hasContents ? (
          <span className="obox-strip" aria-label={`${units} unit${units === 1 ? '' : 's'} in this box`}>
            <span className="obox-strip-thumbs">
              {preview.map((e) => <Thumb key={e.key} item={e} size="sm" />)}
              {overflow > 0 && <span className="obox-strip-more">+{overflow}</span>}
            </span>
            <span className="obox-strip-count">{units} unit{units === 1 ? '' : 's'}</span>
          </span>
        ) : (
          <span className="obox-strip is-unknown">contents not recorded</span>
        )}

        <span className={`obox-state${box.shipped_at ? ' is-shipped' : ''}`}>
          {box.shipped_at ? (
            <span title={new Date(box.shipped_at).toLocaleString()}>
              <CircleCheck size={13} aria-hidden="true" />
              shipped {new Date(box.shipped_at).toLocaleDateString()}
              {isAdmin && box.shipped_by_username && <em> · {box.shipped_by_username}</em>}
            </span>
          ) : (
            <span><Clock size={13} aria-hidden="true" /> awaiting dispatch</span>
          )}
        </span>

        {hasContents && <ChevronDown size={15} aria-hidden="true" className={`obox-chev${open ? ' is-open' : ''}`} />}
      </button>

      {(tracking.length > 0 || box.note) && (
        <div className="obox-track">
          {tracking.map((t) => (
            <code key={t.id} title={t.carrier || undefined}>
              {t.carrier ? `${t.carrier} · ` : ''}{t.tracking_number || 'tracking hidden'}
            </code>
          ))}
          {box.note && <span className="obox-note">{box.note}</span>}
        </div>
      )}

      {hasContents && open && (
        <ul className="obox-items">
          {entries.map((e) => (
            <li key={e.key} className="obox-item">
              <Thumb item={e} />
              <span className="obox-item-name">
                {e.product_name}
                {e.variant_name && e.variant_name !== e.product_name && (
                  <span className="obox-item-variant">{e.variant_name}</span>
                )}
              </span>
              <span className="obox-item-qty">×{e.quantity}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function OrderBoxesCard({ order, isAdmin }) {
  const boxes = Array.isArray(order.boxes) ? order.boxes : [];
  if (boxes.length === 0) return null;

  const orderItems = Array.isArray(order.items) ? order.items : [];
  const itemById = new Map(orderItems.map((i) => [i.id, i]));
  const trackingRows = Array.isArray(order.tracking_numbers) ? order.tracking_numbers : [];

  const singleBox = boxes.length === 1;
  const shipped = boxes.filter((b) => b.shipped_at).length;

  /**
   * The lines to show for one box, image and name resolved from the order's
   * own item list. Recorded contents win; a lone box with nothing recorded
   * truthfully holds every line the buyer is still owed.
   */
  const entriesOf = (box) => {
    const recorded = Array.isArray(box.items) ? box.items : [];
    if (recorded.length > 0) {
      return recorded.map((c) => {
        const item = itemById.get(c.order_item_id);
        return {
          key: `r${c.order_item_id}`,
          quantity: c.quantity,
          product_name: c.product_name,
          variant_name: c.variant_name,
          image: item?.image || null,
        };
      });
    }
    if (!singleBox) return [];
    return orderItems
      .map((item) => ({
        key: `i${item.id}`,
        quantity: Math.max(0, (item.quantity || 0) - (item.refunded_quantity || 0)),
        product_name: item.product_name,
        variant_name: item.variant_name,
        image: item.image || null,
      }))
      .filter((e) => e.quantity > 0);
  };

  return (
    <div className="obox-card">
      <h3 className="obox-title">
        <Package size={15} aria-hidden="true" /> Boxes
        <span className="obox-title-sub">{shipped} of {boxes.length} shipped</span>
      </h3>
      <ul className="obox-list">
        {boxes.map((box) => (
          <BoxEntry
            key={box.id}
            box={box}
            entries={entriesOf(box)}
            tracking={trackingRows.filter((t) => t.box_id === box.id)}
            isAdmin={isAdmin}
            defaultOpen={false}
          />
        ))}
      </ul>
    </div>
  );
}
