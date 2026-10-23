/**
 * Formatting the admin list pages share.
 *
 * Every page used to carry its own `money`, its own date formatter and its own
 * "3h ago", and no two of them agreed: some rounded with `toFixed(2)` on a raw
 * value, some on a `parseFloat`, and the relative-time helpers disagreed about
 * when "yesterday" starts. Three pages showing the same order at three
 * different ages is the kind of thing that gets an operator to distrust the
 * whole console.
 *
 * The one rule that matters here: **every NUMERIC column arrives from the API
 * as a string**. No `pg` type parsers are registered, so `total`, `refund_amount`,
 * `price_at_purchase` and friends are `"49.50"`, not `49.5`, and `item_count`
 * from a `COUNT(*)` is `"3"`. `"49.50" + "3"` is `"49.503"`. Everything below
 * goes through `num()` first.
 */

/** A NUMERIC/bigint column as a number. Anything unparseable becomes `fallback`. */
export function num(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * `$49.50`, and `−$22.38` for a negative.
 *
 * The sign goes outside the currency mark. Interpolating the raw `toFixed`
 * after a `$` produced `$-22.38`, which is not how a negative amount is
 * written anywhere; it went unnoticed for as long as it did because every
 * caller happened to pass a naturally-positive quantity — a price, a total, a
 * lifetime spend — or to have already taken `Math.abs` and printed its own
 * sign. The first caller to hand it a signed figure straight from the database
 * was the audit log's payload renderer, which shows `requested` on a store
 * credit deduction.
 *
 * U+2212, not a hyphen, for the same reason `signedMoney` uses one: at the
 * small tabular sizes these tables use a hyphen reads as a dash between two
 * figures rather than as a sign.
 */
export function money(value) {
  const n = num(value);
  return n < 0 ? `−$${Math.abs(n).toFixed(2)}` : `$${n.toFixed(2)}`;
}

/**
 * `$49.50`, or a signed `+$5.00` / `−$5.00`.
 *
 * The minus is U+2212, not a hyphen: at the small, tabular sizes these tiles
 * use, a hyphen reads as a dash between two figures rather than a sign.
 */
export function signedMoney(value) {
  const n = num(value);
  if (n === 0) return '$0.00';
  return `${n > 0 ? '+' : '−'}$${Math.abs(n).toFixed(2)}`;
}

/** `1,204`. Counts are read at a glance and benefit from the separator. */
export function count(value) {
  return num(value).toLocaleString();
}

/**
 * The short reference the whole console calls an order by.
 *
 * The first uuid segment, uppercased — matching what the customer sees on their
 * own order page, so a support conversation about "order 7F3A2B10" is about the
 * same row on both sides. Rows predating the uuid column fall back to `#id`.
 */
export function orderRef(order) {
  if (!order) return '';
  if (order.uuid) return order.uuid.split('-')[0].toUpperCase();
  return `#${order.id}`;
}

/** Two-letter monogram for an avatar. */
export function initials(name) {
  return String(name || '?').slice(0, 2).toUpperCase();
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How long ago, in the fewest characters that stay unambiguous.
 *
 * Deliberately coarse: an operator scanning a queue wants "is this from today
 * or from last week", and a card that says "2 minutes and 14 seconds ago" reads
 * as precision nobody asked for. Anything older than a year drops to the date.
 *
 * `now` is passed in rather than read here so a page can drive every card from
 * one timer instead of each card holding its own.
 */
export function relTime(value, now = Date.now()) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '—';

  const delta = now - then;
  // A clock skew between the server and the browser can put a just-created row
  // a few seconds into the future. "in 4 seconds" for something that plainly
  // already happened is worse than rounding it to now.
  if (delta < MINUTE) return 'just now';
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  if (delta < 365 * DAY) return `${Math.floor(delta / (30 * DAY))}mo ago`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/**
 * `in 9d`, `in 4h`, `in 12m` — how long until something happens.
 *
 * `relTime` cannot answer this and must not be asked to. It deliberately
 * collapses everything in the future to "just now", because the future it was
 * written for is a few seconds of clock skew on a row that was plainly created
 * in the past, and "in 4 seconds" is a worse answer than "now" for that. Point
 * it at a real future date — an expiry, a scheduled end — and it reports every
 * one of them as "just now": an invite link with nine days left and one that
 * lapses this second read identically, which is the difference between a link
 * that is fine and a link that is about to stop working.
 *
 * Anything already past falls through to `relTime`, so one call site can print
 * both sides of a deadline without branching on the clock itself.
 */
export function untilTime(value, now = Date.now()) {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '—';

  const delta = then - now;
  if (delta <= 0) return relTime(then, now);
  if (delta < MINUTE) return 'in under a minute';
  if (delta < HOUR) return `in ${Math.floor(delta / MINUTE)}m`;
  if (delta < DAY) return `in ${Math.floor(delta / HOUR)}h`;
  if (delta < 30 * DAY) return `in ${Math.floor(delta / DAY)}d`;
  if (delta < 365 * DAY) return `in ${Math.floor(delta / (30 * DAY))}mo`;
  return `on ${new Date(then).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
}

/** Age in whole days, for colouring something by how long it has been waiting. */
export function ageDays(value, now = Date.now()) {
  if (!value) return 0;
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((now - then) / DAY));
}

/** `Mar 4, 14:22` — the compact form used inside cards. */
export function shortDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** `Mar 4, 2026`. */
export function shortDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The full timestamp, for a `title=` on something showing a relative one.
 * The relative form is what gets read; this is what gets checked.
 */
export function fullDate(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

/** `pending_payment` → `pending payment`. */
export function humanize(value) {
  return String(value || '').replace(/_/g, ' ');
}

/**
 * The stagger index for an arrival animation, capped.
 *
 * Uncapped, the fiftieth card on a page waits two and a half seconds to appear
 * — which is not a flourish, it is a page that looks broken. Everything past
 * the cap arrives together.
 */
export function stagger(index, cap = 14) {
  return Math.min(index, cap);
}
