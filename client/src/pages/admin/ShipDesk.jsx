import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Send, RefreshCw, Package, PackageCheck, Truck, ArrowRight, Clock,
  AlertTriangle, CircleCheck, Inbox, Printer, MapPin, Boxes, Ticket,
  ExternalLink, X, FileText,
} from 'lucide-react';
import { ParcelLine } from '../../components/order/ParcelStatus';
import FlowStrip from '../../components/fulfilment/FlowStrip';
import ScanBox, { useScanRouter, useScanWedge } from '../../components/fulfilment/ScanBox';
import { PackingSlipSheet, usePrintMode, boxTag } from '../../components/fulfilment/PrintSheets';
import { api } from '../../utils/api';
import { playSound } from '../../utils/sounds';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { adminCapabilities } from '../../utils/adminPermissions';
import PageHeader from '../../components/admin/PageHeader';
import AskAbout from '../../components/admin/AskAbout';
import StatTiles from '../../components/admin/StatTiles';
import EncryptedAddress from '../../components/order/EncryptedAddress';
import TrackingImport from '../../components/fulfilment/TrackingImport';

/**
 * The Ship desk: packed orders on their way out the door.
 *
 * The queue is DERIVED server-side — fully picked, something still owed — so
 * this screen owns the state the audit found orphaned: a packed order that
 * still needs accepting no longer vanishes between the bench and the Orders
 * page; it sits here with Accept as its next action.
 *
 * Three modes, one screen:
 *   off      — cards offer order-level Accept/Ship, nothing about boxes.
 *   boxes    — cards also show the recorded parcels; shipping is unchanged.
 *   tracked  — each box takes a tracking number and ships individually; the
 *              order ships itself when the last box goes. The server enforces
 *              every rule; the buttons here just stop offering the impossible.
 *
 * ── The label panel ─────────────────────────────────────────────────────────
 *
 * A label needs the address, and the queue deliberately never carries one.
 * Opening a card's label panel fetches the ORDER endpoint — the same one the
 * order page uses, with the same redaction and the same audited decrypt for
 * store-key-encrypted addresses (via EncryptedAddress). A buyer-key-encrypted
 * address cannot be printed here at all and the panel says so honestly. The
 * printed sheet is plain print CSS: no carrier API, no remote anything.
 */

const REFRESH_MS = 45_000;

const shortId = (uuid, id) => (uuid ? uuid.split('-')[0].toUpperCase() : `#${id}`);

