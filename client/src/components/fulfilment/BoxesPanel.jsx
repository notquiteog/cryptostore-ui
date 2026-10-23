import { useEffect, useMemo, useRef, useState } from 'react';
import Carton from './Carton';
import toast from 'react-hot-toast';
import { Package, Plus, Trash2, Lock, Minus, Boxes, ChevronDown, PackageCheck, PackageOpen, Tags, FileText, MapPin } from 'lucide-react';
import { api } from '../../utils/api';
import { playSound } from '../../utils/sounds';
import QtyInput from './QtyInput';
import { boxTag } from './PrintSheets';

/**
 * The boxes step of the bench: what parcels this order leaves in, and —
 * when there is more than one — what went in which.
 *
 * ── The contents model, and why the UI is box-first ─────────────────────────
 *
 * A packer's mental model is "what did I put in this box", not "which box did
 * line three go to" — so contents are edited ON the box, never as a dropdown
 * per line. Three interaction tiers, cheapest first:
 *
 *   one box     — nothing to say. The box shows an "everything" badge and no
 *                 contents UI at all, because one box means everything is in
 *                 it and that is already true without a single tap.
 *   the split   — the moment Box 2 exists, a tray appears listing what is not
 *                 yet in any box, and each box grows an "Add items" list where
 *                 ONE tap moves all of a line's remaining units in — the
 *                 dominant physical case ("torches in 1, the rest in 2") is
 *                 one tap per line.
 *   the fixup   — chips on each box carry −/+ steppers for the three-of-five
 *                 case: + draws from the unassigned tray, − returns to it.
 *                 Nothing ever moves box-to-box implicitly; units always pass
 *                 through "unassigned", so every tap has one visible effect.
 *
 * Recording contents is OPTIONAL — the tray nags nobody and completion never
 * demands it. Quantities are sent ABSOLUTE (the setPicked idempotency rule),
 * and every response replaces the whole boxes array, so a move that touches
 * two boxes can never leave one of them stale on screen.
 *
 * ── Sealing ─────────────────────────────────────────────────────────────────
 *
 * Sealing says the carton is taped shut. Every affordance that would change
 * what is inside — the ± steppers, the quantity field, Add items, and Remove —
 * is not merely disabled but REMOVED, because a row of greyed-out buttons on a
 * box you have already taped is noise at a bench where the next box is
 * waiting. The seal is reversible by anyone at the bench: they are the person
 * holding the tape, and a permission wall here would only produce boxes whose
 * recorded contents are quietly wrong.
 *
 * Weight and note stay editable while sealed on purpose — a packer weighs the
 * parcel AFTER taping it, and making them unseal to record the number would
 * turn the seal into something people work around. The server enforces the
 * same split (`boxEditBlock`), so this is presentation of a rule, not the rule.
 *
 * Weight is integer grams saved on blur; a shipped box renders locked — its
 * record is what physically left the building.
 */

const lineLabel = (item) => (item.variant_name && item.variant_name !== item.product_name
  ? `${item.product_name} — ${item.variant_name}`
  : item.product_name);

const outstandingOf = (item) => Math.max(0, (item.quantity || 0) - (item.refunded_quantity || 0));

