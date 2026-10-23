import { useState } from 'react';
import {
  Zap, Pause, Play, Pencil, Copy, Trash2, Check, X,
  EyeOff, PackageX, Layers, TrendingUp, CalendarClock, Timer, Hourglass,
} from 'lucide-react';
import { applyFlashDiscount } from '../../utils/pricing';

/* ── Shared shape helpers. Exported because the page's filter pills, stat tiles
      and sort orders all have to agree with what a card prints on itself. ── */

export const money = (n) =>
  // `n == null` is checked before the finite test because `Number(null)` is 0,
  // which would print a missing price as a very convincing "$0.00". The API
  // sends `sale_price: null` for a sale that reduces nothing (see quoteSale),
  // and free is a real price this page also has to be able to show.
  n != null && Number.isFinite(Number(n)) ? `$${Number(n).toFixed(2)}` : '—';

/**
 * Which of four things a sale currently is.
 *
 * Order matters: a paused sale whose window has closed is simply over, and
 * calling it "paused" would put it in a filter the operator uses to find
 * things worth resuming.
 */
export function saleState(sale, now = Date.now()) {
  const starts = new Date(sale.starts_at).getTime();
  const ends = new Date(sale.ends_at).getTime();
  if (Number.isFinite(ends) && now >= ends) return 'ended';
  if (!sale.active) return 'paused';
  if (Number.isFinite(starts) && now < starts) return 'scheduled';
  return 'live';
}

export const STATE_META = {
  live: { label: 'Live', tone: 'var(--success)' },
  scheduled: { label: 'Scheduled', tone: 'var(--info)' },
  paused: { label: 'Paused', tone: 'var(--warning)' },
  ended: { label: 'Ended', tone: 'var(--text-muted)' },
};

