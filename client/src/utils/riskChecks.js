import { canAccessAdminPath } from './adminPermissions.js';

/**
 * What the risk board knows about a check beyond what the scan sends.
 *
 * The server's registry (`services/riskScan.js` → `CHECKS`) owns the check: its
 * key, its permission, its severity and the sentence it says. This file owns
 * the two things that are purely the console's business — where an operator
 * goes to *fix* the thing, and how the numbers in `detail` are printed — and it
 * is a separate module for the same reason `auditActions.js` is: a map keyed by
 * a server string, living on the client, that would otherwise be five hundred
 * lines of switch inside a page component.
 *
 * The failure this shape prevents is a stale link. Every `to` below is checked
 * against the router in `test/riskChecks.test.mjs`, and every key against the
 * server registry, so a check renamed on the server or a route renamed in the
 * app fails the suite instead of silently rendering a button that 404s.
 */

/* ── Severity ─────────────────────────────────────────────────────────────── */

/**
 * The ladder, mirrored from the server's.
 *
 * `unknown` sits between ok and warn on both sides of the wire, and it is the
 * value most likely to be "tidied" into a synonym for one of its neighbours. A
 * check whose source could not be reached has not said the store is fine and
 * has not said it is broken.
 *
 * `tone` is a token reference, never a literal: the operator owns the palette,
 * and a hex here would survive a theme change that nothing else did.
 */
export const SEVERITY = {
  critical: { rank: 3, label: 'Critical', tone: 'var(--danger)' },
  warn: { rank: 2, label: 'Warning', tone: 'var(--warning)' },
  unknown: { rank: 1, label: 'Unknown', tone: 'var(--text-muted)' },
  ok: { rank: 0, label: 'Clear', tone: 'var(--success)' },
};

export const sev = (severity) => SEVERITY[severity] || SEVERITY.unknown;

/** Worst-first, then alphabetical — so the thing to act on is the thing on top. */
export function bySeverity(a, b) {
  return sev(b.severity).rank - sev(a.severity).rank || a.label.localeCompare(b.label);
}

/* ── Where the fix lives ──────────────────────────────────────────────────── */

/**
 * Per check: the pages an operator goes to next, and what to do when there is
 * no page to go to.
 *
 * DESIGN §9 — "if a field names another record, it is a link", and "audit the
 * dead ends". A board that says the Zelle pool is 92% consumed and offers no
 * way to reach the Zelle accounts is a screen whose only outbound path is the
 * back button.
 *
 * `links` is a function of the row rather than a constant because two checks
 * genuinely depend on their own detail: the bots check should offer the
 * settings card for the bot that is actually down, not both. `hint` is for the
 * checks whose fix is not a page in this app at all — saying "run the
 * migrations on the server" is more use than a link to somewhere that cannot
 * do it.
 */
