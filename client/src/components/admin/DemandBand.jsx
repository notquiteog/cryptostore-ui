import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Bell, BellRing, Eye, EyeOff, Heart, ShoppingCart, Tag, Zap,
} from 'lucide-react';
import { api } from '../../utils/api';
import StatTiles from './StatTiles';
import { RankedBars } from './widgets';
import { hasAdminPermission } from '../../utils/adminPermissions';

/**
 * "What people want" — the Analytics page's demand band.
 *
 * Every other band on that page is drawn from orders: money that already
 * moved. This one is drawn from the four standing ways somebody says "I want
 * this" without paying — a restock subscription, a price watch, a wishlist
 * save, a line sitting in a cart — plus the two rate questions an operator
 * asks next: what gets looked at, and what leaves the shelf fastest.
 * `analyticsController.demand` is the other half and carries the reasoning
 * for each figure.
 *
 * ── The three cards, and why they are not three equal cards ────────────────
 *
 * The demand table is the band (DESIGN §1: real information is not uniformly
 * weighted). It is the thing an operator opens this page to act on — it names
 * a product, says how many people are waiting for it and what would have to
 * change, and links to the editor where they change it. Views and velocity
 * are context beside it: one says whether a product is even being seen, the
 * other says what is leaving fastest. So the table spans the grid and the two
 * rate cards sit under it as peers to each other, not to it.
 *
 * ── Sorting ────────────────────────────────────────────────────────────────
 *
 * Client-side, over the rows the server sent, and that is only honest because
 * of how the server picks them: it unions the top N by EACH of the five
 * orderings, so every column's top N is in the payload before anything is
 * clicked. Sorting a plain "top ten by people" would have quietly reordered a
 * set that did not contain the answer — the worst kind of wrong, because it
 * looks right. The footnote says how many variants the store has a signal for,
 * so a reader can see what the table is a slice of.
 */

/**
 * The sortable columns, in the order the header draws them — which must be the
 * order the body draws its cells in. They were not, once: the header listed
 * People first and the body printed it last, so the table showed every row's
 * restock queue under the heading "People" and its people count under "In
 * carts". Both were real numbers in the wrong column, which is the failure
 * mode a table has that a list does not, and nothing about it looked broken.
 *
 * The four signals lead and `people` closes, because it is the summary of the
 * four to its left rather than a fifth peer — and it is the default sort.
 */
const COLUMNS = [
  { key: 'restock', label: 'Restock', title: 'Asked to be told when it is back in stock' },
  { key: 'watch', label: 'Price watch', title: 'Asked to be told when it gets cheaper' },
  { key: 'wishlist', label: 'Wishlist', title: 'Saved to a wishlist' },
  { key: 'cart', label: 'In carts', title: 'Sitting in a cart right now, unbought' },
  { key: 'people', label: 'People', title: 'Distinct accounts behind any of the four signals' },
];

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

/**
 * "CUREpen Cart · Gelato", or just the product where the variant adds nothing.
 *
 * One rule for every list in the band. A variant name alone identifies nothing
 * — half this catalogue's variants are called "V", "Only" or "Black" — and a
 * product name alone is ambiguous the moment two of its variants both appear,
 * which on a demand board is the common case rather than the edge one.
 */
const fullName = (r) => (r.variant_name && r.variant_name !== r.group_name
  ? `${r.group_name} · ${r.variant_name}`
  : r.group_name);

