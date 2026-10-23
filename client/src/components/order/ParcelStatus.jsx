import { useState } from 'react';
import {
  Truck, PackageCheck, PackageX, MapPin, Clock, ChevronDown, ExternalLink, CircleDashed, AlertTriangle, Store, Undo2,
} from 'lucide-react';
import { calendarDay } from '../../utils/time';

/**
 * What the carrier last said about a parcel, drawn once for every surface.
 *
 * Three shapes, one vocabulary (server/utils/parcelState — the eight
 * statuses, their labels and tones come from the server, never restated
 * here):
 *
 *   <ParcelChip parcels={order.parcels} />        one pill per ORDER, for lists
 *   <ParcelLine tracking={tn.tracking} />         one line per NUMBER, for the
 *                                                 desk and the manifest
 *   <ParcelCard tracking={tn.tracking} />         the panel on the order page:
 *                                                 status, where, when, the
 *                                                 carrier's events, a link out
 *
 * ── There is deliberately no refresh button ─────────────────────────────────
 *
 * Nothing on these components asks the carrier. The store's worker asks, one
 * parcel at a time, never more than once every two hours per number, and
 * these draw what it stored — with the time it stored it, so the reader can
 * see how fresh the answer is instead of being offered a button that would
 * only spend the store's request budget re-learning the same thing.
 * config/trackingKeys.js on the server says why the queue is shaped so.
 *
 * ── Redaction is the server's ──────────────────────────────────────────────
 *
 * A staff viewer without shipping access receives `tracking.summary`,
 * `location` and `events` as undefined and these components draw the state
 * alone. They do not decide what to hide; they draw what arrived.
 */

const ICONS = {
  unknown: CircleDashed,
  pre_transit: Clock,
  in_transit: Truck,
  out_for_delivery: Truck,
  available_for_pickup: Store,
  delivered: PackageCheck,
  exception: AlertTriangle,
  returned: Undo2,
};

const TONE_VAR = {
  muted: 'var(--text-muted)',
  info: 'var(--info, var(--secondary))',
  primary: 'var(--primary)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
};

export const toneVar = (tone) => TONE_VAR[tone] || TONE_VAR.muted;

