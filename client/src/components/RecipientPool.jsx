import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Archive, ChevronRight, Edit2, Infinity as InfinityIcon, Package, Trash2 } from 'lucide-react';
import ViewToggle from './ViewToggle';
import useViewMode from '../hooks/useViewMode';
import { RecipientStats, money } from './RecipientLimits';

/**
 * The rotating payment-recipient pool — cash-in-mail drops and Zelle accounts —
 * drawn as comfortable cards or as compact line items.
 *
 * DESIGN §6, answered once for both pools: **a toggle**.
 *
 * Not the responsive table (`.admin-rtable`): a recipient carries three usage
 * meters, a five-figure stat strip and free-text instructions the buyer is
 * shown verbatim, which is a genuinely different shape from a line — not a set
 * of cells wearing `data-label`. Not two silently-chosen views either, because
 * the two readings of this screen are different jobs. "Which drop can still
 * take a $900 order" is read down a column of headroom figures; "what exactly
 * does the buyer get told to write on the envelope" is read inside one card.
 * The operator picks, and `useViewMode` remembers per surface.
 *
 * Why this is a component rather than the same JSX typed out twice: CashMail
 * and ZelleAccounts render structurally identical lists over the same
 * `RecipientLimits` internals, and CLAUDE.md's parity rule is about exactly
 * this shape of problem — shared behaviour lives in one module, and the
 * module's shape should make a single-caller change awkward to express. The
 * two pages had already drifted while they were separate copies: one gated its
 * row actions on a permission and the other did not, one called a retired row
 * "Inactive" and the other "Retired", and only one of them warned when the
 * pool had nobody left in rotation. A second copy of a list always produces
 * that, and this file is what stops it happening again.
 *
 * What each caller supplies is only what is genuinely different between a
 * postal drop and a bank handle: the words, the icon, and how to read a
 * record. Everything about the layout — the toggle, the row tracks, the
 * headroom arithmetic, the empty state, the disclosure — lives here.
 */

/* ── Cells ───────────────────────────────────────────────────────────────── */

/**
 * "never" / "just now" / "6h ago" / "12d ago" / an absolute date past a month.
 *
 * Coarse on purpose. The pool hands out least-recently-used first, so what the
 * operator is reading in this column is the *rotation order*, not a clock — a
 * precise timestamp here would be four extra characters carrying no decision.
 * The exact instant is one hover away in `title`.
 */