/** Coarse at the top, precise at the bottom — seconds only matter near zero. */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${pad(h)}h`;
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

/** A Date as the string `<input type="datetime-local">` wants, in local time. */
export function toLocalInput(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * How the stored discount reads, independent of the resolved price.
 *
 * Reads `discount_value` and nothing else. The old `?? sale.sale_price`
 * fallback dated from when the column held an absolute price, so it made
 * `sale_price` mean the stored discount here and the resolved unit everywhere
 * else — one name, two numbers, on rows that travel together. The column is
 * gone (20260917000000_retire_legacy_shims) and `sale_price` now means the
 * resolved unit on every shape the API emits; falling back to it here would
 * print a $30.74 sale as "30.74% off".
 */
export function describeDiscount(sale) {
  const value = Number(sale.discount_value);
  if (!Number.isFinite(value)) return '—';
  if (sale.discount_type === 'percent') return `${value % 1 === 0 ? value : value.toFixed(2)}% off`;
  if (sale.discount_type === 'flat') return `${money(value)} off`;
  // Anything else is a type this page has no words for, and guessing is worse
  // than saying so: the old fallthrough printed every unknown type as
  // "$7.20 fixed", which read as a real fixed-price sale rather than as a row
  // nobody could describe.
  return '—';
}

/** Sale is under an hour from closing — worth pointing at on a busy page. */
export const ENDING_SOON_MS = 60 * 60 * 1000;

/* ── Inline editor ─────────────────────────────────────────────────────────── */

/**
 * Mounted only while a card is being edited, so its initial state is read from
 * the sale exactly once and cannot go stale against a background refetch.
 *
 * There is no fixed-price row left to convert on open. That type was withdrawn
 * and 20260917000000_retire_legacy_shims converted every row to its flat
 * equivalent and deleted the ones it could not price, and both the baseline
 * schema and that migration constrain the column to ('percent', 'flat'), so no
 * install of any age can hand this editor one. The conversion branch that used
 * to live here read `sale.sale_price` to derive an equivalent percentage, which
 * outlived the column it read.
 */
function SaleEditor({ sale, saving, onSave, onCancel }) {
  const [draft, setDraft] = useState(() => ({
    discount_type: sale.discount_type || 'percent',
    discount_value: String(sale.discount_value ?? ''),
    label: sale.label || '',
    ends_at: toLocalInput(sale.ends_at),
  }));

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const list = Number(sale.original_price);
  const preview = applyFlashDiscount(list, draft.discount_type, draft.discount_value);

  return (
    <form
      className="fsale-editor"
      onSubmit={(e) => { e.preventDefault(); onSave(draft); }}
    >
      <div className="fsale-editor-row">
        <div className="fsale-seg" role="group" aria-label="Discount type">
          {[{ v: 'percent', l: '% off' }, { v: 'flat', l: '$ off' }].map(o => (
            <button
              key={o.v}
              type="button"
              className={`fsale-seg-opt${draft.discount_type === o.v ? ' is-on' : ''}`}
              onClick={() => set({ discount_type: o.v })}
              aria-pressed={draft.discount_type === o.v}
            >
              {o.l}
            </button>
          ))}
        </div>
        <label className="fsale-editor-field">
          <span className="sr-only">Discount value</span>
          <input
            className="glass-input"
            type="number"
            min={0}
            max={draft.discount_type === 'percent' ? 100 : undefined}
            step="any"
            value={draft.discount_value}
            onChange={(e) => set({ discount_value: e.target.value })}
            placeholder={draft.discount_type === 'percent' ? '25' : '5.00'}
            aria-label="Discount value"
          />
        </label>
      </div>

      <div className="fsale-editor-row">
        <label className="fsale-editor-field fsale-editor-grow">
          <span className="fsale-editor-lab">Ends</span>
          <input
            className="glass-input"
            type="datetime-local"
            value={draft.ends_at}
            onChange={(e) => set({ ends_at: e.target.value })}
          />
        </label>
        <label className="fsale-editor-field fsale-editor-grow">
          <span className="fsale-editor-lab">Label</span>
          <input
            className="glass-input"
            type="text"
            value={draft.label}
            maxLength={128}
            onChange={(e) => set({ label: e.target.value })}
            placeholder="Optional"
          />
        </label>
      </div>

      <p className="fsale-editor-preview">
        {preview != null && preview < list
          ? <>New price <strong>{money(preview)}</strong> at quantity 1, from {money(list)}.</>
          : 'Enter a discount that reduces the price.'}
      </p>

      <div className="fsale-editor-actions">
        <button type="submit" className="glass-btn glass-btn-sm glass-btn-primary" disabled={saving}>
          {saving ? <><span className="spinner spinner-inline" /> Saving…</> : <><Check size={13} /> Save</>}
        </button>
        <button type="button" className="glass-btn glass-btn-sm" onClick={onCancel} disabled={saving}>
          <X size={13} /> Cancel
        </button>
      </div>
    </form>
  );
}

/* ── Card ──────────────────────────────────────────────────────────────────── */

/**
 * One flash sale, as an object rather than a table row.
 *
 * The table this replaces had ten columns and put the countdown, the discount
 * and the three buttons that change them in three different places, none of
 * them next to the price they act on. On a phone it became ten stacked
 * label/value pairs per sale, which is the whole page for one row.
 *
 * `now` is passed in rather than read here: a grid of these would otherwise
 * hold one interval each, all firing a second apart, and the countdowns would
 * visibly disagree. One tick at the page level drives every card.
 */
export default function FlashSaleCard({
  sale, now, revenueHidden, busy, editing,
  onEdit, onCancelEdit, onSave, onToggle, onExtend, onEndNow, onDuplicate, onDelete,
}) {
  const state = saleState(sale, now);
  const meta = STATE_META[state];

  const list = Number(sale.original_price);
  // Null means the discount reduces nothing — the API withholds a price rather
  // than quoting one equal to list. Kept distinct from 0, which is a genuine
  // (free) price, and guarded before every comparison below: `Number(null)` is
  // 0, so a bare read would have called a dead sale 100% off.
  const price = sale.sale_price == null ? null : Number(sale.sale_price);
  const off = price != null && list > 0 && price < list
    ? Math.round(((list - price) / list) * 100)
    : 0;
  const saves = price != null && Number.isFinite(list) ? list - price : null;

  const startsMs = new Date(sale.starts_at).getTime();
  const endsMs = new Date(sale.ends_at).getTime();
  const span = endsMs - startsMs;
  const elapsed = Math.min(Math.max(now - startsMs, 0), Math.max(span, 0));
  const progress = span > 0 ? (state === 'ended' ? 1 : elapsed / span) : 0;
  const remaining = endsMs - now;
  const endingSoon = state === 'live' && remaining > 0 && remaining <= ENDING_SOON_MS;

  // The cheapest a unit can go once volume breaks and the sale compose, which
  // is what checkout actually charges at quantity.
  const bestTier = sale.best_tier_price == null ? null : Number(sale.best_tier_price);
  const floor = bestTier == null
    ? null
    : applyFlashDiscount(bestTier, sale.discount_type, sale.discount_value);

  const warnings = [];
  if (!sale.group_active) warnings.push({ icon: EyeOff, text: 'The product is switched off, so nobody can see this sale.' });
  else if (!sale.variant_active) warnings.push({ icon: EyeOff, text: 'The variant is switched off, so nobody can see this sale.' });
  if (sale.stock <= 0) warnings.push({ icon: PackageX, text: 'Out of stock — the sale is running on something nobody can buy.' });
  // A sale can stop biting without anyone touching it: drop the variant's price
  // under a flat discount and it reduces nothing. The storefront hides those,
  // so this row is the only place it can be noticed.
  if (price == null) warnings.push({ icon: TrendingUp, text: 'This discount reduces nothing — buyers pay the list price.' });

  const stats = sale.stats || {};
  const timeLabel = state === 'scheduled' ? 'Starts in'
    : state === 'ended' ? 'Ended'
    : state === 'paused' ? 'Paused with'
    : 'Ends in';
  const timeValue = state === 'scheduled' ? formatDuration(startsMs - now)
    : state === 'ended' ? `${formatDuration(now - endsMs)} ago`
    : `${formatDuration(remaining)} left`;

  return (
    <article
      className={`fsale-card fsale-${state}${endingSoon ? ' is-urgent' : ''}${editing ? ' is-editing' : ''}`}
      style={{ '--tone': meta.tone }}
    >
      <span className="fsale-rail" aria-hidden="true" />

      <header className="fsale-head">
        {sale.thumb
          ? <img className="fsale-thumb" src={sale.thumb} alt="" loading="lazy" />
          : <span className="fsale-thumb fsale-thumb-blank"><Layers size={17} aria-hidden="true" /></span>}

        <div className="fsale-title">
          <h3 className="fsale-name">{sale.group_name || 'Unknown product'}</h3>
          <p className="fsale-sub">
            {sale.variant_name || `Variant #${sale.variant_id}`}
            <span className="fsale-dot">·</span>
            <span className="fsale-vid">#{sale.variant_id}</span>
          </p>
        </div>

        <span className={`fsale-state fsale-state-${state}`}>
          {state === 'live' && <span className="fsale-live-dot" aria-hidden="true" />}
          {meta.label}
        </span>
      </header>

      {editing ? (
        <SaleEditor sale={sale} saving={busy} onSave={onSave} onCancel={onCancelEdit} />
      ) : (
        <>
          <div className="fsale-prices">
            <span className="fsale-was">{money(list)}</span>
            <span className="fsale-arrow" aria-hidden="true">→</span>
            <span className="fsale-now">{money(price)}</span>
            {off > 0 && <span className="fsale-off">-{off}%</span>}
          </div>

          <p className="fsale-terms">
            {describeDiscount(sale)}
            {saves != null && saves > 0 && <> <span className="fsale-dot">·</span> saves {money(saves)} a unit</>}
            {sale.label && <> <span className="fsale-dot">·</span> <em>{sale.label}</em></>}
          </p>

          <div className="fsale-timer">
            <div className="fsale-bar" role="img" aria-label={`${Math.round(progress * 100)}% of the window elapsed`}>
              <span className="fsale-bar-fill" style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }} />
            </div>
            <div className="fsale-timer-row">
              <span className="fsale-timer-lab">
                {state === 'scheduled' ? <CalendarClock size={12} aria-hidden="true" />
                  : state === 'ended' ? <Hourglass size={12} aria-hidden="true" />
                  : <Timer size={12} aria-hidden="true" />}
                {timeLabel}
              </span>
              <span className="fsale-timer-val">{timeValue}</span>
            </div>
            <p className="fsale-window">
              {new Date(sale.starts_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              {' → '}
              {new Date(sale.ends_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>

          <dl className="fsale-facts">
            <div className="fsale-fact">
              <dt>Stock</dt>
              <dd className={sale.stock <= 0 ? 'is-bad' : ''}>{Number(sale.stock ?? 0).toLocaleString()}</dd>
            </div>
            <div className="fsale-fact">
              <dt>Sold since start</dt>
              <dd>{Number(stats.units_sold || 0).toLocaleString()}</dd>
            </div>
            <div className="fsale-fact">
              <dt>{revenueHidden ? 'Revenue' : 'Took'}</dt>
              <dd>{revenueHidden ? '—' : money(stats.revenue || 0)}</dd>
            </div>
            <div className="fsale-fact">
              <dt>{floor != null ? 'Floor with tiers' : 'Volume tiers'}</dt>
              <dd>{floor != null ? money(floor) : 'None'}</dd>
            </div>
          </dl>

          {warnings.length > 0 && (
            <ul className="fsale-warnings">
              {warnings.map((w, i) => (
                <li key={i}><w.icon size={12} aria-hidden="true" /> {w.text}</li>
              ))}
            </ul>
          )}
        </>
      )}

      {!editing && (
        <footer className="fsale-actions">
          {state !== 'ended' && (
            <button
              className="glass-btn glass-btn-sm"
              onClick={() => onToggle(sale)}
              disabled={busy}
              title={sale.active ? 'Stop pricing this sale without deleting it' : 'Resume this sale'}
            >
              {sale.active ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Resume</>}
            </button>
          )}

          {state !== 'ended' ? (
            <>
              <button
                className="glass-btn glass-btn-sm"
                onClick={() => onExtend(sale, 1)}
                disabled={busy}
                title="Push the end time back by an hour"
              >
                +1h
              </button>
              <button
                className="glass-btn glass-btn-sm"
                onClick={() => onExtend(sale, 24)}
                disabled={busy}
                title="Push the end time back by a day"
              >
                +24h
              </button>
              {/* A sale that has not started yet is cancelled, not ended —
                  nothing has run to bring to a close. */}
              <button
                className="glass-btn glass-btn-sm"
                onClick={() => onEndNow(sale)}
                disabled={busy}
                title={state === 'scheduled' ? 'Cancel this sale before it starts' : 'Close the window now'}
              >
                {state === 'scheduled' ? 'Cancel' : 'End'}
              </button>
            </>
          ) : (
            <button
              className="glass-btn glass-btn-sm"
              onClick={() => onExtend(sale, 24)}
              disabled={busy}
              title="Reopen this sale for another day"
            >
              <Zap size={13} /> Run again
            </button>
          )}

          <button className="glass-btn glass-btn-sm" onClick={() => onEdit(sale)} disabled={busy} title="Edit the discount, end time and label">
            <Pencil size={13} /> Edit
          </button>
          <button className="glass-btn glass-btn-sm" onClick={() => onDuplicate(sale)} disabled={busy} title="Start the same offer on another variant">
            <Copy size={13} />
            <span className="sr-only">Duplicate</span>
          </button>
          <button
            className="glass-btn glass-btn-sm glass-btn-danger"
            onClick={() => onDelete(sale)}
            disabled={busy}
            title="Delete this sale"
          >
            <Trash2 size={13} />
            <span className="sr-only">Delete</span>
          </button>
        </footer>
      )}

      {stats.order_count > 0 && !editing && (
        <p className="fsale-orders">
          <TrendingUp size={11} aria-hidden="true" />
          {stats.order_count} order{stats.order_count === 1 ? '' : 's'} placed while this sale has been open
        </p>
      )}
    </article>
  );
}