/** "2 hours ago", from an ISO stamp; null when there is no stamp. */
export function agoText(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const fmtStamp = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

/**
 * One pill per order: the rollup `order.parcels` the list endpoints attach.
 * Draws nothing when the order has no tracked parcel — an absent chip is
 * the honest state, not a grey "unknown" that looks like a problem.
 */
export function ParcelChip({ parcels, compact = false }) {
  if (!parcels || !parcels.tracked) return null;
  const Icon = ICONS[parcels.status] || CircleDashed;
  const count = parcels.tracked > 1 ? ` ${parcels.delivered}/${parcels.tracked}` : '';
  const ago = agoText(parcels.latest_at);
  return (
    <span
      className={`parcel-chip is-${parcels.tone}${parcels.attention > 0 ? ' is-attention' : ''}`}
      style={{ '--parcel-tone': toneVar(parcels.tone) }}
      title={`${parcels.label}${count ? ` — ${parcels.delivered} of ${parcels.tracked} parcels delivered` : ''}${ago ? ` · carrier updated ${ago}` : ''}`}
    >
      <Icon size={11} aria-hidden="true" />
      <span className="parcel-chip-label">{compact ? parcels.label.replace('Ready for collection', 'For collection') : parcels.label}{count}</span>
    </span>
  );
}

/** One line per tracking number: status, last words when the viewer may see them, freshness. */
export function ParcelLine({ tracking, showCarrier = false }) {
  if (!tracking) return null;
  const Icon = ICONS[tracking.status] || CircleDashed;
  const ago = agoText(tracking.checked_at);
  const untracked = !tracking.tracked;
  return (
    <span
      className={`parcel-line is-${tracking.tone}${tracking.attention ? ' is-attention' : ''}${untracked ? ' is-untracked' : ''}`}
      style={{ '--parcel-tone': toneVar(tracking.tone) }}
      title={tracking.summary ? `${tracking.summary}${tracking.location ? ` — ${tracking.location}` : ''}` : undefined}
    >
      <Icon size={12} aria-hidden="true" />
      <span className="parcel-line-label">
        {showCarrier && tracking.carrier_label ? `${tracking.carrier_label} · ` : ''}{tracking.label}
      </span>
      {!untracked && ago && <span className="parcel-line-ago">{ago}</span>}
    </span>
  );
}

/**
 * Why a parcel stopped being looked up, when its order is what stopped it.
 *
 * The record stays exactly as the carrier last left it — this only explains
 * why the timestamp under it will not move again. Without the line, a parcel
 * frozen at "In transit, checked 3 weeks ago" reads as a broken worker.
 */
const STOPPED_WORDS = {
  order_delivered: 'the order was marked delivered',
  order_disputed: 'the order went into dispute',
  order_cancelled: 'the order was cancelled',
  order_refunded: 'the order was refunded',
};

/**
 * The order-page panel for one tracking number.
 *
 * Collapsed: the state, the carrier's latest words, where and when, and the
 * expected day if the carrier gave one. Expanded: the carrier's events,
 * newest first — the same list the carrier's own page shows, kept here so
 * the buyer never has to leave the store to read it.
 */
export function ParcelCard({ tracking, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!tracking) return null;
  const Icon = ICONS[tracking.status] || CircleDashed;
  const events = Array.isArray(tracking.events) ? tracking.events : [];
  const canSeeWords = tracking.summary !== undefined;
  const ago = agoText(tracking.checked_at);

  if (!tracking.tracked) {
    return (
      <div className="parcel-card is-untracked" style={{ '--parcel-tone': toneVar('muted') }}>
        <div className="parcel-card-head">
          <span className="parcel-card-state"><CircleDashed size={14} aria-hidden="true" /> {tracking.label}</span>
          {tracking.done_reason === 'no_credentials' && (
            <span className="parcel-card-note">The store has not connected this carrier yet.</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`parcel-card is-${tracking.tone}${tracking.attention ? ' is-attention' : ''}`} style={{ '--parcel-tone': toneVar(tracking.tone) }}>
      <div className="parcel-card-head">
        <span className="parcel-card-state">
          <Icon size={14} aria-hidden="true" />
          {tracking.label}
          {tracking.carrier_label && <em className="parcel-card-carrier">{tracking.carrier_label}</em>}
        </span>
        <span className="parcel-card-when">
          {tracking.status === 'delivered' && tracking.delivered_at
            ? <>delivered {fmtStamp(tracking.delivered_at)}</>
            : tracking.eta && !['delivered', 'returned'].includes(tracking.status)
              ? <>expected {calendarDay(tracking.eta)}</>
              : null}
        </span>
      </div>

      {canSeeWords && (tracking.summary || tracking.location) && (
        <p className="parcel-card-words">
          {tracking.summary}
          {tracking.location && (
            <span className="parcel-card-where"><MapPin size={11} aria-hidden="true" /> {tracking.location}</span>
          )}
        </p>
      )}

      {tracking.attention && tracking.status === 'available_for_pickup' && canSeeWords && (
        <p className="parcel-card-stalled">Ready for collection. Check the carrier instructions for the collection location and deadline.</p>
      )}
      {!tracking.attention && tracking.attention_resolved_at && new Date(tracking.attention_resolved_at) >= new Date(tracking.last_change_at || tracking.checked_at || 0) && (
        <p className="flow-note">This carrier update was reviewed and resolved by the store on {fmtStamp(tracking.attention_resolved_at)}.</p>
      )}
      {tracking.attention && !['exception', 'returned', 'available_for_pickup'].includes(tracking.status) && canSeeWords && (
        <p className="parcel-card-stalled">
          <AlertTriangle size={12} aria-hidden="true" />
          The carrier has not reported any movement for a while. If it does not move in the next day or two, open a support ticket from this order.
        </p>
      )}

      <div className="parcel-card-foot">
        <span className="parcel-card-checked" title={tracking.checked_at ? `Carrier checked ${fmtStamp(tracking.checked_at)}` : 'Not checked yet'}>
          <Clock size={11} aria-hidden="true" />
          {tracking.stopped_with_order
            ? `last checked ${ago || 'never'}`
            : ago ? `checked ${ago}` : 'waiting for the first check'}
        </span>
        {tracking.stopped_with_order && (
          <span className="parcel-card-stopped">
            Updates stopped — {STOPPED_WORDS[tracking.done_reason] || 'the order was closed'}.
          </span>
        )}
        {canSeeWords && events.length > 0 && (
          <button type="button" className="parcel-card-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {events.length} event{events.length === 1 ? '' : 's'}
            <ChevronDown size={13} aria-hidden="true" className={`parcel-chev${open ? ' is-open' : ''}`} />
          </button>
        )}
        {tracking.public_url && (
          <a className="parcel-card-out" href={tracking.public_url} target="_blank" rel="noopener noreferrer" title={`Open on the ${tracking.carrier_label || 'carrier'} site`}>
            <ExternalLink size={12} aria-hidden="true" /> carrier site
          </a>
        )}
      </div>

      {open && events.length > 0 && (
        <ol className="parcel-events">
          {events.map((e, i) => {
            const EIcon = ICONS[e.status] || CircleDashed;
            return (
              <li key={`${e.at || 'x'}-${i}`} className={`parcel-event is-${e.status}`}>
                <span className="parcel-event-dot" aria-hidden="true"><EIcon size={10} /></span>
                <span className="parcel-event-text">
                  <span className="parcel-event-desc">{e.description}</span>
                  {e.location && <span className="parcel-event-where">{e.location}</span>}
                </span>
                <time className="parcel-event-at" dateTime={e.at || undefined}>{e.at ? fmtStamp(e.at) : ''}</time>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** Unused-import guard for icons kept for the status map. */
export const PARCEL_ICONS = { ...ICONS, PackageX };