export default function DemandBand({ days, onDays, loading, error, data, user, onRefresh }) {
  const [sortBy, setSortBy] = useState('people');

  const totals = data?.totals;
  const wanted = data?.wanted || [];
  const views = data?.views;
  const fastest = data?.fastest || [];

  // The product editor is gated on catalogue-writing grants, and an analyst
  // holding only `analytics.reports` has none of them. Linking anyway would
  // send the one reader most likely to click into a permission wall, so the
  // name is drawn as plain text for them instead — DESIGN §9 is "link to where
  // they go next", not "link somewhere".
  const canEditCatalog = hasAdminPermission(user, ['products.edit', 'products.stock', 'products.media']);
  const canSeeCatalog = hasAdminPermission(user, 'products.view');
  const canSeeStockDesk = hasAdminPermission(user, ['products.count', 'products.stock', 'products.receive', 'orders.returns']);
  // Turning off what the store records is not something a reporting scope
  // carries; `settings.security` is the grant that owns what this box retains
  // about buyers. Everyone who can read the band sees the switch's state —
  // only somebody who can change it gets the control, the same shape the
  // marketing console uses for arrival counting.
  const canSetRetention = hasAdminPermission(user, 'settings.security');

  const windowLabel = days === 365 ? 'the last year' : `the last ${days} days`;
  const split = storefrontSplit(views?.by_source);
  const splitLine = split && views?.total ? `${views.total.toLocaleString()} opens in all — ${split}.` : null;

  const sorted = [...wanted].sort((a, b) => (b[sortBy] - a[sortBy]) || (b.people - a.people)
    || a.group_name.localeCompare(b.group_name));


  return (
    <section className="dmd" id="analytics-demand" data-search-target="analytics-demand" aria-busy={loading}>
      <div className="anx-head">
        <div>
          <h2 className="anx-title">What people want</h2>
          <p className="anx-lede">
            Demand that has not become an order yet. The four signals are standing requests, not
            events — somebody who asked to be told six months ago is still waiting, so they are
            counted whatever the window says. Opens and units per day are over {windowLabel}.
          </p>
        </div>
        <div className="anx-window" role="group" aria-label="Window for this band">
          {[30, 90, 365].map((d) => (
            <button
              key={d}
              type="button"
              className={`glass-btn glass-btn-sm${days === d ? ' glass-btn-primary' : ''}`}
              onClick={() => onDays(d)}
              disabled={loading}
            >
              {d === 365 ? '1y' : `${d}d`}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="anx-error" role="alert">{error}</p>}

      {totals && (
        <StatTiles stats={[
          {
            key: 'people',
            label: 'People waiting',
            value: totals.people.toLocaleString(),
            hint: `across ${totals.variants.toLocaleString()} product${totals.variants === 1 ? '' : 's'}`,
            tone: 'var(--primary)',
            icon: Heart,
            lead: true,
          },
          {
            key: 'restock',
            label: 'Restock alerts',
            value: totals.restock.toLocaleString(),
            // The un-latched half is the backlog: these are the messages the
            // store owes the next time each product comes back. The total on
            // its own reads as a mailing list.
            hint: `${totals.restock_waiting.toLocaleString()} still to hear`,
            tone: 'var(--warning)',
            icon: Bell,
          },
          {
            key: 'watch',
            label: 'Price watches',
            value: totals.watch.toLocaleString(),
            hint: `${totals.watch_waiting.toLocaleString()} still to hear`,
            tone: 'var(--accent)',
            icon: Tag,
          },
          {
            key: 'wishlist',
            label: 'Wishlisted',
            value: totals.wishlist.toLocaleString(),
            tone: 'var(--secondary)',
            icon: Heart,
          },
          {
            key: 'cart',
            label: 'In carts now',
            value: totals.cart.toLocaleString(),
            hint: 'unbought lines',
            tone: 'var(--success)',
            icon: ShoppingCart,
          },
        ]}
        />
      )}

      <div className="dmd-grid">
        {/* ── Wanted, not sold ── */}
        <div className="glass-card anx-card dmd-card-full">
          <h3><BellRing size={15} aria-hidden="true" /> Wanted, not sold</h3>
          {sorted.length === 0 ? (
            <InsightEmpty>
              Nobody has set a restock alert, watched a price, saved a wishlist or left anything in a
              cart yet. A product page with no stock and no alert button on it is the usual reason.
              {/* DESIGN §9: an empty state is navigation, not an apology — but
                  only where the reader can actually go there. A manager with
                  reporting scope and no catalogue grant gets the sentence and
                  no link, rather than a link into a permission wall. */}
              {canSeeCatalog && <> <Link to="/admin/products">Open the catalogue</Link>.</>}
            </InsightEmpty>
          ) : (
            <>
              {/* DESIGN §6: the responsive table, not two purpose-built views.
                  Every column here is a number a phone can hold, the row has no
                  image and no swipe, and `data-label` turns each cell into its
                  own labelled line under 720px — which is exactly the shape
                  this record wants on a phone. */}
              <div className="admin-rtable-wrap dmd-wrap">
                <table className="admin-rtable rtable-skin dmd-table">
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col" className="dmd-num">Stock</th>
                      {COLUMNS.map((c) => (
                        <th
                          key={c.key}
                          scope="col"
                          className="dmd-num"
                          aria-sort={sortBy === c.key ? 'descending' : 'none'}
                        >
                          <button
                            type="button"
                            className={`dmd-sort${sortBy === c.key ? ' is-on' : ''}`}
                            onClick={() => setSortBy(c.key)}
                            title={`${c.title} — click to sort`}
                          >
                            {c.label}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => (
                      <tr key={r.variant_id}>
                        <td data-label="Product">
                          <span className="dmd-name">
                            {canEditCatalog
                              ? <Link to={`/admin/products/${r.group_id}/edit`}>{fullName(r)}</Link>
                              : fullName(r)}
                          </span>
                          {!r.listed && <small className="dmd-hidden-flag">hidden from the storefront</small>}
                        </td>
                        {/* Out of stock is only alarming when somebody is
                            waiting on it, so the tone is conditional rather
                            than "zero is always red" — a discontinued line at
                            zero that nobody asked about is fine. */}
                        <td data-label="Stock" className={`dmd-num${r.quantity === 0 && r.restock_waiting > 0 ? ' is-gone' : ''}`}>
                          {r.quantity.toLocaleString()}
                        </td>
                        <td data-label="Restock" className="dmd-num">
                          <Figure value={r.restock} sub={r.restock_waiting > 0 ? `${r.restock_waiting} to hear` : null} />
                        </td>
                        <td data-label="Price watch" className="dmd-num">
                          <Figure
                            value={r.watch}
                            // The lowest price any un-notified watcher was
                            // quoted: the line a sale has to cross for at least
                            // one person to be told. An average would name a
                            // price that reaches nobody.
                            sub={r.watch_floor_cents != null ? `under ${money(r.watch_floor_cents)}` : null}
                          />
                        </td>
                        <td data-label="Wishlist" className="dmd-num"><Figure value={r.wishlist} /></td>
                        <td data-label="In carts" className="dmd-num"><Figure value={r.cart} /></td>
                        <td data-label="People" className="dmd-num dmd-people">{r.people.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="dmd-note">
                {sorted.length.toLocaleString()} of {totals?.variants.toLocaleString()} product
                {totals?.variants === 1 ? '' : 's'} with a signal — the top ten by each column, so
                every sort has its own answer in it. <strong>People</strong> counts accounts, not
                requests: somebody who wishlisted a thing and set a restock alert on it is one
                person. Nobody is named.
              </p>
            </>
          )}
        </div>

        {/* ── Most opened ── */}
        <div className="glass-card anx-card">
          <h3><Eye size={15} aria-hidden="true" /> Most opened</h3>
          {/* Said before the numbers and only when it is true, because a card
              of zeros with no explanation looks like a broken page rather than
              a store nobody visits. Everybody who can read the band sees the
              sentence; only somebody who can change the setting gets a switch,
              and without one the sentence still says where the decision
              lives. */}
          {views && !views.counting && (
            <p className="dmd-notice">
              <EyeOff size={14} aria-hidden="true" />
              <span>
                This store is no longer counting product opens. Counts already taken are kept and
                shown below; nothing new is being added.
              </span>
              {canSetRetention && <CountingToggle enabled={false} onDone={onRefresh} />}
            </p>
          )}
          {!views || views.products.length === 0 ? (
            <InsightEmpty>
              {views?.counting === false
                ? 'Nothing was counted before counting was switched off.'
                : <>No product has been opened in {windowLabel} yet.{' '}
                  {days < 365 && <button type="button" className="anx-link" onClick={() => onDays(365)}>Look at the whole year</button>}</>}
            </InsightEmpty>
          ) : (
            <RankedBars
              rows={views.products}
              valueOf={(p) => p.views}
              labelOf={(p) => p.group_name}
              // Opens are only meaningful against what they turned into, so the
              // sub-line carries the orders rather than repeating the number
              // the bar already draws.
              subOf={(p) => `${p.orders.toLocaleString()} order${p.orders === 1 ? '' : 's'}`}
              format={(v) => `${v.toLocaleString()} opens`}
              tone="var(--primary)"
            />
          )}
          {splitLine && <p className="dmd-split">{splitLine}</p>}
          <p className="dmd-note">
            Page opens, <strong>not people</strong>: a refresh counts again and a crawler counts
            once per product. Nothing about who opened a page is recorded — no account, no address,
            no session — so this is a ratio between products, never an audience.
            {views?.first_day && <> Counting since {views.first_day}, kept for {views.retention_days} days.</>}
          </p>
          {views?.counting && canSetRetention && <CountingToggle enabled onDone={onRefresh} />}
        </div>

        {/* ── Fastest off the shelf ── */}
        <div className="glass-card anx-card">
          <h3><Zap size={15} aria-hidden="true" /> Fastest off the shelf</h3>
          {fastest.length === 0 ? (
            <InsightEmpty>
              Nothing has sold three or more in {windowLabel} — too little history to call anything
              fast.{' '}
              {days < 365 && <button type="button" className="anx-link" onClick={() => onDays(365)}>Look at the whole year</button>}
            </InsightEmpty>
          ) : (
            <RankedBars
              rows={fastest}
              valueOf={(f) => f.units_per_day}
              labelOf={fullName}
              subOf={(f) => `${f.units.toLocaleString()} in ${fmtDays(f.days_live)}`}
              format={(v) => `${v.toFixed(2)}/day`}
              tone="var(--success)"
            />
          )}
          {fastest.length > 0 && <p className="dmd-split">{coverLine(fastest)}</p>}
          <p className="dmd-note">
            Units per day <strong>since it was listed</strong>, not per day of the window — which is
            why this is a different ranking from Best Sellers above, and why a drop from last week
            can head it. Under three units sold there is no believable rate, so nothing is claimed.
            {canSeeStockDesk && <> <Link to="/admin/stock">Stock ops</Link> is where the cover
            figures get acted on.</>}
          </p>
        </div>
      </div>
    </section>
  );
}

/** A count with an optional second line. Zero is drawn muted, never bold. */
function Figure({ value, sub = null }) {
  if (!value) return <span className="dmd-zero">—</span>;
  return (
    <span className="dmd-fig">
      <b>{value.toLocaleString()}</b>
      {sub && <small>{sub}</small>}
    </span>
  );
}

function InsightEmpty({ children }) {
  return <p className="anx-empty">{children}</p>;
}

/**
 * "84,213 on the web, 22,101 on Telegram, 9,049 on Potato" — store-wide, and
 * only the storefronts that saw anything. A store with no bot linked should not
 * be told twice that its bots saw nothing.
 */
function storefrontSplit(by) {
  if (!by) return null;
  const bits = [];
  if (by.web > 0) bits.push(`${by.web.toLocaleString()} on the web`);
  if (by.telegram > 0) bits.push(`${by.telegram.toLocaleString()} on Telegram`);
  if (by.potato > 0) bits.push(`${by.potato.toLocaleString()} on Potato`);
  return bits.length > 1 ? bits.join(', ') : null;
}

/** "18.7 days" / "1 day", from the floored days-listed figure. */
function fmtDays(d) {
  const n = Number(d) || 0;
  if (n < 2) return `${n % 1 === 0 ? n : n.toFixed(1)} day`;
  return `${n % 1 === 0 ? n : n.toFixed(1)} days`;
}

/**
 * What the rate above actually means for the shelf, as one line under the
 * list rather than a suffix on every row.
 *
 * It is not a per-row clause because a variant already at zero has no cover to
 * report, and printing "0 days of cover" about something that is already gone
 * is a forecast about the past. What an operator needs from this list is the
 * count of fast movers that have ALREADY run out — those are the ones the
 * demand table above is about to fill up with — and the soonest one still
 * standing.
 */
function coverLine(rows) {
  const gone = rows.filter((f) => f.quantity === 0);
  const soonest = rows
    .filter((f) => f.quantity > 0 && f.days_of_cover != null)
    .sort((a, b) => a.days_of_cover - b.days_of_cover)[0];
  const bits = [];
  if (gone.length) bits.push(`${gone.length} of these ${gone.length === 1 ? 'is' : 'are'} already out of stock`);
  if (soonest) {
    bits.push(`${fullName(soonest)} runs out in ${fmtDays(soonest.days_of_cover)} at this rate`);
  }
  return bits.length ? `${bits.join('; ')}.` : null;
}

/**
 * The counting switch, drawn only for somebody who may flip it.
 *
 * Turning it off is the destructive-feeling direction, so that one asks —
 * and the question says what is actually lost, which is the denominator and
 * not the history. Turning it back on needs no confirmation: it starts a
 * counter, it does not disclose anything that was not already being recorded
 * before it was switched off.
 */
function CountingToggle({ enabled, onDone }) {
  const [busy, setBusy] = useState(false);

  const flip = async () => {
    const next = !enabled;
    if (!next && !confirm(
      'Stop counting product opens?\n\n'
      + 'Counts already taken are kept and the rest of this band keeps working — restock alerts, '
      + 'price watches, wishlists, carts and sales are all worked out from rows the shop holds '
      + 'anyway. What you lose is the denominator: you will no longer be able to tell a product '
      + 'nobody found from one everybody looked at and nobody bought.'
    )) return;
    setBusy(true);
    try {
      await api.put('/settings', { product_view_counting: next ? 'true' : 'false' });
      toast.success(next ? 'Counting product opens again' : 'Product opens are no longer counted');
      await onDone?.();
    } catch (err) {
      toast.error(err.message || 'Could not change the setting');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="glass-btn glass-btn-sm dmd-track-btn" onClick={flip} disabled={busy}>
      {enabled ? 'Stop counting opens' : 'Start counting opens'}
    </button>
  );
}
