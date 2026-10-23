import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { canAccessAdminPath } from '../../utils/adminPermissions';
import { NEXT_STOPS } from '../../utils/nextStops';

/**
 * Where an operator goes after this page.
 *
 * ── The audit that produced this ────────────────────────────────────────────
 *
 * DESIGN §9: "Audit the dead ends. When a page is finished, list its outbound
 * paths. If the answer is 'back', the page is not finished."
 *
 * Counting `<Link>`, `navigate(` and `<a href>` across the admin, seven pages
 * had none at all — and they were not the small ones:
 *
 *     PgpKeys 1495 lines · Theme 1478 · Nodes 1140 (one link) · AiSettings 918
 *     Tiers 440 · ZelleAccounts 267 · CashMail 222
 *
 * The sharpest case is the one that names records and offers no way to reach
 * them: `storePgpController` computes `countSealedToOtherKeys` — "N orders are
 * sealed to a key that is not the active one" — and prints the number on a page
 * from which those orders are unreachable. §9's own rule is "if a field names
 * another record, it is a link".
 *
 * ── Why a component and a map, rather than links typed into seven pages ─────
 *
 * The same reasoning `utils/riskChecks.js` gives for `CHECK_META`, which solved
 * this problem once already for the risk board: a hand-written link inside a
 * page is invisible to any check, so the eighth page added next year is a dead
 * end again and nothing says so. Here the map is data, every entry is filtered
 * through the same `canAccessAdminPath` the nav uses, and
 * `client/test/nextStops.test.mjs` asserts that every admin route either has an
 * entry or is listed as deliberately terminal.
 *
 * ── Permission-filtered, not permission-greyed ──────────────────────────────
 *
 * `AdminSearch`'s rule, inherited rather than re-decided: a destination the
 * viewer cannot open is ABSENT. A greyed row still discloses that the store has
 * a Zelle pool, and pressing it can only ever land on a 403. A page whose every
 * onward link is filtered out renders nothing at all rather than an empty
 * heading — which is correct: for that viewer it genuinely is the end of the
 * road, and saying "next: (nothing)" would be worse than silence.
 */

export default function NextStops({ route, extra = [] }) {
  const { user } = useAuth();
  const stops = [...(NEXT_STOPS[route] || []), ...extra];

  const visible = stops.filter((s) => (
    // A non-admin destination — the storefront — is not in the permission map,
    // and an unlisted path resolves to "no permission required". That is the
    // right answer here and the wrong one for an admin route, which is why the
    // map in adminPermissions.js has no holes.
    !s.to.startsWith('/admin/') || canAccessAdminPath(user, s.to.split('?')[0])
  ));

  if (!visible.length) return null;

  return (
    <nav className="nextstops" aria-label="Where to go next">
      <span className="nextstops-label">Next</span>
      {visible.map((s) => (
        <Link key={s.to} to={s.to} className="nextstops-link">
          {s.label}
          <ArrowUpRight size={12} aria-hidden="true" />
        </Link>
      ))}
    </nav>
  );
}
