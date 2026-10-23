import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ClipboardList, Printer, RefreshCw, Truck, Package, Scale, Inbox, Boxes,
} from 'lucide-react';
import { ParcelLine } from '../../components/order/ParcelStatus';
import { api } from '../../utils/api';
import PageHeader from '../../components/admin/PageHeader';
import FlowStrip from '../../components/fulfilment/FlowStrip';
import StatTiles from '../../components/admin/StatTiles';
// One author for the tag and the reference under it — see utils/boxTag.js.
// This file used to carry a third spelling of `shortRef`.
import { boxTag, refOf as shortRef } from '../../utils/boxTag';

/**
 * The dispatch manifest: what left the building, grouped by carrier.
 *
 * ── Why this is a read and nothing else ─────────────────────────────────────
 *
 * Boxes have carried `shipped_at` and `shipped_by` since they existed, and
 * tracking rows have always known their carrier. Nothing new is stored here —
 * this is the query nobody had written, and the sheet somebody carries to the
 * post office with the sack.
 *
 * ── What it deliberately does not print ─────────────────────────────────────
 *
 * No buyer, no address, no total. A manifest that carried addresses would be
 * the single most damaging sheet of paper in the building, it would leave with
 * the courier, and the courier does not need one to take the sack. Orders are
 * named by the same short reference the bench and the desk use.
 *
 * Carriers with nothing recorded are still listed, under an honest label
 * rather than dropped: an untracked parcel physically leaves, and a manifest
 * that quietly omitted it would be short every time somebody used the
 * no-tracking flag.
 */

