import { useMemo } from 'react';
import { Coins, TrendingUp } from 'lucide-react';

/**
 * Thirty days of model spend, per capability.
 *
 * ── The question this answers ───────────────────────────────────────────────
 *
 * "What is this costing me." The AI page could previously say one sentence —
 * *1.4 million tokens spent today across 380 requests* — which is a number and
 * not an answer: a store with the assistant, the daily note, support drafts,
 * translation and the review digest switched on has five things spending from
 * one counter, and that sentence does not say which of the five to turn off.
 *
 * So the axis here is the CAPABILITY, because that is the axis with a switch at
 * the end of it. An operator cannot turn off a model, and the slot system means
 * one model serves several capabilities — a per-model chart would name a cost
 * with no action attached to it.
 *
 * ── Why a sparkline and not a bar chart ─────────────────────────────────────
 *
 * Because the useful reading is SHAPE, not magnitude. "The assistant costs
 * three times what support drafts cost" is the total, which is printed beside
 * it as a number. What the line adds is the thing a number cannot show: that
 * translation was flat for three weeks and then tripled on Tuesday, which is
 * the observation that makes somebody go and look at what changed on Tuesday.
 *
 * One line per capability, each scaled to its OWN maximum rather than a shared
 * one. That is a deliberate trade and it is worth being explicit about: a shared
 * scale would make every line except the biggest a flat line along the bottom,
 * which is the chart telling you what you already knew from the totals. Per-line
 * scaling means the heights are not comparable BETWEEN rows — so the rows carry
 * their totals as figures, and the line only ever claims to describe its own
 * row's trend. The legend says so.
 *
 * ── No charting library ─────────────────────────────────────────────────────
 *
 * `CLAUDE.md`: dependency-lean, and nothing may depend on a third party being
 * reachable. A sparkline is a polyline over thirty points. Drawn inline, in
 * theme tokens, with no script and no CDN — which also means it renders on the
 * filtered network this project is built for.
 */

/** Tokens as a person reads them: 1.4M, 38.2k, 940. */
function short(n) {
  const v = Number(n) || 0;
  if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return String(v);
}

/**
 * A cost, at the precision it deserves.
 *
 * Four decimals below a cent, because a day of assistant traffic on a cheap
 * model genuinely is tenths of a cent and rounding it to two would print
 * "$0.00" — a measurement that reads as "free". Two decimals above a dollar,
 * because nobody wants a fourth decimal on $184.
 */
function money(n) {
  const v = Number(n) || 0;
  if (v === 0) return '$0';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
}

/**
 * One capability's thirty days, as a polyline.
 *
 * `preserveAspectRatio="none"` so the line stretches to whatever width the row
 * gives it — this is a trend, not a shape with a correct aspect, and a
 * fixed-ratio sparkline in a fluid table either overflows or leaves a gap.
 */
function Spark({ series, label }) {
  const { points, peak } = useMemo(() => {
    const values = Array.isArray(series) ? series : [];
    const max = Math.max(1, ...values);
    const step = values.length > 1 ? 100 / (values.length - 1) : 100;
    return {
      // y is inverted: SVG's origin is top-left and a spend chart reads upward.
      points: values.map((v, i) => `${(i * step).toFixed(2)},${(20 - (v / max) * 19).toFixed(2)}`).join(' '),
      peak: max,
    };
  }, [series]);

  return (
    <svg
      className="aiu-spark"
      viewBox="0 0 100 20"
      preserveAspectRatio="none"
      role="img"
      // The whole point of an accessible name here: a screen reader cannot read
      // a polyline, and "chart" would be worse than nothing. The peak is the one
      // fact the line carries that the row's figures do not.
      aria-label={`${label}: thirty-day trend, busiest day ${short(peak)} tokens`}
    >
      <polyline points={points} />
    </svg>
  );
}

