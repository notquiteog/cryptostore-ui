import { LineChart } from 'lucide-react';
import DraftTool from './DraftTool';

/**
 * The analytics page, read back as comparisons.
 *
 * ── Why a page full of numbers still wants a paragraph ──────────────────────
 *
 * The same shape as `OpsNote`, and a different argument for it. The dashboard's
 * note exists because the counts are spread over tiles nobody reads in order.
 * Analytics has the opposite problem: it renders every figure it has, in ten
 * tables, and an operator standing in front of it is not short of numbers.
 *
 * What they are short of is comparisons. Is 62% of orders from returning buyers
 * good. Is a 1.4-item basket normal here. Is the gap between the top category
 * and the second one widening. Those are statements ABOUT the figures on the
 * page, which is what prose is for and a table is not — so the model's job is
 * explicitly comparison and explicitly not recitation
 * (`prompts.analyticsNarrative` spells out both).
 *
 * ── Why it does not repeat the facts underneath ────────────────────────────
 *
 * `OpsNote` prints its counts under the prose, because "a summary an operator
 * cannot check against the numbers it came from is a summary they have to
 * trust." That rule is satisfied here by the page: every figure the paragraph
 * can mention is already rendered a few hundred pixels below it, in a table
 * with its own heading. Repeating a selection of them would be a second,
 * smaller, differently-chosen copy of the report — which is the thing this
 * codebase spends most of its comments avoiding.
 *
 * ── Why it follows the window ──────────────────────────────────────────────
 *
 * The `days` the operator chose is sent, and the server recomputes the insights
 * payload from it under the same permission and the same redaction the page
 * used. So a reading of "the last 30 days" is a reading of the 30 days on
 * screen — not of a default 90 the paragraph would then silently describe.
 *
 * The client does NOT post the figures. A client that supplies the numbers is a
 * client that can supply any numbers, and what comes back is a paragraph in the
 * shop's own voice on the shop's own reporting page.
 */
export default function AnalyticsNote({ days }) {
  return (
    <DraftTool
      capability="ops"
      icon={LineChart}
      label="Read these figures"
      hint="Compares what is on this page — what is bigger than what, and what has thinned out. It states no figure it was not given."
      slipTitle={`The last ${days} days, in a paragraph`}
      busyLabel="Reading…"
      className="aidraft-ops"
      run={() => ({ path: `/ai/analytics-narrative?days=${encodeURIComponent(days)}`, method: 'GET' })}
      // `streamTool` wraps a string return as `{text}` (aiController's
      // `normaliseResult`), which is what `analyticsNarrativeStream` produces.
      renderDraft={(res) => <p className="aidraft-prose">{res.text}</p>}
    />
  );
}
