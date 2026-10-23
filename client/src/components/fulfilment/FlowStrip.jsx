import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Route, PackageCheck, Send, ClipboardList, ArrowRight } from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { adminCapabilities } from '../../utils/adminPermissions';

/**
 * The four stations an order passes through, with the work waiting at each,
 * drawn at the top of every fulfilment page.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * Pull list, Packing, Ship desk and Manifest were four sidebar links and four
 * pages, each correct on its own and none of them saying how they related.
 * A packer finishing a box was told in a toast that it "ships from the Ship
 * desk"; a dispatcher opening the desk had no idea whether the bench behind
 * them was empty or twenty orders deep. DESIGN §9: every screen is a
 * waypoint, and these four are waypoints on ONE route, so the route is drawn.
 *
 * ── What it says ────────────────────────────────────────────────────────────
 *
 * Each station shows its own backlog — units to pull, orders to pack, packed
 * orders waiting to ship, boxes out today — and the station this page IS is
 * lit. A station the viewer's grants do not open is drawn but not linked,
 * with its count still shown: a packer sees that eleven orders are waiting at
 * a desk they cannot work, which is the honest answer to "where did my box
 * go". That is the whole point of the strip on a floor where packing and
 * shipping are different people.
 *
 * Counts come from one blind endpoint (`GET /fulfilment/flow`) that any
 * fulfilment grant may read — see fulfilmentController.getFlow. They refresh
 * with the page's own refresh (`refreshKey`) and on a slow timer, and a count
 * that changes rolls to its new value rather than blinking.
 */

const REFRESH_MS = 60_000;

const STATIONS = [
  {
    key: 'pull', path: '/admin/pull-list', icon: Route, label: 'Pull list', perm: 'orders.pick',
    count: (f) => f.pull.units, unit: (n) => `unit${n === 1 ? '' : 's'} to pull`,
    hint: (f) => (f.pull.orders ? `across ${f.pull.orders} order${f.pull.orders === 1 ? '' : 's'}` : 'shelves are clear'),
  },
  {
    key: 'pack', path: '/admin/pack', icon: PackageCheck, label: 'Packing', perm: 'orders.pick',
    count: (f) => f.pack.waiting, unit: (n) => `order${n === 1 ? '' : 's'} to pack`,
    hint: (f) => (f.pack.mine ? `${f.pack.mine} yours` : f.pack.waiting ? 'none claimed by you' : 'bench is clear'),
  },
  {
    key: 'ship', path: '/admin/ship', icon: Send, label: 'Ship desk', perm: ['orders.update_status', 'orders.tracking'],
    count: (f) => f.ship.waiting, unit: (n) => `packed, waiting`,
    hint: (f) => (f.ship.needs_accept ? `${f.ship.needs_accept} need accepting` : f.ship.waiting ? 'all accepted' : 'desk is clear'),
  },
  {
    key: 'out', path: '/admin/manifest', icon: ClipboardList, label: 'Manifest', perm: ['orders.update_status', 'orders.tracking'],
    count: (f) => f.out.boxes_today, unit: (n) => `box${n === 1 ? '' : 'es'} out today`,
    hint: () => 'the sheet for the courier',
  },
];

/**
 * A number that rolls to its new value. Counts change under a working screen
 * — a box leaves the desk, an order lands on the bench — and a digit that
 * blinks from 8 to 7 reads as a glitch where one that steps down reads as the
 * thing that happened. Ten steps at most, so a jump from 0 to 40 on first
 * load is a short roll and not a flip-book.
 */
function RollingCount({ value }) {
  const [shown, setShown] = useState(value);
  const raf = useRef(null);
  useEffect(() => {
    if (value === shown) return undefined;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { setShown(value); return undefined; }
    const from = shown;
    const steps = Math.min(10, Math.abs(value - from));
    let i = 0;
    const tick = () => {
      i += 1;
      const next = Math.round(from + ((value - from) * i) / steps);
      setShown(next);
      if (i < steps) raf.current = setTimeout(tick, 45);
    };
    raf.current = setTimeout(tick, 45);
    return () => clearTimeout(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return <span className="fflow-n">{shown}</span>;
}

export default function FlowStrip({ current, refreshKey = 0 }) {
  const { user } = useAuth();
  const [flow, setFlow] = useState(null);
  const caps = adminCapabilities(user);

  useEffect(() => {
    let alive = true;
    const load = () => api.get('/fulfilment/flow').then((f) => { if (alive) setFlow(f); }).catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [refreshKey]);

  return (
    <nav className="fflow" aria-label="Fulfilment flow">
      {STATIONS.map((st, i) => {
        const open = caps.has(st.perm);
        const here = st.key === current;
        const n = flow ? st.count(flow) : null;
        const Icon = st.icon;
        const body = (
          <>
            <span className="fflow-icon" aria-hidden="true"><Icon size={15} /></span>
            <span className="fflow-text">
              <span className="fflow-label">{st.label}</span>
              <span className="fflow-count">
                {n == null ? <span className="fflow-n is-loading">–</span> : <RollingCount value={n} />}
                {' '}<span className="fflow-unit">{n == null ? '' : st.unit(n)}</span>
              </span>
              {flow && <span className="fflow-hint">{st.hint(flow)}</span>}
            </span>
          </>
        );
        const cls = `fflow-station${here ? ' is-here' : ''}${open ? '' : ' is-locked'}${n ? ' has-work' : ''}`;
        return (
          <span key={st.key} className="fflow-step" style={{ '--i': i }}>
            {i > 0 && (
              <span className="fflow-link" aria-hidden="true">
                <ArrowRight size={12} />
              </span>
            )}
            {open
              ? <Link to={st.path} className={cls} aria-current={here ? 'page' : undefined}>{body}</Link>
              : (
                <span
                  className={cls}
                  title="Another role works this station — your grants do not open it"
                  aria-current={here ? 'page' : undefined}
                >
                  {body}
                </span>
              )}
          </span>
        );
      })}
    </nav>
  );
}
