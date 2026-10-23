import ProgressBar from '../../components/ProgressBar';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../utils/api';
import {
  Package, ShoppingBag, Users, DollarSign, AlertTriangle, LayoutDashboard,
  TrendingUp, Clock3, Wallet, Truck,
} from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import { Sparkline, DonutChart, ActivityHeatmap, FlowBar, DeltaChip } from '../../components/admin/widgets';
import OpsNote from '../../components/admin/ai/OpsNote';

/**
 * The operator's morning glance. Three layers, most urgent first:
 *
 *   1. Money and volume with their 30-day shape (hero cards + sparklines)
 *   2. The pipeline and the mix (order-state flow, payment donut, heatmap)
 *   3. The work queue (recent orders, low stock)
 *
 * Everything past layer 3 lives on Analytics — this page answers "how is the
 * store doing and what needs me", not "why".
 *
 * The analytics fetches are DEFENSIVE on purpose: this route needs only
 * analytics.dashboard, while the richer widgets ride analytics.reports /
 * analytics.revenue. A manager without those grants gets a dashboard without
 * those widgets — never an error page, and never a row of $0.00 lies.
 */

const FLOW_META = [
  ['pending_payment', 'Pending pay', 'var(--warning)'],
  ['awaiting_confirmation', 'Confirming', 'var(--secondary)'],
  ['paid', 'Paid', 'var(--primary)'],
  ['accepted', 'Accepted', 'var(--accent)'],
  ['shipped', 'Shipped', 'var(--info, var(--secondary))'],
  ['delivered', 'Delivered', 'var(--success)'],
  ['disputed', 'Disputed', 'var(--danger)'],
];

const PAYMENT_COLORS = ['var(--primary)', 'var(--accent)', 'var(--success)', 'var(--warning)', 'var(--secondary)', 'var(--danger)'];

