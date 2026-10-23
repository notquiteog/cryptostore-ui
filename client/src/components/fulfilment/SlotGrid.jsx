import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, MapPin, Search, Trash2, X, PackageOpen } from 'lucide-react';
import ShelfSolid from './ShelfSolid';

/**
 * Levels × slots for one shelf, and what is filed in each.
 *
 * ── One grid, two save policies ─────────────────────────────────────────────
 *
 * The warehouse editor and the Shelves page both want this, and they save
 * differently on purpose:
 *
 *   the map editor — STAGES assignments and writes them with the layout, so
 *                    drawing shelves and filling them is one Save.
 *   the Shelves page — writes IMMEDIATELY, because there is no layout edit in
 *                    flight to batch them with and a picker waiting on a shelf
 *                    should not have to find a save button.
 *
 * So the grid owns no policy at all: it renders `occupantOf(bin)` and calls
 * `onAssign(variantId, bin)`. The caller decides whether that means "remember
 * this" or "write it now". Copying the grid to give each screen its own would
 * have been two slot pickers drifting apart within a release.
 *
 * ── The picture beside the table ────────────────────────────────────────────
 *
 * The grid is precise and entirely abstract — a cell in row three, column four
 * is `L3-S4` and nothing else. Pointing at any cell now lights the same box on
 * an isometric drawing of the shelf (`ShelfSolid`), so the code resolves into
 * a place before somebody walks to it. The drawing is also a control: pointing
 * at a box there selects the same cell, because once there is a picture of the
 * shelf people try to press it.
 *
 * ── Sharing a slot ──────────────────────────────────────────────────────────
 *
 * Two variants in one bin is normal — small SKUs share a slot all the time —
 * so it is not flagged. It used to carry a warning triangle and an amber
 * border, which put an alert on an ordinary state and made a tidy shelf look
 * like a problem. What is in a slot is still visible: the cell shows the first
 * occupant and pointing at it lists every one of them beside the drawing.
 */