export const CHECK_META = {
  'recipient.cash_mail_capacity': {
    links: () => [{ to: '/admin/cash-mail', label: 'Cash-in-mail addresses' }],
    hint: 'Raise a cap, or activate another drop address — the pool is the sum of what is active.',
  },
  'recipient.zelle_capacity': {
    links: () => [{ to: '/admin/zelle', label: 'Zelle accounts' }],
    hint: 'Raise a cap, or activate another account — the pool is the sum of what is active.',
  },
  'pgp.key_expiry': {
    links: () => [{ to: '/admin/pgp', label: 'Store PGP key' }],
    // Three states, because the lamp now watches three things. The middle one
    // is the one worth spelling out: a key with no private half here encrypts
    // perfectly and cannot be read back, so nothing looks wrong until an order
    // reaches the Ship desk.
    hint: 'Buyers encrypt shipping addresses to this key. Without its private half the shop cannot read them back; '
      + 'with a passphrase it cannot sign unattended; expired, it cannot be replaced quietly.',
  },
  'pgp.canary': {
    links: () => [{ to: '/admin/canary', label: 'Warrant canary' }],
    hint: 'The canary renews from a budget you top up by hand. A stale one tells readers to assume the worst — which is what it is for.',
  },
  'db.migrations_pending': {
    links: () => [],
    // No admin page can apply a migration, and pretending otherwise would be
    // the worst kind of dead end: one that looks like a way out.
    hint: 'Run `npm run migrate` on the server. Until then the code is expecting columns the database does not have.',
  },
  'disk.uploads': {
    links: () => [{ to: '/admin/products', label: 'Products' }],
    hint: 'Product media is the bulk of this directory; deleted products do not delete their images.',
  },
  'disk.wallets': {
    links: () => [{ to: '/admin/nodes', label: 'Nodes' }],
    hint: 'Wallet files and chain data share this filesystem. A full disk stops a node mid-write.',
  },
  'nodes.reachable': {
    links: () => [{ to: '/admin/nodes', label: 'Nodes' }],
    hint: 'A node behind the tip still takes payments; it just notices them late.',
  },
  'payments.detection': {
    links: () => [
      { to: '/admin/nodes', label: 'Nodes' },
      { to: '/admin/orders?status=pending_payment', label: 'Orders awaiting payment' },
    ],
    hint: 'Measured from the newest confirmation found, not from a heartbeat — this says payments are being detected, not that a timer fired.',
  },
  'payments.forwarding': {
    links: () => [{ to: '/admin/nodes', label: 'Nodes' }],
    hint: 'Read from the sweep\'s own record of its last run. Failed usually means a wallet re-locked itself after a daemon restart — the Nodes page says which, and unlocks it. Waiting means coins are sitting below the required depth and the checker is retrying every tick; a day of that is an output that will never get deeper, such as an abandoned partial payment holding a Monero sweep back.',
  },
  'checkout.ready': {
    // Four different walls, four different pages. A constant list here would
    // send an operator whose catalogue is empty to the payments card, which is
    // the dead-end-that-looks-like-an-exit this map exists to avoid — so the
    // links follow the same precedence the check itself uses.
    links: (row) => {
      const d = row?.detail || {};
      if (!Array.isArray(d.rails) || d.rails.length === 0) {
        return [{ to: '/admin/settings?hl=payments', label: 'Payment methods' }];
      }
      if (d.buyable === 0) {
        return [{ to: '/admin/products', label: 'Products' }];
      }
      if (d.address_required && !d.key_ready) {
        return [
          { to: '/admin/pgp', label: 'Store PGP key' },
          { to: '/admin/settings?hl=Address privacy', label: 'Address privacy' },
        ];
      }
      return [
        { to: '/admin/settings?hl=payments', label: 'Payment methods' },
        { to: '/admin/products', label: 'Products' },
      ];
    },
    hint: 'The preconditions a checkout hits, in order: a payment method, something buyable, and — when the shop requires encrypted addresses — a key to encrypt them to. It reads them; it never places an order.',
  },
  'credit.ledger': {
    links: () => [{ to: '/admin/store-credit', label: 'Credit ledger' }],
    // Says the one thing an operator must not do, because the obvious reaction
    // to "these disagree" is to make them agree — see services/creditReconcile.js
    // for why that erases the evidence rather than fixing anything.
    hint: 'A balance that disagrees with its own ledger is a write path getting it wrong. Correct it with an audited adjustment and a note — never by overwriting the balance to match.',
  },
  'tracking.worker': {
    links: () => [
      { to: '/admin/settings?hl=package-tracking', label: 'Package tracking settings' },
      { to: '/admin/orders?parcel=attention', label: 'Parcels flagged by carrier' },
    ],
    hint: 'A route every carrier refuses looks, from the order page, exactly like parcels that never move. Switch the route, add a proxy to the pool, or enter a carrier credential — the settings card says which carrier is in which state.',
  },
  'bots.connected': {
    links: (row) => {
      const down = Array.isArray(row?.detail?.down) ? row.detail.down : [];
      const cards = [
        { name: 'Telegram', to: '/admin/settings?hl=Telegram', label: 'Telegram settings' },
        { name: 'Potato', to: '/admin/settings?hl=Potato chat', label: 'Potato settings' },
      ].filter((c) => down.length === 0 || down.includes(c.name));
      return cards.map(({ to, label }) => ({ to, label }));
    },
    hint: 'Every alert on this board is delivered through these. A disconnected bot means the next thing to go wrong tells nobody.',
  },
  'ai.model': {
    links: () => [{ to: '/admin/ai', label: 'AI settings' }],
    hint: 'Unreachable means every AI feature is silent, not broken — the assistant sleeps and the drafts say why. A model that cannot call tools answers questions and never sets an alert, with no error anywhere; that is the warning to read twice.',
  },
  'ai.index': {
    links: () => [{ to: '/admin/ai', label: 'AI settings' }],
    hint: 'Read from the sweeper\'s own last pass, never by probing. Stalled means meaning search is answering from whatever was indexed before it stopped; word search is unaffected.',
  },
  'ai.budget': {
    links: () => [{ to: '/admin/ai', label: 'AI settings' }],
    hint: 'The ceiling you set. At it, nothing generates until midnight UTC — which is the feature working, not failing. Raise it, or find what is spending it.',
  },
  'ai.smoke': {
    links: () => [{ to: '/admin/ai', label: 'AI settings' }],
    hint: 'A question that passed yesterday and fails today usually means a topic matcher or a prompt changed, not the model. The AI page lists which checks failed.',
  },
  'bench.stalled_claims': {
    links: () => [{ to: '/admin/pack', label: 'Packing queue' }],
    hint: 'Only claims kept alive by a bought hold are counted — an ordinary claim frees itself after the idle timeout. The claims board at the top of the packing queue lists who is holding what, and how long since they last picked anything.',
  },
};