const money = (v) => `$${Number(v || 0).toFixed(2)}`;

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lowStock, setLowStock] = useState([]);
  // The window and cover target the reorder figures were computed with. Held
  // separately from the rows because it is one fact about the whole table, and
  // printing a suggested quantity without saying what it is enough FOR is a
  // number an operator has to trust rather than check.
  const [stockBasis, setStockBasis] = useState(null);
  // The permission-gated extras; null = not available to this viewer.
  const [summary, setSummary] = useState(null);
  const [revSeries, setRevSeries] = useState(null);
  const [funnel, setFunnel] = useState(null);
  const [payments, setPayments] = useState(null);
  const [heat, setHeat] = useState(null);

  useEffect(() => {
    api.get('/admin/dashboard')
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false));
    api.get('/admin/low-stock')
      .then((d) => { setLowStock(d.variants || []); setStockBasis({ cover: d.cover_days, window: d.window_days }); })
      .catch(() => {});
    // Each widget hides itself when its grant is missing — catch and move on.
    api.get('/analytics/summary').then(setSummary).catch(() => {});
    api.get('/analytics/revenue?days=30').then((d) => setRevSeries(d.data || null)).catch(() => {});
    api.get('/analytics/funnel').then((d) => setFunnel(d.funnel || null)).catch(() => {});
    api.get('/analytics/payment-methods').then((d) => setPayments(d.methods || null)).catch(() => {});
    api.get('/analytics/heatmap').then((d) => setHeat(d.cells || null)).catch(() => {});
  }, []);

  if (loading) return <div className="loading-page"><ProgressBar label="Loading dashboard…" /></div>;

  const revenueHidden = summary?.revenue_hidden || stats?.total_revenue === null;
  const revPoints = revSeries?.map((d) => d.revenue) || [];
  const orderPoints = revSeries?.map((d) => d.order_count) || [];
  const orders30d = summary?.orders_30d ?? null;

  /*
   * Every stage the endpoint reports, not only the seven this file names.
   *
   * `FLOW_META` is a hand-maintained list, and `/analytics/funnel` returns
   * more than it lists: `refunded` and `cancelled` at minimum, plus any status
   * it encounters that is not in its own list. Mapping over the constant alone
   * silently dropped those, so the pipeline bar under-reported the store — a
   * month with thirty cancellations drew a bar that accounted for none of
   * them, and the total the operator was reading was quietly not the total.
   *
   * Known stages keep their order and tone; the rest are appended in whatever
   * order they arrive, toned as terminal states rather than pipeline ones.
   */
  const flowStages = funnel
    ? [
      ...FLOW_META.map(([key, label, color]) => ({
        label,
        color,
        count: funnel.find((f) => f.status === key)?.count || 0,
      })),
      ...funnel
        .filter((f) => f.status && !FLOW_META.some(([key]) => key === f.status))
        .map((f) => ({
          label: f.status.replace(/_/g, ' '),
          color: f.status === 'refunded' ? 'var(--danger)' : 'var(--text-muted)',
          count: f.count || 0,
        })),
    ]
    : [];

  const paymentSegments = (payments || [])
    .slice(0, 6)
    .map((m, i) => ({
      label: m.method.replace(/_/g, ' '),
      value: m.count,
      display: m.count,
      color: PAYMENT_COLORS[i % PAYMENT_COLORS.length],
    }));

  const tiles = [
    { label: 'Total orders', value: stats?.total_orders || 0, icon: ShoppingBag, tone: 'var(--primary)', to: '/admin/orders' },
    { label: 'Pending orders', value: stats?.pending_orders || 0, icon: Clock3, tone: 'var(--warning)', to: '/admin/orders' },
    { label: 'Users', value: stats?.total_users || 0, icon: Users, tone: 'var(--secondary)', to: '/admin/users' },
    { label: 'Products', value: stats?.total_products || 0, icon: Package, tone: 'var(--accent)', to: '/admin/products' },
    { label: 'Open disputes', value: stats?.open_disputes || 0, icon: AlertTriangle, tone: 'var(--danger)', to: '/admin/disputes' },
    // Parcels the carrier flagged — a delivery exception or a return on an
    // order still in flight. Zero reads as calm rather than as an absent
    // tile, and the link lands on the Orders page already filtered to them.
    { label: 'Parcels flagged', value: stats?.parcels_attention || 0, icon: Truck, tone: stats?.parcels_attention ? 'var(--danger)' : 'var(--success)', to: '/admin/orders?parcel=attention' },
    { label: 'Low stock', value: lowStock.length, icon: TrendingUp, tone: lowStock.length ? 'var(--warning)' : 'var(--success)', to: '/admin/products' },
  ];

  const urgent = (stats?.open_disputes || 0) + lowStock.length + (stats?.parcels_attention || 0);

  return (
    <div className="admin-page">
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        subtitle={urgent > 0
          ? `${stats?.open_disputes || 0} open dispute${stats?.open_disputes === 1 ? '' : 's'} · ${lowStock.length} variant${lowStock.length === 1 ? '' : 's'} low or out of stock`
          : 'Nothing needs attention right now.'}
      />

      {/* The day in a paragraph, above the numbers it reads. One chip until
          it is asked for, so it costs a line on a page that is otherwise
          dense — and what it expands into is a shortcut to the queues, not a
          replacement for the charts below. */}
      <OpsNote />

      {/* ── Layer 1: the money and its shape ── */}
      {(summary || revSeries) && (
        <div className="dash-hero">
          {!revenueHidden && summary && (
            <div className="glass-card dash-hero-card">
              <div className="dash-hero-label"><DollarSign size={12} /> Revenue · 30 days</div>
              <div className="dash-hero-value">
                {money(summary.revenue_30d)}
                <DeltaChip pct={summary.revenue_30d_change_pct} />
              </div>
              {revPoints.length > 1 && <Sparkline points={revPoints} stroke="var(--success)" />}
            </div>
          )}
          {revSeries && (
            <div className="glass-card dash-hero-card">
              <div className="dash-hero-label"><ShoppingBag size={12} /> Orders · 30 days</div>
              <div className="dash-hero-value">{orders30d ?? orderPoints.reduce((s, n) => s + n, 0)}</div>
              {orderPoints.length > 1 && <Sparkline points={orderPoints} stroke="var(--primary)" />}
            </div>
          )}
          {!revenueHidden && summary && (
            <div className="glass-card dash-hero-card">
              <div className="dash-hero-label"><Wallet size={12} /> Average order</div>
              <div className="dash-hero-value">{money(summary.avg_order_value)}</div>
              <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
                {money(summary.total_revenue)} lifetime
                {summary.top_category ? ` · ${summary.top_category} leads the catalog` : ''}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Layer 1.5: the counters ── */}
      <div className="dash-tiles">
        {tiles.map((t) => (
          <Link key={t.label} to={t.to} className="dash-tile" style={{ '--dash-tone': t.tone, textDecoration: 'none', color: 'inherit' }}>
            <span className="dash-tile-icon"><t.icon size={17} /></span>
            <span>
              <span className="dash-tile-value">{t.value}</span>
              <span className="dash-tile-label" style={{ display: 'block' }}>{t.label}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* ── Layer 2: pipeline, mix, rhythm ── */}
      {(flowStages.some((s) => s.count > 0) || paymentSegments.length > 0) && (
        <div className="dash-band">
          {flowStages.some((s) => s.count > 0) && (
            <div className="glass-card">
              <h3 style={{ marginBottom: 'var(--sp-4)', fontSize: 'var(--fs-md)' }}>Order pipeline · 30 days</h3>
              <FlowBar stages={flowStages} />
            </div>
          )}
          {paymentSegments.length > 0 && (
            <div className="glass-card">
              <h3 style={{ marginBottom: 'var(--sp-4)', fontSize: 'var(--fs-md)' }}>Payment mix</h3>
              <DonutChart
                segments={paymentSegments}
                centerValue={paymentSegments.reduce((s, x) => s + x.value, 0)}
                centerLabel="orders"
              />
            </div>
          )}
        </div>
      )}

      {heat && heat.length > 0 && (
        <div className="glass-card" style={{ marginBottom: 'var(--sp-5)' }}>
          <h3 style={{ marginBottom: 'var(--sp-15)', fontSize: 'var(--fs-md)' }}>When buyers buy</h3>
          <p style={{ margin: '0 0 0.9rem', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            Orders by weekday and hour, last 90 days, server time. Schedule drops into the hot
            cells; schedule maintenance into the dark ones.
          </p>
          <ActivityHeatmap cells={heat} />
        </div>
      )}

      {/* ── Layer 3: the work queue ── */}
      <div className="glass-card" style={{ marginBottom: 'var(--sp-6)' }}>
        <h3 style={{ marginBottom: 'var(--sp-4)' }}>Recent Orders</h3>
        {stats?.recent_orders?.length > 0 ? (
          <div className="admin-table-scroll">
            <table className="glass-table admin-rtable" style={{ minWidth: 400 }}>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Payment</th>
                  <th>Total</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {stats.recent_orders.map((order) => (
                  <tr key={order.id}>
                    {/* DESIGN §9: if a field names another record, it is a link.
                        Every row here identified an order and then offered no way
                        to open it — the operator read the queue, then went to the
                        Orders page and searched for the reference they had just
                        been shown. */}
                    <td data-label="ID">
                      <Link to={`/admin/orders?search=${encodeURIComponent(order.uuid || order.id)}`} className="dash-order-link">
                        {order.uuid ? order.uuid.split('-')[0].toUpperCase() : `#${order.id}`}
                      </Link>
                    </td>
                    <td data-label="Status">
                      <span className={`badge badge-${order.status === 'delivered' ? 'success' : order.status === 'disputed' ? 'danger' : 'warning'}`}>
                        {order.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td data-label="Payment">{order.payment_method.replace(/_/g, ' ').toUpperCase()}</td>
                    <td data-label="Total">${Number(order.total).toFixed(2)}</td>
                    <td data-label="Date" style={{ color: 'var(--text-muted)' }}>{new Date(order.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          /* §9: an empty state is navigation, not an apology. */
          <div className="empty-state">
            <p>No orders yet.</p>
            <div className="empty-state-links">
              <Link to="/admin/products" className="glass-btn glass-btn-sm">Check the catalog</Link>
              <Link to="/admin/settings" className="glass-btn glass-btn-sm">Store settings</Link>
            </div>
          </div>
        )}
      </div>

      {lowStock.length > 0 && (
        <div className="glass-card">
          <h3 style={{ marginBottom: 'var(--sp-2)', color: 'var(--warning)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <AlertTriangle size={17} /> Low Stock ({lowStock.length} variant{lowStock.length !== 1 ? 's' : ''})
          </h3>
          {/* What the Order column means. Said once above the table rather than
              in a tooltip per cell: it is one fact about every row, and a
              suggested quantity with no stated basis is a number nobody can
              check. */}
          {stockBasis?.cover > 0 && (
            <p className="admin-hint lowstock-basis">
              Order quantities reach {stockBasis.cover} day{stockBasis.cover === 1 ? '' : 's'} of cover,
              at the rate each option sold over the last {stockBasis.window} day{stockBasis.window === 1 ? '' : 's'}.
            </p>
          )}
          <table className="admin-rtable ail-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Variant</th>
                <th>Stock</th>
                <th>Cover</th>
                <th>Order</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((v) => (
                <tr key={v.id}>
                  <td data-label="Product">{v.group_name}</td>
                  <td data-label="Variant" className="ail-dim">{v.variant_name}</td>
                  <td data-label="Stock" style={{ fontWeight: 700, color: v.quantity === 0 ? 'var(--danger)' : 'var(--warning)' }}>
                    {v.quantity === 0 ? 'OUT OF STOCK' : v.quantity}
                  </td>
                  {/*
                    * How long the shelf lasts at the rate this option sells.
                    *
                    * The guard order matches `stockAlerts.coverPhrase`, which is
                    * the shop's own wording for the same ladder, and the FIRST
                    * of its branches is the one this cell originally forgot:
                    * an out-of-stock variant has `days_of_cover: 0`, and
                    * `Math.max(1, 0)` rendered that as "1h" — a cell claiming
                    * an hour of cover on a shelf with nothing on it, beside a
                    * Stock column already saying OUT OF STOCK.
                    *
                    * Nothing on the shelf means nothing to say here: the row
                    * next door says it, and repeating it in two columns is
                    * noise. Null means the variant has not sold enough for a
                    * rate to mean anything, which is a different absence and
                    * gets different words.
                    */}
                  <td data-label="Cover" className="lowstock-cover">
                    {v.quantity <= 0
                      ? <span className="ail-dim">—</span>
                      : v.days_of_cover == null
                        ? <span className="ail-dim">no sales history</span>
                        : v.days_of_cover < 1
                          ? `${Math.max(1, Math.round(v.days_of_cover * 24))}h`
                          : `${v.days_of_cover < 10 ? v.days_of_cover.toFixed(1) : Math.round(v.days_of_cover)}d`}
                  </td>
                  {/*
                    * Three different answers, three different renderings.
                    *
                    * A number is what to order. Zero means the shelf already
                    * covers the target — which happens on a row that is here
                    * because of the flat floor rather than the rate, and
                    * printing "0" as though it were a quantity to order would
                    * be the most confusing cell on the page. Null means the
                    * variant has not sold enough for the rate to mean
                    * anything, and `stockAlerts.reorderUnits` returns null
                    * rather than a confident small number for exactly that
                    * reason.
                    */}
                  <td data-label="Order" className="lowstock-order">
                    {v.reorder_units == null
                      ? <span className="ail-dim">—</span>
                      : v.reorder_units === 0
                        ? <span className="ail-dim">covered</span>
                        : <strong>{v.reorder_units}</strong>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
