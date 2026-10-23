/**
 * How a staff notice READS on the board — the pure half of
 * `components/admin/StaffNotices.jsx`, kept apart so the rules below are pinned
 * by `client/test/staffNotices.test.mjs` without a browser.
 *
 * ── Why the board rewrites what it was sent ─────────────────────────────────
 *
 * Every notice is headed by the first line of a message written for a CHAT
 * network. `staffNotify` derives it from the bot text on purpose — that text is
 * the per-recipient, already-redacted copy, and that property is worth more
 * than tidy headings — so the board inherits two habits of a Telegram message
 * that are wrong on a list:
 *
 *   A leading emoji. On a chat it is the only iconography there is; on this
 *   board every row already carries an icon for its kind, so "🛒" beside a
 *   shopping-bag icon said the same thing twice in two visual languages. But
 *   some of those marks carry SEVERITY — the store-health scan opens with 🟢,
 *   🟠 or 🔴, a payment that needs a look with ⚠️ — and dropping them outright
 *   would delete the one signal separating "look at this" from "this is fine".
 *   So a mark is read before it is removed: a severity mark becomes the row's
 *   tone, which the icon tile paints, and any other mark is simply dropped.
 *
 *   The full order uuid. Thirty-six characters is most of a row, and it pushed
 *   "needs review" — the only words saying what happened — past the ellipsis on
 *   every payment alert. Every other screen in the console calls an order by
 *   its first segment, uppercased (`boxTag.shortRef`), so the board does too.
 *   The row's link still carries the whole id.
 *
 * Neither rewrite reaches the database: the row keeps exactly what the
 * broadcaster sent. And both are total — a new broadcaster opening with a mark
 * this file has never heard of gets the mark dropped and a neutral tone, never
 * a broken row.
 */
import { shortRef } from './boxTag.js';

/**
 * The marks that mean something, worst first, so a title that opens with two
 * (a builder concatenating another's heading) takes the more urgent one.
 */
const TONES = [
  ['danger', ['🔴', '🚨', '⛔', '🛑', '❌']],
  ['warning', ['🟠', '🟡', '⚠']],
  ['success', ['🟢', '✅']],
];

/**
 * A kind's tone when its title carried no mark. Only kinds whose every notice
 * is somebody's problem get one: a new order is good news and stays neutral.
 */
const KIND_TONES = { dispute: 'danger', parcel: 'warning', stock: 'warning' };

/**
 * A run of pictographs at the start of a line — with the joiners, variation
 * selectors, skin tones and regional indicators that ride along with them.
 *
 * `Extended_Pictographic` and not `Emoji`: the Emoji property includes the
 * ASCII digits, because each is the base of a keycap sequence, and "3 parcels
 * need attention" would have lost its count.
 */
const LEAD_MARK = /^(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{FE0F}\u{200D}\u{20E3}]|\s)+/u;

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Every uuid in a string, printed the way the rest of the console prints an order. */
export function shortenRefs(text) {
  return String(text ?? '').replace(UUID, (uuid) => shortRef(uuid));
}

/** `{ title, tone }` for a stored title. `tone` is null when no mark said one. */
export function readTitle(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  const lead = LEAD_MARK.exec(text)?.[0] || '';
  const tone = TONES.find(([, marks]) => marks.some((m) => lead.includes(m)))?.[0] || null;
  // A title that was nothing BUT a mark keeps it: a blank row is worse than a
  // doubled icon.
  const rest = text.slice(lead.length).trim() || text;
  return { title: shortenRefs(rest), tone };
}

/** The tone a row is painted in: its mark's, else its kind's, else none. */
export function toneFor(kind, markTone) {
  return markTone || KIND_TONES[kind] || null;
}