/**
 * The links for a row, minus the ones this account would be bounced from.
 *
 * Offering a manager without `orders.zelle` a button to the Zelle accounts page
 * sends them to a permission wall — which reads as the console being broken
 * rather than as them not holding the grant. `canAccessAdminPath` is the same
 * function the nav filters itself with, so the two cannot disagree.
 *
 * The query string is stripped before the check: the route table is keyed on
 * paths, and `/admin/orders?status=…` is not a key in it.
 */
export function linksFor(row, user) {
  const meta = CHECK_META[row?.key];
  if (!meta) return [];
  return meta.links(row).filter((l) => canAccessAdminPath(user, l.to.split('?')[0]));
}

/** The sentence under a check that no page can answer for it. */
export function hintFor(key) {
  return CHECK_META[key]?.hint || null;
}

/* ── The figures ──────────────────────────────────────────────────────────── */

/**
 * A check's `detail` blob as labelled figures, in a fixed order.
 *
 * Fixed, not `Object.entries`: the blobs are written by nine different check
 * functions and the key order is whatever each one happened to build. A row
 * whose figures reorder themselves between two scans is one an operator cannot
 * read down its own axis, which is the whole point of putting numbers in a
 * monospaced column.
 *
 * Unrecognised keys are dropped rather than printed raw. A new check's detail
 * shows up here by being added here — and until it is, the card falls back to
 * its summary sentence, which is always written to stand alone.
 */
const FIGURES = [
  ['worst_pct', 'consumed', (v) => `${v}%`],
  ['used_pct', 'used', (v) => `${v}%`],
  ['free_gb', 'free', (v) => `${v} GB`],
  ['recipients', 'recipients', (v) => v],
  ['nodes', 'nodes', (v) => v],
  ['behind_blocks', 'blocks behind', (v) => v],
  ['days_left', 'days left', (v) => v],
  ['pending', 'pending', (v) => v],
  ['waiting', 'waiting', (v) => v],
  ['last_activity_minutes', 'last seen', (v) => `${v}m`],
  ['coins', 'coins forwarding', (v) => v],
  // The AI checks. `used_pct` above already covers the token ceiling's bar.
  ['models', 'models', (v) => v],
  ['embedded', 'embedded last pass', (v) => v],
  ['spent', 'tokens spent', (v) => Number(v).toLocaleString()],
  ['passed', 'passed', (v) => v],
  ['failed', 'failed', (v) => v],
  ['regressions', 'regressed', (v) => v],
];

export function figuresOf(detail) {
  if (!detail || typeof detail !== 'object') return [];

  const out = [];
  for (const [key, label, format] of FIGURES) {
    if (detail[key] != null) out.push({ label, value: format(detail[key]) });
  }
  // The one list-shaped figure. Joined rather than chipped because it is at
  // most three short names ("Telegram, Potato") and a chip row for three words
  // is chrome.
  if (Array.isArray(detail.down) && detail.down.length) {
    out.push({ label: 'offline', value: detail.down.join(', ') });
  }
  return out;
}

