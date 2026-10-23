import { useCallback, useEffect, useState } from 'react';
import Barcode from '../Barcode';
// The tag shape, and the short reference under it. One author, shared with the
// server's utils/boxTags.js and pinned to it by client/test/boxTag.test.mjs —
// this file used to spell both itself. Re-exported because ShipDesk and
// BoxesPanel import `boxTag` from here and the sheets are where it belongs
// conceptually; the definition is not here any more.
import { boxTag, refOf as shortRef } from '../../utils/boxTag';

export { boxTag };

/**
 * The paper the bench and the desk print, and the one rule they share.
 *
 * ── Two sheets, one contract ────────────────────────────────────────────────
 *
 *   Box tags       one per carton, printed at the bench. Store name, the tag
 *                  (`3F2A9C1E-2`) as text and as Code 128, BOX 2 OF 3, what
 *                  is in it, weight, carton. The packer sticks one on each box
 *                  and the Ship desk scans it back to the right row. A store
 *                  with no printer writes the tag on with a marker — it is
 *                  nine characters, which is why the tag is also printed on
 *                  screen beside every box.
 *
 *   Packing slip   the contents of the whole order, by box, with the order
 *                  reference as Code 128. Goes IN the parcel, for the buyer.
 *
 * Neither carries an address, a name, a price or a total. The address label
 * is a different sheet (ShipDesk's LabelSheet) printed by someone with
 * shipping access; these two are printed by a packer whose screens never
 * receive an address, and a sheet that a blind role cannot print is a sheet
 * that role cannot lose. Prices are absent even for a viewer who could see
 * them — a packing slip with money on it is an invoice, and the store already
 * has a receipt for that.
 *
 * ── How printing works ──────────────────────────────────────────────────────
 *
 * The sheets are in the DOM and hidden on screen; `usePrintMode` puts a class
 * on the page for the duration of one print, and the print CSS in
 * 89-fulfilment-flow.css shows only the sheet that class names — the same
 * `body:has()` gate the pull sheet, pack slip and address label already use,
 * so a fulfilment page cannot change what any other page prints.
 */

/** Names as the order line records them, not as the catalogue has them now. */
const lineLabel = (item) => (item.variant_name && item.variant_name !== item.product_name
  ? `${item.product_name} — ${item.variant_name}`
  : item.product_name);


const fmtWeight = (g) => (g == null ? null : g >= 1000 ? `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 1)} kg` : `${g} g`);

/**
 * Put `className` on the page for one print. Cleared on `afterprint`, and
 * as a fallback on a timer for engines that never fire it. Returns the class
 * currently applied (or null) and a `print(name)` to start one.
 */
export function usePrintMode() {
  const [mode, setMode] = useState(null);
  useEffect(() => {
    if (!mode) return undefined;
    // Two frames: one for React to commit the class, one for layout before
    // the print dialog snapshots the page.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
    const done = () => setMode(null);
    window.addEventListener('afterprint', done);
    const fallback = setTimeout(done, 5000);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('afterprint', done); clearTimeout(fallback); };
  }, [mode]);
  return [mode, useCallback((name) => setMode(name), [])];
}

/**
 * What one box holds, as `{ quantity, label }` rows. A single box with no
 * recorded rows truthfully holds the whole order; a multi-box order shows
 * what the packer recorded and says so when they recorded nothing.
 */
function contentsOf(box, items, singleBox) {
  const rows = (box.items || [])
    .map((a) => {
      const item = items.find((i) => i.id === a.order_item_id);
      return item ? { quantity: a.quantity, label: lineLabel(item) } : null;
    })
    .filter(Boolean);
  if (rows.length === 0 && singleBox) {
    return items
      .map((i) => ({ quantity: Math.max(0, (i.quantity || 0) - (i.refunded_quantity || 0)), label: lineLabel(i) }))
      .filter((r) => r.quantity > 0);
  }
  return rows;
}

const MAX_TAG_LINES = 6;

export function BoxTagSheet({ storeName, order, boxes, items }) {
  const total = boxes.length;
  return (
    <div className="fsheet fsheet-tags" aria-hidden="true">
      {boxes.map((box) => {
        const tag = boxTag(order.uuid, box.box_number);
        const rows = contentsOf(box, items, total === 1);
        const shown = rows.slice(0, MAX_TAG_LINES);
        const more = rows.length - shown.length;
        return (
          <article key={box.id} className="ftag">
            <header className="ftag-head">
              <span className="ftag-store">{storeName || 'Store'}</span>
              <span className="ftag-box">BOX {box.box_number} OF {total}</span>
            </header>
            <div className="ftag-code">
              <Barcode value={tag} height={54} title={tag} />
              <span className="ftag-tag">{tag}</span>
            </div>
            <ul className="ftag-lines">
              {shown.map((r, i) => (
                <li key={i}><b>{r.quantity}×</b> {r.label}</li>
              ))}
              {more > 0 && <li className="ftag-more">+{more} more line{more === 1 ? '' : 's'} — see the packing slip</li>}
              {rows.length === 0 && <li className="ftag-more">contents not recorded</li>}
            </ul>
            <footer className="ftag-foot">
              {box.preset_name && <span>{box.preset_name}</span>}
              {fmtWeight(box.weight_grams) && <span>{fmtWeight(box.weight_grams)}</span>}
              {box.note && <span className="ftag-note">{box.note}</span>}
            </footer>
          </article>
        );
      })}
    </div>
  );
}

export function PackingSlipSheet({ storeName, order, boxes, items }) {
  const ref = shortRef(order.uuid, order.id);
  const multi = boxes.length > 1;
  const units = items.reduce((s, i) => s + Math.max(0, (i.quantity || 0) - (i.refunded_quantity || 0)), 0);
  return (
    <div className="fsheet fsheet-slip" aria-hidden="true">
      <header className="fslip-head">
        <div>
          <div className="fslip-store">{storeName || 'Store'}</div>
          <div className="fslip-title">Packing slip</div>
          <div className="fslip-meta">
            Order {ref} · {units} unit{units === 1 ? '' : 's'} · {boxes.length} box{boxes.length === 1 ? '' : 'es'}
            {' '}· packed {new Date().toLocaleDateString()}
          </div>
        </div>
        <div className="fslip-code">
          <Barcode value={ref} height={48} title={ref} />
          <span>{ref}</span>
        </div>
      </header>

      {multi ? boxes.map((box) => {
        const rows = contentsOf(box, items, false);
        return (
          <section key={box.id} className="fslip-box">
            <h3>Box {box.box_number} of {boxes.length} <span className="fslip-tag">{boxTag(order.uuid, box.box_number)}</span></h3>
            <table className="fslip-table">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}><td className="fslip-qty">{r.quantity}</td><td>{r.label}</td></tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={2} className="fslip-none">contents not recorded</td></tr>}
              </tbody>
            </table>
          </section>
        );
      }) : (
        <table className="fslip-table">
          <thead><tr><th className="fslip-qty">Qty</th><th>Item</th></tr></thead>
          <tbody>
            {contentsOf(boxes[0] || { items: [] }, items, true).map((r, i) => (
              <tr key={i}><td className="fslip-qty">{r.quantity}</td><td>{r.label}</td></tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="fslip-foot">
        This slip lists what was packed. It carries no prices and no address — your receipt is on your order page.
      </footer>
    </div>
  );
}
