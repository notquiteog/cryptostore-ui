/**
 * The admin data widgets: pure SVG + theme tokens, no chart dependency.
 *
 * Everything scales from its data and paints with currentColor or CSS
 * variables, so a re-themed store re-themes its dashboards for free. Every
 * widget renders nothing (not a frame, not a "no data" card) when it has
 * nothing true to say — the home bento rule, applied to staff surfaces.
 */

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** ▲ / ▼ percentage chip for period-over-period movement. */
export function DeltaChip({ pct }) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return null;
  const up = Number(pct) >= 0;
  return (
    <span
      className="wdg-delta"
      style={{ color: up ? 'var(--success)' : 'var(--danger)' }}
      title="vs the previous period"
    >
      {up ? '▲' : '▼'} {Math.abs(Number(pct)).toFixed(1)}%
    </span>
  );
}

/**
 * Area sparkline. `points` is an array of numbers; the shape is the story,
 * so axes are omitted — pair it with a printed figure, never alone.
 */
export function Sparkline({ points = [], width = 220, height = 56, stroke = 'var(--primary)' }) {
  if (points.length < 2) return null;
  const max = Math.max(...points, 1);
  const min = Math.min(...points, 0);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const y = (v) => height - 4 - ((v - min) / span) * (height - 10);
  const line = points.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg
      className="wdg-spark"
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={area} fill="currentColor" style={{ color: stroke, opacity: 0.12 }} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={y(points[points.length - 1])} r="2.6" fill={stroke} />
    </svg>
  );
}

/**
 * Donut of labelled segments [{label, value, color}]. The centre carries the
 * total; the legend carries the numbers, because a slice under ~8% is
 * unreadable as an angle but perfectly readable as a row.
 */