export default function SlotGrid({ shelf, variants, occupantsByBin, onAssign, onClose, lede, busy = false }) {
  const dialogRef = useRef(null);
  const [cell, setCell] = useState(null);   // { level, slot } being assigned
  const [hover, setHover] = useState(null); // { level, slot } being pointed at
  const [query, setQuery] = useState('');

  useEffect(() => {
    const el = dialogRef.current;
    if (el && !el.open) el.showModal();
  }, []);
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return undefined;
    const onCancel = (e) => { e.preventDefault(); onClose(); };
    el.addEventListener('cancel', onCancel);
    return () => el.removeEventListener('cancel', onCancel);
  }, [onClose]);

  const levels = shelf.levels || 1;
  const slots = shelf.slots_per_level || 1;

  // The caller owns what "currently in this bin" means — staged edits on the
  // map editor, saved rows on the Shelves page — so the grid just reads it.
  const occupants = occupantsByBin;
  const code = (lvl, slot) => `${shelf.name}-L${lvl}-S${slot}`;

  // The cell the drawing lights: whatever is being pointed at, falling back to
  // whatever is open for assignment. Without the fallback the picture goes
  // blank the moment the pointer leaves the grid to reach the search box —
  // exactly when somebody most wants to see which slot they are filling.
  const shown = hover || cell;

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return variants
      .filter((v) => `${v.group_name} ${v.variant_name}`.toLowerCase().includes(q))
      .slice(0, 30);
  }, [variants, query]);

  const filled = useMemo(() => {
    let n = 0;
    for (let l = 1; l <= levels; l += 1) {
      for (let s = 1; s <= slots; s += 1) if ((occupants.get(code(l, s)) || []).length) n += 1;
    }
    return n;
  }, [occupants, levels, slots, shelf.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const here = shown ? (occupants.get(code(shown.level, shown.slot)) || []) : [];
  const open = cell ? (occupants.get(code(cell.level, cell.slot)) || []) : [];

  return (
    <dialog ref={dialogRef} className="slotg" aria-label={`Slots on shelf ${shelf.name}`}>
      <header className="slotg-head">
        <h3>
          <Box size={15} aria-hidden="true" />
          Shelf {shelf.name}
        </h3>
        {/* The state of the shelf, in the header, because "how full is this"
            is the question somebody has before they have pointed at anything. */}
        <span className="slotg-count">
          {filled} of {levels * slots} slots filled
        </span>
        <button type="button" className="slotg-close" onClick={onClose} aria-label="Close">
          <X size={15} aria-hidden="true" />
        </button>
      </header>

      <div className="slotg-body">
        <div className="slotg-gridcol">
          {/* Slot numbers once along the top, not repeated in all twenty-four
              cells. The cells got the room back and spend it on what is in
              them, which is the thing that differs between them. */}
          <div className="slotg-ruler" style={{ '--slots': slots }} aria-hidden="true">
            <span className="slotg-ruler-corner" />
            {Array.from({ length: slots }, (_, i) => i + 1).map((s) => (
              <span key={s} className="slotg-ruler-n">{s}</span>
            ))}
          </div>

          <div className="slotg-grid" style={{ '--slots': slots }} onPointerLeave={() => setHover(null)}>
            {Array.from({ length: levels }, (_, li) => levels - li).map((lvl) => (
              <div key={lvl} className="slotg-row">
                <span className="slotg-level">L{lvl}</span>
                {Array.from({ length: slots }, (_, si) => si + 1).map((slot) => {
                  const c = code(lvl, slot);
                  const occ = occupants.get(c) || [];
                  const isOpen = cell?.level === lvl && cell?.slot === slot;
                  const isHot = shown?.level === lvl && shown?.slot === slot;
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`slotg-cell${occ.length ? ' is-filled' : ''}${isOpen ? ' is-open' : ''}${isHot ? ' is-hot' : ''}`}
                      disabled={busy}
                      onPointerEnter={() => setHover({ level: lvl, slot })}
                      onFocus={() => setHover({ level: lvl, slot })}
                      onClick={() => { setCell({ level: lvl, slot }); setQuery(''); }}
                      title={occ.length
                        ? `${c}\n${occ.map((v) => `${v.group_name} — ${v.variant_name}`).join('\n')}`
                        : `${c} — empty`}
                      aria-label={occ.length ? `${c}, ${occ.length} filed` : `${c}, empty`}
                    >
                      {occ.length > 0 ? (
                        <span className="slotg-cell-name">{occ[0].variant_name}</span>
                      ) : (
                        <span className="slotg-cell-empty" aria-hidden="true" />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <p className="slotg-lede">
            Filing writes the variant&apos;s shelf location as <code>{shelf.name}-L2-S3</code>-style
            codes.{lede ? ` ${lede}` : ''}
          </p>
        </div>

        {/* The side column is absolutely positioned inside its grid cell (see
            the stylesheet), so nothing in here can change the dialog's size.
            That is not tidiness: this panel's content changes on every hover —
            an empty slot says one line, a shared one lists two variants — and
            when it drove the height, hovering a cell resized the dialog and
            moved the very cell you were pointing at out from under the cursor.
            DESIGN §4: reveal must not reflow. */}
        <aside className="slotg-side">
          <div className="slotg-side-inner">
          {/* The shelf as an object. Pointing at a cell in the table lights the
              same box here; pointing at a box here selects the same cell. */}
          <div className="slotg-solid">
            <ShelfSolid
              shelf={shelf}
              occupants={occupants}
              active={shown}
              onPick={(level, slot) => setHover({ level, slot })}
            />
            <p className="slotg-solid-cap">
              {shown
                ? <><MapPin size={11} aria-hidden="true" /> <code>{code(shown.level, shown.slot)}</code></>
                : <>Point at a slot to find it on the shelf</>}
            </p>
          </div>

          {/* Always rendered, never conditionally: a block that appears on
              first hover is a block that resizes everything below it exactly
              when somebody is aiming at something. */}
          <div className="slotg-here">
            {!shown && <p className="slotg-here-empty">Point at a slot to see what is in it</p>}
            {shown && here.length === 0 && (
              <p className="slotg-here-empty"><PackageOpen size={13} aria-hidden="true" /> Nothing filed here</p>
            )}
            {shown && here.length > 0 && (
              <ul className="slotg-here-list">
                {here.map((v) => (
                  <li key={v.variant_id}>
                    <span className="slotg-here-g">{v.group_name}</span>
                    <span className="slotg-here-v">{v.variant_name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {cell ? (
            <div className="slotg-assign">
              <p className="slotg-assign-title">
                File into <code>{code(cell.level, cell.slot)}</code>
              </p>

              {open.map((v) => (
                <div key={v.variant_id} className="slotg-current">
                  <span>{v.group_name} — {v.variant_name}</span>
                  <button
                    type="button"
                    className="glass-btn glass-btn-sm"
                    onClick={() => onAssign(v.variant_id, null)}
                    title="Clear this variant's shelf location"
                  >
                    <Trash2 size={12} aria-hidden="true" /> Unfile
                  </button>
                </div>
              ))}

              <div className="admin-search slotg-search">
                <Search size={13} aria-hidden="true" />
                <input
                  className="glass-input"
                  type="search"
                  value={query}
                  autoFocus
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find a variant to file here"
                  aria-label={`File a variant into ${code(cell.level, cell.slot)}`}
                />
              </div>

              {matches.length > 0 && (
                <ul className="slotg-matches">
                  {matches.map((v) => (
                    <li key={v.variant_id}>
                      <button type="button" onClick={() => { onAssign(v.variant_id, code(cell.level, cell.slot)); setQuery(''); }}>
                        <span className="slotg-match-g">{v.group_name}</span>
                        <span className="slotg-match-v">{v.variant_name}</span>
                        <span className="slotg-match-b">{v.bin_location || 'unfiled'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="slotg-hint">Press a slot to file something into it.</p>
          )}
          </div>
        </aside>
      </div>
    </dialog>
  );
}