/* ── The history band ─────────────────────────────────────────────────────── */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const ms = (value) => {
  // `new Date(null)` is the epoch, not an invalid date — so a NaN check alone
  // lets a missing timestamp through as 1970, and 1970 is before every window
  // this band draws. A check that has never been scanned would then have its
  // whole fortnight painted in whatever colour it currently is, which is the
  // exact claim the unrecorded band exists to refuse to make.
  if (value == null || value === '') return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * One check's severity over a window, reconstructed from its transitions.
 *
 * ── Why this is reconstruction and not a time series ────────────────────────
 *
 * Nothing samples these checks into a table every minute, and nothing should:
 * a scan every fifteen minutes for ninety days is nine thousand rows per check
 * saying the same word. Severity is piecewise constant — it is exactly what a
 * latch makes it — so the transitions plus the current state describe the whole
 * window losslessly, in a handful of rows.
 *
 * Walking BACKWARDS from now is what makes that work. Each event carries both
 * ends of its own crossing, so `to` is the state that ran until the next event
 * and `from` is the state that ran before it. Starting at `now` in the current
 * severity and stepping back through the events lays the whole window down
 * without ever needing a row that says "still fine".
 *
 * ── The part that must not be guessed ───────────────────────────────────────
 *
 * The stretch before the earliest evidence is drawn as `null` — not recorded —
 * and never as the colour the check happens to be now. An install whose log
 * began on Tuesday cannot claim it was healthy on Monday, and a board that
 * painted it green would be making exactly the claim the operator opened this
 * page to verify. Evidence begins at the earlier of: the transition log's first
 * row, and the latch's `changed_at`, which is real evidence in its own right —
 * it says when the current state started, whether or not anything logged it.
 *
 * @param {object} args
 * @param {string} args.severity        the check's severity now
 * @param {string|Date} args.changedAt  when that severity began
 * @param {Array}  args.events          this check's transitions, newest first
 * @param {string|Date} args.recordingSince  first row in the transition log
 * @param {number} args.from            window start, epoch ms
 * @param {number} args.to              window end, epoch ms (usually now)
 * @returns {Array<{severity: string|null, start: number, end: number, pct: number}>}
 *          oldest first, contiguous, spanning exactly the window
 */
export function bandSegments({ severity, changedAt, events = [], recordingSince, from, to }) {
  const span = to - from;
  if (!(span > 0)) return [];

  const raw = [];
  let edge = to;
  let state = severity || 'unknown';

  for (const event of events) {
    const at = ms(event.at);
    // Out-of-order or duplicate stamps would otherwise produce a segment that
    // runs backwards and paint over its neighbours. Two scans in the same
    // millisecond is not hypothetical: a forced rescan can land on the timer.
    if (at == null || at >= edge) continue;
    raw.push({ severity: state, start: at, end: edge });
    edge = at;
    state = event.from || 'unknown';
    if (at <= from) break;
  }

  const evidence = Math.min(
    ms(recordingSince) ?? Number.POSITIVE_INFINITY,
    ms(changedAt) ?? Number.POSITIVE_INFINITY,
  );

  // Everything between the earliest evidence and the oldest transition is the
  // state that transition came out of, held flat.
  if (evidence < edge) raw.push({ severity: state, start: evidence, end: edge });
  // And everything before the evidence is a stretch nobody was watching.
  if (evidence > from) raw.push({ severity: null, start: from, end: Math.min(evidence, edge) });

  // Clip to the window, drop what falls outside it, and put it in reading order.
  const clipped = raw
    .map((s) => ({ ...s, start: clamp(s.start, from, to), end: clamp(s.end, from, to) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);

  // Merge neighbours that say the same thing. Two events an hour apart that
  // both resolve to `warn` are one band, and rendering them as two leaves a
  // hairline seam that reads as a flap that never happened.
  const merged = [];
  for (const segment of clipped) {
    const last = merged[merged.length - 1];
    if (last && last.severity === segment.severity && last.end >= segment.start) {
      last.end = Math.max(last.end, segment.end);
    } else {
      merged.push({ ...segment });
    }
  }

  return merged.map((s) => ({ ...s, pct: ((s.end - s.start) / span) * 100 }));
}

/**
 * How many times a check crossed a line in the window.
 *
 * A check that trips and recovers four times a night is a different fault from
 * one that tripped once and stayed down, and the latch renders them
 * identically — this is the number that separates them.
 */
export function flapCount(events, from) {
  return events.filter((e) => {
    const at = ms(e.at);
    return at != null && at >= from;
  }).length;
}

/**
 * The band, said out loud.
 *
 * The strip is colour and geometry, which DESIGN §3 says can never be the only
 * channel — and a screen reader gets nothing at all from a row of divs. This
 * is the same fact in a sentence: how much of the window each state held,
 * largest first, in whole hours or days.
 */
export function bandLabel(segments, days) {
  if (!segments.length) return 'No history for this check.';

  const held = new Map();
  for (const s of segments) {
    const key = s.severity ?? 'unrecorded';
    held.set(key, (held.get(key) || 0) + (s.end - s.start));
  }

  const span = (unit) => (unit >= 2 * 86400000
    ? `${Math.round(unit / 86400000)}d`
    : unit >= 3600000 ? `${Math.round(unit / 3600000)}h` : `${Math.max(1, Math.round(unit / 60000))}m`);

  const words = [...held.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key, unit]) => `${span(unit)} ${key === 'unrecorded' ? 'not recorded' : sev(key).label.toLowerCase()}`);

  return `Last ${days} days: ${words.join(', ')}.`;
}