function ageOf(value) {
  if (!value) return '—';
  const mins = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const fmtWeight = (g) => (g == null ? null : g >= 1000 ? `${(g / 1000).toFixed(g % 1000 === 0 ? 0 : 1)}kg` : `${g}g`);

/* ── Label sheet ───────────────────────────────────────────────────
 * Rendered into the page (hidden on screen) and revealed by print CSS when
 * the label dialog is open. Address text arrives as a prop — this component
 * never fetches; whoever opens the panel owns what may be shown. */
function LabelSheet({ storeName, order, box, address, weight }) {
  return (
    <div className="shp-label-sheet">
      {storeName && <div className="shp-label-store">{storeName}</div>}
      <div className="shp-label-ref">
        {shortId(order.uuid, order.id)}
        {box && <span> · Box {box.box_number}{box.total ? ` of ${box.total}` : ''}</span>}
        {weight && <span> · {weight}</span>}
      </div>
      <div className="shp-label-address">{address}</div>
      {box?.tracking?.length > 0 && (
        <div className="shp-label-tracking">
          {box.tracking.map((t) => (
            <div key={t.id}>{t.carrier ? `${t.carrier}: ` : ''}{t.tracking_number || ''}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The address block for the label panel, resolved the honest way: plaintext
 * renders, store-key PGP offers the audited decrypt, buyer-key PGP explains
 * itself. `onAddress` hands the plaintext up for the printable sheet.
 */
function LabelAddress({ order, onAddress }) {
  const addressState = order.address_state || { encryption: null, can_decrypt: false };
  const raw = order.shipping_address_encrypted;

  useEffect(() => {
    if (!addressState.encryption && raw) onAddress(raw);
  }, [addressState.encryption, raw, onAddress]);

  if (order.redacted_fields?.includes('shipping_address_encrypted')) {
    return (
      <p className="shp-label-note">
        The address is hidden for your role — someone with shipping access
        prints the label.
      </p>
    );
  }
  if (!raw) {
    return <p className="shp-label-note">This order has no shipping address on file.</p>;
  }
  if (!addressState.encryption) {
    return <div className="shp-label-plain">{raw}</div>;
  }
  // PGP block — EncryptedAddress handles both the 'auto' decrypt flow (with
  // its audit trail) and the 'manual' buyer-key explanation. The decrypted
  // text is surfaced through onDecrypted for the print sheet and lives only
  // in this panel's state, dropped when it closes.
  return (
    <EncryptedAddress
      orderId={order.uuid || order.id}
      state={addressState}
      canDecrypt={addressState.can_decrypt}
      armored={raw}
      isOwner={false}
      onDecrypted={onAddress}
    />
  );
}

/** One box row on a desk card: contents, tracking entry, ship button, state. */
function DeskBox({ order, box, tracked, can, busy, singleBox, carriers = [], onTrack, onShip, onLabel, scanned = false }) {
  const [num, setNum] = useState('');
  const [carrier, setCarrier] = useState('');
  const [saving, setSaving] = useState(false);
  const trackRef = useRef(null);

  const shipped = !!box.shipped_at;
  const hasTracking = box.tracking.length > 0;

  // The box the scanner just named: light it, and put the cursor in its
  // tracking field — the next thing a dispatcher does with a carton they have
  // just identified is type the number the courier printed on it.
  useEffect(() => {
    if (!scanned) return;
    trackRef.current?.focus();
  }, [scanned]);

  const submitTracking = async () => {
    if (!num.trim()) return toast.error('Enter a tracking number');
    setSaving(true);
    try {
      await onTrack(box, num.trim(), carrier.trim());
      setNum('');
      setCarrier('');
    } finally {
      setSaving(false);
    }
  };

  // What the dispatcher is physically holding. A single box with no recorded
  // rows truthfully contains the whole order; a multi-box order shows what
  // the packer recorded, and stays silent where they recorded nothing.
  const contents = box.items || [];

  return (
    <li className={`shp-box${shipped ? ' is-shipped' : ''}${scanned ? ' is-scanned' : ''}`}>
      <span className="shp-box-label">
        <Package size={13} aria-hidden="true" />
        Box {box.box_number}
        {/* The tag on the carton. This is how a dispatcher matches the box in
            their hands to this row — by eye against the tag the packer stuck
            on or wrote on, or by scanning it into the field in the header. */}
        <span className="shp-box-tag" title="The tag on this carton — scan it or type it to land here">
          {boxTag(order.uuid, box.box_number)}
        </span>
        {fmtWeight(box.weight_grams) && <span className="shp-box-weight">{fmtWeight(box.weight_grams)}</span>}
        {box.untracked && (
          <span className="shp-box-untracked" title="The packer marked this parcel as shipping without a tracking number — letter mail. It ships free of the tracking gate; a number can still be added.">
            no tracking
          </span>
        )}
        {/* Where to go and get it. The tag above tells a dispatcher which
            carton is this row once they are holding one; this is what tells
            them where to walk. Hidden once the box has gone — a staging place
            on a dispatched parcel is history, and printing it would have
            somebody looking for a carton that is with the courier. */}
        {box.staged_location && !shipped && (
          <span className="shp-box-where" title={box.staged_at
            ? `Put there ${new Date(box.staged_at).toLocaleString()}`
            : 'Where the packer left this carton'}>
            <MapPin size={11} aria-hidden="true" /> {box.staged_location}
          </span>
        )}
        {/* An unsealed carton is one somebody may still be filling. Saying so
            here is cheaper than a dispatcher taping up a half-packed box. */}
        {!box.sealed_at && !shipped && (
          <span className="shp-box-open" title="This carton is not taped shut yet">
            open
          </span>
        )}
      </span>

      {(contents.length > 0 || singleBox) && (
        <span className="shp-box-contents" title="What the packer recorded in this box">
          {singleBox && contents.length === 0
            ? `everything — ${order.units} unit${order.units === 1 ? '' : 's'}`
            : contents.map((c) => `${c.quantity}× ${c.variant_name || c.product_name}`).join(' · ')}
        </span>
      )}

      {box.note && <span className="shp-box-note" title={box.note}>{box.note}</span>}

      <span className="shp-box-tracking">
        {box.tracking.map((t) => (
          <span key={t.id} className="shp-track" title={t.carrier || undefined}>
            <Ticket size={11} aria-hidden="true" />
            {t.tracking_number || <em title="Hidden — reading numbers back needs shipping access">hidden</em>}
            {/* The carrier's state beside the number it was told — a
                dispatcher re-opening yesterday's order sees whether the
                parcel has scanned in without leaving the desk. */}
            {t.tracking?.tracked && <ParcelLine tracking={t.tracking} />}
          </span>
        ))}
        {/* An untracked box gets no inline tracking form — it has no number
            coming, and the form only crowded the row it was exempted from.
            A number can still be attached from the order page if one ever
            materialises. An unaccepted order gets no form either: the server
            refuses tracking before acceptance, so offering the input here
            invited a typed number that could only bounce — Accept is the
            button one row up, and the Ship button already says so. */}
        {!shipped && can.tracking && !box.untracked && !order.needs_accept && (
          <span className="shp-track-form">
            <input
              ref={trackRef}
              className="glass-input"
              type="text"
              placeholder="Tracking #"
              value={num}
              onChange={(e) => setNum(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitTracking(); }}
              aria-label={`Tracking number for box ${box.box_number}`}
              disabled={saving}
            />
            {/* A datalist, not a select: the operator's list is a spelling
                aid, and a dispatcher must always be able to record a carrier
                nobody pre-registered. Empty list = the free-text field this
                always was. */}
            <input
              className="glass-input shp-track-carrier"
              type="text"
              list={carriers.length > 0 ? `shp-carriers-${box.id}` : undefined}
              placeholder="Carrier"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitTracking(); }}
              aria-label={`Carrier for box ${box.box_number}`}
              disabled={saving}
            />
            {carriers.length > 0 && (
              <datalist id={`shp-carriers-${box.id}`}>
                {carriers.map((c) => <option key={c} value={c} />)}
              </datalist>
            )}
            <button type="button" className="glass-btn glass-btn-sm" onClick={submitTracking} disabled={saving}>
              {saving ? '…' : 'Add'}
            </button>
          </span>
        )}
      </span>

      <span className="shp-box-actions">
        {can.label && (
          <button
            type="button"
            className="glass-btn glass-btn-sm"
            onClick={() => onLabel(box)}
            title={`Print a label for box ${box.box_number}`}
          >
            <Printer size={12} aria-hidden="true" /> Label
          </button>
        )}
        {shipped ? (
          <span className="shp-box-done" title={new Date(box.shipped_at).toLocaleString()}>
            <CircleCheck size={13} aria-hidden="true" /> shipped
          </span>
        ) : can.ship && (
          <button
            type="button"
            className="glass-btn glass-btn-sm glass-btn-primary"
            onClick={() => onShip(box)}
            disabled={busy || order.needs_accept || (tracked && !hasTracking && !box.untracked)}
            title={order.needs_accept ? 'Accept the order first'
              : tracked && !hasTracking && !box.untracked
                ? 'Add a tracking number first — or the packer marks the box untracked at the bench'
                : `Mark box ${box.box_number} shipped`}
          >
            <Truck size={12} aria-hidden="true" /> Ship box
          </button>
        )}
      </span>
    </li>
  );
}

/** One order on the desk. Expands to its boxes + label panel on demand. */
function DeskCard({ entry, requireTracking, storeName, onChanged, index, focus, onPrintSlip }) {
  const [detail, setDetail] = useState(null);
  const [order, setOrder] = useState(null); // full order, only for the label panel
  const [labelBox, setLabelBox] = useState(null);
  const [labelAddress, setLabelAddress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const cardRef = useRef(null);

  const tracked = requireTracking;
  // This card is the one a scan (or the bench's "take it to the desk") named.
  const focused = focus?.order === entry.id;

  const loadDetail = useCallback(async () => {
    const res = await api.get(`/fulfilment/ship/orders/${entry.id}`);
    setDetail(res);
    return res;
  }, [entry.id]);

  // Arriving by scan or from the bench: open this card, bring it into view.
  // The box row lights itself (DeskBox reads `scanned`), so the eye lands on
  // the carton, not just the order.
  useEffect(() => {
    if (!focused || open) return;
    setOpen(true);
    loadDetail().catch(() => setOpen(false));
    requestAnimationFrame(() => cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (!detail) {
      try { await loadDetail(); } catch (err) { toast.error(err.message || 'Could not load the order'); setOpen(false); }
    }
  };

  const accept = async () => {
    setBusy(true);
    try {
      await api.put(`/orders/${entry.uuid}/status`, { status: 'accepted' });
      toast.success(`Order ${shortId(entry.uuid, entry.id)} accepted`);
      onChanged();
      if (open) await loadDetail();
    } catch (err) {
      toast.error(err.message || 'Could not accept the order');
    } finally {
      setBusy(false);
    }
  };

  const shipOrder = async () => {
    setBusy(true);
    try {
      await api.put(`/orders/${entry.uuid}/status`, { status: 'shipped' });
      playSound('success');
      toast.success(`Order ${shortId(entry.uuid, entry.id)} shipped`);
      onChanged();
    } catch (err) {
      toast.error(err.message || 'Could not ship the order');
    } finally {
      setBusy(false);
    }
  };

  const track = async (box, tracking_number, carrier) => {
    try {
      await api.post(`/orders/${entry.uuid}/tracking-numbers`, {
        tracking_number, carrier: carrier || undefined, box_id: box.id,
      });
      // The echo may come back redacted for a write-only dispatcher; reload
      // the desk view, which shows what this viewer may see, and trust the
      // toast to confirm what they typed landed.
      toast.success(`Tracking on box ${box.box_number}`);
      await loadDetail();
    } catch (err) {
      toast.error(err.message || 'Could not add the tracking number');
      throw err;
    }
  };

  const shipBox = async (box) => {
    setBusy(true);
    try {
      const res = await api.post(`/fulfilment/ship/orders/${entry.id}/boxes/${box.id}/ship`);
      playSound(res.order_shipped ? 'success' : 'tick');
      toast.success(res.order_shipped
        ? `Last box gone — order ${shortId(entry.uuid, entry.id)} shipped`
        : `Box ${box.box_number} shipped · ${res.boxes_remaining} to go`);
      if (res.order_shipped) onChanged();
      else await loadDetail();
    } catch (err) {
      toast.error(err.message || 'Could not ship the box');
    } finally {
      setBusy(false);
    }
  };

  const openLabel = async (box) => {
    setLabelBox(box);
    setLabelAddress(null);
    if (!order) {
      try {
        setOrder(await api.get(`/orders/${entry.uuid}`));
      } catch (err) {
        toast.error(err.message || 'Could not load the order for its label');
        setLabelBox(null);
      }
    }
  };

  const can = detail?.can || { accept: false, ship: false, tracking: false, label: false };
  const boxes = detail?.boxes || [];
  const boxTotal = entry.boxes.count;
  // Cartons still in the building that are not taped shut. `sealed` counts
  // only unshipped boxes (see shipController.boxSummaries), so this subtraction
  // is exact rather than an estimate — and an order showing "2 open" is one a
  // dispatcher should leave alone, because somebody is still filling it.
  const openBoxes = Math.max(0, boxTotal - entry.boxes.shipped - (entry.boxes.sealed || 0));

  return (
    <article ref={cardRef} className={`shp-card${labelBox ? ' shp-label-open' : ''}${focused ? ' is-scanned' : ''}`} style={{ '--i': Math.min(index, 10) }}>
      <header className="shp-head">
        <button
          type="button"
          className="shp-head-main"
          onClick={toggle}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} order ${shortId(entry.uuid, entry.id)}`}
        >
          <span className="shp-id">{shortId(entry.uuid, entry.id)}</span>
          <span className={`shp-status is-${entry.status}`}>{entry.status}</span>
          <span className="shp-age" title={new Date(entry.created_at).toLocaleString()}>
            <Clock size={11} aria-hidden="true" /> {ageOf(entry.created_at)}
          </span>
          <span className="shp-meta">
            {entry.units} unit{entry.units === 1 ? '' : 's'}
            {entry.lines > 1 && <> · {entry.lines} lines</>}
          </span>

          {/* A line the bench could not fill.
              An order can be fully picked — which is what puts it on this desk
              — and still carry a short: the packer filled what was on the shelf
              and flagged the rest. Without this chip somebody tapes up a box
              that is missing units the buyer paid for, which is the worst
              outcome the whole handoff exists to prevent. Hence the emphasis:
              it sits in the head row, not behind the expander. */}
          {entry.short_lines > 0 && (
            <span className="shp-short" title="A packer could not fill a line on this order — settle it before it ships">
              <AlertTriangle size={11} aria-hidden="true" />
              {entry.short_lines} short
            </span>
          )}

          {/* How far this order is out of the door, as a bar rather than a
              fraction buried in a sentence. A ship desk is a queue read down
              its own left edge, and "0/2 shipped" set in muted grey beside
              "6 units" did not distinguish an untouched order from one with a
              parcel already gone.

              Only what the queue endpoint already returns is drawn here.
              The obvious other thing to put in this row is the destination,
              and it is deliberately absent: shipping addresses are the most
              damaging field in the schema, `redactOrder` gates them on
              `orders.view_shipping`, and widening a queue listing to carry
              them is an operator's decision about retention, not a layout
              improvement to make in passing. */}
          {boxTotal > 0 ? (
            <span
              className="shp-progress"
              title={`${entry.boxes.shipped} of ${boxTotal} ${boxTotal === 1 ? 'parcel' : 'parcels'} shipped, ${entry.boxes.tracked} tracked`}
            >
              <span className="shp-progress-bar" aria-hidden="true">
                <span
                  className="shp-progress-fill"
                  style={{ '--pct': `${Math.round((entry.boxes.shipped / boxTotal) * 100)}%` }}
                />
              </span>
              <span className="shp-progress-text">
                <Boxes size={11} aria-hidden="true" />
                {entry.boxes.shipped}/{boxTotal} out
                {entry.boxes.tracked < boxTotal && (
                  <em className="shp-progress-gap">{boxTotal - entry.boxes.tracked} untracked</em>
                )}
              </span>
            </span>
          ) : (
            <span className="shp-progress is-none">No parcels recorded</span>
          )}

          {/* Where the cartons are standing, and whether they are taped shut.
              Both of these are the answer to "can I go and get this one", and
              neither was on this row: the queue showed a COUNT of boxes, so a
              dispatcher learned an order had three parcels and then went
              looking for three identical cartons. `boxTags.js` describes that
              exact failure one step upstream — the record being right and the
              world not matchable to it.

              Sealed reads as a warning rather than a fact when it is short,
              because an unsealed box is a packer still working and not
              something to pick up. */}
          {entry.boxes.places?.length > 0 && (
            <span className="shp-where" title="Where the packer left these cartons">
              <MapPin size={11} aria-hidden="true" />
              {entry.boxes.places.join(' · ')}
            </span>
          )}
          {openBoxes > 0 && (
            <span className="shp-unsealed" title="Not every carton here is taped shut — somebody may still be packing it">
              {openBoxes} open
            </span>
          )}
        </button>

        <span className="shp-head-actions">
          {entry.needs_accept && (
            <button
              type="button"
              className="glass-btn glass-btn-sm glass-btn-primary"
              onClick={accept}
              disabled={busy}
              title="The store commits to fulfilling this order"
              aria-label={`Accept order ${shortId(entry.uuid, entry.id)}`}
            >
              <ArrowRight size={13} aria-hidden="true" /> Accept
            </button>
          )}
          {!entry.needs_accept && !tracked && (
            <button
              type="button"
              className="glass-btn glass-btn-sm glass-btn-primary"
              onClick={shipOrder}
              disabled={busy}
              aria-label={`Mark order ${shortId(entry.uuid, entry.id)} shipped`}
            >
              <Truck size={13} aria-hidden="true" /> Ship
            </button>
          )}
          <Link
            to={`/orders/${entry.uuid}`}
            className="glass-btn glass-btn-sm"
            title="Open the full order — customer, address and totals, if you may see them"
            aria-label={`Open order ${shortId(entry.uuid, entry.id)}`}
          >
            <ExternalLink size={13} aria-hidden="true" />
          </Link>
        </span>
      </header>

      {open && detail && (
        <div className="shp-body">
          {boxes.length > 0 ? (
            <ul className="shp-boxes">
              {boxes.map((box) => (
                <DeskBox
                  key={box.id}
                  order={{ ...entry, needs_accept: detail.order.needs_accept }}
                  box={box}
                  tracked={tracked}
                  can={can}
                  busy={busy}
                  singleBox={boxes.length === 1}
                  carriers={detail.carriers || []}
                  onTrack={track}
                  onShip={shipBox}
                  onLabel={openLabel}
                  scanned={focused && focus?.box === box.box_number}
                />
              ))}
            </ul>
          ) : (
            <p className="shp-noboxes">
              No boxes were recorded for this order.
              {tracked && ' It ships order-level from the Orders page — the tracking gate only holds recorded boxes.'}
              {' '}<Link to={`/admin/pack/${entry.id}`}>Edit at the bench</Link>
            </p>
          )}

          {detail.order_tracking.length > 0 && (
            <p className="shp-order-tracking">
              Order-level tracking:{' '}
              {detail.order_tracking.map((t) => t.tracking_number || 'hidden').join(', ')}
            </p>
          )}

          {boxes.length > 0 && (
            <p className="shp-bench-link">
              Wrong count or weight? <Link to={`/admin/pack/${entry.id}`}>Edit boxes at the bench</Link> —
              unshipped ones only.
              {' '}
              <button
                type="button"
                className="shp-inline-btn"
                onClick={() => onPrintSlip({ order: entry, boxes, items: detail.items || [] })}
                title="Reprint the packing slip — contents by box, no prices, no address"
              >
                <FileText size={11} aria-hidden="true" /> Packing slip
              </button>
            </p>
          )}
        </div>
      )}

      {labelBox && (
        <div className="shp-label-panel">
          <header className="shp-label-head">
            <h4><Printer size={13} aria-hidden="true" /> Label — box {labelBox.box_number}</h4>
            <span className="shp-label-controls">
              <button
                type="button"
                className="glass-btn glass-btn-sm glass-btn-primary"
                onClick={() => window.print()}
                disabled={!labelAddress}
                title={labelAddress ? 'Print this label' : 'The address has to be readable first'}
              >
                <Printer size={12} aria-hidden="true" /> Print
              </button>
              <button type="button" className="glass-btn glass-btn-sm" onClick={() => { setLabelBox(null); setLabelAddress(null); }} aria-label="Close the label panel">
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          </header>
          {order
            ? <LabelAddress order={order} onAddress={setLabelAddress} />
            : <p className="shp-label-note">Loading the order…</p>}
          {labelAddress && (
            <LabelSheet
              storeName={storeName}
              order={entry}
              box={{ ...labelBox, total: boxTotal }}
              address={labelAddress}
              weight={fmtWeight(labelBox.weight_grams)}
            />
          )}
        </div>
      )}
    </article>
  );
}

export default function ShipDesk() {
  const { user } = useAuth();
  const { settings } = useTheme();
  const can = useMemo(() => adminCapabilities(user), [user]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [tick, setTick] = useState(0);
  const timer = useRef(null);

  // `?order=<id>&box=<n>` — where a scan, or the bench's "take it to the
  // desk", lands. The card opens itself and the box lights; see DeskCard.
  const [params] = useSearchParams();
  const focus = useMemo(() => {
    const order = parseInt(params.get('order'), 10);
    const box = parseInt(params.get('box'), 10);
    return Number.isInteger(order) ? { order, box: Number.isInteger(box) ? box : null } : null;
  }, [params]);

  const routeScan = useScanRouter();
  useScanWedge(routeScan);

  // The packing slip, reprinted from the desk: the packer prints it at the
  // bench, but the desk is where a torn one is noticed.
  const [printMode, print] = usePrintMode();
  const [slip, setSlip] = useState(null);
  const printSlip = useCallback((payload) => { setSlip(payload); print('slip'); }, [print]);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (quiet) setRefreshing(true); else setLoading(true);
    try {
      const res = await api.get('/fulfilment/ship/queue');
      setData(res);
      setError(null);
      setTick((n) => n + 1);
    } catch (err) {
      setError(err.message || 'Could not load the ship queue');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    timer.current = setInterval(() => load({ quiet: true }), REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  const orders = data?.orders || [];
  const requireTracking = !!data?.require_tracking;

  const totals = useMemo(() => ({
    waiting: orders.length,
    needsAccept: orders.filter((o) => o.needs_accept).length,
    boxesLeft: orders.reduce((s, o) => s + Math.max(0, o.boxes.count - o.boxes.shipped), 0),
  }), [orders]);

  const stats = [
    { key: 'waiting', label: 'Packed, waiting', value: totals.waiting, icon: Inbox, tone: 'var(--primary)' },
    totals.needsAccept > 0 && {
      key: 'accept', label: 'Need accepting', value: totals.needsAccept, icon: ArrowRight,
      tone: 'var(--warning)', urgent: true, hint: 'Packed before anyone accepted them',
    },
    {
      key: 'boxes', label: 'Boxes to ship', value: totals.boxesLeft, icon: Boxes, tone: 'var(--secondary)',
    },
  ].filter(Boolean);

  // The scanned order is not on the desk: it was shipped, or is still being
  // packed, or the id is stale. Say so once the queue has loaded, rather
  // than leaving a dispatcher looking at a list that does not open anything.
  const focusMissing = focus && !loading && !error && !orders.some((o) => o.id === focus.order);

  return (
    <div className={`admin-page shp-page${printMode === 'slip' ? ' is-printing-slip' : ''}`}>
      <PageHeader
        icon={Send}
        title="Ship desk"
        subtitle={loading ? 'Loading the desk…'
          : orders.length === 0 ? 'Nothing packed is waiting to ship'
            : `${orders.length} packed order${orders.length === 1 ? '' : 's'} waiting${requireTracking ? ' · tracking required' : ''}`}
      >
        {/* `staff-parcels` reads the same tracking rows this desk ships
            into, and is the topic that knows which of them a carrier has
            stopped moving. The desk is where that matters. */}
        <AskAbout
          question="Anything flagged by a carrier? Which parcels have stopped moving or come back as an exception?"
          label="Ask"
          title="Ask the assistant about parcels the carriers have flagged"
        />
        <ScanBox placeholder="Scan a box tag" />
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => load({ quiet: true })} disabled={refreshing}>
          <RefreshCw size={14} aria-hidden="true" className={refreshing ? 'spin' : ''} /> Refresh
        </button>
      </PageHeader>

      <FlowStrip current="ship" refreshKey={tick} />

      {/* The day's numbers, pasted. Gated on `orders.tracking` because that is
          what the endpoint checks — a dispatcher who may advance order status
          but not record tracking would otherwise be shown a panel that 403s.
          Closed by default: it is the high-volume path, not the usual one, and
          a six-row textarea above the queue every day would push the work down
          the screen. */}
      {can.manageTracking && <div className="shp-import"><TrackingImport onImported={() => load({ quiet: true })} /></div>}

      {focusMissing && (
        <p className="pkq-trunc" role="status">
          That order is not on the desk — it may have shipped, or still be on the bench.
          {' '}<Link to={`/admin/pack/${focus.order}`}>Open it at the bench</Link>.
        </p>
      )}

      {orders.length > 0 && <StatTiles stats={stats} />}

      {data?.truncated && (
        <p className="pkq-trunc" role="status">
          Showing the oldest 200 — the rest surface as these clear.
        </p>
      )}

      {error && (
        <div className="glass-card pull-empty">
          <AlertTriangle size={22} aria-hidden="true" />
          <p>{error}</p>
          <button type="button" className="glass-btn glass-btn-sm" onClick={() => load()}>Try again</button>
        </div>
      )}

      {!error && loading && (
        <div className="shp-list" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => <div key={i} className="pkq-skel" style={{ '--i': i }} />)}
        </div>
      )}

      {!error && !loading && orders.length === 0 && (
        <div className="glass-card pull-empty">
          <CircleCheck size={22} aria-hidden="true" style={{ color: 'var(--success)' }} />
          <p>Nothing packed is waiting to ship. Orders arrive here from the <Link to="/admin/pack">packing bench</Link>.</p>
        </div>
      )}

      {!error && !loading && orders.length > 0 && (
        <div className="shp-list">
          {orders.map((entry, i) => (
            <DeskCard
              key={entry.id}
              entry={entry}
              index={i}
              requireTracking={requireTracking}
              storeName={settings?.store_name}
              onChanged={() => load({ quiet: true })}
              focus={focus}
              onPrintSlip={printSlip}
            />
          ))}
        </div>
      )}

      {slip && (
        <PackingSlipSheet storeName={settings?.store_name} order={slip.order} boxes={slip.boxes} items={slip.items} />
      )}

      {!error && !loading && can.updateOrderStatus && !requireTracking && orders.length > 0 && (
        <p className="pull-foot">
          Orders here are fully picked. Accept takes responsibility for the order; Ship tells the
          buyer it is on its way, box by box or all at once. To make a tracking number mandatory on
          every box, turn on
          {' '}<Link to="/admin/settings">Settings → Require box tracking</Link>.
        </p>
      )}
    </div>
  );
}