export function DonutChart({ segments = [], centerLabel, centerValue, size = 132 }) {
  const total = segments.reduce((s, x) => s + (x.value || 0), 0);
  if (total <= 0) return null;
  const R = 44;
  const C = 2 * Math.PI * R;
  let offset = 0;
  return (
    <div className="wdg-donut">
      <svg viewBox="0 0 110 110" width={size} height={size} role="img" aria-label={centerLabel}>
        <circle cx="55" cy="55" r={R} fill="none" stroke="rgba(var(--tint-rgb),0.08)" strokeWidth="12" />
        {segments.map((s, i) => {
          const frac = s.value / total;
          const el = (
            <circle
              key={i}
              cx="55" cy="55" r={R}
              fill="none"
              stroke={s.color}
              strokeWidth="12"
              strokeDasharray={`${(frac * C).toFixed(2)} ${C.toFixed(2)}`}
              strokeDashoffset={(-offset * C).toFixed(2)}
              transform="rotate(-90 55 55)"
              strokeLinecap="butt"
            />
          );
          offset += frac;
          return el;
        })}
        <text x="55" y="52" textAnchor="middle" className="wdg-donut-value">{centerValue}</text>
        <text x="55" y="66" textAnchor="middle" className="wdg-donut-label">{centerLabel}</text>
      </svg>
      <div className="wdg-legend">
        {segments.map((s, i) => (
          <div key={i} className="wdg-legend-row">
            <span className="wdg-legend-dot" style={{ background: s.color }} />
            <span className="wdg-legend-label">{s.label}</span>
            <span className="wdg-legend-value">{s.display ?? s.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Weekday × hour heatmap of order counts. Intensity is normalised to the
 * busiest cell and painted in the primary at varying alpha — a colour SCALE
 * would say more than the data does; "busier / quieter" is the whole story.
 */
export function ActivityHeatmap({ cells = [] }) {
  if (!cells.length || !cells.some((c) => c.count > 0)) return null;
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const c of cells) {
    if (grid[c.dow] && c.hour >= 0 && c.hour < 24) grid[c.dow][c.hour] = c.count;
  }
  const max = Math.max(...cells.map((c) => c.count), 1);
  return (
    <div className="wdg-heat" role="img" aria-label="Orders by weekday and hour">
      <div className="wdg-heat-grid">
        {grid.map((row, d) => (
          <div key={d} className="wdg-heat-row">
            <span className="wdg-heat-dow">{DOW[d]}</span>
            {row.map((n, h) => (
              <span
                key={h}
                className="wdg-heat-cell"
                style={{ '--heat': clamp01(n / max) }}
                title={`${DOW[d]} ${String(h).padStart(2, '0')}:00 — ${n} order${n === 1 ? '' : 's'}`}
              />
            ))}
          </div>
        ))}
        <div className="wdg-heat-row wdg-heat-hours">
          <span className="wdg-heat-dow" />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="wdg-heat-hour">{h % 6 === 0 ? h : ''}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * One stacked bar of the order pipeline. Widths are proportional with a
 * readability floor; the legend carries the exact counts.
 */
export function FlowBar({ stages = [] }) {
  const total = stages.reduce((s, x) => s + (x.count || 0), 0);
  if (total <= 0) return null;
  const shown = stages.filter((s) => s.count > 0);
  return (
    <div className="wdg-flow">
      <div className="wdg-flow-bar" role="img" aria-label="Order pipeline">
        {shown.map((s) => (
          <span
            key={s.label}
            className="wdg-flow-seg"
            style={{
              // The 2% floor keeps a 1-order stage clickable-scale visible;
              // flex renormalises, so floors cannot overflow the bar.
              flexGrow: Math.max(s.count / total, 0.02),
              background: s.color,
            }}
            title={`${s.label}: ${s.count}`}
          />
        ))}
      </div>
      <div className="wdg-legend wdg-legend-inline">
        {shown.map((s) => (
          <div key={s.label} className="wdg-legend-row">
            <span className="wdg-legend-dot" style={{ background: s.color }} />
            <span className="wdg-legend-label">{s.label}</span>
            <span className="wdg-legend-value">{s.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * A dated bar series — daily revenue, daily orders, anything with one bar per
 * day and a date under it.
 *
 * Drawn in proportional space rather than pixels, which is the whole point.
 * The hand-rolled version this replaces was a flex row of `<div>`s with
 * `flex: 1` and a fixed `gap: 2` px: at 90 days on a 375px phone that leaves
 * each bar about 1.8px wide with a 2px gap beside it, so the gaps were wider
 * than the data and the chart read as a grey comb.
 *
 * Here the gap is a FRACTION of a slot, so it shrinks with the bars instead of
 * eating them, and the shape survives any container width with no measurement
 * and no resize listener. Measured: 7 bars in 340px gives a 36px bar with a
 * 12px gap; 30 bars gives 9px and 2.3px. At the far end — 90 bars in 340px —
 * the gap lands at 0.3px and the bars visually merge into one silhouette.
 * That is the intended outcome rather than a limit being hit: ninety daily
 * values in a phone's width IS a filled histogram, and a continuous shape is
 * the honest way to draw it. What it must never do again is spend more pixels
 * on the gaps than on the data.
 *
 * `preserveAspectRatio="none"` is deliberate and safe: every mark is an
 * axis-aligned rect, so non-uniform scaling changes widths and heights but
 * distorts nothing that has a diagonal or a stroke.
 *
 * Hover discloses the exact figure (DESIGN §4 — this is how a chart gets dense
 * without getting loud); the `<title>` also gives it to a pointer-less reader,
 * and the printed max/total beneath means the bars are never the only channel.
 */
export function BarSeries({
  rows = [],
  valueOf = (r) => Number(r.revenue ?? 0),
  labelOf = (r) => r.day,
  format = (v) => v.toFixed(2),
  height = 120,
  tone = 'var(--primary)',
}) {
  if (!rows.length) return null;

  const values = rows.map(valueOf);
  const max = Math.max(...values, 0);
  // A flat run of zeroes is a real answer, and dividing by it is not. Every bar
  // then draws at the floor, which reads as "nothing happened" — correctly.
  const scale = max > 0 ? max : 1;

  // Proportional slot: one unit per row, with a tenth of it given to the gap.
  // Capped so a 7-day week does not render seven fenceposts with more air than
  // bar between them.
  const SLOT = 10;
  const gap = Math.min(SLOT * 0.25, Math.max(SLOT * 0.08, SLOT * (6 / rows.length)));
  const barW = SLOT - gap;
  const H = 100;

  return (
    <svg
      className="wdg-bars"
      viewBox={`0 0 ${rows.length * SLOT} ${H}`}
      width="100%"
      height={height}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${rows.length} periods, highest ${format(max)}`}
    >
      {rows.map((r, i) => {
        const v = valueOf(r);
        // A floor of 1.5 units so a day with a real but tiny sale is still a
        // mark rather than nothing — an invisible bar and an absent bar mean
        // different things, and only one of them is true.
        const h = v > 0 ? Math.max(1.5, (v / scale) * (H - 4)) : 0;
        return (
          <g key={labelOf(r) ?? i} className="wdg-bar">
            {/* Full-height hit area, so the tooltip does not require the
                pointer to find a 3-unit-tall bar on a bad day. */}
            <rect x={i * SLOT} y="0" width={SLOT} height={H} fill="transparent" />
            <rect
              className="wdg-bar-fill"
              x={i * SLOT + gap / 2}
              y={H - h}
              width={barW}
              height={h}
              fill={tone}
            />
            <title>{`${labelOf(r)}: ${format(v)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}

/**
 * A ranked list with a bar per row — categories by units, buyers by orders
 * placed, anything where the reader wants both the order and the proportion.
 *
 * Label, bar, figure, on one line each, dense enough that twelve rows fit
 * where a donut's legend would have shown five. The bar is proportional to
 * the largest row, with a 2% floor so a real-but-small row is still a mark;
 * the figure is printed, in the mono face, so the bar is never the only
 * channel (DESIGN §3 — it must survive an operator flattening every glow).
 *
 * `subOf` prints a second, muted figure after the label — "12 orders" beside
 * a units bar — for the rows that carry two facts.
 */
export function RankedBars({
  rows = [],
  valueOf = (r) => Number(r.value ?? 0),
  labelOf = (r) => r.label,
  subOf = null,
  format = (v) => v.toLocaleString(),
  tone = 'var(--primary)',
}) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map(valueOf), 1);
  return (
    <div className="wdg-rank">
      {rows.map((r, i) => {
        const v = valueOf(r);
        const label = labelOf(r);
        return (
          <div key={`${label}-${i}`} className="wdg-rank-row" title={`${label}: ${format(v)}`}>
            <span className="wdg-rank-label">
              <span className="wdg-rank-name">{label}</span>
              {subOf && <small>{subOf(r)}</small>}
            </span>
            <span className="wdg-rank-bar" aria-hidden="true">
              <i style={{ width: `${Math.max(2, (v / max) * 100)}%`, background: tone }} />
            </span>
            <span className="wdg-rank-value">{format(v)}</span>
          </div>
        );
      })}
    </div>
  );
}