/*
 * ── Why today's figure is NOT repeated here ─────────────────────────────────
 *
 * It was, and it read as a contradiction: "5.7k tokens" over thirty days beside
 * "11k today". Both numbers were right and they come from DIFFERENT TABLES —
 * `ai_usage_daily` is the ceiling's counter and has been running since the
 * feature shipped, while `ai_usage_capability_daily` is the breakdown and
 * starts empty on any store that upgrades into it. So for the first day after
 * an upgrade the thirty-day total is smaller than today's, which is exactly the
 * kind of figure an operator stops trusting a page over.
 *
 * The AI page already prints today's spend on its index line, from
 * `spendToday` — the authority the budget cap itself reads. One number, one
 * source, one place. This panel is self-consistent: every figure in it comes
 * from the per-capability table, and the sparkline's last point IS today.
 */
export default function UsageChart({ usage }) {
  if (!usage) return null;

  const { capabilities = [], totals, rates, days = [] } = usage;
  const priced = Boolean(rates && (rates.prompt || rates.completion));

  if (!capabilities.length) {
    /*
     * Empty is not a failure and the wording has to say which. A store that has
     * generated nothing in a month is either brand new or has the features
     * switched off, and both are fine — so this points at the switches rather
     * than apologising (DESIGN §9).
     */
    return (
      <section className="glass-card aiu" aria-labelledby="aiu-title">
        <h2 id="aiu-title"><TrendingUp size={16} aria-hidden="true" /> What the models cost</h2>
        <p className="ai-hint">
          Nothing has been generated in the last {days.length} days. Spend appears here per
          capability as soon as something runs — the switches are above.
        </p>
      </section>
    );
  }

  return (
    <section className="glass-card aiu" aria-labelledby="aiu-title">
      <h2 id="aiu-title"><TrendingUp size={16} aria-hidden="true" /> What the models cost</h2>
      <p className="ai-hint">
        The last {days.length} days, by the capability that spent it — which is the axis with a
        switch on it. Each line is scaled to its own busiest day, so the shapes show a trend and
        cannot be compared between rows; the figures beside them can.
        {!priced && (
          <>
            {/* Named, not linked. There is no anchor to link TO — the settings
                groups below are rendered as tabs rather than as addressable
                sections, and an `#ai-spend` href pointing at nothing is worse
                than a sentence: it is a link an operator presses and nothing
                happens. Naming the group is enough on a page the operator is
                already standing on. */}
            {' '}No per-token price is set, so this counts tokens and not money. A store on a
            provider API sets both rates under <strong>Cost and reach</strong> below, and the
            costs appear here.
          </>
        )}
      </p>

      <div className="aiu-totals">
        <span className="aiu-total">
          <strong>{short(totals.total)}</strong> tokens
        </span>
        <span className="aiu-total">
          <strong>{totals.requests.toLocaleString()}</strong> generations
        </span>
        {priced && (
          <span className="aiu-total aiu-total-cost">
            <Coins size={13} aria-hidden="true" />
            <strong>{money(totals.cost)}</strong> estimated
          </span>
        )}
      </div>

      {/* §6: line items, not a responsive table. Five short fields, read down a
          single axis — "which of these is expensive" — and one of the five is a
          drawing that has to stay on the row. A collapsing table would put the
          sparkline on its own line under its own label, which is a chart nobody
          can scan. */}
      <ul className="aiu-rows">
        {capabilities.map((c) => (
          <li key={c.capability} className="aiu-row">
            <span className="aiu-name">{c.capability}</span>
            <Spark series={c.series} label={c.capability} />
            <span className="aiu-tokens" title={`${c.prompt_tokens.toLocaleString()} in, ${c.completion_tokens.toLocaleString()} out`}>
              {short(c.total_tokens)}
            </span>
            <span className="aiu-reqs">{c.requests.toLocaleString()}×</span>
            {priced && <span className="aiu-cost">{money(c.cost)}</span>}
          </li>
        ))}
      </ul>

      <p className="ai-hint aiu-foot">
        {/* The honesty note. `generate.estimateTokens` is four characters per
            token and says so in its own header; a cost built on it is an
            estimate, and presenting it without that word would be presenting a
            guess as an invoice. */}
        Token counts are estimated at four characters per token, because only some providers
        report real ones — so treat the money as an order of magnitude, not a bill.
        Thinking counts as output: a reasoning model can spend more deliberating than replying.
        {' '}Rate limits, on the Settings page, bound how fast any of this can be spent.
      </p>
    </section>
  );
}
