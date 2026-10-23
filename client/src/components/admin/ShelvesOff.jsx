import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import PageHeader from './PageHeader';
import { useTheme } from '../../context/ThemeContext';

/**
 * What `/admin/shelves` and `/admin/warehouse` show on a shop that has turned
 * the shelf system off.
 *
 * ── Why these pages need anything at all ────────────────────────────────────
 *
 * Hiding the nav entries (`AdminLayout`) removes the way in; it does not remove
 * the ROUTES. A bookmark, a link a colleague pasted, a browser autocomplete, or
 * the back button all still land here — and what they landed on was a page
 * whose every fetch 404s, which renders as an empty map and a stat tile reading
 * nothing. Broken, to somebody who has no idea a switch exists.
 *
 * The honest answer is DESIGN §9's: an empty state is navigation, not an
 * apology. It names the setting, says what turning it on would restore, and
 * links to it.
 *
 * ── It says nothing is lost, because that is the question ───────────────────
 *
 * An operator who finds this after switching the system off is asking one
 * thing: did I just delete my warehouse? `utils/warehouseEnabled.js` is
 * deliberate that the switch hides surfaces and clears no data — no
 * `bin_location`, no `variant_locations`, no `warehouse_layout` — and this is
 * the screen where that promise has to be readable, because it is the screen
 * where somebody would otherwise assume the opposite.
 *
 * ── One component, two pages ────────────────────────────────────────────────
 *
 * The map and the shelf list are different screens with the same absence. Two
 * copies of this would be two sentences to keep in step about one switch, which
 * is the shape this project keeps naming.
 *
 * ── Why the gate is a WRAPPER and not an early return inside each page ──────
 *
 * `ShelfGate` below is mounted in `App.jsx` around the route, so the page
 * component either mounts or does not. The obvious alternative — an
 * `if (off) return <ShelvesOff/>` at the top of `Shelves` and `WarehouseMap` —
 * is a Rules of Hooks violation waiting for the one moment it matters: both
 * pages call a dozen hooks after that point, `warehouse_enabled` arrives in a
 * settings payload that can change while the tab is open, and the render where
 * it flips would run a different number of hooks than the last one. React's
 * answer to that is to throw "rendered fewer hooks than expected" and blank the
 * page — a crash produced by a setting working correctly.
 *
 * Gating the route sidesteps it entirely: a component that never mounts has no
 * hook order to disagree with.
 */
export function ShelfGate({ title, what, children }) {
  const { settings } = useTheme();
  // Absent means on: the key ships as 'true', and a payload that predates it
  // must not hide a map somebody drew. Same defaulting as the server's getBool.
  if (settings.warehouse_enabled === 'false') return <ShelvesOff title={title} what={what} />;
  return children;
}

export default function ShelvesOff({ title, what }) {
  return (
    <div className="admin-page">
      <PageHeader icon={MapPin} title={title} subtitle="Not in use on this store" />
      <section className="shelvesoff">
        <p className="shelvesoff-lede">
          This store does not track stock by shelf, so {what} has nothing to show.
          A variant&rsquo;s quantity is the whole truth here: there are no bin locations,
          no shelf counts and no walk order for the pull list to follow.
        </p>
        <p className="shelvesoff-safe">
          Nothing has been deleted. Any shelf locations and any map you have already
          recorded are still in the database and come back exactly as they were if you
          switch it on again.
        </p>
        <nav className="nextstops" aria-label="Where to go next">
          <span className="nextstops-label">Next</span>
          <Link to="/admin/settings?hl=Catalog" className="nextstops-link">
            Turn shelf tracking on
          </Link>
          <Link to="/admin/stock" className="nextstops-link">Stock operations</Link>
          <Link to="/admin/products" className="nextstops-link">Products</Link>
        </nav>
      </section>
    </div>
  );
}