const grams = (g) => {
  if (!g) return '—';
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g} g`;
};


const WINDOWS = [
  { days: 1, label: 'Today' },
  { days: 3, label: '3 days' },
  { days: 7, label: 'A week' },
  { days: 31, label: 'A month' },
];

export default function Manifest() {
  const [days, setDays] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (window) => {
    setLoading(true);
    try {
      setData(await api.get(`/fulfilment/ship/manifest?days=${window}`));
    } catch (err) {
      toast.error(err.message || 'Could not build the manifest');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(days); }, [load, days]);

  const totals = data?.totals;
  const stats = totals ? [
    { key: 'boxes', label: 'Parcels out', value: totals.boxes, icon: Package, tone: 'var(--primary)' },
    { key: 'orders', label: 'Orders', value: totals.orders, icon: Boxes, tone: 'var(--secondary)' },
    { key: 'carriers', label: 'Carriers', value: totals.carriers, icon: Truck, tone: 'var(--accent)' },
    {
      key: 'weight', label: 'Total weight', value: grams(totals.weight_grams), icon: Scale,
      tone: 'var(--text-muted)',
      hint: totals.weight_grams ? undefined : 'No weights recorded',
    },
  ] : [];

  // Cartons used across every carrier — what to reorder before running out.
  const cartons = useMemo(() => {
    const all = new Map();
    for (const c of data?.carriers || []) {
      for (const [name, n] of Object.entries(c.cartons || {})) {
        all.set(name, (all.get(name) || 0) + n);
      }
    }
    return [...all.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <div className="admin-page mf-page">
      <PageHeader
        icon={ClipboardList}
        title="Dispatch manifest"
        subtitle={loading ? 'Building the sheet…'
          : `${totals?.boxes || 0} parcel${totals?.boxes === 1 ? '' : 's'} across ${totals?.carriers || 0} carrier${totals?.carriers === 1 ? '' : 's'}`}
      >
        <Link to="/admin/ship" className="glass-btn glass-btn-sm">
          <Truck size={14} aria-hidden="true" /> Ship desk
        </Link>
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => window.print()}>
          <Printer size={14} aria-hidden="true" /> Print
        </button>
        <button type="button" className="glass-btn glass-btn-sm" onClick={() => load(days)} disabled={loading}>
          <RefreshCw size={14} aria-hidden="true" className={loading ? 'spin' : ''} /> Refresh
        </button>
      </PageHeader>

      <FlowStrip current="out" />

      {/* The printed sheet carries its own context — whoever holds the paper
          is not looking at the window control. */}
      <div className="mf-print-head" aria-hidden="true">
        Dispatch manifest · {WINDOWS.find((w) => w.days === days)?.label} · printed{' '}
        {new Date().toLocaleString()} · {totals?.boxes || 0} parcels
      </div>

      {stats.length > 0 && <StatTiles stats={stats} />}

      <div className="segmented mf-window" role="group" aria-label="Time window">
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            type="button"
            className={`segmented-option${days === w.days ? ' active' : ''}`}
            onClick={() => setDays(w.days)}
            aria-pressed={days === w.days}
          >
            {w.label}
          </button>
        ))}
      </div>

      {cartons.length > 0 && (
        <p className="mf-cartons">
          <Boxes size={13} aria-hidden="true" />
          <span>Packaging used:</span>
          {cartons.map(([name, n]) => (
            <span key={name} className="mf-carton-chip">{name} <em>×{n}</em></span>
          ))}
        </p>
      )}

      {!loading && (data?.carriers || []).length === 0 && (
        <div className="glass-card pull-empty">
          <Inbox size={22} aria-hidden="true" />
          <p>Nothing has shipped in this window.</p>
        </div>
      )}

      {(data?.carriers || []).map((c) => (
        <section key={c.carrier} className="glass-card mf-carrier">
          <header className="mf-carrier-head">
            <h3><Truck size={15} aria-hidden="true" /> {c.carrier}</h3>
            <span className="mf-carrier-meta">
              {c.boxes.length} parcel{c.boxes.length === 1 ? '' : 's'}
              {c.weight_grams > 0 && <> · {grams(c.weight_grams)}</>}
            </span>
          </header>
          <div className="mf-table-wrap">
            <table className="mf-table">
              <thead>
                <tr>
                  <th scope="col">Tag</th>
                  <th scope="col">Box</th>
                  <th scope="col">Tracking</th>
                  <th scope="col">Carrier says</th>
                  <th scope="col">Carton</th>
                  <th scope="col" className="mf-num">Weight</th>
                  <th scope="col">Shipped</th>
                  <th scope="col" className="mf-tick" aria-label="Hand tick" />
                </tr>
              </thead>
              <tbody>
                {c.boxes.map((b) => (
                  <tr key={b.box_id}>
                    {/* The tag, not the order reference.
                        Every row here is ONE CARTON, and the carton in the
                        sack is marked `3F2A9C1E-2` — the bench printed it and
                        the desk scans it. Printing `3F2A9C1E` three times left
                        somebody reconciling a manifest against three
                        identically-labelled lines and matching by hand, which
                        is the same mismatch utils/boxTags.js was written to
                        end. An order old enough to have no uuid still falls
                        back to `#id` and has no tag to print. */}
                    <td>
                      <code>{b.order_uuid
                        ? boxTag(b.order_uuid, b.box_number)
                        : shortRef(b.order_uuid, b.order_id)}</code>
                    </td>
                    <td>#{b.box_number}</td>
                    <td className="mf-track">
                      {b.tracking_number || (b.untracked
                        ? <span className="mf-untracked">no tracking</span>
                        : <span className="mf-none">—</span>)}
                    </td>
                    <td className="mf-parcel">
                      {b.parcel?.tracked
                        ? <ParcelLine tracking={b.parcel} />
                        : <span className="mf-none">—</span>}
                    </td>
                    <td>{b.preset_name || <span className="mf-none">—</span>}</td>
                    <td className="mf-num">{grams(b.weight_grams)}</td>
                    <td className="mf-when">
                      {new Date(b.shipped_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {b.shipped_by_username && <em> {b.shipped_by_username}</em>}
                    </td>
                    {/* Print-only: somewhere for the courier to sign each line. */}
                    <td className="mf-tick"><span className="mf-tick-box" aria-hidden="true" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
