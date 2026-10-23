import ProgressBar from '../../components/ProgressBar';
import { useState, useEffect, useCallback } from 'react';
import { api } from '../../utils/api';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  BarChart2, DollarSign, ShoppingBag, Users, TrendingUp,
  TrendingDown, Award, GitMerge, CreditCard, CalendarClock, Truck,
  Layers, Repeat, Compass, Bot, Link2, UserPlus,
} from 'lucide-react';
import PageHeader from '../../components/admin/PageHeader';
import DemandBand from '../../components/admin/DemandBand';
import StatTiles from '../../components/admin/StatTiles';
import { ActivityHeatmap, BarSeries, DonutChart, FlowBar, RankedBars } from '../../components/admin/widgets';
import AnalyticsNote from '../../components/admin/ai/AnalyticsNote';

const FUNNEL_ORDER = [
  'pending_payment',
  'awaiting_confirmation',
  'paid',
  'accepted',
  'shipped',
  'delivered',
];

const PAYMENT_COLORS = [
  'var(--primary)',
  'var(--accent)',
  'var(--warning)',
  'var(--success)',
  '#a78bfa',
  '#f472b6',
];


export default function Analytics() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [summaryStats, setSummaryStats] = useState(null);
  const [revenueData, setRevenueData] = useState(null);
  const [bestSellers, setBestSellers] = useState([]);
  // How many of the ranked rows the margin column could actually price.
  // Null until the request lands, and null for a viewer without
  // analytics.revenue — margin is money and is withheld with the rest.
  const [sellersPriced, setSellersPriced] = useState(null);
  // Best sellers carry their own redaction flag, separate from the summary's:
  // the two endpoints are permission-checked independently and either could be
  // withheld on its own.
  const [sellersRevenueHidden, setSellersRevenueHidden] = useState(false);
  const [funnel, setFunnel] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [userGrowth, setUserGrowth] = useState(null);
  const [heat, setHeat] = useState(null);
  const [timing, setTiming] = useState(null);
  const [revDays, setRevDays] = useState(30);
  const [revLoading, setRevLoading] = useState(false);
  // The "who buys, and what" band: three endpoints drawn over one window,
  // which is its own — 90 days by default, because sign-up routes and repeat
  // rates need more history than a revenue chart does to say anything.
  const [insightDays, setInsightDays] = useState(90);
  // `demand` rides the same payload: /analytics/insights returns all four
  // reports so the page's two lower bands cost the data_export limiter one
  // request between them rather than two. They share the window for the same
  // reason, which is also the right answer — "what sold" and "what people
  // asked for and did not buy" are read against each other.
  const [insights, setInsights] = useState({ acq: null, mix: null, buyers: null, demand: null });
  const [insightsLoading, setInsightsLoading] = useState(true);
  // Said out loud rather than drawn as zeros. Every analytics call shares
  // the data_export limiter, and a 429 that arrived as an empty band read
  // exactly like a store with no buyers.
  const [insightsError, setInsightsError] = useState(null);

  // Lifted out of the effect so the demand band can ask for the payload again
  // after flipping view counting — the switch changes what the "Most opened"
  // card is entitled to claim, and leaving the old payload on screen would
  // have the notice and the numbers disagreeing until the next navigation.
  const loadInsights = useCallback(async () => {
    setInsightsLoading(true);
    try {
      // One request, not four: the two lower bands' reports ride one call so a
      // page load costs the limiter nine requests rather than twelve.
      const data = await api.get(`/analytics/insights?days=${insightDays}`);
      setInsights({
        acq: data.acquisition || null,
        mix: data.catalog_mix || null,
        buyers: data.buyers || null,
        demand: data.demand || null,
      });
      setInsightsError(null);
    } catch (err) {
      setInsights({ acq: null, mix: null, buyers: null, demand: null });
      setInsightsError(err.status === 429
        ? 'Too many report requests in a short time — the reports limiter is holding this back. Try again in a few minutes.'
        : (err.message || 'Could not load these reports'));
    } finally {
      setInsightsLoading(false);
    }
  }, [insightDays]);

  useEffect(() => { loadInsights(); }, [loadInsights]);

  const fetchRevenue = async (days) => {
    setRevLoading(true);
    try {
      const data = await api.get(`/analytics/revenue?days=${days}`);
      setRevenueData(data);
    } catch (err) {
      toast.error(err.message || 'Failed to load revenue data');
    }
    setRevLoading(false);
  };

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [summary, revenue, sellers, funnelData, payments, growth, heatmap, timingData] = await Promise.allSettled([
          api.get('/analytics/summary'),
          api.get('/analytics/revenue?days=30'),
          api.get('/analytics/best-sellers?limit=10'),
          api.get('/analytics/funnel'),
          api.get('/analytics/payment-methods'),
          api.get('/analytics/user-growth'),
          api.get('/analytics/heatmap'),
          api.get('/analytics/fulfilment'),
        ]);
        if (timingData.status === 'fulfilled') setTiming(timingData.value);
        if (summary.status === 'fulfilled') setSummaryStats(summary.value);
        if (revenue.status === 'fulfilled') setRevenueData(revenue.value);
        if (sellers.status === 'fulfilled') {
          // `{ products, revenue_hidden }` — unwrapping to `products` and
          // throwing the envelope away lost the flag, and the rows underneath
          // it carry `revenue: null` for a viewer without analytics.revenue.
          // The table then printed $0.00 on every row, which is the "we sold
          // nothing" claim the comment below refuses to make.
          const payload = sellers.value;
          setBestSellers(payload?.products || (Array.isArray(payload) ? payload : []));
          setSellersRevenueHidden(payload?.revenue_hidden === true);
          setSellersPriced(payload?.priced_products ?? null);
        }
        if (funnelData.status === 'fulfilled') setFunnel(funnelData.value?.funnel || funnelData.value || []);
        if (payments.status === 'fulfilled') setPaymentMethods(payments.value?.methods || payments.value || []);
        if (growth.status === 'fulfilled') setUserGrowth(growth.value);
        if (heatmap.status === 'fulfilled') setHeat(heatmap.value?.cells || null);
      } catch (_) {
        // individual errors already handled
      }
      setLoading(false);
    };
    fetchAll();
  }, []);

  const handleDayChange = async (days) => {
    setRevDays(days);
    await fetchRevenue(days);
  };

  if (loading) {
    return (
      <div className="loading-page">
        <ProgressBar label="Loading analytics…" />
      </div>
    );
  }

  // ---- Summary stat helpers ----
  // These names have to match analyticsController.getSummaryStats exactly. Two
  // did not: `revenue_change_pct` and `new_users_30d` are sent as
  // `revenue_30d_change_pct` and `users_30d`. The first left revChange
  // permanently null, which hid the "vs prev period" line AND pinned the card's
  // icon to TrendingUp — a green rise drawn straight through a collapse. The
  // second made New Users (30d) read 0 on every load.
  //
  // Money can also be withheld rather than zero: a viewer without the revenue
  // capability gets nulls, or an explicit revenue_hidden flag. Those cards print
  // an em dash, because $0.00 asserts we sold nothing — a different and much
  // worse claim than "you cannot see this". `?? 0` is kept only for the counts,
  // which are never redacted.
  const revenueHidden = summaryStats?.revenue_hidden === true;
  const moneyOrDash = (v) => (revenueHidden || v == null ? '—' : `$${Number(v).toFixed(2)}`);

  const totalRevenue = summaryStats?.total_revenue;
  const revenue30d = summaryStats?.revenue_30d;
  const revChange = revenueHidden ? null : summaryStats?.revenue_30d_change_pct ?? null;
  const totalOrders = summaryStats?.total_orders ?? 0;
  const avgOrderValue = summaryStats?.avg_order_value;
  const totalUsers = summaryStats?.total_users ?? 0;
  const newUsers30d = summaryStats?.users_30d ?? 0;

  // ---- New-user trend ----
  // This card read `userGrowth.growth_pct`. `/analytics/user-growth` returns
  // `{ data: [{ week, new_users }] }` and nothing else — no controller anywhere
  // computes a `growth_pct` — so the sub-label was always undefined and the
  // colour rule beneath it could not fire on any payload the server can send.
  // The trend is derived here instead, from the last two weekly buckets the
  // endpoint actually returns.
  const growthWeeks = Array.isArray(userGrowth?.data) ? userGrowth.data : [];
  const userGrowthPct = (() => {
    if (growthWeeks.length < 2) return null;
    const latest = growthWeeks[growthWeeks.length - 1]?.new_users ?? 0;
    const prev = growthWeeks[growthWeeks.length - 2]?.new_users ?? 0;
    // A previous week of zero makes the percentage meaningless — one signup
    // reads as an infinite rise — so say nothing rather than print Infinity.
    if (!prev) return null;
    return ((latest - prev) / prev) * 100;
  })();

  // ---- Revenue bar chart ----
  const revRows = revenueData?.data ?? [];
  const maxRev = Math.max(...revRows.map((d) => d.revenue ?? 0), 1);

  const dateRangeLabel = (() => {
    if (!revRows.length) return '';
    const first = revRows[0]?.day;
    const last = revRows[revRows.length - 1]?.day;
    if (!first || !last) return '';
    return `${first} – ${last}`;
  })();

  // ---- Funnel ----
  const funnelMap = {};
  (Array.isArray(funnel) ? funnel : []).forEach((f) => {
    funnelMap[f.status ?? f.stage] = f.count ?? 0;
  });

  /*
   * Every stage the endpoint actually reports, in pipeline order, then
   * anything it reported that FUNNEL_ORDER does not list.
   *
   * That tail matters and is not hypothetical: `/analytics/funnel` also
   * returns `refunded` and `cancelled`, and appends any status it finds that
   * is not in its own list — so a constant maintained by hand on this side
   * will always eventually be short. The old code did handle them, but in a
   * second loop that painted them a different colour purely because of which
   * array they had fallen into. Here the terminal states are toned
   * deliberately: money that came back is danger, an order that never
   * happened is muted, and the live pipeline keeps the brand ramp.
   */
  const TERMINAL_TONE = { refunded: 'var(--danger)', cancelled: 'var(--text-muted)' };
  const funnelStages = [
    ...FUNNEL_ORDER.map((status, i) => ({
      status,
      // A ramp down the pipeline, so the eye reads the bar left-to-right as a
      // sequence rather than as unrelated bands.
      color: `color-mix(in srgb, var(--primary) ${100 - i * 11}%, var(--secondary))`,
    })),
    ...(Array.isArray(funnel) ? funnel : [])
      .map((f) => f.status ?? f.stage)
      .filter((status) => status && !FUNNEL_ORDER.includes(status))
      .map((status) => ({ status, color: TERMINAL_TONE[status] ?? 'var(--text-muted)' })),
  ].map(({ status, color }) => ({
    label: status.replace(/_/g, ' '),
    count: funnelMap[status] ?? 0,
    color,
  }));

  // ---- Best sellers max revenue for progress bar ----
  // Only meaningful when revenue is visible. With every row nulled the max
  // collapses to the `1` floor and every bar renders at the 2% minimum, which
  // looks like a real — and uniformly terrible — distribution rather than a
  // withheld one, so the column is dropped entirely instead.
  const maxSellerRevenue = sellersRevenueHidden
    ? null
    : Math.max(...bestSellers.map((b) => parseFloat(b.revenue ?? 0) || 0), 1);

  // ---- Payment methods ----
  // No `|| 1` floor. That floor existed to keep a percentage divisor safe,
  // and the donut now derives its own proportions — but this number is
  // PRINTED in the centre of it, and a store with no payments yet would
  // have shown a confident "1 order".
  const totalPaidOrders = paymentMethods.reduce((sum, m) => sum + (m.count ?? 0), 0);

  return (
    <div className="admin-page">
      <PageHeader
        icon={BarChart2}
        title="Analytics"
        subtitle={`${moneyOrDash(totalRevenue)} lifetime revenue${bestSellers.length ? ` · ${bestSellers.length} product${bestSellers.length === 1 ? '' : 's'} ranked` : ''}`}
      >
        {/* In the header, beside the title, and not down among the tables it
            describes. It costs one chip until somebody presses it — the same
            shape `OpsNote` takes on the dashboard — and it reads the window the
            insight bands below are using, so a paragraph about "the last 30
            days" is a paragraph about the 30 days on screen.

            The tool renders nothing at all when this shop has the `ops`
            capability switched off, so a store that does not narrate itself
            sees the page exactly as it was. */}
        <AnalyticsNote days={insightDays} />
      </PageHeader>

      {/*
        ── 1. The headline figures ──

        One strip, not six equal cards. Two things were wrong with what stood
        here. The first was visible: `StatCard` built its icon plate with
        `background: ${color}20` and `boxShadow: 0 0 16px ${color}30`, string
        concatenation against a value that was always a token — so the browser
        received `background: var(--success)20`, which is not a colour, and the
        plate and its glow simply never painted on any of the six.

        The second is DESIGN §1's row-of-three, at twice the width: six panels
        at identical weight, radius, padding and elevation, which is a layout
        admitting it never asked which figure anyone opened the page for.
        Revenue is the lead and the rest are context for it, which is exactly
        the shape `StatTiles` already exists to draw — generalised out of the
        Orders queue for this reason, and half the height per counter.
      */}
      <StatTiles stats={[
        {
          key: 'rev30',
          label: 'Revenue · 30d',
          value: moneyOrDash(revenue30d),
          tone: 'var(--success)',
          icon: revChange == null ? DollarSign : revChange < 0 ? TrendingDown : TrendingUp,
          // No comparison, no arrow. There is nothing to compare against in the
          // store's first 60 days, and a rising arrow drawn on that absence is a
          // claim the data does not support.
          hint: revChange == null
            ? undefined
            : `${revChange >= 0 ? '+' : ''}${Number(revChange).toFixed(1)}% vs prev period`,
          lead: true,
        },
        {
          key: 'revtotal',
          label: 'Revenue · lifetime',
          value: moneyOrDash(totalRevenue),
          tone: 'var(--success)',
          icon: DollarSign,
        },
        {
          key: 'orders',
          label: 'Orders',
          value: totalOrders.toLocaleString(),
          tone: 'var(--primary)',
          icon: ShoppingBag,
        },
        {
          key: 'aov',
          label: 'Avg order',
          value: moneyOrDash(avgOrderValue),
          tone: 'var(--accent)',
          icon: CreditCard,
        },
        {
          key: 'users',
          label: 'Users',
          value: totalUsers.toLocaleString(),
          tone: 'var(--primary)',
          icon: Users,
        },
        {
          key: 'newusers',
          label: 'New users · 30d',
          value: newUsers30d.toLocaleString(),
          tone: 'var(--warning)',
          icon: TrendingUp,
          // Same trap as the revenue figure: a fixed green would paint a
          // shrinking sign-up rate as good news.
          hint: userGrowthPct == null
            ? undefined
            : `${userGrowthPct >= 0 ? '+' : ''}${userGrowthPct.toFixed(1)}% vs previous week`,
        },
      ]}
      />

      {/* ── 2. Revenue bar chart ── */}
      <div className="glass-card" style={{ marginBottom: 'var(--sp-6)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--sp-3)', marginBottom: 'var(--sp-4)' }}>
          <div>
            <div style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>Revenue (Last {revDays} Days)</div>
            {dateRangeLabel && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', marginTop: 2 }}>{dateRangeLabel}</div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 'var(--sp-15)' }}>
            {[7, 30, 90].map((d) => (
              <button
                key={d}
                className={`glass-btn glass-btn-sm${revDays === d ? ' glass-btn-primary' : ''}`}
                onClick={() => handleDayChange(d)}
                disabled={revLoading}
                style={{ minWidth: 42 }}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {revLoading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 130 }}>
            <div className="spinner" style={{ width: 28, height: 28 }} />
          </div>
        ) : revRows.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0', fontSize: 'var(--fs-base)' }}>
            No revenue data available.
          </div>
        ) : (
          /*
            Proportional bars rather than a flex row with a fixed 2px gap. At
            90 days on a phone the old version gave each bar about 1.8px with
            2px of air beside it — the gaps were wider than the data. See
            BarSeries in components/admin/widgets.jsx.
          */
          <BarSeries
            rows={revRows}
            valueOf={(d) => Number(d.revenue ?? 0)}
            labelOf={(d) => d.day}
            format={(v) => moneyOrDash(v)}
            height={120}
          />
        )}

        {revRows.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-secondary)' }}>{revRows[0]?.day}</span>
            <span style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-secondary)' }}>{revRows[revRows.length - 1]?.day}</span>
          </div>
        )}
      </div>

      {/* ── 3. Best Sellers ── */}
      <div className="glass-card" style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--sp-6)' }}>
        <div style={{ padding: 'var(--sp-4) var(--sp-4) var(--sp-3)', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', borderBottom: '1px solid var(--border)' }}>
          <Award size={16} style={{ color: 'var(--warning)' }} />
          <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>Best Sellers (Top 10)</span>
          {/* What the margin column covers, stated rather than implied.
              A shop that records a unit cost on some deliveries and not
              others gets a margin over a subset, and a subset shown without
              its denominator is the point at which somebody adds the column
              up and calls it the month's profit. */}
          {!sellersRevenueHidden && sellersPriced != null && bestSellers.length > 0 && (
            <span className="admin-hint" style={{ marginLeft: 'auto', fontSize: 'var(--fs-xs)' }}>
              {sellersPriced === bestSellers.length
                ? 'Margin on every row'
                : `Margin on ${sellersPriced} of ${bestSellers.length} — the rest have no priced goods-in`}
            </span>
          )}
        </div>
        {bestSellers.length === 0 ? (
          <div style={{ padding: 'var(--sp-8)', textAlign: 'center', color: 'var(--text-secondary)', fontSize: 'var(--fs-base)' }}>
            No sales data yet.
          </div>
        ) : (
          <div className="admin-rtable-wrap" style={{ overflowX: 'auto' }}>
            <table className="admin-rtable rtable-skin" style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Product / Variant</th>
                  <th>Units Sold</th>
                  <th>Revenue</th>
                  {!sellersRevenueHidden && <th>Margin</th>}
                  {!sellersRevenueHidden && (
                    <th style={{ width: '30%' }}>Relative Revenue</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {bestSellers.map((b, i) => {
                  // `b.revenue` is null, not 0, when analytics.revenue is
                  // withheld — the coalesce that used to sit here turned that
                  // into $0.00 on every row.
                  const rev = sellersRevenueHidden || b.revenue == null
                    ? null
                    : parseFloat(b.revenue) || 0;
                  const pct = rev == null ? null : Math.max(2, (rev / maxSellerRevenue) * 100);
                  return (
                    <tr key={b.variant_id ?? i}>
                      <td data-label="Rank" style={{ fontWeight: 700, color: i < 3 ? 'var(--warning)' : 'var(--text-secondary)' }}>
                        {i + 1}
                      </td>
                      <td data-label="Product">
                        <div style={{ fontWeight: 600, fontSize: 'var(--fs-base)' }}>{b.group_name ?? b.product ?? '—'}</div>
                        {b.variant_name && (
                          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', marginTop: 1 }}>{b.variant_name}</div>
                        )}
                      </td>
                      {/* getBestSellers selects `SUM(oi.quantity) AS total_quantity`
                          and sends it under that name. `units_sold`/`quantity`
                          match nothing in the payload, so this column read 0 for
                          every product no matter how many had shipped. */}
                      <td data-label="Units" style={{ fontWeight: 600 }}>
                        {Number(b.total_quantity ?? 0).toLocaleString()}
                      </td>
                      <td
                        data-label="Revenue"
                        style={{ fontWeight: 600, color: rev == null ? 'var(--text-muted)' : 'var(--success)' }}
                        title={rev == null ? 'Hidden — you do not have permission to see revenue' : undefined}
                      >
                        {rev == null ? '—' : `$${rev.toFixed(2)}`}
                      </td>
                      {/* Margin, and the three states it genuinely has.
                          A number when the option has a priced receipt; an
                          em dash when it does not, because an unpriced
                          delivery makes the cost UNKNOWN and a zero there
                          would read as a perfect margin; and a warning tone
                          when it is negative, which is a real thing a shop
                          does on purpose and should still be able to see. */}
                      {!sellersRevenueHidden && (
                        <td
                          data-label="Margin"
                          style={{
                            fontWeight: 600,
                            // The server's flag, not `margin < 0` recomputed
                            // here. They agree today and would stop agreeing
                            // the moment "below cost" means anything subtler
                            // than a negative — `utils/margin.js` owns that
                            // comparison, including the at-cost boundary.
                            color: b.margin == null
                              ? 'var(--text-muted)'
                              : (b.below_cost ? 'var(--warning)' : 'var(--text-primary)'),
                          }}
                          title={b.margin == null
                            ? 'No priced goods-in receipt for this option, so its cost is unknown'
                            : `Cost $${Number(b.cost).toFixed(2)} at $${Number(b.unit_cost).toFixed(2)} a unit`}
                        >
                          {b.margin == null ? '—' : `$${Number(b.margin).toFixed(2)}`}
                          {b.margin_pct != null && (
                            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', fontWeight: 500, marginTop: 1 }}>
                              {b.margin_pct}%
                            </div>
                          )}
                        </td>
                      )}
                      {!sellersRevenueHidden && (
                        <td data-label="Share">
                          <div style={{ height: 8, borderRadius: 4, background: 'rgba(var(--tint-rgb), 0.08)', overflow: 'hidden' }}>
                            {pct != null && (
                              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--primary)', borderRadius: 4, opacity: 0.85 }} />
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 3b. Who buys, and what ──

          Three questions the page could not answer before: where buyers come
          from (the door, not a tracker — see analyticsController.getAcquisition
          for what this store does and does not record), what KIND of thing
          sells (one level above the variant list), and whether people come
          back. Drawn over their own window, because a sign-up route or a
          repeat rate over seven days is noise. */}
      <BuyerInsights
        days={insightDays}
        onDays={setInsightDays}
        loading={insightsLoading}
        error={insightsError}
        acq={insights.acq}
        mix={insights.mix}
        buyers={insights.buyers}
        money={moneyOrDash}
      />

      {/* ── 3c. What people want ──

          The other side of the best-seller table: everything above this point
          is drawn from orders, so a product nobody can buy — out of stock,
          priced past what people will pay, or never found at all — is
          invisible on every one of them. This band is the four standing ways a
          buyer says "I want this" without paying, plus what gets opened and
          what leaves fastest. components/admin/DemandBand.jsx. */}
      <DemandBand
        days={insightDays}
        onDays={setInsightDays}
        loading={insightsLoading}
        error={insightsError}
        data={insights.demand}
        user={user}
        onRefresh={loadInsights}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))', gap: 'var(--sp-5)', marginBottom: 'var(--sp-6)' }}>
        {/*
          ── 4. Order Funnel ──

          One stacked pipeline bar, not nine stacked progress rows.

          What stood here was a label+count+bar block per status at roughly
          46px each, written out twice — once over `FUNNEL_ORDER` and again
          over whatever the endpoint returned that the constant did not list.
          Nine statuses came to over 400px of card to say how a few hundred
          orders are distributed, and the second loop meant the two halves of
          one distribution were drawn in different colours by accident of
          which array they landed in.

          `FlowBar` in components/admin/widgets.jsx already draws exactly this
          and was going unused: a single proportional bar with a legend that
          carries the counts, which is the DESIGN §7 trade — the same
          information at a fifth of the height, and every stage still named
          and numbered rather than left to a hover.
        */}
        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}>
            <GitMerge size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>Order Funnel</span>
          </div>
          {funnel.length === 0 ? (
            <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)', paddingTop: 'var(--sp-2)' }}>
              No funnel data yet.
            </div>
          ) : (
            <FlowBar stages={funnelStages} />
          )}
        </div>

        {/*
          ── 5. Payment Methods ──

          A donut with one legend, replacing bar rows plus a SECOND legend
          underneath that repeated every method name the rows had just
          printed. DESIGN §7: every element has to be something the person is
          there to read, and a legend restating the row above it is not.

          The donut is the right form here where the funnel's stacked bar was
          right there: this is a parts-of-a-whole with a handful of parts and
          no sequence, and `DonutChart` already carries the total in the
          centre and the exact counts in its legend — which is what makes the
          angles safe to use, since a slice under about 8% is unreadable as an
          angle and perfectly readable as a row.
        */}
        <div className="glass-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}>
            <CreditCard size={16} style={{ color: 'var(--accent)' }} />
            <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>Payment Methods</span>
          </div>
          {paymentMethods.length === 0 ? (
            <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)' }}>No payment data yet.</div>
          ) : (
            <DonutChart
              segments={paymentMethods.map((m, idx) => ({
                label: (m.method ?? m.name ?? 'Unknown').replace(/_/g, ' '),
                value: m.count ?? 0,
                color: PAYMENT_COLORS[idx % PAYMENT_COLORS.length],
              }))}
              centerLabel="orders"
              centerValue={totalPaidOrders.toLocaleString()}
            />
          )}
        </div>
      </div>

      {/*
        ── 6. Signups by week ──

        The series was already on the wire and being thrown away.
        `/analytics/user-growth` returns a full weekly `{ week, new_users }`
        series, and the page reduced the whole thing to one percentage between
        the last two buckets for a stat-tile hint — the shape, which is the
        part that tells you whether growth is steady or was one good week, was
        fetched and discarded on every load.

        Bars rather than a sparkline because these are counts in discrete
        buckets, not a continuous quantity: a line between two weeks implies
        values in between that do not exist.
      */}
      {growthWeeks.length > 1 && (
        <div className="glass-card" style={{ marginTop: 'var(--sp-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-15)' }}>
            <Users size={16} style={{ color: 'var(--warning)' }} />
            <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>New Accounts by Week</span>
          </div>
          <p style={{ margin: '0 0 0.9rem', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            {growthWeeks.length} weeks. The tallest bar is{' '}
            {Math.max(...growthWeeks.map((w) => w.new_users ?? 0)).toLocaleString()} accounts in one week.
          </p>
          <BarSeries
            rows={growthWeeks}
            valueOf={(w) => Number(w.new_users ?? 0)}
            labelOf={(w) => String(w.week ?? '').slice(0, 10)}
            format={(v) => `${v.toLocaleString()} account${v === 1 ? '' : 's'}`}
            height={96}
            tone="var(--warning)"
          />
        </div>
      )}

      {/* ── 7. How long the store takes ──

          Paid → shipped and shipped → delivered, per carrier, from
          services/fulfilmentStats. These are the SAME figures the buyer is
          shown at checkout and on the order page ("usually ships within
          1–2 days"), so this card is the operator looking at their own
          promise. Median and p90, never the mean; a bucket under ten orders
          says so rather than drawing a bar from four data points. */}
      {timing && <FulfilmentTiming timing={timing} />}

      {/* ── 6. When buyers buy ── */}
      {heat && heat.length > 0 && (
        <div className="glass-card" style={{ marginTop: 'var(--sp-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-15)' }}>
            <CalendarClock size={16} style={{ color: 'var(--primary)' }} />
            <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>When Buyers Buy</span>
          </div>
          <p style={{ margin: '0 0 0.9rem', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            Orders by weekday and hour over the last 90 days, in server time. The hot cells are
            where a drop lands hardest; the dark ones are where maintenance costs the least.
          </p>
          <ActivityHeatmap cells={heat} />
        </div>
      )}
    </div>
  );
}


/* ── Who buys, and what ─────────────────────────────────────────────────── */

const ROUTE_LABEL = {
  open: 'Open sign-up',
  invite_link: 'Your invite links',
  referral: 'Buyer referrals',
};
const STOREFRONT_LABEL = { web: 'Web', telegram: 'Telegram bot', potato: 'Potato bot' };
const STOREFRONT_TONE = {
  web: 'var(--primary)',
  telegram: 'var(--secondary)',
  potato: 'var(--accent)',
};

/** A ramp of the brand for a categorical donut — no literal hex, so it re-themes. */
const rampTone = (i, n) => `color-mix(in srgb, var(--primary) ${Math.max(15, 100 - Math.round((i / Math.max(1, n - 1)) * 80))}%, var(--secondary))`;

const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

function InsightEmpty({ children }) {
  return <p className="anx-empty">{children}</p>;
}

function BuyerInsights({ days, onDays, loading, error, acq, mix, buyers, money }) {
  const revenueHidden = (mix?.revenue_hidden ?? acq?.revenue_hidden) === true;

  // ── Signups by route ──
  const signups = acq?.signups || [];
  const signupTotal = signups.reduce((s, r) => s + r.accounts, 0);
  const buyerTotal = signups.reduce((s, r) => s + r.buyers, 0);

  // ── Storefronts ──
  const storefronts = acq?.storefronts || [];
  const storefrontOrders = storefronts.reduce((s, r) => s + r.orders, 0);
  const linked = acq?.linked;
  const anyBotLinked = linked && (linked.telegram + linked.potato + linked.both) > 0;

  // ── Catalogue mix ──
  const categories = mix?.categories || [];
  const categoryUnits = categories.reduce((s, c) => s + c.units, 0);
  const brands = mix?.brands || [];

  // ── Buyers ──
  const buckets = buyers?.buckets || [];
  const bucketBuyers = buckets.reduce((s, b) => s + b.buyers, 0);
  const repeatBuyers = buckets.filter((b) => b.bucket !== '1').reduce((s, b) => s + b.buyers, 0);
  const loyalty = buyers?.loyalty;
  const basket = buyers?.basket;
  const pairs = buyers?.pairs || [];
  const firstOrder = acq?.first_order;

  const windowLabel = days === 365 ? 'the last year' : `the last ${days} days`;

  return (
    <section className="anx" id="analytics-insights" data-search-target="analytics-insights" aria-busy={loading}>
      <div className="anx-head">
        <div>
          <h2 className="anx-title">Who buys, and what</h2>
          <p className="anx-lede">
            Over {windowLabel}. Doors, not trackers: this store records which link, bot or page an account
            and an order came through, and nothing about the person.
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

      {error && (
        <p className="anx-error" role="alert">{error}</p>
      )}

      <div className="anx-grid">
        {/* ── What sells, by kind ── */}
        <div className="glass-card anx-card anx-card-wide">
          <h3><Layers size={15} aria-hidden="true" /> What sells, by category</h3>
          {categories.length === 0 ? (
            <InsightEmpty>
              Nothing sold in {windowLabel}.{' '}
              {days < 365 && <button type="button" className="anx-link" onClick={() => onDays(365)}>Look at the whole year</button>}
            </InsightEmpty>
          ) : (
            <div className="anx-mix">
              <DonutChart
                segments={categories.slice(0, 6).map((c, i) => ({
                  label: c.name,
                  value: c.units,
                  color: rampTone(i, Math.min(6, categories.length)),
                  display: `${c.units.toLocaleString()} · ${pct(c.units, categoryUnits)}`,
                }))}
                centerLabel="units"
                centerValue={categoryUnits.toLocaleString()}
              />
              <div className="anx-mix-brands">
                <h4>By brand</h4>
                {brands.length === 0 ? (
                  <InsightEmpty>No brand on anything sold.</InsightEmpty>
                ) : (
                  <RankedBars
                    rows={brands.slice(0, 8)}
                    valueOf={(b) => b.units}
                    labelOf={(b) => b.name}
                    subOf={(b) => (revenueHidden || b.revenue == null ? `${b.orders} order${b.orders === 1 ? '' : 's'}` : money(b.revenue))}
                    format={(v) => `${v.toLocaleString()} units`}
                    tone="var(--secondary)"
                  />
                )}
              </div>
            </div>
          )}
          {categories.some((c) => c.name === 'No longer listed') && (
            <p className="anx-foot">"No longer listed" is history of products since deleted — sold then, not listed now.</p>
          )}
        </div>

        {/* ── Bought together ── */}
        <div className="glass-card anx-card">
          <h3><Repeat size={15} aria-hidden="true" /> Bought together</h3>
          {pairs.length === 0 ? (
            <InsightEmpty>No two lines have shared an order twice in {windowLabel} yet.</InsightEmpty>
          ) : (
            <ol className="anx-pairs">
              {pairs.map((p, i) => (
                <li key={i}>
                  <span className="anx-pair-count" title={`${p.together} orders held both`}>{p.together}×</span>
                  <span className="anx-pair-names">
                    <span>{p.a.product}{p.a.variant && p.a.variant !== p.a.product ? <small> {p.a.variant}</small> : null}</span>
                    <span className="anx-pair-plus" aria-hidden="true">+</span>
                    <span>{p.b.product}{p.b.variant && p.b.variant !== p.b.product ? <small> {p.b.variant}</small> : null}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p className="anx-foot">A pair is two lines in one order. Shelve them together; bundle them; put one on the other's page.</p>
        </div>

        {/* ── Where buyers come from ── */}
        <div className="glass-card anx-card">
          <h3><Compass size={15} aria-hidden="true" /> Where new accounts come from</h3>
          {signupTotal === 0 ? (
            <InsightEmpty>No account was created in {windowLabel}.</InsightEmpty>
          ) : (
            <>
              {/* Three columns, not four. "Bought" and "converted" are one fact
                  read two ways, and at the card's width a fourth column was
                  the one that got clipped — so the count and the share sit
                  together, with the share as a bar beneath them. */}
              <table className="anx-table">
                <thead>
                  <tr><th scope="col">Route</th><th scope="col">Accounts</th><th scope="col">Went on to buy</th></tr>
                </thead>
                <tbody>
                  {signups.filter((r) => r.accounts > 0).map((r) => (
                    <tr key={r.route}>
                      <td>{ROUTE_LABEL[r.route] || r.route}</td>
                      <td className="anx-num">{r.accounts.toLocaleString()}</td>
                      <td className="anx-num">
                        <span className="anx-convert" style={{ '--p': r.accounts ? r.buyers / r.accounts : 0 }} title={`${r.buyers} of ${r.accounts} accounts placed an order`}>
                          <i aria-hidden="true" />{r.buyers.toLocaleString()} <small>· {pct(r.buyers, r.accounts)}</small>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>All routes</td>
                    <td className="anx-num">{signupTotal.toLocaleString()}</td>
                    <td className="anx-num">{buyerTotal.toLocaleString()} <small>· {pct(buyerTotal, signupTotal)}</small></td>
                  </tr>
                </tfoot>
              </table>
              {acq?.referrers?.referred > 0 && (
                <p className="anx-foot">
                  {acq.referrers.referred.toLocaleString()} of them through {acq.referrers.referrers.toLocaleString()} referring buyer{acq.referrers.referrers === 1 ? '' : 's'}.
                </p>
              )}
            </>
          )}
          {acq?.links?.length > 0 && (
            <div className="anx-links">
              <h4><Link2 size={13} aria-hidden="true" /> Invite links that brought accounts</h4>
              <RankedBars
                rows={acq.links}
                valueOf={(l) => l.accounts}
                labelOf={(l) => l.name}
                subOf={(l) => `${l.buyers} bought${l.source === 'user' ? ' · buyer link' : ''}${l.active ? '' : ' · off'}`}
                format={(v) => `${v.toLocaleString()} account${v === 1 ? '' : 's'}`}
                tone="var(--accent)"
              />
            </div>
          )}
          {firstOrder?.buyers > 0 && firstOrder.median_hours != null && (
            <p className="anx-foot">
              <UserPlus size={12} aria-hidden="true" /> A first order takes {fmtHours(firstOrder.median_hours)} from sign-up, for the
              middle one of {firstOrder.buyers.toLocaleString()} first-time buyer{firstOrder.buyers === 1 ? '' : 's'} in {windowLabel}.
            </p>
          )}
          <p className="anx-foot"><Link to="/admin/invite-links">Invite links</Link> · <Link to="/admin/users">Users</Link></p>
        </div>

        {/* ── Which storefront ── */}
        <div className="glass-card anx-card">
          <h3><Bot size={15} aria-hidden="true" /> Which storefront takes the order</h3>
          {storefrontOrders === 0 ? (
            <InsightEmpty>No orders in {windowLabel}.</InsightEmpty>
          ) : (
            <DonutChart
              segments={storefronts.map((s) => ({
                label: STOREFRONT_LABEL[s.storefront] || s.storefront,
                value: s.orders,
                color: STOREFRONT_TONE[s.storefront] || 'var(--text-muted)',
                display: `${s.orders.toLocaleString()} · ${s.buyers.toLocaleString()} buyer${s.buyers === 1 ? '' : 's'}${!revenueHidden && s.revenue != null ? ` · ${money(s.revenue)}` : ''}`,
              }))}
              centerLabel="orders"
              centerValue={storefrontOrders.toLocaleString()}
            />
          )}
          {linked && linked.total > 0 && (
            <p className="anx-foot">
              {anyBotLinked ? (
                <>
                  Reach for an announcement: {linked.telegram + linked.both} account{linked.telegram + linked.both === 1 ? '' : 's'} on Telegram,{' '}
                  {linked.potato + linked.both} on Potato{linked.both > 0 ? ` (${linked.both} on both)` : ''}; {linked.web_only.toLocaleString()} reachable only on the web.
                </>
              ) : (
                <>None of the {linked.total.toLocaleString()} active accounts has a bot linked; every announcement reaches them on the web only.</>
              )}
            </p>
          )}
          <p className="anx-foot">Orders placed before the storefront was recorded count as web.</p>
        </div>

        {/* ── Repeat buyers ── */}
        <div className="glass-card anx-card">
          <h3><Users size={15} aria-hidden="true" /> How often they come back</h3>
          {bucketBuyers === 0 ? (
            <InsightEmpty>Nobody bought in {windowLabel}.</InsightEmpty>
          ) : (
            <>
              <StatTiles stats={[
                {
                  key: 'repeat',
                  label: 'Repeat buyers',
                  value: pct(repeatBuyers, bucketBuyers),
                  hint: `${repeatBuyers.toLocaleString()} of ${bucketBuyers.toLocaleString()} bought twice or more`,
                  tone: 'var(--success)',
                  lead: true,
                },
                loyalty && {
                  key: 'returning',
                  label: 'Orders from returners',
                  value: pct(loyalty.orders_from_returning, loyalty.orders_from_new + loyalty.orders_from_returning),
                  hint: `${loyalty.returning_buyers.toLocaleString()} came back · ${loyalty.new_buyers.toLocaleString()} new`,
                  tone: 'var(--primary)',
                },
                basket?.items_per_order != null && {
                  key: 'basket',
                  label: 'Basket',
                  value: `${basket.items_per_order.toFixed(1)} items`,
                  hint: `${basket.lines_per_order.toFixed(1)} lines per order`,
                  tone: 'var(--accent)',
                },
              ]}
              />
              {/* Short labels on purpose: the card is a third of the row and the
                  bar needs the room more than the words do. The orders each
                  bucket accounts for ride the row's tooltip. */}
              <RankedBars
                rows={buckets.filter((b) => b.buyers > 0)}
                valueOf={(b) => b.buyers}
                labelOf={(b) => (b.bucket === '1' ? '1 order' : `${b.bucket.replace('-', '–')} orders`)}
                format={(v) => `${v.toLocaleString()} buyer${v === 1 ? '' : 's'}`}
                tone="var(--success)"
              />
            </>
          )}
          <p className="anx-foot">"Returning" means the buyer's first ever order was before {windowLabel}. <Link to="/admin/tiers">VIP tiers</Link> are the lever.</p>
        </div>
      </div>
    </section>
  );
}

/** "1.5 d" / "6 h" / "45 min" from hours. */
function fmtHours(h) {
  if (h == null) return '—';
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
  const d = h / 24;
  return `${d % 1 === 0 ? d : d.toFixed(1)} d`;
}

function TimingLeg({ leg, max, tone, minSample }) {
  if (!leg || leg.suppressed) {
    return (
      <span className="ftime-thin">
        not enough history yet ({leg?.n || 0} of {minSample})
      </span>
    );
  }
  const pct = (h) => (max > 0 ? `${Math.min(100, (h / max) * 100)}%` : '0%');
  return (
    <span className="ftime-leg" style={{ '--leg-tone': tone }}>
      <span className="ftime-bar" aria-hidden="true">
        <span className="ftime-span" style={{ '--p90': pct(leg.p90_hours) }} />
        <span className="ftime-median" style={{ '--p50': pct(leg.median_hours) }} />
      </span>
      <span className="ftime-figures" title={`median ${fmtHours(leg.median_hours)}, slowest tenth beyond ${fmtHours(leg.p90_hours)}, from ${leg.n} orders`}>
        <b>{fmtHours(leg.median_hours)}</b> · {fmtHours(leg.p90_hours)}
      </span>
    </span>
  );
}

function FulfilmentTiming({ timing }) {
  const rows = [{ carrier: 'All carriers', all: true, ...timing.all }, ...timing.carriers];
  const maxD = Math.max(0, ...rows.filter((r) => !r.dispatch.suppressed).map((r) => r.dispatch.p90_hours || 0));
  const maxT = Math.max(0, ...rows.filter((r) => !r.transit.suppressed).map((r) => r.transit.p90_hours || 0));
  const nothing = timing.all.dispatch.n === 0;
  return (
    <div className="glass-card" style={{ marginTop: 'var(--sp-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', marginBottom: 'var(--sp-15)' }}>
        <Truck size={16} style={{ color: 'var(--success)' }} />
        <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)' }}>How Long the Store Takes</span>
      </div>
      <p style={{ margin: '0 0 0.9rem', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
        Paid to shipped, and shipped to delivered, over the last {timing.window_days} days. These are the
        figures buyers see at checkout and on their order — the middle order, then the point the slowest
        tenth begins. Under {timing.min_sample} completed orders a row says so instead of guessing.
      </p>
      {nothing ? (
        <div style={{ fontSize: 'var(--fs-base)', color: 'var(--text-secondary)' }}>
          Nothing has shipped in the window yet, so there is no timing to show — and buyers see no estimate.
        </div>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table className="ftime-table">
              <thead>
                <tr>
                  <th scope="col">Carrier</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Paid → shipped</th>
                  <th scope="col">Shipped → delivered</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.carrier} className={r.all ? 'is-all' : ''}>
                    <td className="ftime-carrier" data-label="Carrier">{r.carrier}</td>
                    <td className="ftime-n" data-label="Orders">{r.dispatch.n}{r.transit.n !== r.dispatch.n ? ` · ${r.transit.n} delivered` : ''}</td>
                    <td data-label="Paid → shipped"><TimingLeg leg={r.dispatch} max={maxD} tone="var(--primary)" minSample={timing.min_sample} /></td>
                    <td data-label="Shipped → delivered"><TimingLeg leg={r.transit} max={maxT} tone="var(--secondary)" minSample={timing.min_sample} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="ftime-key">
            <span><i /> to the slowest tenth (p90)</span>
            <span><i className="is-median" /> the middle order (median)</span>
          </p>
        </>
      )}
    </div>
  );
}