/** Unmarked, single-spaced and lowercased — for comparing a line with a title. */
function plain(s) {
  return String(s ?? '').replace(LEAD_MARK, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * The body as the board shows it: without the line the title already says.
 *
 * The stored body is the whole broadcast, and its first line is nearly always
 * the heading the title came from — "⚠️ Order … Needs Review" under a title of
 * "⚠️ Order … needs review". Printed twice, the line that actually differed —
 * the reason — was the one the clamp cut off.
 *
 * Dropped only when one begins the other, so a first line that says something
 * new (a builder whose title is a summary and whose body opens with detail)
 * survives.
 */
export function readBody(body, rawTitle) {
  const lines = String(body ?? '').replace(/\r\n?/g, '\n').split('\n');
  const first = plain(lines[0]);
  const head = plain(rawTitle);
  if (first && head && (head.startsWith(first) || first.startsWith(head))) lines.shift();
  return shortenRefs(lines.join('\n').replace(/\n{3,}/g, '\n\n').trim());
}

/** "now", "4m", "3h", "2d" — the same shorthand the order lists use. */
export function ago(iso, now = Date.now()) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const secs = Math.max(0, Math.floor((now - then) / 1000));
  if (secs < 60) return 'now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * "Today", "Yesterday", a weekday inside the last week, a date beyond it.
 *
 * Days are counted between local midnights and ROUNDED, so the 23- and 25-hour
 * days either side of a clock change still count as one. A timestamp from the
 * future — a server clock a minute ahead — reads as today rather than as
 * something stranger.
 */
export function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'Undated';
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}

/**
 * Rows under their day, in the order given, each day counting its unread.
 *
 * Adjacent runs rather than a map keyed by day: the board is already newest
 * first, and this must not reorder it. A repeat that fires again floats its row
 * to the head server-side, so its day changes with it — which is correct, the
 * row is about something that happened today.
 */
export function groupByDay(notices, now = new Date()) {
  const groups = [];
  for (const n of notices || []) {
    const d = new Date(n.created_at);
    const key = Number.isFinite(d.getTime()) ? String(startOfDay(d)) : 'undated';
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: dayLabel(n.created_at, now), items: [], unread: 0 };
      groups.push(g);
    }
    g.items.push(n);
    if (!n.read_at) g.unread += 1;
  }
  return groups;
}

const KIND_LABELS = {
  order: 'Order',
  stock: 'Stock',
  risk: 'Risk',
  ops: 'Ops',
  support: 'Support',
  parcel: 'Parcel',
  pack: 'Packing',
  returns: 'Return',
  dispute: 'Dispute',
};

/** The word printed beside a row's icon — the icon's second channel. */
export function kindLabel(kind) {
  return KIND_LABELS[kind] || 'Notice';
}

const PAGE_NAMES = {
  '/admin': 'Dashboard',
  '/admin/dashboard': 'Dashboard',
  '/admin/risk': 'Risk board',
  '/admin/stock': 'Stock ops',
  '/admin/disputes': 'Disputes',
  '/admin/support': 'Support desk',
  '/admin/pack': 'Packing',
  '/admin/ship': 'Ship desk',
};

const ORDER_PATH = /^\/admin\/orders\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/**
 * The path a row's link should actually navigate to.
 *
 * The console has no page at `/admin/orders/<uuid>`: one order is reached as
 * the queue searched for it, `/admin/orders?search=<uuid>` — how the
 * dashboard, the audit log and the users page all link to one. Two
 * broadcasters (the pack bench's short-pick alert and the returns desk) linked
 * to the path form anyway, so those notices opened the admin 404. They are
 * fixed at the source; this rewrites the rows already sitting on boards, which
 * live for up to thirty days. Anything else passes through untouched.
 */
export function hrefFor(link) {
  if (!link) return null;
  const m = ORDER_PATH.exec(String(link));
  return m ? `/admin/orders?search=${m[1].toLowerCase()}` : String(link);
}

/**
 * Where following a row goes, in words — printed on the row so an operator
 * knows before pressing whether it lands on one order or on the queue of all
 * of them. Takes the link AFTER `hrefFor`. Null for a row with no link.
 */
export function destinationFor(link) {
  if (!link) return null;
  const [path, query = ''] = String(link).split('?');
  if (path === '/admin/orders') {
    if (/(^|&)search=/.test(query)) return 'Open order';
    if (/(^|&)parcel=/.test(query)) return 'Parcels to check';
    return 'Order queue';
  }
  if (/^\/admin\/support\/[^/]+$/.test(path)) return 'Open ticket';
  return PAGE_NAMES[path] || 'Open';
}
