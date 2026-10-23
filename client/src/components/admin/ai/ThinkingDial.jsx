/**
 * "Think harder about this one."
 *
 * ── Why it is per request and not a setting ─────────────────────────────────
 *
 * The operator's per-capability defaults (`ai_think_<capability>`) are the
 * right answer most of the time and were chosen against measurements — a
 * support draft is a blank page and repays deliberation, the assistant's
 * prompt is already reasoned by retrieval and does not. What a default cannot
 * know is that THIS ticket is a hard one, or that this description came out
 * shallow and is worth another go.
 *
 * So this changes one request and then forgets. A level that stuck would turn
 * a considered choice about one draft into a permanent tax on every later one,
 * which is exactly the failure the per-capability defaults exist to avoid.
 *
 * ── Why it is often absent ──────────────────────────────────────────────────
 *
 * `options` is null unless the server said this viewer may have it
 * (`ai_thinking_toggle`, resolved per request in the controller — the client
 * never works the audience out for itself). Thinking is the most expensive
 * thing this store can be asked to do, so an operator who wants their defaults
 * and no argument sets `nobody` and this renders nothing anywhere.
 */
export default function ThinkingDial({ options, value, onChange, disabled }) {
  if (!options?.length) return null;
  return (
    <label className="ai-think-dial" title="How hard to think about this one request. Deeper drafts take longer and cost more.">
      <span className="sr-only">Thinking depth for this request</span>
      <select
        className="glass-input ai-think-dial-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {/* The empty value is not a level — it means "whatever the operator
            set for this capability", which is different from `off`. */}
        <option value="">think: default</option>
        {options.map((level) => <option key={level} value={level}>{`think: ${level}`}</option>)}
      </select>
    </label>
  );
}