function BoxRow({
  box, orderId, orderUuid, orderItems, remainingByLine, disabled, multiBox, totalUnits,
  requireTracking, stagingPlaces, onChanged, onBoxesChange, onRemoved, removable,
}) {
  const [weight, setWeight] = useState(box.weight_grams == null ? '' : String(box.weight_grams));
  const [note, setNote] = useState(box.note || '');
  // Where the carton was put down. Only ever rendered when the operator has
  // named somewhere to put things — a store with one bench and one table is
  // not asked a question that has one answer. See config/fulfilmentKeys.js.
  const [place, setPlace] = useState(box.staged_location || '');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const shipped = !!box.shipped_at;
  const sealed = !!box.sealed_at;
  // What stops contents changing. Shipped and sealed are different facts with
  // the same consequence, and every content control below reads this one flag
  // rather than testing both — the server's `boxEditBlock` makes the same move.
  const frozen = shipped || sealed;
  const inBox = new Map(box.items.map((i) => [i.order_item_id, i.quantity]));
  const unitsInBox = box.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

  // Chips that ARRIVED since the last render get the arrival animation: the
  // unit travelled from the tray into this box, and the chip is where it
  // landed. A ref rather than state, because the comparison is against what
  // was on screen a moment ago, not against anything the server said.
  const seenQty = useRef(new Map());
  const arrived = new Set();
  for (const alloc of box.items) {
    if ((seenQty.current.get(alloc.order_item_id) || 0) < alloc.quantity) arrived.add(alloc.order_item_id);
  }
  useEffect(() => {
    seenQty.current = new Map(box.items.map((i) => [i.order_item_id, i.quantity]));
  });

  const save = async (patch) => {
    setBusy(true);
    try {
      const res = await api.put(`/fulfilment/orders/${orderId}/boxes/${box.id}`, patch);
      onChanged(res.box);
    } catch (err) {
      toast.error(err.message || 'Could not save the box');
      setWeight(box.weight_grams == null ? '' : String(box.weight_grams));
      setNote(box.note || '');
      setPlace(box.staged_location || '');
    } finally {
      setBusy(false);
    }
  };

  const saveWeight = () => {
    const trimmed = weight.trim();
    const stored = box.weight_grams == null ? '' : String(box.weight_grams);
    if (trimmed === stored) return;
    if (trimmed === '') return save({ weight_grams: null });
    const grams = parseInt(trimmed, 10);
    if (!Number.isInteger(grams) || grams < 0 || grams > 1_000_000) {
      toast.error('Weight is whole grams, 0–1,000,000');
      setWeight(stored);
      return;
    }
    save({ weight_grams: grams });
  };

  const saveNote = () => {
    const trimmed = note.trim();
    if (trimmed === (box.note || '')) return;
    save({ note: trimmed });
  };

  const savePlace = () => {
    const trimmed = place.trim();
    if (trimmed === (box.staged_location || '')) return;
    // The empty string is how "take it off the shelf record" is said; the
    // server turns it into a null location and a null date, which the CHECK
    // on the table requires to move together.
    save({ staged_location: trimmed });
  };

  /**
   * Sealing is the moment the carton leaves the packer's hands, so it is the
   * moment the staging place is asked for — and it rides the SAME request, so
   * a packer who taped the box and walked away cannot leave a sealed carton
   * with no recorded home because a second call did not fire.
   */
  const setSeal = async (next) => {
    setBusy(true);
    playSound('tick');
    try {
      const body = { sealed: next };
      const trimmed = place.trim();
      if (next && stagingPlaces?.length && trimmed !== (box.staged_location || '')) {
        body.staged_location = trimmed;
      }
      const res = await api.put(`/fulfilment/orders/${orderId}/boxes/${box.id}/seal`, body);
      onBoxesChange(res.boxes);
    } catch (err) {
      toast.error(err.message || 'Could not change the seal');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`/fulfilment/orders/${orderId}/boxes/${box.id}`);
      onRemoved(box);
    } catch (err) {
      toast.error(err.message || 'Could not remove the box');
      setBusy(false);
    }
  };

  /** Absolute set of one line's units in this box; server echoes ALL boxes. */
  const allocate = async (item, quantity) => {
    setBusy(true);
    playSound('tick');
    try {
      const res = await api.put(`/fulfilment/orders/${orderId}/boxes/${box.id}/items`, {
        order_item_id: item.id, quantity,
      });
      onBoxesChange(res.boxes);
    } catch (err) {
      toast.error(err.message || 'Could not record the contents');
    } finally {
      setBusy(false);
    }
  };

  // Lines with units still outside every box — what "Add items" can offer.
  const addable = orderItems.filter((item) => (remainingByLine.get(item.id) || 0) > 0);

  return (
    <li className={`boxp-row${shipped ? ' is-shipped' : ''}${sealed && !shipped ? ' is-sealed' : ''}`}>
      <div className="boxp-row-head">
        <span className="boxp-label">
          <Carton
            size={22}
            filled={multiBox ? unitsInBox : totalUnits}
            capacity={totalUnits}
            sealed={sealed || shipped}
            className="boxp-carton"
            label={multiBox
              ? `${unitsInBox} of the order's ${totalUnits} unit${totalUnits === 1 ? '' : 's'} in box ${box.box_number}`
              : `Every unit of the order — ${totalUnits} — in this box`}
          />
          Box {box.box_number}
          {/* The tag: what goes on the carton so the Ship desk can tell three
              identical boxes apart. Always visible, never behind a hover —
              a packer with no printer writes it on with a marker. */}
          <span className="boxp-tag" title="Write this on the carton, or print the tags — the Ship desk scans or types it to find this box">
            {boxTag(orderUuid, box.box_number)}
          </span>
          {shipped && (
            <span className="boxp-shipped" title={`Shipped ${new Date(box.shipped_at).toLocaleString()}`}>
              <Lock size={11} aria-hidden="true" /> shipped
            </span>
          )}
          {sealed && !shipped && (
            <span className="boxp-sealed" title={`Sealed ${new Date(box.sealed_at).toLocaleString()}`}>
              <PackageCheck size={11} aria-hidden="true" /> sealed
            </span>
          )}
          {/* Repeated up here as well as in the field below, because this row
              is what the packer scans down when they come back to an order —
              and "which of these have I put away" is read, not typed. */}
          {box.staged_location && !shipped && (
            <span className="boxp-staged" title={box.staged_at
              ? `Put there ${new Date(box.staged_at).toLocaleString()}`
              : 'Where this carton is standing'}>
              <MapPin size={11} aria-hidden="true" /> {box.staged_location}
            </span>
          )}
          {box.preset_name && (
            <span className="boxp-preset" title="Carton this box was made from">{box.preset_name}</span>
          )}
          {!multiBox && (
            <span className="boxp-everything" title="One box: every unit of the order is in it">
              everything — {totalUnits} unit{totalUnits === 1 ? '' : 's'}
            </span>
          )}
          {/* Only meaningful under required tracking: the exemption for the
              parcel that has no number to give. A statement about the box,
              made by the person holding it. */}
          {requireTracking && !shipped && (
            <button
              type="button"
              className={`boxp-untracked${box.untracked ? ' is-on' : ''}`}
              onClick={() => save({ untracked: !box.untracked })}
              disabled={disabled || busy}
              aria-pressed={box.untracked}
              title={box.untracked
                ? 'This box ships without a tracking number (letter mail). Press to require one again.'
                : 'Ships without a tracking number? Letter mail has none to enter — this frees the box from the tracking gate.'}
            >
              no tracking
            </button>
          )}
          {requireTracking && shipped && box.untracked && (
            <span className="boxp-untracked is-on" title="Shipped without a tracking number">no tracking</span>
          )}
        </span>

        <label className="boxp-field">
          <span className="boxp-field-name">Weight</span>
          <span className="boxp-weight">
            <input
              className="glass-input"
              type="number"
              inputMode="numeric"
              min="0"
              max="1000000"
              step="1"
              placeholder="—"
              value={weight}
              disabled={disabled || shipped || busy}
              onChange={(e) => setWeight(e.target.value)}
              onBlur={saveWeight}
              aria-label={`Weight of box ${box.box_number} in grams`}
            />
            <span className="boxp-unit" aria-hidden="true">g</span>
          </span>
        </label>

        <label className="boxp-field boxp-field-note">
          <span className="boxp-field-name">Note</span>
          <input
            className="glass-input"
            type="text"
            maxLength={280}
            placeholder="e.g. fragile — glass"
            value={note}
            disabled={disabled || shipped || busy}
            onChange={(e) => setNote(e.target.value)}
            onBlur={saveNote}
            aria-label={`Note on box ${box.box_number}`}
          />
        </label>

        {/* Where it is standing.
            Rendered only when the operator has named somewhere — an empty
            list means the store never set this up, and a dropdown with no
            options is a question with no answers. A datalist rather than a
            select for the reason `fulfilmentKeys` gives about carriers: the
            list is a spelling aid, and the packer holding the box is the one
            person who knows where it actually went.

            Editable while SEALED, unlike the contents: the seal freezes what
            is inside, not where it stands, and a trolley wheeled to the door
            moves every box on it without opening any. */}
        {!shipped && stagingPlaces?.length > 0 && (
          <label className="boxp-field boxp-field-place">
            <span className="boxp-field-name">Where</span>
            <input
              className="glass-input"
              type="text"
              list={`boxp-places-${orderId}`}
              maxLength={48}
              placeholder="—"
              value={place}
              disabled={disabled || busy}
              onChange={(e) => setPlace(e.target.value)}
              onBlur={savePlace}
              aria-label={`Where box ${box.box_number} is staged`}
              title="Where this carton is standing, so the Ship desk can find it"
            />
          </label>
        )}

        {!shipped && (
          <button
            type="button"
            className={`boxp-seal${sealed ? ' is-on' : ''}`}
            onClick={() => setSeal(!sealed)}
            disabled={disabled || busy}
            aria-pressed={sealed}
            title={sealed
              ? 'Open this box again to change what is inside'
              : 'Tape it shut — contents stop being editable, weight and note stay'}
          >
            {sealed
              ? <><PackageOpen size={13} aria-hidden="true" /> Unseal</>
              : <><PackageCheck size={13} aria-hidden="true" /> Seal</>}
          </button>
        )}

        {removable && !frozen && (
          <button
            type="button"
            className="boxp-remove"
            onClick={remove}
            disabled={disabled || busy}
            title="Remove this box — its contents go back to unboxed"
            aria-label={`Remove box ${box.box_number}`}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Contents: only once a split is possible. One box says "everything"
          up in the header and needs no rows at all. */}
      {multiBox && (
        <div className="boxp-contents">
          {box.items.length === 0 && !adding && (
            <span className="boxp-empty">empty</span>
          )}

          {box.items.map((alloc) => {
            const item = orderItems.find((i) => i.id === alloc.order_item_id);
            if (!item) return null;
            const remaining = remainingByLine.get(item.id) || 0;
            return (
              <span
                key={alloc.order_item_id}
                className={`boxp-chip${arrived.has(alloc.order_item_id) ? ' is-arriving' : ''}`}
              >
                <button
                  type="button"
                  className="boxp-chip-step"
                  onClick={() => allocate(item, alloc.quantity - 1)}
                  disabled={disabled || frozen || busy}
                  aria-label={`One fewer ${lineLabel(item)} in box ${box.box_number}`}
                  title="One fewer — back to unboxed"
                >
                  <Minus size={11} aria-hidden="true" />
                </button>
                <span
                  className="boxp-chip-body"
                  // The whole body focuses the number: a 40px input is a
                  // near-miss magnet at a bench, and the miss costs a typed
                  // figure. Clicking anywhere on the chip's text selects it.
                  onClick={(e) => {
                    const input = e.currentTarget.querySelector('input');
                    if (input && document.activeElement !== input) { input.focus(); input.select(); }
                  }}
                >
                  {/* Typed, not stepped: fifty-four units is a number, not
                      fifty-four presses. Absolute, clamped to what the line
                      can still give this box. */}
                  <QtyInput
                    value={alloc.quantity}
                    max={alloc.quantity + remaining}
                    disabled={disabled || frozen || busy}
                    onCommit={(n) => allocate(item, n)}
                    ariaLabel={`Units of ${lineLabel(item)} in box ${box.box_number}`}
                  />
                  <span aria-hidden="true">×</span> {lineLabel(item)}
                </span>
                <button
                  type="button"
                  className="boxp-chip-step"
                  onClick={() => allocate(item, alloc.quantity + 1)}
                  disabled={disabled || frozen || busy || remaining <= 0}
                  aria-label={`One more ${lineLabel(item)} in box ${box.box_number}`}
                  title={remaining > 0 ? 'One more from the unboxed units' : 'Every unit of this line is already in a box'}
                >
                  <Plus size={11} aria-hidden="true" />
                </button>
              </span>
            );
          })}

          {!frozen && addable.length > 0 && (
            adding ? (
              <span className="boxp-addlist">
                {addable.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="boxp-addline"
                    disabled={disabled || busy}
                    onClick={() => {
                      allocate(item, (inBox.get(item.id) || 0) + (remainingByLine.get(item.id) || 0));
                      setAdding(false);
                    }}
                    title={`Put the remaining ${remainingByLine.get(item.id)} unit(s) in box ${box.box_number}`}
                  >
                    <Plus size={11} aria-hidden="true" />
                    {remainingByLine.get(item.id)}× {lineLabel(item)}
                  </button>
                ))}
                <button type="button" className="boxp-addcancel" onClick={() => setAdding(false)}>
                  cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="boxp-add"
                onClick={() => setAdding(true)}
                disabled={disabled || busy}
                aria-label={`Add items to box ${box.box_number}`}
              >
                <Plus size={11} aria-hidden="true" /> Add items
                <ChevronDown size={11} aria-hidden="true" />
              </button>
            )
          )}
        </div>
      )}
    </li>
  );
}

