/**
 * Countdown formatting for anything that shows "time left": the flash strip,
 * the home drop clock, and whatever ticks next. One copy on purpose — the
 * repo's recurring failure mode is the same behaviour re-implemented per
 * surface until two of them disagree.
 */
export function formatRemaining(ms) {
  if (ms <= 0) return 'Ended';
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

/**
 * A calendar day — "Wed, Aug 26" — from the `'YYYY-MM-DD'` the API serves for
 * a DATE column. Null when there is no day; the input back, unchanged, when
 * it cannot be read as one.
 *
 * Two guards, both against the same day-slip, and neither is safe to tidy
 * away:
 *
 *   The noon. `new Date('2026-08-26')` is parsed as UTC midnight, which any
 *   viewer behind UTC then formats as the 25th — the store's buyers would see
 *   the carrier's day shifted by one for half the world. Noon local is far
 *   enough from both edges that no offset reaches across it.
 *
 *   The slice. `tracking_status.eta` is a DATE, and node-postgres hands a
 *   DATE back as a JS Date, which `res.json` stringifies to a full instant.
 *   The order page's parcel card therefore built
 *   `'2026-08-26T05:00:00.000Z' + 'T12:00:00'`, an unparseable string, and
 *   printed "expected 2026-08-26T05:00:00.000Z" to the buyer. The server now
 *   puts the day back before it leaves (services/tracking/parcelStatus.js),
 *   so this only ever has ten characters to work with — the slice is what
 *   keeps a stamp from being printed verbatim if one escapes again.
 *
 * Note what the slice cannot do: recover the DAY from a stamp. A store
 * running east of UTC sends local midnight as the previous evening in UTC
 * ("2026-08-25T22:00:00.000Z" for the 26th), and no client knows the server's
 * zone. That is why the day is repaired on the server, where the zone is
 * known, and only guarded here.
 */
export function calendarDay(value) {
  if (!value) return null;
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    : value;
}