function lastHandedOut(value) {
  if (!value) return 'never';
  const ms = Date.now() - new Date(value).getTime();
  const hours = Math.floor(ms / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

/**
 * How much this recipient can still take before its tightest cap stops it.
 *
 * `capacity` is absent — not zero — for a viewer without
 * `orders.recipient_stats`, so it renders as an explicit dash rather than as a
 * confident "$0.00". A hidden figure that looks like a real one is how someone
 * concludes a healthy pool is exhausted.
 */
function Headroom({ capacity }) {
  if (!capacity) {
    return (
      <span className="lrow-num" title="Needs the “View recipient usage” permission">—</span>
    );
  }
  if (capacity.effective_remaining === null) {
    return (
      <span className="lrow-num" title="No receive limit set — this recipient never leaves rotation on capacity">
        <InfinityIcon size={13} aria-hidden="true" />
        <span className="sr-only">Uncapped</span>
      </span>
    );
  }
  return (
    <span
      className="lrow-num"
      style={{ color: capacity.exhausted ? 'var(--warning)' : undefined }}
      title={capacity.exhausted
        ? 'At its limit — buyers are being routed to other recipients'
        : 'Room left before the tightest of this recipient’s caps'}
    >
      ${money(capacity.effective_remaining)}
    </span>
  );
}

/** Rotation state, in whichever words this pool uses for it. */
function RotationBadge({ active, rotation }) {
  // A retired recipient is a normal, deliberate state — not a failure — so it
  // wears the muted badge. It used to wear `badge-danger`, which lit every
  // archived drop like an alarm and left nothing louder for the one state that
  // actually needs attention: a recipient sitting at its limit.
  return (
    <span className={`badge ${active ? 'badge-success' : 'badge-muted'}`}>
      {active ? rotation.inPool : rotation.outOfPool}
    </span>
  );
}

/**
 * Everything a line item cannot hold on one line: the buyer-facing
 * instructions, the extra identity lines, and the full usage block with its
 * meters.
 *
 * Rendered by BOTH views from one function, which is the point. DESIGN §5 is
 * explicit that the compact view is not the comfortable view with columns
 * deleted — so in rows the same block is one keystroke away behind the
 * record's name, rather than absent.
 */
function RecipientDetail({ view, item }) {
  return (
    <>
      {(view.lines || []).filter(Boolean).map((line, i) => (
        <p key={i} style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', margin: 0 }}>{line}</p>
      ))}
      {view.instructions && (
        <p style={{
          fontSize: 'var(--fs-xs)',
          fontStyle: 'italic',
          color: 'var(--text-secondary)',
          margin: 'var(--sp-1) 0 0',
        }}>
          {view.instructions}
        </p>
      )}
      <RecipientStats stats={item.stats} capacity={item.capacity} />
    </>
  );
}

/* ── The two views ───────────────────────────────────────────────────────── */

function ActionButtons({ item, view, canManage, onEdit, onDelete, size }) {
  if (!canManage) return null;
  // Retiring and deleting are the same button because they are the same
  // intent; which one happens is decided by whether the recipient has payment
  // history, and the server decides it too. Printing both would ask the
  // operator to know the ledger.
  const retires = (item.stats?.orders_assigned || 0) > 0;
  return (
    <>
      <button
        type="button"
        className={`glass-btn ${size}`}
        onClick={() => onEdit(item)}
        title={`Edit ${view.title}`}
        aria-label={`Edit ${view.title}`}
      >
        <Edit2 size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`glass-btn glass-btn-danger ${size}`}
        onClick={() => onDelete(item)}
        title={retires ? `Retire ${view.title}` : `Delete ${view.title}`}
        aria-label={retires ? `Retire ${view.title}` : `Delete ${view.title}`}
      >
        {retires ? <Archive size={14} aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />}
      </button>
    </>
  );
}

function PoolCards({ items, describe, rotation, canManage, onEdit, onDelete }) {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      {items.map((item) => {
        const view = describe(item);
        return (
          <div key={view.id} className="glass-card" style={{ opacity: item.active ? 1 : 0.7 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 'var(--sp-4)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h3 style={{
                  margin: '0 0 var(--sp-1)',
                  fontSize: 'var(--fs-md)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                }}>
                  {view.title}
                  <RotationBadge active={item.active} rotation={rotation} />
                </h3>
                <p style={{
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--fs-sm)',
                  margin: '0 0 var(--sp-1)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                }}>
                  {view.whereIcon}
                  <span style={{ fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{view.where}</span>
                  {view.sub && <span style={{ color: 'var(--text-muted)' }}>→ {view.sub}</span>}
                </p>
                <RecipientDetail view={view} item={item} />
              </div>
              <div style={{ display: 'flex', gap: 'var(--sp-1)', flexShrink: 0 }}>
                <ActionButtons
                  item={item} view={view} canManage={canManage}
                  onEdit={onEdit} onDelete={onDelete} size="glass-btn-sm"
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// A bare button that inherits the row's type so the record's name can BE the
// disclosure control. A real-looking button in every one of four hundred rows
// is the wall of chrome DESIGN §4 exists to prevent; the name is already the
// thing the operator's eye lands on, so it is what they should be able to
// press. The chevron is the affordance, and it is always visible — hiding the
// only route to the meters behind hover would lose it on touch entirely.
const DISCLOSE_RESET = {
  padding: 0,
  border: 0,
  background: 'none',
  font: 'inherit',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};

function PoolRows({ items, describe, rotation, whereHeading, canManage, onEdit, onDelete }) {
  const [open, setOpen] = useState(() => new Set());

  const toggle = (id) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // The actions track is measured, not `auto`. Every `.lrow` is its own grid
  // and so is `.lrows-head`, so an `auto` track is resolved separately in each
  // of them — the heading row, whose last cell is empty, sized it to zero and
  // printed every column label shifted left of the values underneath it. A
  // stated width is the only thing that makes independent grids line up.
  const cols = `minmax(0,1.3fr) minmax(0,1.7fr) 104px 116px 96px 62px ${canManage ? '92px' : '0px'}`;

  return (
    <div className="lrows" style={{ '--lrow-cols': cols }}>
      <div className="lrows-head">
        <span>Recipient</span>
        <span>{whereHeading}</span>
        <span>Rotation</span>
        <span style={{ textAlign: 'right' }}>Headroom</span>
        <span style={{ textAlign: 'right' }}>Last used</span>
        <span style={{ textAlign: 'right' }}>Orders</span>
        <span aria-hidden="true" />
      </div>

      {items.map((item) => {
        const view = describe(item);
        const expanded = open.has(view.id);
        // `is-urgent` is spent on the one state that needs somebody to act: a
        // recipient still in rotation that has run out of headroom, which is
        // silently taking no more orders. A retired row is not urgent — it is
        // retired on purpose — so it stays plain and lets the badge say so.
        const stranded = item.active && item.capacity?.exhausted;
        return (
          <div
            key={view.id}
            className={`lrow${stranded ? ' is-urgent' : ''}`}
            style={stranded ? { '--lrow-tone': 'var(--warning)' } : undefined}
          >
            <button
              type="button"
              className="lrow-stack"
              style={DISCLOSE_RESET}
              onClick={() => toggle(view.id)}
              aria-expanded={expanded}
            >
              {/* The chevron sits beside `.lrow-text`, not inside it. Putting
                  it inside meant giving that span `display: flex`, and
                  `text-overflow: ellipsis` does not apply to a flex container —
                  a long label stopped ending in an ellipsis and started being
                  chopped mid-character instead. */}
              <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)', minWidth: 0, width: '100%' }}>
                <ChevronRight
                  size={13}
                  aria-hidden="true"
                  // Rotated, not transitioned. An inline `transition` outranks
                  // the `prefers-reduced-motion` block that would otherwise
                  // cancel it, so a decorative tween declared here is one a
                  // reader can never turn off — DESIGN §2 asks the opposite.
                  style={{
                    flexShrink: 0,
                    color: 'var(--text-muted)',
                    transform: expanded ? 'rotate(90deg)' : 'none',
                  }}
                />
                <span className="lrow-text" title={view.title}>{view.title}</span>
              </span>
              {view.sub && <small>{view.sub}</small>}
            </button>

            {/* `lrow-wrap` gives the address or handle its own full-width line
                once the container is narrow (74-list-views.css). Sharing the
                top line with the label there put a postal address in the
                right-hand column, where the eye reads it as a figure. */}
            <span className="lrow-text lrow-wrap" style={{ fontFamily: 'var(--font-mono)' }} title={view.where}>
              {view.whereIcon}{view.whereIcon ? ' ' : ''}{view.where}
            </span>

            <span><RotationBadge active={item.active} rotation={rotation} /></span>

            <Headroom capacity={item.capacity} />

            <span
              className="lrow-num"
              title={item.last_used_at
                ? `Last handed to a buyer ${new Date(item.last_used_at).toLocaleString()}`
                : 'Never handed to a buyer — next in the rotation'}
            >
              {lastHandedOut(item.last_used_at)}
            </span>

            {/* The glyph is the same one `RecipientStats` puts on this exact
                figure inside the card, and it is here because the phone shape
                drops the column headings: a bare "9" beside a bare "4h ago" is
                two numbers with nothing saying which is which. It costs 11px
                and it labels the cell in both views. */}
            <span
              className="lrow-num"
              title={item.stats
                ? 'Orders this recipient has been assigned to'
                : 'Needs the “View recipient usage” permission'}
            >
              <Package size={11} aria-hidden="true" style={{ marginRight: 'var(--sp-1)', color: 'var(--text-muted)' }} />
              {item.stats ? item.stats.orders_assigned : '—'}
            </span>

            <span className="lrow-actions">
              <ActionButtons
                item={item} view={view} canManage={canManage}
                onEdit={onEdit} onDelete={onDelete} size="glass-btn-sm"
              />
            </span>

            {expanded && (
              <div
                className="admin-panel-in"
                style={{ gridColumn: '1 / -1', paddingBottom: 'var(--sp-2)' }}
              >
                <RecipientDetail view={view} item={item} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── The pool ────────────────────────────────────────────────────────────── */

/**
 * @param {object} props
 * @param {string} props.surface        stable view-mode id, e.g. `'admin-zelle'`
 * @param {Array<any>} props.items      recipients exactly as the admin API returns them
 * @param {(item: any) => {
 *   id: string|number, title: string, sub?: string|null, where: string,
 *   whereIcon?: import('react').ReactNode, lines?: string[], instructions?: string|null
 * }} props.describe                    how to read one record of THIS pool
 * @param {{ inPool: string, outOfPool: string }} props.rotation  this pool's two words
 * @param {string} props.whereHeading   column heading over the address/handle
 * @param {string} props.noun           singular record noun, for labels
 * @param {boolean} props.canManage     may this viewer edit and retire
 * @param {(item:any)=>void} props.onEdit
 * @param {(item:any)=>void} props.onDelete
 * @param {Function} props.emptyIcon    lucide component for the empty state
 * @param {string} props.emptyCopy      what breaks while this pool is empty
 * @param {()=>void} props.onAdd
 * @param {string} props.addLabel
 */
export default function RecipientPool({
  surface,
  items,
  describe,
  rotation,
  whereHeading,
  noun,
  canManage,
  onEdit,
  onDelete,
  emptyIcon: EmptyIcon,
  emptyCopy,
  onAdd,
  addLabel,
}) {
  const [density, setDensity] = useViewMode(surface);

  if (items.length === 0) {
    // DESIGN §9: an empty pool is navigation, not an apology. The thing to do
    // is on the screen, and so are the two places this state is usually caused
    // from — the method may be switched off in payment settings, or the
    // operator may have arrived here from an order that could not be handed a
    // recipient at all.
    return (
      <div className="glass-card empty-state">
        <EmptyIcon size={34} aria-hidden="true" />
        <h3>Nothing in rotation</h3>
        <p>{emptyCopy}</p>
        <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
          {/* Gated on the same grant the row actions are. Offering "add the
              first one" to a viewer whose POST would 403 is a dead end wearing
              a primary button. */}
          {canManage && (
            <button type="button" className="glass-btn glass-btn-primary" onClick={onAdd}>{addLabel}</button>
          )}
          <Link className="glass-btn" to="/admin/settings">Payment settings</Link>
          <Link className="glass-btn" to="/admin/orders">Order queue</Link>
        </div>
      </div>
    );
  }

  const stranded = items.filter((item) => item.active && item.capacity?.exhausted).length;

  return (
    <>
      <div className="admin-toolbar">
        {/* The left of the toolbar carries only what the page heading does not
            already say. It used to repeat the heading's "N in rotation of M"
            two lines below it, which is chrome pretending to be information —
            §7. A recipient sitting at its cap is the one fact neither the
            heading nor an unexpanded row states, so that is what goes here. */}
        {stranded > 0 && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--sp-1)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--warning)',
          }}>
            <AlertTriangle size={13} aria-hidden="true" />
            {stranded} at {stranded === 1 ? 'its' : 'their'} limit — buyers are being routed elsewhere
          </span>
        )}
        <span className="admin-toolbar-spacer" />
        <div className="admin-toolbar-group">
          <ViewToggle value={density} onChange={setDensity} label={`${noun} layout`} />
        </div>
      </div>

      {density === 'rows' ? (
        <PoolRows
          items={items} describe={describe} rotation={rotation} whereHeading={whereHeading}
          canManage={canManage} onEdit={onEdit} onDelete={onDelete}
        />
      ) : (
        <PoolCards
          items={items} describe={describe} rotation={rotation}
          canManage={canManage} onEdit={onEdit} onDelete={onDelete}
        />
      )}
    </>
  );
}