export default function BoxesPanel({
  orderId, orderUuid, boxes, items, requireTracking, disabled, boxPresets = [],
  stagingPlaces = [], onBoxesChange, onPrintTags, onPrintSlip,
}) {
  const [adding, setAdding] = useState(false);
  const [pickPreset, setPickPreset] = useState(false);
  // A safety net, not the main path. The SERVER now creates Box 1 when the
  // claim holder opens the order (`ensureFirstBox`), so the bench has a box
  // from the first paint rather than only once every line was picked. This
  // stays for the case where that did not happen — an order opened before the
  // change, or a box deleted down to none — and is guarded by a ref so a slow
  // response cannot double-fire.
  const autoCreated = useRef(false);

  const addBox = async (preset) => {
    setAdding(true);
    setPickPreset(false);
    try {
      const res = await api.post(`/fulfilment/orders/${orderId}/boxes`,
        preset ? { preset_name: preset.name } : {});
      onBoxesChange((prev) => [...prev, res.box]);
    } catch (err) {
      toast.error(err.message || 'Could not add a box');
    } finally {
      setAdding(false);
    }
  };

  useEffect(() => {
    if (disabled || autoCreated.current || boxes.length > 0) return;
    autoCreated.current = true;
    addBox();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, boxes.length]);

  const multiBox = boxes.length > 1;

  // Per line: outstanding minus what every box already claims = the tray.
  const remainingByLine = useMemo(() => {
    const allocated = new Map();
    for (const box of boxes) {
      for (const alloc of box.items || []) {
        allocated.set(alloc.order_item_id, (allocated.get(alloc.order_item_id) || 0) + alloc.quantity);
      }
    }
    return new Map(items.map((item) => [
      item.id,
      Math.max(0, outstandingOf(item) - (allocated.get(item.id) || 0)),
    ]));
  }, [boxes, items]);

  const totalUnits = useMemo(() => items.reduce((s, i) => s + outstandingOf(i), 0), [items]);
  const unboxed = useMemo(
    () => items.filter((i) => (remainingByLine.get(i.id) || 0) > 0),
    [items, remainingByLine],
  );
  const unboxedUnits = unboxed.reduce((s, i) => s + remainingByLine.get(i.id), 0);

  return (
    <section className="boxp glass-card" aria-label="Boxes for this order">
      <header className="boxp-head">
        <h3>
          <Package size={15} aria-hidden="true" /> Boxes
          {/* The paper this bench produces. Tags go ON the cartons so the desk
              can tell them apart; the slip goes IN one for the buyer. Both are
              blind sheets — no address, no prices — which is why a packer may
              print them and the address label stays at the desk. */}
          {boxes.length > 0 && (onPrintTags || onPrintSlip) && (
            <span className="boxp-print">
              {onPrintTags && (
                <button type="button" className="glass-btn glass-btn-sm" onClick={onPrintTags}
                  title={`Print ${boxes.length === 1 ? 'a tag' : `${boxes.length} tags`} to stick on the ${boxes.length === 1 ? 'carton' : 'cartons'} — the Ship desk scans them`}>
                  <Tags size={13} aria-hidden="true" /> Box tags
                </button>
              )}
              {onPrintSlip && (
                <button type="button" className="glass-btn glass-btn-sm" onClick={onPrintSlip}
                  title="Print the packing slip that goes in the parcel — contents only, no prices, no address">
                  <FileText size={13} aria-hidden="true" /> Packing slip
                </button>
              )}
            </span>
          )}
        </h3>
        <p className="boxp-lede">
          {requireTracking
            ? 'Each box ships with its own tracking number from the Ship desk. Weight, notes and contents are optional.'
            : 'Record what parcels this order leaves in. Weight, notes and contents are optional.'}
          {' '}Every box has a tag — write it on the carton or print it — so the desk knows which box is which.
        </p>
      </header>

      {/* The tray: what is not in any box yet. Only a multi-parcel order has
          anything to say here — and it says it quietly, because contents are
          a courtesy record, not an obligation. */}
      {multiBox && unboxedUnits > 0 && (
        <p className="boxp-tray" role="status">
          <Boxes size={13} aria-hidden="true" />
          <span className="boxp-tray-label">Not in a box yet:</span>
          {unboxed.map((item) => (
            <span key={item.id} className="boxp-tray-chip">
              {remainingByLine.get(item.id)}× {lineLabel(item)}
            </span>
          ))}
        </p>
      )}
      {multiBox && unboxedUnits === 0 && (
        <p className="boxp-tray is-done" role="status">
          <Boxes size={13} aria-hidden="true" />
          Every unit is in a box.
        </p>
      )}

      {/* One datalist for every row, not one each: the options are a property
          of the store, and N copies of the same list is N times the markup for
          a bench that may have eight cartons open. */}
      {stagingPlaces.length > 0 && (
        <datalist id={`boxp-places-${orderId}`}>
          {stagingPlaces.map((name) => <option key={name} value={name} />)}
        </datalist>
      )}

      <ul className="boxp-list">
        {boxes.map((box) => (
          <BoxRow
            key={box.id}
            box={box}
            orderId={orderId}
            orderUuid={orderUuid}
            orderItems={items}
            remainingByLine={remainingByLine}
            disabled={disabled}
            multiBox={multiBox}
            totalUnits={totalUnits}
            requireTracking={requireTracking}
            stagingPlaces={stagingPlaces}
            removable={boxes.length > 1}
            onChanged={(fresh) => onBoxesChange((prev) => prev.map((b) => (
              // Weight/note echoes carry the box's items too, so a plain swap
              // keeps contents in step.
              b.id === fresh.id ? fresh : b)))}
            onBoxesChange={onBoxesChange}
            onRemoved={(gone) => onBoxesChange((prev) => prev.filter((b) => b.id !== gone.id))}
          />
        ))}
      </ul>

      <div className="boxp-addbox">
        <button
          type="button"
          className="glass-btn glass-btn-sm"
          onClick={() => addBox()}
          disabled={disabled || adding}
          title={boxes.length === 1
            ? 'Splitting into a second box? Its contents can then be recorded per box.'
            : 'Add another box'}
        >
          <Plus size={13} aria-hidden="true" /> {adding ? 'Adding…' : 'Add box'}
        </button>

        {/* Presets are a shortcut, never the only way in — the plain button
            above always works, so a carton the operator has not registered is
            still one tap. Hidden entirely when no presets are configured
            rather than shown empty. */}
        {boxPresets.length > 0 && (
          pickPreset ? (
            <span className="boxp-presets">
              {boxPresets.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className="boxp-preset-btn"
                  onClick={() => addBox(preset)}
                  disabled={disabled || adding}
                  title={preset.tare_grams != null
                    ? `${preset.name} — empty weight ${preset.tare_grams}g, prefilled`
                    : preset.name}
                >
                  {preset.name}
                  {preset.tare_grams != null && <em>{preset.tare_grams}g</em>}
                </button>
              ))}
              <button type="button" className="boxp-addcancel" onClick={() => setPickPreset(false)}>
                cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="glass-btn glass-btn-sm"
              onClick={() => setPickPreset(true)}
              disabled={disabled || adding}
              title="Add a box from one of the store's cartons, with its empty weight filled in"
            >
              <Package size={13} aria-hidden="true" /> From a carton
              <ChevronDown size={12} aria-hidden="true" />
            </button>
          )
        )}
      </div>
    </section>
  );
}
